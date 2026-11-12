# Scaler Tool: arquitectura, proveedores y almacenamiento de videos

> Informe técnico para comparar con otra aplicación. Describe **cómo está
> construido hoy** el sistema según el código del repo (rama principal,
> noviembre 2026). Las rutas de archivo son relativas a la raíz del repo.

---

## 1. Qué hace el sistema (resumen en una línea)

Plataforma web para **generar videos largos narrados (estilo YouTube "faceless")
de forma automática**: idea → guion con IA → voz (TTS) → transcripción con
tiempos por palabra → escenas cortas → visuales (stock, video IA, imagen IA,
Google Flow o todo animado) → gráficos animados y subtítulos → render final MP4
con FFmpeg/Remotion → subida a almacenamiento público (R2 / Cloudinary /
Supabase Storage).

---

## 2. Componentes y stack

| Pieza | Tecnología | Dónde | Deploy |
|---|---|---|---|
| **API backend** | Node 20 + TypeScript, Express 5, Zod, Multer | `backend/src/` | Render.com (`render.yaml`, plan starter) |
| **Worker de render** | Mismo código Node (`src/worker.ts`) en Docker | `backend/Dockerfile`, `backend/docker-compose.worker.yml` | Servidor dedicado propio (VPS), escalable horizontal |
| **Motor de gráficos animados** | Remotion 4 + React 18 + d3-geo/topojson (mapas) + lucide (íconos) | `backend/motion/` | Va dentro de la imagen Docker del worker (Chrome Headless Shell) |
| **Frontend** | React 19 + Vite 5 + Tailwind 4 + React Router 7 + `@remotion/player` | `backend/frontend_v1/` | Netlify (`netlify.toml`) |
| **Base de datos / Auth / Realtime** | Supabase (Postgres + Auth + Realtime + Storage) | `backend/supabase/migrations/`, `supabase/migrations/` | Supabase cloud |
| **Extensión de Chrome** | Manifest V3 (service worker + content scripts) | `flow-extension/` | Se instala a mano ("cargar descomprimida"); el front la empaqueta en zip |
| **Binario de video** | `ffmpeg-static` (FFmpeg estático vía npm) | dependencia del backend | — |

### Diagrama general

```
┌──────────────┐  REST + JWT   ┌──────────────────────┐   cola en tabla jobs   ┌──────────────────────┐
│  Frontend    │──────────────▶│  API Express (Render)│──────────────────────▶│ Worker Docker (VPS)  │
│ React/Vite   │◀── Realtime ──│  /projects /scenes…  │  claim_next_job()      │ pre_render + render  │
│ (Netlify)    │  (fila job)   │  EXECUTION_MODE=     │  FOR UPDATE SKIP LOCKED│ FFmpeg + Remotion    │
└──────┬───────┘               │  inline | queue      │                        └─────────┬────────────┘
       │                       └──────────┬───────────┘                                  │
       │ sesión compartida                │ service_role                                 │
┌──────▼───────┐                ┌─────────▼──────────┐       ┌───────────────────────────▼──────────┐
│ Extensión    │──── API ──────▶│ Supabase Postgres  │       │ APIs externas: Anthropic, OpenAI,    │
│ Google Flow  │                │ + Auth + Storage   │       │ ai33.pro, SnapGen, Pexels, Pixabay,  │
└──────────────┘                └────────────────────┘       │ Coverr, Wikimedia, Edge TTS          │
                                                             └──────────────────────────────────────┘
                     Archivos públicos ─▶ Cloudflare R2  (o Cloudinary / Supabase Storage)
```

---

## 3. Patrón de arquitectura interna

### 3.1 Capas del backend

```
src/
├── server.ts / app.ts         → Express, CORS, routers
├── middleware/                → auth (JWT de Supabase), rate limits
├── modules/<dominio>/         → route + service + types por dominio (REST)
│     projects, scripts, scenes, assets, jobs, pipeline, tools, providers,
│     scriptStyles, files, workspaces, admin, auth
├── tools/                     → "Tools": cada paso del pipeline como unidad
│                                 con nombre, descripción, JSON Schema y execute()
├── pipeline/orchestrator.ts   → motor determinístico que encadena las Tools
├── director/                  → agentes LLM (Claude) para el formato animado/documental
├── lib/                       → providers, storage, r2, ai33, edgeTts, colas,
│                                 alineación de palabras, overlays, captions, etc.
└── worker.ts                  → consumidor de la cola de jobs
```

### 3.2 Tool Registry

- `src/tools/toolRegistry.ts`: registro en memoria de **16 tools**. Cada
  ejecución se traza en la tabla `tool_executions` (input, output, estado,
  error, tiempos, `job_id`).
- Se pueden ejecutar sueltas vía `POST /tools/:tool_name/execute` (el front lo
  usa para generar guion, voz, preview de voz, etc.).

| Tool | Qué hace | Proveedor |
|---|---|---|
| `generate_script` | Escribe el guion (streaming, continúa si queda corto) | Anthropic (default) u OpenAI |
| `generate_script_style` | Arma el "Prompt Maestro" de un canal a partir de guiones de referencia | OpenAI |
| `generate_voice` | TTS del guion completo; reutiliza audio si guion+voz no cambiaron (hash SHA-256) | ai33.pro / Edge TTS |
| `list_voices` | Lista voces de ai33 (minimax, elevenlabs, edge, kokoro, vbee, fishaudio, clone) + Edge | ai33.pro / Edge |
| `preview_voice` | Muestra corta de una voz | ai33.pro / Edge |
| `transcribe_audio` | Transcripción con timestamps por palabra (re-encodea si >24 MB) | OpenAI Whisper (`whisper-1`) |
| `build_timeline` | Arma/actualiza `timelines.content` (escenas, assets, audio, cues de subtítulos) | interno |
| `build_scenes` | Corta el guion en escenas de 4–12 s alineadas al audio real | interno (algoritmo) |
| `generate_visual_context` | Contexto visual global del video (época, lugar, tono, género) | OpenAI (`gpt-4o-mini`) |
| `generate_stock_keywords` | 4 queries en cascada por escena (de específica a amplia) | OpenAI (`gpt-4o-mini`) |
| `search_stock` | Busca clips en todos los proveedores de stock activos | Pexels, Pixabay, Coverr, Wikimedia |
| `generate_video` | Clip de video con IA | SnapGen (Veo 3.1 / Seedance 2) |
| `generate_image_prompt_sequence` | Prompts de imagen por tramos de escenas | Anthropic (`claude-sonnet-5`) u OpenAI |
| `plan_overlays` | Decide qué gráfico animado va en cada momento | Anthropic (`claude-sonnet-5-5`) u OpenAI |
| `generate_overlay` | Valida el overlay en modo estricto (texto literal del guion) | interno |
| `render_video` | Composición final con FFmpeg (o Remotion en formato animado) | FFmpeg / Remotion |

(`generate_image` existe como tool de SnapGen `gpt-image-2` y se usa desde la
regeneración puntual de escena.)

### 3.3 Pipeline (orquestador determinístico)

`src/pipeline/orchestrator.ts`. **No** lo orquesta un LLM: los pasos son fijos y
cada id se resuelve contra la DB.

**Fase 1 – `runPreRenderPipeline`** (estado del job entre paréntesis):

1. Lee el guion (`SCRIPT_DONE`, 5%).
2. **Voz**: si el usuario subió audio propio lo usa; si no, `generate_voice` (`AUDIO_DONE`, 15%).
3. `build_timeline` base.
4. `transcribe_audio` (Whisper) → palabras + segmentos se fusionan en `timelines.content`.
5. `build_scenes` (o conserva escenas si el guion no cambió y ya tenían visuales).
6. Según `visual_source` y `video_format`:
   - **stock**: `generate_visual_context` (1 vez) → `generate_stock_keywords` por escena (secuencial, para no repetir queries) → `search_stock` por escena (concurrencia 4) → asigna clips.
   - **mixed**: igual que stock, pero si el mejor clip cubre < 50% de la escena genera video IA.
   - **ai**: arma prompts de video con Claude por tramos y llama a SnapGen hasta cubrir la duración.
   - **flow**: deja escenas vacías y genera prompts de imagen para la extensión de Chrome.
   - **animated** (formato todo animado): director de escenas con agentes Claude → `animated_plan`.
   - En todos: overlays (plan + validación).
7. `build_timeline` resuelto (`VISUALS_DONE`, 90%).
8. **Gate humano**: `AWAITING_STOCK_REVIEW` (100%). El usuario revisa/reemplaza escenas en el front y aprueba.

**Fase 2 – `runRenderPipeline`** (tras `POST /jobs/:id/approve-stock-review`):
`RENDERING` → `render_video` → inserta asset `VIDEO` con `metadata.kind = "final_render"` → `COMPLETED`.

Estados del job: `QUEUED, RUNNING, SCRIPT_DONE, AUDIO_DONE, VISUALS_DONE,
AWAITING_STOCK_REVIEW, RENDERING, COMPLETED, FAILED`. El estado del proyecto
(`DRAFT, IN_PROGRESS, GENERATING, DONE, ERROR`) se sincroniza con el último job.
El progreso textual va en `jobs.progress_message`; el front lo escucha por
**Supabase Realtime**.

### 3.4 Ejecución: inline vs. cola

- `EXECUTION_MODE=inline` (default): la API corre los pipelines en su proceso
  (con un semáforo en memoria `MAX_CONCURRENT_RENDERS=1`).
- `EXECUTION_MODE=queue`: la API solo encola en la tabla `jobs`
  (`queue = pre_render | render`, `queue_state = pending|claimed|done|failed`).
  El **worker** (`src/worker.ts`):
  - Toma jobs con la función SQL `claim_next_job()` (`FOR UPDATE SKIP LOCKED`) → varios workers en distintos servidores sin pisarse.
  - Heartbeat cada 30 s; `requeue_stale_jobs()` recupera jobs de workers caídos (> 300 s sin heartbeat).
  - Concurrencia: `RENDER_CONCURRENCY=2`, `PRE_RENDER_CONCURRENCY=3`.
  - Reintentos: render hasta 3 (es idempotente); pre-render 1 (porque cobra TTS/IA de nuevo).
  - Apagado elegante (espera hasta 14 min a que terminen los jobs).
  - Si falla un render se **devuelve el crédito** (`refund_render`).

---

## 4. Proveedores (todas las integraciones)

### 4.1 Cómo se configuran

- Tabla `providers` en Supabase: `slug`, `type`, `api_key` (secreto),
  `configuration` (JSONB con modelo, ids, URLs), `is_active`.
- Se administran desde **Settings → Providers** (solo admins, `/providers` CRUD).
  Los permisos directos de la tabla están revocados para clientes (migración
  `20260917010000_revoke_providers_grants.sql`); solo el backend con
  `service_role` la lee.
- Las tools resuelven por slug (`getActiveProvider("openai")`) o por tipo
  (`getActiveProvidersByType("stock_video")`). Agregar un proveedor de stock =
  una fila + un cliente en `PROVIDER_CLIENTS`.
- Flags de desarrollo: `MOCK_PROVIDERS=true` (respuestas falsas),
  `OFFLINE_PROVIDERS=true` (ignora la tabla para no gastar con keys reales).

### 4.2 Tabla de proveedores

| Slug | Tipo / uso | Endpoint | Modelos / detalles | Notas de implementación |
|---|---|---|---|---|
| `anthropic` | LLM: guion, prompts de imagen/video, plan de overlays, directores animados | SDK `@anthropic-ai/sdk` | Guion: `claude-opus-5`; prompts imagen: `claude-sonnet-5`; overlays: `claude-sonnet-5-5`; director animado: Opus 5.5 (director) + Sonnet 5.5 (dibujantes/diseñadores); documental: Opus 5.5 en director, dibujante y revisor; revisor/auditor visual: Sonnet 5.5 / Opus 5.5. Todo configurable en `configuration` | Streaming para guiones largos (hasta 16k tokens) y "continuar" si queda < 90% del largo pedido. Uso de tool_use para salida estructurada. **Managed Agents** (Claude Platform) para el director de escenas, con fallback paso a paso |
| `openai` | LLM auxiliar + transcripción | `api.openai.com/v1/chat/completions`, `/v1/audio/transcriptions` | `gpt-4o-mini` (keywords, contexto visual, estilos, fallback de guion/overlays); `whisper-1` | Whisper con `timestamp_granularities` por palabra; re-encodea a mono para no pasar 25 MB |
| `ai33` | TTS (revendedor de Minimax, ElevenLabs, Edge, Kokoro, Vbee, FishAudio, voces clonadas) | `api.ai33.pro/v3/text-to-speech`, `/v1/task/:id`, `/v1/credits`, `/v3/voices` | Voz default `minimax_209539195289677` | Asíncrono (task + polling cada 3 s, hasta 60 min, tolera 10 fallos seguidos). **Varias API keys separadas por coma**: elige la cuenta con saldo suficiente (cobra por carácter) y rota si da 402. Descarga el MP3 y lo **re-sube a storage propio**; mide duración real con FFmpeg |
| *(Edge TTS)* | TTS gratis | protocolo no oficial de Edge (`node-edge-tts`) | Voces `edgetts_es-AR-ElenaNeural`, etc. | Detrás del flag `ENABLE_EDGE_TTS=true` (no hay fila en `providers`) |
| `snapgen` | Video IA e imagen IA | `api.snapgen.org/v1/videos`, `/v1/tasks/:id`, `/v1/images/generations` | Video: `veo3-1-lite` (default; variantes lite/fast/quality/4k, 8 s fijos) o Seedance 2 (`video-ds-2.0`, 5/10/15 s). Imagen: `gpt-image-2` 1536×1024 | Video asíncrono con polling 5 s / timeout 8 min. **Sin reintento automático del POST** (para no cobrar dos veces). Aspect ratio 16:9. Solo admins pueden usar video IA |
| `pexels` | Stock video | `api.pexels.com/videos/search` | 5 resultados por keyword | Elige el archivo más chico que tenga ≥ 1280 px de ancho. No expone tags (no se puede filtrar por política de contenido) |
| `pixabay` | Stock video | `pixabay.com/api/videos/` | tiers large/medium/small/tiny | Filtra por tags contra `content_policy.block` |
| `coverr` | Stock video | `api.coverr.co/videos` | `urls=true` | Filtra por tags |
| `wikimedia` | Stock video (sin API key) | `commons.wikimedia.org/w/api.php` | transcodes webm | Solo licencias **PD / CC0** (sin atribución). User-Agent obligatorio |
| `ffmpeg` | "Proveedor" interruptor del render | local (`ffmpeg-static`) | — | Si no está activo y no hay mock, el render falla con "provider no configurado" |
| `cloudinary` | Hosting del render final (CDN) | SDK `cloudinary` (`upload_large` por chunks) | carpeta `skaler-renders`, `public_id = project_id` | Límite 100 MB: si se usa, el backend **calcula un bitrate** para que el MP4 entre |
| `r2` | Almacenamiento de todos los archivos | S3 API `https://<account>.r2.cloudflarestorage.com` | `@aws-sdk/client-s3` + `lib-storage` (multipart streaming) | También configurable por variables de entorno `R2_*`. Prioridad: fila de la DB > env |
| *(Google Flow)* | Imagen/video IA con la cuenta del usuario | `flow.google.com` vía extensión de Chrome | — | No pasa por el backend: la extensión manda prompts, espera, descarga y carga la imagen en la escena (o la guarda en `Descargas/Scaler Tool/<proyecto>/001.png`) |
| *(Supabase)* | DB, Auth (email + OAuth Google), Realtime, Storage (fallback) | `SUPABASE_URL` + `service_role` | — | Storage solo si no hay R2 |

### 4.3 Resiliencia común

- `fetchWithTimeout` (timeout por default 30 s) y `withRetry` (backoff, no reintenta 4xx).
- `providerApiError` limpia las API keys de los mensajes de error.
- `Promise.allSettled` entre proveedores de stock: si uno cae, siguen los demás.
- Concurrencia limitada por escena (`SCENE_CONCURRENCY=4`) para no chocar con rate limits.

---

## 5. Cómo se guardan los videos y archivos

### 5.1 Principio general

**En la base solo se guardan URLs** (columna `assets.storage_key`), nunca los
binarios. El binario vive en: (a) almacenamiento propio, o (b) el CDN del
proveedor externo. El render final siempre se sube a almacenamiento propio.

`lib/storage.ts::uploadPublicFile` decide el destino:

1. **Cloudflare R2** si está configurado (preferido: no cobra egreso; sube en streaming/multipart).
2. Si no, **Supabase Storage** (bucket público creado al vuelo, `upsert`).

Para el **render final** el orden es **R2 → Cloudinary → Supabase Storage**.

### 5.2 Qué se guarda dónde

| Archivo | Origen | Se copia a storage propio | Clave / ruta | Asset en DB |
|---|---|---|---|---|
| **Narración** (TTS) | ai33 / Edge TTS | **Sí** (se descarga del CDN de ai33 y se re-sube) | R2: `skaler-audio/<script_id>.mp3` · Supabase: bucket `audio/<script_id>.mp3` | `type=AUDIO`, `scene_id=null`, metadata `{duration_seconds, voice_key, text_hash}` |
| **Audio subido por el usuario** | upload (`POST /projects/:id/script/audio`) | **Sí**, re-encodeado a MP3 mono 128 kbps 44.1 kHz | misma clave que el TTS | `type=AUDIO`, `metadata.kind="user_upload"` (tiene prioridad sobre TTS) |
| **Previews de voz** | ai33 / Edge | Sí | `previews/xxx.mp3` | — |
| **Clip de stock** | Pexels/Pixabay/Coverr/Wikimedia | **No** (se referencia la URL del CDN del proveedor; se descarga recién al renderizar) | URL del proveedor | `type=VIDEO`, `metadata.kind="stock_preview"`, `{provider, external_id, url, keyword, sequence, duration_seconds}` |
| **Clip de video IA** | SnapGen | **No** (URL de SnapGen, vence a los 14 días) | URL de SnapGen | `type=VIDEO`, `metadata.kind="ai_generated"`, `{provider:"snapgen", prompt, sequence, duration_seconds}` |
| **Imagen IA** | SnapGen (`gpt-image-2`, base64) | **Sí** | bucket/prefijo `ai-image/<timestamp>-<rand>.png` | `type=IMAGE`, `metadata.kind="ai_generated"` |
| **Visual subido a mano / desde Flow** | usuario / extensión | **Sí** | `scene-uploads/<timestamp>-<rand>.<ext>` | `type=VIDEO|IMAGE`, `metadata.kind="user_upload"` |
| **Render final** | FFmpeg / Remotion | **Sí** | R2: `skaler-renders/<project_id>.mp4` · Cloudinary: `skaler-renders/<project_id>` · Supabase: bucket `renders/<project_id>.mp4` (se sobreescribe en cada render) | `type=VIDEO`, `scene_id=null`, `metadata.kind="final_render"` |
| Temporales del render | — | Disco local | `WORK_DIR` (en el worker: volumen Docker `/data/work`), se borran al terminar | — |

Una escena tiene **un solo tipo de visual activo**: antes de asignar uno nuevo se
borran sus assets `VIDEO`/`IMAGE`. Una escena puede tener **varios clips en
secuencia** (`sequence`) para cubrir su duración sin repetir el mismo clip.

### 5.3 Estructura del timeline (`timelines.content`, JSONB)

```jsonc
{
  "audio": { "asset_id": "...", "storage_key": "https://.../x.mp3", "duration_seconds": 612 },
  "words":    [{ "word": "Hola", "start": 0.12, "end": 0.40 }],   // Whisper
  "segments": [{ "text": "...", "start": 0.1, "end": 2.9, "words": [...] }], // cues de subtítulos (desde el guion real)
  "duration_seconds": 612.4,
  "scenes": [{
    "scene_id": "...", "order": 0,
    "start": "00:00", "end": "00:07", "start_seconds": 0, "end_seconds": 7.2,
    "assets": [{ "storage_key": "https://...", "type": "VIDEO", "start": "...", "end": "...", "start_seconds": 0, "end_seconds": 4.1 }],
    "asset": { ... },          // compatibilidad con timelines viejos
    "overlay": { ... }, "overlays": [ ... ]   // gráficos animados anclados a palabras
  }]
}
```

---

## 6. Render del video (FFmpeg + Remotion)

Archivo: `backend/src/tools/renderVideo.tool.ts` (~1.400 líneas).

### 6.1 Formato "stock" (clips + audio)

1. Lee timeline → aplana a **segmentos**; cierra huecos (el video se arma por suma de duraciones, así no se desincroniza del audio); redondea a frames (30 fps) sin acumular error.
2. Descarga el MP3 de narración.
3. **Por tandas** (`RENDER_BATCH_SIZE=4` segmentos): descarga solo los clips de esa tanda (concurrencia 5, timeout 60 s) para no llenar el disco con videos de 190+ escenas.
   - **Video**: `scale ... force_original_aspect_ratio=increase:flags=lanczos, crop, fps=30`.
   - **Imagen**: efecto **Ken Burns** con `zoompan` (sobremuestreo 1.4×, zoom máx. 1.08) y re-escalado lanczos.
   - **Transiciones** opcionales: `xfade=fade` de 0.5 s (estirando cada segmento para no adelantar el video).
4. Une tandas (concat demuxer sin recompresión, o árbol de `xfade` con fan-in 2 si hay transiciones).
5. **Pasada final de quemado** (si corresponde):
   - **Gráficos animados**: Remotion renderiza **solo la animación de entrada** de cada gráfico como `.mov` **ProRes 4444 con alfa** (`yuva444p10le`); FFmpeg congela el último frame, hace blur de fondo y fade de salida, y los superpone (`overlay`).
   - **Subtítulos**: `.srt` o `.ass` palabra por palabra (resaltando la palabra actual con el color de acento del canal), filtro `subtitles` (libass).
   - Si fallan los gráficos, el video sale igual sin ellos (plan B).
6. Codificación:
   - Intermedios: `libx264 -preset veryfast -crf 17` (casi sin pérdida).
   - Final: `libx264 -crf 20` con preset configurable; si el destino es Cloudinary, bitrate objetivo calculado para < 100 MB (mínimo 400 kbps). Audio AAC 128 kbps. Se fuerza espacio de color BT.709 / `yuv420p`.
7. Resolución según `render_quality`: **720p (1280×720)** default o **1080p (1920×1080)**. Siempre 16:9, 30 fps.
8. Sube (R2 → Cloudinary → Supabase) y devuelve URL + duración. El progreso se reporta leyendo `time=` del stderr de FFmpeg.

### 6.2 Formato "animated" (todo animado / documental)

- No hay stock: un **director de escenas** (agentes Claude en hub-and-spoke: director → dibujantes → diseñadores → verificador en código → revisor visual sobre capturas reales) produce un `animated_plan` (escenas, componentes dibujados, nav, captions).
- Remotion (`motion/scripts/render-animated.ts`) dibuja **cada frame** con la voz adentro → H.264 MP4 → sube a R2 o Supabase.
- Solo admins (flag `effectiveFormat`).

### 6.3 Motor de gráficos (`backend/motion/`)

- **31 componentes** en `catalog.json`: `big_number, title_card, kinetic_quote, data_viz_single, versus, scale_compare, timeline, lower_third, list, rank_reveal, profile_card, location, myth_fact, badge, cta, nav_header, line_chart, pivot_question, card_grid, scoreboard, strike_word, phrase_swap, chapter_index, number_phrase, person_card, milestone, subscribe_cta, map_globe, map_marker, layers_diagram, cycle_diagram`.
- **21 nichos** con 3 paletas cada uno (`niches.json`: ciencia, espacio, historia, true crime, misterio, finanzas, psicología, salud, naturaleza, tecnología, geopolítica, desastres, deportes, motor, religión, entretenimiento, gaming, viajes, historias, ingeniería, estilo de vida, curiosidades). La paleta es **del canal** y el nicho **del video**.
- Regla clave: los textos de los gráficos son **literales del guion** (validación estricta en `generate_overlay`), y cada gráfico se ancla a la **palabra exacta** donde se narra (timing de Whisper).
- El frontend usa `@remotion/player` para una **vista previa animada** en el navegador (mismos componentes).

---

## 7. Modelo de datos (Supabase/Postgres)

Tablas principales (algunas creadas fuera de las migraciones del repo):

| Tabla | Para qué |
|---|---|
| `video_projects` | Proyecto. Columnas relevantes: `user_id`, `workspace_id`, `title`, `status`, `voice_id`, `visual_source` (`stock/ai/mixed/flow`), `video_format` (`stock/animated`), `render_quality` (`720p/1080p`), `transitions_enabled`, `subtitles_enabled`, `overlays_enabled`, `overlay_theme`, paleta, `content_policy` (JSONB block/prefer), `overlay_storyboard`, `animated_plan` |
| `scripts` | Guion del proyecto (`content.text`) |
| `scenes` | Escenas ordenadas (`content`: text, duration, prompts, overlays, historial de stock) |
| `assets` | Archivos (AUDIO / VIDEO / IMAGE) por proyecto/escena, con `storage_key` = URL |
| `timelines` | JSON resuelto que consume el render |
| `jobs` | Estado/progreso + campos de cola (`queue`, `queue_state`, `claimed_by`, `heartbeat_at`, `attempts`, `run_after`) |
| `tool_executions` | Auditoría de cada ejecución de tool |
| `providers` | Credenciales y configuración de proveedores (solo service_role) |
| `stock_library_entries` | Por usuario: clips `BLOCKED` / `PREFERRED` (persisten entre videos) |
| `script_styles` | "Prompt Maestro" por canal/estilo de narración |
| `workspaces` + miembros + invites | Multi-usuario por canal (roles), recursos compartidos: idioma, estilo de narración, prompt visual / biblia visual, voz y estilo por defecto |
| `user_accounts` | Aprobación de cuentas (`pending/approved/rejected`, `unlimited`) |
| `video_credits` + `video_credit_movements` | Saldo de videos; funciones SQL atómicas `charge_render`, `refund_render`, `adjust_video_credits`; 5 videos de bienvenida |

Funciones SQL: `claim_next_job`, `requeue_stale_jobs`, `ensure_user_account`,
`approve_user_account`, `adjust_video_credits`, `charge_render`, `refund_render`.
Las tablas públicas están bloqueadas para el cliente (`lock_public_tables`): el
front habla **solo con la API**, salvo Auth y Realtime.

---

## 8. API REST (resumen)

| Grupo | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/login`, `/refresh`, `/resend-confirmation`, `GET /auth/oauth/:provider`, `GET /auth/me` |
| Proyectos | CRUD `/projects`, `GET /projects/:id/details`, `/channel-settings`, `/overlays`, `POST /overlay-palette` |
| Guion | `POST/GET/PATCH /projects/:id/script`, `POST /projects/:id/script/audio` (subir audio) |
| Escenas | `/scripts/:id/scenes` (CRUD, `reorder`, `image-prompts`, lote), `/scenes/:id` (CRUD, `regenerate-visual` con `source: stock | ai | ai_image`, `upload-visual`) |
| Pipeline / Jobs | `POST /projects/:id/pipeline/run`, `GET /projects/:id/jobs`, `GET /jobs/:id`, `POST /jobs/:id/approve-stock-review` |
| Assets | CRUD `/projects/:id/assets`, `/assets/:id` |
| Tools | `GET /tools`, `POST /tools/:name/execute` |
| Providers (admin) | CRUD `/providers` |
| Estilos | CRUD `/script-styles`, `POST /:id/generate` |
| Archivos | `POST /files/extract-text` (PDF con `pdf-parse`, DOCX con `mammoth`) |
| Workspaces | CRUD, miembros/roles, invitaciones (`/invites/:token/accept`), channel-settings |
| Admin | usuarios, aprobar/rechazar, cargar créditos, ilimitado, movimientos |

Seguridad: JWT de Supabase en `auth.middleware.ts`, rate limits por grupo
(`express-rate-limit`), control de propiedad por workspace/rol (`lib/ownership.ts`),
admins por env `ADMIN_USER_IDS`, `DISABLE_AUTH` prohibido en producción.

---

## 9. Frontend (páginas y funciones)

Rutas: `/login`, `/` (dashboard), `/projects`, `/projects/new`,
`/projects/:id` (workspace del proyecto), `/script-styles`, `/settings`,
`/workspaces`, `/flow-extension`, `/invites/:token`, `/admin`.

Workspace del proyecto, por pestañas: **Guion** (generar con IA o pegar/subir
PDF/DOCX) → **Audio** (elegir/escuchar voces, generar o subir audio) →
**Escenas** (lista, prompts en lote para Flow, reemplazo) → **Preview**
(elegir formato/fuente visual/calidad/transiciones/subtítulos/gráficos/paleta,
revisión de stock escena por escena con reemplazo por stock/IA/subida, vista
previa animada con Remotion Player, aprobar render y descargar el MP4).

---

## 10. Formatos y opciones de salida (para la comparación)

| Dimensión | Opciones |
|---|---|
| Formato de video | `stock` (clips reales + gráficos opcionales) · `animated` (todo dibujado por Remotion, incl. modo documental) |
| Fuente visual | `stock` · `mixed` (stock + IA si falta) · `ai` (Veo/Seedance vía SnapGen) · `flow` (imágenes de Google Flow vía extensión) · imagen IA (Ken Burns) · subida manual |
| Resolución | 720p o 1080p, **16:9 únicamente**, 30 fps |
| Contenedor/códec | MP4, H.264 (libx264) + AAC 128 kbps, BT.709 |
| Duración | Videos largos (guiones de hasta decenas de miles de caracteres; 30–90 min de narración soportados) |
| Escenas | 4–12 s, cortadas sobre el audio real |
| Extras | Transiciones fade, subtítulos quemados (palabra por palabra), 31 tipos de gráficos animados, nav header (canal · tema · capítulo), paletas por nicho/canal |
| Voz | ai33 (Minimax, ElevenLabs, Kokoro, Vbee, FishAudio, Edge, voces clonadas), Edge TTS gratis, o audio propio |
| Idioma | Configurable por canal (guion, formato de números de los gráficos) |
| Control humano | Gate obligatorio de revisión de stock antes del render; lista de bloqueados/preferidos por usuario; política de contenido por proyecto |
| Multiusuario | Workspaces (canales) con roles e invitaciones; créditos por video; aprobación de cuentas |

---

## 11. Puntos fuertes y limitaciones (observados en el código)

**Fuertes**
- Pipeline determinístico y trazable (`tool_executions`), con gate humano.
- Sincronía precisa audio–imagen (Whisper por palabra, alineación con el guion, redondeo a frames).
- Escalado horizontal del render con cola en Postgres (sin Redis), reintentos y recuperación de workers caídos.
- Proveedores intercambiables desde la DB sin redeploy; varias cuentas de ai33 con rotación por saldo.
- Costo de almacenamiento bajo (R2 sin egreso); stock no se duplica.

**Limitaciones / riesgos**
- Los clips de stock y de SnapGen **no se copian** a storage propio: si el proveedor borra el archivo o la URL vence (SnapGen ~14 días), un re-render puede fallar.
- Solo **16:9** (no hay vertical 9:16 para Shorts/TikTok).
- Video IA, formato animado y gráficos animados están **limitados a admins** (en prueba).
- Edge TTS usa un protocolo no oficial (apagado por defecto).
- En modo `inline` la API en Render comparte CPU con FFmpeg (por eso existe el worker).
- Remotion requiere licencia de empresa con 4+ personas.

---

## 12. Variables de entorno relevantes

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_ORIGIN`,
`EXECUTION_MODE` (`inline|queue`), `ADMIN_USER_IDS`, `WELCOME_VIDEOS`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_PUBLIC_BASE_URL`, `MOCK_PROVIDERS`, `OFFLINE_PROVIDERS`, `ENABLE_EDGE_TTS`,
`DISABLE_AUTH` (solo dev), `MAX_CONCURRENT_RENDERS`, `WORK_DIR`, `MOTION_DIR`,
`REMOTION_CONCURRENCY`, `REMOTION_BROWSER_EXECUTABLE`; worker: `WORKER_ID`,
`RENDER_CONCURRENCY`, `PRE_RENDER_CONCURRENCY`, `RENDER_BATCH_SIZE`,
`RENDER_DOWNLOAD_CONCURRENCY`, `RENDER_DOWNLOAD_TIMEOUT_MS`, `RENDER_MERGE_FANIN`,
`RENDER_MAX_ATTEMPTS`, `PRE_RENDER_MAX_ATTEMPTS`, `WORKER_*` (intervalos y gracia).

---

## 13. Checklist sugerido para comparar con la otra aplicación

1. ¿Cómo genera el guion (modelo, largo máximo, estilos por canal)?
2. ¿Qué motores de voz soporta y si permite subir audio propio?
3. ¿Sincroniza visuales con timestamps por palabra o por duración estimada?
4. ¿De dónde saca los visuales (stock, IA, imágenes) y cuántos proveedores?
5. ¿Copia los archivos a su propio storage o solo referencia URLs?
6. ¿Dónde guarda el render final (S3/R2/local/CDN) y en qué formato/resolución? ¿Soporta 9:16?
7. ¿Tiene revisión humana antes del render y reemplazo por escena?
8. ¿Gráficos animados / subtítulos quemados / transiciones?
9. ¿Arquitectura de ejecución: síncrona, cola, workers, reintentos?
10. ¿Multiusuario, créditos, permisos por canal?
