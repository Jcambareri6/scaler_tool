# skaler tool — Backend

## Objetivo

Plataforma web donde el usuario crea un video conversando con un Agente de
IA. El agente transforma esa conversación en un `VideoProject` que atraviesa
un pipeline: Guion → Voz → Transcripción → Timeline → Visuales → Assets →
Overlays → Render → Video final.

## ⚠️ Regla de seguridad no negociable: todo va scoped por usuario

Es multi-tenant sobre una única DB con el **service-role client** (bypassea
RLS por completo — ver `src/lib/supabase.ts`). Eso significa que **la única
barrera entre los datos de un usuario y los de otro es que cada query lo
filtre a mano**. No hay red de seguridad debajo.

- Toda query a una tabla con `user_id` (directo, como `video_projects`, o
  indirecto vía join/lookup, como `scripts`/`scenes`/`assets`/`jobs`/
  `timelines`/`stock_library_entries`) tiene que incluir `eq("user_id",
  userId)` (o resolverse a partir de un recurso padre que ya esté filtrado
  así — ver `getProjectDetail` en `project.service.ts`).
- Nunca confiar en un `:id` que venga de la URL o del body sin acompañarlo
  del filtro por `req.user!.id`.
- Si agregás una tabla nueva (como `stock_library_entries`), definí desde el
  día uno cómo se scopea por usuario antes de escribir el primer query.
- Esto aplica incluso a lecturas — no solo a updates/deletes.

## Solución propuesta (según el documento de diseño)

- **Agent** interpreta al usuario y decide qué hacer (no llama APIs
  externas directamente).
- **Pipeline** (Script / Voice / Transcription / Visual / Timeline / Render)
  coordina **Tools** (`generate_script`, `generate_voice`,
  `transcribe_audio`, `search_stock`, `generate_image`, `generate_video`,
  `generate_overlay`, `render_video`).
- Cada **Tool** se implementa vía un **Provider** intercambiable:
  ElevenLabs/Gemini (voz), Whisper (transcripción), Pexels/Pixabay (stock),
  OpenAI (dirección visual: keywords + overlays), Remotion (overlays),
  FFmpeg (composición/render).
- Dominio persistente en Postgres (Supabase): `VideoProject → Script →
  Scene → Asset`, `Timeline`, `Job` (async), `ToolExecution` (trazabilidad +
  costo), `Provider`, `Agent`.
- Reemplaza el enfoque de archivos locales (`guion.txt`, `audio.mp3`,
  carpetas) del sistema actual por un proyecto persistente en base de datos +
  Object Storage.

## Verificación contra `LEEME_SISTEMA_COMPLETO_ACTUALIZADO.txt`

El LEEME es la especificación funcional real del pipeline (sistema local de
"Plantas Sagradas GT"). El documento de diseño dice tomarlo como referencia.
Esto es lo que coincide y lo que **todavía no está resuelto** en el diseño:

**Coincide:**
- Orden de TTS (audio existente → ElevenLabs → Gemini fallback) — igual en
  ambos documentos.
- Providers y su rol (Whisper = timing, OpenAI = director visual, Remotion =
  overlays, FFmpeg = render) — mapeo 1:1.
- Claude no es un Provider de producción en ninguno de los dos documentos.
  *Ojo:* el diseño nuevo introduce un **Agent conversacional** (la capa que
  habla con el usuario) que no existe en el sistema actual — el LEEME nunca
  contempló un chat/agente, solo un pipeline batch. Falta definir con qué
  modelo corre ese Agent y si cuenta como el mismo tipo de gasto que el LEEME
  quiere controlar agresivamente (límite $5-10 USD/mes, modelo mini).
- `ToolExecution.cost` mejora el control de costos del LEEME (que era manual,
  vía dashboard de OpenAI) con tracking por ejecución — punto a favor del
  diseño nuevo.
- Limpieza de archivos locales (`LIMPIAR_RAIZ_SEGURO.bat`, `_ARCHIVO/`) queda
  correctamente obsoleta al reemplazar archivos por DB + Object Storage.

**Gaps — resueltos a nivel diseño/tipos/schema (2026-08-30):**

1. **Revisión humana obligatoria del stock.** ✅ Resuelto: nuevo estado de
   `Job`, `AWAITING_STOCK_REVIEW`, entre `VISUALS_DONE` y `RENDERING`
   (`JobStatus` en `typeShared.ts`). Al llegar a `VISUALS_DONE` el pipeline
   genera un `Asset` tipo `VIDEO` con `metadata.kind = "stock_preview"` y el
   Job queda pausado ahí hasta que el usuario aprueba (endpoint todavía sin
   implementar — vive en el módulo `jobs`, que sigue vacío). Es un gate
   distinto de `VideoProject.status = REVIEW`, que sigue siendo la revisión
   del video ya renderizado — los dos quedan.
2. **Lista negra / curada de stock entre videos.** ✅ Resuelto a nivel
   schema: tabla `stock_library_entries` (migración
   `supabase/migrations/20260830120000_leeme_gap_resolutions.sql`),
   `user_id`-scoped (no por proyecto, tiene que sobrevivir entre videos),
   `decision` en `BLOCKED | PREFERRED`. Tipo `StockLibraryEntry` en
   `typeShared.ts`. **Pendiente:** todavía no hay route/service que la
   exponga — se agrega cuando se implemente `search_stock`, no antes (nada
   la consume todavía).
3. **Reglas de contenido por canal/nicho.** ✅ Resuelto para el MVP:
   `content_policy JSONB` nullable en `video_projects` (mismo patrón que
   `Script.content`), tipo `ContentPolicy { block, prefer, notes? }` en
   `typeShared.ts`. Deliberadamente por-proyecto y no una entidad `Channel`
   separada — no hay necesidad confirmada todavía de reusar la misma
   política entre múltiples proyectos de un mismo canal. Si aparece, se
   promueve entonces.
4. **Modo estricto de overlays.** ✅ Resuelto como contrato de datos:
   `OverlaySpec { type: OverlayType, text, source: "script" }` en
   `typeShared.ts`, con el enum de tipos del LEEME (`title_card`,
   `rank_reveal`, `big_number`, `lower_third`, `badge`, `data_viz_single`,
   `cta`, `ninguno`). La validación real (texto no inventado, CTA = palabra
   exacta del guion) sigue viviendo en el código de la Tool
   `generate_overlay` cuando se implemente — el tipo solo documenta el
   shape esperado dentro de `Scene.content.overlay`.

**Aplicada (2026-08-30):** la migración ya corrió contra la base real vía
MCP. `content_policy` y `stock_library_entries` existen en la DB.

## Estado actual implementado (backend/)

Stack: Node ESM + TypeScript (`module: nodenext`), Express 5, Supabase
(Postgres + Auth) vía service-role client, `tsx watch` para dev.

Dev: `npm run dev` desde `backend/` (puerto por `PORT`, default 3000).
Env requerido en `backend/.env` (nunca imprimir valores): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `PORT` (opcional).

Convención de módulo: `src/modules/<name>/` con `<name>.route(s).ts` (Router
+ `authMiddleware` por ruta), `<name>.service.ts` (handlers que hablan
directo con Supabase, sin capa de controller separada) y `<name>.types.ts`.
Tipos compartidos en `src/types/shared/typeShared.ts` (reflejan las
entidades del documento de diseño: `Script`, `Scene`, `Asset`, `Timeline`,
`Job`, `Provider`, `ToolExecution`, `Agent`; más `JobStatus`,
`StockLibraryEntry`, `ContentPolicy`, `OverlaySpec` agregados al resolver
los gaps del LEEME — ver sección de verificación arriba).

Implementado:
- **auth** — `POST /auth/register`, `POST /auth/login` (Supabase Auth). Sin
  `authMiddleware` (son el entry point público).
- **projects** — CRUD completo de `video_projects` bajo `/projects`, todo
  detrás de `authMiddleware`, todo scoped por `user_id`. `GET
  /projects/:project_id/details` arma el `ProjectDetail` agregado (project +
  script + scenes + assets + timeline + jobs) en una sola llamada.
  `create`/`update` ya aceptan `content_policy` en el body (pendiente que la
  columna exista en la DB real — ver "Pendiente de aplicar" arriba).
- **scripts** — solo `script.types.ts`; `script.route.ts` y
  `script.service.ts` existen pero vacíos.

No iniciado (directorios vacíos): `chat`, `jobs`, `scenes`,
`src/agents/`, `src/storage/`, `src/tools/` — corresponden a
Agent/Orchestrator, Storage y Tool Registry del diseño.

## Rough edges a corregir (avisar antes de tocar, no asumir que ya se arreglaron)

- `src/types/express.d.ts` declara `namespace express` (minúscula) e
  importa `user` (minúscula) de `@supabase/supabase-js`; Express lee
  `namespace Express` y el tipo real es `User`. Tal como está, la
  augmentation probablemente no aplica.
- `src/middleware/auth.middleware.ts` tipa sus parámetros como `request,
  response` (minúscula) desde `"express"` — esos exports no existen ahí;
  debería ser `Request, Response`.

## Convenciones observadas (seguir salvo indicación contraria)

- Handlers devuelven `res.status(...).json(...)` directo desde el service;
  try/catch por handler, `{ error: "Internal server error" }` genérico en
  fallos inesperados, mensaje de Supabase tal cual en fallos esperados (400).
- Filtrado por usuario en cada query — ver la regla de seguridad al
  principio del archivo, no es negociable.
- "No row" de Supabase se detecta con `error.code === "PGRST116"`, no solo
  chequeando `data`.
- Imports con extensión `.js` explícita (resolución ESM NodeNext) aunque el
  archivo fuente sea `.ts`.
