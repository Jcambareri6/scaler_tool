// Corre DENTRO de la pestaña de Google Flow. Recorre la cola de escenas
// guardada en chrome.storage (la arma el popup): manda los prompts a Flow uno
// tras otro y descarga cada resultado a la PC numerado por escena (ver
// "cola" mas abajo). Vive aca y no
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

  // --- cola ---------------------------------------------------------------
  //
  // Modo rapido (el normal): manda los prompts uno tras otro, sin esperar a
  // que termine cada uno, sin esperar a que termine ninguno.
  // Cada resultado se reconoce por la red de Flow (flowFindMedia: prompt
  // exacto -> mediaId -> URL) y se descarga numerado por escena apenas sale.
  //
  // Modo de a una (respaldo): si Flow no deja leer sus respuestas, se vuelve
  // al metodo de siempre -- mandar, esperar a que aparezca una imagen nueva
  // en la pagina, descargarla y recien ahi mandar la siguiente.

  const NOT_REGISTERED_MS = 90_000;
  const NO_TRAFFIC_MS = 20_000;
  const COLLECT_EVERY_MS = 10_000;
  // Imagen ya creada en Flow sin URL: a los 15 s se le pide a Flow, cada 20 s,
  // y a los 10 min se da por perdida (sin volver a mandar el prompt).
  const SIGNED_URL_AFTER_MS = 15_000;
  const SIGNED_URL_EVERY_MS = 20_000;
  const FOUND_NO_URL_MAX_MS = 10 * 60_000;

  function timeoutMsFor(settings) {
    return (Number(settings.timeoutSec) || (settings.mediaType === "video" ? 600 : 240)) * 1000;
  }

  function step(item, text) {
    console.log(`[Scaler→Flow] escena ${item.order}: ${text}`);
    return patchItem(item.sceneId, { step: text });
  }

  // Guarda el resultado en la extension; se baja a la PC despues, todas
  // juntas, con el boton "Descargar" del panel (ver storeResult en background.js).
  async function saveResult(run, item, src, settings) {
    await step(item, "guardando la imagen");
    const media = await downloadMedia(src);
    await send({
      type: "storeResult",
      sceneId: item.sceneId,
      order: item.order,
      ext: extensionFor(media.mime, settings.mediaType),
      mime: media.mime,
      base64: media.base64,
    });
  }

  // Un intento fallido: vuelve a la cola si le quedan reintentos.
  async function failItem(item, message, settings) {
    const retries = Math.max(0, Number(settings.retries ?? 2));
    const { run } = await chrome.storage.local.get(["run"]);
    const current = run?.items.find((i) => i.sceneId === item.sceneId);
    const attempts = current?.attempts ?? item.attempts ?? 1;
    console.warn(`[Scaler→Flow] escena ${item.order}: ${message}`);
    await patchItem(
      item.sceneId,
      attempts < retries + 1
        ? { status: "pending", error: message, step: `reintentando (${message})` }
        : { status: "error", error: message, step: null }
    );
  }

  // Ingredientes de la escena (personajes/objetos de referencia). Flow
  // conserva los de la escena anterior: si cambian (o hay que vaciarlos) se
  // rearman; si son los mismos, no se toca nada.
  async function applyRefs(item, refState) {
    const { refs: allRefs } = await chrome.storage.local.get(["refs"]);
    const wanted = (item.refIds ?? []).map((id) => (allRefs ?? []).find((r) => r.id === id)).filter(Boolean);
    const refKey = wanted.map((r) => r.flowName).join("|");
    if (refKey === refState.last) return;
    await step(item, wanted.length ? "poniendo referencias en Flow" : "sacando referencias de Flow");
    const applied = await send({
      type: "flowApplyRefs",
      refs: wanted.map((r) => ({ names: r.names, flowName: r.flowName, dataUrl: r.dataUrl })),
    });
    if (!applied?.ok) throw new Error(applied?.error ?? "No se pudieron poner las referencias en Flow");
    refState.last = refKey;
  }

  async function sendPrompt(item) {
    // Escribir + enviar corre en el MAIN world de la pagina (background.js).
    // Solo vuelve ok si Flow vacio la caja, o sea si de verdad tomo el prompt.
    const sent = await send({ type: "flowSend", prompt: item.prompt });
    if (!sent?.ok) throw new Error(sent?.error ?? "No se pudo enviar el prompt a Flow");
  }

  // Modo rapido: manda la escena y sigue, sin esperar el resultado.
  async function launchItem(item, settings, refState) {
    const attempts = (item.attempts ?? 0) + 1;
    await patchItem(item.sceneId, { status: "working", attempts, error: null, sentAt: null, mediaId: null, foundAt: null, askedUrlAt: null });
    try {
      await applyRefs(item, refState);
      await step(item, "enviando el prompt");
      const sentAt = Date.now();
      await sendPrompt(item);
      await patchItem(item.sceneId, { sentAt, step: "generando en Flow" });
    } catch (err) {
      refState.last = null; // tras un error no se sabe que quedo puesto en Flow
      await failItem({ ...item, attempts }, err instanceof Error ? err.message : String(err), settings);
    }
  }

  // Modo rapido: se fija si el resultado de una escena ya salio y lo guarda.
  // Devuelve "ok" | "waiting" | "failed" | "no-network".
  async function collectItem(run, item, settings, taken) {
    if (!item.sentAt) return "waiting"; // todavia mandandose
    // Cuando se mando el prompt siguiente: lo que Flow creo entre los dos
    // envios es de esta escena (ver pageFindMedia en background.js).
    const nextSentAt = run.items
      .map((i) => i.sentAt)
      .filter((t) => t && t > item.sentAt)
      .sort((a, b) => a - b)[0] ?? null;
    const res = await send({
      type: "flowFindMedia",
      prompt: item.prompt,
      sentAt: item.sentAt,
      nextSentAt,
      taken: [...taken],
      mediaType: settings.mediaType,
    });
    if (!res?.tap) return "no-network";
    const elapsed = Date.now() - item.sentAt;

    // La imagen ya existe en Flow pero todavia no hay URL para bajarla (Flow
    // solo la pide para las que estan a la vista): se le pide, y NO se vuelve
    // a mandar el prompt -- eso generaba imagenes repetidas y gastaba creditos.
    if (res.found && !res.url) {
      if (!item.mediaId) await patchItem(item.sceneId, { mediaId: res.mediaId, foundAt: Date.now(), step: "generando en Flow" });
      const foundAt = item.foundAt ?? Date.now();
      if (Date.now() - foundAt > SIGNED_URL_AFTER_MS && Date.now() - (item.askedUrlAt ?? 0) > SIGNED_URL_EVERY_MS) {
        await patchItem(item.sceneId, { askedUrlAt: Date.now(), step: "pidiendo la imagen a Flow" });
        await send({ type: "flowRequestSignedUrl", mediaId: res.mediaId }).catch(() => {});
      }
      if (Date.now() - foundAt > FOUND_NO_URL_MAX_MS) {
        await patchItem(item.sceneId, {
          status: "error",
          error: "La imagen está en Flow pero no se pudo bajar: subí hasta ella en la grilla de Flow y tocá ↻ Reintentar fallidas",
          step: null,
        });
        return "failed";
      }
      return "waiting";
    }

    if (res.found && res.url) {
      taken.add(res.mediaId);
      try {
        await saveResult(run, item, res.url, settings);
        await patchItem(item.sceneId, { status: "ok", error: null, step: null, mediaId: res.mediaId, thumb: res.url });
        return "ok";
      } catch (err) {
        await failItem(item, err instanceof Error ? err.message : String(err), settings);
        return "failed";
      }
    }
    // Sin registro del prompt: si la escucha no vio NINGUNA respuesta de Flow
    // (seen 0), no hay nada que esperar; si vio pero no esta este prompt, se
    // le da margen. Va antes del timeout general para no gastar reintentos.
    if (!res.found && ((res.seen === 0 && elapsed > NO_TRAFFIC_MS) || elapsed > Math.min(NOT_REGISTERED_MS, timeoutMsFor(settings)))) {
      return "no-network";
    }
    if (elapsed > timeoutMsFor(settings)) {
      await failItem(item, "Flow no terminó la imagen a tiempo", settings);
      return "failed";
    }
    return "waiting";
  }

  // Modo de a una (respaldo): manda, espera el resultado en la pagina y lo
  // guarda. Devuelve false si no queda nada por hacer.
  async function sequentialStep(run, settings, refState, alreadyUsed) {
    const item = run.items.find((i) => i.status === "pending");
    if (!item) return false;
    const attempts = (item.attempts ?? 0) + 1;
    await patchItem(item.sceneId, { status: "working", attempts, error: null });
    try {
      await applyRefs(item, refState);
      const before = currentMediaSrcs(settings);
      await step(item, "enviando el prompt");
      await sendPrompt(item);
      await step(item, "esperando el resultado de Flow");
      const src = await waitForNewMedia(settings, before, alreadyUsed, timeoutMsFor(settings));
      alreadyUsed.add(src);
      const { run: still } = await chrome.storage.local.get(["run"]);
      if (stopRequested || !still) {
        await patchItem(item.sceneId, { status: "pending" });
        return false;
      }
      await saveResult(run, item, src, settings);
      await patchItem(item.sceneId, {
        status: "ok",
        error: null,
        step: null,
        ...(/^https?:/.test(src) ? { thumb: src } : {}),
      });
    } catch (err) {
      refState.last = null;
      if (stopRequested) {
        await patchItem(item.sceneId, { status: "pending" });
        return false;
      }
      await failItem({ ...item, attempts }, err instanceof Error ? err.message : String(err), settings);
    }
    await sleep(Math.max(0, Number(settings.delaySec ?? 3)) * 1000);
    return true;
  }

  async function switchToSequential(reason) {
    console.warn(`[Scaler→Flow] paso a modo de a una: ${reason}`);
    await patchRun((run) => {
      run.mode = "sequential";
      run.notice = "Flow no dejó leer sus respuestas: sigo de a una escena (más lento).";
      // Las que estaban generandose se vuelven a mandar de a una (sin gastar
      // un reintento): no hay forma segura de saber cual imagen es cual.
      for (const item of run.items) {
        if (item.status === "working") {
          item.status = "pending";
          item.attempts = Math.max(0, (item.attempts ?? 1) - 1);
        }
      }
    });
  }

  async function runQueue() {
    if (running) return;
    running = true;
    stopRequested = false;
    const refState = { last: null }; // ingredientes puestos en Flow (null = no se sabe)
    const alreadyUsed = new Set();
    try {
      await send({ type: "flowEnsureTap" }).catch(() => {});
      const started = await patchRun((run) => {
        run.status = "running";
        run.lastError = null;
        for (const item of run.items) {
          // Imagen que ya existe en Flow (tiene mediaId) pero no se pudo bajar:
          // se sigue esperando su URL, sin volver a mandar el prompt.
          if ((item.status === "working" || item.status === "error") && item.mediaId) {
            Object.assign(item, { status: "working", error: null, foundAt: Date.now(), askedUrlAt: null });
          } else if (item.status === "working") {
            // Lo que quedo "generando" sin resultado se vuelve a mandar.
            item.status = "pending";
          }
        }
      });
      // mediaId ya guardados (variantes de un mismo prompt no se reusan).
      const taken = new Set((started?.items ?? []).filter((i) => i.status === "ok").map((i) => i.mediaId).filter(Boolean));
      let anyOkByNetwork = (started?.items ?? []).some((i) => i.mediaId);
      let lastCollect = Date.now();

      while (!stopRequested) {
        const { run, settings: stored } = await getState();
        const settings = stored ?? {};
        if (!run || run.status !== "running") break;

        if (run.mode === "sequential") {
          if (!(await sequentialStep(run, settings, refState, alreadyUsed))) break;
          continue;
        }

        const inFlight = run.items.filter((i) => i.status === "working");
        const next = run.items.find((i) => i.status === "pending");

        // 1) Mandar todos los prompts seguidos, sin esperar resultados. Cada
        //    tanto se hace una pasada de recoleccion (abajo) para no dejar
        //    que se acumulen demasiadas respuestas de Flow sin leer.
        if (next && Date.now() - lastCollect < COLLECT_EVERY_MS) {
          await launchItem(next, settings, refState);
          await sleep(Math.max(1, Number(settings.delaySec ?? 2)) * 1000);
          continue;
        }
        lastCollect = Date.now();
        if (!inFlight.length) {
          if (next) continue;
          break;
        }

        // 2) Recoger lo que ya salio.
        let fallback = false;
        for (const item of inFlight) {
          if (stopRequested) break;
          const outcome = await collectItem(run, item, settings, taken);
          if (outcome === "ok") anyOkByNetwork = true;
          if (outcome === "no-network") {
            if (!anyOkByNetwork) {
              fallback = true;
              break;
            }
            await failItem(item, "Flow no registró el envío del prompt", settings);
          }
        }
        if (fallback) {
          await switchToSequential("ningun resultado se pudo asociar por la red");
          continue;
        }
        await sleep(2500);
      }

      await patchRun((run) => {
        if (stopRequested) {
          run.status = "paused";
          // Las que estaban generandose quedan para retomar.
          for (const item of run.items) if (item.status === "working") item.status = "pending";
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
