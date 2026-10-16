const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const TOKEN_KEY = "skaler_access_token";
const REFRESH_TOKEN_KEY = "skaler_refresh_token";
const SESSION_START_KEY = "skaler_session_started_at";

// Duracion de la sesion: mientras no pasen 3 h desde el login, cada 401 por
// token vencido (Supabase los da por 1 h) se renueva solo con el refresh
// token. Pasadas las 3 h no se cierra nada: se avisa con un cartel (ver
// SessionExpiredBanner) para que el usuario vuelva a entrar cuando quiera.
export const SESSION_MAX_MS = 3 * 60 * 60 * 1000;
export const SESSION_EXPIRED_EVENT = "skaler:session-expired";

// La extension de Chrome (flow-extension/app-bridge.js) lee la sesion y a
// que backend habla esta app desde localStorage para conectarse sola, sin
// pedirle login aparte al usuario.
// skaler_auth_disabled: en local con VITE_DISABLE_AUTH (y DISABLE_AUTH en
// el backend) no hay token -- la extension se conecta igual, sin Authorization.
try {
  localStorage.setItem("skaler_api_url", API_URL);
  localStorage.setItem("skaler_auth_disabled", String(import.meta.env.VITE_DISABLE_AUTH === "true"));
} catch {
  // localStorage bloqueado: la extension no se conecta sola, la app sigue igual.
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Login nuevo (login, registro u OAuth): arranca el reloj de las 3 h.
export function setToken(token: string, refreshToken?: string | null): void {
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(SESSION_START_KEY, String(Date.now()));
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(SESSION_START_KEY);
}

// Sesiones iniciadas antes de que existiera el reloj: cuentan desde ahora.
function sessionStartedAt(): number {
  const stored = Number(localStorage.getItem(SESSION_START_KEY));
  if (stored > 0) return stored;
  const now = Date.now();
  if (getToken()) localStorage.setItem(SESSION_START_KEY, String(now));
  return now;
}

export function isSessionExpired(): boolean {
  return Boolean(getToken()) && Date.now() - sessionStartedAt() > SESSION_MAX_MS;
}

function announceSessionExpired(): void {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

// Un solo refresh a la vez: varios pedidos que vencen juntos esperan el
// mismo, y entre pestañas se turnan con un lock del navegador. Supabase rota
// el refresh token, asi que usarlo dos veces fallaria: la que llega segunda
// ve que el token ya cambio (lo renovo otra pestaña o la extension, que
// comparten localStorage) y lo usa sin volver a renovar.
let refreshing: Promise<boolean> | null = null;
const REFRESH_LOCK = "skaler-refresh-session";

async function refreshAccessToken(staleToken: string | null): Promise<boolean> {
  if (refreshing) return refreshing;
  const run = async () => {
    if (getToken() !== staleToken) return Boolean(getToken());
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken || isSessionExpired()) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      const session = data?.session;
      if (!session?.access_token) return false;
      // Sin setToken: renovar no reinicia el reloj de las 3 h.
      localStorage.setItem(TOKEN_KEY, session.access_token);
      if (session.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
      return true;
    } catch {
      return false;
    }
  };
  refreshing = navigator.locks ? navigator.locks.request(REFRESH_LOCK, run).then((ok) => ok) : run();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

export class ApiError extends Error {
  status: number;
  // Codigo de error del backend cuando lo manda (ej: ACCOUNT_PENDING,
  // NO_VIDEO_CREDITS), para reaccionar distinto a cada caso.
  code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // FormData necesita que el browser calcule su propio boundary en
  // Content-Type -- si lo fijamos nosotros a "application/json" (o incluso
  // a multipart/form-data a mano) el request queda mal formado.
  const isFormData = options.body instanceof FormData;
  let sentToken: string | null = null;
  const send = () => {
    const token = getToken();
    sentToken = token;
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers as Record<string, string> | undefined),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${API_URL}${path}`, { ...options, headers });
  };

  let res = await send();
  // Token vencido: se renueva una vez y se repite el pedido. Si no se puede
  // (pasaron las 3 h o el refresh token ya no sirve), cartel en vez de
  // cerrar la sesion.
  // Login/registro/refresh devuelven 401 por credenciales, no por sesion.
  const isAuthCall = path.startsWith("/auth/") && !path.startsWith("/auth/me");
  if (res.status === 401 && getToken() && !isAuthCall) {
    if (await refreshAccessToken(sentToken)) {
      res = await send();
    }
    if (res.status === 401) {
      announceSessionExpired();
      throw new ApiError(401, "Tu sesión venció. Volvé a iniciar sesión para seguir.", "SESSION_EXPIRED");
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const rawMessage = data?.error ?? data?.message ?? `Request failed (${res.status})`;
    const message = typeof rawMessage === "string" ? rawMessage : JSON.stringify(rawMessage);
    throw new ApiError(res.status, message, typeof data?.code === "string" ? data.code : undefined);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
  postForm: <T>(path: string, formData: FormData) =>
    apiFetch<T>(path, { method: "POST", body: formData }),
};
