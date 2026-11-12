# Plan de implementación: "Stock con gráficos" con el mecanismo de Make a Videos

> Objetivo: que el formato **stock con gráficos** (video de base + métricas y
> animaciones de `motion/`) funcione como el documental de Make a Videos (MaV):
> plan de planos por frase, material real con licencia, juez visual, look de
> cine y sonido profesional. **Sin perder** lo que ya tiene Scaler: gráficos
> con texto literal del guion anclados a la palabra, sincronía con Whisper,
> revisión humana antes del render, cola en Postgres y créditos.
>
> Base: `COMPARATIVA-ScalerTool-vs-MakeAVideos.md` (análisis del código de MaV)
> e `INFORME-arquitectura-y-proveedores.md`. Las referencias `GAP-XX` son las
> de la comparativa.

---

## 0. Decisiones

| # | Decisión | Estado |
|---|---|---|
| D1 | El foco es el formato **stock con gráficos**, no el animado ni el documental animado | ✅ Tomada |
| D2 | Copiar el **mecanismo y el formato** del documental de MaV, conservando métricas y animaciones | ✅ Tomada |
| D3 | Cómo se activa: columna nueva `video_projects.montaje` = `escenas` (como hoy) o `plan` (modo MaV). Solo admins mientras se prueba; los dos modos conviven y se pueden comparar con el mismo guion | 🟡 Propuesta (recomendada) |
| D4 | Aceptar fotos **CC BY / CC BY-SA** con créditos automáticos (sin esto no hay material de personas y lugares) | 🟡 Asumida, confirmar |
| D5 | **No** descargar metraje ni entrevistas de YouTube (riesgo legal en un SaaS). Reemplazo: archive.org (dominio público), Commons, stock y video IA de SnapGen | 🟡 Recomendada, confirmar |
| D6 | Modelo del juez visual: Claude Haiku 5.5 (ya hay provider `anthropic`) o sumar Gemini Flash (nivel gratuito, el que usa MaV) | 🔴 Pendiente |
| D7 | Música: biblioteca libre CC BY (Kevin MacLeod, la misma que MaV) al principio; música IA más adelante | 🟡 Propuesta |
| D8 | Vertical 9:16: fuera de este plan (fase posterior) | 🟡 Propuesta |

---

## 1. Cómo queda el pipeline en modo `plan`

```
guion (con capítulos "## Título | ánimo")
  → voz (sin cambios) → loudnorm −14,5 LUFS                    [F3]
  → Whisper por palabra (sin cambios)
  → plan_shots: planos anclados a palabras, con clase           [F4]
      metraje · persona · cosa · lugar · ambiente · mapa · pagina · grafico
  → fill_shots: cadena de fuentes por clase + caché + dedupe     [F5]
  → judge_shots: juez de visión + época, hasta 2 reemplazos      [F6]
  → overlays: métricas/info dentro del presupuesto del plan      [F7]
  → build_timeline (sin cambios de contrato)
  → GATE HUMANO (sin cambios; ahora muestra clase, QA y licencia) [F8]
  → copia de clips a R2                                           [F1]
  → render: look + movimiento + cortes de zoom + destellos        [F2]
            + música con ducking + efectos + gráficos + subtítulos [F3]
  → QC del MP4 (negro, congelado, LUFS) + render versionado       [F1/F3]
```

Decisión de diseño clave: **cada plano es una fila de `scenes`**. Los planos de
MaV duran de 2,5 a 9 s, muy cerca de las escenas actuales (4–12 s), así que la
pestaña de revisión, `regenerate-visual`, `upload-visual`, `build_timeline` y el
render siguen funcionando sin cambiar su contrato. `plan_shots` reemplaza a
`build_scenes` solo cuando `montaje = 'plan'`. Los datos nuevos del plano van en
`scenes.content` (`shot_class`, `subject`, `query`, `epoch_year`, `chapter`).

---

## 2. Fases

Orden pensado para que cada fase se pueda probar sola y mejore el video aunque
las siguientes no estén. Las estimaciones son de días de desarrollo efectivo.

### F1 — Infra: copia de clips y renders versionados (GAP-12) · ~1 día
**Para qué:** los clips de SnapGen vencen a los ~14 días y los de stock pueden
desaparecer; hoy el render se pisa. Es prerrequisito de todo lo demás.

- `lib/mirrorAssets.ts` (nuevo): antes del render, para cada asset `VIDEO`/`IMAGE`
  de escena cuya URL no sea de R2, descarga en streaming y sube a
  `skaler-media/<project_id>/<asset_id>.<ext>`; guarda la URL original en
  `metadata.source_url`. Concurrencia 4. Si una copia falla, se loguea y se usa
  la URL original (no tira el render).
- `pipeline/orchestrator.ts::runRenderPipeline`: llamar a la copia y reemplazar
  las URLs en `timelines.content` (mapa URL vieja → nueva).
- `tools/renderVideo.tool.ts`: render a `skaler-renders/<project_id>/<timestamp>.mp4`
  (R2, Cloudinary y Supabase). El front ya toma el `final_render` más reciente.
- Solo si R2 está configurado (Supabase Storage tiene límite de tamaño y egreso).

**Listo cuando:** un proyecto con SnapGen vuelve a renderizar después de borrar
el archivo original, y los renders viejos siguen accesibles.

### F2 — Look y movimiento en el render (GAP-05, GAP-04) · ~2–3 días
Todo en `renderVideo.tool.ts`, activo solo en modo `plan` (o, mientras F4 no
exista, cuando `overlays_enabled`, para poder verlo antes).

| Recurso MaV | Implementación en Scaler (ffmpeg) |
|---|---|
| Gradación contraste 104 / saturación 94 / brillo 99 | `eq=contrast=1.04:saturation=0.94:brightness=-0.01` por segmento |
| Viñeta | `vignette=PI/5` por segmento (debajo de gráficos y subtítulos) |
| Fotos nunca quietas ni con el mismo movimiento dos veces | Selector de movimiento: zoom-in, zoom-out, paneo izq/der, empuje; nunca igual al anterior. Reemplaza el Ken Burns único |
| Segundo encuadre un 10 % más cerca | Si dos planos seguidos usan la misma imagen, el segundo arranca con zoom 1,10 |
| Cortes de zoom en clips cada 4 s (abierto 1,03–1,09 / cerrado 1,18–1,28) | `zoompan` con `d=1` sobre el clip ya escalado, alternando el zoom por tramos de 4 s |
| Corte seco como regla | Concat sin xfade (hoy lo hace con transiciones apagadas) |
| Destello cálido "floración" cada 9 planos | `eq` con brillo dependiente de `t` en los primeros ~0,35 s del plano 9, 18, 27… + leve tinte cálido |
| Dissolve de 700 ms entre secciones | `xfade=dissolve` solo en los cambios de capítulo (necesita F7); requiere duraciones de transición por corte en `assignSegmentDurations` |
| Subtítulos documentales | Estilo nuevo en `lib/captions.ts`: Roboto Condensed 54 px (a 1080p), blancos, sin caja, sombra y contorno, 7 palabras. Fuente al Dockerfile. Se ocultan mientras hay un gráfico que ya escribe la frase (`kinetic_quote`, `pivot_question`, `myth_fact`) |

**Riesgo:** `zoompan` en clips de video sube el costo de CPU. Medir con
`RENDER_BATCH_SIZE` en el worker y bajar a `fast` el preset intermedio si hace falta.
**Listo cuando:** un render de prueba (`pruebas-video/` de Chernóbil) se ve con
gradación, viñeta, movimientos sin repetir, cortes de zoom y destellos, sin
desfasarse del audio.

### F3 — Sonido y control de calidad (GAP-06, GAP-07) · ~3 días
- **Voz:** loudnorm de dos pasadas a −14,5 LUFS / −1,5 dBTP sobre la narración
  descargada, antes de mezclar (salida FLAC temporal).
- **Música:**
  - Tabla `music_library` (`id, mood, title, author, license, url, duration_s`).
    Moods: documental, tension, triste, epico, misterio, esperanza.
  - Script `scripts/seed-music.ts` que carga una vez las pistas CC BY a R2
    (`skaler-music/<mood>/<id>.mp3`). Cada pista se acredita (F5).
  - Elección: un mood por capítulo (de la marca `## Título | ánimo`) o, sin
    capítulos, un mood por video según `generate_visual_context.genre`.
  - Mezcla: música al 20 % y bajada al 35 % de ese nivel mientras hay voz
    (envolvente de volumen desde los `segments` de Whisper, o
    `sidechaincompress` con la voz). Crossfade de 2 s entre pistas, fade final.
- **Efectos de sonido:** sintetizados con ffmpeg una sola vez y guardados en R2
  (`skaler-sfx/whoosh.mp3`, `hit`, `paper`, `tick`). Mapeo por tipo de gráfico:
  whoosh en capítulos, golpe en cifras (`big_number`, `number_phrase`,
  `scoreboard`), papel en `document_highlight`, tic en `timeline`. Volumen 38 %,
  separación mínima de 3 s. Los tiempos salen de los overlays ya anclados.
- **QC del MP4** (`lib/renderQc.ts`): una pasada con `blackdetect`,
  `freezedetect` y `ebur128`. El informe se guarda en
  `assets.metadata.qc` del `final_render` y se muestra en Preview. No bloquea la
  entrega: avisa.

**Listo cuando:** el video sale a −14 ±1 LUFS, la música no tapa la voz y el QC
detecta un tramo negro de prueba.

### F4 — Plan de planos por frase (GAP-01) · ~4–5 días (el corazón)
- Migración: `video_projects.montaje text not null default 'escenas' check (montaje in ('escenas','plan'))`.
- Tool **`plan_shots`** (Claude Sonnet 5.5, configurable en el provider):
  - Entrada: guion, `words` de Whisper, contexto visual (época, lugar, género), capítulos.
  - Salida por plano: `word_start`, `word_end`, `class`, `subject`, `query_en`
    (búsqueda), `epoch_year`, y para `grafico` el tipo de overlay y su texto literal.
- **Validador en código** (como el de MaV), con una ronda de corrección al LLM y
  después reparación automática:

  | Regla | Valor |
  |---|---|
  | Duración por clase | normal 2,5–9 s · persona 3,2–6 · mapa 4–7 · página 3,4–6,5 |
  | Adelanto (el plano entra antes de la palabra) | persona 0,9 s · mapa 1,6 s |
  | Cobertura | todo el audio, sin huecos ni solapes, cortes en límites de palabra |
  | Gráficos | nunca dos seguidos; ≤3/min (6/min en el primer minuto); ≤30 % del tiempo; separación ≥4,5 s |
  | Lo que no cabe como gráfico | baja a rótulo (`lower_third`, `badge`) |

- `orchestrator.ts`: si `montaje = 'plan'`, `plan_shots` reemplaza a
  `build_scenes` y a `generate_stock_keywords` (la query sale del plan).
- Cada plano se guarda como fila de `scenes`.

**Listo cuando:** el guion de prueba de 30 s produce un plan válido, con
gráficos dentro del presupuesto y cambios de imagen donde cambia el sujeto.

### F5 — Fuentes por clase, caché y créditos (GAP-02, GAP-14, GAP-15 parte) · ~4–5 días
Tool **`fill_shots`**: para cada plano prueba una cadena de fuentes y respaldos
en orden.

| Clase | Cadena de fuentes (en orden) |
|---|---|
| persona | Wikidata (entidad → P18) → Commons de la persona → stock genérico de ambiente |
| cosa / lugar | Commons fotos (PD, CC0, CC BY, CC BY-SA; ≥900 px; sin panorámicas) → Openverse → stock video |
| metraje | Stock video (Pexels, Pixabay, Coverr) → Wikimedia video → archive.org si `epoch_year` < 1980 |
| ambiente | Stock video genérico acorde al contexto global |
| mapa | Overlay `map_marker` o `map_globe` a pantalla completa (ya existen) |
| pagina | Captura de Wikipedia con la frase resaltada (Chrome headless del worker, `playwright-core`) → rótulo |
| grafico | Overlay (F7) sobre un plano de ambiente desenfocado |

- Clientes nuevos en `providers` con `type = 'stock_image'` (`commons_photo`,
  `openverse`), `person_image` (`wikidata`) y `archive_video` (`archive_org`),
  con el mismo patrón `PROVIDER_CLIENTS` de `searchStock.tool.ts`.
- **Caché** de 14 días: tabla `source_cache` (`class, query, provider, results jsonb, created_at`).
- **Dedupe perceptivo:** hash dHash de un fotograma por candidato; nunca el
  mismo visual dos veces en el video (extiende `usedStockKeys`).
- **Créditos:** `assets.metadata` suma `license`, `author`, `source_page`.
  Endpoint `GET /projects/:id/credits` que arma el texto para la descripción y
  botón "Copiar créditos" en Preview.
- Se respetan `content_policy` y `stock_library_entries` (bloqueados/preferidos)
  también en las fuentes nuevas.

**Listo cuando:** un guion histórico muestra la foto de la persona nombrada, el
lugar real y material de época, y los créditos salen completos.

### F6 — Juez visual y control de época (GAP-03) · ~3 días
- Tool **`judge_shots`** (modelo según D6), en lotes de ~6 planos.
- Entrada por plano: frase, clase, sujeto, año; imagen o 3 fotogramas del clip
  (20/50/80 %, extraídos con ffmpeg a baja resolución).
- Códigos: `ok`, `generico`, `equivocado`, `persona`, `epoca`, `texto`,
  `oscuro`, `marca_agua`.
- Si rechaza: siguiente candidato de la cadena de F5, hasta 2 reemplazos; si no
  se arregla, un plano seguro (ambiente). Nunca deja una imagen equivocada.
- Guarda `assets.metadata.qa = { code, reason, attempts }`; todo queda en
  `tool_executions`.
- Corre **antes** del gate humano: lo alimenta, no lo reemplaza.

**Listo cuando:** en un video de prueba, los planos anacrónicos o equivocados
se reemplazan solos y la revisión muestra el motivo.

### F7 — Gráficos de métricas e información con reglas MaV (GAP-10, GAP-11, GAP-15 parte) · ~3–4 días
Se conserva todo lo actual (31 componentes, texto literal, anclaje a la
palabra) y se suma:
- **Gráficos decididos dentro del plan** (F4) con su presupuesto, en vez de
  planificarlos aparte. `plan_overlays` queda como ejecutor para el modo `escenas`.
- **Rótulos coherentes:** `lower_third` y `person_card` solo sobre un plano
  `persona` del mismo sujeto; aparecen 300 ms después de su frase y duran ≥2,2 s.
- **Componentes nuevos en `motion/`:**
  - `date_corner`: año en la esquina en la primera mención.
  - `document_highlight`: página con la frase resaltada.
  - `flag_corner`: bandera del país, una vez por país, cada ≥18 s.
- **Datos reales:** `fetch_open_data` (Banco Mundial) alimenta `line_chart`
  cuando la frase habla de un indicador de un país. Las cifras que se leen en
  pantalla siguen siendo las del guion.
- **Capítulos:** `generate_script` escribe `## Título | ánimo` siguiendo el
  esqueleto documental (cold open 3–5 %, setup 8–12 %, build-up 20–25 %, evento
  30–35 %, consecuencias 10–15 %, resolución 5–8 %, outro 2–3 %). Cada capítulo
  trae tarjeta (`chapter_index`), whoosh, cambio de música y dissolve (F2).
  Export de timestamps para la descripción de YouTube.
- **Estilo:** preset "documental" de paleta (serif crema `#F3EEE4`, acento dorado
  `#E3B25B`) en `niches.json`, y lista de componentes prohibidos para este modo.

**Listo cuando:** el video muestra métricas y rótulos sin tapar planos
importantes, con capítulos marcados y respetando el presupuesto.

### F8 — Revisión en el front · ~2–3 días
En `StockReviewPanel` / `ScenePanel`:
- Por plano: clase, sujeto, fuente + licencia y el código QA del juez.
- "Regenerar con indicación": un prompt corto que rehace la búsqueda de ese plano.
- Selector de **montaje** (`escenas` / `plan`) en Preview, solo admins.
- Informe de QC y botones "Copiar créditos" y "Copiar capítulos".

---

## 3. Resumen de cambios

| Área | Cambios |
|---|---|
| Migraciones | `video_projects.montaje`, `music_library`, `source_cache` |
| Tools nuevas | `plan_shots`, `fill_shots`, `judge_shots`, `fetch_open_data`, `capture_page` |
| Libs nuevas | `mirrorAssets.ts`, `renderQc.ts`, `audioMix.ts` (loudnorm, música, SFX), clientes de Commons/Openverse/Wikidata/archive.org |
| Modificados | `orchestrator.ts`, `renderVideo.tool.ts`, `captions.ts`, `generateScript.tool.ts`, `planOverlays.tool.ts`, `overlayTiming.ts`, `Dockerfile` (fuente) |
| motion/ | `date_corner`, `document_highlight`, `flag_corner`; preset de paleta documental |
| Front | Selector de montaje, revisión con QA y licencias, créditos, capítulos, QC |
| Providers (filas) | `commons_photo`, `openverse`, `wikidata`, `archive_org` (sin key) y, si D6 = Gemini, `gemini` |

## 4. Calendario sugerido

| Semana | Fases | Resultado visible |
|---|---|---|
| 1 | F1 + F2 | Renders estables y con look de cine (se ve en cualquier video con gráficos) |
| 2 | F3 | Música, efectos, volumen correcto y QC |
| 3 | F4 | Plan de planos por frase funcionando con stock de video |
| 4 | F5 | Fotos reales de personas, lugares y época, con créditos |
| 5 | F6 + F8 | Juez visual y revisión enriquecida |
| 6 | F7 | Métricas y rótulos con reglas MaV, capítulos y datos reales |

Total estimado: **~25–30 días de desarrollo**. F1–F3 dan mejora visible en dos
semanas aunque el resto se demore.

## 5. Cómo se prueba

- Usar el material de `pruebas-video/` (guion de Chernóbil de 30 s, palabras y
  planes) como caso de regresión, más un guion largo (10 min) para costos y
  tiempos.
- Comparar el mismo guion en `montaje = escenas` y `montaje = plan`.
- Métricas por video: % de planos aceptados por el juez a la primera, reemplazos,
  tiempo de pre-render, tiempo de render, costo de LLM, LUFS final, avisos de QC.
- `npm run build` del backend y `typecheck` de `motion/` en cada fase.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Costo de CPU del render (zoompan en clips) | Medir en el worker; preset intermedio más rápido; cortes de zoom solo en clips > 6 s |
| Costo del LLM (plan + juez) en videos largos | Haiku/Gemini para el juez, caché de 14 días, lotes de 6 |
| Licencias mal leídas en Commons | Solo aceptar licencias legibles por máquina de una lista blanca; crédito siempre |
| Falta material para temas de nicho | La cadena siempre termina en stock genérico o en video IA (SnapGen) |
| Pre-render más largo | Concurrencia por plano (como `SCENE_CONCURRENCY`) y progreso por fase en el job |
| Romper el modo actual | Todo detrás de `montaje = 'plan'`; `escenas` queda idéntico |

## 7. Para decidir mañana

1. **D3:** ¿se activa con la columna `montaje` (recomendado) o reemplaza directamente el formato stock con gráficos?
2. **D4:** ¿se aceptan fotos CC BY con créditos en la descripción?
3. **D5:** ¿se confirma que no se usa metraje de YouTube?
4. **D6:** ¿juez con Claude Haiku (ya configurado) o se suma Gemini Flash (gratis, el que usa MaV)?
5. ¿Arrancamos por F1 + F2 (mejora visible rápida) o directo por F4 (el plan de planos)?
