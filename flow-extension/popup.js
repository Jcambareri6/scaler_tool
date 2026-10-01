// Popup: conecta con Scaler Tool, arma la cola de escenas (prompts) del
// proyecto elegido y la manda a correr en la pestaña de Flow (content.js).
// Todo el estado vive en chrome.storage.local, asi el popup se puede cerrar
// y volver a abrir sin cortar nada.

const $ = (id) => document.getElementById(id);
const FLOW_URL = "https://labs.google/fx/";

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error ?? "Error"));
      resolve(res.result);
    });
  });
}
const api = (method, path, body) => send({ type: "api", method, path, body });

function showMsg(text, isError = false) {
  const el = $("msg");
  el.textContent = text ?? "";
  el.className = `small ${isError ? "error" : "muted"}`;
}

async function withBusy(button, fn) {
  button.disabled = true;
  showMsg("");
  try {
    await fn();
  } catch (err) {
    showMsg(err instanceof Error ? err.message : String(err), true);
  } finally {
    button.disabled = false;
    // Los botones de la corrida dependen del estado, no de "ocupado".
    const { run } = await chrome.storage.local.get(["run"]);
    renderRun(run);
  }
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get(["settings"]);
  return settings ?? {};
}

async function saveSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

// El backend deployado (Render, etc.) no esta en host_permissions fijos:
// se pide permiso para ese origen puntual la primera vez.
async function ensureOriginPermission(url) {
  const origin = new URL(url).origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) throw new Error(`Sin permiso para conectarse a ${origin}`);
}

// --- conexion -----------------------------------------------------------

async function renderAuth() {
  const { auth } = await chrome.storage.local.get(["auth"]);
  const logged = !!auth?.accessToken;
  $("who").textContent = logged ? auth.email ?? "conectado" : "";
  $("logoutBtn").classList.toggle("hidden", !logged);
  $("setup").classList.toggle("hidden", !logged);
  if (logged) await loadProjects();
}

$("loginBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const apiUrl = $("apiUrl").value.trim() || "http://localhost:3000";
    await ensureOriginPermission(apiUrl);
    await saveSettings({ apiUrl });
    await send({ type: "login", email: $("email").value.trim(), password: $("password").value });
    $("password").value = "";
    await renderAuth();
  })
);

// Para quien entra con Google (no tiene contraseña): toma el token que la
// app web guarda en localStorage ("skaler_access_token", ver lib/api.ts).
// Ese token no se puede renovar desde aca -- cuando vence (~1h) hay que
// volver a tocar este boton.
$("useAppSession").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const apiUrl = $("apiUrl").value.trim() || "http://localhost:3000";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) throw new Error("Abrí la extensión estando en la pestaña de Scaler Tool");
    const appOrigin = new URL(tab.url).origin;
    const granted = await chrome.permissions.request({
      origins: [`${appOrigin}/*`, ...(/localhost|127\.0\.0\.1/.test(apiUrl) ? [] : [`${new URL(apiUrl).origin}/*`])],
    });
    if (!granted) throw new Error("Sin permiso para leer la sesión de la app");
    const [{ result: token }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => localStorage.getItem("skaler_access_token"),
    });
    if (!token) throw new Error("Esa pestaña no tiene una sesión de Scaler Tool iniciada");
    await saveSettings({ apiUrl });
    await chrome.storage.local.set({ auth: { accessToken: token, refreshToken: null, email: null } });
    const me = await api("GET", "/auth/me");
    await chrome.storage.local.set({ auth: { accessToken: token, refreshToken: null, email: me.email } });
    await renderAuth();
  })
);

$("logoutBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["auth"]);
  await renderAuth();
});

// --- proyecto + cola ----------------------------------------------------

async function loadProjects() {
  const select = $("project");
  if (select.options.length > 0) return;
  try {
    const projects = await api("GET", "/projects");
    const { run } = await chrome.storage.local.get(["run"]);
    select.innerHTML = "";
    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.title || p.id;
      select.appendChild(opt);
    }
    if (run?.projectId) select.value = run.projectId;
  } catch (err) {
    showMsg(err instanceof Error ? err.message : String(err), true);
  }
}

$("loadBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const { run: current } = await chrome.storage.local.get(["run"]);
    if (current?.status === "running") throw new Error("Hay una corrida en curso: pausala primero");

    const projectId = $("project").value;
    if (!projectId) throw new Error("Elegí un proyecto");
    await saveSettings({ mediaType: $("mediaType").value, retries: Number($("retries").value) || 0 });

    $("loadInfo").textContent = "Armando prompts (la primera vez puede tardar un poco)...";
    const script = await api("GET", `/projects/${projectId}/script`);
    const prompts = await api("POST", `/scripts/${script.id}/scenes/image-prompts`, {});

    const fromScene = Number($("fromScene").value) || 1;
    const onlyMissing = $("onlyMissing").checked;
    const selected = prompts.filter((p) => p.order >= fromScene && (!onlyMissing || !p.has_visual));
    const items = selected
      .filter((p) => p.image_prompt)
      .map((p) => ({ sceneId: p.scene_id, order: p.order, prompt: p.image_prompt, status: "pending", attempts: 0, error: null }));
    const withoutPrompt = selected.length - items.length;

    await chrome.storage.local.set({
      run: {
        projectId,
        projectTitle: $("project").selectedOptions[0]?.textContent ?? "",
        scriptId: script.id,
        status: "idle",
        items,
        lastError: null,
        updatedAt: Date.now(),
      },
    });
    $("loadInfo").textContent =
      `${items.length} escenas en cola` + (withoutPrompt ? ` · ${withoutPrompt} sin prompt (no tienen narrativa)` : "");
  })
);

// --- ejecucion en Flow --------------------------------------------------

async function findFlowTab() {
  const tabs = await chrome.tabs.query({ url: "https://labs.google/fx/*" });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (!tab) throw new Error("Abrí Google Flow (labs.google/fx/tools/flow) en una pestaña");
  // Si la pestaña ya estaba abierta antes de instalar la extensión, el
  // content script no esta: se inyecta a mano.
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "flow:ping" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  }
  return tab;
}

$("startBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const { run } = await chrome.storage.local.get(["run"]);
    if (!run?.items?.length) throw new Error("Primero cargá los prompts del proyecto");
    if (!run.items.some((i) => i.status === "pending")) throw new Error("No quedan escenas pendientes");
    const tab = await findFlowTab();
    run.status = "running";
    run.lastError = null;
    await chrome.storage.local.set({ run });
    await chrome.tabs.sendMessage(tab.id, { type: "flow:start" });
  })
);

$("pauseBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const tabs = await chrome.tabs.query({ url: "https://labs.google/fx/*" });
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "flow:pause" }).catch(() => {});
    const { run } = await chrome.storage.local.get(["run"]);
    if (run?.status === "running") {
      run.status = "paused";
      await chrome.storage.local.set({ run });
    }
  })
);

$("retryBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const { run } = await chrome.storage.local.get(["run"]);
    if (!run) return;
    let count = 0;
    for (const item of run.items) {
      if (item.status === "error") {
        item.status = "pending";
        item.error = null;
        count++;
      }
    }
    if (count === 0) throw new Error("No hay escenas fallidas");
    await chrome.storage.local.set({ run });
    $("startBtn").click();
  })
);

const STATUS_LABEL = { pending: "en cola", working: "generando…", ok: "✓ cargada", error: "✗ error" };

function renderRun(run) {
  $("runSection").classList.toggle("hidden", !run?.items?.length);
  if (!run?.items?.length) return;

  const done = run.items.filter((i) => i.status === "ok").length;
  const failed = run.items.filter((i) => i.status === "error").length;
  const stateLabel = { idle: "listo para empezar", running: "corriendo", paused: "en pausa", done: "terminado" }[run.status] ?? run.status;
  $("runInfo").textContent = `${run.projectTitle} · ${done}/${run.items.length} cargadas${failed ? ` · ${failed} con error` : ""} · ${stateLabel}`;
  $("runError").textContent = run.lastError ?? "";
  $("runError").classList.toggle("hidden", !run.lastError);
  $("startBtn").disabled = run.status === "running";
  $("pauseBtn").disabled = run.status !== "running";
  $("retryBtn").disabled = run.status === "running" || failed === 0;

  const list = $("items");
  list.innerHTML = "";
  for (const item of run.items) {
    const li = document.createElement("li");
    li.className = item.status;
    li.title = item.error ? `${item.prompt}\n\nError: ${item.error}` : item.prompt;
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = String(item.order).padStart(2, "0");
    const p = document.createElement("span");
    p.className = "p";
    p.textContent = item.error ?? item.prompt;
    const s = document.createElement("span");
    s.className = "s";
    s.textContent = STATUS_LABEL[item.status] + (item.status === "working" && item.attempts > 1 ? ` (${item.attempts})` : "");
    li.append(n, p, s);
    list.appendChild(li);
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.run) renderRun(changes.run.newValue);
  if (changes.auth) renderAuth();
});

// --- avanzado -----------------------------------------------------------

$("testBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const tab = await findFlowTab();
    const res = await chrome.tabs.sendMessage(tab.id, { type: "flow:test" });
    $("testInfo").textContent =
      `Cuadro de prompt: ${res.prompt ? "✓" : "✗ no encontrado"} · ` +
      `Botón generar: ${res.button ? `✓ "${res.button}"` : "✗ no encontrado (se usará Enter)"} · ` +
      `Resultados en pantalla: ${res.media}`;
  })
);

$("saveAdvanced").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    await saveSettings({
      selectors: {
        prompt: $("selPrompt").value.trim(),
        submit: $("selSubmit").value.trim(),
        result: $("selResult").value.trim(),
      },
      timeoutSec: Number($("timeoutSec").value) || null,
      delaySec: Number($("delaySec").value) || 0,
    });
    showMsg("Guardado");
  })
);

// --- init ---------------------------------------------------------------

(async () => {
  const settings = await getSettings();
  $("apiUrl").value = settings.apiUrl ?? "";
  $("mediaType").value = settings.mediaType ?? "image";
  $("retries").value = settings.retries ?? 2;
  $("selPrompt").value = settings.selectors?.prompt ?? "";
  $("selSubmit").value = settings.selectors?.submit ?? "";
  $("selResult").value = settings.selectors?.result ?? "";
  $("timeoutSec").value = settings.timeoutSec ?? "";
  $("delaySec").value = settings.delaySec ?? 3;
  $("mediaType").addEventListener("change", () => saveSettings({ mediaType: $("mediaType").value }));
  $("retries").addEventListener("change", () => saveSettings({ retries: Number($("retries").value) || 0 }));

  await renderAuth();
  const { run } = await chrome.storage.local.get(["run"]);
  renderRun(run);
})();
