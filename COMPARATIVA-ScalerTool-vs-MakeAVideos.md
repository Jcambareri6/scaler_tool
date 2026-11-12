# COMPARATIVA — Scaler Tool vs Make a Videos (MaV 1.1.0)

> Fuentes: código de Make a Videos en `makeavideos-v1.1.0/` (todas las rutas de MaV son relativas a esa carpeta) e `INFORME-arquitectura-y-proveedores.md` para Scaler Tool (se toma como la verdad).
> Convenciones: **[Impl]** = implementado y llamado desde el pipeline · **[Config]** = existe como opción o interruptor · **[No verificado]** = deducido, sin confirmar en el código.
> Fecha del análisis: 2026-11-11.

---

## 0. Resumen ejecutivo

- **Dónde gana MaV:** calidad editorial del documental con material real. Decide plano a plano qué enseñar, busca archivo real (YouTube frase a frase, archive.org, Commons, Wikidata, capturas de páginas, datos abiertos) y valida cada plano con jueces de visión. Además tiene 26 estilos definidos como JSON, vertical 9:16 para todos los estilos, música con ducking, efectos de sonido, normalización de loudness y control de calidad automático del MP4.
- **Dónde gana Scaler Tool:** es un SaaS multiusuario real (workspaces, créditos, reembolsos), con una cola en Postgres preparada para escalar en horizontal, trazabilidad (`tool_executions`) y una revisión humana obligatoria antes del render. Su sincronía siempre usa Whisper por palabra. Tiene video IA (Veo/Seedance), Google Flow y un documental animado agéntico. Además, sus fuentes visuales tienen menos riesgo legal: stock con licencia, frente al metraje de YouTube que usa MaV.
- **Las 5 brechas más importantes de Scaler Tool:**
  1. No tiene un **plan de planos por frase**: hoy arma escenas de 4 a 12 s con keywords de stock.
  2. Le faltan **fuentes de archivo documental con licencia**: fotos de personas, cosas y lugares, archivo histórico, capturas de páginas y datos.
  3. No hay **validación visual por plano**: ni juez de relevancia, ni control de época, ni reemplazo automático.
  4. El **lenguaje visual es pobre**: un único Ken Burns, transiciones solo de tipo fade, sin gradación de color, sin viñeta, sin capítulos ni rótulos anclados al plano.
  5. **Audio y formato:** no figura música con ducking ni efectos de sonido, no normaliza el loudness y no hay 9:16.

---

## 1. Ficha de Make a Videos

### 1.1 Stack

| Pieza | Tecnología | Evidencia |
|---|---|---|
| Orquestación | Docker Compose: postgres 16, redis 7, minio, backend, worker, renderer, frontend | `docker-compose.yml` (servicios `postgres`, `redis`, `minio`, `backend`, `worker`, `renderer`, `frontend`) |
| API y worker | Node + Express, el mismo código con `ROLE=api` o `ROLE=worker` | `backend/package.json` (scripts `start:api`, `start:worker`) |
| Colas | Bull sobre Redis | `backend/src/queues/index.js:1`, `backend/src/config/queue.config.js:78` |
| Render | Remotion (Chrome headless) en el contenedor `renderer`, con render por trozos; opcionalmente AWS Lambda o RunPod | `backend/runpod-renderer/server.js:833-841`, `backend/src/services/localRenderService.js:8-39`, `backend/src/services/clavesProveedores.js:180-205` |
| Editor | React y Vite con el editor de timeline de DesignCombo (paquetes `state`, `timeline`, `animations`, `transitions`), unas 175 plantillas de motion graphics | `frontend/packages/`, `frontend/src/pages/editor/player/items/motion-graphics/` |
| Paridad editor/render | El backend renderiza con una copia del player del frontend | `backend/remotion/frontend-mirror/`, `backend/package.json` (`sync:remotion`) |
| Base de datos | Postgres, 68 migraciones | `backend/database/migrations/` |
| Almacenamiento | MinIO (compatible con S3), local | `docker-compose.yml` (servicio `minio`) |
| Licencia | Licencia local atada a la huella del equipo, de un solo dueño | `backend/src/licencia/`, `backend/database/migrations/063_licencia_local.sql` |

### 1.2 Arquitectura

```
┌───────────────┐  REST   ┌──────────────────┐  Bull/Redis  ┌───────────────────────┐
│ Frontend      │────────▶│ backend (API)    │─────────────▶│ worker (mismo código) │
│ React+Vite    │         │ Express          │              │ generación, plan,     │
│ Editor        │◀────────│ ROLE=api         │              │ relleno, QA, sonido   │
│ (DesignCombo) │ polling └────────┬─────────┘              └───────────┬───────────┘
└──────┬────────┘                  │                                    │ HTTP (chunks)
       │ Player Remotion           │                                    ▼
       │ (mismos componentes)  ┌───▼──────┐    ┌─────────┐   ┌───────────────────────┐
       └──────────────────────▶│ Postgres │    │ MinIO   │◀──│ renderer (Remotion,   │
                               └──────────┘    │ (S3)    │   │ Chrome headless)      │
                                               └─────────┘   │ opc. Lambda / RunPod  │
 APIs externas: Anthropic, Gemini, AssemblyAI, Cartesia,     └───────────────────────┘
 ElevenLabs, MiniMax, OpenAI, ai33, Fish Audio, WaveSpeed, kie.ai, Voyage, Pexels,
 Scrapingdog, YouTube (yt-dlp + proxy), Commons/Openverse/Wikidata/Wikipedia/GDELT,
 archive.org, Banco Mundial/ONU
 Servicios locales opcionales: motor2d-gpu (:9010), avatar SoulX-FlashHead (:9011)
```

### 1.3 Pipeline paso a paso (montaje "plan", el modo por defecto)

| # | Paso | Qué hace | Evidencia |
|---|---|---|---|
| 1 | Guion | Claude con un "playbook" de estructuras (documental, explicativo, top, historia, noticias, Shorts). Puede seguir el **formato de guion activo** del canal. | `backend/src/services/uniqueScriptService.js:37-74`, `backend/src/prompts/guiones/PLAYBOOK.md:97-153`, `backend/src/services/formatoGuion.js` (cabecera) |
| 1b | Comprobación de hechos | Antes de la voz: Haiku extrae las afirmaciones y las contrasta con Wikipedia, Wikidata y el Banco Mundial; reescribe lo falso y suaviza lo dudoso. **[Impl] solo en el flujo de producción en lote.** | `backend/src/services/comprobarHechos.js:552`, `backend/src/queues/processors/produccionProcessor.js:137-151` |
| 2 | Voz | Varios proveedores (ver 1.4). El audio sale siempre en WAV. | `backend/shared/services/vozProveedores.js` (cabecera) |
| 3 | Tiempos por palabra | AssemblyAI (sube el audio). Sin clave, **reparto estimado por caracteres**. | `backend/src/services/projectService.js:478-509` |
| 4 | Plan de planos | Un LLM (Gemini Flash o Claude Haiku) propone planos anclados a palabras, con una clase cada uno. El código valida cobertura, duraciones y presupuesto. | `backend/src/services/planDePlanos.js:1079` (`crear`), `:747` (`validar`), `:355` |
| 5 | Relleno | Para cada plano prueba su cadena de fuentes y respaldos, con caché de 14 días y deduplicación perceptiva. | `backend/src/services/rellenarPlan.js:2308` (`rellenar`), `:1036-1075` |
| 6 | QA visual | Juez de visión por lotes (Gemini, o Claude de reserva). Lo que no pasa va al siguiente respaldo. | `backend/src/services/qaPlan.js:571` (`revisar`), `backend/shared/utils/juez.js` (cabecera) |
| 7 | Timeline | Convierte el plan en items: movimiento, rótulos, transiciones y subtítulos. | `backend/src/services/timelineDesdePlan.js:427` (`construir`); se llama desde `projectService.js:1345` |
| 8 | Directores por estilo | 3D, 2D, mapas, partida, collage, Director v2 (gráficos), banda de noticias, foto viva | `backend/src/services/projectService.js:1423-1555` |
| 9 | Presentador IA | Si el estilo trae `look.avatar` | `projectService.js:1574-1586`, `:3120` |
| 10 | Sonido | Normaliza la voz a −14,5 LUFS, añade música con ducking y efectos de sonido; opcionalmente ajusta los cortes al golpe de la música | `projectService.js:1591`, `:2859`; `backend/src/services/mezclaVoz.js:27`; `backend/src/services/sonidoMontaje.js` |
| 11 | Revisión | Página de revisión del plan y editor completo antes de exportar. Por defecto **no exporta solo** (el interruptor `exportar_al_terminar` está en "no"). | `frontend/src/pages/Studio/plan/planRevision.js`, `backend/src/services/montaje.js` (interruptor `exportar_al_terminar`), `projectService.js:1680-1681` |
| 12 | Render | Remotion por trozos (`LOCAL_CHUNK_CONCURRENCY`=2), concatenación y subida a MinIO | `localRenderService.js:19`, `:241` |
| 13 | QC del MP4 | ffmpeg revisa negro, imagen congelada, loudness (ebur128), formato y una hoja de contactos | `backend/src/services/revisionExport.js:309-338`, `backend/src/queues/processors/videoProcessor.js:61` |

### 1.4 Proveedores

| Proveedor | Uso | Modelo / endpoint | Archivo |
|---|---|---|---|
| Anthropic | Guion, plan (reserva), juez (reserva), director 2D (código), mapas, escenas 3D, regenerar plano | `claude-opus-5` (código 2D, configurable), `claude-sonnet-5-5`, `claude-haiku-5`/`-5-5`, `claude-haiku-4-5` en el juez | `backend/src/services/clavesProveedores.js:31-36`, `backend/shared/utils/juez.js`, `backend/src/services/director2d.js` (cabecera), `backend/src/services/planDePlanos.js:414` |
| Google Gemini | Plan de planos y **jueces de visión** (nivel gratuito) | `gemini-flash-latest`, `gemini-flash-lite-latest`; imagen: `gemini-2.5-flash-image`, `gemini-3.1-flash-image` | `planDePlanos.js:355-356`, `backend/shared/utils/juez.js`, `backend/shared/services/imagenIA.js` |
| AssemblyAI | Tiempos por palabra | upload + transcript | `backend/src/services/projectService.js:478-492`, `backend/src/services/assemblyAIService.js` |
| Whisper local | Entrevistas, Clipper, Shorts de proyectos antiguos | local (`transcribe_*.py`) | `backend/src/services/entrevistas.js` (cabecera, paso 4), `backend/src/services/clipper.js` (cabecera) |
| Cartesia | Voz y clones | `sonic-3` | `backend/shared/services/cartesiaTtsService.js` |
| ElevenLabs | Voz | `eleven_multilingual_v2`, `eleven_flash_v2_5`… | `clavesProveedores.js:46-52`, `backend/src/queues/processors/ai84TtsProcessor.js` |
| OpenAI | Voz barata | `gpt-4o-mini-tts` | `backend/shared/services/vozProveedores.js` |
| MiniMax | Voz y clones | `speech-2.5-hd-preview`, `speech-2.6-*` | `clavesProveedores.js:62-68`, `backend/src/services/voiceService.js` |
| ai33 | Voz (ElevenLabs revendido) | — | `clavesProveedores.js:70-76` |
| Fish Audio | Voz y clones | — | `clavesProveedores.js:99-105` |
| API propia | TTS compatible con OpenAI (`/v1/audio/speech`), por ejemplo Kokoro | — | `clavesProveedores.js:82-97` |
| WaveSpeed | Imágenes IA (Seedream v4), música (MiniMax Music 2.6), foto viva (Wan 2.2 i2v 480p), avatar (InfiniteTalk) | `seedream-v4`, `minimax/music-2.6`, `wan-2.2/i2v-480p` | `backend/shared/services/imagenIA.js`, `backend/shared/services/musicaIA.js` (cabecera), `backend/src/services/fotoViva.js:21`, `backend/shared/services/avatarIA.js` |
| kie.ai | Avatar (Kling Avatar) | `kling/ai-avatar-standard`/`-pro` | `clavesProveedores.js:150-155`, `backend/shared/services/avatarIA.js` |
| SoulX-FlashHead (local) | Avatar gratis con GPU NVIDIA | servidor :9011 | `tools/avatar-local/` |
| Voyage AI | Reordena los clips de YouTube por similitud | — | `clavesProveedores.js:157-162` |
| YouTube (yt-dlp + proxy de respaldo) | Metraje frase a frase, entrevistas, clonador | búsqueda, subtítulos y descarga en 720p | `backend/src/services/youtubePlano.js:970` (`buscar`), `clavesProveedores.js:170-178` |
| Wikimedia Commons / Openverse | Fotos con licencia libre | API pública | `backend/src/services/fotoTema.js:412` |
| Wikidata / Wikipedia | Foto de una persona pública (P18) | API pública | `backend/src/services/personaPorNombre.js:553` |
| Wikipedia / GDELT + Chrome headless | Captura de la página real con la frase resaltada | CDP | `backend/src/services/paginasReales.js:653` |
| Internet Archive | Archivo histórico (noticiarios) | API pública | `backend/src/utils/clipArchivo` (citado en `rellenarPlan.js` cabecera) **[No verificado línea]** |
| Banco Mundial / ONU | Series y pirámides de población | API pública | `backend/src/services/datosAbiertos.js` |
| Pexels | Video de stock (respaldo) | API | `backend/src/services/rellenarPlan.js:843-864` |
| Scrapingdog | Google Imágenes (opcional, montaje clásico) | API | `clavesProveedores.js:107-112`, `backend/src/services/scrapedogService.js` |
| Kevin MacLeod (incompetech) | Música libre CC BY 4.0, 26 pistas | descarga a MinIO | `backend/shared/services/musicaLibre.js` (cabecera) |
| ffmpeg (síntesis) | Efectos de sonido propios (whoosh, golpe, papel, tic…) | local | `backend/shared/services/efectosSonido.js:1-20` |
| AWS Lambda / RunPod | Render en la nube (opcional) | Remotion Lambda, endpoint de RunPod | `clavesProveedores.js:180-205`, `backend/src/services/renderNube.js` |

Las claves de proveedor se guardan en la tabla `claves_proveedores` (tienen prioridad) o en el `.env` (`clavesProveedores.js`, cabecera). Hay un `.env.example` con marcadores; no se copió ningún secreto.

### 1.5 Almacenamiento de videos y archivos

**Principio:** todo binario vive en MinIO local (S3). Los medios externos (fotos de Commons, etc.) se **espejan** a almacenamiento propio en segundo plano y otra vez justo antes de exportar (`backend/src/services/backgroundMirrorService.js`, cabecera; `projectService.js:5337-5381`). El timeline vive en `projects.timeline_state` (JSON) y el plan en `script_data.plan`.

| Archivo | Origen | Se copia a storage propio | Clave / ruta | Registro en DB |
|---|---|---|---|---|
| Narración TTS | Cartesia / otros | Sí | `tts-audio/<userId>/voice-<uuid>.wav` (`cartesiaTtsService.js:374`) | item de voz en `timeline_state` |
| Narración normalizada (−14,5 LUFS) | ffmpeg | Sí | `narracion/<projectId>/voz-<ts>.mp3` (`mezclaVoz.js:69`) | el item de voz pasa a usarla |
| Clip de YouTube por frase | YouTube, recortado sin audio | Sí (recodificado) | `youtube-plano/<userId>/<uuid>.mp4` (`youtubePlano.js:739`, `:930`) | `script_data.plan[].relleno` + item `video` |
| Captura de página real | Chrome headless | Sí | `paginas-reales/<userId>/<hash>.png` (`paginasReales.js:690`) | `relleno` + tabla `creditos` |
| Foto de Commons / Openverse / persona | APIs públicas | Sí (espejo) | **[No verificado: clave exacta]** | `relleno` + tabla `creditos` (`migrations/058_creditos.sql`) |
| Música IA | WaveSpeed MiniMax Music | Sí, se reutiliza por ánimo | `musica/<animo>/<uuid>.mp3` (`musicaIA.js:140`) | tabla `musica_biblioteca` (migración 056) |
| Música libre | incompetech | Sí | `musica/libre/<animo>/<id>.mp3` (`musicaLibre.js:135`) | `musica_biblioteca` + `creditos` |
| Efectos de sonido | ffmpeg (sintetizados) | Sí | `sfx/v2/<nombre>.mp3` (`efectosSonido.js:306`) | — |
| Trozos de render | renderer | Sí (temporales) | `chunks/<userId>/<projectId>/<batchId>/<n>.mp4` (`runpod-renderer/server.js:891`) | — |
| **Render final** | Remotion | Sí | `exports/<userId>/<projectId>-<timestamp>.mp4` (`localRenderService.js:241`): **no se sobrescribe**, versionado por timestamp | proyecto / fila de render (migración 030) |
| Clips del Clipper | ffmpeg | Sí | `clipper/<id>/clip-N.mp4` (`clipper.js`, cabecera) | `clipper_trabajos` |

---

## 2. Catálogo de formatos de Make a Videos

### 2.1 Dimensiones comunes a todos los formatos

- **Relación de aspecto:** cualquier estilo se puede generar en **16:9 (1920×1080)** o **9:16 (1080×1920)**. La versión vertical cambia los subtítulos (84 px, 3 palabras, mayúsculas), usa planos de 1,5 a 3,2 s, quita la banda de noticias y el avatar, aplica cortes de zoom cada 1,6 s y reencuadra cada plano en "recorte" o "banda". Evidencia: `backend/src/services/formatoVideo.js:18-21`, `backend/src/estilos/index.js:216-239`, `:450-499`, `backend/src/services/encuadreVertical.js`.
- **Resolución:** solo 1080 (no se encontró opción de 720p) **[No verificado: ausencia de 720p]**.
- **fps:** 30 (`backend/src/services/timelineService.js:886`).
- **Códec:** H.264 (`runpod-renderer/server.js:837`). Opcionalmente NVENC en GPU, con fallback a libx264 (`server.js:190-240`). Audio: **[No verificado]** (el valor por defecto de Remotion es AAC).
- **Duración de plano por defecto (plan):** normal 2,5 a 9 s; persona 3,2 a 6; mapa 4 a 7; página 3,4 a 6,5. Los gráficos duran según su herramienta. (`backend/src/services/planDePlanos.js:69-76`). Un estilo puede cambiarlo con `plan.planoMinSeg/planoMaxSeg`.
- **Estilos ocultos** (no salen en el formulario): `hogar`, `avatar-premium` (`backend/src/estilos/index.js:336`, `:509`).

### 2.2 Tabla de formatos

| Formato (id) | Descripción | Visuales | Duración de escena | Aspecto | Resolución | Archivos fuente |
|---|---|---|---|---|---|---|
| Genérico documental (`classic`) | Documental de archivo y biografías con fotografía real | Plan: fotos, clips y rótulos | 2,5–9 s | 16:9 / 9:16 | 1080 | `estilos/classic.json` |
| **Documental** (`documental`) | Como un documental de plataforma: metraje real, mapas, titulares, gráficos sobrios en serif dorado | YouTube, archivo, Commons, personas, páginas, mapas, gráficos | 2,5–9 s; gráficos ≤30 %, 3/min (6/min en el gancho) | 16:9 / 9:16 | 1080 | `estilos/documental.json`, `planDePlanos.js`, `rellenarPlan.js`, `timelineDesdePlan.js`, `directorV2.js` |
| Locomotoras alemanas (`locomotoras`) | Trenes, máquinas y rutas, con mapas | Plan + plantillas de trenes | 2,5–9 s | 16:9 / 9:16 | 1080 | `estilos/locomotoras.json` |
| Expediente (`expediente`) | Sucesos y misterios contados como un informe | Plan + marco + citas, fechas y titulares | 2,5–9 s | 16:9 / 9:16 | 1080 | `estilos/expediente.json` |
| Cuaderno (`cuaderno`) | Ensayo a mano alzada (psicología, dinero, cultura) | Imagen IA en estilo boceto, cada 5 s, con marco | ~5 s por imagen | 16:9 / 9:16 | 1080 | `estilos/cuaderno.json` |
| Cuentos 2D (`cuentos2d`) | Historias en segunda persona | Solo imágenes IA 2D, personaje siempre presente; sin saldo, busca cuadros | ~5,5 s por imagen | 16:9 / 9:16 | 1080 | `estilos/cuentos2d.json`, `timelineService.js:814` |
| Presentador IA (`avatar`) | Explicaciones y dinero con una cara de confianza | Solo imágenes IA fotorrealistas + avatar al inicio | ~7 s por imagen | 16:9 (vertical sin avatar) | 1080 | `estilos/avatar.json`, `projectService.js:3120` |
| Avatar IA v2 (`avatar-ia-jim`) | Cara fija con muchas apariciones; avatar local gratis | Imagen IA + archivo + Pexels + YouTube (1/min) + avatar | 6–10 s | 16:9 | 1080 | `estilos/avatar-ia-jim.json`, `tools/avatar-local/` |
| Presentador IA Premium (`avatar-premium`, oculto) | El presentador vuelve durante todo el video | Imagen IA + avatar | ~6 s | 16:9 | 1080 | `estilos/avatar-premium.json` |
| Hogar moderno (`hogar`, oculto) | Consejos de casa con presentadora IA | Plan + marco + avatar | 2,5–9 s | 16:9 | 1080 | `estilos/hogar.json` |
| Historia (`historia`) | Imperios y dinastías desde su fundación | Óleos IA cada 9,7 s + foto viva + mapas | ~9,7 s | 16:9 / 9:16 | 1080 | `estilos/historia.json` |
| Profundo (`profundo`) | Historia militar, espionaje, aviación, espacio | Archivo antes que YouTube, mapas, marco | 2,5–9 s | 16:9 / 9:16 | 1080 | `estilos/profundo.json` |
| Almanaque (`almanaque`) | Quién fue alguien o qué fue una cosa (formato cromo) | YouTube y archivo sin texto; gradación por plantilla | 2,5–9 s; 1,2 gráficos/min | 16:9 / 9:16 | 1080 | `estilos/almanaque.json` |
| Collage (`collage`) | Papel, tijera e hilo rojo | Plan + escenas collage + foto viva | 2,5–9 s | 16:9 / 9:16 | 1080 | `estilos/collage.json`, `directorV2.js` (`ponerCollage`) |
| Nocturno (`nocturno-3d`) | Guerra y espías como un tráiler nocturno | Archivo en blanco y negro + escenas 3D mezcladas + dossier | 2,5–9 s | 16:9 / 9:16 | 1080 | `estilos/nocturno-3d.json`, `director3d.js` |
| Noticiero (`noticiero`) | Actualidad como un parte de noticias | Plan + banda de noticias + mapas + avatar | 2,5–9 s; 3,5 gráficos/min | 16:9 (vertical sin banda) | 1080 | `estilos/noticiero.json`, `directorV2.js` (`ponerBandaNoticias`) |
| Tebeo (`tebeo`) | Historia en viñetas con humor | Dibujo IA cada 6 s + foto viva + mapas; subtítulos cómic | ~6 s | 16:9 / 9:16 | 1080 | `estilos/tebeo.json` |
| Leyenda (`leyenda`) | Biografías y rankings de famosos con fragmentos reales de entrevistas | Plan + entrevistas `[[clip:]]` + rótulos | 2,5–9 s | 16:9 / 9:16 | 1080 | `estilos/leyenda.json`, `entrevistas.js` |
| Horizonte (`horizonte`) | Demografía y economía | Plan + series y pirámides de datos reales + mapas | 2,5–9 s; gráficos ≤45 % | 16:9 / 9:16 | 1080 | `estilos/horizonte.json`, `datosAbiertos.js` |
| Cancha (`cancha`) | Deportes: biografías, partidos, rivalidades | Plan + entrevistas + capa "old-movie" + cortes de cara | 2,5–9 s | 16:9 / 9:16 | 1080 | `estilos/cancha.json` |
| Aventura (`aventura`) | Historia contada como un videojuego, por niveles | Escenas 3D escritas por IA + HUD de juego | **[No verificado]** | 16:9 / 9:16 | 1080 | `estilos/aventura.json`, `partida.js`, `director3d.js` |
| Monigotes 2D (`monigotes`) | Explicadores y "¿qué pasaría si…?" con figuras de palitos | Claude escribe el código de cada plano para un motor 2D | **[No verificado]** | 16:9 / 9:16 | 1080 | `estilos/monigotes.json`, `director2d.js`, `tools/motor2d-gpu/` |
| Neón (`neon`) | Noticias de videojuegos rápidas | Plan + plantillas `neon-*` | 2,5–9 s; 4,5 gráficos/min | 16:9 / 9:16 | 1080 | `estilos/neon.json` |
| Análisis de marcas (`clon-analisis-marcas`) | Clonado de un video de referencia | Plan | 1–5,6 s | 16:9 / 9:16 | 1080 | `estilos/clon-analisis-marcas.json` |
| Curiosidades 3D TikTok (`clon-curiosidades-3d-…`) | Clonado; misterio en 3D | Imagen IA de render 3D estilizado cada 4,1 s | ~4,1 s | 9:16 preferente (`look.vertical`) | 1080 | `estilos/clon-curiosidades-3d-tiktok-73fd.json` |
| Mapa interactivo (`clon-mapa-interactivo-…`) | Video entero como mapa animado | Director de mapas (Claude → JSON de escena) | 6,9–14 s (frases de 2,5–6,5 s) | 16:9 / 9:16 | 1080 | `estilos/clon-mapa-interactivo-966d.json`, `directorMapa.js` |
| **Derivado:** Cortar en Shorts | 2–3 shorts de 30–60 s sacados de un video largo, reusando su material | Material del plan del largo, encuadre 9:16 | 1,5–3,2 s | 9:16 | 1080×1920 | `backend/src/services/cortarShorts.js`, `routes/projectRoutes.js:44-47` |
| **Derivado:** Clipper | Un video externo se convierte en 3–8 clips verticales con subtítulos | Recorte al centro o fondo difuminado | clip de 30–60 s | 9:16 | 1080×1920 | `backend/src/services/clipper.js` |

### 2.3 Fichas por formato

Todas las fichas de estilos de "plan" comparten el pipeline de §1.3. Solo se indica lo que las distingue.

- **classic / locomotoras:** son los estilos de referencia "de siempre"; sus valores replican los que antes estaban fijos en el código (`estilos/index.js`, cabecera). Subtítulos en `theboldfont`.
- **documental:** se detalla en §4.
- **expediente:** marco de informe, fuente Special Elite, transiciones `filmSplice/filmDissolve`; prioriza citas, fechas y titulares (`expediente.json`, bloque `director.herramientas`).
- **cuaderno:** imágenes IA en estilo boceto de tinta, marco de cuaderno, fuente Patrick Hand, transiciones `whip/slice`.
- **cuentos2d:** narración en segunda persona ("una decisión, diez años"); imagen IA 2D plana con personaje consistente; sin transiciones; si no hay saldo, busca cuadros de Commons (`rellenarPlan.js:1041-1057`).
- **avatar / avatar-ia-jim / avatar-premium / hogar:** el presentador IA dice las primeras frases (o vuelve durante el video en Premium) mediante WaveSpeed, kie.ai o el avatar local; el resto son imágenes IA fotorrealistas; `avatar-ia-jim` no lleva música (`sinMusica`).
- **historia:** estructura cronológica desde la fundación; óleos sepia generados por IA, foto viva, mapas, plantilla `titulo-romano` para fechas, herramientas `gobernante`, `reino` y `fundacion`.
- **profundo / almanaque / nocturno-3d:** prefieren archivo antes que YouTube (`planDePlanos.js`, `prefiereArchivo`). Nocturno pide noticiarios en blanco y negro de la época y mezcla escenas 3D y dossier.
- **collage:** escenas de papel, golpes de papel y desgarros como transiciones.
- **noticiero:** banda de noticias (marco), presentador, cronologías y titulares.
- **tebeo:** dibujo de cómic, subtítulos `comic-golpe`, transiciones `golpePapel/panelWipe/tinta`.
- **leyenda:** narra tu voz; las palabras de la persona famosa salen **solo** en fragmentos reales de entrevista (`entrevistas.js`).
- **horizonte:** series y pirámides de población con datos reales (si no hay datos, el plano se quita); plantillas `cifra-golpe` y `frase-que-se-lee`.
- **cancha:** capa `old-movie`, entrevistas, cortes de cara del protagonista (`directorV2.js`, `cortesProtagonista`).
- **aventura:** cada capítulo `## Nivel …` es un nivel del juego; XP, misiones y logros con un HUD; escenas 3D (`partida.js:87`).
- **monigotes:** Claude (Opus) escribe una "biblia" de reparto y decorados y luego el código de cada plano; se puede regenerar un plano con un prompt (`regenerarPlano.js`). El export rápido necesita una GPU local.
- **neon:** ritmo alto (4,5 gráficos/min, separación de 3,5 s) con plantillas `neon-*`.
- **clones (3):** estilos JSON generados por el Clonador (§3, `clonador.js`).

---

## 3. Comparativa punto por punto

| Dimensión | Scaler Tool | Make a Videos | Ganador | Evidencia (MaV) |
|---|---|---|---|---|
| Guion | Claude Opus / GPT, streaming, "continuar", Prompt Maestro por canal | Claude con un playbook de estructuras por formato y porcentajes por bloque, formato de guion aprendido de videos que funcionan (sin copiar frases), contraguion, comprobación de hechos | MaV (estructura y hechos) | `PLAYBOOK.md:97-153`, `formatoGuion.js`, `comprobarHechos.js:552` |
| Voz | ai33 (Minimax, ElevenLabs, Kokoro…), Edge, audio propio | Cartesia, ElevenLabs, OpenAI, MiniMax, ai33, Fish Audio, API propia compatible con OpenAI; clones; audio propio | Empate (MaV con más proveedores directos) | `clavesProveedores.js:31-105`, `vozProveedores.js` |
| Música / SFX | No figura en el informe | Música IA (MiniMax) con biblioteca reutilizable o música libre CC BY, ánimo por estilo o por capítulo, ducking bajo la voz; efectos sintetizados atados a cada gráfico | MaV | `musicaIA.js`, `musicaLibre.js`, `sonidoMontaje.js:16`, `:138`, `efectosSonido.js` |
| Normalización de volumen | No figura | Voz a −14,5 LUFS; control posterior de LUFS y true peak | MaV | `mezclaVoz.js:27`, `revisionExport.js` (cabecera) |
| Sincronización | Whisper por palabra siempre, alineado al guion, redondeo a frames | AssemblyAI por palabra; **sin clave, estimación por caracteres** | **Scaler** | `projectService.js:478-509` |
| Escenas | 4–12 s cortadas sobre el audio | Planos anclados a palabras, por **clase**, con duración por clase (2,5–9 s), adelanto por clase y presupuesto de gráficos | MaV | `planDePlanos.js:69-76`, `:747` |
| Visuales (fuentes) | Pexels, Pixabay, Coverr, Wikimedia (solo video PD/CC0), Flow, subida manual | YouTube frase a frase, archive.org, Commons/Openverse (fotos CC), Wikidata, páginas reales, datos abiertos, Pexels, mapas | MaV en documental; **Scaler en seguridad legal** | `rellenarPlan.js` (cabecera), `youtubePlano.js`, `fotoTema.js` |
| Validación de relevancia | Keywords en cascada; revisión humana | Jueces de visión en búsqueda y QA, control de época, deduplicación perceptiva, reemplazo automático | MaV | `qaPlan.js`, `epocaPlano.js:100`, `rellenarPlan.js` (cabecera) |
| IA de imagen / video | Veo 3.1 / Seedance 2 (video), gpt-image-2, Flow | Seedream v4 o Gemini Image (imagen); Wan 2.2 (foto viva); avatar. **No hay video IA generativo de escenas** | Scaler en video IA; MaV en coherencia de estilo de dibujo | `imagenIA.js`, `fotoViva.js:21` |
| Gráficos animados | 31 componentes, texto literal del guion, anclados a palabra | ~175 plantillas; Director v2 con pesos por herramienta, presupuesto, favoritas y prohibidas por estilo | MaV en variedad; Scaler en rigor literal | `directorV2.js` (cabecera), `:866`, `player/items/motion-graphics/` |
| Subtítulos | Palabra por palabra (ASS) con color de acento | Por estilo: fuente, tamaño, sombra, contorno, posición, 6 estilos palabra a palabra; versión vertical aparte | MaV | `estilos/index.js` (lista `captions.*`), `documental.json:9-27` |
| Transiciones | Solo fade de 0,5 s | Por estilo: filmDissolve, crossBlur, whip, slice, floración, dipToBlack, golpePapel…; ritmo (destello cada N, golpe al cambiar de tema) | MaV | `documental.json:120-136`, `player/transitions/presentations/` |
| Movimiento de cámara | Ken Burns con zoompan (zoom máx. 1,08) | Ken Burns, parallax-pan/tilt, empuje a la cara; nunca repite el movimiento anterior; cortes de zoom dentro de los clips | MaV | `timelineDesdePlan.js` (cabecera), `:150`, `player/items/common/cortes-zoom.tsx` |
| Color / overlays | Paleta por nicho para gráficos | Gradación de color por estilo, viñeta, old-movie, 9 capas de ambiente, gradaciones por plantilla | MaV | `timelineService.js:5655-5690`, `player/items/common/capas-ambiente.tsx` |
| Formatos | stock, animated (incluye documental animado, solo admin) | 26 estilos JSON + Shorts derivados + Clipper | MaV | `backend/src/estilos/` |
| Relación de aspecto | Solo 16:9 | 16:9 y 9:16 en todos los estilos, con encuadre inteligente | MaV | `formatoVideo.js:18-21`, `encuadreVertical.js` |
| Resolución | 720p / 1080p, 30 fps | 1080p, 30 fps (no se vio 720p) | Empate | `formatoVideo.js:18-21`, `timelineService.js:886` |
| Render | FFmpeg por tandas; Remotion solo para overlays (ProRes con alfa) y para el formato animado | Todo con Remotion, por trozos en paralelo (resiliente); NVENC opcional; Lambda o RunPod opcionales | MaV en flexibilidad visual; Scaler en costo de CPU de render **[No verificado]** | `localRenderService.js:8-39`, `runpod-renderer/server.js:190-240` |
| QC del render | No figura | Detección de negro, imagen congelada, LUFS, formato y hoja de contactos | MaV | `revisionExport.js:309` |
| Almacenamiento | R2 / Cloudinary / Supabase; **stock y SnapGen solo por URL** | MinIO local; espejo de todo lo externo; render versionado | MaV en robustez; Scaler en distribución (CDN, sin egreso) | `backgroundMirrorService.js`, `localRenderService.js:241` |
| Cola y escalado | Cola en Postgres, `SKIP LOCKED`, heartbeat, varios workers, reintentos, reembolso | Bull/Redis en una sola máquina, concurrencia configurable, rescate de jobs huérfanos al arrancar; **sin escalado horizontal** | **Scaler** | `queue.config.js:78-92`, `queues/rescueOrphanedJobs.js:34` |
| Revisión humana | Gate obligatorio (`AWAITING_STOCK_REVIEW`), reemplazo por escena | Página de revisión con el QA de cada plano + editor completo de timeline; regenerar plano con un prompt; export manual por defecto | MaV (más potente); Scaler (gate más formal) | `planRevision.js`, `regenerarPlano.js`, `montaje.js` |
| Multiusuario / créditos | Workspaces, roles, invitaciones, créditos atómicos, reembolsos | Instalación local de un solo dueño; medición de uso de APIs, sin cobro | **Scaler** | `migrations/043_api_usage_events.sql:1-10`, `licencia/` |
| Atribución de licencias | No figura | Tabla `creditos` y endpoint de créditos para la descripción de YouTube | MaV | `migrations/058_creditos.sql`, `routes/projectRoutes.js:32-36` |
| Costos | Por proveedor, dentro de la plataforma | Coste por minuto declarado en cada estilo (~0,10–0,45 $/min); jueces con Gemini gratis; caché de 14 días | MaV en costo por video | `estilos/*.json` (`coste`), `juez.js` (cabecera), `rellenarPlan.js` (CACHE_TTL) |
| Exportación | MP4 | MP4 + créditos + Shorts derivados + proyecto editable en el editor. **SRT descargable: [No verificado]** | Empate | `routes/projectRoutes.js` |

---

## 4. Formato documental a fondo

### 4.1 Cómo lo hace Make a Videos

| Capa | Técnica | Evidencia |
|---|---|---|
| Guion | Esqueleto documental: cold open 3–5 %, setup 8–12 %, build-up 20–25 %, el evento en secuencia 30–35 %, consecuencias 10–15 %, resolución 5–8 %, outro 2–3 %; cada sección termina con un enganche a la siguiente | `PLAYBOOK.md:102-110` |
| Capítulos | Líneas `## Título \| ánimo` en el guion; tarjeta `chapter-minimal`; el ánimo de la música puede cambiar por capítulo | `directorV2.js:1346` (`capitulosDelGuion`), `:1443` (`ponerCapitulos`), `documental.json:48-50`, `musicaIA.js` (cabecera) |
| Hechos | Comprobación previa a la voz (Wikipedia, Wikidata, Banco Mundial) | `comprobarHechos.js:552` |
| Plan por frase | Clases `metraje`, `persona`, `cosa`, `lugar`, `ambiente`, `mapa`, `pagina` y gráficas; adelanto por clase (mapa 1,6 s, persona 0,9 s); nunca dos gráficos seguidos; lo que no cabe pasa a rótulo | `planDePlanos.js:40-80`, `:747` |
| Presupuesto gráfico | 3/min, 6/min en el gancho, ≤30 % del video, separación ≥4,5 s; *callouts* ≤2 por video, separados 14 s | `documental.json:28-31`, `:147-153` |
| Material de archivo | YouTube frase a frase con juez de visión (16 fotogramas, segundo juez para sujeto, cabeza parlante, texto quemado y marcas de agua; los logos pequeños se recortan), archive.org, Commons/Openverse con licencia, foto de la persona por Wikidata, captura de la página real resaltada, datos reales | `youtubePlano.js` (cabecera), `fotoTema.js` (cabecera), `personaPorNombre.js`, `paginasReales.js`, `datosAbiertos.js` |
| Época | Calcula el año de cada frase; los jueces descartan lo moderno en planos históricos | `epocaPlano.js:100` |
| QA | Juez por lotes de unos 6 planos; códigos `generico`, `equivocado`, `persona`, `epoca`, `texto`, `oscuro`…; hasta 2 reemplazos; si no se arregla, un plano seguro (nunca deja una imagen equivocada) | `qaPlan.js` (cabecera), `:402`, `:571` |
| Movimiento | Fotos: ken-burns, parallax-pan/tilt, empuje a la cara; nunca quietas ni con el mismo movimiento dos veces; segundo encuadre un 10 % más cerca. Clips: cortes de zoom cada 4 s (abierto 1,03–1,09 y cerrado 1,18–1,28) | `timelineDesdePlan.js` (cabecera), `:150`, `documental.json:109-118` |
| Mapas | `mapa-ruta`, `mapa-region`, `mapa-zona`, `mapa-foco`, `map-journey` con el atlas de `timelineService` | `documental.json:51-56`, `rellenarPlan.js` (cabecera) |
| Gráficos | Plantillas favoritas: `newspaper-swap-elegant`, `person-card`, `document-highlight`, `timeline-strip`, `date-corner`, `highlight-quote`, `stat-pill-underline`, `line-chart-noir`, `typewriter-elegant`, `paragraph-reveal`…; 33 prohibidas (glitch, VHS, zoom-punch, bubble…) | `documental.json:51-108` |
| Rótulos / lower thirds | `date-corner`, `number-badge`, nombre sobre la foto de esa persona; duran ≥2,2 s y salen 300 ms después de su frase; solo sobre imagen | `planDePlanos.js` (cabecera), `timelineDesdePlan.js` (cabecera) |
| Adornos | Bandera del país en la esquina (una vez por país, cada 18 s); iconos que saltan con una palabra | `adornosPlan.js` (cabecera) |
| Tipografía y color | Gráficos en EB Garamond crema `#F3EEE4`, acento dorado `#E3B25B`; gradación contraste 104 / saturación 94 / brillo 99; viñeta | `documental.json:32-47` |
| Subtítulos | Roboto Condensed 54 px, blancos, sin caja, sombra y contorno, 7 palabras; se ocultan bajo plantillas que ya escriben la frase | `documental.json:9-27`, `timelineDesdePlan.js` (cabecera) |
| Transiciones | Por secciones `filmDissolve`/`crossBlur` de 700 ms; destello cálido "floración" cada 9 planos a fuerza 0,6; golpe al cambiar de tema; el resto, corte seco | `documental.json:120-136`, `player/transitions/presentations/floracion.tsx` |
| Sonido | Música "documental" al 20 %, que baja al 35 % bajo la voz; efectos con carácter "cine" al 38 % (whoosh en capítulos, golpe en cifras, papel en titulares) | `documental.json:138-146`, `sonidoMontaje.js:138-160` |
| Créditos | Cada foto o clip de terceros queda acreditado para la descripción | `migrations/058_creditos.sql`, `routes/projectRoutes.js:32-36` |
| Entrevistas | `[[clip: Persona: "cita"]]` → trozo real con su audio, recortado palabra a palabra con Whisper | `entrevistas.js` (cabecera) |

### 4.2 Cómo lo hace Scaler Tool (según el informe)

- **Formato `stock` usado para documental:** escenas de 4 a 12 s, contexto visual global, 4 queries por escena y clips de stock genéricos (Pexels, Pixabay, Coverr, Wikimedia en video), Ken Burns con zoompan sobre imagen, fade opcional, overlays de 31 componentes con texto literal y una paleta por nicho.
- **Formato `animated` en modo documental:** todo dibujado con Remotion por agentes Claude (director, dibujantes, verificador en código y revisor visual sobre capturas). Solo para admins. No usa material real.

### 4.3 Diferencias concretas

| Aspecto | Scaler | MaV | Diferencia práctica |
|---|---|---|---|
| Unidad de montaje | Escena (4–12 s) | Plano por frase, con clase | MaV cambia de imagen cuando cambia lo que se dice |
| Qué se ve | Stock genérico | El sujeto concreto: la persona, el lugar, el documento | Credibilidad documental |
| Validación | Humana | Automática (visión) + humana | Menos tiempo de revisión por video |
| Fotos de personas | No hay fuente específica | Wikidata/Commons con recorte de cara | Lower thirds con foto y *person cards* |
| Documentos y prensa | No | Captura real con la frase resaltada | El recurso "prueba en pantalla" |
| Datos | Componentes con números del guion | Series reales (Banco Mundial/ONU) | Gráficos verificables |
| Look | Paleta de gráficos | Gradación, viñeta, transiciones de cine, tipografía serif, prohibición de recursos "TikTok" | Coherencia de marca por estilo |
| Audio | Voz | Voz normalizada, música con ducking por capítulo, efectos | Acabado de producción |

### 4.4 Qué copiar o adaptar (ordenado por retorno)

1. **Clases de plano + plan anclado a palabras** sobre las palabras de Whisper que Scaler ya tiene.
2. **Cadena de fuentes por clase con respaldo** (persona → Wikidata/Commons; cosa/lugar → Commons → stock; documento → captura; dato → serie).
3. **Juez de visión barato por lotes** (Gemini Flash), con códigos de rechazo y control de época, antes del gate humano.
4. **Movimiento variado sin repetir** + **cortes de zoom** en clips largos (con ffmpeg `zoompan`/`crop` en Scaler).
5. **Look documental:** gradación (`eq`), viñeta (`vignette`), transiciones `xfade` variadas (`dissolve`, `fadeblack`, `hblur`…), tarjetas de capítulo, rótulos de fecha y nombre.
6. **Música con ducking + efectos sintetizados + loudnorm.**
7. **Créditos automáticos** para la descripción de YouTube.
8. **No copiar sin evaluar el riesgo legal:** metraje de YouTube y entrevistas (ver §8).

---

## 5. Brechas de Scaler Tool

### GAP-01 — Plan de planos por frase con clases
- Categoría: Documental
- Qué tiene Make a Videos: un LLM propone planos anclados a palabras con clase (metraje, persona, cosa, lugar, mapa, página, gráficos); el código valida cobertura, duración por clase, adelanto, presupuesto de gráficos y que no haya dos gráficos seguidos.
- Qué tiene hoy Scaler Tool: `build_scenes` corta escenas de 4–12 s y `generate_stock_keywords` hace 4 queries por escena.
- Por qué importa: es la base de todo lo demás; el visual cambia cuando cambia el sujeto narrado, que es lo que define un documental creíble.
- Evidencia: `backend/src/services/planDePlanos.js:40-80`, `:747`, `:1079`
- Impacto: Alto · Esfuerzo estimado: M · Confianza: Alta
- Idea de implementación en Scaler Tool: nueva tool `plan_shots` (Claude Sonnet o Gemini) que recibe las `words` de `timelines.content` y devuelve `shots[]` con `class`, `subject`, `epoch` y `word_range`; un validador en código (TypeScript) aplica las reglas. Guardarlo en `scenes.content.shots` o en una columna `video_projects.shot_plan`. `build_timeline` usa los shots como sub-segmentos de la escena.

### GAP-02 — Fuentes de archivo documental con licencia (personas, cosas, lugares)
- Categoría: Documental
- Qué tiene Make a Videos: fotos de Commons/Openverse filtradas por licencia (PD, CC0, CC BY, CC BY-SA), ≥900 px, sin panorámicas, con preferencia por fotos de época; personas por Wikidata P18 con recorte de cara; archive.org para noticiarios.
- Qué tiene hoy Scaler Tool: Wikimedia solo en video PD/CC0; el resto es stock genérico.
- Por qué importa: los documentales hablan de personas y hechos concretos; el stock no tiene "a Einstein" ni "el canal de Panamá en 1904".
- Evidencia: `backend/src/services/fotoTema.js:412`, `backend/src/services/personaPorNombre.js:553`, `backend/src/services/rellenarPlan.js:1036-1075`
- Impacto: Alto · Esfuerzo estimado: M · Confianza: Alta
- Idea de implementación en Scaler Tool: un `PROVIDER_CLIENTS` de tipo `stock_image` (Commons fotos, Openverse) y `person_image` (Wikidata), con filas en `providers`; la tool `search_archive` por shot. Las imágenes se renderizan con Ken Burns en `renderVideo.tool.ts`. Atribución en una tabla nueva (ver GAP-14).

### GAP-03 — Validación visual automática por plano (juez + época)
- Categoría: Documental
- Qué tiene Make a Videos: juez de visión por lotes (Gemini gratis, Claude de reserva) en búsqueda y en el QA; códigos de rechazo; control de época; hasta 2 reemplazos y, si no, un respaldo seguro.
- Qué tiene hoy Scaler Tool: solo la revisión humana en `AWAITING_STOCK_REVIEW`.
- Por qué importa: reduce el tiempo de revisión humana y evita imágenes equivocadas o anacrónicas, que son el error más visible de un documental.
- Evidencia: `backend/src/services/qaPlan.js:402`, `:571`; `backend/src/services/epocaPlano.js:100`; `backend/shared/utils/juez.js`
- Impacto: Alto · Esfuerzo estimado: M · Confianza: Alta
- Idea de implementación en Scaler Tool: tool `judge_visual` (modelo de visión barato) que recibe miniaturas o fotogramas de cada asset y la frase, y escribe `assets.metadata.qa = {code, reason}`; el orquestador reintenta con la siguiente query en cascada antes del gate. El front muestra el código QA en la revisión.

### GAP-04 — Movimiento de cámara variado y cortes de zoom
- Categoría: Visual
- Qué tiene Make a Videos: ken-burns, parallax-pan/tilt y empuje a la cara, sin repetir el movimiento anterior; segundo encuadre un 10 % más cerca; cortes de zoom dentro de los clips cada 4 s.
- Qué tiene hoy Scaler Tool: zoompan con zoom máximo de 1,08 sobre imágenes.
- Por qué importa: la monotonía del Ken Burns único se nota en videos de 20 a 60 minutos; los cortes de zoom simulan "dos cámaras" sin material nuevo.
- Evidencia: `backend/src/services/timelineDesdePlan.js` (cabecera), `:150`; `backend/src/estilos/documental.json:109-118`
- Impacto: Medio · Esfuerzo estimado: S · Confianza: Alta
- Idea de implementación en Scaler Tool: en `renderVideo.tool.ts`, un selector de movimiento (zoom-in, zoom-out, pan izquierda/derecha, deriva) que no repita el anterior, y en clips de más de 6 s un `crop` escalonado (zoom 1,03 a 1,25) por tramos.

### GAP-05 — Look por estilo: gradación de color, viñeta y transiciones variadas
- Categoría: Visual
- Qué tiene Make a Videos: gradación por estilo, viñeta y capas de ambiente; transiciones por secciones (filmDissolve, crossBlur, floración) con un ritmo definido; listas de plantillas favoritas y prohibidas.
- Qué tiene hoy Scaler Tool: fade de 0,5 s opcional; paleta solo en los gráficos.
- Por qué importa: el material de distintas fuentes queda unificado, y el documental se ve "de plataforma".
- Evidencia: `backend/src/estilos/documental.json:42-50`, `:120-136`; `backend/src/services/timelineService.js:5655-5690`; `frontend/src/pages/editor/player/items/common/capas-ambiente.tsx`
- Impacto: Alto · Esfuerzo estimado: S · Confianza: Alta
- Idea de implementación en Scaler Tool: un preset `look` por nicho (en `niches.json` o en la tabla de estilos) con parámetros de `eq` (contraste, saturación, brillo), `vignette` y la lista de `xfade` permitidos con su cadencia; aplicarlo en la pasada final de `renderVideo.tool.ts`.

### GAP-06 — Música de fondo con ducking y efectos de sonido
- Categoría: Audio
- Qué tiene Make a Videos: música por ánimo (IA o libre, con biblioteca reutilizable), un ánimo por capítulo, ducking en los tramos con voz; efectos sintetizados atados al tipo de gráfico, con separación mínima.
- Qué tiene hoy Scaler Tool: no figura música ni SFX en el informe (ver §8).
- Por qué importa: un documental sin música ni efectos se percibe como amateur; el ducking es imprescindible para que se entienda la voz.
- Evidencia: `backend/shared/services/musicaIA.js` (cabecera), `backend/shared/services/musicaLibre.js` (cabecera), `backend/src/services/sonidoMontaje.js:16`, `:138`, `backend/shared/services/efectosSonido.js:1-20`
- Impacto: Alto · Esfuerzo estimado: M · Confianza: Media (por la incertidumbre sobre Scaler)
- Idea de implementación en Scaler Tool: tool `pick_music` (biblioteca en R2 + tabla `music_library` por mood); en `renderVideo.tool.ts`, `sidechaincompress` o `volume` por tramos usando los `segments` de Whisper; SFX en la entrada de cada overlay (los tiempos ya están anclados a palabra).

### GAP-07 — Normalización de loudness y QC automático del MP4
- Categoría: Render
- Qué tiene Make a Videos: la voz se lleva a −14,5 LUFS; después del export, ffmpeg detecta negro, imagen congelada, LUFS y true peak, verifica formato y genera una hoja de contactos de 48 fotogramas.
- Qué tiene hoy Scaler Tool: no figura.
- Por qué importa: YouTube normaliza a −14 LUFS; los fotogramas negros o congelados de clips cortos son defectos frecuentes que hoy solo encuentra el usuario.
- Evidencia: `backend/src/services/mezclaVoz.js:27`, `:64`; `backend/src/services/revisionExport.js:309-338`
- Impacto: Medio · Esfuerzo estimado: S · Confianza: Alta
- Idea de implementación en Scaler Tool: `loudnorm` de dos pasadas en `generate_voice` o en la mezcla final; tras `render_video`, un paso `qc_render` (`blackdetect`, `freezedetect`, `ebur128`) que guarda el informe en `assets.metadata.qc` y lo muestra en el front.

### GAP-08 — Formato vertical 9:16 y Shorts derivados
- Categoría: Formato
- Qué tiene Make a Videos: cualquier estilo en 1080×1920 con su versión vertical (subtítulos, ritmo de 1,5–3,2 s, encuadre recorte/banda según el sujeto); "Cortar en Shorts" reusa el material del largo; el Clipper sirve para videos externos.
- Qué tiene hoy Scaler Tool: solo 16:9.
- Por qué importa: los Shorts son el principal canal de descubrimiento; reusar el material del largo da contenido extra sin costo de búsqueda.
- Evidencia: `backend/src/services/formatoVideo.js:18-63`, `backend/src/estilos/index.js:450-499`, `backend/src/services/encuadreVertical.js`, `backend/src/services/cortarShorts.js`
- Impacto: Alto · Esfuerzo estimado: M · Confianza: Alta
- Idea de implementación en Scaler Tool: `video_projects.aspect` (`16:9` o `9:16`); en `renderVideo.tool.ts`, `scale/crop` a 1080×1920 o banda con fondo difuminado (`boxblur` + `overlay`); subtítulos ASS con otro estilo. Tool `cut_shorts` que elige 2–3 tramos de 30–60 s por frases (LLM) y crea proyectos hijos reusando `assets`.

### GAP-09 — Estilos como datos (JSON) y clonador de estilos
- Categoría: Formato
- Qué tiene Make a Videos: 26 estilos JSON con captions, pacing, colores, look, transiciones, sonido y director; el Clonador mide un video de referencia (cortes por minuto, color) y genera un estilo nuevo.
- Qué tiene hoy Scaler Tool: 21 nichos con paletas; el formato es `stock` o `animated`.
- Por qué importa: permite ofrecer muchos "formatos" sin código nuevo y adaptarse a la referencia de cada cliente.
- Evidencia: `backend/src/estilos/index.js` (cabecera), `backend/src/services/clonador.js` (cabecera), `:434`
- Impacto: Medio · Esfuerzo estimado: M · Confianza: Alta
- Idea de implementación en Scaler Tool: tabla `video_styles` (JSON validado con Zod) por workspace, consumida por `plan_overlays`, `build_scenes` y `renderVideo.tool.ts`; más adelante, una tool `clone_style` con ffmpeg `scdet` + `signalstats` y un modelo de visión.

### GAP-10 — Capítulos con tarjeta y estructura documental en el guion
- Categoría: Documental
- Qué tiene Make a Videos: un playbook con porcentajes por bloque para documental, explicativo, top, historia y noticias; capítulos `## Título | ánimo` que generan una tarjeta `chapter-minimal`, un whoosh y un cambio de música.
- Qué tiene hoy Scaler Tool: Prompt Maestro por canal; `chapter_index` y `nav_header` en el catálogo de componentes.
- Por qué importa: los capítulos mejoran la retención y los marcadores de YouTube; la estructura con porcentajes evita guiones planos.
- Evidencia: `backend/src/prompts/guiones/PLAYBOOK.md:97-153`, `backend/src/services/directorV2.js:1346`, `:1443`
- Impacto: Medio · Esfuerzo estimado: S · Confianza: Media
- Idea de implementación en Scaler Tool: incluir los *beat sheets* en `generate_script` (system prompt) con marcas de capítulo; `build_scenes` detecta las marcas y `plan_overlays` coloca `chapter_index` en cada una; exportar los capítulos como timestamps para la descripción.

### GAP-11 — Rótulos anclados al plano (fecha, nombre, lugar) y adornos
- Categoría: Documental
- Qué tiene Make a Videos: rótulos que solo van sobre imagen, el nombre solo sobre la foto de esa persona, una duración mínima de 2,2 s y salida 300 ms después de la frase; bandera en la esquina e iconos que saltan con una palabra.
- Qué tiene hoy Scaler Tool: `lower_third`, `person_card` y `location` existen, colocados por `plan_overlays`.
- Por qué importa: la coherencia rótulo-imagen (el nombre sobre su cara) es una marca de calidad documental.
- Evidencia: `backend/src/services/planDePlanos.js` (cabecera, reglas de rótulos), `backend/src/services/adornosPlan.js` (cabecera)
- Impacto: Medio · Esfuerzo estimado: S · Confianza: Media
- Idea de implementación en Scaler Tool: en `plan_overlays`, una regla que solo coloque `lower_third` o `person_card` si el shot es de clase `persona` con el mismo sujeto (requiere GAP-01); `date-corner` en la primera mención de un año.

### GAP-12 — Copia de clips externos a storage propio
- Categoría: Infra
- Qué tiene Make a Videos: espejo en segundo plano y antes del export de todo medio externo; el clip de YouTube se recodifica y se guarda; el render final se versiona por timestamp.
- Qué tiene hoy Scaler Tool: stock y SnapGen solo por URL (SnapGen vence a los ~14 días); el render se sobrescribe.
- Por qué importa: los re-renders fallan cuando la URL desaparece; sin versiones no se puede volver a un render anterior.
- Evidencia: `backend/src/services/backgroundMirrorService.js` (cabecera), `backend/src/services/projectService.js:5337-5381`, `backend/src/services/localRenderService.js:241`
- Impacto: Alto · Esfuerzo estimado: S · Confianza: Alta
- Idea de implementación en Scaler Tool: cuando un clip queda aprobado en el gate (o al asignar SnapGen), copiarlo a R2 `skaler-media/<project_id>/<asset_id>.mp4` con `uploadPublicFile` y guardar la URL original en `metadata.source_url`; render a `skaler-renders/<project_id>/<timestamp>.mp4`.

### GAP-13 — Comprobación de hechos antes de la voz
- Categoría: Documental
- Qué tiene Make a Videos: extrae afirmaciones, las contrasta con Wikipedia, Wikidata y el Banco Mundial, reescribe lo incorrecto y suaviza lo dudoso, sin tocar las marcas del guion.
- Qué tiene hoy Scaler Tool: no figura.
- Por qué importa: los errores factuales en un documental generan comentarios negativos y pérdida de confianza; TTS y render cuestan dinero si hay que rehacerlos.
- Evidencia: `backend/src/services/comprobarHechos.js:552`, `backend/src/queues/processors/produccionProcessor.js:137-151`
- Impacto: Medio · Esfuerzo estimado: M · Confianza: Alta
- Idea de implementación en Scaler Tool: tool `fact_check_script` entre `SCRIPT_DONE` y `generate_voice`; guarda los cambios en `scripts.content.fact_changes` para que el usuario los vea y acepte.

### GAP-14 — Atribución automática de licencias
- Categoría: UX
- Qué tiene Make a Videos: tabla `creditos` (origen, autor, licencia, URL) y un endpoint que arma el texto de créditos para la descripción.
- Qué tiene hoy Scaler Tool: Wikimedia limitado a PD/CC0 justamente para evitar la atribución.
- Por qué importa: habilita CC BY y CC BY-SA, que multiplican el material documental disponible.
- Evidencia: `backend/database/migrations/058_creditos.sql`, `backend/src/routes/projectRoutes.js:32-36`
- Impacto: Medio · Esfuerzo estimado: S · Confianza: Alta
- Idea de implementación en Scaler Tool: columnas `license`, `author` y `source_page` en `assets.metadata`; `GET /projects/:id/credits` que agrega los créditos del timeline; botón "copiar créditos" en Preview.

### GAP-15 — Capturas de páginas reales y gráficos con datos abiertos
- Categoría: Documental
- Qué tiene Make a Videos: abre Wikipedia o prensa (GDELT) en Chrome headless, rechaza cookies, resalta la frase y hace la captura; series y pirámides con datos reales del Banco Mundial y la ONU.
- Qué tiene hoy Scaler Tool: `line_chart` y `data_viz_single` con números del guion.
- Por qué importa: "la prueba en pantalla" es un recurso característico de los documentales de YouTube.
- Evidencia: `backend/src/services/paginasReales.js:653`, `backend/src/services/datosAbiertos.js`
- Impacto: Medio · Esfuerzo estimado: M · Confianza: Alta
- Idea de implementación en Scaler Tool: tool `capture_page` usando el Chrome Headless Shell que ya trae la imagen del worker para Remotion; componente nuevo `document_highlight` en `backend/motion/`; tool `fetch_open_data` para `line_chart`.

### GAP-16 — Render por trozos resiliente y en paralelo
- Categoría: Render
- Qué tiene Make a Videos: Remotion por rangos de frames, trozos guardados en MinIO, concatenación sin artefactos, progreso por trozo; opcionalmente Lambda o RunPod.
- Qué tiene hoy Scaler Tool: tandas FFmpeg de 4 segmentos y reintento del render completo (hasta 3).
- Por qué importa: en videos de 60 a 90 minutos, un fallo cerca del final hoy obliga a repetirlo todo.
- Evidencia: `backend/src/services/localRenderService.js:8-39`, `:158-182`
- Impacto: Bajo · Esfuerzo estimado: M · Confianza: Media
- Idea de implementación en Scaler Tool: guardar las tandas intermedias en `WORK_DIR` persistente o en R2 con una clave por hash de tanda, y reanudar desde la última completada al reintentar en `worker.ts`.

### GAP-17 — Editor de timeline y regeneración de un plano con prompt
- Categoría: UX
- Qué tiene Make a Videos: editor completo (DesignCombo) con los mismos componentes que el render; página de revisión con el QA de cada plano; "Regenerar con IA" de un corte concreto.
- Qué tiene hoy Scaler Tool: revisión y reemplazo por escena; vista previa con Remotion Player.
- Por qué importa: los ajustes finos (mover un corte, cambiar un rótulo) hoy obligan a regenerar o no se pueden hacer.
- Evidencia: `frontend/src/pages/editor/`, `frontend/src/pages/Studio/plan/planRevision.js`, `backend/src/services/regenerarPlano.js`
- Impacto: Medio · Esfuerzo estimado: L · Confianza: Alta
- Idea de implementación en Scaler Tool: un paso intermedio sin editor completo, con edición de overlays (texto y tiempo) y de los bordes de shot en la pestaña Preview sobre `timelines.content`; regenerar un shot con prompt vía `regenerate-visual`.

### GAP-18 — Imagen IA con estilo de dibujo coherente por formato
- Categoría: Visual
- Qué tiene Make a Videos: `estiloDibujo` por estilo (óleo sepia, cómic, boceto, 2D plano), personaje consistente con imagen de referencia, cadencia por estilo y foto viva (Wan 2.2) opcional.
- Qué tiene hoy Scaler Tool: gpt-image-2 con Ken Burns y Google Flow; biblia visual por workspace.
- Por qué importa: los formatos "historia ilustrada" necesitan coherencia de estilo para lo que no tiene foto.
- Evidencia: `backend/src/estilos/historia.json`, `tebeo.json`, `cuentos2d.json` (`look.imagenes`), `backend/shared/services/imagenIA.js`, `backend/src/services/fotoViva.js:21`
- Impacto: Bajo · Esfuerzo estimado: S · Confianza: Media
- Idea de implementación en Scaler Tool: un `style_prompt` fijo por estilo concatenado en `generate_image_prompt_sequence`; usar la imagen IA como respaldo de la clase `dibujo` en GAP-01.

### GAP-19 — Metraje real de YouTube y fragmentos de entrevista
- Categoría: Documental
- Qué tiene Make a Videos: un clip de YouTube por frase, elegido con visión (sin cabezas parlantes ni texto quemado; logos recortados); entrevistas reales con su audio, recortadas palabra a palabra.
- Qué tiene hoy Scaler Tool: no lo tiene, y es la opción más segura legalmente.
- Por qué importa: es la columna vertebral visual del documental de MaV, pero tiene **riesgo de copyright y de términos de servicio** (ver §8).
- Evidencia: `backend/src/services/youtubePlano.js` (cabecera), `:970`; `backend/src/services/entrevistas.js` (cabecera)
- Impacto: Alto (calidad) · Esfuerzo estimado: L · Confianza: Media
- Idea de implementación en Scaler Tool: **no implementar sin una revisión legal.** Como alternativa, priorizar archive.org (dominio público), fuentes oficiales con licencia (NASA, gobiernos) y video IA de SnapGen para lo que no tenga archivo; si se hace, que sea opt-in del usuario, con fragmentos cortos y crédito.

### GAP-20 — Avatar o presentador IA
- Categoría: Formato
- Qué tiene Make a Videos: presentador IA (WaveSpeed InfiniteTalk, Kling Avatar o SoulX local) en la apertura o durante todo el video.
- Qué tiene hoy Scaler Tool: no lo tiene.
- Por qué importa: abre los nichos de finanzas y consejos con cara, pero no forma parte del núcleo documental.
- Evidencia: `backend/src/services/projectService.js:3120`, `backend/shared/services/avatarIA.js`
- Impacto: Bajo · Esfuerzo estimado: M · Confianza: Alta
- Idea de implementación en Scaler Tool: un proveedor nuevo `avatar` en `providers` (por ejemplo WaveSpeed) y una tool `generate_avatar_clip` para la primera escena.

### GAP-21 — Cortes al golpe de la música
- Categoría: Audio
- Qué tiene Make a Videos: detecta los golpes de la pista y mueve las fronteras de plano a menos de 300 ms del golpe.
- Qué tiene hoy Scaler Tool: no lo tiene.
- Por qué importa: es un detalle de pulido.
- Evidencia: `backend/src/services/cortesAlGolpe.js:23`, `:66`
- Impacto: Bajo · Esfuerzo estimado: S · Confianza: Alta
- Idea de implementación en Scaler Tool: después de GAP-06, un análisis de onsets con ffmpeg y un ajuste de `start_seconds` de los sub-segmentos en `build_timeline`.

---

## 6. Priorización

### Ahora (impacto alto, esfuerzo S/M, documental primero)

| Prioridad | GAP | Impacto | Esfuerzo | Motivo |
|---|---|---|---|---|
| 1 | GAP-05 Look documental (gradación, viñeta, transiciones) | Alto | S | Mejora visible inmediata solo con filtros ffmpeg en `renderVideo.tool.ts` |
| 2 | GAP-12 Copia de clips a storage propio | Alto | S | Elimina re-renders rotos (SnapGen vence a los ~14 días); prerrequisito de todo lo demás |
| 3 | GAP-01 Plan de planos por frase | Alto | M | Base del documental; desbloquea GAP-02, 03, 11 y 15 |
| 4 | GAP-02 Fuentes de archivo con licencia | Alto | M | Material específico (personas, lugares, época) |
| 5 | GAP-03 Juez visual + época | Alto | M | Calidad documental sin depender solo de la revisión humana |
| 6 | GAP-06 Música con ducking + SFX | Alto | M | Acabado de producción |
| 7 | GAP-08 Vertical 9:16 + Shorts derivados | Alto | M | Nuevo canal de negocio; reusa el material |

### Siguiente

| Prioridad | GAP | Impacto | Esfuerzo | Motivo |
|---|---|---|---|---|
| 8 | GAP-04 Movimiento variado + cortes de zoom | Medio | S | Barato; reduce la monotonía en videos largos |
| 9 | GAP-10 Capítulos + estructura de guion | Medio | S | Retención y marcadores de YouTube |
| 10 | GAP-11 Rótulos anclados al plano | Medio | S | Depende de GAP-01; calidad documental |
| 11 | GAP-14 Atribución de licencias | Medio | S | Habilita CC BY/BY-SA para GAP-02 |
| 12 | GAP-07 Loudnorm + QC del MP4 | Medio | S | Evita defectos y reclamos |
| 13 | GAP-13 Comprobación de hechos | Medio | M | Confianza en el contenido documental |
| 14 | GAP-15 Capturas de páginas + datos abiertos | Medio | M | Recurso de "prueba en pantalla" |
| 15 | GAP-09 Estilos JSON + clonador | Medio | M | Escala de formatos sin código |

### Después

| Prioridad | GAP | Impacto | Esfuerzo | Motivo |
|---|---|---|---|---|
| 16 | GAP-17 Editor de timeline | Medio | L | Valioso pero caro; empezar con edición parcial |
| 17 | GAP-19 Metraje de YouTube / entrevistas | Alto (calidad) | L | Bloqueado por la revisión legal |
| 18 | GAP-16 Render por trozos resiliente | Bajo | M | Solo duele en videos muy largos |
| 19 | GAP-18 Estilo de dibujo IA coherente | Bajo | S | Útil para estilos ilustrados |
| 20 | GAP-20 Avatar IA | Bajo | M | Fuera del núcleo documental |
| 21 | GAP-21 Cortes al golpe | Bajo | S | Pulido, depende de GAP-06 |

> Nota de coherencia: GAP-12 sube por encima de GAP-01 aunque no es documental porque es S, de impacto alto y prerrequisito técnico (sin copia propia, las fuentes nuevas también se romperían). GAP-19 queda en "Después" pese a su impacto alto por el riesgo legal, no por el esfuerzo.

---

## 7. Lo que Scaler Tool hace mejor (no perderlo al copiar)

| Fortaleza de Scaler | Contraste con MaV | No perder al copiar |
|---|---|---|
| SaaS multiusuario: workspaces, roles, invitaciones, créditos atómicos, reembolsos | MaV es local, de un solo dueño, con licencia por equipo (`migrations/043_api_usage_events.sql:1-10`) | Cada tool nueva debe respetar `workspace_id` y el cobro y reembolso de créditos |
| Cola en Postgres con `SKIP LOCKED`, heartbeat, `requeue_stale_jobs` y varios VPS | Bull en una sola máquina; rescate de huérfanos solo al arrancar (`rescueOrphanedJobs.js:34`) | Las tools de búsqueda y QA deben ser idempotentes y cacheables (el pre-render tiene 1 reintento porque cobra) |
| Trazabilidad por tool (`tool_executions`) | Logs de consola | Registrar el plan, los jueces y los reemplazos en `tool_executions` |
| Sincronía siempre con Whisper por palabra, alineada al guion | Sin AssemblyAI, MaV estima por caracteres (`projectService.js:509`) | Anclar los shots a las `words` de Whisper |
| Gate humano obligatorio antes de cobrar el render | MaV permite exportar sin revisión (`exportar_al_terminar`) | El QA automático debe alimentar el gate, no reemplazarlo |
| Texto literal del guion en los gráficos (validación estricta) | En el Director v2 de MaV el LLM redacta el texto del gráfico (por ejemplo «+38 %\nsube el alquiler», `directorV2.js` cabecera); solo las citas se piden literales (`directorV2.js:145`), y no se encontró una validación en código como la de Scaler **[Parcialmente verificado]** | Mantener la regla literal en `generate_overlay` |
| Video IA generativo (Veo 3.1 / Seedance 2) y Google Flow | MaV no genera escenas de video con IA | Usar video IA como respaldo para lo que no tenga archivo |
| Documental animado agéntico (director, dibujantes, verificador y revisor visual) | MaV tiene motor 2D, 3D y mapas, pero sin revisor visual sobre capturas en el documental real **[No verificado del todo]** | Puede convivir como sub-estilo "ilustrado" |
| Riesgo legal bajo (stock con licencia, Wikimedia PD/CC0) | MaV usa metraje y entrevistas de YouTube | Toda fuente nueva con licencia explícita y atribución |
| Distribución en CDN (R2 sin egreso, Cloudinary) | MinIO local | Guardar las copias en R2 |
| Rotación de varias cuentas de ai33 por saldo | Una clave por proveedor | — |
| Lista de bloqueados y preferidos por usuario + política de contenido | Deduplicación por video, sin preferencias persistentes **[No verificado]** | Aplicar `content_policy` también a las fuentes de archivo |

---

## 8. Preguntas abiertas y supuestos

**Sobre Scaler Tool (el informe no lo aclara):**
1. ¿Hay música de fondo o efectos de sonido? El informe no los menciona; GAP-06 y GAP-07 suponen que no.
2. ¿Hay normalización de loudness en el mix final? Se supone que no.
3. ¿El modo animado o documental tiene capítulos, rótulos o mapas como los de MaV? Existen `map_globe`, `map_marker` y `chapter_index`, pero no se sabe cómo se colocan.
4. ¿El Prompt Maestro incluye estructura por bloques (beat sheet) para el documental?
5. ¿Se exporta SRT o capítulos para YouTube?
6. Volumen esperado de videos por día: cambia la prioridad de los jueces de visión (costo) y del render por trozos.

**Sobre Make a Videos (no confirmado en el código):**
1. **Riesgo legal:** MaV descarga y reutiliza metraje de YouTube (`youtubePlano.js`) y entrevistas (`entrevistas.js`). En el código no hay ninguna verificación de licencia para ese metraje; sí para Commons, Openverse y la música. Para un SaaS como Scaler, ese riesgo es mayor que en una herramienta local.
2. Códec de audio, bitrate y CRF del render final: **[No verificado]**. El render pasa por Remotion `codec: "h264"`; el preset de x264 se ajusta en `runpod-renderer/server.js:258-340`.
3. Si hay opción de 720p o 4K: no se encontró; **[No verificado]**.
4. Exportación de SRT descargable para el usuario: hay generación de `.srt` en `videoProcessor.js:298-342` (camino de procesado antiguo), pero no se encontró un botón de descarga en el frontend. **[No verificado]**.
5. Clave de almacenamiento de las fotos espejadas y de las imágenes IA: **[No verificado]**.
6. Duraciones de plano de Monigotes 2D y Aventura: los marcan sus directores y no se leyeron en detalle.
7. Ruta exacta del cliente de archive.org (`utils/clipArchivo`): se cita en `rellenarPlan.js`, pero no se abrió el archivo.
8. Se analizó solo el modo de montaje "plan", el de por defecto (`montaje.js`, cabecera); el modo "clásico" (Scrapingdog/Pexels por sección) se mencionó, pero no se analizó.
9. Remotion necesita licencia comercial a partir de cierto tamaño de empresa; aplica a los dos productos.

---

Archivos revisados: `docker-compose.yml`, `AGENTS.md`, `backend/package.json`, `backend/src/estilos/*.json` + `index.js`, `backend/src/services/{formatoVideo, formatoGuion, planDePlanos, rellenarPlan, timelineDesdePlan, directorV2, montaje, qaPlan, adornosPlan, sonidoMontaje, cortesAlGolpe, fotoViva, epocaPlano, youtubePlano, fotoTema, personaPorNombre, paginasReales, clavesProveedores, mezclaVoz, revisionExport, cortarShorts, clipper, comprobarHechos, entrevistas, clonador, regenerarPlano, encuadreVertical, director2d, director3d, directorMapa, partida, escena3dIA, backgroundMirrorService, localRenderService}.js` (cabeceras y funciones citadas), `projectService.js` y `timelineService.js` (fragmentos), `backend/shared/{services/vozProveedores, musicaIA, musicaLibre, efectosSonido, utils/juez}.js`, `backend/runpod-renderer/server.js`, `backend/src/config/queue.config.js`, `backend/src/queues/*`, `backend/src/prompts/guiones/PLAYBOOK.md`, migraciones 043, 058 y 060, `backend/src/routes/projectRoutes.js`, `frontend/src/pages/editor/player/` (componentes citados), `frontend/src/pages/Studio/plan/planRevision.js`. No revisados: el resto de las ~175 plantillas de motion graphics, `user-api-archived/`, `runpod/` (TTS y XTTS), el modo de montaje clásico, los tests, `tools/` en detalle, `datosAbiertos.js`, `utils/clipArchivo`, `imagenIA.js` y `avatarIA.js` (solo nombres de modelos).
