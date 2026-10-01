// Corre DENTRO de la pestaña de Google Flow. Recorre la cola de escenas
// guardada en chrome.storage (la arma el popup): por cada una escribe el
// prompt en Flow, aprieta generar, espera el resultado nuevo, lo descarga y
// lo manda (via background.js) a su escena de Scaler Tool. Vive aca y no
// en el service worker porque una generacion tarda minutos y el worker de
// MV3 se duerme a los ~30s sin eventos; la pestaña de Flow, en cambio,
// sigue viva todo el proceso.
//
// LO FRAGIL: Flow no tiene API, asi que todo depende de como esta armada
// su pagina. Si Google la cambia, se ajustan los selectores desde el popup
// ("Avanzado") sin tocar este codigo.

(() => {
  if (window.__scalerFlowBridge) return;
  window.__scalerFlowBridge = true;

  const DEFAULT_SELECTORS = {
    // id que usa hoy el cuadro de prompt de Flow; si no esta, se busca el
    // textarea / contenteditable visible mas grande.
    prompt: "#PINHOLE_TEXT_AREA_ELEMENT_ID",
    submit: "",
    result: "",
  };
  const SUBMIT_TEXT = /arrow_forward|send|create|generate|crear|generar|enviar/i;
  const ERROR_TEXT =
    /(couldn'?t|could not|failed|unable|something went wrong|try again|policy|no se pudo|fall[oó]|error|inténtalo|intentá|pol[ií]tica)/i;
  const MIN_MEDIA_SIZE = 200; // px -- descarta iconos, avatares, miniaturas

  let stopRequested = false;
  let running = false;

  // Un campo vacio en "Avanzado" significa "automatico", no pisa el default.
  function mergeSelectors(settings) {
    const custom = Object.fromEntries(
      Object.entries(settings.selectors ?? {}).filter(([, v]) => typeof v === "string" && v.trim())
    );
    return { ...DEFAULT_SELECTORS, ...custom };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function send(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error ?? "Error de la extensión"));
        resolve(res.result);
      });
    });
  }

  async function getState() {
    return chrome.storage.local.get(["run", "settings"]);
  }

  async function patchRun(mutator) {
    const { run } = await chrome.storage.local.get(["run"]);
    if (!run) return null;
    mutator(run);
    run.updatedAt = Date.now();
    await chrome.storage.local.set({ run });
    return run;
  }

  async function patchItem(sceneId, fields) {
    return patchRun((run) => {
      const item = run.items.find((i) => i.sceneId === sceneId);
      if (item) Object.assign(item, fields);
    });
  }

  // --- DOM de Flow -------------------------------------------------------

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function findPromptBox(selectors) {
    const custom = selectors.prompt && document.querySelector(selectors.prompt);
    if (custom && isVisible(custom)) return custom;
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(isVisible);
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return candidates[0] ?? null;
  }

  // React no se entera de un `el.value = x` comun: hay que usar el setter
  // nativo y disparar "input" para que actualice su estado.
  function setPromptText(el, text) {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text);
    }
  }

  function buttonLabel(btn) {
    return `${btn.getAttribute("aria-label") ?? ""} ${btn.title ?? ""} ${btn.textContent ?? ""}`.trim();
  }

  // El boton de generar esta "cerca" del cuadro de prompt: se sube por los
  // ancestros buscando un boton habilitado cuyo texto/icono matchee.
  function findSubmitButton(selectors, promptBox) {
    if (selectors.submit) {
      const custom = document.querySelector(selectors.submit);
      if (custom) return custom;
    }
    let scope = promptBox;
    for (let depth = 0; depth < 6 && scope; depth++) {
      scope = scope.parentElement;
      if (!scope) break;
      const buttons = [...scope.querySelectorAll("button")].filter((b) => isVisible(b) && !b.disabled);
      const match = buttons.find((b) => SUBMIT_TEXT.test(buttonLabel(b)));
      if (match) return match;
    }
    return null;
  }

  function mediaSelector(settings) {
    if (settings.selectors?.result) return settings.selectors.result;
    return settings.mediaType === "video" ? "video" : "img";
  }

  function mediaSrc(el) {
    if (el instanceof HTMLVideoElement) return el.currentSrc || el.src || el.querySelector("source")?.src || "";
    return el.currentSrc || el.src || "";
  }

  function isResultMedia(el) {
    const src = mediaSrc(el);
    if (!src || src.startsWith("data:image/svg")) return false;
    if (el instanceof HTMLImageElement) {
      if (!el.complete || el.naturalWidth < MIN_MEDIA_SIZE || el.naturalHeight < MIN_MEDIA_SIZE) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 60 && r.height >= 40;
  }

  function currentMediaSrcs(settings) {
    return new Set([...document.querySelectorAll(mediaSelector(settings))].map(mediaSrc).filter(Boolean));
  }

  function visibleErrorText() {
    const nodes = document.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]');
    for (const node of nodes) {
      const text = (node.textContent ?? "").trim();
      if (text && ERROR_TEXT.test(text) && isVisible(node)) return text.slice(0, 160);
    }
    return null;
  }

  // Espera a que aparezca un resultado nuevo (src que no estaba antes de
  // apretar generar). Flow suele devolver varias variantes: se espera a que
  // la cantidad se estabilice un momento y se toma la primera.
  async function waitForNewMedia(settings, before, alreadyUsed, timeoutMs) {
    const started = Date.now();
    const errorsBefore = visibleErrorText();
    let found = [];
    let stableSince = 0;
    while (Date.now() - started < timeoutMs) {
      if (stopRequested) throw new Error("Detenido");
      await sleep(2000);

      const err = visibleErrorText();
      if (err && err !== errorsBefore) throw new Error(`Flow: ${err}`);

      const fresh = [...document.querySelectorAll(mediaSelector(settings))].filter((el) => {
        const src = mediaSrc(el);
        return src && !before.has(src) && !alreadyUsed.has(src) && isResultMedia(el);
      });
      if (fresh.length === 0) continue;
      if (fresh.length !== found.length) {
        found = fresh;
        stableSince = Date.now();
        continue;
      }
      if (Date.now() - stableSince >= 4000) return mediaSrc(found[0]);
    }
    if (found.length > 0) return mediaSrc(found[0]);
    throw new Error("Flow no devolvió ningún resultado a tiempo");
  }

  async function downloadMedia(src) {
    // blob:/data: y mismo dominio se pueden leer desde aca; lo de otros
    // dominios lo baja background.js (sin CORS).
    if (src.startsWith("blob:") || src.startsWith("data:") || src.startsWith(location.origin)) {
      const blob = await (await fetch(src)).blob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { base64: btoa(bin), mime: blob.type || "image/png" };
    }
    return send({ type: "fetchMedia", url: src });
  }

  function extensionFor(mime, mediaType) {
    if (mime.includes("jpeg")) return "jpg";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("png")) return "png";
    if (mime.includes("mp4")) return "mp4";
    if (mime.includes("webm")) return "webm";
    return mediaType === "video" ? "mp4" : "png";
  }

  async function generateOne(item, settings, alreadyUsed) {
    const selectors = mergeSelectors(settings);
    const promptBox = findPromptBox(selectors);
    if (!promptBox) throw new Error("No encontré el cuadro de prompt de Flow (revisá Avanzado → selectores)");

    const before = currentMediaSrcs(settings);
    setPromptText(promptBox, item.prompt);
    await sleep(600);

    const button = findSubmitButton(selectors, promptBox);
    if (button) {
      button.click();
    } else {
      // Ultimo recurso: Enter en el cuadro de prompt.
      promptBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    }

    const timeoutMs = (Number(settings.timeoutSec) || (settings.mediaType === "video" ? 600 : 240)) * 1000;
    const src = await waitForNewMedia(settings, before, alreadyUsed, timeoutMs);
    alreadyUsed.add(src);

    const media = await downloadMedia(src);
    const fileName = `escena_${String(item.order).padStart(2, "0")}.${extensionFor(media.mime, settings.mediaType)}`;
    return { ...media, fileName };
  }

  async function runQueue() {
    if (running) return;
    running = true;
    stopRequested = false;
    const alreadyUsed = new Set();
    try {
      await patchRun((run) => {
        run.status = "running";
        run.lastError = null;
      });

      while (!stopRequested) {
        const { run, settings } = await getState();
        if (!run || run.status !== "running") break;
        const item = run.items.find((i) => i.status === "pending");
        if (!item) break;

        const retries = Math.max(0, Number(settings?.retries ?? 2));
        await patchItem(item.sceneId, { status: "working", error: null });
        let lastError = null;

        for (let attempt = 1; attempt <= retries + 1 && !stopRequested; attempt++) {
          await patchItem(item.sceneId, { attempts: attempt });
          try {
            const media = await generateOne(item, settings ?? {}, alreadyUsed);
            await send({
              type: "upload",
              scriptId: run.scriptId,
              sceneId: item.sceneId,
              fileName: media.fileName,
              mime: media.mime,
              base64: media.base64,
            });
            lastError = null;
            break;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            if (/Sesión vencida/.test(lastError)) break; // reintentar no lo arregla
            await sleep(3000);
          }
        }

        if (stopRequested) {
          await patchItem(item.sceneId, { status: "pending" });
          break;
        }
        await patchItem(item.sceneId, lastError ? { status: "error", error: lastError } : { status: "ok", error: null });
        if (lastError && /Sesión vencida/.test(lastError)) {
          await patchRun((r) => {
            r.status = "paused";
            r.lastError = lastError;
          });
          return;
        }
        // Respiro entre escenas para no saturar Flow.
        await sleep(Math.max(0, Number(settings?.delaySec ?? 3)) * 1000);
      }

      await patchRun((run) => {
        if (stopRequested) {
          run.status = "paused";
        } else if (run.status === "running") {
          run.status = "done";
        }
      });
    } catch (err) {
      await patchRun((run) => {
        run.status = "paused";
        run.lastError = err instanceof Error ? err.message : String(err);
      });
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "flow:start") {
      runQueue();
      sendResponse({ ok: true });
    } else if (msg?.type === "flow:pause") {
      stopRequested = true;
      sendResponse({ ok: true });
    } else if (msg?.type === "flow:ping") {
      sendResponse({ ok: true, running });
    } else if (msg?.type === "flow:test") {
      // Diagnostico desde el popup: ¿encuentro el prompt y el boton?
      chrome.storage.local.get(["settings"]).then(({ settings }) => {
        const selectors = mergeSelectors(settings ?? {});
        const prompt = findPromptBox(selectors);
        const button = prompt ? findSubmitButton(selectors, prompt) : null;
        sendResponse({
          ok: true,
          prompt: !!prompt,
          button: button ? buttonLabel(button).slice(0, 40) || "(sin texto)" : null,
          media: currentMediaSrcs(settings ?? {}).size,
        });
      });
      return true;
    }
    return false;
  });

  // Si la pestaña se recargo a mitad de una corrida, la escena que quedo
  // "working" vuelve a pendiente (no se sabe si llego a subirse).
  chrome.storage.local.get(["run"]).then(({ run }) => {
    if (run?.status === "running") {
      for (const item of run.items) if (item.status === "working") item.status = "pending";
      run.status = "paused";
      chrome.storage.local.set({ run });
    }
  });
})();
