# Informe de cambios: cobro por video y cierre de gastos

Todo lo que se corrigió y agregó para abrir Scaler Tool a los alumnos cobrando por video. Para cada cambio: **qué pasaba antes**, **qué se hizo**, **por qué** y **un ejemplo**.

- **Rama:** `claude/brave-hypatia-8mp61k`
- **Commits:**
  - `62e5ac4`: cerrar gastos sin control
  - `d21b95e`: sacar IA del frontend, reusar Whisper y cerrar los estados de jobs
  - `41e1cc7`: aprobación de cuentas, contador de videos y panel de admin
- **Plan original:** [`plan-monetizacion-y-seguridad.md`](plan-monetizacion-y-seguridad.md)

> ⚠️ **Nada de esto está desplegado todavía.** Antes de desplegar hay que correr dos migraciones en Supabase, en un orden concreto. Ver [Cómo desplegar](#cómo-desplegar).

---

## Índice

1. [Resumen](#resumen)
2. [Cerrar gastos sin control](#1-cerrar-gastos-sin-control)
3. [Sacar la IA (SnapGen)](#2-sacar-la-ia-snapgen)
4. [Whisper y archivos de audio](#3-whisper-y-archivos-de-audio)
5. [Estados de los jobs](#4-estados-de-los-jobs)
6. [Cerrar el acceso directo a la base](#5-cerrar-el-acceso-directo-a-la-base)
7. [Aprobación de cuentas](#6-aprobación-de-cuentas)
8. [Contador de videos](#7-contador-de-videos)
9. [Panel de administración](#8-panel-de-administración)
10. [Lo que ve el alumno](#9-lo-que-ve-el-alumno)
11. [Cómo se verificó](#cómo-se-verificó)
12. [Cómo desplegar](#cómo-desplegar)
13. [Lo que falta](#lo-que-falta)

---

## Resumen

| # | Problema | Gravedad | Estado |
|---|---|---|---|
| 1 | La API de voz aceptaba cualquier texto: hasta ~90 USD por hora por cuenta | 🔴 Crítico | ✅ Corregido |
| 2 | `/tools` dejaba ejecutar las 17 herramientas internas | 🔴 Crítico | ✅ Corregido |
| 3 | La preview se podía lanzar sin límite y llenaba el worker | 🔴 Crítico | ✅ Corregido |
| 4 | Con la key pública se podía escribir en toda la base | 🔴 Crítico | ✅ Corregido |
| 5 | Cualquiera se podía registrar y usar la herramienta | 🔴 Crítico | ✅ Aprobación de cuentas |
| 6 | No había forma de cobrar por video | — | ✅ Contador de videos |
| 7 | La voz de muestra cobraba cada vez y aceptaba texto libre | 🟠 Alto | ✅ Corregido |
| 8 | Whisper se pagaba de nuevo aunque el audio fuera el mismo | 🟠 Alto | ✅ Corregido |
| 9 | Las voces de un guion se pisaban entre sí (audio equivocado) | 🟠 Alto | ✅ Corregido |
| 10 | La IA (SnapGen) seguía conectada sin estar terminada | 🟠 Alto | ✅ Desactivada |
| 11 | El usuario podía cambiar el estado de los jobs a mano | 🟠 Alto | ✅ Corregido |
| 12 | Guiones sin límite de largo | 🟡 Medio | ✅ Tope de 35.000 caracteres |
| 13 | `POST /auth/test` público y sin uso | 🟢 Bajo | ✅ Borrado |

---

## 1. Cerrar gastos sin control

### 1.1 La voz se genera siempre con el guion guardado

**Antes:** `POST /tools/generate_voice/execute` recibía un campo `text` y generaba la voz de **ese** texto, no del guion del proyecto. La app mandaba el guion, pero cualquiera podía mandar otra cosa desde la consola del navegador.

**Ejemplo del abuso:**

```js
// Desde la consola, con la sesión del alumno
for (let i = 0; i < 30; i++) {
  fetch(API + "/tools/generate_voice/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ input: { script_id: "<su-guion>", text: "bla ".repeat(25000) } }),
  });
}
```

- ~100.000 caracteres por pedido × 5 USD por millón = **~0,50 USD por pedido**.
- El límite era 30 pedidos cada 10 minutos = 180 por hora → **~90 USD por hora, por cuenta**.

**Ahora:** el campo `text` se ignora. La voz se genera con el guion guardado en la base (`backend/src/tools/generateVoice.tool.ts`). Si el guion no cambió, se reutiliza la voz que ya existe.

**Por qué no rompe nada:** la app ya leía el guion guardado justo antes de pedir la voz (`projects.service.ts`), así que para el alumno el resultado es idéntico.

**Mismo ataque hoy:** genera la voz de su propio guion una vez; las siguientes 29 reutilizan esa voz y cuestan **0 USD**.

### 1.2 `/tools` solo deja usar 4 herramientas

**Antes:** `POST /tools/<nombre>/execute` ejecutaba **cualquiera** de las 17 herramientas registradas, incluidas Whisper, búsqueda de stock, render, timeline y generación con IA. Eran herramientas internas del pipeline, pero cualquiera podía llamarlas.

**Ahora:** hay una lista de permitidas, que son las 4 que usa la app (`backend/src/modules/tools/tool.service.ts`):

```ts
const PUBLIC_TOOLS = new Set(["generate_script", "generate_voice", "list_voices", "preview_voice"]);
```

**Ejemplo:**

```http
POST /tools/transcribe_audio/execute
→ 404 { "error": "Herramienta no disponible" }
```

### 1.3 La voz de muestra: texto fijo y una sola vez

**Antes:** "Escuchar voz" aceptaba un **texto libre** (el campo "Texto de prueba") y llamaba a ai33 **cada vez**, aunque el comentario del código decía que reutilizaba el audio. Era otra forma de generar voces de cualquier largo.

**Ahora** (`backend/src/tools/previewVoice.tool.ts`):
- El texto es siempre la frase fija "Hola, esta es una prueba de esta voz para tu proyecto."
- Cada voz se genera una sola vez y queda guardada mientras la API esté prendida.
- Saqué de la pantalla de Audio el campo "Texto de prueba", que ya no tenía efecto.

**Ejemplo:** 6 alumnos escuchan la voz "Valentina" 10 veces cada uno → ai33 cobra **1 vez**, no 60.

### 1.4 Tope de largo del guion: 35.000 caracteres

**Antes:** el guion no tenía límite. Un guion enorme hacía cara la voz (ai33 cobra por carácter) y la transcripción.

**Ahora** (`backend/src/lib/scriptLimits.ts`):
- Se valida **al guardar** el guion, **al generar la voz** y **al generar el guion** con IA (al modelo se le piden como mucho ~31.500 caracteres, para dejar margen).
- Se puede cambiar sin tocar código con la variable de entorno `MAX_SCRIPT_CHARS`.

**Ejemplo:**

```http
PATCH /projects/<id>/script   (guion de 35.001 caracteres)
→ 400 { "error": "El guion tiene 35.001 caracteres y el máximo es 35.000. Acortalo para poder seguir." }
```

### 1.5 Una preview a la vez y límites por hora

**Antes:** "Generar preview" no tenía ningún control. Apretarlo 20 veces encolaba 20 pipelines: cada uno pagaba Whisper y LLM, y **llenaba la cola del worker, frenando a todos los demás alumnos.**

**Ahora:**
- **Una preview a la vez por proyecto** (`backend/src/modules/pipeline/pipeline.service.ts`). Si ya hay una corriendo o un render en curso:

  ```http
  POST /projects/<id>/pipeline/run
  → 409 { "error": "Este proyecto ya se está procesando: esperá a que termine" }
  ```

  Un job "colgado" de hace más de 3 horas no bloquea, para que un proyecto no quede trabado para siempre si la API se reinició a mitad de camino.
- **Límites por hora por alumno** (`backend/src/middleware/rateLimit.middleware.ts`):

  | Acción | Límite |
  |---|---|
  | Previews | 10 por hora |
  | Prompts para Flow (extensión e "Imágenes en lote") | 200 por hora |
  | Cambiar el visual de una escena | 120 por hora |

  Los pedidos rechazados (por ejemplo, un 409) **no gastan cupo**.

**Sobre los 200 de Flow:** "Cargar prompts del proyecto" es **1 pedido** que arma los prompts de **todas** las escenas que faltan, aunque sean 200. Lo que suma de a uno es "Otro prompt" en una escena suelta. 200 por hora alcanza para rehacer muchas escenas sueltas y solo corta un uso en bucle.

### 1.6 Se borró `POST /auth/test`

Era una ruta pública que no hacía nada y nadie usaba.

---

## 2. Sacar la IA (SnapGen)

**Antes:** la generación de imágenes y videos con IA no está terminada, pero estaba conectada y visible: un alumno podía elegir "Solo IA" o "Mixto" y, si había un provider de SnapGen cargado, se generaban clips pagos.

**Ahora:**
- **Backend:**
  - Se desregistraron `generate_image`, `generate_video` y `generate_video_prompt` (`backend/src/tools/index.ts`). Los archivos quedan en el repo para retomarlos.
  - El pipeline busca siempre stock (`backend/src/pipeline/orchestrator.ts`).
  - Regenerar una escena con IA responde `400 "La generación de visuales con IA todavía no está disponible"`.
- **Frontend:**
  - Ya no aparecen el selector "Fuente de los clips" (Stock / Solo IA / Mixto) en la preview, ni "Video con IA" e "Imagen con IA" en escenas y en "Reemplazar clip".
  - La preview guarda siempre "stock": un proyecto viejo con IA elegida queda normalizado la próxima vez que se genere.

**Flow no se tocó:** las imágenes de Flow llegan por la extensión y se conservan igual que antes.

---

## 3. Whisper y archivos de audio

### 3.1 Whisper reutiliza la transcripción

**Antes:** cada preview mandaba el audio a Whisper, **aunque fuera el mismo audio** de la vez anterior. Con ai33 tan barato, Whisper era lo más caro de cada preview.

**Ejemplo:** el alumno arma la preview, cambia 3 imágenes y la rehace. La voz se reutilizaba (0 USD), pero Whisper cobraba otra vez ~0,12 USD por un video de 20 minutos.

**Ahora** (`backend/src/tools/transcribeAudio.tool.ts`): la transcripción se guarda junto al audio. Si se rehace la preview con el mismo audio, se usa la guardada.

| Lo que cambió el alumno | Voz | Whisper | Costo de rehacer la preview |
|---|---|---|---|
| Escenas o imágenes | Se reutiliza | **Se reutiliza** | **~0 USD** (antes ~0,12) |
| El guion o la voz | Se genera | Se transcribe | ~0,25 USD |

### 3.2 Cada voz va a su propio archivo

**Antes:** todas las voces de un guion se guardaban en **el mismo archivo** (`<script_id>.mp3`). Cada voz nueva pisaba a la anterior, pero el sistema seguía creyendo que los registros viejos tenían su audio original.

**Ejemplo del error:**
1. Guion A → voz guardada en `guion.mp3`.
2. Cambia al guion B → la voz nueva **pisa** `guion.mp3`.
3. Vuelve al guion A → el sistema "reutiliza" la voz de A, **pero el archivo tiene la de B**.

Resultado: un video con un audio que no coincide con el guion. Con la transcripción guardada, también hubiera quedado una transcripción equivocada.

**Ahora:** cada voz tiene su propio archivo, nombrado según la voz y el texto. Los audios que sube el alumno también tienen un archivo por subida.

**Contra:** los audios viejos ya no se pisan, así que ocupan más espacio. Se puede agregar una limpieza más adelante.

---

## 4. Estados de los jobs

**Antes:** existían `PATCH /jobs/:id` y `POST /projects/:id/jobs`. Con el primero, un usuario podía pasar un job a "renderizando" o a "completado" a mano, sin que corriera nada. Con el contador de videos, eso podía usarse para confundir el estado del cobro.

**Ahora:** las dos rutas no existen más (`backend/src/modules/jobs/job.route.ts`). Ni la app ni la extensión las usaban. Los estados los maneja solo el sistema: pipeline, botón Renderizar y worker.

```http
PATCH /jobs/<id>  { "status": "COMPLETED" }
→ 404
```

---

## 5. Cerrar el acceso directo a la base

**Antes:** RLS está apagado en todas las tablas y la key pública de Supabase viaja en el código del frontend (es pública por diseño). Con esa key, **cualquiera podía leer y escribir todas las tablas** sin pasar por el backend:

```js
// Ejemplo de ataque (antes funcionaba)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
await supabase.from("scripts").select("*");                       // leer guiones ajenos
await supabase.from("jobs").update({ queue: "render", queue_state: "pending" }).eq("id", "<job>");
// → meter un render en la cola sin pasar por el botón (ni por el contador)
```

Sin cerrar esto, el contador de videos se podía saltear.

**Ahora** (migración `20261015000000_lock_public_tables.sql`):
- La key pública **no puede escribir en ninguna tabla**.
- **Solo puede leer `jobs`**, porque la barra de progreso del render lo escucha por Realtime.
- Las tablas que se creen en el futuro arrancan cerradas.
- El backend no se ve afectado: usa la key de servicio.

**Ejemplo hoy:**

```js
await supabase.from("jobs").update({ progress: 1 });   // → permission denied for table jobs
await supabase.from("video_credits").select("*");      // → permission denied for table video_credits
await supabase.rpc("charge_render", { ... });          // → permission denied for function charge_render
```

**Vuelta atrás**, si algo del frontend dejara de andar:
`grant select, insert, update, delete on all tables in schema public to anon, authenticated;`

---

## 6. Aprobación de cuentas

**Antes:** cualquiera se registraba y usaba todo. Con videos gratis al registrarse, alguien podía crearse 10 cuentas y tener 50 videos.

**Ahora:**
1. Al registrarse (con mail **o con Google**), la cuenta queda **pendiente**.
2. Una cuenta pendiente **no puede hacer nada**: el backend responde 403 a cualquier pedido, también desde la extensión de Flow.
3. Seba la aprueba desde el panel de **Administración** y recibe **5 videos de bienvenida**.

**Cómo funciona por dentro** (`backend/src/middleware/auth.middleware.ts`):
- El mismo middleware que valida el inicio de sesión ahora también mira si la cuenta está aprobada. Como **todas** las rutas lo usan, no hay forma de esquivarlo, ni siquiera desde la extensión.
- La cuenta se crea la primera vez que el usuario hace cualquier pedido. Así se cubre también el login con Google, que no pasa por `/auth/register`.
- **Los admins pasan siempre** (`ADMIN_USER_IDS`).
- Para no consultar la base en cada pedido, "aprobada" se recuerda 60 segundos. "Pendiente" se consulta siempre, así **aprobar tiene efecto en el acto**.

**Ejemplo:**

```http
GET /projects   (cuenta pendiente)
→ 403 { "error": "Tu cuenta está esperando aprobación. Avisale al administrador para que la habilite.",
        "code": "ACCOUNT_PENDING" }
```

**Los 5 videos de bienvenida se dan una sola vez.** Aprobar de nuevo, o aprobar después de haber rechazado, no los vuelve a dar.

**Cuentas que ya existen:** la migración las deja **aprobadas y sin límite**, porque son del equipo; así nadie queda afuera al desplegar. Si algún alumno ya se había registrado, hay que sacarle el "sin límite" desde el panel.

---

## 7. Contador de videos

### Cómo funciona

1. El alumno aprieta **"Aprobar y renderizar"**.
2. Si el proyecto **ya se cobró antes** (es un re-render) → **no descuenta**.
3. Si el dueño es una cuenta **sin límite** → **no descuenta**.
4. Si no le quedan videos → **402** "Se terminaron tus videos", y el render no arranca.
5. Si tiene saldo → **descuenta 1 en ese momento** y el render arranca.
6. Si el render **falla definitivamente**, después de todos los reintentos → **el video se devuelve solo**.

### Por qué así

- **Se descuenta al apretar y no al terminar:** si se descontara al final, un alumno con 1 video podría apretar Renderizar en 3 proyectos a la vez y los 3 pasarían el control. Descontando al apretar, el segundo y el tercero ya ven saldo 0.
- **Se descuenta al dueño del proyecto**, no al miembro del workspace que aprieta el botón.
- **Todo el cobro es atómico en la base** (funciones SQL `charge_render` y `refund_render`). Dos pedidos simultáneos se procesan de a uno, así que no hay dobles cobros ni saldo negativo.

### Dónde se devuelve el video

Hay tres formas en que un render puede fallar, y las tres devuelven:

| Caso | Dónde |
|---|---|
| El worker falla en el último intento | `backend/src/worker.ts` (`handleFailure`) |
| El worker se muere a mitad del render (job huérfano) | `backend/src/worker.ts` (`recoverStaleJobs`) |
| Modo inline (sin worker) | `backend/src/modules/jobs/job.service.ts` |

En los reintentos intermedios no se toca nada: **un render con 3 intentos descuenta como mucho 1 video.**

**El video no se devuelve** si el proyecto ya tuvo alguna vez un render terminado. En ese caso el video se usó, y lo que falló fue un re-render, que no descontó.

### Ejemplos

**Caso normal:**

| Paso | Saldo |
|---|---|
| Seba lo aprueba | 5 |
| Renderiza "Video 1" | 4 |
| Cambia una escena y re-renderiza "Video 1" | 4 (no descuenta) |
| Renderiza "Video 2" | 3 |

**Render que falla:**

| Paso | Saldo |
|---|---|
| Tiene 3 y aprieta Renderizar | 2 (reservado) |
| Intentos 1 y 2 fallan, se reintenta | 2 |
| Intento 3 falla (fallo final) | **3 (devuelto)** |

**Sin saldo:**

```http
POST /jobs/<id>/approve-stock-review
→ 402 { "error": "Se terminaron tus videos. Contactá al administrador para cargar más.",
        "code": "NO_VIDEO_CREDITS" }
```

### Proyectos que ya existían

Los proyectos que ya tienen un video final de antes de este cambio quedan marcados como **ya cobrados**. Sin esto, re-renderizar un proyecto viejo descontaba un video y, si fallaba, no se devolvía.

---

## 8. Panel de administración

Página nueva **Administración** (`/admin`). El link aparece en el menú **solo para admins**; el backend rechaza a cualquier otro con 403.

**Qué puede hacer Seba:**

| Pestaña | Acciones |
|---|---|
| **Pendientes** | Aprobar (le da 5 videos) o Rechazar |
| **Aprobados** | Ver disponibles, usados y último render; botón **Videos** para cargar, sacar o marcar "sin límite" |
| **Rechazados** | Aprobar si fue un error |

**Cargar videos después de un pago:**
- El campo viene con **20** por defecto (el paquete de 20 videos por 25 USD).
- Se agrega una **nota**, por ejemplo "pagó 25 USD por transferencia".
- Un **número negativo saca videos**, para corregir una carga. Nunca deja el saldo en negativo.

**Historial de cada alumno:** cada carga, uso y devolución, con quién lo hizo y cuándo. Por ejemplo:

```
+20  Carga · pagó 25 USD por transferencia     hace 2 h · seba
 -1  Render · Video 3                          ayer
 +1  Devolución (render fallido) · Video 2     hace 2 días
 -1  Render · Video 2                          hace 2 días
 +5  Bienvenida                                hace 3 días · seba
```

**Rutas del backend** (`backend/src/modules/admin/`):

| Ruta | Qué hace |
|---|---|
| `GET /admin/users` | Lista de usuarios con su saldo |
| `POST /admin/users/:id/approve` | Aprueba y da los videos de bienvenida |
| `POST /admin/users/:id/reject` | Rechaza (no se puede rechazar a un admin) |
| `POST /admin/users/:id/credits` | Suma o resta videos con nota |
| `POST /admin/users/:id/unlimited` | Activa o desactiva "sin límite" |
| `GET /admin/users/:id/movements` | Historial |

---

## 9. Lo que ve el alumno

- **Cuenta pendiente:** en vez de la app, una pantalla con "Tu cuenta está pendiente", un botón **"Ya me aprobaron, revisar"** y "Cerrar sesión". Si fue rechazada: "Tu cuenta no fue aprobada".
- **Saldo en el menú:** "4 videos disponibles". Con 0 se pone en rojo con "Contactá al administrador para cargar más". Las cuentas sin límite no lo ven.
- **Al renderizar**, al lado del botón "Aprobar y renderizar":
  - "Usa 1 video (te quedan 4)."
  - "Este proyecto ya usó su video: renderizarlo de nuevo no descuenta."
  - "Se terminaron tus videos. Contactá al administrador para cargar más." Con el **botón bloqueado**.
- Después de renderizar, el saldo del menú se actualiza solo.
- **Extensión de Flow:** con una cuenta pendiente, muestra el mensaje del backend ("Tu cuenta está esperando aprobación..."). No hizo falta cambiarla.

---

## Cómo se verificó

| Qué | Cómo | Resultado |
|---|---|---|
| Backend y frontend | Compilación (`tsc` y `vite build`) | ✅ Sin errores |
| Herramientas permitidas | API levantada sin base, pedidos reales | ✅ Las no permitidas dan 404; la lista muestra solo 4 |
| Tope del guion | Ídem | ✅ 35.001 caracteres → 400; 35.000 pasa |
| Rutas de jobs borradas | Ídem | ✅ 404 |
| Panel de admin sin ser admin | Ídem | ✅ 403 |
| **Migraciones** | Postgres 16 real, con tablas que imitan las de Supabase | ✅ Corren limpias, y se pueden volver a correr sin romper nada |
| Aprobación | Ídem | ✅ +5 al aprobar; aprobar de nuevo no repite |
| Cobro y devolución | Ídem | ✅ Cobra 1; el re-render no cobra; devuelve si falla; no devuelve si hubo un render final |
| **6 proyectos con 1 video, a la vez** | Ídem, 6 sesiones en paralelo | ✅ **Solo 1 se cobra** |
| **5 clicks simultáneos en el mismo proyecto** | Ídem | ✅ **Se cobra 1 sola vez** |
| Saldo negativo | Ídem | ✅ Restar de más da error |
| Permisos de la key pública | Ídem, con los roles `anon` y `authenticated` | ✅ No puede escribir en `jobs`, ni leer saldos, ni llamar a las funciones de cobro |
| Proyectos viejos | Ídem | ✅ Los que tienen video final quedan como ya cobrados |

**Lo que no se pudo probar acá** (necesita la base real de Supabase, para los tests del viernes):
- La barra de progreso del render por Realtime después de cerrar la base.
- El flujo completo con el worker: renderizar, fallar y que se devuelva.
- La reutilización de la voz y de Whisper con audios reales.
- El login con Google creando la cuenta pendiente.

---

## Cómo desplegar

**El orden importa:** la API nueva llama a funciones de la base que crean las migraciones. Si se despliega el código antes, **todos los pedidos fallan**.

1. **Migraciones en Supabase** (SQL Editor, en este orden):
   1. `backend/supabase/migrations/20261015000000_lock_public_tables.sql`
   2. `backend/supabase/migrations/20261015010000_accounts_and_video_credits.sql`
2. **Variables de entorno**, en Render (API) **y** en el worker de Hetzner:
   - `ADMIN_USER_IDS=<uuid-de-joaquin>,<uuid-de-seba>` (en Supabase → Authentication → Users).
   - Opcionales: `WELCOME_VIDEOS` (default 5) y `MAX_SCRIPT_CHARS` (default 35000).
3. **Código:** API en Render, worker en Hetzner y frontend en Netlify.
4. **Prueba rápida** con una cuenta nueva:
   1. Al registrarse ve "Tu cuenta está pendiente".
   2. Seba la aprueba desde Administración → tiene 5 videos.
   3. Renderiza → baja a 4, y la barra de progreso se mueve.

---

## Lo que falta

| Qué | Estado |
|---|---|
| Tope de voces por proyecto | A definir con Seba y el mentor (y lo de las voces clonadas) |
| Tests de integración contra una base de pruebas | **El viernes**; falta elegir: proyecto de Supabase aparte o local |
| Pasar las imágenes de escenas a R2 (lo del límite de almacenamiento) | Pendiente |
| Limpieza de audios viejos | Opcional, más adelante |
| Errores crudos de la base, límites en `/auth/refresh` | Después del sábado |
