// Panel de la extension: muestra la conexion con Scaler Tool (que se toma
// sola de la app abierta, ver app-bridge.js -- no hay login propio), arma la
// cola de escenas (prompts) del proyecto elegido y la manda a correr en la
// pestaña de Flow (content.js). Todo el estado vive en chrome.storage.local,
// asi el panel se puede cerrar y volver a abrir sin cortar nada.

const $ = (id) => document.getElementById(id);
// Flow se mudo a flow.google.com (labs.google/fx/tools/flow redirige ahi);
// se acepta tambien la URL vieja por si alguna cuenta todavia la usa.
const FLOW_TAB_PATTERNS = ["https://flow.google.com/*", "https://labs.google/fx/*"];
const DEFAULT_APP_URL = "http://localhost:8443";

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

function showMsg(text, tone = "bad") {
  const el = $("msg");
  el.textContent = text ?? "";
  el.className = `msg ${tone}`;
  el.hidden = !text;
}

async function withBusy(button, fn) {
  button.disabled = true;
  showMsg("");
  try {
    await fn();
  } catch (err) {
    showMsg(err instanceof Error ? err.message : String(err));
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

function setChip(id, tone, title) {
  const chip = $(id);
  chip.className = `chip ${tone}`;
  if (title) chip.title = title;
}

// --- conexion -----------------------------------------------------------

async function renderAuth() {
  const { auth } = await chrome.storage.local.get(["auth"]);
  const logged = !!auth?.accessToken || !!auth?.authDisabled;
  $("who").textContent = logged ? auth.email ?? "conectado" : "";
  setChip("chipApp", logged ? "ok" : "warn", logged ? `Conectado a Scaler Tool (${auth.email ?? "sesión de la app"})` : "Sin sesión de Scaler Tool");
  $("connect").hidden = logged;
  $("setup").hidden = !logged;
  if (logged) await loadProjects();
  const { run } = await chrome.storage.local.get(["run"]);
  $("empty").hidden = !logged || !!run?.items?.length;
}

// Abre la app (o la trae al frente si ya esta abierta) para que el usuario
// inicie sesion: el puente toma la sesion apenas aparece.
$("openAppBtn").addEventListener("click", async () => {
  const { appUrl } = await getSettings();
  const url = appUrl || DEFAULT_APP_URL;
  const [existing] = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    send({ type: "syncFromTabs" }).catch(() => {});
  } else {
    await chrome.tabs.create({ url });
  }
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
    await applyAppContext();
  } catch (err) {
    showMsg(err instanceof Error ? err.message : String(err));
  }
}

// Si el usuario esta parado en un proyecto en Scaler Tool, ese es el
// proyecto: se muestra fijo (con "Elegir otro" para cambiarlo). En el inicio
// u otra pagina, el selector de siempre. "Elegir otro" vale hasta que el
// usuario abra OTRO proyecto en la app.
let manualPickFor = null;

async function applyAppContext() {
  const { appContext } = await chrome.storage.local.get(["appContext"]);
  const select = $("project");
  const detected = appContext?.projectId ?? null;
  const option = detected ? [...select.options].find((o) => o.value === detected) : null;
  const auto = !!option && manualPickFor !== detected;
  if (auto) {
    select.value = detected;
    $("projectAutoName").textContent = option.textContent;
  }
  $("projectAuto").hidden = !auto;
  $("projectPick").hidden = auto;
}

$("projectChange").addEventListener("click", async () => {
  const { appContext } = await chrome.storage.local.get(["appContext"]);
  manualPickFor = appContext?.projectId ?? null;
  await applyAppContext();
  $("project").focus();
});

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
    const withPrompt = selected.filter((p) => p.image_prompt);
    const withoutPrompt = selected.length - withPrompt.length;

    // Cantidad + al azar: se eligen N escenas (las primeras, o al azar entre
    // las que pasan los filtros) y se generan igual en orden de escena.
    const max = Number($("maxScenes").value) || 0;
    const random = $("randomPick").checked;
    let chosen = withPrompt;
    if (max > 0 && max < withPrompt.length) {
      if (random) {
        const pool = [...withPrompt];
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        chosen = pool.slice(0, max).sort((a, b) => a.order - b.order);
      } else {
        chosen = withPrompt.slice(0, max);
      }
    }
    await saveSettings({ maxScenes: max || null, randomPick: random });

    const items = chosen.map((p) => ({
      sceneId: p.scene_id,
      order: p.order,
      prompt: p.image_prompt,
      status: "pending",
      attempts: 0,
      error: null,
    }));

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
      `${items.length} escenas en cola` +
      (items.length < withPrompt.length ? ` (${random ? "al azar" : "las primeras"} de ${withPrompt.length} posibles)` : "") +
      (withoutPrompt ? ` · ${withoutPrompt} sin prompt (no tienen narrativa)` : "");
  })
);

// --- ejecucion en Flow --------------------------------------------------

async function findFlowTab() {
  const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (!tab) throw new Error("Abrí Google Flow (flow.google.com) en una pestaña");
  // Si la pestaña ya estaba abierta antes de instalar la extensión, el
  // content script no esta: se inyecta a mano.
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "flow:ping" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  }
  return tab;
}

async function refreshFlowChip() {
  const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS }).catch(() => []);
  setChip("chipFlow", tabs.length ? "ok" : "warn", tabs.length ? "Pestaña de Google Flow abierta" : "Abrí Google Flow en una pestaña");
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
    const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
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

// Cancelar: a diferencia de Pausar, frena y DESCARTA la cola. Lo ya cargado
// en las escenas queda; lo que estaba generandose en Flow en ese momento
// puede terminar ahi, pero ya no se sube.
$("cancelBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const { run } = await chrome.storage.local.get(["run"]);
    if (!run) return;
    const left = run.items.filter((i) => i.status === "pending" || i.status === "working").length;
    if (!confirm(`¿Cancelar la corrida? Se descartan ${left} escenas pendientes. Las que ya se cargaron quedan en Scaler Tool.`)) return;
    const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "flow:pause" }).catch(() => {});
    await chrome.storage.local.remove(["run"]);
    $("loadInfo").textContent = "";
    showMsg("Corrida cancelada", "ok");
  })
);

// --- render de la corrida -----------------------------------------------

const STATUS_LABEL = { pending: "En cola", working: "Generando", ok: "✓ Cargada", error: "✗ Error" };
const RUN_LABEL = {
  idle: ["Lista para empezar", ""],
  running: ["Corriendo", "accent"],
  paused: ["En pausa", "warn"],
  done: ["Terminada", "ok"],
};
let filter = "all";
// Prompts desplegados (por escena): sobrevive a los re-render del progreso.
const openPrompts = new Set();

document.querySelectorAll("#viewFilter button").forEach((btn) =>
  btn.addEventListener("click", async () => {
    filter = btn.dataset.filter;
    document.querySelectorAll("#viewFilter button").forEach((b) => b.classList.toggle("on", b === btn));
    const { run } = await chrome.storage.local.get(["run"]);
    renderRun(run);
  })
);

function itemCard(item) {
  const card = document.createElement("div");
  card.className = `item ${item.status}`;

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (item.thumb) {
    const img = document.createElement("img");
    img.src = item.thumb;
    img.alt = "";
    img.onerror = () => img.remove();
    thumb.textContent = String(item.order).padStart(2, "0");
    thumb.appendChild(img);
  } else if (item.status === "working") {
    const spin = document.createElement("span");
    spin.className = "spin";
    thumb.appendChild(spin);
  } else {
    thumb.textContent = String(item.order).padStart(2, "0");
  }

  const body = document.createElement("div");
  body.className = "item-body";

  const head = document.createElement("div");
  head.className = "item-head";
  const title = document.createElement("span");
  title.className = "item-title";
  title.textContent = `Escena ${item.order}`;
  const status = document.createElement("span");
  status.className = `item-status ${item.status}`;
  status.textContent = STATUS_LABEL[item.status] ?? item.status;
  head.append(title, status);
  body.appendChild(head);

  if (item.status === "working" && item.step) {
    const step = document.createElement("div");
    step.className = "item-step";
    step.textContent = `${item.step}${item.attempts > 1 ? ` · intento ${item.attempts}` : ""}`;
    body.appendChild(step);
  }

  const prompt = document.createElement("p");
  prompt.className = `item-prompt${openPrompts.has(item.sceneId) ? " open" : ""}`;
  prompt.textContent = item.prompt;
  prompt.title = "Clic para ver el prompt completo";
  prompt.addEventListener("click", () => {
    if (openPrompts.has(item.sceneId)) openPrompts.delete(item.sceneId);
    else openPrompts.add(item.sceneId);
    prompt.classList.toggle("open");
  });
  body.appendChild(prompt);

  if (item.error) {
    const error = document.createElement("p");
    error.className = "item-error";
    error.textContent = item.error;
    body.appendChild(error);
  }

  card.append(thumb, body);
  return card;
}

function renderRun(run) {
  const hasRun = !!run?.items?.length;
  $("runSection").hidden = !hasRun;
  if (!$("setup").hidden) $("empty").hidden = hasRun;
  if (!hasRun) return;

  const total = run.items.length;
  const done = run.items.filter((i) => i.status === "ok").length;
  const failed = run.items.filter((i) => i.status === "error").length;
  const pending = run.items.filter((i) => i.status === "pending" || i.status === "working").length;
  const [label, tone] = RUN_LABEL[run.status] ?? [run.status, ""];

  $("runTitle").textContent = run.projectTitle || "Corrida";
  $("runInfo").textContent = `${done}/${total} cargadas · ${pending} pendientes${failed ? ` · ${failed} con error` : ""}`;
  $("runStatus").textContent = label;
  $("runStatus").className = `badge ${tone}`;
  $("progDone").style.width = `${(done / total) * 100}%`;
  $("progFailed").style.width = `${((done + failed) / total) * 100}%`;
  $("runError").textContent = run.lastError ?? "";
  $("runError").hidden = !run.lastError;
  $("startBtn").disabled = run.status === "running";
  $("startBtn").textContent = run.status === "paused" ? "▶ Seguir" : "▶ Empezar";
  $("pauseBtn").disabled = run.status !== "running";
  $("retryBtn").disabled = run.status === "running" || failed === 0;

  const visible = run.items.filter((i) =>
    filter === "pending" ? i.status === "pending" || i.status === "working" : filter === "error" ? i.status === "error" : true
  );
  const list = $("items");
  list.innerHTML = "";
  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "items-empty";
    empty.textContent = filter === "error" ? "No hay escenas con error" : "No hay escenas pendientes";
    list.appendChild(empty);
    return;
  }
  for (const item of visible) list.appendChild(itemCard(item));
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.run) renderRun(changes.run.newValue);
  if (changes.auth) renderAuth();
  if (changes.appContext) {
    // Abrir otro proyecto en la app cancela el "Elegir otro" anterior.
    if (changes.appContext.newValue?.projectId !== manualPickFor) manualPickFor = null;
    applyAppContext();
  }
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

$("testSubmitBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    const tab = await findFlowTab();
    $("testInfo").textContent = "Enviando un prompt de prueba (manzana roja)...";
    const r = await chrome.tabs.sendMessage(tab.id, { type: "flow:testSubmit" });
    $("testInfo").textContent = r.ok
      ? `✓ Enviado (vía ${r.via}): tiene que aparecer una manzana roja generándose en Flow`
      : `✗ Falló en el paso "${r.step ?? "?"}": ${r.error}`;
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
    showMsg("Guardado", "ok");
  })
);

// --- init ---------------------------------------------------------------

(async () => {
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  const settings = await getSettings();
  $("mediaType").value = settings.mediaType ?? "image";
  $("retries").value = settings.retries ?? 2;
  $("maxScenes").value = settings.maxScenes ?? "";
  $("randomPick").checked = !!settings.randomPick;
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

  // El panel lateral queda abierto: el chip de Flow se mantiene al dia.
  refreshFlowChip();
  chrome.tabs.onUpdated.addListener(() => void refreshFlowChip());
  chrome.tabs.onRemoved.addListener(() => void refreshFlowChip());

  // Sin sesion: busca una pestaña de Scaler Tool ya abierta y toma su sesion
  // (llega via storage.onChanged -> renderAuth).
  const { auth } = await chrome.storage.local.get(["auth"]);
  if (!auth?.accessToken && !auth?.authDisabled) send({ type: "syncFromTabs" }).catch(() => {});
})();
