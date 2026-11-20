import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// CORTES DE RED (20/11/2026): el worker de Hetzner perdio la ruta a Cloudflare
// ~10 min; cada consulta volvia "400 Project not specified" o colgaba, el
// pipeline tiro el error y un documental de 29 min murio al 50 %. Ahora las
// consultas reintentan con pausas crecientes hasta ~10 min. Solo se reintenta
// lo que NUNCA llego a la base (sin conexion, 5xx de Cloudflare, el 400 del
// gateway): un error de la base (permiso, dato invalido) vuelve en el acto.
// Solo el worker (WORKER_ID, lo setea docker-compose) espera tanto: la API
// del sitio no puede dejar a un usuario 10 min esperando una pagina.
const RETRY_DELAYS_MS = process.env.WORKER_ID?.trim()
  ? [2_000, 5_000, 10_000, 20_000, ...Array.from({ length: 18 }, () => 30_000)]
  : [1_000, 3_000];
const GATEWAY_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

async function gatewayFailure(res: Response): Promise<boolean> {
  if (GATEWAY_STATUS.has(res.status)) return true;
  if (res.status !== 400) return false;
  const body = await res.clone().text().catch(() => "");
  return /Project not specified/i.test(body);
}

export async function retryingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= RETRY_DELAYS_MS.length;
    let reason: string;
    try {
      const res = await fetch(input, init);
      if (last || !(await gatewayFailure(res))) return res;
      reason = `HTTP ${res.status}`;
    } catch (err) {
      if (last || init?.signal?.aborted) throw err;
      reason = (err as Error).message;
    }
    const wait = RETRY_DELAYS_MS[attempt]!;
    if (attempt === 0 || attempt % 5 === 0) console.warn(`[supabase] sin conexion (${reason}): reintento ${attempt + 1} en ${wait / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

// Cliente del BACKEND (service_role) para datos y storage. Nunca guarda una
// sesion: si un signIn/signUp/refreshSession corria sobre este mismo cliente,
// supabase-js se quedaba con la sesion de ESE usuario y desde ahi mandaba su
// token en el header Authorization de TODAS las consultas del backend --
// todo pasaba a correr como "el ultimo usuario que se logueo" (visto en
// produccion: "permission denied for table workspaces" con rol
// authenticated). Las operaciones de sesion van por createAuthClient().
export const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: retryingFetch },
    realtime: {
      // Node no tiene WebSocket global (confirmado: Node 20.9 en este
      // entorno no lo expone), asi que hace falta el shim de `ws` para que
      // el realtime client de Supabase funcione del lado del servidor. El
      // `as any` es porque los overloads del constructor de `ws` no
      // matchean estructuralmente el tipo `WebSocketLikeConstructor` de
      // @supabase/realtime-js (choque de tipos entre las dos librerias,
      // no un problema real de runtime) -- bloqueaba `tsc` con exit code
      // != 0, lo cual rompe el build de produccion (Render lo marca como
      // build fallido) aunque el JS se emitiera igual.
      transport: ws as any,
    },
  }
);

// Cliente DESCARTABLE para operaciones de sesion de un usuario (login,
// registro, refresh, OAuth, validar un token): uno nuevo por llamada, asi la
// sesion que crea muere con el y nunca se mezcla con el cliente del backend.
export function createAuthClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Igual que el cliente del backend: en Node < 22 supabase-js tira error
    // al crear el cliente si no le pasan un WebSocket (aunque no use realtime).
    realtime: { transport: ws as any },
  });
}