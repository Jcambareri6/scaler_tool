# Plan de implementación (v2): documental con material real estilo MaV sobre la arquitectura hub and spoke de Scaler

> **Cambio respecto de la v1:**
> - **No** se agrega un modo al lado del actual: el pipeline de stock se
>   **reemplaza**.
> - De lo hecho se conservan los **gráficos y componentes** (`motion/`) y la
>   arquitectura de agentes **hub and spoke** con su verificador y su juez
>   visual, que ya hacen lo mismo que el plan, el QA y los jueces de MaV.
> - La v1 inventaba tools nuevas (`plan_shots`, `judge_shots`). Esta versión
>   reutiliza tus agentes, tu verificador y tu Revisor/Auditor.
>
> Base: `COMPARATIVA-ScalerTool-vs-MakeAVideos.md`,
> `INFORME-arquitectura-y-proveedores.md`, `INFORME-agentes-e-iteracion.md` y
> `docs/formato-documental/`.

---

## 1. Qué se reemplaza y qué queda

| Pieza actual | Destino | Motivo |
|---|---|---|
| `motion/`: 31 componentes, recursos (`Datos`, `Ubicacion`, `EsquemaCapas`, `Pictogramas`), catálogo, nichos y paletas | ✅ **Queda** | Son las métricas y animaciones que se superponen al material real |
| Validación literal de gráficos (`generate_overlay`, `reglasGrafico`, `textoValido`) y anclaje a la palabra (`overlayTiming.ts`) | ✅ **Queda** | Es lo que MaV no tiene: los datos salen del guion, no los inventa la IA |
| Hub and spoke: director, spokes en paralelo repartidos por código, verificador en código, Revisor/Auditor con visión | ✅ **Queda y se reutiliza** | Es el mismo mecanismo de MaV: plan → relleno → QA |
| Managed Agents en Claude Platform (agentes, skills, entorno, `setup-managed-agents.ts`) | ✅ **Queda**, con agentes y una skill nuevos | Ver §3 |
| Voz (ai33 / Edge / audio propio) + Whisper por palabra | ✅ **Queda** | Hace falta igual; Whisper es mejor que la estimación de MaV |
| Plataforma: auth, workspaces, créditos, cola Postgres + worker, gate humano, R2 | ✅ **Queda** | No es parte del "formato"; ver pregunta P1 |
| `build_scenes` (escenas de 4–12 s) | ❌ **Se reemplaza** | Por el plan de planos del director |
| `generate_visual_context` + `generate_stock_keywords` (4 queries en cascada) | ❌ **Se reemplaza** | La query y la clase de cada plano las define el director |
| `search_stock` en cascada como único método | 🔁 **Se reduce** | Pexels/Pixabay/Coverr/Wikimedia quedan como **una** fuente más, dentro de la cadena por clase |
| `plan_overlays` (gráficos planificados aparte) | ❌ **Se reemplaza** | Los gráficos los decide el director dentro del plan, con presupuesto |
| Render actual: Ken Burns único y fade fijo | ❌ **Se reemplaza** | Por el render con look MaV (§4, F5) |
| `visual_source`: `ai` / `mixed` / `flow` (SnapGen, Google Flow) | ❓ **A decidir** (P2) | Pueden quedar como respaldo de la clase "sin archivo" o borrarse |
| Formato `animated` y documental animado (`documentalDirector`, `managedSceneDirector`) | ❓ **A decidir** (P3) | Comparten agentes y skills con lo nuevo |

---

## 2. Cómo se mapea MaV sobre tu arquitectura

```
                         ┌───────────────────────────────────────────┐
  guion + voz + Whisper  │ HUB (código, orchestrator)                │
  ─────────────────────▶ │ reparte, verifica, reintenta, junta       │
                         └──┬──────────────┬──────────────┬──────────┘
                            │              │              │
         1. DIRECTOR        │  2. SPOKES   │              │ 3. JUEZ
         "Montajista"       │  de búsqueda │              │ Revisor/Auditor
         (Opus, Managed     │  por clase   │              │ (visión, ya existe)
          Agent + skill)    │  (código,    │              │
         plan de planos:    │   paralelo)  │              │ mira fotogramas
         clase, sujeto,     │  Commons,    │              │ reales del candidato
         época, gráficos,   │  Wikidata,   │              │ vs la frase:
         capítulos          │  archive,    │              │ genérico, equivocado,
            │               │  stock…      │              │ época, texto, oscuro
            ▼               ▼              │              ▼
     VERIFICADOR (código): reglas MaV + reglas de gráficos que ya tenés
            │  rechazado → vuelve al director con el motivo (1 corrección)
            ▼
     plan + candidatos aprobados → GATE HUMANO → render look MaV + gráficos motion/
```

| Pieza de MaV | Pieza tuya que la cubre | Qué cambia |
|---|---|---|
| `planDePlanos.crear` (LLM) | Agente **Multimedia** / director de `documentalDirector` (Opus, 1 llamada) | Nuevo agente **"Montajista"** con skill `montaje-documental` y tool `submit_shot_plan`: planos con clase en vez de escenas dibujadas |
| `planDePlanos.validar` (código) | **Verificador** (`verificarEscena`, `reglasGrafico`, `textoValido`) | Se suman las reglas de MaV: duración por clase, adelanto, cobertura, presupuesto de gráficos |
| `rellenarPlan` (cadena de fuentes, caché, dedupe) | Reparto por código en paralelo (`mapWithConcurrency`, hasta 10) | Los spokes dejan de ser "Dibujantes": son **buscadores por clase**, en código, sin LLM salvo el juez |
| `qaPlan` + `juez.js` (visión) | **Revisor** (Sonnet) + **Auditor** (Opus) de `sceneReview.ts` | Nuevo `CRITERIA` para material real; las imágenes son fotogramas del candidato (ffmpeg), no capturas de Remotion |
| Respaldo seguro si no se arregla | `escenaSegura` / "recurso seguro" | El respaldo es un plano de ambiente o un gráfico de `motion/` |
| Director v2 de gráficos | El director ya elige gráficos del catálogo con fichas de la skill `direccion-visual` | Se reutilizan las fichas "usalo cuando / no lo uses cuando" tal cual |
| Capítulos `## Título \| ánimo` | El director ya define capítulos y `nav_header` | Se suma el ánimo para la música y la tarjeta de capítulo |

**Por qué es menos trabajo que la v1:** el reparto, los reintentos, las
sesiones en Claude Platform con tope de gasto, el verificador y el juez visual
ya existen. Lo nuevo son el **contenido** (skill, criterios, reglas) y las
**fuentes de búsqueda**.

---

## 3. Claude Platform: lo que pude ver

Desde acá **no tengo acceso a tu consola** de Claude Platform: la API key está
en la tabla `providers` de Supabase y esta sesión no tiene credenciales. Lo que
vi está en el código, que es la fuente de verdad, porque
`scripts/setup-managed-agents.ts` crea o actualiza los agentes a partir de él:

| Recurso | ID | Modelo | Definido en |
|---|---|---|---|
| Agente **Multimedia** (director) | `agent_014xrYirCEZ7TJJQT2UQjSue` | Opus 5.5 | `managedSceneDirector.ts::directorAgentConfig` |
| Agente **Dibujante** | `agent_01MdG84BNAywFovihQYtRTTY` | Sonnet 5.5 | `artistAgentConfig` |
| Agente **Escenas** (diseñador) | `agent_01SYAYVxghtWfsZh9LtVn2BL` | Sonnet 5.5 | `designerAgentConfig` |
| Entorno | `env_01R8GJTBPaV3Me9fXRNzxusR` | — | cloud, red limitada |
| Skills | `direccion-visual`, `dibujo`, `animacion` | — | `backend/skills/*/SKILL.md` |

- Reparto por código (el director ya no coordina), hasta 10 sesiones a la vez,
  3 intentos por pieza, tope de gasto por sesión (120 ¢ por trabajador; el
  director escala con la duración).
- El documental animado (`documentalDirector.ts`) usa la API de mensajes
  directa: director, dibujantes y revisor en Opus 5.5.

Si editaste algo directo en la consola, podés listar lo que hay de verdad con:

```bash
cd backend && ANTHROPIC_API_KEY=tu_key npx tsx -e "import Anthropic from '@anthropic-ai/sdk'; const c = new Anthropic(); for await (const a of c.beta.agents.list()) console.log(a.id, a.name, a.model, 'v' + a.version)"
```

**Para lo nuevo:**
- Se crean dos agentes, **Montajista** (Opus 5.5) y, si hace falta, **Documentalista** (Sonnet, solo para planos difíciles).
- Se crea la skill `montaje-documental`.
- Todo con el mismo `setup-managed-agents.ts`.
- No se tocan los agentes actuales hasta decidir P3.

---

## 4. Fases

### F1 — Base: nuevo pipeline, limpieza y copia a R2 · ~2 días
- `orchestrator.ts`:
  - Nuevo `runPreRenderPipeline` con este orden: voz → Whisper → **montaje**
    (F2–F4) → gráficos → timeline → gate.
  - Se borran los pasos de escenas, contexto, keywords y cascada.
- Se eliminan del registro de tools: `build_scenes`, `generate_visual_context`,
  `generate_stock_keywords` y `plan_overlays`, más el código muerto asociado.
  El front deja de mostrar las opciones que ya no aplican.
- Copia de todo visual externo a R2 (`skaler-media/<project>/<asset>`) y renders
  versionados (`skaler-renders/<project>/<timestamp>.mp4`).

### F2 — Hub: director "Montajista" + verificador · ~4 días
- Skill `montaje-documental`, que combina lo de MaV y lo tuyo:
  - Clases: `metraje`, `persona`, `cosa`, `lugar`, `ambiente`, `mapa`,
    `pagina`, `grafico`.
  - Esqueleto documental del guion, con capítulos y ánimo.
  - Fichas de gráficos de `direccion-visual` ("usalo cuando / no lo uses cuando").
- Tool `submit_shot_plan`: por plano, `desde_palabra`, `hasta_palabra`, `clase`,
  `sujeto`, `query_en`, `anio`, `capitulo`; para `grafico`, el tipo y el
  contenido literal.
- **Verificador** (código, en la línea de `verificarEscena`):

  | Regla | Valor |
  |---|---|
  | Duración por clase | normal 2,5–9 s · persona 3,2–6 · mapa 4–7 · página 3,4–6,5 |
  | Adelanto | persona 0,9 s · mapa 1,6 s |
  | Cobertura | todo el audio, cortes en límite de palabra |
  | Gráficos | nunca dos seguidos; ≤3/min (6/min el primer minuto); ≤30 % del tiempo; separación ≥4,5 s |
  | Datos | literales del guion (`textoValido`, `reglasGrafico`) |
  | Rótulos | `lower_third` / `person_card` solo sobre un plano `persona` del mismo sujeto |

  Si rechaza, vuelve al director con los motivos: 1 corrección y después
  reparación automática.
- Cada plano se guarda como fila de `scenes` (con `content.shot`), así la
  revisión y el reemplazo por escena siguen funcionando.

### F3 — Spokes: búsqueda por clase · ~4–5 días
Reparto por código en paralelo (como los dibujantes), con caché de 14 días
(`source_cache`) y dedupe perceptivo (dHash) en todo el video.

| Clase | Cadena de fuentes |
|---|---|
| persona | Wikidata (P18) → Commons → plano de ambiente |
| cosa / lugar | Commons fotos (PD, CC0, CC BY, CC BY-SA, ≥900 px) → Openverse → stock video |
| metraje | Stock video (Pexels, Pixabay, Coverr) → Wikimedia video → archive.org si es anterior a 1980 |
| ambiente | Stock video acorde al capítulo |
| mapa | `map_marker` / `map_globe` / `Ubicacion` de `motion/` a pantalla completa |
| pagina | Captura de Wikipedia con la frase resaltada (Chrome headless del worker) |
| grafico | Componente de `motion/` sobre un ambiente desenfocado |
| sin material | Respaldo según P2: imagen IA / SnapGen, o ambiente |

Créditos en `assets.metadata` (`license`, `author`, `source_page`),
`GET /projects/:id/credits` y respeto de `content_policy` y bloqueados/preferidos.

### F4 — Juez visual (tu Revisor/Auditor adaptado) · ~2–3 días
- `sceneReview.ts` con un `CRITERIA` nuevo para material real:
  - SENTIDO: ¿muestra el sujeto de la frase?
  - ÉPOCA: ¿nada moderno en un plano histórico?
  - GENÉRICO: ¿es stock que podría ir en cualquier video?
  - TEXTO o MARCA DE AGUA quemados.
  - OSCURO o borroso.
- Entrada: 3 fotogramas por candidato (ffmpeg) + la frase; lotes de ~12 como
  `REVIEW_BATCH`.
- **Revisor** sobre los candidatos (Sonnet o Haiku por costo). Si rechaza, el
  spoke prueba el siguiente candidato, hasta 2 veces; si no, el plano seguro.
- **Auditor** (Opus), una pasada sobre la hoja de cuadros del video entero:
  repetidos, coherencia y lo que el revisor dejó pasar.
- Va **antes** del gate humano y deja `qa` en cada asset.

### F5 — Render con look MaV + tus gráficos · ~3 días
- Gradación (`eq` 1,04 / 0,94 / −0,01) y viñeta por plano.
- Movimiento sin repetir en fotos (zoom in/out, paneos, empuje; el segundo
  encuadre de la misma imagen, un 10 % más cerca).
- Cortes de zoom cada 4 s en clips.
- Corte seco como regla, destello cálido cada 9 planos y dissolve de 700 ms en
  los cambios de capítulo.
- Los gráficos de `motion/` se superponen como hoy (ProRes con alfa).
- Subtítulos documentales (Roboto Condensed, 7 palabras, sin caja), ocultos
  bajo gráficos que ya escriben la frase.

### F6 — Sonido y QC · ~3 días
- Voz a −14,5 LUFS.
- Música por ánimo de capítulo (biblioteca CC BY en R2) con ducking: 20 % del
  nivel, que baja bajo la voz.
- Efectos de sonido sintetizados en la entrada de cada gráfico y capítulo.
- QC del MP4: negro, congelado y LUFS, guardado en el asset.

### F7 — Revisión en el front · ~2–3 días
- Por plano: clase, sujeto, fuente + licencia y veredicto del juez.
- "Regenerar con indicación".
- Copiar créditos y capítulos.
- Informe de QC.

**Motor (F1–F7): ~20–23 días**, unos 7 menos que la v1, porque se reutilizan
el hub, el verificador y el juez.

### F8 — Todos los estilos documentales de MaV sin riesgo legal, como datos · ~18–22 días
Igual que en MaV, cada estilo es un **preset** (JSON validado con Zod, tabla
`video_styles`), no un pipeline nuevo. El motor de F1–F7 lee el preset y ajusta
cada paso.

**Qué define un preset:**

| Bloque | Qué define | Lo usa |
|---|---|---|
| `guion` | Esqueleto narrativo y % por bloque, tono, persona (1ª/2ª/3ª), marcas de capítulo | `generate_script` |
| `plan` | Duración de plano por clase, clases preferidas, presupuesto de gráficos por minuto y % máximo | Montajista + verificador |
| `fuentes` | Orden de la cadena por clase (por ejemplo, archivo antes que stock) y época | Spokes |
| `graficos` | Componentes favoritos y prohibidos de `motion/`, paleta y tipografía | Montajista + render |
| `look` | Gradación, viñeta, capa (old-movie, B/N), movimiento, cadencia de cortes de zoom | Render |
| `transiciones` | Tipo y ritmo (seco, dissolve por capítulo, destello cada N) | Render |
| `subtitulos` | Fuente, tamaño, palabras por línea, mayúsculas, posición | `captions.ts` |
| `sonido` | Ánimo de la música, volumen, ducking, set de efectos | Mezcla |
| `marco` | Capas fijas: banda, dossier, encabezado | Render (`motion/`) |

**Los estilos y lo que necesita cada uno, además del motor:**

| Estilo | Para qué temas | Qué tiene de propio | Pieza extra | Días |
|---|---|---|---|---|
| **Documental** | General, estilo plataforma | Metraje + personas + mapas + titulares, serif crema/dorado | — (es el de referencia del motor) | incluido |
| **Clásico** | Archivo y biografías | Predominan las fotos reales, subtítulos tipo bold | — | 1 |
| **Profundo** | Historia militar, espionaje, aviación, espacio | Archivo antes que stock, marco sobrio, mapas | archive.org con prioridad | 1–2 |
| **Expediente** | Sucesos y misterios | Marco de informe, máquina de escribir, citas, fechas, titulares; transiciones de película | Componentes `expediente_marco` y `documento_maquina` en `motion/` | 2–3 |
| **Nocturno** | Guerra y espías como tráiler | Archivo en B/N de época + escenas "dossier" | Capa B/N con grano + escenas dibujadas con tu **documental animado** (en vez del 3D de MaV) | 3 |
| **Almanaque** | "Quién fue / qué fue" | Formato cromo, metraje sin texto, gradación por plantilla, pocos gráficos (1,2/min) | Componente `ficha_cromo` | 2 |
| **Horizonte** | Demografía y economía | Series y pirámides con **datos reales**; gráficos hasta el 45 % | Tool `fetch_open_data` (Banco Mundial, ONU) + componente `piramide_poblacion` | 3 |
| **Historia** | Imperios y dinastías | Óleos sepia generados con IA, "foto viva", mapas, fechas | Imagen IA con estilo fijo (SnapGen o Flow) + animación de imagen (SnapGen, según P2) | 2–3 |
| **Mapa interactivo** | Geografía, rutas, guerras | El video entero es un mapa animado | Reusar `Ubicacion` / `map_*` de `motion/` como base continua, con el director de mapas en el Montajista | 3 |
| **Locomotoras** (temático: trenes y máquinas) | Ingeniería, transporte, rutas | Plan + plantillas de trenes + mapas de rutas | Componentes `ruta_tren` y `ficha_maquina`; sirve de modelo para estilos temáticos por nicho | 2 |
| **Collage** | Historia y cultura con estética de papel | Recortes de papel, hilo rojo, golpes y desgarros de papel como transición | Capa de textura de papel, transición `golpe_papel` y escenas collage en `motion/` (recortan las fotos con licencia) | 3 |
| **Noticiero** | Actualidad contada como un parte de noticias | Banda de noticias, cronologías y titulares | Componente `banda_noticias`; **sin presentador IA** (avatar, fuera de alcance) y sin capturas de prensa (ver filtro legal) | 2 |

#### Filtro legal: qué entra y qué no
En MaV, varios estilos usan metraje y entrevistas descargados de YouTube. En
Scaler, **todos los estilos usan solo fuentes con licencia**: stock (Pexels,
Pixabay, Coverr), Commons/Openverse (PD, CC0, CC BY, CC BY-SA con crédito),
Wikidata, archive.org (dominio público), datos abiertos e imagen o video IA
propios. Con eso, la mayoría de los estilos de MaV se pueden replicar sin
riesgo. Quedan **afuera**:

| Estilo de MaV | Por qué queda afuera |
|---|---|
| **Leyenda** | Su esencia es la voz real de la persona famosa en **fragmentos de entrevistas de YouTube**: no hay versión con licencia que conserve lo que lo hace distinto |
| **Cancha** | Biografías deportivas armadas con **entrevistas y jugadas** descargadas de YouTube; las imágenes de partidos tienen derechos de ligas y televisión |
| Clases de plano **"metraje de YouTube"** y **"capturas de prensa"** (dentro de cualquier estilo) | Copyright del video y de las fotos de los medios. La clase `pagina` queda limitada a **Wikipedia** (CC BY-SA, con crédito) y sitios oficiales de dominio público |

Otras reglas legales para todos los estilos:
- Créditos automáticos obligatorios para CC BY / CC BY-SA.
- Música solo de la biblioteca con licencia (o IA propia).
- Fotos de personas solo de Commons o Wikidata con licencia libre.
- Licencia comercial de Remotion si el equipo supera las 3 personas.

Orden recomendado después del Documental: **Clásico → Profundo → Expediente →
Horizonte → Locomotoras → Almanaque → Noticiero → Historia → Mapa interactivo
→ Collage → Nocturno** (primero los más baratos sobre el motor; al final los
que necesitan piezas nuevas).

Cada estilo se da por listo cuando: preset validado, un video de prueba de
3 minutos aprobado y una miniatura y un clip de muestra para la galería (F9).

### F9 — UX: "¿Qué video querés hacer?" · ~7–9 días
**Problema de hoy:**
- El formato, las visuales, las transiciones, los subtítulos y la calidad se
  eligen **al final**, en Preview, después del guion y la voz. Pero el estilo
  cambia el guion, la voz, la música y las fuentes.
- Las pestañas Guion / Escenas / Audio / Preview están todas abiertas a la vez,
  sin un orden claro.
- Con 10 estilos, un `<select>` no alcanza para elegir.

**Flujo nuevo de creación (asistente de 4 pasos):**
1. **Elegí el estilo:** galería de tarjetas agrupadas por intención
   ("Historia y guerra", "Misterio y sucesos", "Biografías", "Datos y
   economía", "Geografía"). Cada tarjeta muestra:
   - un clip de muestra que se reproduce al pasar el mouse;
   - "ideal para" y 3 temas de ejemplo;
   - duración típica y costo estimado en créditos.

   Se recomiendan 3 según el canal (nicho del workspace).
2. **Contanos el tema:** campos adaptados al estilo. Leyenda pide la persona,
   Horizonte el país y el indicador, Historia el imperio y la época. Se
   mantienen las opciones de hoy: idea, tema, guion o transcripción.
3. **Voz e idioma:** precargados del canal, con escucha previa.
4. **Resumen y confirmación:** qué se va a generar, cuántos créditos cuesta,
   tiempo estimado y botón "Crear video".

**Espacio del proyecto:**
- Las pestañas pasan a un **stepper** con estado:
  Guion → Voz → Plan de planos → Revisión → Video final.
- Cada paso muestra si está listo, en curso o bloqueado y por qué.
- Las opciones técnicas (transiciones, calidad, subtítulos) quedan en
  **"Avanzado"**, con los valores del estilo por defecto.
- La revisión muestra los planos agrupados por capítulo, con el veredicto del
  juez y acciones claras: aprobar, reemplazar, regenerar con indicación.

**Fundamentos aplicados (para revisar cada pantalla):**

| Principio | Cómo se aplica |
|---|---|
| Visibilidad del estado del sistema (Nielsen 1) | Stepper con estado, progreso por fase del job en lenguaje humano ("Buscando fotos de época, plano 34/120") |
| Coincidencia con el mundo real (2) | Hablar de "estilo", "plano", "capítulo", "créditos"; nunca `visual_source`, `overlay`, `pre_render` |
| Control y libertad (3) | Volver a cualquier paso, deshacer un reemplazo, cambiar de estilo antes de generar el plan |
| Consistencia y estándares (4) | Mismo componente de tarjeta, botones y estados en todo el flujo; mismo vocabulario |
| Prevención de errores (5) | Confirmar antes de gastar créditos; validar el largo del guion según el estilo; deshabilitar el render con planos rechazados, explicando por qué |
| Reconocer antes que recordar (6) | Galería visual con muestras en vez de nombres; el estilo elegido siempre visible arriba |
| Flexibilidad y eficiencia (7) | Estilo por defecto del canal, "repetir último estilo" y atajos para usuarios frecuentes; "Avanzado" para expertos |
| Diseño estético y minimalista (8) | Divulgación progresiva: cada paso muestra solo lo que se decide en ese paso |
| Ayudar a recuperarse de errores (9) | Mensajes con causa y acción ("La cuenta de voz no tiene saldo → Cargar saldo / Usar otra voz") |
| Ayuda y documentación (10) | Ejemplos por estilo, tooltips cortos y un "¿Qué estilo me conviene?" |
| Ley de Hick | Agrupar los 10 estilos en 5 categorías y destacar 3 recomendados |
| Ley de Jakob | Asistente y galería como en las herramientas que el usuario ya conoce |
| Umbral de Doherty | Respuesta visual en menos de 400 ms: esqueletos de carga y actualizaciones optimistas |
| Gestalt (proximidad, región común) | Planos agrupados por capítulo; opciones relacionadas en un mismo bloque |
| Accesibilidad (WCAG 2.2 AA) | Contraste ≥ 4,5:1, navegación por teclado en la galería y el stepper, foco visible, clips con alternativa estática |

**Entregables:**
- Wireframes de las 4 pantallas del asistente y del espacio del proyecto.
- Prueba con 3–5 usuarios: ¿pueden crear un video sin ayuda?
- Implementación sobre el diseño actual (tokens de `index.css`).

**Listo cuando:** un usuario nuevo crea un video de un estilo sin ayuda en
menos de 3 minutos de interacción.

---

## 4b. Calendario total

| Bloque | Días |
|---|---|
| Motor (F1–F7) con el estilo Documental | 20–23 |
| Rediseño de UX (F9), en paralelo desde la semana 3 | 7–9 |
| Resto de los estilos (F8): 12 estilos | 18–22 |
| **Total** | **~45–54 días** (unas 10–11 semanas) |

---

## 5. Preguntas para confirmar mañana

- **P1.** "Que no quede nada de mi funcionalidad": ¿se refiere solo al
  **pipeline de video**? Lo recomendado es conservar auth, workspaces,
  créditos, cola/worker, voz y Whisper, que no son parte del formato.
- **P2.** ¿**SnapGen (video IA)** y **Google Flow** quedan como respaldo para
  planos sin material, o se borran?
- **P3.** El **formato animado** y el **documental animado**, ¿se borran o
  quedan? Comparten agentes y skills; los gráficos de `motion/` quedan en
  cualquier caso.
- **P4.** ¿Fotos **CC BY** con créditos en la descripción? (Recomendado: sí.)
- **P5.** ¿Se confirma **no** usar metraje de YouTube? (Recomendado: no usarlo.)
- **P7.** ¿Se confirma el orden de los estilos de F8, o hay alguno que tu
  canal o tus clientes necesiten antes?
- **P8.** ¿El formato **vertical 9:16** entra en cada estilo desde el
  principio (como en MaV) o queda para después?
- **P6.** ¿El Revisor de candidatos en **Sonnet** (calidad) o **Haiku**
  (costo)? Tu nota dice que con Sonnet el revisor del documental dejaba pasar
  escenas sin sentido; acá juzga fotos reales, que es más fácil.
