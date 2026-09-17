# Auditoría Skaler Tool — 2026-09-17

Recorrí el backend (`backend/src`), frontend (`backend/frontend_v1/src`) y migraciones de Supabase (`backend/supabase/migrations`) con evidencia concreta de código. Nota de contexto: **RLS está deshabilitado en todas las tablas `public`** desde el 2026-08-30, decisión ya tomada — no se vuelve a cuestionar acá, pero es la causa raíz de varios hallazgos de esta auditoría, porque convierte el filtrado manual por `user_id` en la **única** barrera de seguridad que existe.

## 1. Vulnerabilidades de seguridad

### 🔴 CRÍTICO — Las API keys de OpenAI/Anthropic/ai33 son legibles por cualquiera, sin pasar por el backend

**Qué es:** la tabla `providers` guarda las API keys reales en texto plano (`backend/src/modules/providers/provider.service.ts:8-9`). El backend las oculta al responder (`sanitizeProvider`, líneas 7-10), pero esa protección solo aplica si el request pasa por Express. Como RLS está apagado en todas las tablas y la `anon key` de Supabase es pública por diseño (está en el bundle del frontend, `frontend_v1/.env:4`, `frontend_v1/src/lib/supabaseClient.ts:7-10`), **cualquiera puede pegarle directo a PostgREST** (`.../rest/v1/providers?select=*`) con esa anon key y leer `api_key` sin que el código de sanitización intervenga.

**Por qué es grave:** es robo directo de las credenciales de pago del proyecto entero (no solo del atacante), con abuso de cuota ilimitado.

**Recomendación:** no reactivar RLS en bloque (rompería los inserts, ya documentado). Lo puntual y rápido: revocar el grant de `anon`/`authenticated` sobre la tabla `providers` específicamente, o mover `api_key` a un mecanismo que PostgREST no pueda servir directamente (ej. Vault de Supabase, o sacarla del schema `public`).

### 🔴 CRÍTICO — IDOR en `generate_voice`, `transcribe_audio` y `render_video`

**Qué es:** el endpoint genérico `POST /tools/:tool_name/execute` (`backend/src/modules/tools/tool.service.ts:9-38`) solo valida ownership si el cliente manda `job_id`, y ese chequeo es opcional (línea 19-24: `if (job_id) {...}`). Tres tools no verifican en absoluto que el recurso pedido sea del usuario que llama:

- `backend/src/tools/generateVoice.tool.ts:84` — recibe `script_id` sin chequear dueño.
- `backend/src/tools/transcribeAudio.tool.ts:232-258` — recibe `asset_id`, hace `select("storage_key").eq("id", asset_id)` sin filtrar por owner, y devuelve la transcripción completa en la respuesta.
- `backend/src/tools/renderVideo.tool.ts:749` — recibe `video_project_id`/`timeline_id` sin `getOwnedProject`.

Contrastar con `generateScript.tool.ts:340,350` y `buildTimeline.tool.ts:134`, que sí llaman a `getOwnedProject`/`getOwnedScript` de `backend/src/lib/ownership.ts` — el patrón correcto existe en el proyecto, simplemente no se aplicó en estas tres tools.

**Escenario real:** un usuario autenticado (registro público, sin fricción) que conoce o adivina el UUID de un `script_id`/`asset_id`/`video_project_id` ajeno puede leer la transcripción privada de otro usuario, insertarle un asset de audio no pedido a su proyecto, o disparar un render completo del contenido de otro y quedarse con la URL del video resultante.

**Recomendación:** forzar el guard de ownership a nivel del wrapper `executeTool` (no dejarlo a criterio de cada tool), reusando `ownership.ts` para cualquier ID de `script/asset/video_project/timeline` que venga en `input`, no solo `job_id`.

### 🟠 ALTO — Cualquier usuario registrado administra las API keys del sistema completo

**Archivo:** `backend/src/modules/providers/provider.route.ts:11-20`, `provider.service.ts:86-136`. El propio comentario del código lo admite: "no hay rol admin todavía". Cualquier cuenta puede crear, sobreescribir o borrar la configuración de providers (OpenAI, Cloudinary, R2, etc.) de todos los usuarios — sabotaje (DoS) o secuestro de tráfico reemplazando una key por una propia.

**Recomendación:** agregar un flag `is_admin`/rol mínimo en la tabla de usuarios y gatear estas rutas, aunque sea de forma simple, antes de escalar la base de usuarios.

### 🟠 ALTO — Sin rate limiting en todo el backend

No hay `express-rate-limit` ni nada equivalente en `package.json` ni `app.ts`. `/auth/register`, `/auth/login` y `POST /tools/:tool_name/execute` (que dispara llamadas pagas a LLM/TTS/Whisper y jobs de ffmpeg) están abiertos a spam sin límite — costo de API y fuerza bruta de login.

**Recomendación:** `express-rate-limit` básico por IP+usuario en `/auth/*` y en `/tools/*/execute` es una tarde de trabajo y cierra el vector más barato de abuso.

### 🟠 ALTO — Sin validación de esquemas en ningún endpoint

Confirmado: no hay `zod`/`joi`/`express-validator` en `backend/package.json`. La validación es manual e inconsistente (`auth.route.ts:23,47` no valida formato/longitud de `email`/`password` antes de mandarlo a Supabase). Esto alimenta directamente el problema de prompt injection de abajo.

**Recomendación:** introducir `zod` (liviano, ya se usa TS) al menos en los endpoints que arman prompts de LLM y en auth.

### 🟠 ALTO (condicional) — `DISABLE_AUTH=true` sin guardas de entorno

`backend/src/middleware/auth.middleware.ts:11-32` — si esta env var se define (hoy está en el `.env` local, no en git), cualquier request queda autenticado como un `DEV_USER_ID` fijo, sin token. No hay chequeo de `NODE_ENV !== "production"` ni segundo flag de seguridad.

**Recomendación:** agregar un `if (process.env.NODE_ENV === "production" && process.env.DISABLE_AUTH === "true") throw new Error(...)` al boot del server, para que un error de configuración en Cloudflare no abra la app entera.

### 🟡 MEDIO — Prompt injection sin mitigar en `generate_script`

`backend/src/tools/generateScript.tool.ts:83-90,121-139` — `idea`, `title`, `reference_script`, `key_points` (texto libre del usuario) se concatenan sin delimitadores en el prompt del LLM. Un usuario podría intentar romper el tono/reglas del `master_prompt` propietario del script_style, o pedirle a la IA que "repita sus instrucciones" y filtrar ese prompt.

**Recomendación:** delimitar claramente el input del usuario dentro del prompt (ej. bloques `<user_input>...</user_input>` con instrucción explícita de tratarlo como dato, no como instrucción) y poner un límite de longitud.

### 🟡 MEDIO — Errores internos devueltos crudos al cliente

Patrón repetido: `catch (error) { res.status(400).json({ error: error.message }) }` en `tool.service.ts:36`, `auth.route.ts:39,62,94`, `provider.service.ts:40`, `scene.service.ts`, `script.service.ts`, `asset.service.ts`, `job.service.ts`. Esto expone mensajes crudos de Postgres o de proveedores (`` `OpenAI API error (${status}): ${body}` ``) y en auth permite enumeración de usuarios ("User already registered" vs. password inválida).

**Recomendación:** un error handler central que loguee el mensaje completo server-side y devuelva al cliente un mensaje genérico + código, salvo una whitelist de errores esperables (ej. "email ya registrado" si de verdad se quiere mostrar).

### 🟡 MEDIO — Logging de datos sensibles

`backend/src/modules/auth/auth.services.ts:12` — `console.log(data)` loguea la respuesta completa de `supabase.auth.signUp`, que puede incluir `access_token`/`refresh_token`, a los logs del servidor/hosting.

**Recomendación:** eliminar o loguear solo el `user.id`.

### 🟢 BAJO — Token de sesión en `localStorage`

`frontend_v1/src/lib/api.ts:2,5,9` — estándar en SPA, pero sin ninguna mitigación compensatoria (CSP) contra robo vía XSS. No es urgente dado que no se encontró XSS explotable hoy (no hay `dangerouslySetInnerHTML` en el frontend).

**Sin hallazgo (verificado, no tocar):** CORS está bien configurado con allowlist explícita, no wildcard (`app.ts:24-30`). Contraseñas: delegado 100% a Supabase Auth, correcto. `.env` no está trackeado en git.

---

## 2. Mejoras técnicas del proyecto

- **`runFfmpeg()` duplicada byte a byte** entre `renderVideo.tool.ts:213-230` y `transcribeAudio.tool.ts:57-74`, incluyendo el mismo truncado de stderr a 2000 chars por copy-paste. Extraer a `backend/src/lib/ffmpeg.ts`.
- **Patrón "provider no configurado → mock → error" repetido 7+ veces** (`generateVoice.tool.ts:98-116`, `previewVoice.tool.ts:55-61`, `listVoices.tool.ts:99-104`, `transcribeAudio.tool.ts:250-256`, `renderVideo.tool.ts:750-756`, `generateVideo.tool.ts:180-186`, `generateImage.tool.ts:98-103`). Un helper `resolveProviderOrMock()` lo colapsa.
- **El contrato de ownership no se aplica uniformemente**: `ownership.ts` documenta la regla, pero solo 3 de ~19 tools la usan (ver sección 1, hallazgo IDOR). Esto es a la vez bug de seguridad y deuda de arquitectura — conviene resolverlo con un mecanismo que lo fuerce, no que dependa de que cada dev lo recuerde.
- **Frontend repite el mismo esqueleto de loading/spinner** (idéntico carácter por carácter) en `PreviewPanel.tsx:486-492`, `StockReviewPanel.tsx:254-260`, `ScriptPanel.tsx:95-101`, `AudioPanel.tsx:84-93`. Un hook `useAsync`/`useFetch` compartido lo resuelve.
- **Fetch duplicado a `/projects/:id/assets`**: `getSceneVideoAssets` y `getAudioAsset` (`projects.service.ts:118-138`) piden por separado la misma lista y filtran client-side; `StockReviewPanel.tsx:101-114` las llama juntas en el mismo `Promise.all`, es decir dos requests idénticos en una sola carga de pantalla.
- **Manejo de error inconsistente en frontend** — varios `useEffect`/handlers sin `.catch()`/`try-catch`: `ScriptPanel.tsx` (carga inicial, `handleSave`, `handleSelectStyle`), `NewProjectPage.tsx:28-37` (`handleCreate`), `ProjectsPage.tsx:64-69`, `DashboardPage.tsx:56-61`, `ProjectWorkspacePage.tsx:66-73`, `ScenesPanel.tsx:382-400`. Resultado: spinners/botones que quedan colgados para siempre sin avisar del error (ver sección 4, es también un problema de UX).
- **Sin paginación en ningún lado**: `project.service.ts:182-205` trae todos los proyectos del usuario sin `.range()`/`.limit()`; el filtro (incluido el futuro filtro por canal) se hace client-side sobre la lista completa (`useProjectFilters`). Con pocos proyectos no se nota, pero no hay dónde engancharse para un filtro server-side el día que haga falta.
- **`getProjectDetail` hace 5 queries secuenciales** (`project.service.ts:67-181`) cuando timeline/assets/jobs no dependen entre sí — se puede paralelizar con `Promise.all`.
- **Estructura tools/ vs modules/ vs pipeline/ sin convención documentada** — un dev nuevo no tiene forma obvia de saber dónde va código nuevo. Vale la pena un `CLAUDE.md`/README corto que explique el criterio (tools = invocables por el LLM/pipeline, modules = REST CRUD) antes de sumar el filtro por canal.
- **`mocks.ts` (~150 líneas) sigue en el bundle de producción** solo por una función de 14 líneas (`formatRelativeTime`, usada en `ProjectCard.tsx:3`). Mover esa función a utils y borrar el resto.
- **Tipos desincronizados vía jsonb sin modelar**: el campo `content` de `scenes` se re-castea con formas distintas en varios archivos (`mappers.ts`, `buildTimeline.tool.ts` cuatro veces) sin un tipo compartido — un cambio de forma no rompe compilación en ningún lado, solo se nota en runtime.
- **Cero tests en todo el repo** — ni backend ni frontend, sin `jest`/`vitest`/`testing-library`/`supertest`, `package.json` del backend tiene el script de test como stub. No hay cobertura de auth, generación de guiones, ni de las rutas con IDOR de la sección 1. No hace falta cobertura total, pero al menos tests de integración sobre `ownership.ts` y los endpoints de auth pagarían solos ante el próximo refactor.

---

## 3. Ideas nuevas de producto (priorizadas por impacto/esfuerzo)

1. **Borrar proyecto/guion + confirmación** — Impacto alto / Esfuerzo bajo. Hoy no existe (solo se puede borrar un script-style). Es la falencia de producto más básica detectada; cualquier usuario que pruebe la herramienta acumula proyectos de test sin forma de limpiarlos.
2. **Implementar el botón "Compartir" que ya existe pero no hace nada** (`ProjectWorkspacePage.tsx:141`) — Impacto medio-alto / Esfuerzo medio. Es fruta madura: la UI ya lo anuncia, solo falta la funcionalidad (link de solo lectura o invitación a colaborador).
3. **Historial de versiones del guion** — Impacto alto / Esfuerzo medio. Hoy `ScriptPanel` sobreescribe el guion al guardar sin dejar rastro de versiones previas; con IA generando contenido no determinístico, los usuarios van a querer comparar/volver a una versión anterior.
4. **Templates reutilizables a partir de "estilos de guion"** — Impacto alto / Esfuerzo bajo. Ya existe la infraestructura (`script_styles` con `master_prompt`); falta exponerlo como librería reutilizable entre proyectos/canales en vez de crearlo desde cero cada vez.
5. **Integración con YouTube Data API para traer datos reales del canal** — Impacto alto / Esfuerzo alto. Es el salto que más se alinea con "guiones personalizados por canal": hoy la personalización depende de texto libre que el usuario escribe a mano (título/descripción del proyecto); traer videos/títulos/thumbnails reales del canal alimentaría el prompt con contexto real en vez de inferido.
6. **Rol admin + panel de gestión de providers** — Impacto alto / Esfuerzo bajo-medio. Resuelve directamente el hallazgo de seguridad de la sección 1 (cualquier usuario administra las API keys del sistema) y es la base necesaria antes de habilitar colaboración multi-usuario.
7. **Exportación de guion (PDF/Docx/texto plano)** — Impacto medio / Esfuerzo bajo. Salida natural del flujo actual, útil incluso sin las features de canal.
8. **Analytics de performance / comparación entre canales** — Impacto medio-alto pero depende de la idea 5 (sin datos reales del canal, no hay con qué comparar). Dejarlo para después de la integración con YouTube.

---

## 4. Falencias de flujo y UX

Recorrido como usuario nuevo: Login → Dashboard vacío → Nuevo proyecto → Generar guion → Voz/Escenas/Preview.

- **Lo que funciona bien** (no tocar): el formulario de creación de proyecto (`NewProjectPage.tsx`) tiene un solo campo obligatorio; los estados vacíos de proyectos/guion/escenas guían bien con CTA claro; la generación de voz avisa "puede tardar unos minutos" en el propio botón; el render de video usa Supabase Realtime en vez de polling y muestra barra de progreso (`PreviewPanel.tsx`).
- **Fallas silenciosas (el hallazgo más importante de esta sección):** en 6 puntos del flujo, si la request falla, no pasa nada visible — el botón queda colgado en "Guardando.../Creando..." para siempre, sin mensaje de error, y el usuario probablemente concluye que la app está rota y abandona: creación de proyecto (`NewProjectPage.tsx:28-37`), guardado de guion (`ScriptPanel.tsx:51-58`), selección de estilo (`ScriptPanel.tsx:60-63`), listado de proyectos (`ProjectsPage.tsx`, `DashboardPage.tsx`), carga del workspace (`ProjectWorkspacePage.tsx:66-73`), carga de escenas (`ScenesPanel.tsx:382-400`). Es el mismo bug técnico de la sección 2, pero acá importa el efecto: es la causa más probable de abandono silencioso de usuarios reales.
- **Dos elementos "muertos" que un usuario curioso va a tocar:** el botón "Compartir" no tiene `onClick` (sin feedback, ni siquiera un "próximamente"); el link "Configuración" del sidebar apunta a `/settings`, ruta que no existe y sin catch-all en el router → pantalla en blanco total (ni sidebar), sin forma de volver salvo el botón atrás del navegador.
- **Copy desactualizado que confunde:** el estado vacío del guion (`ScriptPanel.tsx:278`) dice *"Conversá con el agente en Chat para generar el guion..."*, pero no existe ninguna pestaña "Chat" en la app — mensaje de un feature que nunca se shipeó o fue removido.
- **Sin forma de borrar proyecto/guion** (ver también idea de producto #1) — un usuario nuevo que experimenta no puede limpiar lo que creó.
- **Inconsistencia menor de estilo:** el único borrado que existe (script-style) usa `window.confirm()` nativo del navegador en vez del modal glassmorphism del resto de la app — funcionalmente seguro, visualmente discordante justo en el único punto de riesgo.
- **Fricción oculta de calidad:** si el usuario deja vacía la descripción al crear el proyecto (único campo obligatorio es el título), el guion generado se basa solo en ese título corto sin que la UI avise que eso va a dar un resultado genérico (`ScriptPanel.tsx:74-76`, reconocido en un comentario del propio código).
- **Confirmación por mail sin salida clara:** si el registro requiere confirmación de email (`LoginPage.tsx:131-138`), no hay reenvío de confirmación ni indicación de qué hacer después de confirmar — punto de fricción para el onboarding.

---

## Resumen ejecutivo — Las 5 cosas más urgentes antes de sumar features

1. **Cerrar la exposición de las API keys de providers vía PostgREST** (crítico, hoy cualquiera con la anon key pública puede leer las keys de OpenAI/Anthropic/ai33).
2. **Agregar ownership check a `generate_voice`, `transcribe_audio` y `render_video`** (IDOR real, un usuario cualquiera puede leer/operar sobre contenido de otro).
3. **Gatear `/providers` a un rol admin** y agregar rate limiting básico a `/auth/*` y `/tools/*/execute` — hoy cualquier cuenta registrada administra credenciales del sistema y nadie limita el costo de API que un usuario puede generar.
4. **Arreglar los 6 puntos de fallo silencioso en el frontend** (botones que quedan colgados sin error) — es barato de corregir y es la causa más probable de abandono de usuarios reales hoy mismo.
5. **Introducir validación de esquemas (zod) + dejar de devolver errores crudos de Postgres/proveedores al cliente** — cierra de un saque el vector de prompt injection sin sanitizar y la fuga de detalles internos/enumeración de usuarios en auth.
