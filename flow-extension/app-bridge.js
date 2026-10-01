// Corre dentro de la app de Scaler Tool (localhost): toma la sesion que la
// app ya tiene iniciada (localStorage, ver frontend lib/api.ts) y se la pasa
// a la extension, asi se conecta sola con el mismo usuario sin pedir login.
// El manifest lo inyecta en cualquier pagina de localhost; solo hace algo si
// la pagina es Scaler Tool (la app escribe "skaler_api_url" al cargar).

(() => {
  if (window.__skalerBridgeLoaded) return;
  window.__skalerBridgeLoaded = true;

  let lastSent = null;

  function readSession() {
    try {
      const apiUrl = localStorage.getItem("skaler_api_url");
      if (!apiUrl) return null; // no es Scaler Tool
      let email = null;
      try {
        email = JSON.parse(localStorage.getItem("skaler_user") || "null")?.email ?? null;
      } catch {
        // skaler_user corrupto: no importa, el email es solo para mostrar
      }
      return {
        apiUrl,
        appUrl: location.origin,
        // Proyecto abierto en la app (/projects/<uuid>): el panel lo
        // preselecciona. null en el inicio u otras paginas.
        projectId: location.pathname.match(/^\/projects\/([0-9a-f-]{36})/i)?.[1] ?? null,
        // Modo local sin login (VITE_DISABLE_AUTH): no hay token, el backend
        // atiende todo como DEV_USER_ID.
        authDisabled: localStorage.getItem("skaler_auth_disabled") === "true",
        accessToken: localStorage.getItem("skaler_access_token"),
        refreshToken: localStorage.getItem("skaler_refresh_token"),
        email,
      };
    } catch {
      return null;
    }
  }

  function sync() {
    const session = readSession();
    if (!session) return;
    const key = `${session.apiUrl}|${session.authDisabled}|${session.accessToken ?? ""}|${session.projectId ?? ""}`;
    if (key === lastSent) return;
    lastSent = key;
    try {
      chrome.runtime.sendMessage({ type: "appSession", ...session }, () => void chrome.runtime.lastError);
    } catch {
      // La extension se recargo y este script quedo huerfano: deja de sincronizar.
      clearInterval(timer);
    }
  }

  // Login/logout en OTRA pestaña dispara "storage"; en esta misma no, asi que
  // tambien se revisa cada tanto y al volver a la pestaña.
  // El popup pide re-sincronizar cuando la extension se quedo sin sesion
  // (ej: "Desconectar"), aunque el token de la app no haya cambiado.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "bridge:resync") {
      lastSent = null;
      sync();
    }
  });

  window.addEventListener("storage", sync);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sync());
  // La app es una SPA: navegar a otro proyecto no recarga la pagina, asi que
  // tambien se revisa cada 2s (el proyecto abierto sale de la URL).
  const timer = setInterval(sync, 2000);
  sync();
})();
