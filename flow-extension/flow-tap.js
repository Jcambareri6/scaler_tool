// Corre en el MAIN world de la pestaña de Flow, en document_start (ver
// manifest.json). Engancha fetch y XMLHttpRequest para leer las respuestas de
// la API interna de Flow (RPC `batchexecute`).
//
// Para que sirve: al mandar un prompt, Flow responde con ese mismo texto y el
// id del resultado (mediaId), y despues trae la URL del archivo. Con eso cada
// resultado se asocia a SU escena por el prompt exacto, y la extension puede
// mandar todos los prompts seguidos (ver pageFindMedia en background.js).
//
// Cada respuesta se resume en un indice chico apenas llega (mediaId ->
// textos, primera vez visto, URLs). Guardar las respuestas enteras no
// alcanzaba: en corridas largas las viejas se descartaban antes de leerlas.
//
// Solo lee, salvo requestSignedUrl: repite el pedido con el que Flow obtiene
// las URLs firmadas, para imagenes que no estan a la vista en la grilla.

(() => {
  if (window.__scalerFlowTap === 2) return;
  window.__scalerFlowTap = 2;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SIGNED_URL = /https:\/\/flow-content\.google\/(image|video)\/([0-9a-f-]{36})\?[^"'\s\\<>]+/gi;
  const ENUM = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;
  const SIGN_RPC = "as29s"; // RPC con el que Flow pide las URLs firmadas
  const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

  // mediaId -> { firstAt, texts: Set, urls: [], flags: Set }
  const media = (window.__scalerFlowMedia = window.__scalerFlowMedia || new Map());
  // mediaId -> { image?: url, video?: url } (URL firmada mas reciente)
  const signed = (window.__scalerFlowSigned = window.__scalerFlowSigned || new Map());
  const stats = (window.__scalerFlowStats = window.__scalerFlowStats || { responses: 0, rpcs: {} });
  let signRequest = null; // ultimo pedido de URLs firmadas que hizo Flow { url, body, headers }

  const payloadsOf = (body) => {
    const out = [];
    for (const line of String(body).split("\n")) {
      if (!line.startsWith("[")) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (_) {
        continue;
      }
      for (const entry of Array.isArray(parsed) ? parsed : []) {
        if (Array.isArray(entry) && entry[0] === "wrb.fr" && typeof entry[2] === "string") {
          try {
            out.push(JSON.parse(entry[2]));
          } catch (_) {}
        }
      }
    }
    return out;
  };

  // El array mas interno que empieza con un UUID se queda con los textos y
  // URLs que tiene adentro (un registro de medio: [mediaId, proyecto, ..., [fecha, prompt, ...]]).
  const walk = (node, at, depth) => {
    if (typeof node === "string") return [node];
    if (!Array.isArray(node) || depth > 12) return [];
    const strings = [];
    for (const child of node) strings.push(...walk(child, at, depth + 1));
    if (typeof node[0] === "string" && UUID.test(node[0]) && node.length >= 3) {
      const id = node[0].toLowerCase();
      const entry = media.get(id) ?? { firstAt: at, texts: new Set(), urls: [] };
      entry.flags = entry.flags ?? new Set();
      for (const s of strings.slice(1)) {
        if (/^https:\/\//.test(s)) entry.urls.push(s);
        // Estados en MAYUSCULAS (ej. MEDIA_GENERATION_STATUS_FAILED): aparte
        // de los textos, para saber si Flow rechazo la generacion.
        else if (ENUM.test(s)) entry.flags.add(s);
        else if (s.length >= 12 && !UUID.test(s)) entry.texts.add(norm(s));
      }
      if (entry.urls.length > 6) entry.urls = entry.urls.slice(-6);
      media.set(id, entry);
      return [];
    }
    return strings;
  };

  const record = (url, body) => {
    if (typeof body !== "string" || !body || !/batchexecute/.test(url)) return;
    const at = Date.now();
    const rpc = decodeURIComponent((String(url).match(/rpcids=([^&]+)/) || [])[1] || "");
    stats.responses++;
    stats.rpcs[rpc] = (stats.rpcs[rpc] ?? 0) + 1;
    for (const payload of payloadsOf(body)) walk(payload, at, 0);
    const text = body.replace(/\\+\//g, "/").replace(/\\+u003d/gi, "=").replace(/\\+u0026/gi, "&");
    for (const m of text.matchAll(SIGNED_URL)) {
      const id = m[2].toLowerCase();
      signed.set(id, { ...(signed.get(id) ?? {}), [m[1].toLowerCase()]: m[0] });
    }
  };

  const rememberSignRequest = (url, body, headers) => {
    if (/batchexecute/.test(url) && String(url).includes(SIGN_RPC) && typeof body === "string") {
      signRequest = { url: String(url), body, headers };
    }
  };

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      rememberSignRequest(url, args[1]?.body, args[1]?.headers);
    } catch (_) {}
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (/batchexecute/.test(url)) response.clone().text().then((t) => record(url, t)).catch(() => {});
    } catch (_) {}
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__scalerUrl = String(url ?? "");
    this.__scalerHeaders = {};
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__scalerHeaders) this.__scalerHeaders[name] = value;
    return originalSetHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const url = this.__scalerUrl ?? "";
    if (/batchexecute/.test(url)) {
      try {
        rememberSignRequest(url, args[0], this.__scalerHeaders);
      } catch (_) {}
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") record(url, this.responseText);
        } catch (_) {}
      });
    }
    return originalSend.apply(this, args);
  };

  // Pide a Flow la URL firmada de un medio que no esta a la vista: repite su
  // ultimo pedido de URLs firmadas cambiando los ids por el que falta. La
  // respuesta pasa por el fetch enganchado y queda en `signed`.
  window.__scalerFlowRequestSignedUrl = async (mediaId) => {
    if (!signRequest) return { ok: false, reason: "Flow todavía no pidió ninguna URL firmada" };
    const ids = [...new Set(decodeURIComponent(signRequest.body).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [])]
      .filter((id) => media.has(id.toLowerCase()) || signed.has(id.toLowerCase()));
    if (!ids.length) return { ok: false, reason: "No se reconocen ids de medios en el pedido de Flow" };
    let body = signRequest.body;
    for (const id of ids) body = body.split(id).join(mediaId);
    try {
      const res = await window.fetch(signRequest.url, {
        method: "POST",
        credentials: "include",
        headers: signRequest.headers ?? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  };
})();
