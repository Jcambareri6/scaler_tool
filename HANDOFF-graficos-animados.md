# Handoff: gráficos animados (Remotion) — rama `formato-documental`

Contexto para el agente que siga este trabajo. Leelo entero antes de tocar código.

## Objetivo del producto

Que la plataforma genere videos faceless con **gráficos animados sobre el stock**
(cifras, comparaciones, mapas, diagramas, capítulos…), en **cualquier nicho**
(ciencia, animales, psicología, finanzas, historia, true crime…). No se copia un
canal: se detecta la **intención** de cada tramo del guion y se elige el
componente que mejor la muestra. El nicho solo cambia el tema visual y qué
componentes se usan más.

Referencia de estilo analizada: canal MAGNITUD ("¿Qué pasaría si la Tierra
dejara de girar?"). Rasgos: sin cajas ni paneles, dorado cálido + blanco, serif
elegante para títulos, sans muy bold para cifras, bajadas en mayúsculas
espaciadas, fondo oscurecido/desenfocado cuando entra un gráfico, capítulos con
barra de progreso arriba, subtítulos con palabra clave en color.

## Hoja de ruta (8 fases)

| Fase | Qué es | Estado |
|---|---|---|
| **0** | Prueba técnica con Remotion | ✅ Hecha |
| **1** | Base: conexión al pipeline, sincronía a la palabra, render y Docker | ✅ Hecha — falta probarla en el entorno real |
| **2** | Los otros 14 componentes (ver tabla en "Próximo trabajo") | Siguiente |
| **3** | Subtítulos nuevos con palabra clave resaltada, por tema | Pendiente |
| **4** | Mapas con anotaciones | Pendiente |
| **5** | Diagramas a medida (cortes, ciclos, etiquetas sobre imágenes) | Pendiente |
| **6** | Editor para revisar y editar los gráficos antes del render | Pendiente |
| **7** | Versiones verticales para Shorts | Pendiente |

Orden recomendado:

1. **Validar la Fase 1 en el entorno real** antes de sumar nada: migración,
   worker con Docker y un video real con gráficos. Revisar logs del worker
   (`[render_video] animando N graficos...`) y mirar el video resultante.
2. **Fase 2**, empezando por lo que más se usa en cualquier nicho:
   capítulos + barra de progreso → frase cinética → barras/versus →
   definición → lista → lugar → después ranking, ficha, línea de tiempo,
   escala, mito vs realidad, dato fijo en esquina y CTA.
3. Fases 3 a 7 en orden.

Las fases más largas son la 2 (cantidad de componentes); las más complejas
técnicamente, la 4 (mapas) y la 5 (diagramas).

## Puesta en marcha local

Desde la raíz del repo, con la rama ya bajada (`git checkout formato-documental`):

```bash
cd backend && npm install
cd motion && npm install && npm run build && npm run ensure-browser
cd ../frontend_v1 && npm install
```

- `.env`: los de siempre (`backend/.env.example`, `backend/frontend_v1/.env.example`).
  No hay variables nuevas obligatorias.
- Migración: ejecutar `backend/supabase/migrations/20261028000000_video_overlays.sql`
  en Supabase (columnas `overlays_enabled`, `overlay_theme` en `video_projects`).
- Levantar: `npm run dev` en `backend/` (**desde esa carpeta**: busca `./motion`)
  y `npm run dev` en `backend/frontend_v1/`.
- En el panel de render: activar "Gráficos animados" y elegir el estilo.
- Prueba aislada de Remotion: `cd backend/motion && npm run render:sample -- out`
  → genera `out/overlay.mov`.

## Arquitectura (cómo fluye)

1. `backend/src/pipeline/orchestrator.ts` — si `project.overlays_enabled`, llama a
   `plan_overlays` **una vez** con el guion completo.
2. `backend/src/tools/planOverlays.tool.ts` — LLM (Claude → OpenAI → heurística)
   elige gráficos por escena. **Solo ofrece los tipos que existen en
   `backend/motion/catalog.json`** (vía `supportedOverlayTypes()`).
3. `backend/src/tools/generateOverlay.tool.ts` — modo estricto: `text`, `label`
   e `items` tienen que ser literales del guion. Lo inválido se descarta solo.
   Se guarda en `scene.content.overlays`.
4. `backend/src/tools/buildTimeline.tool.ts` + `backend/src/lib/overlayTiming.ts` —
   ancla cada gráfico a la **palabra exacta** donde se narra (timing de Whisper,
   `alignScriptTokens`), guarda `start_seconds`.
5. `backend/src/tools/renderVideo.tool.ts` — `placeOverlays` (sin superposición) →
   `renderMotionClips` (`backend/src/lib/motion.ts`) → superpone en la pasada final
   de ffmpeg junto con los subtítulos (`burnGraph`).
6. `backend/motion/` (Remotion) — `scripts/render-overlays.ts` es el CLI que usa el
   worker: un navegador por video, renderiza **solo la animación de entrada**
   (`introSeconds` del catálogo) como ProRes 4444 con alfa. ffmpeg congela el
   último frame, hace el fundido de salida y lo corre a su segundo.

Reglas de diseño importantes:
- Si `motion/` no está instalado o falla, **el video sale igual, sin gráficos**
  (nunca tirar el render por esto).
- Gráficos a la resolución del proyecto (720p/1080p); diseñar en 1920×1080 y
  escalar con `s = height / 1080`.
- Cifras: `motion/src/lib/literal.ts` pasa "más de 1.000 km por hora" a
  `+` `1.000` `km/h` (mismo número, sin inventar) y formatea con el locale del
  idioma del canal (`numberLocale` en `lib/motion.ts`).
- Temas en `motion/src/theme.ts` (documental, ciencia, finanzas, historia,
  crimen, minimal). Fuentes vía `@fontsource` (Inter, Cormorant Garamond),
  cargadas con `delayRender` en `motion/src/fonts.ts`.

## Estado actual

Hecho (Fases 0 y 1):
- Paquete `backend/motion` con composición genérica `Overlay` y **1 componente**:
  `big_number` (`motion/src/components/BigNumber.tsx`).
- Integración completa en pipeline, timeline, render y UI (toggle + tema).
- Dockerfile del worker con Remotion, Chrome Headless Shell y librerías.
- Mediciones en `backend/motion/README.md` (≈2–3 min extra a 720p para 40 gráficos).

**No verificado todavía**:
- Construir la imagen Docker del worker (el entorno donde se hizo no tenía
  acceso a los repos de Debian).
- Una corrida completa con un proyecto real (DB + LLM). Las piezas se probaron
  por separado: anclaje, ubicación, render Remotion y composición ffmpeg.

## Próximo trabajo: Fase 2 (los otros componentes)

Agregar un componente = 4 pasos (ver `backend/motion/README.md`):
1. Componente en `motion/src/components/` (props: `spec`, `theme`, `exit`, `locale`).
2. Caso en `motion/src/Overlay.tsx`.
3. Entrada en `motion/catalog.json` con `introSeconds`.
4. Descripción en `TYPE_GUIDE` de `backend/src/tools/planOverlays.tool.ts`
   (si es un tipo nuevo, sumarlo también a `OverlayType` en
   `backend/src/types/shared/typeShared.ts` y a `VALID_TYPES` de `generateOverlay`).

Catálogo objetivo (intención → componente):

| Componente | Intención | Notas de diseño |
|---|---|---|
| `big_number` ✅ | Cifra que impacta | Hecho |
| Barras/columnas (`data_viz_single`) | Comparar 2–5 valores | Columnas que aparecen de a una; la destacada en acento con brillo |
| `versus` | X contra Y | Barras horizontales finas + conclusión en acento |
| Escala/analogía | "pesa como 3 autos" | Íconos repetidos (Lucide/Phosphor, siluetas PhyloPic) |
| `timeline` / proceso | Secuencia, etapas, fechas | Línea que se completa, hitos que se marcan |
| Definición (`lower_third`) | Concepto o término | Término + definición corta |
| Lista | Enumeración | Ítems que se van sumando |
| `rank_reveal` | Top N | Número grande + nombre |
| Ficha | Protagonista (especie, persona) | Datos clave en columnas |
| `location` | Lugar | Barra de acento + nombre + dato |
| Mito vs realidad | Desmentir | Tachado → verdad |
| Frase cinética | Frase clave | Mayúsculas bold, palabra clave en acento |
| `title_card` + progreso ✅ | Capítulos | Hecho: número calado gigante detrás, barra de progreso arriba (el tag fijo persistente queda pendiente) |
| Dato fijo en esquina | Estado persistente | "UN DÍA DURA / 1 AÑO" |
| `cta` | Suscribirse/comentar | Píldora en acento |

Fases siguientes: 3) subtítulos con palabra clave resaltada por tema;
4) mapas (d3-geo + Natural Earth; fondos NASA Blue/Black Marble o MapTiler/Mapbox;
geocodificación Nominatim); 5) diagramas (plantillas paramétricas + SVG del LLM;
etiquetas sobre imagen con Claude visión); 6) editor con `@remotion/player`
para revisar/editar gráficos antes del render; 7) variantes verticales (Shorts).

## Decisiones pendientes del dueño

- **Modo estricto vs reformulación**: hoy todo texto es literal del guion
  (la cifra se compacta de forma determinística). Las referencias reformulan
  frases ("Extinción en horas"). Preguntar antes de relajarlo.
- **Licencia Remotion**: gratis hasta 3 personas en la empresa; con 4+ hace
  falta Company License ("Automators": USD 0,01/render, mínimo USD 100/mes).
- Presupuesto para mapas (solo gratuitos vs MapTiler/Mapbox) y si se renderiza
  en el worker propio o en Remotion Lambda.

## Convenciones del repo

- Comentarios y mensajes en español rioplatense, explicando el *por qué*.
- Commits: `tipo(área): descripción` en español (ej. `feat(motion): ...`).
- Verificar antes de commitear: `npx tsc --noEmit -p .` en `backend/`,
  `backend/motion/` y `backend/frontend_v1/`.
- Al probar renders, mirar fotogramas reales (extraer con ffmpeg) además de
  que el comando termine bien.
