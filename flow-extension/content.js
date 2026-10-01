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

  // DOM real de Flow (flow.google.com, Angular): el prompt es un editor
  // ProseMirror y el boton de generar es la flecha "Iniciar generación".
  // Si no estan, se cae a la busqueda generica de mas abajo.
  const DEFAULT_SELECTORS = {
    prompt: "flow-rich-text-editor .ProseMirror[contenteditable='true'], .ProseMirror[contenteditable='true']",
    submit:
      "flow-generate-icon-button button[type='submit'], button.generate-icon-button, button[aria-label='Iniciar generación']",
    result: "",
  };
  // Solo palabras que inequivocamente son "mandar": "crear"/"create" quedo
  // afuera porque en Flow en español el boton "+" (agregar) matcheaba y se
  // clickeaba ese en vez de la flecha.
  const SUBMIT_TEXT = /arrow_forward|arrow_upward|send|enviar|submit|generar|generate/i;
  const NOT_SUBMIT_TEXT = /close|cerrar|clear|borrar|add|agregar|añadir|crear|create|agente|agent|model|modelo/i;
  const ERROR_TEXT =
    /(couldn'?t|could not|failed|unable|something went wrong|try again|policy|no se pudo|fall[oó]|error|inténtalo|intentá|pol[ií]tica)/i;
  const MIN_MEDIA_SIZE = 200; // px -- descarta iconos, avatares, miniaturas
  const TEST_PROMPT = "A red apple on a white table, soft daylight";

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
    const custom = selectors.prompt && [...document.querySelectorAll(selectors.prompt)].find(isVisible);
    if (custom) return custom;
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

  function promptText(el) {
    return (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : el.textContent) ?? "";
  }

  // A donde apuntar el clic real: si el elemento es el que devuelve el
  // selector, se manda el selector y Chrome calcula la posicion exacta (ver
  // centerOfSelector en background.js); si salio de la busqueda generica,
  // van las coordenadas.
  function targetOf(selector, el, point) {
    return selector && document.querySelector(selector) === el ? { selector } : point;
  }

  // Centro del elemento en px del viewport (lo que espera el clic real).
  function centerOf(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function buttonLabel(btn) {
    return `${btn.getAttribute("aria-label") ?? ""} ${btn.title ?? ""} ${btn.textContent ?? ""}`.trim();
  }

  function isEnabled(btn) {
    return !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
  }

  // El boton de generar vive en el mismo "cuadro" que el prompt. Se sube por
  // los ancestros hasta el primero que tiene varios botones (el compositor:
  // +, Agente, modelo, flecha) y ahi: primero uno con etiqueta de "mandar";
  // si no hay (la flecha de Flow es solo un icono), el de mas abajo a la
  // derecha -- en Flow es siempre la flecha →.
  function findSubmitButton(selectors, promptBox) {
    if (selectors.submit) {
      const custom = [...document.querySelectorAll(selectors.submit)].find(isVisible);
      if (custom) return custom;
    }
    let scope = promptBox;
    for (let depth = 0; depth < 8 && scope; depth++) {
      scope = scope.parentElement;
      if (!scope) break;
      const buttons = [...scope.querySelectorAll('button, [role="button"]')].filter(
        (b) => isVisible(b) && !b.contains(promptBox)
      );
      if (buttons.length < 2) continue;
      const labeled = buttons.find((b) => SUBMIT_TEXT.test(buttonLabel(b)));
      if (labeled) return labeled;
      const candidates = buttons.filter((b) => !NOT_SUBMIT_TEXT.test(buttonLabel(b)));
      if (candidates.length === 0) continue;
      return candidates.reduce((best, b) => {
        const rb = b.getBoundingClientRect();
        const rBest = best.getBoundingClientRect();
        return rb.right + rb.bottom > rBest.right + rBest.bottom ? b : best;
      });
    }
    return null;
  }

  // Click "de verdad": algunos componentes reaccionan a pointerdown/mousedown
  // y no solo a click.
  function realClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
  }

  function pressEnter(el) {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
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
    const before = currentMediaSrcs(settings);
    // Paso actual, visible en el popup -- para saber donde se traba.
    const step = (text) => {
      console.log(`[Scaler→Flow] escena ${item.order}: ${text}`);
      return patchItem(item.sceneId, { step: text });
    };
    await step("escribiendo y enviando el prompt");

    // Escribir + enviar corre en el MAIN world de la pagina (background.js ->
    // flowSendInPage), con el metodo de la extension de referencia. Solo
    // vuelve ok si Flow vacio la caja, o sea si de verdad tomo el prompt.
    const sent = await send({ type: "flowSend", prompt: item.prompt });
    if (!sent?.ok) throw new Error(sent?.error ?? "No se pudo enviar el prompt a Flow");

    await step("enviado, esperando el resultado de Flow");
    const timeoutMs = (Number(settings.timeoutSec) || (settings.mediaType === "video" ? 600 : 240)) * 1000;
    const src = await waitForNewMedia(settings, before, alreadyUsed, timeoutMs);
    alreadyUsed.add(src);
    // Miniatura para la tarjeta de la escena en el panel. Solo URLs http(s):
    // un blob:/data: de esta pagina no se puede mostrar desde la extension.
    if (/^https?:/.test(src)) await patchItem(item.sceneId, { thumb: src });

    await step("descargando y subiendo a la escena");
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
            // Si cancelaron (o pausaron) mientras Flow generaba, no se sube.
            const { run: still } = await chrome.storage.local.get(["run"]);
            if (stopRequested || !still) break;
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
    } else if (msg?.type === "flow:testSubmit") {
      // Prueba de punta a punta del envio (el mismo flowSend que usa la
      // corrida) con un prompt de prueba. Genera UNA imagen real en Flow.
      send({ type: "flowSend", prompt: TEST_PROMPT })
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } else if (msg?.type === "flow:test") {
      // Diagnostico desde el popup: ¿encuentro el prompt y el boton?
      chrome.storage.local.get(["settings"]).then(({ settings }) => {
        const selectors = mergeSelectors(settings ?? {});
        const prompt = findPromptBox(selectors);
        const button = prompt ? findSubmitButton(selectors, prompt) : null;
        sendResponse({
          ok: true,
          prompt: !!prompt,
          button: button
            ? `${buttonLabel(button).slice(0, 40) || "(icono sin texto)"}${isEnabled(button) ? "" : " [deshabilitado: falta texto en el prompt]"}`
            : null,
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
