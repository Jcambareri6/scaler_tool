# Plan de implementación — Escenas cortas + Stock con contexto global

## Contexto

El cliente pidió que las escenas del video final sean más cortas (más cambios visuales, más retención) y ya escribió dos prompts propios que describen exactamente cómo quiere que funcione:

1. `PROMPT PARA AGRUPAR TIMESTAMPS EN BLOQUES DE ESCENA CORTOS` (`backend/claude/PROMPT PARA AGRUPAR TIMESTAMPS EN BLOQUES DE ESCENA CORTOS_.docx`)
2. `PROMPT PARA BÚSQUEDA DE VIDEO STOCK CON ANÁLISIS DE CONTEXTO GLOBAL` (`backend/claude/PROMPT PARA BÚSQUEDA DE VIDEO STOCK CON ANÁLISIS DE CONTEXTO GLOBAL_.docx`)

Este documento traduce esos dos prompts al código actual: qué cambia, en qué archivos, y qué decisiones de diseño quedan abiertas para confirmar antes de tocar código.

Son **dos cambios independientes** que tocan etapas distintas del pipeline (`orchestrator.ts`):

```
Guion → Voz → Transcripción → [CAMBIO 1: build_scenes] → [CAMBIO 2: stock por escena] → Timeline → Render
```

---

## CAMBIO 1 — Escenas cortas (`build_scenes`)

**✅ Implementado** en `backend/src/tools/buildScenes.tool.ts` (constantes `TARGET_MIN_SECONDS=5` / `MAX_SCENE_SECONDS=12` / `MIN_SCENE_SECONDS=4`, umbral de coma `MIN_COMMA_CLAUSE_WORDS=6`). Probado con un guion de muestra: escenas de 5.4-10.4s, comas de enumeración correctamente ignoradas como corte, texto reconstruido idéntico al original. Falta probarlo contra un proyecto real con transcripción Whisper real antes de darlo por cerrado (ver sección de Verificación).

### Qué pide el cliente

Su prompt está pensado para que un LLM agrupe fragmentos con timestamps de Whisper en bloques, con estas reglas (en orden de prioridad):

1. **Cortar solo en puntos válidos**: `.` `?` `!` `...` `;` `:` (cuando cierra idea antes de enumeración), y `,` **solo** si separa dos frases largas e independientes (no comas de enumeración ni dentro de una idea corta). Nunca cortar si la frase queda sin sentido.
2. **Duración objetivo: 5-10s**, tope absoluto 12s.
3. **Mínimo 4s** — si un corte válido da un bloque de menos de 4s, seguir acumulando hasta el próximo corte válido.
4. **Excepción**: si una oración sola dura más de 12s y no tiene puntos de corte internos válidos, queda como bloque individual sin cortar (regla 1 prioriza sobre regla 2).

### Por qué NO hace falta un LLM para esto

El código actual (`backend/src/tools/buildScenes.tool.ts`) ya resolvió el problema equivalente con el guion viejo (35s target / 60s tope) de forma **100% determinística**: parte el `full_text` en unidades de texto con regex, alinea cada unidad con las palabras transcriptas por Whisper (timestamps reales), y agrupa unidades consecutivas hasta llegar al target sin pasar el tope.

Las reglas del cliente son más finas (más puntos de corte válidos, ventana 5-10s en vez de "hasta 35s", piso de 4s, excepción por oración larga) pero siguen siendo **reglas mecánicas**, no juicio narrativo. Portarlas a código evita:
- Una llamada a IA más por proyecto (costo + latencia + otro punto de falla).
- El riesgo que el propio código actual ya documenta: un LLM "adivinando" cortes puede desalinearse del audio real. Al ser determinístico, la escena SIEMPRE cae exactamente donde el corte de texto elegido coincide con el timestamp real de esa palabra.

### Diseño propuesto

Archivo: `backend/src/tools/buildScenes.tool.ts`

**Constantes nuevas** (reemplazan las actuales):
```ts
const TARGET_MIN_SECONDS = 5;
const TARGET_MAX_SECONDS = 10;
const MAX_SCENE_SECONDS = 12;
const MIN_SCENE_SECONDS = 4;
```

**`splitIntoSentences` → `splitIntoClauses`**: en vez de cortar solo en `.!?`, el regex/lógica de split tiene que reconocer más puntos de corte:
- `.` `?` `!` `...` `;` siempre válidos (terminan una idea sin ambigüedad).
- `:` válido solo si lo que sigue es una enumeración (heurística simple: hay contenido después antes del próximo terminador fuerte).
- `,` — la regla del cliente ("separa dos frases largas e independientes") es un juicio semántico difícil de aproximar 100% con regex. Propuesta: tratar una coma como corte válido únicamente si el fragmento *antes* de la coma tiene al menos N palabras (ej. 6-8) Y el fragmento *después* también — aproxima "dos frases largas" sin necesitar NLP real. Si el fragmento es corto de cualquier lado (enumeración típica: "compró manzanas, peras, uvas"), no corta.

Esto da una lista de "unidades de corte candidatas" en vez de oraciones completas.

**`groupIntoScenes` — nueva lógica de agrupado**:
1. Acumular unidades (ya alineadas a timestamps reales, igual que hoy vía `alignSentencesToWords`, mismo mecanismo).
2. Al llegar a una unidad que termina en un punto de corte válido:
   - Si la duración acumulada del bloque está entre `TARGET_MIN_SECONDS` y `MAX_SCENE_SECONDS` → cerrar bloque ahí.
   - Si está por debajo de `MIN_SCENE_SECONDS` → NO cerrar, seguir acumulando hasta el próximo corte válido (regla 3).
   - Si se pasa de `MAX_SCENE_SECONDS` sin haber encontrado ningún corte válido en el camino (oración larga sin comas/`;`/`:` internos) → cerrar igual ahí, sin cortar mitad de idea (regla 4, excepción).
3. Mismo criterio de "nunca cortar a mitad de una unidad" que ya usa el código actual — se mantiene, solo cambian los umbrales y qué cuenta como punto de corte.

**Lo que NO cambia**: el mecanismo de alinear texto a `TranscribedWord[]` (`alignSentencesToWords`), el manejo del final del último bloque (`audioDurationSeconds`), el reemplazo completo de escenas viejas al regenerar, y el shape de salida (`{ text, timeStart, timeEnd, duration }` en `scenes.content`).

### Impacto en el resto del pipeline (avisar al cliente)

Pasar de ~35s a ~5-10s por escena implica **~4-7x más escenas por video** (ej. un video de 5 minutos: hoy ~9 escenas, con el cambio ~30-45 escenas). Eso multiplica en la misma proporción:
- Llamadas a `generate_stock_keywords` (LLM, mini) y a `search_stock` (Pexels/Pixabay) por video.
- Llamadas a `generate_overlay` por video.
- Si `visual_source = "ai"` o `"mixed"` con fallback: potencialmente más llamadas a `generate_video` (esto es lo más caro del pipeline).
- Tiempo total del pipeline (aunque `SCENE_CONCURRENCY = 4` amortigua parte del impacto).

No es un problema técnico, pero es un cambio de costo/tiempo real que vale confirmar que el cliente entiende y acepta.

### Verificación

- Correr `build_scenes` sobre un guion real ya transcripto (proyecto existente con `timelines.content.words` poblado) y revisar manualmente los bloques resultantes: ¿respetan 5-10s target / 12s tope / 4s piso? ¿algún corte queda con la frase "sin sentido"?
- Caso borde: guion con una oración larga sin puntuación interna (>12s) → confirmar que queda como bloque único sin cortar.
- Caso borde: guion con muchas comas de enumeración cortas → confirmar que no corta ahí.

---

## CAMBIO 2 — Stock con contexto global

### Qué pide el cliente

Su prompt define un flujo de **dos fases obligatorias**:

- **Fase 1 (una sola vez, por video completo)**: analizar el guion agrupado entero y determinar internamente: tema central, género narrativo, época histórica dominante, ubicación geográfica dominante, personajes recurrentes (rasgos genéricos, sin nombres propios), tono visual, paleta conceptual (palabras clave de estilo en inglés). Esto NO se muestra en la respuesta final — es contexto interno para que todas las queries del video sean coherentes entre sí.
- **Fase 2 (por cada bloque/escena)**: generar **exactamente 4 queries en inglés**, de más específica a más amplia (4-6 palabras → 1-3 palabras), todas describiendo la MISMA escena con distinto nivel de precisión, respetando el contexto global de fase 1, sin nombres propios de personas reales, sin repetir queries idénticas entre bloques consecutivos.

### Qué hace hoy el código

- `generateStockKeywords.tool.ts`: corre **por escena, sin contexto global real** (solo un `video_topic` de una línea, más `content_policy`). Devuelve 2-4 keywords sueltas, sin niveles de especificidad ni orden de fallback explícito.
- `searchStock.tool.ts`: recibe `keywords: string[]` y busca **todas en paralelo** contra los providers activos, junta todos los candidatos y los ordena por duración/preferencia. No hay concepto de "probar la más específica primero, bajar de nivel si no hay resultados".
- `orchestrator.ts`: procesa las escenas en paralelo (`SCENE_CONCURRENCY = 4`), cada una totalmente independiente — no hay memoria de qué generó la escena anterior.

### Diseño propuesto

**2.1 — Nueva tool: `generate_visual_context`** (una sola llamada por proyecto, no por escena)

Archivo nuevo: `backend/src/tools/generateVisualContext.tool.ts`

- Input: el `full_text` completo del guion (o el texto concatenado de todas las escenas ya agrupadas).
- Prompt basado en la "Fase 1" del cliente: tema, género, época, ubicación, personajes recurrentes, tono visual, paleta conceptual.
- Output estructurado, ej.:
  ```ts
  interface VisualContext {
    theme: string;
    genre: string;
    era: string;
    location: string;
    recurring_characters: string[];
    visual_tone: string;
    palette_keywords: string[];
  }
  ```
- Se corre **una vez**, en `orchestrator.ts`, después de `build_scenes` (paso 4) y antes del loop de escenas (paso 5-6). Costo: 1 llamada extra por video (barata, mismo modelo mini que hoy usa `generate_stock_keywords`).
- Este `VisualContext` se guarda en memoria durante la corrida del pipeline y se pasa a cada llamada de `generate_stock_keywords` — no hace falta persistirlo en DB salvo que se quiera cachear entre reintentos (a evaluar).

**2.2 — Reescribir `generate_stock_keywords` → devuelve 4 queries por nivel**

- Input nuevo: agrega `visual_context: VisualContext` y, para la regla anti-repetición, `previous_scene_queries?: string[]` (las queries de la escena inmediatamente anterior).
- Output nuevo:
  ```ts
  interface StockQueryTier {
    specific: string;   // 4-6 palabras
    focused: string;    // 3-5 palabras
    intermediate: string; // 2-4 palabras
    broad: string;       // 1-3 palabras
  }
  ```
- Prompt del sistema reescrito siguiendo las reglas del cliente: siempre inglés, siempre filmable (traducir lo abstracto a escena literal o metáfora visual concreta), nombres propios de personas → descripción genérica por época/rol, nombres de lugares → solo si son íconos mundialmente reconocidos, coherencia con `visual_context`, no repetir con `previous_scene_queries`, evitar palabras vacías sin modificador.

**2.3 — Cambio de secuenciación en `orchestrator.ts`**

La regla "no repetir con el bloque adyacente" requiere que la generación de queries conozca el resultado del bloque anterior — esto **no es compatible tal cual con `SCENE_CONCURRENCY = 4` full-parallel** en el paso de keywords.

Propuesta: separar en dos sub-pasos dentro del loop de escenas:
1. **Generación de queries — secuencial** (rápida, es solo texto, no depende de red externa de stock): recorrer las escenas en orden, llamando a `generate_stock_keywords` una por una, pasando siempre las queries de la escena anterior. Esto es liviano porque es solo LLM de texto corto, no búsqueda de stock.
2. **Búsqueda de stock + overlay — paralelo** (como hoy, `mapWithConcurrency` con concurrencia 4): una vez que todas las escenas ya tienen sus 4 queries, el resto del trabajo (buscar en Pexels/Pixabay, elegir clip, generar overlay) puede seguir en paralelo igual que ahora, porque ya no depende de estado compartido entre escenas.

**2.4 — Cascada de búsqueda en `search_stock`**

Pendiente de decisión (ver sección "Decisiones abiertas" abajo), pero la opción fiel al prompt del cliente es:

- `search_stock` (o el caller en `orchestrator.ts`) prueba `specific` primero; si devuelve 0 candidatos (tras filtrar `blocked`/`content_policy`), prueba `focused`; si sigue en 0, `intermediate`; si sigue en 0, `broad`.
- Se detiene en el primer nivel que traiga al menos 1 candidato utilizable.
- Esto cambia la firma de `search_stock` (de `keywords: string[]` a algo consciente de niveles) o se resuelve en el orchestrator llamando a `search_stock` hasta 4 veces en secuencia por escena, cortando apenas hay resultado.

### Impacto / riesgos a tener en cuenta

- Combinado con el Cambio 1 (4-7x más escenas), el Cambio 2 multiplica proporcionalmente las llamadas a OpenAI para keywords — sigue siendo modelo mini y texto corto, costo bajo por llamada, pero el volumen total sube.
- La cascada de búsqueda (2.4) puede en el caso feliz **reducir** llamadas a Pexels/Pixabay vs. hoy (hoy busca con todas las keywords siempre; con cascada, para si la query 1 ya trae resultados) — probablemente compensa parte del aumento de volumen del Cambio 1.
- Separar "generación de queries" en secuencial (2.3) agrega algo de tiempo lineal al pipeline (antes de la parte paralela), pero al ser solo llamadas de texto corto el impacto debería ser menor a un par de segundos por escena.

### Verificación

- Correr el pipeline completo en un proyecto de prueba y revisar manualmente: ¿las 4 queries de una escena describen la misma escena con distinto nivel de detalle? ¿son coherentes con época/ubicación del resto del video? ¿alguna escena repite exactamente una query de la anterior?
- Caso borde: escena con concepto abstracto ("todo cambió para siempre") → confirmar que las queries resultantes son visuales/filmables, no literales del texto.
- Caso borde: escena que menciona una persona real (ej. un científico histórico) → confirmar que las queries usan descripción genérica, no el nombre propio.

---

## Decisiones abiertas (a confirmar antes de codear)

1. **Orden de implementación**: ¿Cambio 1 (escenas) primero y se prueba solo, o los dos cambios juntos en la misma tanda?
2. **Cascada de `search_stock` (2.4)**: ¿cascada real (parar en la primera query con resultados) o buscar las 4 en paralelo y priorizar por nivel al ordenar? La cascada es más fiel al prompt del cliente y probablemente más barata en llamadas a stock; la alternativa es un cambio de código más chico.
3. **Umbral de "comas largas" en el split de escenas (Cambio 1)**: ¿cuántas palabras mínimo de cada lado de una coma para considerarla corte válido? Propuesta inicial: 6-8 palabras de cada lado — a ajustar si en la prueba real corta mal.
4. **¿El `VisualContext` (2.1) se persiste en DB (ej. columna nueva en `video_projects` o `scripts`) o alcanza con mantenerlo en memoria durante la corrida del pipeline?** Persistirlo permitiría reusarlo si se re-corre solo el paso de escenas sin regenerar todo, pero agrega una migración.
