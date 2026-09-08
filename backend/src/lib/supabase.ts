import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
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