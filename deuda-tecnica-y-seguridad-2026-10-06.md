# Deuda técnica, seguridad y camino a monetización — Scaler Tool

**Fecha:** 2026-10-06 · **Estado del repo:** commit `a42fc28`
**Contexto:** hoy la plataforma la usan 3 personas para probarla. Este documento junta todo lo que hay que arreglar antes de abrir registro público y cobrar una suscripción. Todavía **no se aplicó nada**.

Reemplaza a `auditoria-scaler-tool-2026-09-17.md`. De esa auditoría ya están resueltos: IDOR en `generate_voice`/`transcribe_audio`/`render_video`, `/providers` gateado a admin (`ADMIN_USER_IDS`), rate limit en `/auth/*` y `/tools/*/execute`, zod en auth/providers, errores genéricos al cliente en tools/auth, guarda de `DISABLE_AUTH` en producción, `revoke` sobre `providers` y borrado de proyectos.

---

## Cómo usar este documento

Cada ítem tiene un ID (`SEC-1`, `DEB-3`, `COM-2`…), severidad, evidencia en el código y un **prompt listo para pegar en Claude Code**. Recomendación:

1. Un ítem (o un grupo chico del mismo bloque) por sesión/branch/PR.
2. Respetar el orden de la sección "Plan por fases" — hay dependencias (ej: créditos antes que Stripe).
3. Al empezar cada sesión, pegar primero este encabezado común:

```
Contexto: repo scaler_tool. Backend Express + TypeScript en backend/src, frontend React/Vite en
backend/frontend_v1, Supabase (el backend usa service_role), migraciones en backend/supabase/migrations.
Leé backend/claude/CLAUDE.md y deuda-tecnica-y-seguridad-2026-10-06.md antes de tocar nada.
Hacé cambios mínimos, mantené el estilo de comentarios en español del proyecto, corré
`npx tsc --noEmit` en backend y frontend antes de commitear, y explicá qué probaste.
```

Leyenda: 🔴 crítico (resolver ya) · 🟠 alto (antes de abrir registro) · 🟡 medio · 🟢 bajo

---

## Resumen / tablero

| ID | Sev. | Tema | Esfuerzo |
|---|---|---|---|
| SEC-1 | 🔴 | Toda la base de datos legible/escribible con la anon key (RLS apagado) | Bajo |
| SEC-2 | 🔴 | Sin control de gasto: pipeline, lotes de escenas y render sin rate limit ni límite de concurrencia | Medio |
| SEC-3 | 🟠 | Renders en URL pública y predecible | Medio |
| SEC-4 | 🟠 | API keys de proveedores en texto plano en la DB | Medio |
| SEC-5 | 🟡 | `redirect_to` de OAuth sin validar | Bajo |
| SEC-6 | 🟡 | `/auth/refresh` sin rate limit y devuelve mensaje crudo | Bajo |
| SEC-7 | 🟡 | Errores crudos de Postgres en varios endpoints | Bajo |
| SEC-8 | 🟡 | `voice_id` sin sanitizar en la key de storage | Bajo |
| SEC-9 | 🟡 | Extensión de Chrome: permisos `debugger` y automatización de Google Flow | Alto |
| SEC-10 | 🟢 | Tokens en `localStorage` sin CSP | Bajo |
| DEB-1 | 🟠 | Esquema base de la DB no está en migraciones | Medio |
| DEB-2 | 🟠 | Pipeline corre dentro del proceso de la API (modo `inline`) | Bajo |
| DEB-3 | 🟠 | Cero tests y sin CI | Medio |
| DEB-4 | 🟠 | Sin observabilidad (solo `console.log`) | Bajo |
| DEB-5 | 🟡 | Borrar proyecto no borra archivos de storage | Medio |
| DEB-6 | 🟡 | Cola FIFO global sin fairness ni prioridad | Medio |
| DEB-7 | 🟡 | Reintentar el pre-render vuelve a pagar todo (sin idempotencia por paso) | Alto |
| DEB-8 | 🟡 | `tool_executions` guarda inputs completos para siempre | Bajo |
| DEB-9 | 🟡 | Binarios y docs pesados versionados en git | Bajo |
| DEB-10 | 🟡 | Dependencia frágil de ai33.pro (multi-cuenta por saldo) | Medio |
| DEB-11 | 🟢 | Duplicaciones/consistencia (ffmpeg, mocks, tipos jsonb, fetch duplicado, errores en frontend) | Medio |
| COM-1 | — | Sistema de créditos y medición de uso | Alto |
| COM-2 | — | Planes y límites por plan | Medio |
| COM-3 | — | Integración de pagos (Stripe / Paddle / Mercado Pago) | Alto |
| COM-4 | — | Legales: términos, privacidad, borrado de cuenta | Medio |
| COM-5 | — | Emails transaccionales | Medio |
| COM-6 | — | Panel de admin interno | Medio |
| COM-7 | — | Landing, onboarding y analítica de producto | Medio |
| COM-8 | — | Entornos staging/producción y backups | Medio |

---

## 1. Seguridad

### SEC-1 🔴 La base de datos entera es accesible con la anon key

**Problema.** RLS está deshabilitado en todas las tablas de `public` y la anon key de Supabase está en el bundle del frontend (`frontend_v1/src/lib/supabaseClient.ts:10`). Solo `providers` tiene los grants revocados (`20260917010000_revoke_providers_grants.sql`). Con la anon key cualquiera puede pegarle directo a PostgREST (`https://<proyecto>.supabase.co/rest/v1/<tabla>`) y:

- **Leer** `video_projects`, `scripts`, `scenes`, `jobs`, `assets`, `workspaces`, `workspace_members`, `workspace_invites` (incluido el `token` de cada invitación), `script_styles` (los Prompt Maestro), `stock_library_entries`, `tool_executions` (inputs completos).
- **Escribir**: insertarse en `workspace_members` de cualquier workspace, cambiar `jobs.status`, borrar proyectos ajenos.

Evidencia de que la anon key lee tablas: el frontend se suscribe a cambios de `jobs` por Realtime solo con la anon key (`frontend_v1/src/features/preview/PreviewPanel.tsx:321-337`).

**Solución.** El backend usa `service_role` (bypassa grants), así que revocar a `anon`/`authenticated` no rompe el backend. Lo único que se rompe es la suscripción Realtime de `PreviewPanel`, que hay que reemplazar.

```
Tarea SEC-1: cerrar el acceso directo a la base de datos con la anon key.

Hoy RLS está apagado en todo el schema public y solo `providers` tiene revocados los grants
(ver backend/supabase/migrations/20260917010000_revoke_providers_grants.sql). Cualquiera con la
anon key (que está en el bundle del frontend) puede leer y escribir todas las tablas vía PostgREST.

1. Creá una migración nueva en backend/supabase/migrations que:
   - haga `revoke all on all tables in schema public from anon, authenticated;`
   - haga lo mismo con sequences y functions de public;
   - agregue `alter default privileges in schema public revoke all on tables from anon, authenticated;`
     (y para sequences/functions) para que las tablas FUTURAS nazcan cerradas.
   Comentá en la migración por qué (mismo estilo que la de providers).
2. Antes, buscá en backend/frontend_v1/src todo uso directo del cliente de Supabase
   (`supabase.from`, `supabase.channel`, `supabase.storage`). Hoy el único conocido es la
   suscripción Realtime a `jobs` en src/features/preview/PreviewPanel.tsx (~línea 321).
   Reemplazala por una de estas dos opciones (elegí la más simple y justificá):
   a) polling al endpoint del backend GET /jobs/:job_id cada 3-5 s mientras el job no esté en
      estado terminal (DONE/FAILED/CANCELLED), con backoff y cortando al desmontar; o
   b) un endpoint SSE en el backend (GET /jobs/:job_id/events) que valide ownership con
      getOwnedJob(..., "viewer") y empuje cambios.
3. Verificá que el auth del frontend (login/refresh/OAuth) pasa todo por el backend y no
   necesita grants en public.
4. Escribí en el PR los pasos para aplicar la migración en Supabase y un comando curl para
   comprobar que `GET /rest/v1/video_projects?select=*` con la anon key devuelve error 401/403.

Criterio de aceptación: con la anon key ninguna tabla de public es legible ni escribible; la
barra de progreso del render sigue actualizándose; `npx tsc --noEmit` pasa en backend y frontend.
```

---

### SEC-2 🔴 Sin control de gasto por usuario

**Problema.** El registro es abierto y no existe ninguna noción de cuota. El rate limit (`backend/src/middleware/rateLimit.middleware.ts`) solo cubre `/auth/*` y `POST /tools/:tool_name/execute`. Quedan sin límite endpoints que disparan llamadas pagas (ai33/TTS, Whisper, LLM, imagen/video IA) o ffmpeg:

- `POST /projects/:project_id/pipeline/run` (`modules/pipeline/pipeline.service.ts`) — además **no verifica si ya hay un pipeline activo** para el proyecto: se pueden lanzar N en paralelo.
- `POST /scripts/:script_id/scenes/image-prompts` y el endpoint de lote (`modules/scenes/scene.route.ts:32-40`).
- `POST /scenes/:scene_id/regenerate-visual`.
- `POST /jobs/:job_id/approve-stock-review` (encola el render).
- `POST /script-styles/:id/generate` (LLM).
- `POST /files/extract-text` (parseo de PDF/DOCX de hasta 10 MB en memoria).

**Solución corta** (antes de tener créditos — ver COM-1 para la definitiva):

```
Tarea SEC-2: limitar el gasto que un usuario puede generar.

1. En backend/src/middleware/rateLimit.middleware.ts creá un limiter `costlyActionsLimiter`
   (por usuario, keyGenerator req.user!.id, como toolsRateLimiter) con ventana y límite
   configurables por env usando envInt de lib/env.ts. Aplicalo (después de authMiddleware) a:
   - POST /projects/:project_id/pipeline/run
   - POST /scripts/:script_id/scenes/image-prompts y el POST de lote en scene.route.ts
   - POST /scenes/:scene_id/regenerate-visual
   - POST /jobs/:job_id/approve-stock-review
   - POST /script-styles/:script_style_id/generate
   - POST /files/extract-text (este con un limiter propio más laxo)
2. En pipeline.service.ts::runPipeline, antes de insertar el Job, rechazá con 409 si ya existe
   un job del mismo video_project_id con status en (QUEUED, RUNNING, RENDERING,
   AWAITING_STOCK_REVIEW) — revisá en job.service.ts cuáles son los estados reales no
   terminales. Mismo chequeo en approveStockReview para no encolar dos renders del mismo proyecto.
   Para evitar carreras, agregá en una migración un índice único parcial sobre jobs
   (video_project_id) where status in (...no terminales...) y manejá el error 23505 como 409.
3. Agregá un límite global de jobs activos por usuario (env MAX_ACTIVE_JOBS_PER_USER, default 2)
   contando jobs no terminales de proyectos a los que el usuario tiene acceso de editor.
4. Mensajes de error en español y genéricos, mismo formato { error } que el resto.

Criterio de aceptación: no se pueden crear dos pipelines activos del mismo proyecto (ni con
dos requests simultáneas), y cada endpoint caro responde 429 al pasar el límite.
```

---

### SEC-3 🟠 Renders con URL pública y predecible

**Problema.** El render final se sube a un bucket público de Supabase (`createBucket(RENDER_BUCKET, { public: true })`, `tools/renderVideo.tool.ts:281`) o a Cloudinary con `public_id = videoProjectId` (`renderVideo.tool.ts:266`) o a R2 con URL pública (`lib/r2.ts:59`). Quien tenga el UUID del proyecto (o la URL) puede descargar el video para siempre, aunque le saquen acceso al workspace. Lo mismo aplica probablemente a audios/visuales de escenas.

```
Tarea SEC-3: que los archivos generados no sean públicos.

1. Relevá todos los lugares donde se suben archivos (grep de getPublicUrl, uploadFileToR2,
   cloudinary, storage.from) en backend/src y listá qué bucket/proveedor usa cada tipo
   (render final, audio de voz, visuales de escena, previews de voz).
2. Para el render final y los audios/visuales de proyectos: guardá solo la storage key en
   `assets` y generá URLs firmadas con vencimiento corto (ej. 1 h) al servirlas:
   - Supabase Storage: bucket privado + createSignedUrl.
   - R2: presigned GET con @aws-sdk/s3-request-presigner.
   - Cloudinary: type "authenticated" + URL firmada (o dejar de usar Cloudinary para renders).
   Las URLs se firman en los endpoints que ya validan ownership (getProjectDetail, assets list),
   nunca guardadas firmadas en la DB.
3. Usá nombres no predecibles (ej. `${videoProjectId}/${randomUUID()}.mp4`).
4. Los previews de voz (previews/...) pueden seguir públicos: no son datos de usuarios.
5. Escribí una nota de migración para los assets ya existentes (script o pasos manuales).

Criterio de aceptación: con solo el UUID del proyecto no se puede bajar el video; el
frontend sigue reproduciendo y descargando el render normalmente.
```

---

### SEC-4 🟠 API keys de proveedores en texto plano

**Problema.** `providers.api_key` y `providers.configuration` guardan secretos (OpenAI, Anthropic, ai33 — varias cuentas —, Cloudinary, R2) en texto plano. SEC-1 cierra el acceso externo, pero un dump/backup de la DB o un acceso indebido al dashboard expone todo.

```
Tarea SEC-4: sacar los secretos de proveedores de la tabla providers.

Evaluá y proponé (sin implementar todavía, primero mostrame la propuesta) una de:
a) Secretos en variables de entorno del backend/worker (OPENAI_API_KEY, AI33_API_KEYS
   separadas por coma, R2_SECRET_ACCESS_KEY, etc.) y `providers` solo con configuración
   no sensible + flag is_active.
b) Supabase Vault (vault.secrets) con una función security definer accesible solo por
   service_role que devuelva el secreto por slug.
Tené en cuenta: hoy el admin cambia keys desde /providers sin redeploy (ver
modules/providers), lib/ai33.ts maneja varias cuentas y elige por saldo, y el worker
(src/worker.ts) también lee providers. Listá todos los lugares que leen api_key.
Después de que apruebe la opción, implementala con una migración que mueva los datos.
```

---

### SEC-5 🟡 `redirect_to` de OAuth sin validar

`GET /auth/oauth/:provider` (`modules/auth/auth.route.ts`) acepta cualquier `req.query.redirect_to`. Hoy lo frena la allowlist de Redirect URLs de Supabase, pero si alguien agrega un wildcard ahí queda un open redirect con el token en el fragmento.

```
Tarea SEC-5: en backend/src/modules/auth/auth.route.ts, validá `redirect_to` contra una
allowlist (mismos orígenes que allowedOrigins de app.ts + FRONTEND_ORIGIN) y que el path sea
/auth/callback. Si no matchea, usá el default. Extraé allowedOrigins a un módulo compartido
(ej. lib/origins.ts) para no duplicarlo.
```

### SEC-6 🟡 `/auth/refresh` sin rate limit y con mensaje crudo

```
Tarea SEC-6: en backend/src/modules/auth/auth.route.ts aplicá authRateLimiter (o uno propio
más laxo) a POST /auth/refresh, validá el body con zod, y devolvé un mensaje genérico
("Sesión vencida, iniciá sesión de nuevo") logueando el error real con console.error.
Hacé lo mismo con el catch de /auth/oauth/:provider que hoy devuelve error.message.
```

### SEC-7 🟡 Errores crudos de Postgres al cliente

Sigue el patrón `res.status(400).json({ error: error.message })` en varios módulos (ej. `project.service.ts:81`, `pipeline.service.ts` con `jobError?.message`, `workspace.service.ts:250`, scenes, scripts, assets, jobs).

```
Tarea SEC-7: centralizar el manejo de errores del backend.

1. Creá backend/src/lib/httpErrors.ts con una clase HttpError(status, publicMessage) y un
   middleware de error de Express registrado al final de app.ts que: si es HttpError devuelve
   su mensaje; si no, loguea el error completo y devuelve 500 { error: "Error interno, intentá
   de nuevo" }.
2. Buscá con grep todos los `json({ error: error.message` / `error?.message` / `jobError?.message`
   en backend/src/modules y reemplazalos por un mensaje genérico + console.error, o por
   HttpError cuando el mensaje sea seguro (validaciones propias).
3. No cambies los códigos de estado existentes salvo que estén mal (justificá).
Criterio: ningún mensaje de Postgres/PostgREST llega al cliente.
```

### SEC-8 🟡 `voice_id` sin sanitizar en storage

`tools/previewVoice.tool.ts:50,66` arma `previews/${voice_id}-${hash}` con input del usuario.

```
Tarea SEC-8: en backend/src/tools/previewVoice.tool.ts validá voice_id con un regex estricto
(ej. /^[A-Za-z0-9_.:-]{1,100}$/) antes de usarlo en la storage key, y limitá sample_text a
un largo máximo razonable (ej. 300 caracteres) porque cada preview cuesta créditos de ai33.
Revisá si hay otras storage keys armadas con input del usuario (grep de template strings con
`/` en tools/ y modules/).
```

### SEC-9 🟡 Extensión de Chrome (Google Flow)

`flow-extension/manifest.json` pide `debugger`, `tabs`, `scripting` y `optional_host_permissions` `https://*/*`, y automatiza `labs.google` / `flow.google.com`. Riesgos: (1) automatizar Flow probablemente viola los términos de Google — no se puede vender como parte central del producto; (2) la Chrome Web Store revisa fuerte `debugger`; (3) `app-bridge.js` lee los tokens del `localStorage` de la app y solo matchea localhost — en producción hay que revisar cómo se conecta.

```
Tarea SEC-9 (análisis, no implementar): revisá flow-extension/ y explicame:
1. qué datos (tokens de la app, cookies de Google) lee, dónde los guarda y a quién se los manda;
2. qué permisos son imprescindibles y cuáles se pueden sacar (debugger, optional https://*/*);
3. cómo se conecta a la app en producción (app-bridge.js solo matchea localhost);
4. una alternativa con API oficial de generación de imágenes (Vertex AI Imagen, OpenAI images,
   Flux/Replicate) con costo estimado por imagen, reutilizando generateImage.tool.ts.
Dejá el resultado en un .md en la raíz.
```

### SEC-10 🟢 Tokens en `localStorage` sin CSP

`frontend_v1/src/lib/api.ts` guarda access y refresh token en `localStorage`. Mitigación barata: Content-Security-Policy.

```
Tarea SEC-10: agregá headers de seguridad al frontend en backend/frontend_v1/netlify.toml
(Content-Security-Policy restrictiva con connect-src al backend y a Supabase, X-Frame-Options
DENY, Referrer-Policy, Permissions-Policy) y `helmet` al backend Express. Probá con `npm run
build && npx vite preview` que la app carga sin errores de CSP en consola.
```

---

## 2. Deuda técnica

### DEB-1 🟠 El esquema base de la DB no está versionado

Las migraciones solo contienen `alter`s y tablas nuevas; `video_projects`, `scripts`, `scenes`, `jobs`, `assets`, `tool_executions`, `workspaces`, `workspace_members`, `workspace_invites`, `providers`, etc. se crearon desde el dashboard. No se puede levantar staging ni recuperar la DB desde el repo.

```
Tarea DEB-1: versionar el esquema completo.
Guiame paso a paso (yo corro los comandos con acceso a Supabase) para:
1. instalar la Supabase CLI, `supabase link` al proyecto y `supabase db dump --schema public
   -f backend/supabase/migrations/00000000000000_baseline.sql` (solo schema, sin datos);
2. revisar que el baseline no duplique lo que crean las migraciones existentes (usar
   `create ... if not exists` o marcarlo como ya aplicado con `supabase migration repair`);
3. levantar un Supabase local (`supabase start`) y verificar que todas las migraciones
   aplican de cero;
4. documentar el flujo en backend/supabase/README.md.
```

### DEB-2 🟠 El pipeline corre dentro del proceso de la API

Con `EXECUTION_MODE=inline` (default, `lib/jobQueue.ts`) el pre-render y el render corren en la API (`pipeline.service.ts:58`); un deploy o reinicio deja jobs colgados en RUNNING. El modo `queue` + worker ya existe (`src/worker.ts`, `WORKER_DEPLOY.md`).

```
Tarea DEB-2: dejar el modo cola como default de producción.
1. Revisá src/worker.ts, lib/jobQueue.ts y WORKER_DEPLOY.md y listá qué falta para que
   EXECUTION_MODE=queue sea el único modo en producción (deploy del worker en render.yaml
   como servicio "worker", variables, health).
2. Agregá al arranque de la API (server.ts) un chequeo: en NODE_ENV=production con modo
   inline, loguear un warning claro.
3. Agregá al worker un barrido al arrancar de jobs inline huérfanos (status RUNNING/RENDERING
   sin queue_state y con started_at viejo) que los marque FAILED con mensaje visible.
```

### DEB-3 🟠 Cero tests y sin CI

`backend/package.json` tiene `"test": "echo Error..."`, no hay vitest/jest ni carpeta `.github/`.

```
Tarea DEB-3: base de tests y CI.
1. Agregá vitest al backend. Escribí primero tests unitarios de lógica pura sin red:
   lib/ownership.ts (roleAtLeast), lib/wordAlignment.ts, lib/stockSegments.ts, lib/errors.ts
   (redactSecrets/providerApiError), lib/env.ts.
2. Tests de integración de rutas con supertest mockeando lib/supabase.ts: que un usuario sin
   acceso reciba 404 en GET /projects/:id, PATCH /scenes/:id, POST /tools/generate_voice/execute
   con script ajeno, y DELETE /projects/:id con rol editor.
3. Agregá vitest al frontend con un test de src/features/scenes/matchSceneFiles.ts.
4. Creá .github/workflows/ci.yml que en cada PR corra: npm ci, tsc --noEmit y tests en
   backend y en backend/frontend_v1, y el build del frontend.
```

### DEB-4 🟠 Sin observabilidad

Solo `console.log`/`console.error`. Un error de un cliente pago no se puede rastrear ni alertar.

```
Tarea DEB-4: observabilidad mínima.
1. Integrá Sentry en backend (API y worker, con tags user_id, job_id, video_project_id) y en
   el frontend (con ErrorBoundary). DSN por env var; deshabilitado si no está seteado.
2. Reemplazá console.* del backend por un logger estructurado (pino) con request id por request.
3. No loguear nunca tokens, api keys ni guiones completos (reusar redactSecrets de lib/errors.ts).
```

### DEB-5 🟡 Borrar un proyecto no borra sus archivos

`deleteProject` (`modules/projects/project.service.ts:63-92`) borra la fila; los archivos en Supabase Storage / R2 / Cloudinary quedan para siempre (costo creciente).

```
Tarea DEB-5: limpieza de storage al borrar.
1. Listá qué archivos genera un proyecto y dónde (render, voz, visuales de escena, uploads).
2. En deleteProject, antes de borrar la fila, juntá las storage keys de sus assets y después
   de borrar la fila encolá/ejecutá el borrado de archivos (best effort, sin bloquear la
   respuesta, logueando fallas). Hacé lo mismo al reemplazar el visual de una escena y al
   re-renderizar (el render viejo).
3. Script one-off en backend/scripts/ para detectar y borrar huérfanos existentes (dry-run
   por default).
```

### DEB-6 🟡 Cola FIFO global, sin fairness ni prioridad

`claim_next_job` (migración `20260925000000_job_queue.sql`) toma el job pendiente más viejo de toda la cola. Un usuario con 10 renders bloquea al resto; no hay forma de priorizar planes pagos.

```
Tarea DEB-6: fairness en la cola.
Nueva migración que reemplace claim_next_job para:
1. no tomar jobs de un user_id que ya tenga >= N jobs 'claimed' en esa cola (N por parámetro);
2. ordenar por una columna nueva `priority` (int, default 0) desc y después created_at;
mantené FOR UPDATE SKIP LOCKED y los grants solo a service_role. Actualizá worker.ts y
pendingQueueFields (lib/jobQueue.ts) para setear priority (por ahora 0; COM-2 la va a usar).
```

### DEB-7 🟡 Reintentar el pre-render vuelve a pagar todo

`lib/jobQueue.ts` lo documenta: el pre-render no se reintenta porque volvería a cobrar TTS, Whisper y video IA, y `build_scenes` borra/recrea escenas.

```
Tarea DEB-7 (diseño primero): proponé cómo hacer idempotente cada paso de
pipeline/orchestrator.ts (reusar el audio si el texto del guion + voz no cambiaron — hash —,
reusar la transcripción si el audio es el mismo, no regenerar visuales de escenas que ya
tienen asset). Mostrame la propuesta antes de implementar.
```

### DEB-8 🟡 `tool_executions` crece sin límite y guarda datos personales

`tools/toolRegistry.ts:45` guarda el `input` completo (guiones enteros) y el output.

```
Tarea DEB-8: agregá user_id y una columna cost/units a tool_executions (base para COM-1),
truncá input/output guardados a un tamaño máximo (ej. 4 KB por campo), y una función/cron de
retención que borre filas de más de 90 días.
```

### DEB-9 🟡 Binarios y documentos en git

Versionados: `backend/frontend_v1/AI Video Creation Frontend.zip`, `backend/claude/*.pdf`, `*.docx`, `backend/frontend_v1/.figma/`, `src/imports/pasted_text/`.

```
Tarea DEB-9: mové la documentación de backend/claude/ a docs/ (convirtiendo .docx/.pdf a .md
si es texto útil), borrá el .zip del frontend y .figma/ si no se usan (confirmá con grep que
nada los referencia), y agregá las extensiones al .gitignore. No reescribas historia.
```

### DEB-10 🟡 Dependencia frágil de ai33.pro

`lib/ai33.ts` usa varias cuentas y elige la de más saldo. Funciona como parche, pero es un revendedor: riesgo de caída, de cambio de precios y de licencia para uso comercial.

```
Tarea DEB-10 (análisis): documentá la interfaz que usa el proyecto para TTS (generateVoice,
previewVoice, listVoices, edgeTts) y proponé una abstracción TtsProvider con implementaciones
ai33 / ElevenLabs directo / Azure o Edge TTS, con costo por 1.000 caracteres de cada una y
qué voces se perderían. Sin implementar.
```

### DEB-11 🟢 Consistencia y duplicación

Pendientes de la auditoría anterior que conviene verificar:
- `runFfmpeg()` duplicada entre `renderVideo.tool.ts` y `transcribeAudio.tool.ts`.
- Patrón "provider no configurado → mock → error" repetido en ~7 tools.
- `scenes.content` (jsonb) casteado con formas distintas en varios archivos sin tipo compartido.
- Fetch duplicado a `/projects/:id/assets` en el frontend (`projects.service.ts`).
- `getProjectDetail` con queries secuenciales paralelizables.
- Sin paginación en el listado de proyectos.
- Handlers del frontend sin `catch` (botones colgados en "Guardando...").
- `renderVideo.tool.ts` tiene 1.126 líneas.

```
Tarea DEB-11: verificá cuáles de estos puntos siguen vigentes (listados en
deuda-tecnica-y-seguridad-2026-10-06.md, DEB-11) y resolvé solo los que sigan, un commit por
punto: extraer lib/ffmpeg.ts, helper resolveProviderOrMock, tipo compartido SceneContent con
parser zod, unificar el fetch de assets, Promise.all en getProjectDetail, paginación con
.range() en el listado de proyectos, y try/catch + toast en los handlers del frontend.
No partas renderVideo.tool.ts en esta tarea.
```

---

## 3. Lo que falta para cobrar una suscripción

### COM-1 Sistema de créditos y medición de uso (prerrequisito de todo lo demás)

Los costos son variables: caracteres de TTS, minutos de Whisper, tokens de LLM, imágenes/videos IA y minutos de render. Hay que medir el costo real antes de fijar precios.

```
Tarea COM-1: sistema de créditos.
Diseñá e implementá (mostrame el diseño antes de codear):
1. Migración con tablas:
   - usage_ledger (id, user_id, workspace_id null, job_id null, tool_name, units, unit_type
     [chars|seconds|tokens|images|render_seconds], cost_usd numeric, credits int, created_at)
   - credit_balances (user_id pk, balance int, period_start, period_end)
   - credit_reservations (id, user_id, job_id, credits, status [held|captured|released])
   Todo con grants revocados a anon/authenticated (ver SEC-1).
2. lib/credits.ts con reserve(userId, credits, jobId), capture(reservationId, actualCredits),
   release(reservationId) — atómico vía función SQL (no read-modify-write en Node).
3. Tabla de precios en código (lib/pricing.ts): credits por unidad de cada tool, con un
   estimador para el pipeline completo según largo del guion y cantidad de escenas.
4. Middleware requireCredits(estimator) en pipeline/run, approve-stock-review, lotes de
   escenas, regenerate-visual y tools pagas: reserva al encolar, el worker/orchestrator
   captura el real al terminar o libera si falla.
5. Que cada tool registre en usage_ledger las unidades reales consumidas.
6. Endpoint GET /me/usage y un bloque en SettingsPage con saldo y consumo del mes.
7. Env var CREDITS_ENFORCED=false por default para poder medir sin cobrar durante las pruebas.
```

### COM-2 Planes y límites por plan

```
Tarea COM-2: planes.
1. Tabla plans (id, slug, name, monthly_credits, max_concurrent_jobs, max_render_quality,
   max_workspaces, max_members, watermark bool, queue_priority int) con seed de: free, creator,
   pro, agency (valores placeholder que yo ajusto).
2. Tabla subscriptions (user_id, plan_id, status, current_period_start/end, provider,
   provider_customer_id, provider_subscription_id) — se llena desde COM-3.
3. lib/plans.ts: getUserPlan(userId) con cache corta; aplicar límites en: creación de
   workspace/miembros, render_quality permitido, jobs concurrentes (reusar SEC-2), prioridad
   de cola (DEB-6), marca de agua en el render para free (renderVideo.tool.ts, overlay ffmpeg).
4. Recarga mensual de créditos al inicio de cada período.
5. Frontend: mostrar el plan actual, límites y un CTA de upgrade cuando se choca un límite.
```

### COM-3 Integración de pagos

Opciones: **Stripe Billing** (más completo; impuestos a cargo tuyo), **Paddle / Lemon Squeezy** (merchant of record: manejan IVA/impuestos internacionales), **Mercado Pago suscripciones** (si el público es Argentina/LATAM).

```
Tarea COM-3: pagos con <PROVEEDOR ELEGIDO>.
1. Endpoint POST /billing/checkout (crea sesión de checkout para un plan) y POST /billing/portal
   (portal del cliente para cambiar plan, ver facturas, cancelar).
2. POST /billing/webhook con verificación de firma y body raw (ojo: va ANTES de express.json()
   en app.ts), idempotente por event id (tabla billing_events), que actualice subscriptions
   para: alta, renovación, cambio de plan, pago fallido (período de gracia), cancelación.
3. Variables de entorno para keys y price ids; nada hardcodeado.
4. Página de precios en el frontend y estado de suscripción en SettingsPage.
5. Probar con el modo test del proveedor y documentar cómo correr el webhook en local.
```

### COM-4 Legales y datos personales

```
Tarea COM-4:
1. Rutas públicas /terminos y /privacidad en el frontend (yo paso el texto; dejá placeholders)
   y checkbox de aceptación en el registro guardando accepted_terms_at.
2. Borrado de cuenta: endpoint DELETE /me que borre proyectos (con DEB-5), membresías,
   script_styles, stock_library_entries, cancele la suscripción y borre el usuario de Supabase
   Auth. Confirmación con modal en SettingsPage.
3. Export de datos del usuario (JSON con proyectos y guiones) — GET /me/export.
```

Revisar además con un abogado/contador: términos de ai33.pro, Pexels y Pixabay (atribución, uso comercial) y de Google Flow (ver SEC-9) para uso dentro de un SaaS pago; facturación e impuestos según el país.

### COM-5 Emails transaccionales

```
Tarea COM-5: integrá Resend (o Postmark) en backend/src/lib/email.ts con plantillas para:
render terminado, render fallido, invitación a workspace (hoy es solo un link), créditos al
80% y agotados, pago fallido, bienvenida. Envío desde el worker/endpoints correspondientes,
desactivable por env, sin bloquear la request si falla.
```

### COM-6 Panel de admin interno

```
Tarea COM-6: ruta /admin en el frontend y endpoints /admin/* gateados con requireAdmin:
listado de usuarios con plan, consumo del mes y costo real (usage_ledger); jobs fallidos con
error y botón de reintentar; saldo de cuentas de ai33; ajuste manual de créditos con motivo
(queda en usage_ledger).
```

### COM-7 Landing, onboarding y analítica

```
Tarea COM-7:
1. Landing pública en / (la app pasa a /app) con propuesta de valor, ejemplos de videos,
   precios (desde plans) y CTA de registro.
2. Onboarding de primer uso: crear workspace/canal → plantilla → primer proyecto guiado.
3. PostHog (o similar) con eventos: signup, project_created, script_generated,
   pipeline_started, render_done, checkout_started, subscription_started.
```

### COM-8 Entornos y backups

```
Tarea COM-8: documentá y configurá un entorno de staging (proyecto Supabase aparte, servicios
de Render aparte, deploy preview de Netlify) usando las migraciones de DEB-1, con
MOCK_PROVIDERS=true por default en staging. Checklist de backups: plan de Supabase con PITR,
lifecycle de R2 para renders viejos según plan.
```

---

## Plan por fases

**Fase 0 — esta semana (mientras lo usan 3 personas)**
SEC-1 → SEC-2 → SEC-6/SEC-8 (rápidos) → DEB-2

**Fase 1 — antes de abrir el registro a más gente**
DEB-1 → DEB-3 → DEB-4 → SEC-3 → SEC-7 → DEB-5 → SEC-5 → SEC-10

**Fase 2 — medir antes de cobrar**
DEB-8 → COM-1 (con `CREDITS_ENFORCED=false`, juntar 2-4 semanas de costos reales) → DEB-6 → COM-6

**Fase 3 — cobrar**
COM-2 → COM-3 → COM-4 → COM-5 → COM-7 → COM-8 → SEC-4

**Fase 4 — robustez y escala**
SEC-9 (reemplazo de la extensión por API oficial) → DEB-7 → DEB-10 → DEB-11 → DEB-9
