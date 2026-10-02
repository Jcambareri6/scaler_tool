import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
  });
}