# Director de gráficos animados — diseño

Exportado del documento de diseño (claude.ai) el 30/10/2026 · fuente: https://claude.ai/artifact/G36L1RZ3CxCXZTxyFc3SPk

## Resumen

Vamos a reemplazar el planificador actual por un **director con IA** que entienda el guion entero y decida los gráficos como un editor, y a sumar un **modo todo animado** que casi nadie ofrece en español.

Son **dos formatos de video distintos**, que se eligen por proyecto:

| Formato | Base del video | Referencias | Quién lo usa |
| --- | --- | --- | --- |
| Stock con gráficos animados | Stock o imágenes con gráficos y mapas encima | MAGNITUD, Cómo Funciona El Mundo, El Niño | Solo admins, mientras está en prueba |
| Todo animado | Escenas animadas, sin stock | Ciencia y Vida | Solo admins, mientras está en prueba |

Los dos formatos se restringen igual que hoy el video con IA: la opción solo aparece para admins en la plataforma y el backend lo vuelve a chequear al generar. Se abren al resto de los usuarios cuando pasen la etapa de prueba.

- **Director:** un agente central lee la estructura (gancho, capítulos, clímax, cierre), decide qué mostrar en cada momento y reparte el trabajo a diseñadores por capítulo que trabajan en paralelo. Un verificador de código controla todo antes del render.
- **Lenguaje abierto:** los 15 componentes pasan a ser recetas armadas con piezas más chicas; cada recurso tiene una ficha que dice cuándo usarlo, con qué intensidad y cada cuánto se puede repetir.
- **Textos:** el director puede escribir títulos y frases propias; cifras, nombres y fechas siempre salen del guion y se verifican con código.
- **Modo todo animado:** escenas que se arman frase por frase con actores ilustrados, instrumentos (velocímetros, relojes, contadores) y una capa fija de navegación, como Ciencia y Vida. En español no hay canales así de psicología, animales, salud ni finanzas personales.
- **Render:** el worker actual (Ryzen 7, 16 GB) alcanza; el desafío es la calidad visual, no la potencia.

Plan en orden:

1. Cerrar este diseño y escribir las fichas de uso.
2. Juntar 8 a 10 guiones reales de nichos distintos para probar.
3. Prototipo del director en Claude Platform (Managed Agents), sin tocar el pipeline.
4. Compararlo con el planificador actual y quedarse con el que gane.
5. Base del modo todo animado: escenas, capa fija y subtítulos palabra por palabra.
6. Actores e instrumentos para dos nichos piloto (propuesta: psicología y animales).
7. Recetas nuevas de los videos analizados.
8. Mapas y diagramas.

## Objetivo y principios

Queremos un director de gráficos que decida como un editor humano: que entienda la estructura del guion, elija qué mostrar y cuándo, y pueda diseñar tratamientos nuevos en lugar de rellenar siempre los mismos 15 componentes. Este documento es el diseño previo; no se implementa nada hasta cerrarlo.

Principios:

- **Intención antes que componente.** Primero se decide qué tiene que sentir o entender el espectador en cada momento; el tratamiento visual sale de ahí.
- **Lenguaje abierto, no catálogo cerrado.** Los componentes actuales pasan a ser recetas armadas con piezas más chicas que se pueden combinar de otras formas.
- **Variedad con criterio.** Cada recurso sabe dónde funciona y dónde no, y el director evita repetirse dentro de un video y entre videos del mismo canal.
- **Cualquier nicho.** Nada del diseño depende del tema; el nicho cambia el estilo y la frecuencia de cada recurso.
- **Datos intocables.** El director puede escribir textos propios, pero cifras, nombres y hechos salen del guion y se verifican con código.
- **Medir antes de cambiar.** Toda versión nueva se compara contra la actual con guiones reales antes de reemplazarla.

## Lo que aprendimos de las referencias

Los tres videos analizados (MAGNITUD "¿Qué pasaría si la Tierra dejara de girar?", el del terremoto del Tíbet y el del Sol que se apaga) no ponen gráficos donde hay números: los ponen donde el guion cambia de intención. El mismo dato puede ir como cifra, como comparación o como reloj según qué quiere provocar el narrador.

| Intención del guion | Cómo lo resolvieron | Lo que se puede mejorar |
| --- | --- | --- |
| Impactar con una magnitud | "+1.000 km/h" grande, unidad en acento, bajada corta | Mostrar la fuente cuando la hay |
| Comparar lugares o cosas | Columnas que aparecen de a una al nombrar cada ciudad | Sincronía automática con la voz |
| Poner algo en perspectiva | "Huracán 345 vs frenazo 1.670" + "Cuatro o cinco veces más rápido" | Elegir la analogía más clara para la audiencia |
| Marcar el paso del tiempo | Reloj "TIEMPO DESDE EL APAGÓN" + planetas que se apagan en una línea | Usarlo como estado que persiste varias escenas |
| Situar en un lugar y momento | "Tibet, 22 de octubre, 22:33" a máquina; mapa con retícula, "≈ 400 km de Lhasa" | Mapas reales generados, no hechos a mano |
| Explicar un mecanismo | Corte corteza/manto/raíz con medidas; sismógrafo que crece | Diagramas parametrizables, no uno por video |
| Cambiar de acto | Tarjeta "CAPÍTULO 03" + tag fijo + barra de progreso | Que la estructura la detecte el director, no el editor |
| Remarcar una idea | "EXTINCIÓN EN HORAS." con la palabra clave en acento | Textos propios verificados contra el guion |
| Sostener la atención | Subtítulos con palabra clave en color | Elegir la palabra clave por significado |

Todos comparten un sistema visual chico y consistente: sin cajas, dos o tres tipografías con roles fijos, un color de acento y el fondo oscurecido cuando entra un gráfico. La variedad sale de cómo combinan esas piezas, no de tener muchos componentes.

## De componentes cerrados a un lenguaje visual abierto

La propuesta es dejar de pensar en 15 componentes y pensar en tres niveles: **piezas**, **recetas** y **composiciones libres**. Los 15 componentes actuales no se pierden: pasan a ser las recetas probadas del segundo nivel.

1. **Piezas (primitivas).** Lo mínimo que se puede animar:
   - Texto con rol: bajada, título, cifra, cuerpo, etiqueta.
   - Número vivo: contador, reloj, cuenta regresiva.
   - Forma de dato: barra, columna, punto, línea, anillo, ícono repetido.
   - Marca: pin, retícula, flecha, subrayado, tachado, resaltado.
   - Foco: fondo oscurecido, desenfoque, viñeta, pantalla dividida, recorte de la imagen.
   - Estado persistente: dato en esquina, tag de capítulo, barra de progreso.
   - Bases grandes: mapa, diagrama, línea de tiempo.
2. **Recetas.** Combinaciones con nombre que ya sabemos que funcionan: los 15 componentes de hoy, más las que sumemos de nuevas referencias.
3. **Composiciones libres.** El director arma una combinación nueva de piezas cuando ninguna receta encaja, dentro de una gramática: zonas de pantalla fijas (izquierda, centro, esquina, tercio inferior, pantalla completa), máximo de elementos a la vez, y las reglas de legibilidad del tema.

Cada recurso, sea pieza o receta, lleva una **ficha de uso** que el director consulta para decidir y variar:

| Campo de la ficha | Para qué sirve | Ejemplo (cifra grande) |
| --- | --- | --- |
| Intenciones que resuelve | Que el director lo encuentre por lo que quiere lograr | Impactar con una magnitud |
| Cuándo no usarlo | Evitar el uso forzado | Cifras sin unidad o sin contexto |
| Intensidad (1 a 3) | Repartir picos y descansos en el video | 2 |
| Duración mínima y máxima | Que se llegue a leer sin aburrir | 3 a 6 s |
| Fatiga | Cada cuánto se puede repetir | No más de una vez por minuto |
| Variantes | Cambiar sin perder identidad | Izquierda o centro; con o sin prefijo |
| Datos que necesita | Qué debe sacar del guion | Una cifra y su unidad |

Con las fichas, sumar un recurso nuevo es escribir su ficha y su código; el director lo empieza a usar sin tocar el resto del sistema.

## Arquitectura hub-and-spoke

Un director (el centro) entiende el video entero y reparte; los diseñadores (los rayos) completan cada capítulo en paralelo; los especialistas entran solo cuando hace falta un mapa o un diagrama; y un verificador de código aprueba o rechaza antes del render.

```
 Guion ──────────┐                 ┌─> Diseñador · cap. 1 ─┐
 Estilo del canal ├─> DIRECTOR ────┼─> Diseñador · cap. 2 ─┼─> Verificador (código) ─> Render
 Memoria del canal┘  (estructura,  ├─> Diseñador · cap. N ─┤        │ (Remotion + ffmpeg)
                      intenciones, └┄> Especialistas ──────┘        │
                      intensidad,      (mapas, diagramas,           │
                      storyboard)       a demanda)                  │
        ▲                   ▲                                       │
        └── Fichas de uso ──┘          <── rechazo con motivo ──────┘
```

Las fichas de uso alimentan al director (versión resumida) y a los diseñadores (versión completa de los recursos que les tocaron); lo rechazado vuelve al diseñador con el motivo.

| Pieza | Recibe | Devuelve |
| --- | --- | --- |
| Director | Guion completo con tiempos, estilo y memoria del canal, fichas resumidas | Storyboard: estructura, momentos, intención, recurso elegido y por qué |
| Diseñador | Su capítulo, las notas del director, las fichas completas de lo asignado | Los gráficos del capítulo con sus datos y textos |
| Especialista | Un pedido concreto: un lugar, un mecanismo | Mapa o diagrama listo para el render |
| Verificador | Todos los gráficos y el guion | Aprobados, o rechazos con motivo |
| Render | Gráficos aprobados y video base | Video final |

## Cómo decide el director

El director no elige gráficos escena por escena: primero entiende el video entero y después reparte. Decide en cinco pasos, y cada uno deja algo escrito que se puede revisar.

1. **Estructura.** Marca el gancho, los actos o capítulos con su título, los giros, el clímax, el cierre y los pedidos a la audiencia.
2. **Mapa de intenciones.** Para cada momento importante anota qué tiene que pasar en la cabeza del espectador (impactar, comparar, situar, explicar, remarcar, dar respiro) y qué tan fuerte.
3. **Curva de intensidad.** Reparte un presupuesto de picos por acto: el gancho y el clímax llevan los recursos más fuertes, y hay tramos sin gráficos a propósito para que el video respire.
4. **Asignación.** Para cada momento busca en las fichas los recursos que resuelven esa intención, descarta los que están en fatiga o no encajan con el anterior, y elige una receta o pide una composición libre.
5. **Storyboard.** Devuelve el plan en un formato que una persona puede leer y corregir: momento, intención, recurso elegido, por qué, y qué datos del guion usa.

Tres fuentes de memoria mejoran las decisiones con el tiempo:

- **Estilo del canal**, ya guardado: paleta, tipografías, tono y nicho.
- **Historial del canal**: qué recursos se usaron en los últimos videos, para no repetir el mismo arranque o la misma comparación.
- **Correcciones del equipo**: lo que se borra, cambia o agrega en la revisión antes del render. Si siempre se borra un tipo de gráfico en un canal, el director lo usa menos ahí.

## Textos propios y datos del guion

El director puede escribir sus propios textos, pero nunca datos propios: toda cifra, nombre propio y fecha que aparece en pantalla tiene que estar en el guion, y eso lo verifica código, no la IA.

| Tipo de texto | ¿Puede ser propio? | Ejemplo | Cómo se verifica |
| --- | --- | --- | --- |
| Cifras, fechas, medidas | No | "1.670 km/h" | El número normalizado aparece en el guion de ese tramo |
| Nombres propios | No | "Quito", "Lhasa" | El nombre aparece en el guion |
| Títulos de capítulo | Sí | "Escenario 2: frenar poco a poco" | Sin cifras ni nombres nuevos; largo máximo |
| Frases de remate | Sí | "Extinción en horas" | Sin cifras ni nombres nuevos; largo máximo |
| Títulos y bajadas de gráficos | Sí | "Tu velocidad ahora mismo" | Sin cifras ni nombres nuevos |
| Conclusiones de una comparación | Sí, si se deducen | "Cuatro o cinco veces más rápido" | La proporción se recalcula con las cifras del guion |
| Formato compacto de una cifra | Sí | "+1.000 km/h" desde "más de 1.000 km por hora" | Mismo número; solo cambia la escritura |

Lo que falla la verificación no se publica: el verificador lo devuelve al especialista con el motivo, y si vuelve a fallar se descarta ese gráfico, nunca el video.

## Cómo montarlo en Claude Platform

Sí se pueden armar dos o tres agentes desde Claude Platform: Managed Agents (en beta) permite un agente coordinador con un equipo de agentes propios, cada uno con su modelo, sus instrucciones y sus herramientas. La otra opción es orquestarlos nosotros desde el backend con la API que ya usamos.

| | Managed Agents (multiagente) | Orquestación propia con la API |
| --- | --- | --- |
| Quién maneja el flujo | Anthropic: el coordinador decide cuándo delegar | Nuestro código: pasos fijos |
| Agentes | Coordinador + equipo con nombre (ej. director en Opus, diseñadores en Haiku), corriendo en paralelo | Las mismas llamadas, en paralelo desde el backend |
| Configuración | Cada agente se guarda y versiona en la plataforma; se edita sin deployar | En el código del backend |
| Control de costo | Tope de gasto por sesión | Lo controlamos nosotros por llamada |
| Previsibilidad | Menor: el coordinador puede tomar caminos distintos | Mayor: siempre los mismos pasos |
| Estado | Beta | Estable |
| Mejor para | Explorar y probar diseños rápido; casos donde no se sabe qué especialista hace falta | Producción, con miles de videos y tiempos predecibles |

Propuesta: usar Managed Agents para **diseñar y probar** el director y sus especialistas (se itera editando instrucciones, sin código), y decidir después de la validación si producción queda ahí o pasa a orquestación propia. Las instrucciones de cada agente sirven igual en los dos caminos.

Equipo inicial sugerido:

- **Director** (modelo grande): estructura, intenciones, curva de intensidad, asignación y storyboard.
- **Diseñador** (modelo chico, varias copias en paralelo): completa los gráficos de un capítulo con sus datos.
- **Especialistas a demanda**: mapas y diagramas, cuando lleguen esas fases.

El verificador no es un agente: es código que corre al final, porque tiene que dar siempre el mismo resultado.

## Análisis de nuevos videos de referencia

De cada video se extrae lo mismo, para poder comparar entre nichos:

| Qué se mira | Para qué alimenta el diseño |
| --- | --- |
| Estructura: gancho, actos, giros, clímax, cierre y en qué minuto cae cada uno | Paso 1 del director |
| Momentos con gráfico: minuto, qué dice la voz, qué aparece en pantalla | Mapa intención → tratamiento |
| Tratamientos que no están en nuestras recetas | Nuevas piezas o recetas |
| Ritmo: segundos entre gráficos, tramos sin gráficos | Curva de intensidad y fatiga |
| Sistema visual: tipografías, colores, foco, movimiento | Temas por nicho |
| Textos propios del editor vs textos del guion | Reglas de textos propios |
| Qué se podría hacer mejor | Ventajas sobre la referencia |

Videos analizados al 30/10: cuatro grabaciones de 22 a 37 segundos.

### Ciencia y Vida — "¿Cómo pudo un AVE chocar con un tren parado?" (prólogo)

El más interesante: el tramo está hecho entero con gráficos, sin stock, y cambia de estado visual cada 2 o 3 segundos, una vez por frase.

- **Cabecera fija:** "CIENCIA Y VIDA · ¿CÓMO PUEDEN CHOCAR DOS TRENES?" arriba a la izquierda y "● PRÓLOGO" a la derecha, en letra monoespaciada chica.
- **Palabra tachada:** "IMPOSIBLE" grande y después una línea roja la tacha mientras la voz lo desmiente.
- **Simulación de tablero:** vista desde la cabina con las vías en perspectiva, velocímetro que baja de 305 a 220 km/h, "DISTANCIA OBJETIVO" que descuenta de 3.166 m a 2.966 m, señales de colores y el cartel rojo "FRENO AUTOMÁTICO" que se enciende. Explica el mecanismo sin decirlo.
- **Pregunta pivote:** "¿Por qué no frenó?" sola en pantalla, con la palabra clave en azul subrayada.
- **Reconstrucción con protagonistas:** dos trenes ilustrados, cada uno con nombre, pasajeros y un chip de estado ("PARADO" en rojo, "EN MARCHA" en verde); después se suma un reloj "8:50". Los elementos se acumulan a lo largo de varias frases.
- **Índice de capítulos:** "01 Cómo frena un tren" en un recuadro con una línea que lo conecta al siguiente.
- **Subtítulos palabra por palabra:** la palabra que se dice se resalta en azul.

### Cómo Funciona El Mundo — lista de 6 casos (AlphaGo, líneas de Nazca)

Stock de archivo con una capa gráfica fuerte. La estructura de lista se ve todo el tiempo.

- **Marcador de lista fijo:** "CASO 1 DE 6" arriba a la izquierda y la pregunta del caso arriba a la derecha ("LO QUE NADIE SABE · POR QUÉ LA ELIGIÓ", después "QUÉ VIO").
- **Cifra en frase:** "UNA VEZ DE CADA 10.000" con el número en un recuadro de color, sobre fondo de estrellas.
- **Marcador deportivo:** "ALPHAGO 4 · LEE SEDOL 1" con los números en recuadros, sobre el video desenfocado.
- **Frase que se reemplaza:** "UN TALENTO QUE NADIE ENTENDÍA" se funde en "UN PUNTO CIEGO QUE TAMPOCO".
- **Tarjeta de caso:** "CASO 2 DE 6 · LAS FIGURAS ESCONDIDAS EN EL DESIERTO" con una barra de 6 segmentos.
- **Globo que gira** hasta resaltar Perú en azul.
- **CTA simulado:** una tarjeta de YouTube con el cursor que toca "Suscribirse" y la campana.
- **Subtítulos** en negrita muy pesada con la palabra actual en un recuadro azul.

### Video de ciencia sobre gusanos que comen plástico (en inglés)

Resuelve el problema del material de distintos formatos: casi nada va a pantalla completa.

- **Medios como tarjetas** sobre un lienzo oscuro con grilla: fotos, clips verticales de celular y videos de baja calidad aparecen enmarcados, con esquinas marcadas.
- **Mosaico** de 12 imágenes de microscopía para "hay muchísimas bacterias".
- **Etiqueta de hito:** "BREAKTHROUGH · 2018" arriba a la izquierda.
- **Ficha de persona sin foto:** silueta, nombre en tipografía pesada y rol en serif itálica ("John McGeehan · PETase researcher").
- **Figura científica** de un paper a pantalla completa, usada como diagrama.

### Video sobre El Niño (en inglés)

Gráficos de datos con fuente visible, intercalados con stock.

- **Línea que se dibuja** con título y fuente: "THE PLANET'S TEMPERATURE · NASA GISTEMP, yearly, °C vs 1951-80", y los récords que se marcan de a uno (1998, 2010, 2016).
- **Grilla de tarjetas** "THE NINE STRONG EL NIÑOS and what came next": cada una con años, una barrita y °C, y una etiqueta que se revela después ("La Niña · 3 winters").
- **Globo con datos** (anomalía de temperatura del mar) con la anotación "Dec 1997 · El Niño".

### Qué suman al diseño

| Patrón nuevo | Visto en | Qué cambia en el diseño |
| --- | --- | --- |
| Capa fija de navegación (canal, capítulo o caso, pregunta del tramo) | Ciencia y Vida, Cómo Funciona El Mundo | Separar una capa persistente de los gráficos de cada momento |
| Escenas que se construyen en varias frases | Ciencia y Vida | El director planifica escenas con estados, no gráficos sueltos |
| Simulación con instrumentos | Ciencia y Vida | Nueva familia: tableros, medidores y contadores en vivo para explicar mecanismos |
| Protagonistas ilustrados con estado | Ciencia y Vida | Piezas "actor" (vehículo, persona, animal, objeto) con chip de estado |
| Palabra tachada y frase reemplazada | Ciencia y Vida, Cómo Funciona El Mundo | Variantes de mito vs realidad y de frase cinética |
| Pregunta pivote | Ciencia y Vida | Intención nueva: abrir intriga antes de un capítulo |
| Marcador deportivo | Cómo Funciona El Mundo | Receta nueva para resultados y enfrentamientos |
| Medios como tarjetas y mosaicos | Gusanos y plástico | Modo de producción que aprovecha stock vertical o de baja calidad |
| Ficha de persona sin foto | Gusanos y plástico | Variante de ficha cuando no hay imagen libre de la persona |
| Línea con fuente y anotaciones | El Niño | Fuente visible en los gráficos de datos; récords que se marcan con la voz |
| Grilla de tarjetas con revelado | El Niño | Receta para comparar muchos casos a la vez |
| Globo con país o datos resaltados | Cómo Funciona El Mundo, El Niño | Confirma la prioridad de la fase de mapas |
| CTA simulado de YouTube | Cómo Funciona El Mundo | Variante del CTA actual |
| Subtítulos palabra por palabra | Ciencia y Vida, Cómo Funciona El Mundo | Confirma la fase de subtítulos; el estilo varía por canal |

La conclusión más grande: estos canales trabajan en **tres modos de producción distintos**, y el director tiene que saber en cuál está:

1. **Stock con gráficos encima** (MAGNITUD, Cómo Funciona El Mundo, El Niño): el video es la base y los gráficos aparecen cada 20 a 40 segundos.
2. **Lienzo con medios enmarcados** (gusanos y plástico): el lienzo es la base y el stock entra como tarjetas.
3. **Todo animado** (Ciencia y Vida): los gráficos son la base y cambian cada 2 o 3 segundos.

## Oportunidad: el formato todo animado

Los videos hechos enteros con gráficos son un formato nuevo, casi todo de 2026, y en español hay muy pocos canales: NexLev clasifica solo 23 canales faceless de motion graphics en español y 85 en todos los idiomas (son mínimos: no todos los canales están clasificados todavía; Ciencia y Vida, por ejemplo, no figura). Los que existen rinden muy bien con pocos videos.

| Canal | Idioma | Nicho | Creado | Videos | Vistas promedio | Ingreso/mes estimado |
| --- | --- | --- | --- | --- | --- | --- |
| Server History | inglés | Historia | sep 2026 | 6 | 731.000 | USD 12.800 |
| CONSTRUCTUM | español | Ingeniería y desastres | mar 2026 | 101 | 329.000 | USD 8.800 |
| Rentenklar | alemán | Jubilación y finanzas | oct 2026 | 11 | 104.000 | USD 6.900 |
| Objetitis | español | Empresas | sep 2026 | 19 | 293.000 | USD 4.000 |
| Panda Quiz | español | Trivia | mar 2026 | 3 | 906.000 | USD 600 |

Datos de NexLev al 30/10/2026; los ingresos son estimaciones. Aparte, el video de Ciencia y Vida sobre el choque de trenes sumó 140.000 vistas en 21 horas.

Los 23 canales en español se concentran en trivia, ingeniería y desastres, empresas, tecnología e IA, fútbol y algo de historia. **Nichos sin cubrir en español:** psicología (ninguno), animales y naturaleza (ninguno), salud y medicina (uno chico), finanzas personales (hay un caso fuerte en alemán), true crime, geopolítica y espacio.

Por qué nos conviene:

- **Diferencial de producto:** ninguna herramienta genera este formato automáticamente.
- **Independencia del stock:** sin clips repetidos, sin problemas de licencia, sin material vertical o de baja calidad.
- **Encaja con lo diseñado:** escenas, actores y simulaciones son extensiones del director y de Remotion, no un sistema aparte.

Cómo validarlo: uno o dos canales piloto propios en nichos sin cubrir (propuesta: psicología y animales) antes de ofrecerlo como función.

## Diseño del modo todo animado

En este modo la base del video no es el stock sino una escena animada que cambia con cada frase. El director deja de pensar en "momentos con gráfico" y pasa a pensar en **escenas** que se construyen en varios **pasos**, uno por frase.

**Capas de cada cuadro,** de atrás hacia adelante:

1. **Lienzo:** fondo del tema (por ejemplo, azul noche con grilla tenue). Puede llevar una imagen o clip enmarcado como tarjeta.
2. **Escena:** los elementos del tramo actual (actores, instrumentos, datos, textos).
3. **Capa fija:** cabecera con canal, tema del video y capítulo ("CIENCIA Y VIDA · ¿CÓMO PUEDEN CHOCAR DOS TRENES? · PRÓLOGO"), contador de lista ("CASO 1 DE 6"), o un reloj que sigue vigente varias escenas.
4. **Subtítulos** palabra por palabra.

**Una escena = estado inicial + pasos.** Cada paso está atado a una frase del guion (con el timing de Whisper) y hace una sola cosa: aparecer, actualizar un valor, cambiar un estado, resaltar, tachar o salir. Así se vería la escena de los trenes:

| Frase (resumida) | Paso |
| --- | --- |
| "El tren que estaba parado era un Iryo" | Aparece el tren rojo con "Iryo" |
| "con ciento cuarenta y siete pasajeros" | Se suma "147 pasajeros" y el chip "PARADO" |
| "El que llegó por detrás" | Aparece el tren blanco debajo |
| "un AVE de Renfe con casi cuatrocientas personas" | Se suman "AVE de Renfe", "casi 400 personas" y el chip "EN MARCHA" |
| "Eran las nueve menos diez de la mañana" | Aparece el reloj y marca 8:50 |
| "Para entenderlo, primero hay que saber..." | La escena se va y entra el índice "01 Cómo frena un tren" |

**Piezas nuevas que necesita:**

- **Actores:** ilustraciones planas de vehículos, personas, animales, edificios y objetos, cada uno con nombre, datos y chip de estado. Biblioteca propia en SVG por nicho; si falta uno, silueta genérica con etiqueta, o imagen generada con IA en el estilo del tema.
- **Instrumentos:** velocímetro, termómetro, barra de distancia, cronómetro, semáforo, carteles de alerta. Animan entre valores del guion (305 → 220 km/h).
- **Escenarios:** fondos simples que dan contexto (vía en perspectiva, ciudad, océano, cerebro, mapa).

**Cambios en el director:** en este modo planifica 3 a 6 escenas por capítulo y, dentro de cada una, los pasos frase por frase. Un especialista nuevo, el **diseñador de escenas**, completa cada escena con actores, instrumentos y valores.

**Mezcla de modos:** el modo puede venir del estilo del canal o elegirse por tramo (por ejemplo, prólogo animado y desarrollo con stock).

**Render y calidad:** en este modo Remotion anima el video entero, no solo la entrada de cada gráfico. En la Fase 0 medímos unos 11 cuadros por segundo a 1080p con 4 núcleos; el worker actual (Ryzen 7, 16 GB, 1 TB) tiene el doble de núcleos, así que un video de 20 minutos debería rondar los 25 a 30 minutos de render, y menos a 720p. La potencia alcanza; lo que hay que asegurar es la **calidad visual**: un banco de pruebas que muestre cada pieza y escena con datos reales antes de usarla, y revisión con Remotion Player en la plataforma.

## Recursos nuevos a implementar

De los videos nuevos salen 18 recursos: 7 de prioridad alta (casi todos del modo todo animado), 9 media y 2 baja. Cada uno lleva su ficha de uso antes de implementarse.

| Recurso | Familia | Intención que resuelve | Modos | Visto en | Prioridad |
| --- | --- | --- | --- | --- | --- |
| Motor de escenas con pasos por frase | Escena | Construir una explicación en varias frases | Todo animado | Ciencia y Vida | Alta |
| Capa fija de navegación (canal, tema, capítulo o caso, pregunta del tramo) | Capa fija | Orientar y sostener la estructura | Todos | Ciencia y Vida, Cómo Funciona El Mundo | Alta |
| Subtítulos palabra por palabra con estilo por canal | Capa fija | Sostener la atención | Todos | Ciencia y Vida, Cómo Funciona El Mundo | Alta |
| Actores ilustrados con chip de estado | Pieza | Presentar protagonistas y su situación | Todo animado, lienzo | Ciencia y Vida | Alta |
| Instrumentos: velocímetro, distancia, reloj, semáforo, alerta | Pieza | Explicar un mecanismo o el paso del tiempo | Todo animado | Ciencia y Vida, Sol que se apaga | Alta |
| Pregunta pivote | Receta | Abrir intriga antes de un capítulo | Todos | Ciencia y Vida | Alta |
| Gráfico de línea con fuente y anotaciones | Receta | Mostrar una tendencia con récords | Todos | El Niño | Alta |
| Palabra tachada | Variante de mito vs realidad | Desmentir | Todos | Ciencia y Vida | Media |
| Frase que se reemplaza | Variante de frase cinética | Contraponer dos ideas | Todos | Cómo Funciona El Mundo | Media |
| Índice de capítulos como nodos | Variante de capítulo | Anunciar lo que viene | Todos | Ciencia y Vida | Media |
| Marcador deportivo | Receta | Mostrar un resultado o enfrentamiento | Stock, todo animado | Cómo Funciona El Mundo | Media |
| Cifra en frase con el número resaltado | Variante de cifra grande | Impactar con una proporción | Todos | Cómo Funciona El Mundo | Media |
| Grilla de tarjetas con revelado | Receta | Comparar muchos casos a la vez | Todos | El Niño | Media |
| Medios como tarjetas sobre lienzo y mosaico | Modo de producción | Usar stock vertical o de baja calidad | Lienzo | Gusanos y plástico | Media |
| Ficha de persona sin foto | Variante de ficha | Presentar a una persona sin imagen libre | Todos | Gusanos y plástico | Media |
| Globo con país o datos resaltados | Base grande (mapas, Fase 4) | Situar en el mundo | Todos | Cómo Funciona El Mundo, El Niño | Media |
| Etiqueta de hito con fecha | Variante de etiqueta | Situar en el tiempo | Todos | Gusanos y plástico | Baja |
| CTA simulado de YouTube | Variante de CTA | Pedir la suscripción | Todos | Cómo Funciona El Mundo | Baja |

Orden de implementación propuesto:

1. **Base del modo todo animado:** motor de escenas, capa fija y subtítulos palabra por palabra, y medir el costo de render de un video entero.
2. **Actores e instrumentos:** biblioteca inicial para los dos nichos piloto.
3. **Recetas y variantes nuevas:** pregunta pivote, línea con fuente, grilla, marcador, tachado, reemplazo, índice, cifra en frase, ficha sin foto, hito y CTA.
4. **Lienzo con medios enmarcados.**
5. **Globo y mapas,** junto con la Fase 4.

Todo pasa por el director y las fichas de uso descritos arriba: un recurso sin ficha no entra al catálogo.

## Validación y plan por etapas

Nada reemplaza al planificador actual hasta ganarle en una comparación con guiones reales. Cada etapa tiene una condición para pasar a la siguiente.

1. **Cerrar este diseño.** Sumar el análisis de los videos nuevos y resolver las decisiones abiertas. *Pasa cuando* el equipo aprueba el documento.
2. **Fichas de uso.** Escribir la ficha de cada pieza y receta (las 15 actuales más las que salgan de los videos). *Pasa cuando* cada recurso tiene intención, límites, intensidad y fatiga.
3. **Set de prueba.** Juntar 8 a 10 guiones reales de nichos distintos y, para cada uno, qué haría un buen editor. *Pasa cuando* hay criterio escrito para puntuar un plan.
4. **Prototipo del director en Managed Agents.** Director + diseñadores, solo instrucciones, sin tocar el pipeline. *Pasa cuando* produce storyboards completos para todo el set.
5. **Comparación.** Mismo set con el planificador actual y con el director nuevo; se mide calidad del plan, variedad, respeto de la estructura, errores de datos, tiempo y costo. *Pasa cuando* el nuevo gana en calidad sin empeorar errores de datos.
6. **Integración.** Elegir Managed Agents u orquestación propia, conectar al pipeline y al render. *Pasa cuando* un video real sale de punta a punta con el director nuevo.
7. **Composiciones libres.** Habilitar que el director arme combinaciones nuevas de piezas, ya con la base probada.

## Decisiones abiertas

- [ ] ¿Aprobamos la regla de textos propios tal como está en la tabla, o algún tipo de texto tiene que seguir siendo literal?
- [ ] ¿Qué nichos entran primero en el set de prueba? Propuesta: ciencia, animales, psicología, finanzas e historia.
- [ ] ¿Quién arma el criterio de "qué haría un buen editor" para puntuar los planes?
- [ ] ¿El storyboard se muestra al usuario en la revisión para que lo corrija antes del render, o queda interno?
- [ ] ¿Hasta dónde llegan las composiciones libres: solo piezas existentes, o también que el especialista genere gráficos a medida (por ejemplo, un SVG)?
- [ ] Licencia de Remotion según la cantidad de personas de la empresa.
- [x] Modo de producción: dos formatos de video separados, elegidos por proyecto (stock con gráficos animados y todo animado), los dos solo para admins mientras se prueban.
