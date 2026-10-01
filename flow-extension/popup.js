// Panel de la extension: muestra la conexion con Scaler Tool (que se toma
// sola de la app abierta, ver app-bridge.js -- no hay login propio), arma la
// cola de escenas (prompts) del proyecto elegido y la manda a correr en la
// pestaña de Flow (content.js). Todo el estado vive en chrome.storage.local,
// asi el panel se puede cerrar y volver a abrir sin cortar nada.

const $ = (id) => document.getElementById(id);
// Flow se mudo a flow.google.com (labs.google/fx/tools/flow redirige ahi);
// se acepta tambien la URL vieja por si alguna cuenta todavia la usa.
const FLOW_TAB_PATTERNS = ["https://flow.google.com/*", "https://labs.google/fx/*"];

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
  $("refsBox").hidden = !logged;
  if (!logged) await updateConnectUI();
  if (logged) await loadProjects();
  const { run } = await chrome.storage.local.get(["run"]);
  $("empty").hidden = !logged || !!run?.items?.length;
}

// Abre la app (o la trae al frente si ya esta abierta) para que el usuario
// inicie sesion: el puente toma la sesion apenas aparece. Solo se ofrece si
// ya se sabe donde esta la app (nunca se adivina una URL).
$("openAppBtn").addEventListener("click", async () => {
  const { appUrl } = await getSettings();
  if (!appUrl) return;
  const [existing] = await chrome.tabs.query({ url: `${new URL(appUrl).origin}/*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    send({ type: "syncFromTabs" }).catch(() => {});
  } else {
    await chrome.tabs.create({ url: appUrl });
  }
});

// Pestaña activa candidata a ser Scaler Tool: cualquier pagina web que no
// sea Flow. La extension no conoce de antemano el dominio de produccion: el
// usuario la conecta una vez estando en la pestaña de Scaler Tool.
async function activeAppCandidate() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return null;
  const url = new URL(tab.url);
  if (/(^|\.)flow\.google\.com$|(^|\.)labs\.google$/.test(url.hostname)) return null;
  return { tab, origin: url.origin, host: url.host };
}

async function updateConnectUI() {
  const { auth } = await chrome.storage.local.get(["auth"]);
  if (auth?.accessToken || auth?.authDisabled) return;
  const { appUrl } = await getSettings();
  const candidate = await activeAppCandidate();
  $("openAppBtn").hidden = !appUrl;
  $("connectTabBtn").hidden = !candidate;
  if (candidate) $("connectTabBtn").textContent = `Conectar con ${candidate.host}`;
  $("connectText").textContent = candidate
    ? `Si esta pestaña es Scaler Tool y ya iniciaste sesión, tocá “Conectar con ${candidate.host}”. Se hace una sola vez: después se conecta sola.`
    : "Abrí Scaler Tool en esta ventana, iniciá sesión y volvé a este panel para conectarla.";
}

// Segundo paso (solo si el backend esta en otro dominio que la app): el
// permiso para el backend. Chrome exige un clic propio para pedirlo.
let pendingApiOrigin = null;

$("connectTabBtn").addEventListener("click", (e) =>
  withBusy(e.currentTarget, async () => {
    if (pendingApiOrigin) {
      const ok = await chrome.permissions.request({ origins: [`${pendingApiOrigin}/*`] });
      if (!ok) throw new Error("Sin ese permiso la extensión no puede hablar con el servidor de Scaler Tool");
      pendingApiOrigin = null;
    }
    const candidate = await activeAppCandidate();
    if (!candidate) throw new Error("Pasá a la pestaña de Scaler Tool y volvé a tocar Conectar");
    // Permiso para ESE dominio (lo pide Chrome, una sola vez). Si ya esta,
    // no se vuelve a pedir: Chrome solo deja pedir permisos dentro del clic,
    // y en el segundo paso el clic ya se uso para el del servidor.
    const appPattern = { origins: [`${candidate.origin}/*`] };
    const granted = (await chrome.permissions.contains(appPattern)) || (await chrome.permissions.request(appPattern));
    if (!granted) throw new Error("Sin ese permiso la extensión no puede leer tu sesión de Scaler Tool");
    const res = await send({ type: "registerApp", origin: candidate.origin, tabId: candidate.tab.id });
    if (res?.needsApi) {
      pendingApiOrigin = res.needsApi;
      const host = new URL(res.needsApi).host;
      showMsg(`Falta un paso: tocá de nuevo el botón para permitir la conexión con el servidor (${host}).`, "ok");
      setTimeout(() => ($("connectTabBtn").textContent = `Permitir servidor ${host}`), 0);
      return;
    }
    if (!res?.isApp) {
      throw new Error(
        res?.loggedOut
          ? "Es Scaler Tool pero no hay una sesión iniciada: iniciá sesión y volvé a tocar Conectar"
          : "Esa pestaña no parece ser Scaler Tool (o la app todavía no está actualizada): recargala con F5 y reintentá"
      );
    }
  })
);

// --- personajes y referencias ------------------------------------------
// Cada referencia: { id, names: "María, la abuela", dataUrl, flowName }.
// flowName es el nombre con el que se sube a Flow (sale del contenido de la
// imagen): con el, la extension la encuentra en la biblioteca del proyecto
// de Flow y no la vuelve a subir.

const MAX_REFS_PER_SCENE = 3; // limite de ingredientes de Flow
const REF_MAX_SIDE = 1536;

async function getRefs() {
  const { refs } = await chrome.storage.local.get(["refs"]);
  return refs ?? [];
}

// Achica la imagen (las referencias viajan en cada escena que las usa y se
// guardan en chrome.storage) y la devuelve como JPEG.
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, REF_MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`No se pudo leer la imagen ${file.name}`));
    };
    img.src = url;
  });
}

async function shortHash(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "ref";

$("refFile").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  try {
    const refs = await getRefs();
    for (const file of files) {
      const dataUrl = await shrinkImage(file);
      const stem = file.name.replace(/\.[^.]+$/, "");
      const hash = await shortHash(dataUrl);
      if (refs.some((r) => r.flowName.includes(hash))) continue; // misma imagen ya cargada
      refs.push({
        id: `${Date.now().toString(36)}-${hash}`,
        names: stem.replace(/[-_]+/g, " ").trim(),
        dataUrl,
        flowName: `scaler-ref-${slugify(stem)}-${hash}.jpg`,
      });
    }
    await chrome.storage.local.set({ refs });
    showMsg(files.length ? "Imagen agregada: revisá el nombre y volvé a cargar los prompts" : "", "ok");
  } catch (err) {
    showMsg(err instanceof Error ? err.message : String(err));
  }
});

async function renderRefs() {
  const refs = await getRefs();
  $("refsCount").textContent = refs.length ? `${refs.length}` : "";
  const list = $("refsList");
  list.innerHTML = "";
  for (const ref of refs) {
    const row = document.createElement("div");
    row.className = "ref-row";

    const img = document.createElement("img");
    img.src = ref.dataUrl;
    img.alt = ref.names;

    const meta = document.createElement("div");
    meta.className = "ref-meta";
    const input = document.createElement("input");
    input.value = ref.names;
    input.placeholder = "Nombre (ej: María, la abuela)";
    input.addEventListener("change", async () => {
      const all = await getRefs();
      const target = all.find((r) => r.id === ref.id);
      if (target) target.names = input.value.trim();
      await chrome.storage.local.set({ refs: all });
    });
    const file = document.createElement("span");
    file.className = "ref-file";
    file.textContent = ref.flowName;
    file.title = "Nombre con el que se sube a Flow";
    meta.append(input, file);

    const actions = document.createElement("div");
    actions.className = "ref-actions";
    // Plan B si Flow no acepta la subida automatica: bajarla con su nombre
    // y arrastrarla a mano al proyecto de Flow.
    const download = document.createElement("a");
    download.href = ref.dataUrl;
    download.download = ref.flowName;
    download.textContent = "Bajar";
    download.title = "Bajarla con el nombre para Flow, por si hay que subirla a mano";
    const remove = document.createElement("button");
    remove.className = "danger sm";
    remove.textContent = "Quitar";
    remove.addEventListener("click", async () => {
      const all = await getRefs();
      await chrome.storage.local.set({ refs: all.filter((r) => r.id !== ref.id) });
    });
    actions.append(download, remove);

    row.append(img, meta, actions);
    list.appendChild(row);
  }
}

// Texto comparable: minusculas y sin acentos ("María" == "maria").
const plain = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Referencias que nombra el texto de una escena, en el orden en que estan
// cargadas, hasta el limite de Flow. Palabra completa: "Ana" no matchea "banana".
function refsForScene(refs, text) {
  const haystack = plain(text);
  return refs
    .filter((ref) =>
      ref.names
        .split(",")
        .map((n) => plain(n).trim())
        .filter(Boolean)
        .some((name) => new RegExp(`(^|[^a-z0-9])${escapeRe(name)}($|[^a-z0-9])`).test(haystack))
    )
    .slice(0, MAX_REFS_PER_SCENE)
    .map((ref) => ref.id);
}

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

    const refs = await getRefs();
    const items = chosen.map((p) => ({
      sceneId: p.scene_id,
      order: p.order,
      prompt: p.image_prompt,
      // Personajes que nombra la narracion (o el prompt) de la escena.
      refIds: refsForScene(refs, `${p.text ?? ""} ${p.image_prompt ?? ""}`),
      status: "pending",
      attempts: 0,
      error: null,
    }));
    const withRefs = items.filter((i) => i.refIds.length).length;

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
      (refs.length ? ` · ${withRefs} con personajes` : "") +
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

let refsCache = [];

async function toggleSceneRef(sceneId, refId) {
  const { run } = await chrome.storage.local.get(["run"]);
  const item = run?.items.find((i) => i.sceneId === sceneId);
  if (!item) return;
  const current = item.refIds ?? [];
  if (current.includes(refId)) {
    item.refIds = current.filter((id) => id !== refId);
  } else {
    if (current.length >= MAX_REFS_PER_SCENE) {
      showMsg(`Flow acepta hasta ${MAX_REFS_PER_SCENE} referencias por escena`);
      return;
    }
    item.refIds = [...current, refId];
  }
  await chrome.storage.local.set({ run });
}

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

  // Personajes de la escena: los detectados por nombre vienen marcados; se
  // pueden marcar/desmarcar a mano mientras la escena no se genero.
  if (refsCache.length) {
    const tags = document.createElement("div");
    tags.className = "item-refs";
    const editable = item.status === "pending" || item.status === "error";
    const selected = item.refIds ?? [];
    for (const ref of refsCache) {
      const on = selected.includes(ref.id);
      if (!on && !editable) continue;
      const tag = document.createElement("button");
      tag.type = "button";
      tag.className = `ref-tag${on ? " on" : ""}`;
      tag.disabled = !editable;
      tag.title = editable ? (on ? "Sacar de esta escena" : "Usar en esta escena") : "";
      const face = document.createElement("img");
      face.src = ref.dataUrl;
      face.alt = "";
      tag.append(face, document.createTextNode(ref.names.split(",")[0].trim() || "sin nombre"));
      tag.addEventListener("click", () => toggleSceneRef(item.sceneId, ref.id));
      tags.appendChild(tag);
    }
    if (tags.childElementCount) body.appendChild(tags);
  }

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
  if (changes.refs) {
    refsCache = changes.refs.newValue ?? [];
    renderRefs();
    chrome.storage.local.get(["run"]).then(({ run }) => renderRun(run));
  }
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

  refsCache = await getRefs();
  await renderRefs();
  await renderAuth();
  const { run } = await chrome.storage.local.get(["run"]);
  renderRun(run);

  // El panel lateral queda abierto: el chip de Flow se mantiene al dia.
  refreshFlowChip();
  chrome.tabs.onUpdated.addListener(() => void refreshFlowChip());
  chrome.tabs.onRemoved.addListener(() => void refreshFlowChip());
  // Sin sesion, el boton "Conectar con <dominio>" sigue a la pestaña activa.
  chrome.tabs.onActivated.addListener(() => void updateConnectUI());
  chrome.tabs.onUpdated.addListener((_id, info) => info.url && void updateConnectUI());

  // Sin sesion: busca una pestaña de Scaler Tool ya abierta y toma su sesion
  // (llega via storage.onChanged -> renderAuth).
  const { auth } = await chrome.storage.local.get(["auth"]);
  if (!auth?.accessToken && !auth?.authDisabled) send({ type: "syncFromTabs" }).catch(() => {});
})();
