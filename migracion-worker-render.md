# Migración: worker de render separado (Render API + Hetzner AX42)

Estudio de la migración sobre el código actual (`backend/src`): la arquitectura destino y las etapas para llegar a ella.

> **Estado:** implementado en la rama `migracion_worker_render`. La guía paso a paso para instalarlo está en [`backend/WORKER_DEPLOY.md`](backend/WORKER_DEPLOY.md). Las diferencias entre este plan y lo implementado están marcadas con **(implementado: …)**.

---

## Etapa 0 — Cómo funciona hoy (y por qué se cae)

### Flujo actual

```
Frontend (Netlify)
   │  POST /projects/:id/pipeline            POST /jobs/:id/approve (stock review)
   ▼                                          ▼
API Express en Render (UN solo proceso Node)
   │
   ├─ pipeline.service.ts:42  → runPreRenderPipeline(...)  ← "fire-and-forget", corre DENTRO de la API
   └─ job.service.ts:192      → runRenderPipeline(...)     ← idem, ffmpeg DENTRO de la API
                                   │
                                   ▼
                     Supabase (tabla jobs: status/progress)  ──Realtime──► Frontend (PreviewPanel.tsx:321)
```

- Los dos pipelines se lanzan con una promesa suelta (`.catch(...)`) después de responder `202`. No hay cola: el trabajo vive **solo en la memoria del proceso de la API**.
- El frontend no hace polling: escucha la fila del job por **Supabase Realtime** (`PreviewPanel.tsx:317-333`). Esto es clave: **cualquier proceso que actualice `jobs` en Supabase se refleja solo en la UI**, así que el worker puede estar en otra máquina sin tocar el frontend.
- Las API keys de proveedores (OpenAI, ai33, Pexels, R2, Cloudinary…) están en la tabla `providers` (`lib/providers.ts`). El worker solo necesita `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` para tener acceso a todo lo demás.

### Por qué falla

| Error visto en producción | Causa |
|---|---|
| `Ran out of memory (used over 4GB)` | ffmpeg + buffers de Node (clips y video final cargados enteros en RAM) en el mismo proceso que la API |
| `/tmp exceeded the limit of 2GB` | Render limita `/tmp` a 2 GB; 200 clips + tandas intermedias CRF 17 + merges no entran |
| Renders cortados sin error claro | Un deploy o un reinicio de Render mata la promesa en curso: el job queda colgado en `RENDERING` para siempre |

Además, el pre-render también es pesado: un audio de 25 min pasa varias veces por memoria (`transcribeAudio.tool.ts:89,166`, `ai33.ts:153`) y hace polling de minutos a ai33 y a los proveedores de video.

---

## Arquitectura destino

```
Frontend (Netlify) ──Realtime──────────────────────────────┐
   │                                                        │
   ▼                                                        │
API en Render Starter ($7)                                  │
 · auth, CRUD, guiones, voces, estado de jobs               │
 · "arrancar pipeline" / "aprobar render" = INSERTA un job  │
   │                                                        │
   ▼                                                        │
Supabase ── tabla jobs (= cola) ────────────────────────────┘
   ▲   │  claim_next_job() con FOR UPDATE SKIP LOCKED
   │   ▼
Worker en Hetzner AX42 (Docker, mismo código del backend)
 · cola pre_render: voz, Whisper, escenas, stock, IA, timeline
 · cola render: ffmpeg
 · heartbeat, reintentos, recuperación de jobs huérfanos
 · NO expone puertos: solo hace conexiones salientes
```

Principio de diseño: **el worker usa exactamente las mismas funciones que hoy** (`runPreRenderPipeline` y `runRenderPipeline` de `pipeline/orchestrator.ts`). No se reescribe el pipeline: cambia **dónde y cómo se dispara**.

---

## Etapa 1 — Código compartido y un segundo punto de entrada

**Objetivo:** que el mismo repo `backend/` pueda arrancar como API o como worker.

- Nuevo archivo `backend/src/worker.ts` (junto a `server.ts`) y script `npm run start:worker` → `node dist/worker.js`.
- La API sigue arrancando con `npm start` → `dist/server.js`, igual que hoy.
- No se duplica código: el worker importa `pipeline/orchestrator.ts`, `tools/`, `lib/`.

**Por qué así:** un solo código, un solo `npm run build`, y las dos piezas no se desincronizan. Esta etapa no cambia el comportamiento en producción.

---

## Etapa 2 — La cola en Supabase

**Objetivo:** que el trabajo pendiente viva en la base de datos, no en la memoria de un proceso.

### Qué cambia en la tabla `jobs` (migración nueva en `backend/supabase/migrations/`)

Se **agregan** columnas técnicas. `status` y `progress` siguen iguales, porque son lo que muestra la UI y lo que valida `JOB_TRANSITIONS` (`job.service.ts:11`).

| Columna | Para qué |
|---|---|
| `queue` | `'pre_render'` o `'render'`: qué pipeline tiene que correr el worker |
| `queue_state` | `'pending'` → `'claimed'` → `'done'` / `'failed'` (estado técnico de la cola) |
| `user_id` | Hoy `runPreRenderPipeline` necesita `ctx.userId` y `jobs` no lo tiene; se guarda al encolar |
| `claimed_by`, `claimed_at` | Qué worker lo tomó y cuándo |
| `heartbeat_at` | El worker lo actualiza cada ~30 s mientras trabaja |
| `attempts`, `max_attempts` | Contador de reintentos |
| `run_after` | Para reintentar con espera (backoff) |

Más un índice sobre `(queue, queue_state, created_at)`.

### La función `claim_next_job` (SQL, llamada con `supabase.rpc`)

```sql
-- Toma el job pendiente más viejo de las colas pedidas, de forma atómica.
update jobs set queue_state = 'claimed', claimed_by = $worker, claimed_at = now(),
                heartbeat_at = now(), attempts = attempts + 1
where id = (
  select id from jobs
  where queue = any($queues) and queue_state = 'pending' and run_after <= now()
  order by created_at
  for update skip locked
  limit 1
)
returning *;
```

**Por qué `FOR UPDATE SKIP LOCKED`:** si hay 2 workers (o 2 hilos del mismo worker) pidiendo trabajo al mismo tiempo, nunca agarran el mismo job. Es lo que permite escalar sumando servidores **sin cambiar código**.

**Por qué `status` y `queue_state` separados:** `status` es la etapa de negocio (`RENDERING`, `AWAITING_STOCK_REVIEW`…) y ya tiene reglas y UI. `queue_state` es la plomería de la cola. Mezclarlos rompería las transiciones y el frontend.

---

## Etapa 3 — La API encola en vez de ejecutar

**Objetivo:** que la API nunca más corra un pipeline pesado.

### Cambios puntuales

| Archivo | Hoy | Después |
|---|---|---|
| `modules/pipeline/pipeline.service.ts:18-50` | Inserta el job en `RUNNING` y llama a `runPreRenderPipeline` | Inserta el job en `QUEUED` con `queue='pre_render'`, `queue_state='pending'`, `user_id`, y responde `202` |
| `modules/jobs/job.service.ts:184-201` (`approveStockReview`) | Pasa a `RENDERING` y llama a `runRenderPipeline` | Pasa a `RENDERING` con `queue='render'`, `queue_state='pending'`, y responde `202` |
| `modules/tools/tool.service.ts` (`POST /tools/:tool/execute`) | Permite ejecutar `render_video` directo en la API | Bloquea las tools pesadas (`render_video`, `transcribe_audio`) en este endpoint. De paso cierra parte del IDOR que marcó la auditoría |

### Interruptor de seguridad: `EXECUTION_MODE`

Variable de entorno en la API: `inline` (comportamiento actual) o `queue` (nuevo).
- Permite desplegar el código nuevo **sin activarlo**.
- Si algo sale mal en producción, **se vuelve atrás cambiando una variable** en Render, sin redeploy de código.

### Impacto en el frontend: casi nulo

- El frontend ya muestra `QUEUED` como "en curso" (`PreviewPanel.tsx:527,543`, `mappers.ts:178`).
- Sigue escuchando la fila por Realtime: cuando el worker actualice `status`/`progress`, la UI se entera sola.
- Mejora opcional posterior: mostrar "En cola, posición N".

---

## Etapa 4 — El worker

**Objetivo:** un proceso que toma jobs de la cola y los corre de forma robusta.

### Loop principal (`src/worker.ts`)

```
mientras no me pidan apagarme:
  si tengo lugar libre (menos de N jobs corriendo):
    job = rpc('claim_next_job', { worker, queues })
    si hay job:
      arrancar heartbeat cada 30 s
      si job.queue == 'pre_render' → runPreRenderPipeline(job.video_project_id, { userId, jobId })
      si job.queue == 'render'     → runRenderPipeline(...)
      OK    → queue_state = 'done'
      error → reintentar o marcar FAILED (ver abajo)
  si no hay nada → esperar 3-5 s y volver a preguntar
```

### Concurrencia configurable por cola

| Variable | Valor sugerido (AX42) | Por qué |
|---|---|---|
| `RENDER_CONCURRENCY` | `2` | ffmpeg satura la CPU; más de 2 a la vez no aumenta el total, solo reparte los núcleos |
| `PRE_RENDER_CONCURRENCY` | `3-4` | Es mayormente espera de APIs externas (poca CPU); el límite real son los rate limits de OpenAI, Pexels y ai33 |

### Robustez (lo que hace que "no se caiga")

1. **Heartbeat + recuperación de huérfanos:** si el worker muere a mitad de un job, `heartbeat_at` deja de moverse. Un chequeo periódico devuelve a `pending` los jobs `claimed` con heartbeat de más de ~3 min (o los marca `FAILED` si se agotaron los intentos). Hoy esos jobs quedan colgados para siempre.
2. **Apagado ordenado (`SIGTERM`):** al actualizar el worker deja de tomar jobs nuevos, espera los que están corriendo (con un tope) y libera el resto a `pending`.
3. **Reintentos, con una distinción importante:**
   - **Render: se reintenta automáticamente** (hasta 3 veces, con espera). Es idempotente: vuelve a descargar los clips y sobreescribe el video (`upsert: true`, `overwrite: true`).
   - **Pre-render: reintento con cuidado.** Algunos pasos cuestan plata (TTS de ai33, Whisper, generación de video IA) y otros escriben filas (`build_scenes` borra y recrea las escenas en `buildScenes.tool.ts:258`; `generate_voice` inserta un asset). Propuesta: reintentar automáticamente solo errores transitorios de red o de límite, y si falla más adelante, `FAILED` con botón de "reintentar" manual.
4. **Errores claros:** el mensaje de error se guarda en `jobs.error` como hoy, así el usuario lo ve en la UI.

---

## Etapa 5 — Optimización del render (ffmpeg, RAM y disco)

**Objetivo:** que cada render use menos RAM, disco y tiempo. Se puede hacer antes o después de la etapa 4, y mejora también cualquier otro servidor.

| Cambio | Dónde | Efecto |
|---|---|---|
| Descargar clips **por stream a disco** en vez de `Buffer.from(await response.arrayBuffer())` | `renderVideo.tool.ts` `downloadTo` (~línea 162) | No carga cada clip entero en RAM |
| Subida a Supabase por stream en vez de `readFile(finalOutputPath)` | `renderVideo.tool.ts:895` | No carga el video final (cientos de MB) en RAM. R2 ya hace streaming (`r2.ts:54`) |
| Directorio temporal configurable (`WORK_DIR`) en vez de `os.tmpdir()` | `renderVideo.tool.ts:729`, `transcribeAudio.tool.ts:83`, `ai33.ts`, `edgeTts.ts` | Apunta al NVMe grande del servidor |
| ~~Pre-escalar cada clip a 720p al descargarlo~~ | — | **(implementado: descartado)** cada clip ya se decodifica una sola vez, en su tanda; pre-escalarlo sumaba una pasada más sin ahorrar nada |
| Transiciones con menos niveles de re-encode | `assembleBatchesWithTransitions` | **(implementado: `RENDER_MERGE_FANIN`)** fusiona de a N tandas por nivel en vez de 2. Con 8, ~60 tandas pasan de 6 niveles a 2. Una sola pasada con todas las tandas abiertas vuelve a disparar el OOM que motivó el árbol |
| Subtítulos en la misma pasada que el audio | `realRender` | **(implementado)** con transiciones, los subtítulos se queman en la pasada de audio + tpad: un re-encode completo menos |
| **Bug:** escenas de imagen con `-loop 1` | `buildFfmpegArgsForBatch` | **(implementado: corregido)** zoompan generaba video infinito y la tanda no terminaba nunca (terminaba en OOM o `/tmp` lleno) |
| Preset final `medium` → `fast`, configurable | `videoCodecArgs` | Encode final ~2× más rápido, sin diferencia visible a 720p |
| `BATCH_SIZE` y concurrencia de descarga configurables por env | constantes actuales | Ajustar al hardware sin tocar código |

Primero se mide un render real de ~200 clips con el código actual y después con cada cambio, para confirmar la mejora con números.

---

## Etapa 6 — Infraestructura en el AX42

**Objetivo:** que el worker corra solo, se reinicie solo y sea fácil de actualizar.

- **`backend/Dockerfile`:** Node 20 + dependencias + `npm run build`, con comando `node dist/worker.js`. `ffmpeg-static` ya trae el binario.
- **`docker-compose.yml`:**
  - `restart: unless-stopped`: si el proceso muere o el servidor se reinicia, vuelve a levantar solo.
  - Un volumen en el NVMe para `WORK_DIR`.
  - Límite de logs (rotación) para no llenar el disco.
- **`.env` del worker:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_ID`, `RENDER_CONCURRENCY`, `PRE_RENDER_CONCURRENCY`, `WORK_DIR`. Nada más: las keys de proveedores salen de la tabla `providers`.
- **Seguridad del servidor:** login solo por clave SSH, sin password; firewall cerrando **todo lo entrante** salvo SSH. El worker no expone ningún puerto, solo sale a internet.
- **Actualizar:** `git pull && docker compose up -d --build`. El apagado ordenado de la etapa 4 evita cortar renders. Más adelante se puede automatizar con GitHub Actions.
- **Monitoreo mínimo:** tabla o fila de `workers` con último heartbeat, y una alerta si un job falla o si la cola supera N pendientes.

---

## Etapa 7 — Puesta en producción (orden seguro)

1. **Migración de Supabase** (etapa 2). Solo agrega columnas, no rompe nada.
2. **Deploy de la API** con el código nuevo y `EXECUTION_MODE=inline`. Todo sigue igual que hoy.
3. **Levantar el worker** en el AX42. Arranca sin trabajo, porque nadie encola todavía.
4. **Pasar la API a `EXECUTION_MODE=queue`.**
5. **Prueba real:** un video de ~25 min con ~200 clips. Medir tiempo, RAM y disco.
6. **Dejar Render en el plan actual ~1 semana** mirando errores.
7. **Bajar Render a Starter ($7)** cuando todo esté estable.

**Plan de vuelta atrás:** `EXECUTION_MODE=inline` en Render vuelve al comportamiento de hoy en segundos (mientras Render siga en un plan con RAM suficiente).

### Nota sobre Render Starter (512 MB)
La API igual conserva algunos usos livianos de ffmpeg: re-encode del audio subido a mano (`ai33.ts:222`), medición de duración (`audioDuration.ts`) y preview de voces. Son sobre un solo archivo de audio y deberían entrar. Si con uso real se queda corto, se mueven también a la cola, con el mismo mecanismo.

---

## Etapa 8 — Escalar después

Con la cola funcionando, crecer es infraestructura, no código:
- **Segundo worker:** mismo Docker en otro servidor con otro `WORKER_ID`. `SKIP LOCKED` reparte los jobs solo y la capacidad se duplica.
- **Refuerzo en picos:** un Hetzner Cloud por horas que levanta workers cuando la cola pasa de N y se apaga al vaciarse.
- **Separar colas por servidor:** un servidor solo `render` y otro solo `pre_render`.
- **Prioridades o límites por usuario:** una columna `priority` o un tope de jobs activos por usuario, para que nadie acapare el servidor.

---

## Resumen de archivos que se tocarían

| Tipo | Archivo |
|---|---|
| Nuevo | `backend/src/worker.ts` |
| Nuevo | `backend/supabase/migrations/<fecha>_job_queue.sql` (columnas + `claim_next_job`) |
| Nuevo | `backend/Dockerfile`, `backend/docker-compose.worker.yml`, `backend/.env.worker.example` |
| Modificado | `backend/src/modules/pipeline/pipeline.service.ts` (encolar) |
| Modificado | `backend/src/modules/jobs/job.service.ts` (encolar al aprobar) |
| Modificado | `backend/src/modules/tools/tool.service.ts` (bloquear tools pesadas) |
| Modificado | `backend/src/tools/renderVideo.tool.ts` (streaming, `WORK_DIR`, optimizaciones) |
| Modificado | `backend/src/tools/transcribeAudio.tool.ts`, `lib/ai33.ts`, `lib/edgeTts.ts` (`WORK_DIR`) |
| Modificado | `backend/src/types/shared/typeShared.ts` (campos nuevos de `Job`) |
| Modificado | `backend/package.json` (`start:worker`), `render.yaml` (plan starter, `EXECUTION_MODE`) |
| Sin cambios | `pipeline/orchestrator.ts` (la lógica del pipeline se reusa tal cual) y el frontend |
