# Plan: cobro por video, aprobación de cuentas y cierre de gastos

Plan de implementación para abrir Scaler Tool a los alumnos cobrando por video renderizado. Junta todo lo que charlamos: costos, contador de videos, aprobación de cuentas, panel de administrador, extensión de Flow, vulnerabilidades y fallas.

> **Estado (14/10, noche):** mergeado a `master` (PR #3). Migraciones aplicadas en Supabase y worker de Hetzner actualizado. Falta cargar `ADMIN_USER_IDS` en Render y desplegar la API.
>
> | Fase | Estado |
> |---|---|
> | 0. Sacar la IA | ✅ Hecha, salvo el paso 0.5: el provider `snapgen` sigue activo en la tabla `providers` (las tools están desregistradas, así que no se puede usar) |
> | 1. Cerrar la base | ✅ Paso 1.1 aplicado. ⏳ Paso 1.2 (que `jobs` no se pueda leer entero) pendiente |
> | 2. Gastos sin control | ✅ Hecha (tope del guion en 35.000 y no 40.000; la caché de la voz de muestra quedó en memoria y no en Storage) |
> | 3. Aprobación de cuentas | ✅ Hecha |
> | 4. Contador de videos | ✅ Hecha, salvo el paso 4.5 (tope de 3 voces por proyecto), que queda **a definir con Seba** |
> | 5. Panel de admin | ✅ Hecha (más la opción "sin límite" para el equipo) |
> | 6. Lo que ve el alumno | ✅ Hecha |
> | 7. Extensión de Flow | ✅ No hizo falta cambiarla. ⏳ Falta probarla con una cuenta pendiente |
> | 8. Prolijidad | ⏳ Solo se borró `/auth/test` |
>
> El detalle de lo que se hizo y de lo que falta está en [`informe-cambios.md`](informe-cambios.md). Los ejemplos de código del resto de este documento son ilustrativos: el código real está en `master`.

## Cómo desplegar

> **Estado:** pasos 1 y 2 hechos en Supabase y en el worker de Hetzner. Falta Render: cargar `ADMIN_USER_IDS` y desplegar la API.

**El orden importa:** la API nueva llama a funciones de la base que crean las migraciones. Si se despliega el código antes, todos los pedidos fallan.

1. **Migraciones en Supabase** (SQL Editor, en este orden):
   1. `backend/supabase/migrations/20261015000000_lock_public_tables.sql`
   2. `backend/supabase/migrations/20261015010000_accounts_and_video_credits.sql`

   La segunda deja a **todas las cuentas que ya existen aprobadas y sin límite** (son del equipo). A un alumno que ya se haya registrado, sacarle el "sin límite" desde el panel de Administración.
2. **Variables de entorno**, en Render (API) **y** en el worker de Hetzner:
   - `ADMIN_USER_IDS=<uuid-de-joaquin>,<uuid-de-seba>` (los UUID están en Supabase → Authentication → Users).
   - Opcionales: `WELCOME_VIDEOS` (default 5) y `MAX_SCRIPT_CHARS` (default 35000).
3. **Desplegar el código:** API en Render, worker en Hetzner y frontend en Netlify.
4. **Probar enseguida** (con una cuenta nueva de prueba):
   - Al registrarse ve "Tu cuenta está pendiente".
   - Seba la aprueba desde Administración → tiene 5 videos.
   - La barra de progreso del render sigue funcionando (Realtime de `jobs`).

**Vuelta atrás del cierre de la base**, si algo del frontend dejara de andar:
`grant select, insert, update, delete on all tables in schema public to anon, authenticated;`

---

## Índice

1. [Resumen: cómo va a funcionar](#1-resumen-cómo-va-a-funcionar)
2. [Cuánto cuesta cada cosa](#2-cuánto-cuesta-cada-cosa)
3. [Problemas encontrados](#3-problemas-encontrados)
4. [Fase 0: Sacar todo lo de IA](#fase-0-sacar-todo-lo-de-ia)
5. [Fase 1: Cerrar el acceso directo a la base](#fase-1-cerrar-el-acceso-directo-a-la-base)
6. [Fase 2: Cerrar los gastos sin control](#fase-2-cerrar-los-gastos-sin-control)
7. [Fase 3: Aprobación de cuentas](#fase-3-aprobación-de-cuentas)
8. [Fase 4: Contador de videos](#fase-4-contador-de-videos)
9. [Fase 5: Panel de administrador](#fase-5-panel-de-administrador)
10. [Fase 6: Lo que ve el alumno](#fase-6-lo-que-ve-el-alumno)
11. [Fase 7: Extensión de Flow](#fase-7-extensión-de-flow)
12. [Fase 8: Prolijidad](#fase-8-prolijidad)
13. [Cómo probar todo antes del sábado](#cómo-probar-todo-antes-del-sábado)
14. [Decisiones pendientes](#decisiones-pendientes)

---

## 1. Resumen: cómo va a funcionar

### El recorrido de un alumno

```
1. El alumno se registra (mail + contraseña o Google)
        │
        ▼
2. Su cuenta queda PENDIENTE → ve "Tu cuenta está esperando aprobación"
        │
        ▼
3. Seba entra al panel de admin → "Aprobar" → el alumno recibe 5 videos gratis
        │
        ▼
4. El alumno arma su video: guion → voz → escenas (Flow o stock) → preview
   (todo esto NO descuenta videos)
        │
        ▼
5. Aprieta RENDERIZAR → se le descuenta 1 video
   · Si el render falla → el video se le devuelve solo
   · Si re-renderiza el mismo proyecto → no descuenta otra vez
        │
        ▼
6. Se le terminan los videos → "Se terminaron tus videos, contactá a Seba"
        │
        ▼
7. Le transfiere a Seba → Seba entra al admin → "Cargar videos" → +10
```

### Qué descuenta y qué no

| Acción | ¿Descuenta un video? |
|---|---|
| Registrarse | No (la cuenta queda pendiente) |
| Generar el guion | No |
| Generar la voz (las primeras 3 veces por proyecto) | No |
| Generar la voz por 4ª vez o más en el mismo proyecto | **Sí, 1 video** (con aviso antes) |
| Preview y cambios de escenas | No |
| Usar la extensión de Flow | No |
| **Primer render de un proyecto** | **Sí, 1 video** |
| Re-render del mismo proyecto | No |
| Render que falla | No (se devuelve) |

---

## 2. Cuánto cuesta cada cosa

Precios: ai33 a 5 USD por millón de caracteres (dato de ustedes); Whisper a ~0,006 USD por minuto (precio público de OpenAI); gpt-4o-mini, centavos. **Verificar siempre con las facturas reales.**

### Un video típico de ~20 minutos (guion de ~20.000 caracteres)

| Paso | Servicio | Costo |
|---|---|---|
| Guion | Depende del modelo configurado (ver Fase 2, paso 7) | Centavos con gpt-4o-mini; mucho más con Claude Opus |
| Voz | ai33 | ~0,10 USD |
| Transcripción | Whisper | ~0,12 USD |
| Prompts para Flow o keywords de stock | gpt-4o-mini | Centavos |
| Imágenes de Flow | Cuenta de Google del alumno | 0 |
| Clips de stock | Pexels, Pixabay, Coverr, Wikimedia | 0 |
| Render | Worker de Hetzner (costo fijo mensual) | 0 por video |
| **Total por video** | | **~0,25–0,30 USD** |

### Cuánto cuesta rehacer la preview

La voz se guarda con una "huella" del texto del guion y de la voz elegida (`generateVoice.tool.ts:133-137`). Si ninguno de los dos cambió, se reutiliza y ai33 no cobra.

| Qué cambió el alumno | Voz (ai33) | Whisper | Costo |
|---|---|---|---|
| Escenas o imágenes (el guion queda igual) | Se reutiliza: 0 | Se vuelve a correr | ~0,12 USD (0 después de la Fase 2, paso 6) |
| El texto del guion o la voz | Se genera de nuevo | Se vuelve a correr | ~0,25 USD |

**Ejemplo del problema:** un alumno cambia el guion 25 veces → 25 × 0,25 = **~6 USD en un solo video**. Por eso existe el tope de 3 voces incluidas por proyecto (Fase 4).

### Costos fijos por mes

| Servicio | Costo |
|---|---|
| Hetzner AX42 (worker de render) | ~45–50 EUR (verificar) |
| Render Starter (API) | 7 USD |
| **Total** | **~55–60 USD por mes** |

### Ganancia con 6 alumnos

| Precio | Ingresos por mes | APIs | Servidores | Resultado |
|---|---|---|---|---|
| 10 USD por 10 videos | 60 USD | ~17 USD | ~58 USD | Pierden ~15 USD |
| 20 USD por 10 videos | 120 USD | ~17 USD | ~58 USD | Ganan ~45 USD |
| 25 USD por mes con 20 videos | 150 USD | ~35 USD | ~58 USD | Ganan ~55 USD |

Si los servidores ya los pagan para sus propios canales, los alumnos son ganancia extra: lo único que agregan es el costo de las APIs.

---

## 3. Problemas encontrados

Ordenados por gravedad. Cada uno dice en qué fase se arregla.

| # | Problema | Gravedad | Fase |
|---|---|---|---|
| 1 | RLS apagado: la key pública de Supabase puede leer y **escribir** todas las tablas. Un alumno podría cargarse videos o meter un render en la cola sin pasar por el backend | 🔴 Crítico | 1 |
| 2 | `/tools/:tool/execute` deja llamar a las 17 tools, no solo a las 4 que usa la app. `generate_voice` acepta cualquier texto: **~90 USD por hora por cuenta** | 🔴 Crítico | 2 |
| 3 | Registro abierto: cualquiera se crea cuentas y, con videos gratis, tendría videos infinitos | 🔴 Crítico | 3 |
| 4 | `pipeline/run` sin límite: se puede disparar 50 veces, cobra Whisper cada vez y **bloquea el worker para todos** | 🔴 Crítico | 2 |
| 5 | `preview_voice` cobra cada vez, aunque el comentario del código dice que reutiliza | 🟠 Alto | 2 |
| 6 | Whisper no reutiliza la transcripción aunque el audio sea idéntico | 🟠 Alto | 2 |
| 7 | El guion usa Claude Opus por defecto si el provider no dice otro modelo | 🟠 Alto | 2 |
| 8 | SnapGen (IA) sigue conectado en el código | 🟠 Alto | 0 |
| 9 | `PATCH /jobs/:id` deja que el usuario cambie el estado del job | 🟠 Alto | 2 |
| 10 | No está definido a quién se le descuenta en un workspace compartido | 🟡 Medio | 4 |
| 11 | El worker reintenta el render hasta 3 veces: no puede descontar 3 veces | 🟡 Medio | 4 |
| 12 | `POST /auth/test` público y sin uso | 🟢 Bajo | 8 |
| 13 | `/auth/refresh` y `/auth/oauth` sin límite de velocidad | 🟢 Bajo | 8 |
| 14 | ~55 lugares devuelven `error.message` crudo al cliente | 🟢 Bajo | 8 |
| 15 | `/auth/oauth` acepta cualquier `redirect_to` en la URL | 🟢 Bajo (verificar) | 8 |

### Explicación del problema 2: los "90 USD por hora"

La app usa `generate_voice` con el guion del proyecto. Pero la dirección de la API acepta **cualquier texto** en el pedido. Un alumno que sepa un poco de programación puede hacer esto desde la consola del navegador:

```js
// Ejemplo de ataque (NO es código de la app)
const token = localStorage.getItem("skaler_access_token");
for (let i = 0; i < 30; i++) {
  fetch("https://api.../tools/generate_voice/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      input: { script_id: "<su-script>", text: "bla ".repeat(25000) } // ~100.000 caracteres
    }),
  });
}
```

- Cada pedido: ~100.000 caracteres × 5 USD por millón = **~0,50 USD**.
- El límite actual es de 30 pedidos cada 10 minutos = 180 por hora.
- 180 × 0,50 = **~90 USD por hora**, y por cada cuenta que tenga.

Después de la Fase 2, el `text` del pedido se ignora: la voz se genera **siempre con el guion guardado**, y si el guion no cambió, se reutiliza la que ya existe. Ese mismo ataque costaría 0.

### Explicación del problema 1: el acceso directo a la base

La key pública de Supabase está en el código del frontend (es pública por diseño). Con RLS apagado, cualquiera con esa key puede hacer:

```js
// Ejemplo de ataque (NO es código de la app)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Cargarse 1000 videos
await supabase.from("video_credits").update({ balance: 1000 }).eq("user_id", "<mi-id>");

// Meter un render en la cola sin pasar por el botón Renderizar
await supabase.from("jobs").update({ queue: "render", queue_state: "pending" }).eq("id", "<mi-job>");
```

Por eso la Fase 1 va **antes** que el contador. Sin ella, el contador se puede saltear.

---

## Fase 0: Sacar todo lo de IA

La generación de imágenes y videos con IA (SnapGen) no está terminada. Se saca para que no se pueda usar por error ni a propósito.

### Paso 0.1: Desregistrar las tools de IA

Archivo `backend/src/tools/index.ts`:

```ts
// Antes
registerTool(generateImageTool);
registerTool(generateVideoTool);
registerTool(generateVideoPromptTool);

// Después: se borran estas tres líneas (los archivos pueden quedar para el futuro)
```

### Paso 0.2: Sacar las ramas de IA de regenerate-visual

Archivo `backend/src/modules/scenes/scene.service.ts`: las ramas `source === "ai"` y `source === "ai_image"` responden un error claro.

```ts
if (source === "ai" || source === "ai_image") {
  return res.status(400).json({ error: "La generación con IA todavía no está disponible" });
}
```

### Paso 0.3: Sacar la rama de IA del pipeline

Archivo `backend/src/pipeline/orchestrator.ts`: si `visual_source` es `ai` o `mixed`, se trata como `stock`.

### Paso 0.4: Sacar las opciones de IA del frontend

Hay ~39 referencias a `visual_source`, `ai_image` y `"ai"` en `frontend_v1/src`. En los selectores de visual quedan solo **Stock** y **Flow**.

### Paso 0.5: Borrar el provider de SnapGen

En la tabla `providers`, borrar (o desactivar) el registro de SnapGen si existe. Así, aunque quede algún camino abierto, no tiene key para gastar.

**✅ Cómo verificar:** `POST /tools/generate_video/execute` responde 404 (`is not registered`).

---

## Fase 1: Cerrar el acceso directo a la base

**La más urgente.** El backend usa la `service_role` key, que no se ve afectada por estos cambios. El frontend solo usa Supabase directo para escuchar el progreso del render por Realtime (`PreviewPanel.tsx:323`).

### Paso 1.1: Migración que saca permisos de escritura

Archivo nuevo `backend/supabase/migrations/2026101500000_lock_public_tables.sql`:

```sql
-- La key pública (anon) y los usuarios logueados (authenticated) no pueden
-- escribir en NINGUNA tabla. Todas las escrituras pasan por el backend.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

-- Lectura: se saca de todo...
revoke select on all tables in schema public from anon, authenticated;

-- ...menos de jobs, que el frontend escucha por Realtime para mostrar
-- el progreso del render.
grant select on public.jobs to anon, authenticated;

-- Tablas que se creen en el futuro: sin permisos por defecto.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
```

> ⚠️ **Antes de correrla:** confirmar en el dashboard de Supabase que el frontend no lee ninguna otra tabla directo. Hoy, en el código, solo usa `jobs` por Realtime.

### Paso 1.2 (más adelante): Que `jobs` tampoco se pueda leer entero

Con el paso 1.1, alguien todavía podría leer los jobs de otros (progreso y errores, sin datos sensibles). Para cerrarlo del todo hay dos opciones:
- Activar RLS en `jobs` con una política "solo ves los jobs de tus proyectos". Requiere que el cliente de Realtime use el token del usuario.
- Reemplazar Realtime por consultas al backend cada pocos segundos.

No es urgente para el sábado.

**✅ Cómo verificar:** desde la consola del navegador, con la key pública:

```js
await supabase.from("projects").select("*");          // → error de permisos
await supabase.from("jobs").update({ progress: 1 });  // → error de permisos
await supabase.from("jobs").select("id").limit(1);    // → funciona (Realtime)
```

Y la barra de progreso del render tiene que seguir andando.

---

## Fase 2: Cerrar los gastos sin control

### Paso 2.1: Lista de tools permitidas en `/tools`

Archivo `backend/src/modules/tools/tool.service.ts`:

```ts
// Solo las tools que el frontend realmente llama por /tools.
// Las demás se usan por dentro (pipeline, escenas) y no se exponen.
const PUBLIC_TOOLS = new Set([
  "generate_script",
  "generate_voice",
  "list_voices",
  "preview_voice",
]);

export async function executeTool(req: Request, res: Response) {
  const toolName = req.params.tool_name;
  if (!PUBLIC_TOOLS.has(toolName)) {
    return res.status(404).json({ error: "Herramienta no disponible" });
  }
  // ...
}
```

**Ejemplo:**

```http
POST /tools/transcribe_audio/execute
→ 404 { "error": "Herramienta no disponible" }
```

### Paso 2.2: La voz usa siempre el guion guardado

Archivo `backend/src/tools/generateVoice.tool.ts`: se ignora el `text` del pedido y se lee el guion de la base.

```ts
async execute({ script_id, voice_id }, ctx) {
  const script = await getOwnedScript(script_id, ctx.userId);
  if (!script) throw new Error("Script not found");

  // El texto SIEMPRE sale del guion guardado, nunca del pedido.
  const text = (script.content as { text?: string } | null)?.text ?? "";
  if (text.length > MAX_SCRIPT_CHARS) {
    throw new Error(`El guion supera el máximo de ${MAX_SCRIPT_CHARS} caracteres`);
  }
  // ...sigue igual: si ya existe una voz con este texto y esta voz, se reutiliza
}
```

Y en `backend/src/modules/scripts/script.service.ts` (al guardar el guion), el mismo tope:

```ts
const MAX_SCRIPT_CHARS = 40000; // ~40 minutos de video (a confirmar)
if (text.length > MAX_SCRIPT_CHARS) {
  return res.status(400).json({ error: `El guion no puede superar ${MAX_SCRIPT_CHARS} caracteres` });
}
```

### Paso 2.3: La voz de muestra con texto fijo y guardada

Archivo `backend/src/tools/previewVoice.tool.ts`:

```ts
async execute({ voice_id }) {
  const text = DEFAULT_SAMPLE_TEXT; // se ignora sample_text
  const storageKey = `previews/${voice_id}-${hashText(text)}`;

  // Si ya existe en Storage, se devuelve sin llamar a ai33.
  const existing = await findStoredPreview(storageKey);
  if (existing) return existing;

  const result = await generateWithAi33(storageKey, text, provider.api_key, voice_id);
  return { audio_url: result.storage_key, duration_seconds: result.duration_seconds };
}
```

**Ejemplo:** el alumno escucha la voz "Valentina" 10 veces → ai33 cobra 1 sola vez, y todos los alumnos que la escuchen después la reciben gratis.

### Paso 2.4: Una preview a la vez por proyecto y tope por usuario

Archivo `backend/src/modules/pipeline/pipeline.service.ts`:

```ts
// 1) Si ya hay una preview corriendo o en cola para este proyecto, no se lanza otra.
const { data: running } = await supabase
  .from("jobs")
  .select("id")
  .eq("video_project_id", project.id)
  .in("status", ["QUEUED", "RUNNING", "SCRIPT_DONE", "AUDIO_DONE", "VISUALS_DONE"])
  .limit(1);
if (running?.length) {
  return res.status(409).json({ error: "Ya se está generando la preview de este proyecto" });
}
```

Y en `backend/src/middleware/rateLimit.middleware.ts`, un límite nuevo por usuario:

```ts
// 2) Máximo 10 previews por hora por usuario.
export const pipelineRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user!.id,
  message: { error: "Llegaste al máximo de previews por hora, probá en un rato" },
});
```

Aplicarlo también a `POST /scripts/:id/scenes/image-prompts` (lo usa la extensión) y a `POST /scenes/:id/regenerate-visual`.

### Paso 2.5: Tope de voces por proyecto

Está explicado en la [Fase 4, paso 4.5](#paso-45-tope-de-3-voces-por-proyecto), porque usa el contador de videos.

### Paso 2.6: Whisper reutiliza la transcripción

Archivo `backend/src/tools/transcribeAudio.tool.ts`: mismo criterio que la voz. Si el asset de audio ya tiene una transcripción guardada, se devuelve sin llamar a OpenAI.

```ts
const asset = await getOwnedAsset(asset_id, ctx.userId);
const cached = (asset.metadata as { transcription?: TranscribeAudioOutput })?.transcription;
if (cached) return cached;

const result = await transcribeWithWhisper(/* ... */);
await saveTranscriptionInAssetMetadata(asset_id, result);
return result;
```

**Ejemplo:** el alumno cambia 5 imágenes de escenas y rehace la preview → antes: ~0,12 USD; después: **0 USD**.

### Paso 2.7: Revisar el modelo del guion

`generateScript.tool.ts:18` usa `claude-opus-5` si el provider no dice otro modelo. Revisar en la tabla `providers` qué modelo está configurado. Si es Opus, evaluar uno más barato para los alumnos, o que los alumnos traigan su propio guion. **Esto define si el guion cuesta centavos o más que el video entero.**

### Paso 2.8: El usuario no puede cambiar el estado de un job

Archivo `backend/src/modules/jobs/job.route.ts`: borrar `PATCH /jobs/:id` y `POST /projects/:id/jobs` si el frontend no los usa (verificar con un grep). Los estados los maneja solo el sistema.

**✅ Cómo verificar la Fase 2:**

| Prueba | Resultado esperado |
|---|---|
| `POST /tools/generate_video/execute` | 404 |
| `generate_voice` con un `text` distinto al guion | Genera la voz del guion guardado, no del texto mandado |
| `generate_voice` dos veces sin cambiar el guion | La segunda no llama a ai33 |
| `preview_voice` 5 veces con la misma voz | 1 sola llamada a ai33 |
| Apretar "Generar preview" dos veces rápido | La segunda responde 409 |
| 11 previews en una hora | La 11ª responde 429 |
| Guardar un guion de 50.000 caracteres | 400 con el mensaje del tope |

---

## Fase 3: Aprobación de cuentas

Cualquiera se puede registrar, pero **no puede usar nada hasta que Seba lo apruebe.** Esto cierra el truco de crearse muchas cuentas.

### Paso 3.1: Tabla de cuentas

```sql
create table public.user_accounts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

-- Sin acceso desde la key pública (solo el backend).
revoke all on public.user_accounts from anon, authenticated;

-- Las cuentas que YA existen quedan aprobadas, para no dejar afuera
-- a ustedes ni a nadie que ya esté usando la herramienta.
insert into public.user_accounts (user_id, email, status, reviewed_at)
select id, email, 'approved', now() from auth.users
on conflict (user_id) do nothing;
```

### Paso 3.2: Crear la cuenta pendiente al registrarse

Hay dos formas de registrarse: mail y contraseña (`/auth/register`) y Google (`/auth/oauth/:provider`, que no pasa por `/auth/register`). Para cubrir las dos, la fila se crea **la primera vez que el usuario hace cualquier pedido**, en el middleware.

### Paso 3.3: Middleware que bloquea a los no aprobados

Archivo nuevo `backend/src/middleware/approval.middleware.ts`:

```ts
// Corre después de authMiddleware. Los admins siempre pasan.
export async function requireApproved(req: Request, res: Response, next: NextFunction) {
  const user = req.user!;
  if (isAdmin(user.id)) return next();

  let account = await getAccount(user.id);
  if (!account) {
    // Primer pedido de un usuario nuevo (mail o Google): queda pendiente.
    account = await createPendingAccount(user.id, user.email ?? "");
  }

  if (account.status === "pending") {
    return res.status(403).json({
      error: "Tu cuenta está esperando aprobación",
      code: "ACCOUNT_PENDING",
    });
  }
  if (account.status === "rejected") {
    return res.status(403).json({
      error: "Tu cuenta no fue aprobada. Contactá al administrador",
      code: "ACCOUNT_REJECTED",
    });
  }
  next();
}
```

Se aplica a **todas** las rutas, salvo `/auth/*` y `/health`. Para no repetirlo en cada archivo, se puede montar una sola vez en `app.ts`:

```ts
app.use("/auth", authRouter);           // sin aprobación (login, registro, /me)
app.use(authMiddleware, requireApproved); // de acá para abajo, todo requiere cuenta aprobada
app.use("/projects", Projectrouter);
// ...
```

> Ojo: hoy cada router llama a `authMiddleware` por su cuenta. Montarlo global obliga a revisar que no quede duplicado (no rompe nada, pero valida el token dos veces).

### Paso 3.4: `/auth/me` devuelve el estado

```ts
authRouter.get("/me", authMiddleware, async (req, res) => {
  const user = req.user!;
  const account = await getOrCreateAccount(user.id, user.email ?? "");
  const credits = await getCredits(user.id);
  return res.json({
    id: user.id,
    email: user.email,
    status: account.status,              // "pending" | "approved" | "rejected"
    is_admin: isAdmin(user.id),
    videos_available: credits.balance,
  });
});
```

**Ejemplo de respuesta de un alumno recién registrado:**

```json
{
  "id": "8c1e...",
  "email": "juan@gmail.com",
  "status": "pending",
  "is_admin": false,
  "videos_available": 0
}
```

### Paso 3.5: Pantalla de "cuenta pendiente"

Si `/auth/me` dice `pending`, el frontend muestra solo esto (en vez del dashboard):

```
┌──────────────────────────────────────────────┐
│                                              │
│        ⏳  Tu cuenta está pendiente          │
│                                              │
│   Seba tiene que aprobarla antes de que      │
│   puedas usar Scaler Tool.                   │
│                                              │
│   Escribile por WhatsApp para avisarle.      │
│                                              │
│        [ Ya me aprobaron, recargar ]         │
│                                              │
└──────────────────────────────────────────────┘
```

**✅ Cómo verificar:**
1. Registrarse con un mail nuevo → aparece la pantalla de pendiente.
2. Llamar a `GET /projects` con ese token → 403 `ACCOUNT_PENDING`.
3. Seba aprueba → recargar → entra al dashboard con 5 videos.

---

## Fase 4: Contador de videos

### Cómo funciona

1. El alumno aprieta **Renderizar**.
2. El sistema se fija si ese proyecto ya se cobró. Si ya se cobró, deja pasar sin descontar (es un re-render).
3. Si no se cobró y el alumno tiene 0 videos → bloquea con "Se terminaron tus videos".
4. Si tiene saldo → **descuenta 1 en ese momento** y el render arranca.
5. Si el render termina bien → queda descontado.
6. Si el render falla (después de todos los reintentos) → **devuelve el video.**

**¿Por qué descontar al apretar y no al terminar?** Si se descontara al final, un alumno con 1 video podría apretar Renderizar en 3 proyectos a la vez y los 3 pasarían el control, porque todavía no se descontó nada. Descontando al apretar, el segundo y el tercero ya ven saldo 0.

### Paso 4.1: Tablas

```sql
-- Saldo de videos de cada usuario.
create table public.video_credits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  used       integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Historial: cada carga, uso y devolución. Es lo que Seba mira para saber
-- quién pagó y cuánto.
create table public.video_credit_movements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      integer not null,  -- +10 carga, -1 uso, +1 devolución
  reason      text not null check (reason in
              ('welcome', 'admin_load', 'admin_remove', 'render', 'render_refund', 'extra_voice')),
  project_id  uuid references public.video_projects(id) on delete set null,
  note        text,              -- ej: "pagó 10 USD por transferencia"
  created_by  uuid references auth.users(id),  -- quién lo hizo (Seba o el sistema)
  created_at  timestamptz not null default now()
);

-- En el proyecto: si ya se cobró, y cuántas voces se generaron.
alter table public.video_projects
  add column render_charged boolean not null default false,
  add column voice_generations integer not null default 0;

-- Sin ningún acceso desde la key pública.
revoke all on public.video_credits, public.video_credit_movements from anon, authenticated;
```

### Paso 4.2: Función para descontar (atómica)

"Atómica" quiere decir que si llegan dos pedidos al mismo tiempo, la base los procesa de a uno. Así no pasa que dos renders se aprueben con 1 solo video.

```sql
-- Devuelve 'already_charged', 'charged' o 'no_credits'.
create or replace function public.charge_render(p_project_id uuid)
returns text
language plpgsql
as $$
declare
  v_owner uuid;
  v_charged boolean;
begin
  -- Bloquea la fila del proyecto hasta terminar (evita dobles cobros).
  select user_id, render_charged into v_owner, v_charged
  from public.video_projects where id = p_project_id
  for update;

  if v_charged then
    return 'already_charged';   -- re-render: no descuenta
  end if;

  -- Descuenta solo si hay saldo.
  update public.video_credits
  set balance = balance - 1, used = used + 1, updated_at = now()
  where user_id = v_owner and balance > 0;

  if not found then
    return 'no_credits';
  end if;

  update public.video_projects set render_charged = true where id = p_project_id;
  insert into public.video_credit_movements (user_id, amount, reason, project_id)
  values (v_owner, -1, 'render', p_project_id);
  return 'charged';
end;
$$;

-- Devolución si el render falla definitivamente.
create or replace function public.refund_render(p_project_id uuid)
returns void
language plpgsql
as $$
declare
  v_owner uuid;
  v_charged boolean;
begin
  select user_id, render_charged into v_owner, v_charged
  from public.video_projects where id = p_project_id
  for update;

  if not v_charged then return; end if;  -- nada que devolver

  -- Solo se devuelve si el proyecto NUNCA tuvo un render terminado bien.
  if exists (
    select 1 from public.assets
    where video_project_id = p_project_id
      and type = 'VIDEO' and metadata->>'kind' = 'final_render'
  ) then
    return;
  end if;

  update public.video_credits
  set balance = balance + 1, used = used - 1, updated_at = now()
  where user_id = v_owner;
  update public.video_projects set render_charged = false where id = p_project_id;
  insert into public.video_credit_movements (user_id, amount, reason, project_id)
  values (v_owner, 1, 'render_refund', p_project_id);
end;
$$;

-- Solo el backend puede llamarlas.
revoke all on function public.charge_render(uuid) from public, anon, authenticated;
revoke all on function public.refund_render(uuid) from public, anon, authenticated;
grant execute on function public.charge_render(uuid) to service_role;
grant execute on function public.refund_render(uuid) to service_role;
```

### Paso 4.3: Descontar al apretar Renderizar

Archivo `backend/src/modules/jobs/job.service.ts`, en `approveStockReview`, **antes** de pasar el job a `RENDERING`:

```ts
const { data: result, error: chargeError } = await supabase.rpc("charge_render", {
  p_project_id: job.video_project_id,
});
if (chargeError) {
  return res.status(500).json({ error: "No se pudo verificar tu saldo de videos" });
}
if (result === "no_credits") {
  return res.status(402).json({
    error: "Se terminaron tus videos. Contactá a Seba para cargar más",
    code: "NO_VIDEO_CREDITS",
  });
}
// 'charged' o 'already_charged': sigue y encola el render como hoy.
```

> Si después de descontar falla el update del job (por ejemplo, doble click), hay que llamar a `refund_render` para no cobrar un render que nunca arrancó.

### Paso 4.4: Devolver si el render falla

Hay tres lugares donde un render puede fallar definitivamente:

| Dónde | Archivo | Cuándo |
|---|---|---|
| Worker, último intento | `backend/src/worker.ts` → `handleFailure` | `attempts >= maxAttempts` y `job.queue === "render"` |
| Worker caído | `requeue_stale_jobs` (migración `job_queue`) | Cuando marca el job como `failed` sin más reintentos |
| Modo inline | `backend/src/modules/jobs/job.service.ts` | En el `.catch()` de `renderQueue.run(...)` |

En los tres:

```ts
await supabase.rpc("refund_render", { p_project_id: job.video_project_id });
```

**Importante:** en los reintentos intermedios **no** se devuelve nada. Solo en el fallo final. Por eso el render con 3 reintentos descuenta como mucho 1 vez.

### Paso 4.5: Tope de 3 voces por proyecto

En `generateVoice.tool.ts`, **solo cuando de verdad se va a llamar a ai33** (no cuando se reutiliza una voz existente):

```ts
const INCLUDED_VOICES = 3;

const reusable = await findReusableAudioAsset(/* ... */);
if (reusable) return reusable;   // reutilizar es gratis: no cuenta

const project = await getProject(script.video_project_id);
if (project.voice_generations >= INCLUDED_VOICES) {
  // A partir de la 4ª voz, descuenta 1 video (igual que un render).
  const result = await supabase.rpc("charge_extra_voice", { p_project_id: project.id });
  if (result === "no_credits") {
    throw new Error("Ya usaste las 3 voces incluidas de este proyecto y no te quedan videos");
  }
}
// ...genera la voz con ai33...
await incrementVoiceGenerations(project.id);
```

En el frontend, antes de la 4ª voz, aparece el aviso:

```
┌───────────────────────────────────────────────────────┐
│  ⚠️  Esta es la 4ª vez que generás la voz de este      │
│     proyecto. Las primeras 3 están incluidas.         │
│                                                       │
│     Regenerarla te descuenta 1 video.                 │
│     Te quedan 4 videos.                               │
│                                                       │
│     [ Cancelar ]          [ Sí, regenerar la voz ]    │
└───────────────────────────────────────────────────────┘
```

> Si el alumno sube su propio audio, el sistema no llama a ai33 y esto no aplica.

### Paso 4.6: ¿A quién se le descuenta en un workspace?

**Al dueño del proyecto** (`video_projects.user_id`), no al miembro invitado que aprieta el botón. Así funciona naturalmente con `charge_render`, que usa el `user_id` del proyecto.

**Ejemplo:** Juan invita a su editor Pedro a su workspace. Pedro aprieta Renderizar en un proyecto de Juan → se le descuenta a **Juan**.

### Ejemplos de punta a punta

**Caso normal:**

| Paso | Saldo de Juan | Proyecto "Video 1" cobrado |
|---|---|---|
| Seba lo aprueba | 5 | — |
| Renderiza "Video 1" | 4 | Sí |
| Cambia una escena y re-renderiza "Video 1" | 4 | Sí (no descuenta) |
| Renderiza "Video 2" | 3 | — |

**Render que falla:**

| Paso | Saldo |
|---|---|
| Tiene 3, aprieta Renderizar | 2 (reservado) |
| Intento 1 falla → reintenta | 2 |
| Intento 2 falla → reintenta | 2 |
| Intento 3 falla → fallo final | **3 (devuelto)** |

**Sin saldo:**

```http
POST /jobs/abc/approve-stock-review
→ 402 { "error": "Se terminaron tus videos. Contactá a Seba para cargar más",
        "code": "NO_VIDEO_CREDITS" }
```

**Doble click o dos pestañas con 1 video:**

| Pedido | Resultado |
|---|---|
| Proyecto A → Renderizar | `charged`, saldo 0 |
| Proyecto B → Renderizar (al mismo tiempo) | `no_credits`, bloqueado |

---

## Fase 5: Panel de administrador

### Paso 5.1: Hacer admin a Seba

Ya existe `requireAdmin` (`auth.middleware.ts:57`), que lee la variable de entorno `ADMIN_USER_IDS`. Agregar el UUID de Seba (se ve en Supabase → Authentication → Users):

```
ADMIN_USER_IDS=<uuid-de-joaquin>,<uuid-de-seba>
```

Cargarla en Render (la API) **y** en el worker si alguna vez la necesita.

### Paso 5.2: Rutas del admin

Archivo nuevo `backend/src/modules/admin/admin.route.ts`, todas con `authMiddleware` + `requireAdmin`:

| Método y ruta | Qué hace |
|---|---|
| `GET /admin/users?status=pending` | Lista de alumnos (filtrable por estado) |
| `POST /admin/users/:id/approve` | Aprueba la cuenta y le da los 5 videos de bienvenida |
| `POST /admin/users/:id/reject` | Rechaza la cuenta |
| `POST /admin/users/:id/credits` | Suma o resta videos con una nota |
| `GET /admin/users/:id/movements` | Historial de cargas, usos y devoluciones |

**Ejemplo: listar alumnos**

```http
GET /admin/users
```

```json
[
  {
    "id": "8c1e...",
    "email": "juan@gmail.com",
    "status": "approved",
    "videos_available": 3,
    "videos_used": 7,
    "created_at": "2026-10-18T14:02:00Z",
    "last_render_at": "2026-10-20T21:15:00Z"
  },
  {
    "id": "f04a...",
    "email": "maria@gmail.com",
    "status": "pending",
    "videos_available": 0,
    "videos_used": 0,
    "created_at": "2026-10-19T10:30:00Z",
    "last_render_at": null
  }
]
```

**Ejemplo: aprobar**

```http
POST /admin/users/f04a.../approve
→ 200 { "status": "approved", "videos_available": 5 }
```

Por dentro: `status = 'approved'`, `balance = 5`, y un movimiento `+5 welcome` con `created_by = Seba`. Si se aprueba dos veces, la segunda no vuelve a dar los 5.

**Ejemplo: cargar videos después de un pago**

```http
POST /admin/users/8c1e.../credits
Content-Type: application/json

{ "amount": 10, "note": "Pagó 10 USD por transferencia el 21/10" }
```

```json
{ "videos_available": 13 }
```

**Ejemplo: corregir un error** (cargó 10 de más):

```json
{ "amount": -10, "note": "Corrección: carga duplicada" }
```

Nunca puede quedar en negativo: si el alumno tiene 3 y se le restan 10, responde 400.

**Ejemplo: historial**

```http
GET /admin/users/8c1e.../movements
```

```json
[
  { "amount": 10, "reason": "admin_load",    "note": "Pagó 10 USD por transferencia el 21/10", "by": "seba@...",  "at": "2026-10-21T12:00:00Z" },
  { "amount": 1,  "reason": "render_refund", "project": "Video 4", "by": "sistema", "at": "2026-10-20T22:01:00Z" },
  { "amount": -1, "reason": "render",        "project": "Video 4", "by": "sistema", "at": "2026-10-20T21:50:00Z" },
  { "amount": -1, "reason": "render",        "project": "Video 3", "by": "sistema", "at": "2026-10-20T21:15:00Z" },
  { "amount": 5,  "reason": "welcome",       "note": null, "by": "seba@...", "at": "2026-10-18T14:10:00Z" }
]
```

### Paso 5.3: Pantalla del admin

Página nueva `frontend_v1/src/pages/AdminPage.tsx`, ruta `/admin`. El link "Administración" en el menú (`Sidebar.tsx`) aparece solo si `/auth/me` devuelve `is_admin: true`.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Administración                                                      │
│                                                                      │
│  [ Pendientes (2) ]  [ Aprobados (6) ]  [ Rechazados (0) ]           │
│                                                                      │
│  ── Pendientes ───────────────────────────────────────────────────── │
│  maria@gmail.com      registrada hace 2 h     [ Aprobar ] [ Rechazar ]│
│  pedro@hotmail.com    registrado hace 1 día   [ Aprobar ] [ Rechazar ]│
│                                                                      │
│  ── Aprobados ────────────────────────────────────────────────────── │
│  Alumno               Disponibles   Usados   Último render           │
│  juan@gmail.com            3           7     ayer 21:15   [ + Cargar ]│
│  lucia@gmail.com           0           5     hace 3 días  [ + Cargar ]│
│  ...                                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

Al tocar **"+ Cargar"**:

```
┌───────────────────────────────────────────┐
│  Cargar videos a juan@gmail.com           │
│                                           │
│  Tiene 3 videos disponibles.              │
│                                           │
│  Cantidad:  [ 10 ]   (negativo = restar)  │
│  Nota:      [ Pagó 10 USD transferencia ] │
│                                           │
│  [ Cancelar ]              [ Cargar ]     │
│                                           │
│  ── Historial ──────────────────────────  │
│  21/10  +10  Pagó 10 USD     (Seba)       │
│  20/10   -1  Video 3         (render)     │
│  18/10   +5  Bienvenida      (Seba)       │
└───────────────────────────────────────────┘
```

Los alumnos con 0 videos se pueden resaltar, para que Seba vea rápido a quién escribirle.

**✅ Cómo verificar:**
1. Un alumno común entra a `/admin` → no ve el link, y `GET /admin/users` responde 403.
2. Seba aprueba a un pendiente → el alumno pasa a aprobados con 5 videos.
3. Seba carga 10 → el saldo sube y aparece en el historial con su nota.

---

## Fase 6: Lo que ve el alumno

### Paso 6.1: Saldo en el menú

En `Sidebar.tsx`, con el dato de `/auth/me`:

```
┌─────────────────────┐
│  Scaler Tool        │
│                     │
│  🏠 Inicio          │
│  📁 Proyectos       │
│  ...                │
│                     │
│  ┌───────────────┐  │
│  │ 🎬 4 videos   │  │
│  │  disponibles  │  │
│  └───────────────┘  │
└─────────────────────┘
```

Con 0 videos, en rojo: "0 videos — contactá a Seba".

### Paso 6.2: Botón Renderizar

En `PreviewPanel.tsx` / `StockReviewPanel.tsx`, según el caso:

| Situación | Lo que muestra el botón |
|---|---|
| Primer render, tiene saldo | **Renderizar** · "Usa 1 video (te quedan 4)" |
| Re-render del mismo proyecto | **Renderizar de nuevo** · "No descuenta videos" |
| Sin saldo | Botón gris · "Se terminaron tus videos. Contactá a Seba" |

### Paso 6.3: Mensajes de error claros

| Código del backend | Mensaje para el alumno |
|---|---|
| `ACCOUNT_PENDING` | Pantalla de cuenta pendiente (Fase 3) |
| `ACCOUNT_REJECTED` | "Tu cuenta no fue aprobada. Contactá al administrador" |
| `NO_VIDEO_CREDITS` | "Se terminaron tus videos. Contactá a Seba para cargar más" |
| 409 en preview | "Ya se está generando la preview de este proyecto" |
| 429 | "Llegaste al máximo por hora, probá en un rato" |

Y después de un render, refrescar el saldo del menú.

---

## Fase 7: Extensión de Flow

### Cómo funciona hoy

- La extensión toma la sesión de la app sola (`app-bridge.js` lee el token del `localStorage`) y llama a la **misma API** que la app, con el token del alumno.
- Llama a: `GET /projects`, `GET /projects/:id/script`, `POST /scripts/:id/scenes/image-prompts` (arma los prompts con gpt-4o-mini, centavos) y `POST /scripts/:id/scenes/batch-visuals` (sube las imágenes).
- Las imágenes las genera **Flow con la cuenta de Google del alumno**: no les cuesta nada a ustedes.

### Qué cambia con este plan

**Paso 7.1: Aprobación de cuentas.** No hace falta tocar nada en la API: como la extensión usa los mismos endpoints, un alumno pendiente recibe 403 `ACCOUNT_PENDING` también desde la extensión. Lo que falta es **mostrar el mensaje** en el popup (`popup.js`), en vez de un error genérico:

```js
// popup.js: cuando la API responde 403 con code ACCOUNT_PENDING
if (err.code === "ACCOUNT_PENDING") {
  showMessage("Tu cuenta está esperando aprobación. Avisale a Seba.");
}
```

**Paso 7.2: Límite en los prompts.** `POST /scripts/:id/scenes/image-prompts` hoy no tiene límite. Lleva el límite de la Fase 2, paso 2.4. Es barato, pero así nadie lo puede usar en loop.

**Paso 7.3: Usar la extensión no descuenta videos.** Cargar imágenes de Flow es parte de armar el video; se descuenta recién al renderizar.

**Paso 7.4: Distribución a los alumnos.**
- Hoy se instala en "modo desarrollador" (cargar la carpeta descomprimida). Para 6 alumnos alcanza: armar un instructivo corto con capturas, o mostrarlo en vivo el sábado.
- El zip se arma con `frontend_v1/scripts/zip-extension.mjs` y se descarga desde la página de la extensión en la app (`FlowExtensionPage.tsx`). Verificar que el zip esté actualizado (versión `0.7.0` en `manifest.json`).
- Avisarles: cuando haya una versión nueva, tienen que bajar el zip de nuevo y tocar ↻ en `chrome://extensions`.

**Paso 7.5: El "Conectar a mano" de la extensión** (login con mail y contraseña) pasa por `/auth/login`, que ya tiene límite de velocidad. No hace falta cambiar nada.

**✅ Cómo verificar:**
1. Con una cuenta pendiente, abrir la extensión → aparece "Tu cuenta está esperando aprobación".
2. Con una cuenta aprobada, cargar prompts y mandar a Flow → funciona como siempre y el saldo de videos no cambia.

---

## Fase 8: Prolijidad

Puede esperar después del sábado.

1. **Borrar `POST /auth/test`** (`auth.route.ts:19`): es público y no hace nada.
2. **Límite de velocidad en `/auth/refresh` y `/auth/oauth`**, igual que en login.
3. **`redirect_to` de `/auth/oauth`:** solo aceptar URLs del frontend propio. Verificar también la lista de URLs permitidas en Supabase → Authentication → URL Configuration.
4. **Errores crudos:** ~55 lugares hacen `res.status(400).json({ error: error.message })`. Reemplazar por un mensaje genérico y loguear el detalle en el servidor.
5. **Límite de velocidad en memoria:** se resetea cuando se reinicia la API. Con una sola instancia alcanza; si algún día hay más de una, pasarlo a la base o a Redis.

---

## Cómo probar todo antes del sábado

Hacerlo con **dos cuentas de prueba**: una de alumno y la de Seba (admin).

### Checklist

**Aprobación**
- [ ] Me registro con un mail nuevo → veo "cuenta pendiente".
- [ ] Me registro con Google → también queda pendiente.
- [ ] Con la cuenta pendiente, la extensión muestra el mensaje de pendiente.
- [ ] Seba me aprueba → recargo y tengo 5 videos.
- [ ] Seba rechaza otra cuenta → esa cuenta ve "no fue aprobada".

**Contador**
- [ ] Armo un proyecto y la preview → sigo con 5.
- [ ] Renderizo → bajo a 4.
- [ ] Re-renderizo el mismo proyecto → sigo con 4.
- [ ] Fuerzo un render que falle (por ejemplo, apagando el worker a mitad de camino) → vuelvo al saldo anterior después del último intento.
- [ ] Gasto todo hasta 0 → el botón Renderizar queda bloqueado con el mensaje.
- [ ] Seba me carga 10 → puedo renderizar de nuevo.
- [ ] Con 1 video, aprieto Renderizar en dos proyectos a la vez → solo pasa uno.

**Voces**
- [ ] Genero la voz, cambio el guion, la genero de nuevo 2 veces más → no descuenta.
- [ ] La 4ª vez aparece el aviso y, si acepto, descuenta 1.
- [ ] Rehago la preview sin cambiar el guion → no se genera voz nueva.

**Seguridad**
- [ ] Con la key pública, intento escribir en `projects`, `jobs` y `video_credits` → error de permisos.
- [ ] La barra de progreso del render sigue funcionando (Realtime).
- [ ] `POST /tools/generate_video/execute` → 404.
- [ ] `generate_voice` con un texto inventado → genera la voz del guion guardado.
- [ ] `preview_voice` 5 veces → ai33 cobra una sola vez (mirar el saldo de ai33 antes y después).
- [ ] Un alumno común entra a `/admin` → no puede.

### Orden recomendado de trabajo

| Orden | Fase | Por qué en este orden |
|---|---|---|
| 1 | Fase 1: acceso directo a la base | Sin esto, todo lo demás se puede saltear |
| 2 | Fase 0: sacar IA | Rápido y cierra un gasto grande |
| 3 | Fase 2: gastos sin control | Cierra los "90 USD por hora" |
| 4 | Fase 3: aprobación de cuentas | Cierra el truco de muchas cuentas |
| 5 | Fase 4: contador | El corazón del cobro |
| 6 | Fase 5: panel de admin | Para que Seba apruebe y cargue |
| 7 | Fase 6: lo que ve el alumno | Para que se entienda |
| 8 | Fase 7: mensajes de la extensión | Detalle de UX |
| 9 | Fase 8: prolijidad | Después del sábado |

**Mínimo para el sábado: fases 1, 0, 2, 3, 4 y 5.** La 6 puede ser simple (solo el saldo en el menú y el mensaje de "sin videos").

---

## Decisiones pendientes

| # | Pregunta | Propuesta | Cómo quedó |
|---|---|---|---|
| 1 | ¿Cuántos videos gratis al aprobar? | 5 | 5 (`WELCOME_VIDEOS`) |
| 2 | ¿Cuántas voces incluidas por proyecto? | 3 | ⏳ A definir con Seba (no implementado) |
| 3 | ¿Tope de largo del guion? | 40.000 caracteres (~40 min) | 35.000 (`MAX_SCRIPT_CHARS`) |
| 4 | ¿Precio del paquete después de los gratis? | 20 USD por 10 videos (con 6 alumnos, 10 USD no cubre los servidores) | 25 USD por 20 videos (el admin carga 20 por defecto) |
| 5 | ¿Qué modelo genera el guion? | Revisar el provider; si es Opus, evaluar uno más barato | `claude-sonnet-5` (no es Opus) |
| 6 | ¿Tope de previews por hora? | 10 por usuario | 10 por usuario |
| 7 | ¿Nombre de contacto en los mensajes? | "Seba" (o un WhatsApp) | "el administrador" |
| 8 | ¿Los videos cargados vencen? | No, por ahora | No vencen |
