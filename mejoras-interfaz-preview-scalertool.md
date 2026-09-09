# Mejoras a la interfaz de Preview de ScalerTool

> Documento de concepto — Fase 1. No incluye diffs ni referencias a código real de ScalerTool: es una propuesta de UX/UI a validar antes de tocar el repositorio.

## 1. Diagnóstico del problema actual

La pantalla de Preview de ScalerTool intenta seguir el lenguaje visual de editores tipo CapCut (player grande arriba, filmstrip abajo), pero la implementación actual rompe varias convenciones que hacen que ese lenguaje funcione en los editores de referencia. Concretamente:

**El filmstrip horizontal mezcla dos tipos de contenido con semántica distinta.** Hoy las miniaturas representan tanto clips de video como imágenes fijas, pero cada una tiene una duración diferente y un origen diferente (un frame de video vs. una imagen estática asignada a una escena completa). Al ponerlas una al lado de la otra en una tira continua, el usuario no tiene forma de distinguir a simple vista "esto es un clip de 4 segundos" de "esto es una imagen que dura 6 segundos en pantalla". El filmstrip horizontal funciona bien en editores de edición manual cuadro a cuadro (Premiere, CapCut mobile) porque ahí la unidad de trabajo es el tiempo; en un editor de video generado por escenas, la unidad de trabajo es la escena, no el frame. Usar una metáfora de timeline continuo para un contenido que en realidad es una secuencia discreta de bloques (escenas) es un desajuste conceptual, no solo visual.

**Hay desfasaje entre el player grande y el filmstrip.** Cuando el usuario reproduce el video o hace scrubbing, no queda claro qué miniatura del filmstrip corresponde al frame que se está viendo arriba, sobre todo porque las miniaturas tienen anchos proporcionales a duraciones distintas y no hay (o no es evidente) un indicador de escena activa sincronizado en tiempo real. Esto obliga al usuario a hacer el mapeo mental "estoy en el segundo 14, ¿eso es la escena 3 o la 4?" en lugar de que la interfaz se lo muestre directamente.

**El desfasaje entre escena y audio es, en la práctica, el punto de mayor fricción reportado.** Este es un problema de validación con usuario real, no solo una hipótesis de diseño: al probar la pantalla actual con un cliente, la confusión concreta que surgió fue no poder ubicar qué escena corresponde a lo que se está escuchando en un momento dado del audio. Como el filmstrip codifica la duración de cada escena como ancho de miniatura y el waveform corre por debajo como una pista continua separada, el usuario tiene que correlacionar mentalmente dos representaciones visuales distintas (ancho de miniatura vs. posición en el waveform) para saber "el audio que estoy escuchando ahora, ¿a qué escena pertenece". Es razonable asumir que un usuario sin el contexto de quien construyó la herramienta se va a confundir más, no menos, lo cual convierte este punto en el de mayor prioridad a resolver en la propuesta.

**No existe una vía clara de edición granular.** El único control de corrección visible es "Regenerar todo", que descarta el trabajo de generación de todas las escenas para corregir el problema de una sola. Esto es costoso en tiempo, en cómputo (si hay generación por IA de por medio) y en control percibido por el usuario: si el clip de la escena 5 no representa bien el guion, hoy no hay un punto de interacción evidente para decir "cambiá solo este clip".

**La información contextual de cada escena no está visible junto al clip.** El fragmento de guion que corresponde a cada escena, que es la referencia que el usuario necesita para juzgar si el clip elegido es correcto, no aparece junto a la miniatura. El usuario tiene que sostener en la cabeza qué dice el guion en ese tramo o volver a la tab "Script" para chequearlo, rompiendo el flujo de revisión.

**El filmstrip compite por espacio con el waveform de audio.** Al compartir la franja inferior, ambos elementos terminan comprimidos, y el waveform —que debería servir para juzgar el ritmo y los cortes de audio a nivel global— pierde utilidad cuando tiene que convivir con miniaturas de escena en la misma zona visual.

En conjunto, estos puntos describen un problema de jerarquía de información: la pantalla trata a la escena (la unidad real de edición en este producto) como si fuera un fragmento de timeline continuo, cuando en realidad el usuario necesita pensar y actuar "por escena".

## 2. Convención de la industria (research)

En el segmento de editores de video generados a partir de guion o texto —con selección automática de clips de stock o generación de imágenes/video por IA—, se consolidó un patrón de interfaz que se aparta deliberadamente del filmstrip horizontal clásico de edición manual. Herramientas como Pictory, InVideo AI, Vizard, Fliki y Descript (en su modo de edición basada en guion, no en su modo de forma de onda) organizan la pantalla de revisión así: el player de previsualización ocupa la posición central o superior, y a su lado —normalmente a la derecha— hay un panel vertical con una fila por escena o por bloque de guion. También mencionás haber visto una herramienta, posiblemente llamada "GoClip", que sigue este mismo esquema; no tengo forma de verificar detalles específicos de esa herramienta puntual, así que la tomo como una referencia más dentro de este patrón general y no como fuente de datos verificados.

Cada fila de ese panel suele combinar tres piezas de información que en ScalerTool hoy están separadas o ausentes: el texto del guion correspondiente a esa escena, la miniatura del recurso visual asignado, y metadatos de duración/estado. Esto convierte al panel en una suerte de "tabla de contenidos" navegable del video, en lugar de una tira de frames.

La razón por la que este patrón resuelve mejor el problema de sincronización que un filmstrip horizontal continuo es estructural, no estética: al modelar la interfaz como una lista de bloques discretos (uno por escena) en lugar de una línea de tiempo continua, cada fila puede mapear 1:1 con una escena real del guion, sin necesidad de codificar la duración como ancho proporcional de una miniatura. La sincronización deja de requerir que el usuario calcule "en qué punto de una tira continua estoy": alcanza con resaltar la fila correspondiente al timestamp actual del player, igual que un lector de PDF resalta el capítulo activo en un índice lateral mientras se hace scroll, en lugar de mostrar una regla de páginas donde cada página tiene un ancho distinto según su longitud. Además, al ser una lista vertical con filas de altura uniforme (o cuasi uniforme), el patrón escala mejor cuando el número de escenas crece: un filmstrip horizontal con 30 escenas de duración variable se vuelve angosto e ilegible, mientras que una lista vertical simplemente scrollea, que es una interacción mucho más familiar para revisar contenido secuencial.

Un beneficio secundario, pero relevante para ScalerTool, es que este patrón separa naturalmente dos preocupaciones que hoy están mezcladas en el filmstrip: la identidad de la escena (qué dice, qué clip tiene, si está bien o mal) y la posición temporal global del video (en qué segundo estoy, cómo se ve el ritmo de audio). La primera vive en el panel de escenas; la segunda, en una barra de scrubbing/waveform separada, típicamente más angosta y sin pretender también funcionar como selector de contenido.

## 3. Propuesta de UI/UX para ScalerTool

### Layout general

El player grande se mantiene en su posición actual, arriba/centro, con el label "Escena N · mm:ss-mm:ss" tal como existe hoy: ese elemento ya cumple bien su función y no hay motivo para tocarlo. El cambio principal es liberar el ancho completo de la pantalla para dos columnas: el player a la izquierda (o centro) y, a la derecha, un panel vertical de escenas con scroll propio, del ancho suficiente para mostrar thumbnail, duración y un fragmento de texto sin truncarse agresivamente (un ancho de referencia a validar con diseño visual sería del orden de 320–380px, pero esto es un supuesto a ajustar en fase 2 según el resto del sistema de diseño de ScalerTool).

La barra inferior no desaparece, pero cambia de responsabilidad: pasa a ser una barra de scrubbing temporal global con el waveform de audio corrido de punta a punta, sin miniaturas de escena superpuestas. Puede incluir marcadores discretos (líneas verticales delgadas) que indiquen dónde empieza cada escena sobre el waveform, como referencia visual liviana, pero sin duplicar la función del panel derecho. Los controles existentes (tiempo actual/total, "Regenerar todo", "Aprobar y renderizar") se mantienen en su franja actual entre el player y la barra de scrubbing.

### Anatomía de cada fila de escena en el panel derecho

Cada fila representa una escena y contiene, de forma consistente:

- Un indicador numérico de escena (el mismo número que ya se usa en el label del player), alineado a la izquierda.
- Un thumbnail del clip o imagen asignado, de tamaño fijo independientemente de la duración real de la escena (a diferencia del filmstrip actual, donde el ancho de la miniatura variaba según duración).
- La duración de la escena en formato mm:ss o segundos, como texto corto junto al thumbnail.
- Un fragmento del guion correspondiente a esa escena, truncado a dos o tres líneas con posibilidad de expandirse o ver completo (por ejemplo al hacer hover o click en el texto).
- Un indicador de estado visual superpuesto al thumbnail o junto a él, que cubre al menos estos casos: escena cargando (spinner o skeleton mientras se genera o busca el clip), escena con error (ícono de alerta, por ejemplo cuando la búsqueda de stock no encontró resultados o la generación falló), y escena regenerando (spinner con un estado visualmente distinto al de "cargando inicial", para que el usuario entienda que está en proceso de reemplazo, no de primera carga).

### Interacción de reemplazo de clip

El flujo queda en dos pasos, no uno. Primero, el click es sobre la fila de la escena en el panel derecho (no directamente sobre un botón de reemplazo): ese click selecciona la escena, el player de la izquierda salta a ese punto y renderiza/reproduce esa escena puntual, y la fila queda marcada como activa. Segundo, una vez que la escena está seleccionada, aparece un botón "Reemplazar" asociado a esa escena (ya sea en la fila misma o junto al player, a definir en fase 2 según qué se lea mejor), y es ese botón el que abre el modal de reemplazo — el thumbnail o la fila en sí no abren el modal directamente, para no pisar la acción principal de "ver esta escena". Se definió modal (no dropdown ni panel lateral) porque las opciones de reemplazo necesitan espacio para mostrar una grilla de resultados de búsqueda de stock.

Dentro de ese modal, las opciones a contemplar son:

- Buscar otro clip o imagen de stock, reutilizando el mismo criterio de búsqueda que ya usa ScalerTool en la generación automática, pero permitiendo al usuario ajustar el término de búsqueda o navegar más resultados.
- Subir un recurso propio (imagen o clip de video) para esa escena puntual.
- Regenerar con video de IA, como una tercera vía distinta a la búsqueda de stock (esto es un supuesto a confirmar en fase 2: no sé si hoy existe generación de video por IA en ScalerTool o si es una capacidad nueva a incorporar junto con este rediseño).

Las tres opciones conviven como pestañas o secciones dentro del mismo modal, de forma que el usuario elige la vía sin tener que cerrar y volver a abrir el flujo.

En cualquiera de los tres casos, la operación debe quedar acotada a esa escena: el resto del video no se recalcula ni se vuelve a renderizar, y el botón "Regenerar todo" queda reservado para el caso en que el usuario efectivamente quiera descartar y rehacer la selección completa (por ejemplo, si cambió el guion de forma sustancial).

### Sincronización player ↔ panel

La fila correspondiente a la escena que se está reproduciendo en el player se resalta visualmente (por ejemplo con un borde de color o un fondo distinto), de forma análoga al label "Escena N" que ya existe sobre el player. Al hacer click en cualquier fila del panel, el player salta directamente al inicio de esa escena y comienza a reproducir (o queda pausado en el primer frame, a definir según el comportamiento actual del player ante un seek manual).

Durante la reproducción continua, a medida que el playhead cruza el límite entre una escena y la siguiente, el resaltado se mueve de una fila a la siguiente automáticamente, y el panel hace scroll automático si es necesario para mantener la fila activa visible (comportamiento equivalente a un reproductor de música con lista de temas, donde el tema que suena queda siempre visible en la lista aunque el usuario no haya tocado nada).

### Estados y casos borde

- **Escena sin clip asignado:** el thumbnail se reemplaza por un placeholder claramente distinto (por ejemplo un ícono de "agregar" o "sin contenido"), y el click sobre esa fila lleva directamente al flujo de selección de clip en lugar de a un reemplazo, ya que no hay nada que reemplazar todavía.
- **Clip fallido:** se muestra el estado de error descrito en la anatomía de fila, con un mensaje breve si el sistema tiene información del motivo (por ejemplo "no se encontraron resultados para esta búsqueda"), y un acceso directo a reintentar o buscar manualmente.
- **Reordenar escenas (drag and drop):** si ScalerTool permite cambiar el orden narrativo de las escenas, el panel vertical es un lugar natural para esa interacción (arrastrar una fila a otra posición), mucho más que un filmstrip horizontal donde reordenar implica arrastrar sobre un eje que también representa tiempo. Esto es una funcionalidad a confirmar si existe o se planea para ScalerTool; si no existe, se puede dejar fuera del alcance inicial y evaluarse como mejora futura.
- **Escenas de distinta duración:** al usar filas de altura uniforme en el panel (en lugar de ancho proporcional a duración como en el filmstrip), la duración deja de afectar el layout y se comunica solo mediante el texto de duración, evitando que escenas muy cortas se vuelvan ilegibles o escenas muy largas dominen el espacio visual.

### Qué mantener y qué descartar

Se mantiene: la posición y comportamiento del player grande, el label "Escena N · mm:ss-mm:ss" sobre el player, la barra de controles con tiempo actual/total y los botones "Regenerar todo" y "Aprobar y renderizar", y el waveform de audio como referencia de ritmo global (aunque reubicado/simplificado en la barra inferior).

Se descarta: el filmstrip horizontal como selector principal de escena y como contenedor mixto de miniaturas de duración variable. Su función de "ver todas las escenas de un vistazo" pasa a cumplirla el panel vertical derecho, que además agrega la información de guion y estado que el filmstrip no tenía espacio para mostrar.

## 4. Plan de implementación por fases (alto nivel)

### Fase A — Wireframe/prototipo de la nueva estructura

Definir, de forma agnóstica al framework, los componentes conceptuales que va a necesitar la nueva pantalla:

- `ScenePanel`: contenedor del panel vertical derecho, responsable del scroll y del auto-scroll hacia la fila activa.
- `SceneRow`: una fila individual del panel, responsable de mostrar thumbnail, duración, texto y estado, y de emitir el evento de click tanto para "saltar a esta escena" como para "abrir reemplazo".
- `ClipReplacePicker`: el punto de entrada de reemplazo (modal o panel lateral) con sus tres modos (buscar stock, subir propio, regenerar con IA).
- `PlayerSync`: la lógica (no necesariamente un componente visual) que mantiene sincronizados el timestamp del player, la escena activa y el resaltado/scroll del `ScenePanel`.
- `TimelineScrubber`: la barra inferior simplificada, con el waveform y los marcadores de límite de escena.

En esta fase el entregable es un wireframe navegable o estático (Figma, o incluso HTML/CSS de referencia) que permita validar el layout y la interacción antes de tocar código real.

### Fase B — Relevamiento del código actual

Una vez con acceso al repositorio, hay que auditar puntualmente: qué componente renderiza hoy el filmstrip y de dónde saca los datos de duración/thumbnail por escena; cómo está implementada la sincronización actual entre el playhead del player y el label "Escena N" (esa lógica probablemente sea reutilizable para el nuevo `PlayerSync`, ya que el problema de "saber en qué escena estoy" ya está resuelto ahí, solo hay que exponerlo al nuevo panel); qué estructura de datos representa una escena en el estado de la aplicación (si ya incluye el texto de guion asociado o si hay que cruzarlo con la tab "Script"); y cómo está implementado hoy el flujo de "Regenerar todo", para entender si su lógica de backend puede parametrizarse a nivel de una sola escena o si requiere un endpoint/flujo nuevo.

### Fase C — Implementación incremental sugerida

Se recomienda no migrar todo de una vez, sino en este orden: primero construir el `ScenePanel` en modo solo lectura, conviviendo con el filmstrip actual (o reemplazándolo directamente si el equipo prefiere no mantener dos UIs en paralelo), únicamente mostrando thumbnail, duración y texto por escena, sin interacción de reemplazo todavía. Segundo, agregar la interacción de reemplazo (`ClipReplacePicker`) sobre ese panel ya funcional, empezando por el caso más simple (buscar otro clip de stock) antes que subir archivo propio o regenerar con IA, que probablemente tengan más dependencias de backend. Tercero, migrar y pulir la sincronización bidireccional completa (`PlayerSync`) entre player y panel, incluyendo el auto-scroll durante reproducción continua, que es la parte más sensible a bugs de timing y la que más conviene dejar para cuando el resto de la estructura ya esté estable.

### Riesgos y trade-offs

Un riesgo de adopción es que usuarios ya acostumbrados al filmstrip horizontal actual tengan que reaprender dónde está la información; esto se mitiga si el cambio se percibe como una mejora clara (más información visible, menos clicks para corregir algo) y no como un reacomodo cosmético. Un riesgo técnico es el comportamiento del panel con videos de muchas escenas: hay que decidir si el scroll es infinito/virtualizado o si hay paginación, sobre todo si el número de escenas puede ser alto (esto depende del uso real de ScalerTool, que no conozco en detalle). Por último, el layout de dos columnas (player + panel lateral) es más exigente en pantallas angostas: en mobile o ventanas chicas probablemente el panel de escenas tenga que colapsar a una vista apilada debajo del player en lugar de al costado, lo cual hay que diseñar explícitamente y no asumir que "se acomoda solo" con CSS responsive genérico.

## 5. Próximos pasos

Para pasar de este documento de concepto a una fase de implementación real, sería necesario contar con: acceso al repositorio de ScalerTool (frontend, y backend en la medida en que afecte a los endpoints de generación/reemplazo por escena); el stack técnico del frontend (framework, librería de componentes o design system existente, manejo de estado); la estructura de datos actual de una escena (qué campos tiene, si ya incluye el texto de guion asociado o hay que resolverlo); el estado actual de la lógica de sincronización player-escena, para saber cuánto es reutilizable; y confirmación sobre si existe o está planeada la generación de clips/imágenes por IA (más allá de la búsqueda de stock), ya que eso determina si la opción "regenerar con IA solo esta escena" es viable de entrada o queda para una iteración posterior.
