# YouTube en el documental: estado de las mejoras del informe Scaler vs Make a Videos

Fecha: 17/11/2026. Rama: `fix/youtube-proxy-rele` (sin commit ni deploy al worker).
Pruebas: 14 archivos en `backend/scripts/tests`, todos pasan.

Leyenda: ✅ hecho · ⏳ pendiente · ⛔ no se hace (decisión tomada) · ❓ espera decisión

## 1. Top 10 del informe

| # | Mejora | Estado | Dónde quedó |
|---|---|---|---|
| 1 | Freno de YouTube y clasificación de errores (bloqueo / red / roto). Tras 4 fallos seguidos de bloqueo o red se abre 90 s; los videos rotos no cuentan | ✅ | `lib/youtubeGuard.ts` (`frenoYoutube`, `clasificar`). Lo usan la búsqueda, la hoja, el tramo y los subtítulos (`lib/youtubeSource.ts`); con el freno abierto la ronda de YouTube se saltea (`documentalPipeline.ts`, `tryRound`) |
| 2 | Semáforo global de YouTube y límite de ffmpeg en la hoja | ✅ | `ytdlpSlots` = 4 procesos de yt-dlp (`YT_PARALELO`), `sheetSlots` = 6 ffmpeg (`YT_HOJA_FFMPEG`) |
| 3 | Presupuesto de tiempo | ✅ | Búsqueda: max(14 min, 25 s por plano); pasado el tope, lo que falta va al rescate. Rescate: max(6 min, 12 s por plano); pasado el tope, rótulo. Variables `DOCUMENTAL_SEARCH_BUDGET_MS` y `DOCUMENTAL_RESCUE_BUDGET_MS` |
| 4 | Nota por cuadro en la hoja y hasta 3 instantes | ✅ | El juez devuelve `cuadros_ok` (`visualJudge.ts`, `goodFrames`). `materializeYouTube` prueba hasta 3 instantes buenos antes de rendirse, sin otra llamada al juez |
| 5 | Otro momento desde la hoja, no a ciegas | ✅ | `rememberGoodMoments` / `nextGoodMoment` en `documentalPipeline.ts`. Las fracciones fijas quedan solo de respaldo. El rescate suma los videos que el juez aprobó aunque no se hayan usado |
| 6 | Visión 2 con cuadros al 3, 35, 65 y 97 % del clip entero | ✅ | `candidateThumbnail`, rama de clip local (`visualJudge.ts`) |
| 7 | Haiku para la hoja de cuadros | ⛔ | El juez sigue en Sonnet (regla del usuario) |
| 8 | Filtro de canal, mínimo de 60 s y prioridad a los videos de 2 a 30 min | ✅ | `BLOCKED_CHANNEL` y orden por duración en `searchYouTubeVideos`. Sin premio a noticieros ni canales oficiales (Content ID) |
| 9 | Candado por video y reserva del uso en el rescate | ✅ | Chequeo sincrónico de `used` antes de bajar; en el rescate, `usesOf` se reserva antes del `await` y se devuelve si falla |
| 10 | yt-dlp al día y `limpiar()` | ✅ | `updateYtDlp()` al arrancar el worker y cada 24 h (`worker.ts`); el binario pasa a ser del usuario `node` (`Dockerfile`). Los mensajes de error se limpian antes de loguearlos o guardarlos |

## 2. Resto de la tabla comparativa

| Punto | Mejora | Estado | Nota |
|---|---|---|---|
| 1.0 / 2.1 / 2.7 | Caché por frase (14 días) y de búsquedas (6 h) en Postgres | ✅ | Tablas `shot_cache` y `yt_search_cache` (`supabase/migrations/20261117000000_documental_cache.sql`, ya aplicada); `lib/documentalCache.ts`. Lo que rechaza el QA sale de la caché. Falta la caché de subtítulos |
| 1.1 | Búsqueda local en el idioma del lugar | ✅ | El montajista escribe `query_local` ("bajada de La Rumorosa"); YouTube busca primero la local y después la de inglés |
| 1.3 / 2.8 | Subtítulos antes de la hoja (2 cuadros por momento), coincidencia por prefijo y timeout de 15 s (hoy 60) | ⏳ | Esfuerzo mediano |
| 1.4 | Guardar unos minutos la URL directa de cada video | ⏳ | Esfuerzo chico |
| 1.8 | Inicio del tramo y URL con `&t=` en los metadatos | ✅ (parcial) | Se guardan `start_seconds` y `source_url_t`; falta el fin |
| 2.2 | Cortar una descarga sin datos | ✅ | Relé: 10 s sin bytes (antes 60). Subtítulos: 15 s (antes 60) |
| 2.3 | `--socket-timeout`, `--retries`, deno | ✅ (sin deno) | yt-dlp siempre con `--socket-timeout 15 --retries 2` |
| 2.4 | Contar los megas del proxy | ⏳ | Esfuerzo chico |
| 2.10 | Modelo de reserva ante 429 o modelo retirado | ✅ | `claudeJudge` (`visualJudge.ts`): si Sonnet da 429, 404, 5xx o está saturado, pasa a Opus 5.5 (solo Claude). Lo usan el juez y el QA |
| 2.11 | Créditos para la descripción de YouTube | ✅ | `buildCreditsText` (`documental.service.ts`): metraje (YouTube con ?t=), fotos con licencia, mapas y música; tope de 4500 caracteres que nunca corta mapas ni música |
| — | Retomar un video tras un reinicio sin repetir los planos ya hechos | ⏳ | Esfuerzo mediano o grande |
| — | Comentarios "sin tope de usos" del rescate | ✅ | Corregidos: el tope se aplica |

## 3. Decisión tomada

| Tema | Opciones | Por qué importa |
|---|---|---|
| Logo chico de canal en una esquina | **Elegida: A.** Recortarlo (el cuadro al 84 %, como MaV) y usar el clip. **B.** Descartar el clip (como hoy) | En el piloto de 3,5 min el juez rechazó 70 candidatos por marca o logo y 77 por persona a cámara. Con B quedaron 14 rótulos de 52 planos. Con A nunca se ve un logo en el video y se recuperan los videos de la cuesta. La marca de agua de verdad (grande, central o semitransparente) se descarta siempre. Implementado: el juez dice la esquina (`logo_esquina`), el tramo se baja recortado (`cornerCrop`) y la 2da revisión y el QA vuelven a mirar. En fotos y stock un logo de esquina se descarta |

## 4. Lo que ya hacemos mejor que MaV (no perder)

- Tope de usos por video (3, o 2 si dura menos de 90 s) y el mismo video no vuelve hasta 3 planos después.
- Solo se baja el tramo, por un relé que pide únicamente los bytes necesarios.
- Vloggers y marcas de agua fuera por código: chequeos `camara` y `marca` en el juez y en el QA, más el bloqueo por título.
- Lo rescatado también pasa por el QA; lo que no pasa queda como rótulo.
- Se guardan los rechazos, la justificación del juez y el recorrido del rescate de cada plano.
- Lugar de la historia y época por reglas en el contexto del juez.
- Pruebas automáticas (MaV no tiene).

## 5. Pilotos

| Piloto | Duración | Planos | Rótulos | Tiempo | Qué mostró |
|---|---|---|---|---|---|
| Video del cliente (antes) | 3:18 | 41 | 11 | 17 min | Época mal puesta, otros países, loops, 10 planos de 2 drones |
| Piloto 1 | ~1:45 | 26 | 0 (+3 mapas) | 28 min | Entraron una selfie de vloggers y un túnel de mina (el rescate no tenía QA) |
| Piloto 2 | 4:10 | 52 | 14 | 51 min | Sin vloggers ni marcas; el QA del rescate frenó 7 errores. Demasiados rótulos por el descarte del logo de esquina |

El próximo piloto, con lo de este documento, tiene que medir el tiempo total y los rótulos.
