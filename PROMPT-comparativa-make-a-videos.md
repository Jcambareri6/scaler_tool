# Prompt 4D: comparativa Scaler Tool vs. Make a Videos

> Cómo usarlo: abrí el agente local en la carpeta de **Make a Videos**, adjuntale
> `INFORME-arquitectura-y-proveedores.md` y pegale todo lo que está dentro del
> bloque de abajo.

````text
# 1. DELEGACIÓN: qué te pido y qué no

Sos un arquitecto de software y analista de producto especializado en
herramientas de generación automática de video (videos largos narrados estilo
YouTube "faceless" y documental).

Tenés dos fuentes:
- A) **Make a Videos**: la aplicación de la competencia, que está en esta
  carpeta local. Esta es la que tenés que investigar a fondo, leyendo el código.
- B) **Scaler Tool**: mi aplicación. NO tenés su código: solo el informe
  adjunto `INFORME-arquitectura-y-proveedores.md`. Tomá ese informe como la
  verdad sobre Scaler Tool.

Tu tarea:
1. Recorrer el código de Make a Videos y entender su arquitectura, sus
   proveedores, su pipeline, cómo guarda los videos y, sobre todo, qué
   **formatos de video** produce.
2. Compararla con Scaler Tool punto por punto.
3. Hacer la lista de **lo que le falta a Scaler Tool** (o lo que hace peor),
   con foco principal en el **formato documental**.
4. Proponer una **priorización** de esas mejoras.

Fuera de alcance: no modifiques ningún archivo de Make a Videos, no ejecutes
renders que cuesten dinero ni llames a APIs pagas, y no escribas código de
implementación. Solo análisis e informe.

# 2. DESCRIPCIÓN: contexto, qué buscar y formato de salida

## Contexto de Scaler Tool (está ampliado en el informe adjunto)
- Pipeline: guion (Claude/GPT) → voz (ai33.pro / Edge TTS / audio propio) →
  Whisper con tiempos por palabra → escenas de 4 a 12 s → visuales → gráficos
  animados → revisión humana → render con FFmpeg/Remotion.
- Formatos actuales: `stock` (clips de stock o de IA + gráficos animados
  opcionales) y `animated` (todo dibujado con Remotion, con un modo
  **documental**: un director con agentes Claude, dibujantes, un verificador
  en código y un revisor visual sobre capturas). El modo animado/documental
  hoy está limitado a administradores.
- Fuentes visuales: stock (Pexels, Pixabay, Coverr, Wikimedia), mixto, video
  IA (SnapGen: Veo 3.1 / Seedance 2), imagen IA con Ken Burns, Google Flow
  (extensión) y subida manual.
- Salida: MP4 H.264, 720p/1080p, **solo 16:9**, 30 fps. Transiciones fade,
  subtítulos palabra por palabra, 31 componentes de gráficos, 21 nichos con
  paletas.
- Limitaciones conocidas: los clips de stock y de IA no se copian a storage
  propio, no hay formato vertical y lo avanzado es solo para admins.

## Qué investigar en Make a Videos (en este orden de importancia)
1. **Formatos de video**: cada formato o plantilla que ofrece (documental,
   explicativo, listas/top, historia narrada, slideshow, shorts verticales,
   podcast/talking head, etc.). Para cada uno: estructura narrativa, cómo arma
   las escenas, qué tipo de visual usa, ritmo/duración de escena, relación de
   aspecto, resolución, fps, códec.
2. **Formato documental en detalle**: cómo lo resuelve. Guion (estructura,
   capítulos, hooks), material de archivo (imágenes históricas, mapas, fechas,
   personajes), movimiento de cámara sobre imágenes (Ken Burns, parallax, 2.5D),
   gráficos de datos, líneas de tiempo, mapas, títulos de capítulo, lower
   thirds, citas, música de fondo y ducking, efectos de sonido, color grading,
   transiciones, subtítulos y estilo visual coherente.
3. **Audio**: voces (proveedores, clonación, idiomas), música, SFX, mezcla,
   normalización de volumen.
4. **Visuales y proveedores**: stock, generación de imagen/video con IA,
   búsqueda de imágenes de archivo, cómo elige y cómo valida relevancia.
5. **Sincronización**: tiempos por palabra, por frase o estimados.
6. **Almacenamiento**: dónde y cómo guarda audio, clips y render final (copia
   o referencia, carpetas, nombres, formato).
7. **Arquitectura y ejecución**: stack, cola/workers, concurrencia,
   reintentos, costos, edición manual o revisión antes del render, plantillas
   editables, exportación (proyecto editable, SRT, capas, etc.).

## Formato de salida (obligatorio)
Devolvé **un solo archivo Markdown** llamado
`COMPARATIVA-ScalerTool-vs-MakeAVideos.md`, en español, con exactamente estas
secciones:

0. **Resumen ejecutivo** (máx. 10 líneas): en qué gana cada uno y las 5
   brechas más importantes de Scaler Tool.
1. **Ficha de Make a Videos**: stack, arquitectura (diagrama ASCII simple),
   pipeline paso a paso, proveedores (tabla: proveedor | uso | modelo/endpoint
   | archivo donde está) y almacenamiento de videos (tabla con el mismo
   formato que la sección 5.2 del informe de Scaler).
2. **Catálogo de formatos de Make a Videos**: una tabla con todos los formatos
   (formato | descripción | visuales | duración de escena | relación de aspecto
   | resolución | archivo/s fuente), y después una ficha por formato.
3. **Comparativa punto por punto**: tabla con las columnas
   `Dimensión | Scaler Tool | Make a Videos | Ganador | Evidencia (archivo:línea)`.
   Cubrí como mínimo: guion, voz, música/SFX, sincronización, escenas,
   visuales, IA de imagen/video, gráficos animados, subtítulos, transiciones,
   formatos, relación de aspecto, resolución, render, almacenamiento, cola y
   escalado, revisión humana, multiusuario/créditos, costos.
4. **Formato documental a fondo**: cómo lo hace Make a Videos, cómo lo hace
   Scaler Tool, diferencias concretas y qué técnicas o recursos visuales
   conviene copiar o adaptar.
5. **Brechas de Scaler Tool**: una entrada por brecha con este formato fijo:
   ```
   ### GAP-XX — <título corto>
   - Categoría: Formato | Documental | Audio | Visual | Render | Infra | UX
   - Qué tiene Make a Videos: …
   - Qué tiene hoy Scaler Tool: …
   - Por qué importa (impacto en el video final o en el negocio): …
   - Evidencia: <archivo:línea en Make a Videos>
   - Impacto: Alto/Medio/Bajo · Esfuerzo estimado: S/M/L · Confianza: Alta/Media/Baja
   - Idea de implementación en Scaler Tool (2-4 líneas, apoyada en la arquitectura del informe: qué tool, módulo o tabla tocaría)
   ```
6. **Priorización**: tabla ordenada (Prioridad | GAP | Impacto | Esfuerzo |
   Motivo), primero lo de mayor impacto y menor esfuerzo, con el formato
   documental antes que el resto cuando estén empatados. Agrupá en
   **Ahora / Siguiente / Después**.
7. **Lo que Scaler Tool hace mejor** (para no perderlo al copiar).
8. **Preguntas abiertas y supuestos**: todo lo que no pudiste confirmar.

Estilo: claro y concreto, tablas antes que párrafos largos, sin relleno de
marketing. Tiene que poder leerlo una persona y también procesarlo otro
agente de IA (por eso los IDs GAP-XX y los campos fijos).

# 3. DISCERNIMIENTO: cómo validar lo que afirmás

- Cada afirmación sobre Make a Videos tiene que tener **evidencia**: ruta de
  archivo y línea (o nombre de función/config). Si no la encontrás en el
  código, marcala como **"No verificado"** y explicá por qué lo suponés.
- Distinguí siempre entre lo que **está implementado** y lo que solo aparece
  en el README, en comentarios, en código muerto o en TODOs.
- No inventes proveedores, modelos ni formatos. Si algo existe solo como
  opción de configuración sin uso real, aclaralo.
- Para Scaler Tool, no contradigas el informe adjunto. Si algo del informe
  parece incompleto para comparar, anotalo en "Preguntas abiertas" en vez de
  suponer.
- Antes de entregar, revisá: ¿cada GAP tiene evidencia? ¿La prioridad es
  coherente con el impacto y el esfuerzo? ¿El formato documental quedó
  cubierto en la sección 4 y en los primeros puestos de la sección 6 cuando
  corresponde?

# 4. DILIGENCIA: responsabilidad y transparencia

- No copies en el informe ningún secreto que encuentres (API keys, tokens,
  .env, credenciales, emails de usuarios). Si hay, mencioná solo que existen.
- No copies bloques largos del código de la competencia: alcanza con
  resumirlos y citar la ruta.
- Indicá al final, en una línea, qué carpetas/archivos revisaste y cuáles no
  pudiste revisar.
- Si el alcance es demasiado grande, priorizá formatos y documental, y dejá
  explícito qué quedó sin analizar.
````
