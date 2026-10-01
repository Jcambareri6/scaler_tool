// Proxy de red de la extension: el content script (que corre dentro de Flow)
// no puede pegarle al backend de Scaler Tool por CORS, y el popup se cierra
// en cuanto el usuario hace clic afuera. El service worker si puede (tiene
// host_permissions), asi que todo pedido al backend -- y la descarga de las
// imagenes de Flow que vienen de otro dominio -- pasa por aca.

async function getStore(keys) {
  return chrome.storage.local.get(keys);
}

function apiBase(settings) {
  return (settings?.apiUrl || "http://localhost:3000").replace(/\/+$/, "");
}

async function refreshSession() {
  const { settings, auth } = await getStore(["settings", "auth"]);
  if (!auth?.refreshToken) return null;
  const res = await fetch(`${apiBase(settings)}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: auth.refreshToken }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const session = data?.session;
  if (!session?.access_token) return null;
  const next = { ...auth, accessToken: session.access_token, refreshToken: session.refresh_token || auth.refreshToken };
  await chrome.storage.local.set({ auth: next });
  return next.accessToken;
}

// fetch al backend con el token guardado; si vence (401) y hay refresh
// token (login con mail/contraseña), lo renueva una vez y reintenta.
async function apiFetch(path, init = {}) {
  const { settings, auth } = await getStore(["settings", "auth"]);
  const doFetch = (token) =>
    fetch(`${apiBase(settings)}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });

  let res = await doFetch(auth?.accessToken);
  if (res.status === 401) {
    const renewed = await refreshSession();
    if (renewed) res = await doFetch(renewed);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sesión vencida: volvé a iniciar sesión en Scaler Tool (la extensión se reconecta sola)");
    const msg = data?.error ?? data?.message ?? `Error ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

function base64ToBlob(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(bin);
}

// Pestañas de la app abiertas desde ANTES de instalar/recargar la extension
// no tienen el puente (los content scripts del manifest solo entran en
// paginas cargadas despues): se inyecta a mano. El puente ignora paginas de
// localhost que no son Scaler Tool.
async function injectBridgeInOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*"] });
  await Promise.all(
    tabs.map((tab) =>
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["app-bridge.js"] }).catch(() => {})
    )
  );
}

chrome.runtime.onInstalled.addListener(() => void injectBridgeInOpenTabs());

// El icono abre el panel lateral (popup.html) en vez de un popup: queda
// abierto al costado de Flow mientras corre la cola.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// --- envio del prompt a Flow (MAIN world) --------------------------------
// Mismo metodo que la extension de referencia (backend/claude/extensionmodelo,
// flow/dom.js + content/relay.js), que esta probado contra este Flow:
//  - corre en el MAIN world de la pagina (executeScript world:"MAIN"), no en
//    el mundo aislado del content script;
//  - vacia la caja seleccionando su contenido con un Range + execCommand
//    ("delete") y escribe con execCommand("insertText"), que dispara los
//    beforeinput/input que espera el editor (ProseMirror);
//  - busca la flecha por la ligature de su mat-icon y prueba primero un
//    el.click() pelado, despues la secuencia pointer*;
//  - el envio se confirma porque Flow VACIA la caja al instante.
// Antes se usaba chrome.debugger (input "real"): Flow pide un token de
// reCAPTCHA al enviar y con el debugger enganchado el envio no salia.
//
// La funcion se serializa para inyectarla: no puede usar nada de afuera.
async function flowSendInPage(prompt) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const st = window.getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && parseFloat(st.opacity) > 0;
  };
  const waitFor = async (fn, timeoutMs = 10000, everyMs = 250) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const v = fn();
        if (v) return v;
      } catch (_) {}
      if (Date.now() >= deadline) return null;
      await sleep(everyMs);
    }
  };
  const findInput = () => {
    for (const sel of ['div[contenteditable="true"]', "textarea", 'input[type="text"]']) {
      const el = [...document.querySelectorAll(sel)].filter(isVis).pop();
      if (el) return el;
    }
    return null;
  };
  const textOf = (el) => (el.isContentEditable ? el.textContent || "" : el.value || "");
  const iconsOf = (el) => [...el.querySelectorAll("mat-icon, i")].map((m) => (m.textContent || "").trim()).filter(Boolean);
  const pointerClick = (el) => {
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    for (const type of ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        const Ev = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ev(type, { ...base, buttons: type.includes("up") || type === "click" ? 0 : 1 }));
      } catch (_) {}
    }
  };

  // 1. La caja (despues de un envio Flow la re-monta: se espera).
  const input = await waitFor(findInput, 10000);
  if (!input) return { ok: false, step: "caja", error: "No se encontró la caja de prompt de Flow" };

  // 2. Foco.
  try { input.click(); } catch (_) {}
  try { input.focus(); } catch (_) {}
  await sleep(250);

  // 3. Vaciar: un resto de texto se concatenaria con el prompt nuevo.
  try {
    if (input.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(input);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("delete");
    } else {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch (_) {}
  await sleep(150);

  // 4. Escribir.
  let typed = false;
  try { typed = document.execCommand("insertText", false, prompt); } catch (_) {}
  if (!typed) {
    try {
      if (input.isContentEditable) input.textContent = prompt;
      else input.value = prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
    } catch (_) {}
  }
  await sleep(300);
  // ProseMirror junta saltos de linea / espacios dobles: se compara sin
  // espacios. Una comparacion exacta cortaba aca, SIN llegar a la flecha.
  const squash = (s) => s.replace(/\s+/g, "");
  const current = textOf(input);
  if (squash(current) !== squash(prompt)) {
    return {
      ok: false,
      step: "escritura",
      error: `El prompt no quedó escrito completo (${squash(current).length} de ${squash(prompt).length} letras)`,
    };
  }

  // 5. Enviar: la flecha "Iniciar generación" (o, si cambia, cualquier boton
  // con la ligature arrow_forward), un camino por vez.
  const submit =
    [...document.querySelectorAll("flow-generate-icon-button button, button.generate-icon-button")].find(
      (b) => isVis(b) && !b.disabled
    ) ||
    [...document.querySelectorAll("button")]
      .filter(isVis)
      .filter((b) => !b.disabled)
      .find((b) => iconsOf(b).some((i) => ["arrow_forward", "send", "arrow_upward"].includes(i)));
  const isEmptied = () => {
    const el = findInput();
    return !el || textOf(el).trim().length === 0;
  };

  let via = null;
  if (submit) {
    // UN camino por vez y verificando: dos clics que salen mandan el prompt
    // dos veces (dos generaciones, dos creditos).
    for (const [name, fn] of [["click", () => submit.click()], ["pointer", () => pointerClick(submit)]]) {
      if (name !== "click" && (!submit.isConnected || submit.disabled || isEmptied())) break;
      try { fn(); } catch (_) {}
      if (await waitFor(isEmptied, 2500, 100)) {
        via = name;
        break;
      }
    }
  } else {
    for (const type of ["keydown", "keypress", "keyup"]) {
      input.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }
  if (!via && (await waitFor(isEmptied, 4000))) via = submit ? "tarde" : "enter";
  if (!via && submit) {
    // Ultimo recurso: Enter en la caja (solo si la flecha no hizo nada).
    try { input.focus(); } catch (_) {}
    for (const type of ["keydown", "keypress", "keyup"]) {
      input.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
    if (await waitFor(isEmptied, 3000)) via = "enter";
  }
  if (!via) {
    return {
      ok: false,
      step: "envio",
      error: `Se escribió el prompt pero Flow no lo tomó (la caja no se vació)${submit ? "" : " -- no encontré la flecha"}`,
    };
  }
  return { ok: true, via };
}

// --- envio con input REAL (chrome.debugger) -------------------------------
// Probado: Flow ignora TODO input sintetico (el.click(), pointer*, Enter
// armado, execCommand) -- escribe el texto pero la flecha no hace nada. A
// mano si anda. Con el protocolo de DevTools el navegador genera eventos de
// mouse/teclado reales (isTrusted), iguales a los del usuario. Mientras dura
// el envio Chrome muestra "Scaler Tool esta depurando este navegador".

const PROMPT_SELECTOR = "flow-rich-text-editor .ProseMirror[contenteditable='true'], div[contenteditable='true']";
const SUBMIT_SELECTOR = "flow-generate-icon-button button, button.generate-icon-button, button[aria-label='Iniciar generación']";

const cdp = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function inPage(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  return res?.result;
}

// Centro del elemento en coordenadas del protocolo: lo calcula Chrome
// (DOM.getContentQuads), asi el clic cae justo sobre el elemento con
// cualquier zoom de la pestaña.
async function centerOfSelector(tabId, selector) {
  const { root } = await cdp(tabId, "DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp(tabId, "DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) return null;
  await cdp(tabId, "DOM.scrollIntoViewIfNeeded", { nodeId }).catch(() => {});
  const { quads } = await cdp(tabId, "DOM.getContentQuads", { nodeId }).catch(() => ({ quads: [] }));
  const q = quads?.[0];
  return q ? { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 } : null;
}

async function realClick(tabId, { x, y }) {
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function realEnter(tabId) {
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "char", key: "Enter", text: "\r" });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

// Funciones que corren EN la pagina (se serializan: no usan nada de afuera).
function pageClearPrompt(selector) {
  const el = [...document.querySelectorAll(selector)].filter((e) => e.getBoundingClientRect().width > 0).pop();
  if (!el) return false;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand("delete");
  return true;
}
function pagePromptText(selector) {
  const el = [...document.querySelectorAll(selector)].filter((e) => e.getBoundingClientRect().width > 0).pop();
  return el ? (el.textContent || "").replace(/\s+/g, "") : null;
}

async function flowSendReal(tabId, prompt) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    // 1. Vaciar (no necesita input real) y clic real en la caja.
    if (!(await inPage(tabId, pageClearPrompt, [PROMPT_SELECTOR]))) {
      return { ok: false, step: "caja", error: "No se encontró la caja de prompt de Flow" };
    }
    const box = await centerOfSelector(tabId, PROMPT_SELECTOR);
    if (!box) return { ok: false, step: "caja", error: "La caja de prompt no está visible" };
    await realClick(tabId, box);
    await pause(200);

    // 2. Escribir con el teclado real.
    await cdp(tabId, "Input.insertText", { text: prompt });
    await pause(500);
    const typed = await inPage(tabId, pagePromptText, [PROMPT_SELECTOR]);
    const want = prompt.replace(/\s+/g, "");
    if (typed !== want) {
      return { ok: false, step: "escritura", error: `El prompt no quedó escrito completo (${typed?.length ?? 0} de ${want.length} letras)` };
    }

    // 3. Clic real en la flecha. El envio se confirma porque Flow vacia la caja.
    const emptied = async (ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        await pause(250);
        const t = await inPage(tabId, pagePromptText, [PROMPT_SELECTOR]).catch(() => null);
        if (t === null || t.length === 0) return true;
      }
      return false;
    };
    const arrow = await centerOfSelector(tabId, SUBMIT_SELECTOR);
    if (arrow) {
      await realClick(tabId, arrow);
      if (await emptied(4000)) return { ok: true, via: "clic real en la flecha" };
    }

    // 4. Plan B: Enter real con el foco en la caja.
    await realClick(tabId, (await centerOfSelector(tabId, PROMPT_SELECTOR)) ?? box);
    await realEnter(tabId);
    if (await emptied(4000)) return { ok: true, via: "Enter real" };

    return {
      ok: false,
      step: "envio",
      error: arrow
        ? "Clic real en la flecha y Enter real, pero Flow no tomó el prompt (la caja no se vació)"
        : "No encontré la flecha de Flow y Enter no alcanzó",
    };
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

const handlers = {
  // Envia un prompt en la pestaña de Flow que lo pide: con input real
  // (flowSendReal); si el debugger no se puede enganchar, con el metodo
  // sintetico de la extension de referencia (flowSendInPage).
  async flowSend({ prompt }, sender) {
    const tabId = sender.tab.id;
    try {
      return await flowSendReal(tabId, prompt);
    } catch (err) {
      const fallback = await inPage(tabId, flowSendInPage, [prompt]);
      if (fallback && !fallback.ok) {
        fallback.error = `${fallback.error} [debugger no disponible: ${err instanceof Error ? err.message : err}]`;
      }
      return fallback ?? { ok: false, step: "inyeccion", error: "La pestaña de Flow no devolvió resultado" };
    }
  },

  // Sesion que manda app-bridge.js desde la pestaña de Scaler Tool. Solo se
  // pisa la guardada si la APP cambio de token (nuevo login): si es el mismo
  // de siempre, la extension puede tener uno mas nuevo renovado por su
  // cuenta, y volver al refresh token viejo de la app lo invalidaria
  // (Supabase rota los refresh tokens).
  async appSession({ apiUrl, appUrl, projectId, authDisabled, accessToken, refreshToken, email }) {
    const { auth, settings, appContext } = await getStore(["auth", "settings", "appContext"]);
    // Proyecto abierto ahora en la app (el panel lo preselecciona). Se
    // actualiza aunque la sesion no haya cambiado.
    if ((appContext?.projectId ?? null) !== (projectId ?? null)) {
      await chrome.storage.local.set({ appContext: { projectId: projectId ?? null, at: Date.now() } });
    }
    if (!accessToken && authDisabled) {
      // Local sin login: se conecta sin token (el backend tiene DISABLE_AUTH).
      if (auth?.source === "app" && auth.authDisabled && settings?.apiUrl === apiUrl) return { connected: true };
      await chrome.storage.local.set({
        settings: { ...(settings ?? {}), apiUrl, appUrl },
        auth: { accessToken: null, refreshToken: null, email: "modo local (sin login)", source: "app", authDisabled: true },
      });
      return { connected: true };
    }
    if (!accessToken) {
      // Cerro sesion en la app: la extension tambien (su unica sesion es la de la app).
      if (auth) await chrome.storage.local.remove(["auth"]);
      return { connected: false };
    }
    if (auth?.source === "app" && auth.appAccessToken === accessToken && settings?.apiUrl === apiUrl) {
      return { connected: true };
    }
    await chrome.storage.local.set({
      settings: { ...(settings ?? {}), apiUrl, appUrl },
      auth: { accessToken, refreshToken: refreshToken || null, email, source: "app", appAccessToken: accessToken },
    });
    return { connected: true };
  },

  async syncFromTabs() {
    await injectBridgeInOpenTabs();
    const tabs = await chrome.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*"] });
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "bridge:resync" }).catch(() => {});
    return { ok: true };
  },

  async api({ method = "GET", path, body }) {
    return apiFetch(path, {
      method,
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
  },

  // Baja una imagen/video que Flow sirve desde otro dominio
  // (googleusercontent / storage.googleapis) y la devuelve en base64.
  async fetchMedia({ url }) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`No se pudo descargar el resultado de Flow (${res.status})`);
    const blob = await res.blob();
    return { base64: await blobToBase64(blob), mime: blob.type || "image/png" };
  },

  // Sube UN archivo a su escena via el endpoint de carga en lote
  // (POST /scripts/:id/scenes/batch-visuals, ver sceneBatch.service.ts).
  async upload({ scriptId, sceneId, fileName, mime, base64 }) {
    const form = new FormData();
    form.append("files", base64ToBlob(base64, mime), fileName);
    form.append("scene_ids", JSON.stringify([sceneId]));
    const data = await apiFetch(`/scripts/${scriptId}/scenes/batch-visuals`, { method: "POST", body: form });
    const result = data?.results?.[0];
    if (!result?.ok) throw new Error(result?.error ?? "El backend no aceptó el archivo");
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg?.type && handlers[msg.type];
  if (!handler) return false;
  handler(msg, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // respuesta asincronica
});
