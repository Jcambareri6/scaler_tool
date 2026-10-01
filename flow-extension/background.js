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
    if (res.status === 401) throw new Error("Sesión vencida: volvé a conectar la extensión con Scaler Tool");
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

const handlers = {
  async login({ email, password }) {
    const { settings } = await getStore(["settings"]);
    const res = await fetch(`${apiBase(settings)}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.session?.access_token) {
      throw new Error(data?.error ?? data?.message ?? "No se pudo iniciar sesión");
    }
    const auth = {
      email: data.user?.email ?? email,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token ?? null,
    };
    await chrome.storage.local.set({ auth });
    return { email: auth.email };
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg?.type && handlers[msg.type];
  if (!handler) return false;
  handler(msg)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // respuesta asincronica
});
