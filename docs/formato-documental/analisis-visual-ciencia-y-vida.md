# Análisis visual — Canal "Ciencia y Vida" (@cienciayvida19)

Hecho sobre los 7 videos reales (720p, 30 fps), bajados desde Drive. Método:
- Hojas de cuadros con tiempo: 1 cuadro cada 5 s (trenes, sueños), 3–4 s (móvil, ADN) y 10 s (control mental).
- Ráfagas cuadro a cuadro (cada 0,4–0,75 s) en 2 animaciones clave.
- Detección automática de cortes con `ffmpeg`.
- Colores medidos sobre píxeles reales.

Las hojas están en `referencias/` (nombre = id del video + número de hoja).

---

## PASO 0 — Verificación de acceso

| Video | Duración real | Coincide con YouTube | Qué se ve en 0:05 | Qué se ve en 1:00 |
|---|---|---|---|---|
| AVE choca con tren parado (`gCWDEMpXtVw`) | 8:22,7 | sí (8:23) | transición a negro tras mapa de Toledo | cuadrados: velocidad ×2 → distancia de frenado ×4 |
| Dónde sentarse (`3UUv-vWOzYo`) | 8:06,0 | sí (8:07) | planta del vagón con asientos rojos y azules | "Así que la pregunta no es" sobre fondo oscuro |
| Por qué soñamos (`Bu6xzYbJH-o`) | 8:01,2 | sí (8:02) | figura volando y otra persiguiendo, en marco violeta | figura sentada en la cama + electrocardiograma "118 lpm" |
| Lo que hace tu móvil (`8dQtEOSdEAE`) | 3:26,6 | sí (3:27) | teléfono de línea blanca con candado | matriz de números rojos y blancos "HUELLA MATEMÁTICA" |
| Cómo se copia el ADN (`rL7jQBZWg0M`) | 3:51,7 | sí (3:52) | células rosas con contador "+2.100.813" | tiras de letras A T G C de colores |
| El código de 4 letras (`oism51a9phs`) | 4:43,9 | sí (4:44) | doble hélice 3D con letras | línea de letras ARN con caja "GCU" |
| Control mental (`yXSoaGaHqr8`) | 21:33,3 | sí (21:34) | documento a máquina "OBJETIVO: BORRAR LA ME…" | grilla de figuras grises con una azul resaltada |

---

## Hallazgo principal: un método, cuatro estilos

**No hay un único estilo visual.** El canal repite el mismo método (una idea por pantalla, subtítulo con palabra resaltada, cifras animadas, comparaciones, remate en la palabra clave), pero lo viste con 4 "familias" de diseño:

| Familia | Videos | Aspecto |
|---|---|---|
| **A · Infografía editorial** | AVE, Dónde sentarse, Control mental | Alterna fondo gris claro y azul noche. Esquemas planos de perfil, figuras de palito negras, documentos a máquina, mapas y globo. **Es la referencia que describía tu informe, y la del video viral (277 mil vistas).** |
| **B · Panel científico (HUD)** | Por qué soñamos | Todo azul noche, paneles con marcos finos y etiquetas en letra monoespaciada, gráficos tipo instrumental, cerebro 3D translúcido, acento naranja |
| **C · Línea sobre negro + 3D** | Lo que hace tu móvil | Fondo negro puro, íconos de línea blanca, acento rojo, una cara 3D hecha de nube de puntos. Subtítulo arriba con palabras en caja blanca |
| **D · 3D suave y brillante** | Copia del ADN, Código de 4 letras | Fondo casi negro, células 3D rosas y violetas, fichas de letras brillantes de colores, contadores grandes. Subtítulo arriba con palabras en caja azul translúcida |

Para Skaler: **el método es lo que se automatiza; el estilo es un "tema" intercambiable.** El análisis de abajo se centra en la familia A, que es la más reproducible en SVG y la que mejor funcionó. Las familias C y D usan 3D real (nube de puntos, esferas brillantes) que no sale con SVG plano.

---

## PARTE A — Ficha por video

### A1. ¿Dónde es más seguro sentarse en un tren? (familia A, visto completo)

- **Cortes detectados: 0.** No hay cortes secos en 8 minutos: todo se encadena con fundidos (~0,5–0,8 s) o transformando la escena.
- **Ritmo:** cambia algo visible cada ~2–5 s. Una "escena" (mismo esquema) dura ~10–25 s.

| Tiempo | Qué se ve | Recurso | Remate | Texto en pantalla |
|---|---|---|---|---|
| 0:00–0:05 | Planta cenital del vagón; asientos azules → los de ventanilla se pintan de **rojo** | planta + coloreo | en "accidente" los asientos pasan a rojo | "sentido de la marcha" + flecha |
| 0:10–0:15 | Fondo oscuro, "8 muertos"; aparece un panel con vidrio estallado | cifra + ilustración | — | "FILADELFIA · 2015", "8 muertos", "una ventana" |
| 0:20 | Pregunta en grande, centrada | título de giro | — | "¿Dónde es más seguro sentarse en un…" |
| 0:25 | Planta con mitad de asientos en **verde** | planta + coloreo | — | "¿En el sentido de la marcha o de espaldas?" |
| 0:30 | Corte lateral del vagón con asientos y pasajeros | corte transversal | — | "Un tren por dentro" |
| 0:45–0:50 | Barra azul diminuta "Tren ≈ 890" → barra roja larga "Carretera + 32.000" | barras comparativas | la barra roja crece en "carretera" | "Estados Unidos · 2013" |
| 0:55 | Vía con figura roja cruzando + señal de peligro | escena simple | — | "La mayoría no son pasajeros" |
| 1:10–1:20 | Dos contadores que suben desde 0: 13.200 (blanco) y 1.450 (amarillo) | contadores A/B | luego aparece "≈ 9 veces más probable salirse de la vía" | "EE. UU. · 2005–2014" |
| 1:30 | 3 tarjetas oscuras con mini-esquema: descarrilamiento, choque de frente, alcance | tarjetas de categoría | — | nombres de cada tipo |
| 1:40–1:55 | Corte del vagón: extremos con muelles rojos "se deforma", centro con caja verde "espacio de supervivencia" | corte transversal + capas | cada capa entra en su palabra | "Un coche que se arruga a propósito" |
| 2:00–2:15 | Vagón contra locomotora gris: **antiguo** → frente aplastado, cuña roja "47 plazas perdidas"; **nuevo** → extremos arrugados, caja verde "todas las plazas a salvo" | A/B secuencial (antes/después) | choque en <0,4 s en "aplastado" | "Diseño antiguo" / "Diseño nuevo" |
| 2:20 | Fondo oscuro, un vagón montado sobre otro con sombra roja | esquema de peligro | — | "aplasta el espacio del de abajo" |
| 2:40–2:45 | Cuadradito azul "36 km/h" vs bloque rojo de ~70 cuadraditos "300 km/h" | **ley que escala** (pictograma de área) | el bloque rojo aparece en "setenta" | "≈ 70 veces más energía" |
| 3:00–3:25 | Tren esquemático (vista desde arriba, cápsulas con flechas) en fondo oscuro; los coches se tiñen de rojo según tipo de choque | **mapa de calor sobre el objeto** | el rojo avanza por los coches | "Choque de frente", "Alcance", "Descarrilamiento" |
| 3:35–3:40 | Mismo tren, un coche en **verde** con línea indicadora | resaltado | — | "uno o dos coches por detrás del centro" |
| 3:45–4:05 | Dos figuras sentadas frente a frente con mesa; flecha roja "el cuerpo sigue"; círculo verde "el respaldo lo sujeta" | personajes + vector de fuerza | círculo verde en "respaldo" | "Choque de frente o frenazo" / "De espaldas a la marcha" |
| 4:10 | Fondo oscuro, frase de giro | título de giro | — | "Pero aquí está la **trampa**." |
| 4:15–4:20 | Mismo esquema, flecha roja **invertida**, la figura de frente queda sujeta | **A/B con condición invertida** | la flecha cambia de sentido | "Golpe por detrás" |
| 4:30–4:35 | Curva en línea blanca, punto que avanza, señal "80", velocímetro 80 → **170** en rojo | recorrido + velocímetro | el número pasa a rojo | "Filadelfia · 2015" |
| 4:40 | Cifra sola "8" | cifra grande | — | "Murieron ocho." |
| 4:50–4:55 | Hoja de papel con texto a máquina que se escribe | documento | — | "NTSB · FILADELFIA 2015…" |
| 5:00–5:10 | 20 pictogramas blancos; 12 pasan a gris oscuro | **pictogramas que cambian de estado** | "12 murieron" en rojo | "REINO UNIDO · 7 ACCIDENTES · 1996–2004" |
| 5:15 | Izquierda: puntos dispersos "se abre"; derecha: vidrio agrietado "se agrieta, pero aguanta" | A/B lado a lado | — | "cristal normal" / "cristal laminado" |
| 5:25–5:30 | Corte del vagón volcado que gira 90° con 2 pasajeros (pasillo en verde) | objeto que rota | — | "Si el tren vuelca" |
| 5:35 | Logo + botón SUSCRITO con cursor | llamado a suscribirse | — | "Ciencia y Vida" |
| 5:45–5:50 | Maniquí naranja en asiento ante mesa; brillo rojo en abdomen | personaje + punto de daño | brillo rojo en "aplastarlo" | "Prueba de mesas", "abdomen" |
| 5:55–6:00 | 5 mesas en fila → 4 cruces rojas y 1 tilde verde | **lista que se descarta** | tildes y cruces una a una | "solo una cumplió todo" |
| 6:05–6:10 | Corte del vagón; las valijas saltan del portaequipajes | objetos que vuelan | — | "Lo que vuela" |
| 6:35–6:40 | Figura con cinturón de cintura que se inclina hacia adelante | personaje en acción | — | "¿Y el cinturón?" |
| 6:45 | Fila de figuras parado y sentado alternadas | escena de contexto | — | "Mucha gente va de pie" |
| 6:51–7:00 | **Balanza** (ver A2) | balanza + pictogramas | 88 rojos en "ochenta y ocho" | "11 quizá salvados", "88 muertes" |
| 7:05–7:10 | Asientos muy juntos, figura sentada, brillo verde en el respaldo | personaje + resaltado | — | "Asientos muy juntos y acolchados" |
| 7:20–7:30 | Planta del vagón que se va coloreando + checklist que crece a la derecha | **resumen con checklist** | un tilde por recomendación | "coche por detrás del centro", "pasillo"… |
| 7:35–7:40 | Rectangulito "tu asiento" vs escudo grande "señales" | comparación de escala | — | "Lo que de verdad decide" |
| 7:45–8:00 | Vías de noche hacia el horizonte con luces; lazo negro de luto; pregunta final | cierre emocional | — | "Urda · 69 personas", "¿dónde te sientas cuando subes a un tren?" |

### A2. Las dos animaciones clave, cuadro a cuadro

**Balanza 11 vs 88** (6:48–6:59, ráfaga cada 0,75 s):
- 6:50,2: fundido desde la escena clara anterior a fondo oscuro. Primero aparece la balanza, superpuesta con transparencia sobre la escena vieja.
- 6:51–6:55: la balanza vacía queda **quieta ~4 s** (solo una línea y un triángulo gris) mientras la voz dice "en los accidentes que revisaron…".
- 6:55,5 (palabra "once"): aparecen a la izquierda 11 pictogramas verdes en 2 filas, con el número "11" verde arriba y "quizá salvados" abajo. La barra se inclina un poco.
- 6:58,5 (palabra "ochenta y ocho"): a la derecha se arma un bloque de **88 pictogramas rojos** (8 columnas). El bloque se completa en ~0,8 s y la barra **se vuelca con fuerza hacia la derecha** en ~1 s. "88 muertes causadas" en rojo.
- La cámara no se mueve. Sin sacudida ni destello: **el remate es el peso** (cantidad que inclina el sistema).
- **Por qué demuestra:** si el balance fuera al revés, la balanza caería hacia el otro lado. La imagen depende del dato.

**Choque "47 plazas perdidas"** (2:02–2:08, ráfaga cada 0,4 s):
- 2:02–2:04: vagón antiguo a la izquierda, bloque gris "locomotora" a la derecha. Quieto ~2 s (deriva de cámara muy leve, unos pocos píxeles).
- 2:04,0 → 2:04,4 (palabra "aplastado"): en **menos de 0,4 s** el vagón avanza, el frente se pliega en zigzag rojo, aparece una cuña degradada roja y la etiqueta "47 plazas perdidas" en rojo. Todo en el mismo instante: golpe seco, sin rebote.
- 2:04,4–2:08: queda quieto ~4 s mientras la voz completa la cifra.
- **Patrón:** quietud → golpe instantáneo en la palabra → quietud con etiqueta.

### A3. ¿Cómo pudo un AVE chocar con un tren parado? (familia A, visto completo; el viral)

- **Cortes detectados: 2.** Igual que el anterior, todo encadenado.
- **Recursos nuevos respecto del video de los asientos:**
  - **Mapa de la zona** (0:00, 1:50, 5:45, 6:25–6:35): mapas oscuros de provincias en azul translúcido, punto y nombre. En 6:35 un tramo de la línea se pinta de rojo (69 km sin el sistema LZB).
  - **Palabra gigante sola** (0:10): "IMPOSIBLE".
  - **Trenes con estado** (0:20–0:25): Iryo rojo "● PARADO" y AVE blanco "● EN MARCHA" + reloj "8:50".
  - **Índice de capítulos en tarjetas** (0:30–0:35): "01 Cómo frena un tren", "02 Otros países".
  - **Lupa / detalle circular** (0:45, 3:00): corte rueda-carril con círculo de zoom (contacto del tamaño de una moneda); rueda con lupa sobre la grieta.
  - **Ley que escala** (1:00): 2 cuadrados azules "× 2" (velocidad) → 4 cuadrados rojos (distancia de frenado).
  - **Vista del maquinista** (1:05, 2:05, 5:55): vía en perspectiva con niebla, o cabina con velocímetro y panel de "distancia objetivo" que baja (3.152 m → 2.852 m).
  - **Vía en tramos** (1:15–1:20): cantones numerados con semáforos verde, amarillo y rojo; "Un cantón, un tren."
  - **Panel de interfaz** (1:35): botones "AVISO" / "RECONOCER" con "2.0 s".
  - **Contador sobre objeto** (2:00, 3:00–3:05): cruces de cable "7 ≈ 700 m"; vueltas de la rueda 294.795 → 1.133.212.
  - **Escudos = barreras** (2:40): 4 escudos de línea con nombre. Reaparecen al final del video de los asientos.
  - **Documento a máquina** (3:20–3:25, 4:20, 5:15, 6:55–7:00, 8:10): hoja beige que se escribe línea a línea; a veces un renglón resaltado en amarillo, o un sello rojo "PENDIENTE" / "EN PAUSA".
  - **Tarjeta de lección** (3:40, 4:30, 5:40): fondo claro, etiqueta azul "LA LECCIÓN DE ESCHEDE" y la frase en negro en dos tiempos. **Se repite igual en los 3 casos.**
  - **Globo terráqueo** (3:45): globo azul con punto rojo, nombre y coordenadas "AMAGASAKI · JAPÓN · 25 · IV · 2005".
  - **Curva con señal y velocímetro** (4:05–4:10, 5:50): igual que Filadelfia: "70" → "116" en rojo.
  - **Cifra sola gigante** (4:15): "107" con subtítulo.
  - **Dos líneas paralelas A/B** (4:40): "Wenzhou · 2011" vs "Urda · 2026", tren rojo en la segunda.
  - **Pantalla del centro de control** (4:50, 6:30–6:45): tramo verde "LIBRE"; "FALLO DEL SISTEMA"; botones "MARCHA NORMAL" (resaltado en amarillo) vs "MARCHA A LA VISTA".
  - **Pictogramas** (5:20): 54 figuras amarillas "54 responsables".
  - **Queso suizo** (7:25–7:45; la mejor metáfora del canal): 4 lonchas amarillas en perspectiva → aparecen agujeros → flecha roja que atraviesa una y se frena en la siguiente → versión Urda: primera loncha "CAÍDO", las otras con "?".
  - **Cierre** (8:00): vías de noche, lazo negro, documento "PENDIENTE", pregunta.

### A4. Por qué soñamos (familia B, visto completo)
- Cortes: 0. Todo en azul noche; nunca hay fondo claro.
- Personajes: figuras blancas redondeadas tipo cápsula, sin cara; las escenas soñadas van dentro de **marcos violetas con borde punteado**.
- Recursos: anillo indicador "≈ 2.0 h" (0:20); grilla de figuras que se pintan de verde "La mayoría: sí" (0:30); electrocardiograma "118 lpm" (1:00); **hipnograma** con los REM en naranja brillante, que reaparece 4 veces sumando capas (1:20, 2:15–2:40, 6:35); letras "REM" con significado (1:25); ojos 3D con gráfico de movimiento ocular (1:30); barras REM vs otras fases (2:05); **tarjeta de hipótesis con medidor de evidencia** (3:05, 3:55, 4:55, 5:35, 6:20); plano de evacuación como metáfora (3:35); fila de mamíferos (4:05); red de puntos que se reorganiza (4:25–4:30); muestra chica vs muestra deseable en puntos (4:50); gráfico de dispersión con línea de tendencia (5:30); proceso en 3 cajas "Señales al azar → Síntesis → Sueño" (5:55); **caras en puntos** (5:50); lista de preguntas abiertas (6:30).

### A5. Lo que hace tu móvil (familia C, visto completo)
- **Cortes: 34 (~6 s por plano).** Es el más rápido y el único con cortes secos frecuentes.
- Subtítulo **arriba**, con palabras clave en caja blanca invertida.
- Recursos: teléfono de línea blanca; cronómetro "× 1.000 CÁMARA LENTA" (0:12); cono rojo infrarrojo (0:21); contador "+28.553 → +30.000 PUNTOS" (0:27–0:30); **cara 3D en nube de puntos rojos** con zoom a la nariz y los ojos (0:33–0:45); A/B foto plana vs perfil de cara con cruz roja (0:48–0:54); matriz de números "HUELLA MATEMÁTICA" (0:57–1:00); chip con candado (1:03–1:06); comparación de columnas con tilde verde (1:12); **1 en un millón = un punto rojo en una grilla de puntos** (1:15–1:18); íconos gemelos/hermanos/niños (1:21); ojo + línea punteada al teléfono (1:27); A/B dedo ✓ vs uña ✗ (1:48–1:51).

### A6 y A7. Copia del ADN y Código de 4 letras (familia D)
- Cortes: 18 (~12 s por plano) y 26 (~10,5 s por plano).
- Subtítulo arriba con palabras clave en caja azul translúcida.
- Recursos: células 3D rosas con núcleo violeta; contadores grandes ("+2.100.813 células nuevas", "803.252.511"); íconos tachados → tilde "CASI NUNCA FALLA"; **fichas de letras brillantes con color fijo por letra** (A naranja, T azul, G verde, C amarillo; se mantiene en los dos videos); escala: célula → hilo de ADN que se estira → espiral en el núcleo; biblioteca → caja de cerillas; enzima como estrella amarilla que abre la cremallera; molde de casilleros vacíos que se llenan; encaje A–T con tilde; **combinatoria**: teclado de 4 teclas, tabla que se llena y contador "64 / 20" contra la meta de 20 aminoácidos; año gigante + nombre en etiqueta ("1953 · JAMES WATSON"); tubo de ensayo "UUU".

### A8. Control mental (familia A + papel; visto 0:00–3:10 con detalle, resto en hojas de 10 s)
- Cortes: 2.
- Más "documental de historia": documentos a máquina, mapa de papel beige "MONTREAL" con coordenadas, globo con pin "BUDAPEST · HUNGRÍA", campo de prisioneros en ilustración gris con alambre de púas, ficha de persona "ALBERT BIDERMAN · 1957", lista de métodos con íconos y renglón resaltado, grilla de figuras grises con una azul, "PRESIÓN" / "CANSANCIO" con máquina y pastilla tachadas.

---

## PARTE B — Sistema visual común (familia A)

**B1. Personajes.**
- **Pictograma de palito** negro sólido: cabeza circular, tronco y extremidades del mismo grosor, sin cara ni manos.
- De pie, sentado, agarrado a la barra, inclinado. Sentados van en asientos azules de línea.
- La emoción no se muestra con el cuerpo: se muestra con **color y elementos alrededor** (brillo rojo = daño, círculo verde = protegido, flecha roja = fuerza).
- Para cantidades: **pictogramas de persona** (cabeza + hombros redondeados) en grilla, de un solo color según significado.
- El maniquí de prueba es la única figura de color (naranja).

**B2. Objetos y escenarios.**
- Vistas **de perfil o cenitales** estrictas, sin perspectiva, salvo en la vista del maquinista y el queso suizo.
- Relleno plano + línea fina; sin texturas. Sombras solo como brillo de color difuso (rojo o verde).
- Lo invisible se dibuja como: flechas rojas (fuerza), cuñas o halos degradados rojos (zona de daño), cajas verdes semitransparentes (zona segura), zigzag (deformación), puntos brillantes (señales, balizas).
- Un mismo objeto se reutiliza todo el video: el corte del vagón aparece ~8 veces con distintas capas.

**B3. Paleta (medida en píxeles; ~ = estimado).**

| Uso | Color |
|---|---|
| Fondo claro (escenas físicas, esquemas) | ~#E8ECF0, con viñeta suave más oscura en los bordes |
| Fondo oscuro (datos, cifras, giros, casos) | ~#050A14 (azul casi negro), viñeta |
| Peligro, daño, cifra negativa | ~#E85030 (rojo anaranjado) |
| Seguro, correcto, protección | ~#2EB872 (verde; estimado) |
| Palabra resaltada del subtítulo, etiquetas de capítulo | ~#0068B0 (azul) |
| Segundo dato en comparaciones, sistemas activos | amarillo ~#F0C050 (también las lonchas de queso) |
| Neutro (objetos, texto) | negro y grises; blanco sobre fondo oscuro |
| Papel de documento | beige con sombra, letra de máquina de escribir |

**Regla de fondo:** claro para "cómo funciona" (física, esquemas); oscuro para "cuánto o cuándo" (cifras, casos, frases de giro, cierre).

**B4. Texto.**
- **Subtítulo** siempre abajo al centro, chico, gris oscuro (o claro sobre fondo oscuro). Muestra 5–8 palabras por vez, con **una palabra en azul subrayada** que sigue a la voz.
- **Título de escena** arriba a la izquierda, negrita chica ("Diseño antiguo"), con subtítulo gris diminuto debajo (fuente del dato).
- **Capítulo** arriba a la derecha en letra diminuta ("CAP. 2 · UN COCHE QUE SE ARRUGA A PROPÓSITO").
- **Fuente del dato** abajo a la izquierda, diminuta, con barrita azul.
- **Etiquetas** pegadas al dibujo, 2–4 palabras, del color de su significado.
- **Cifras** grandes y finas; a veces solas en pantalla ("8", "107").
- **Frase de giro** centrada sobre fondo oscuro, aparece palabra por palabra ("Pero aquí está la **trampa**.").
- Tipografía sans moderna y limpia, más monoespaciada para fechas y lugares ("FILADELFIA · 2015").

**B5. Métricas.** Contadores que suben desde 0; barras horizontales que crecen; velocímetro digital que cambia de color al pasar el límite; pictogramas que cambian de estado; "distancia objetivo" que baja. Reaparecen cuando vuelve el tema (la vista del maquinista 3 veces, la curva con velocímetro 3 veces).

**B6. Movimiento y ritmo.**
- Entradas: fundido + leve desplazamiento, ~0,3–0,6 s.
- **Remate: golpe seco <0,4 s**, sin rebote, justo en la palabra clave.
- **Quietud: un esquema puede quedar quieto 3–5 s** mientras la voz explica. Lo que se mueve en ese tiempo es el subtítulo y una deriva de cámara mínima.
- Construcción por capas: el mismo esquema suma etiquetas o zonas en cada frase (vagón → muelles → caja verde → etiqueta).

**B7. Cámara.** Casi fija. Deriva o acercamiento muy lento (pocos píxeles). Sin sacudidas. Los "zooms" se hacen con lupas circulares, no moviendo la cámara.

**B8. Transiciones.** Fundido cruzado (~0,5–0,8 s), casi siempre. Cortes secos: 0–2 por video en la familia A (contra 34 en el del móvil). Cambio de fondo claro ↔ oscuro como separador de bloques.

**B9. Eventos fuertes.** Contenidos, nunca espectaculares: choque = pliegue en zigzag + cuña roja + etiqueta en el mismo cuadro; descarrilamiento = coches que se desalinean y se tiñen de rojo; vuelco = rotación de 90° del corte del vagón; valijas = rectángulos de colores que saltan. **No hay explosiones, partículas ni sacudidas.**

**B10. Estructura visual.**
- **Apertura:** dato o escena + cifra + pregunta en grande.
- **Índice de capítulos** en tarjetas.
- **Bloques** separados por cambio de fondo.
- Casos con **plantilla fija**: mapa o globo → escena → cifra grande → documento → tarjeta de lección.
- **Llamado a suscribirse** a mitad del video.
- **Resumen** con checklist.
- **Cierre:** vías de noche con lazo de luto y pregunta para comentarios.

---

## PARTE C — Catálogo de recursos (para programar)

Aparecen 2 veces o más en total. Los tiempos son ejemplos.

| # | Recurso | Dónde aparece | Para qué idea | Composición y animación | Remate | Contenido variable |
|---|---|---|---|---|---|---|
| 1 | **Esquema por capas** (corte transversal) | Asientos 0:30, 1:40–1:55, 2:55, 6:05; AVE 0:45 | cómo está hecho algo | objeto de perfil al centro; capas que entran una por frase (zona, color, etiqueta) | la capa clave en su palabra | objeto, capas, etiquetas |
| 2 | **Antes/después del mismo objeto** | Asientos 2:00–2:15; AVE 3:35 | qué cambió una mejora | mismo esquema dos veces con título "antiguo/nuevo" | golpe de deformación vs "a salvo" | objeto, daño, etiquetas |
| 3 | **A/B con condición invertida** | Asientos 3:45–4:20; móvil 1:48–1:51 | lo mismo no sirve siempre | misma escena; flecha o resultado que se invierte | la flecha cambia de sentido | figuras, fuerza, condición |
| 4 | **A/B lado a lado** | Asientos 5:15; móvil 0:48; AVE 4:40, 6:00 | comparar dos opciones | dos columnas con título y resultado (✓/✗, verde/rojo) | aparece el resultado | opciones, resultado |
| 5 | **Balanza con pictogramas** | Asientos 6:51–7:00 | costo vs beneficio | barra + triángulo; quieta ~4 s; grupo A entra; grupo B entra y vuelca | vuelco en la cifra mayor | cantidades, etiquetas, colores |
| 6 | **Grilla de pictogramas con cambio de estado** | Asientos 5:00–5:10; AVE 5:20; sueños 0:30; control 1:00 | proporción dentro de un grupo | N figuras en grilla; una parte cambia de color o se apaga | el cambio + cifra en color | N, subconjunto, colores |
| 7 | **Ley que escala** (área) | AVE 1:00; Asientos 2:40–2:45; código 0:44–0:56 | algo crece más que proporcional | unidad pequeña vs bloque de N unidades | el bloque grande aparece en la cifra | factor, unidades |
| 8 | **Contador(es) que suben** | Asientos 1:10–1:20; AVE 2:00, 3:00; móvil 0:27; ADN 0:03 | magnitud, comparación | 1–2 cifras grandes centradas, suben desde 0 | frase de relación ("≈ 9 veces más") | valores, etiquetas |
| 9 | **Barras comparativas** | Asientos 0:45–0:50; sueños 2:05, 5:20 | comparar magnitudes | barras horizontales que crecen | la barra grande crece en su palabra | valores, colores |
| 10 | **Recorrido en curva + velocímetro** | Asientos 4:30; AVE 4:05, 5:50 | exceso de velocidad o error en un trayecto | línea curva blanca, punto que avanza, señal con límite, panel de velocidad | el número pasa a rojo | límite, velocidad real |
| 11 | **Mapa de calor sobre objeto** | Asientos 3:00–3:40 | dónde golpea más | objeto en vista cenital; segmentos que se tiñen de rojo o verde | el color avanza | segmentos, intensidad |
| 12 | **Lista que se descarta** | Asientos 5:55–6:00; AVE 7:00 | probar opciones, preguntas abiertas | N ítems en fila; ✗ y ✓ uno por uno | queda uno | ítems, resultado |
| 13 | **Checklist de resumen** | Asientos 7:20–7:30; control 2:50 | recapitular | lista a la derecha que crece; esquema a la izquierda que se colorea | — | ítems |
| 14 | **Documento a máquina** | AVE 3:20, 4:20, 5:15, 6:55, 8:10; Asientos 4:50, 6:25; control varias | informe, fuente oficial | hoja beige que se escribe; renglón resaltado o sello rojo | sello o resaltado | título, líneas |
| 15 | **Tarjeta de lección o frase** | AVE 3:40, 4:30, 5:40 | conclusión de un caso | fondo claro, etiqueta azul + frase en dos tiempos | segunda mitad de la frase | caso, frase |
| 16 | **Ubicación (mapa / globo)** | AVE 0:00, 1:50, 3:45, 5:45, 6:25; control 0:10, 1:10 | dónde pasó | mapa oscuro translúcido o globo; pin + nombre + fecha monoespaciada | tramo que se pinta de rojo | lugar, fecha, tramo |
| 17 | **Cifra o palabra sola** | AVE 0:10, 4:15; Asientos 4:40 | golpe emocional | una cifra o palabra gigante centrada en fondo oscuro | la cifra misma | cifra, subtítulo |
| 18 | **Frase de giro** | Asientos 4:10, 2:30; AVE 2:45, 5:10 | cambio de dirección | texto centrado palabra por palabra, palabra clave en azul | la palabra clave | frase |
| 19 | **Vista subjetiva / panel** | AVE 1:05–1:10, 2:05, 5:55, 6:40 | qué ve o decide alguien | perspectiva con niebla o cabina con instrumentos | instrumento que cambia | valores del panel |
| 20 | **Metáfora visual** | AVE queso suizo 7:25; escudos 2:40 / Asientos 7:40; sueños caras en puntos 5:50; ADN cremallera, cerillas | idea abstracta | objeto cotidiano que actúa la idea; se reutiliza al final aplicado al caso | la versión aplicada ("CAÍDO", "?") | metáfora, etiquetas |
| 21 | **Índice de capítulos** | AVE 0:30–0:35; Asientos 1:30 | mapa del video | tarjetas numeradas que entran una por una | — | títulos |
| 22 | **Cierre de luto** | AVE 8:00; Asientos 7:45 | homenaje / tono | vías de noche, luces, lazo negro, pregunta | — | lugar, cifra, pregunta |

---

## PARTE D — Lo que NO hacen
- Nada de fotos ni video real en la familia A. La mano del video del ADN parece render 3D o foto, y es la excepción.
- Sin caras ni manos detalladas.
- Sin explosiones, partículas, sacudidas de cámara ni destellos.
- Sin transiciones llamativas (barridos, giros, glitch).
- Sin texto largo: nunca más de una frase corta además del subtítulo.
- Sin más de un esquema principal por pantalla.
- Sin degradados decorativos: el degradado solo marca zonas de daño o protección.
- Sin música visualizada ni íconos decorativos que no signifiquen algo.

## PARTE E — Diferencias entre videos
- **Familia A** (trenes, control mental): la más consistente, la más fácil de hacer en SVG y la del viral. Recomendada como primer estilo de Skaler.
- **Familia B** (sueños): misma lógica, pero con estética de instrumental científico. Sería un "tema oscuro" del mismo motor: cambian paleta, marcos y tipografía.
- **Familias C y D** (móvil, ADN): más vistosas, pero dependen de 3D real (nube de puntos, esferas brillantes, fichas con volumen) y de un montaje con cortes rápidos. No se logran con SVG plano; harían falta Three.js (`@remotion/three`) o recursos 3D pre-renderizados.
- **El mejor animado**, en relación entre claridad y medios: el de los asientos. Cada escena demuestra con un solo esquema reutilizado y un remate en la palabra.

## Autoevaluación
- **Más confianza:** la composición, la paleta, los tipos de texto y el catálogo de recursos (vistos en cientos de cuadros y medidos en píxeles); el conteo de cortes (medido con `ffmpeg`); los tiempos de los remates de la balanza y del choque (ráfagas).
- **Menos confianza:**
  1. Las curvas exactas de movimiento: solo hay ráfagas de 2 animaciones.
  2. Los videos 3–7 vistos con 1 cuadro cada 3–10 s, sin ráfagas.
  3. El control mental, visto en detalle solo los primeros 3 minutos.
  4. El verde exacto, que no quedó en el cuadro que medí.
- **Con más tiempo:** ráfagas del queso suizo, el mapa de calor y la vista del maquinista; medir con código la cantidad de movimiento por segundo contra los tiempos de cada palabra (de Whisper) para cuantificar "quietud + remate".
