# Informe: formato "todo animado" para videos de YouTube generados con IA

Te paso este informe para pedirte ideas. Lee todo antes de proponer. Busco opiniones concretas sobre la arquitectura y el camino para llegar a la calidad buscada, no consejos generales.

## 1. Objetivo

Skaler es una plataforma que genera videos faceless para YouTube. Queremos que el usuario entregue **un titulo y un guion** y reciba un video completo en un formato "todo animado", para cualquier tema o nicho.

- No se busca copiar un video concreto, sino el metodo: que la IA interprete cada guion y lo cuente con ese lenguaje visual.
- La referencia son 3 clips (177 segundos en total) de 2 videos del canal Ciencia y Vida, uno sobre donde sentarse en un tren y otro sobre por que sonamos.
- La voz y el guion ya existen en la plataforma. El problema es generar la parte visual.

## 2. Que hace buenos a los videos de referencia

Sale de un analisis de fotogramas y secuencias. Los clips tienen saltos en la reproduccion, asi que los ritmos son observaciones, no medidas exactas.

- **Demuestran, no ilustran.** Cada escena es un experimento visual: una balanza con 11 personas salvadas contra 88 muertes; el mismo par de pasajeros bajo dos condiciones de choque; valijas que salen volando; 5 mesas descartadas una por una.
- **Dibujos minimos.** Siluetas tipo capsula sin cara, esquemas de lado, una balanza hecha con una linea y un triangulo.
- **Paciencia y remate.** Un sistema puede quedar quieto mientras la voz explica, y cambia con fuerza justo en la palabra clave.
- **Pero la pantalla no aburre:** se suman etiquetas, piezas y cifras, con una camara suave sobre todo el cuadro.
- **La cantidad causa efectos:** las figuras se acumulan y su peso mueve el sistema.
- **Texto integrado y medido:** titulo chico, etiquetas pegadas al dibujo ("el cuerpo sigue"), subtitulos con palabra resaltada y alguna frase de giro.
- **Metricas intercaladas:** contadores, barras, medidores e hipnogramas que reaparecen sumando capas.
- **Pocos colores con significado:** rojo peligro, verde seguro, naranja foco. Fondo claro para escenas fisicas y oscuro para datos.

## 3. Stack y arquitectura actual

- **Backend:** TypeScript y Express, Supabase y un worker de render con Docker. Hoy todo este trabajo esta en local, sin desplegar.
- **Animacion:** Remotion (React). Cada cuadro se dibuja como una pagina web. La preview se ve en vivo con el Player de Remotion, antes de renderizar.
- **IA:** Claude Managed Agents, con SDK TypeScript `@anthropic-ai/sdk` 0.123 y skills propias.
- **Datos de entrada:** guion, audio y palabras con tiempo de Whisper.

**Flujo:**

1. **Multimedia** (Claude Opus 5.5) lee el guion en frases y devuelve capitulos, escenas, titulos cortos y una biblioteca de objetos propia de ese video.
2. **Dibujantes** (Sonnet 5.5, en paralelo) dibujan cada objeto como SVG con partes nombradas. Los personajes usan un esqueleto comun: cabeza, torso, brazos y piernas.
3. **Escenas** (Sonnet 5.5, en paralelo, una sesion por tramo) arma cada escena con elementos, posiciones y pasos atados a la palabra exacta.
4. **Verificador de codigo:** rechaza texto fuera del guion, objetos cortados, solapes, escenas vacias, lineas de tiempo con menos de 3 hitos, y mas.
5. **Revisor** (Sonnet 5.5) mira 4 capturas reales por escena contra lo que dice la voz. **Auditor** (Opus 5.5) controla al Revisor y mira el video completo.
6. Lo rechazado vuelve a Escenas con los motivos, hasta 2 rondas.
7. **Motor en Remotion:** muestra, mueve, gira, escala, pinta, repite en grilla (pictogramas), anima personajes (`walk`, `run`, `press`, `push`, `point`, `look`, `recoil`, `fall`), mueve la camara y mezcla graficos del catalogo: cifras, versus, barras, mapas, globo, lineas de tiempo, diagramas.

El reparto entre agentes lo hace nuestro codigo. Antes un agente coordinador esperaba a los demas y se llevaba alrededor de 3/4 del costo, porque se despertaba constantemente y releia todo su contexto.

## 4. Pruebas realizadas

Se uso el mismo guion real sobre Chernobyl.

| Prueba | Duracion | Costo de agentes | Tiempo de agentes | Resultado principal |
|---|---|---|---|---|
| Sin dibujos | 20 min | US$ 0,76 | 7 min 19 s | 92% de texto en cajas |
| Dibujos por componentes | 3 min | US$ 1,29 | 6 min 10 s | Gran salto visual, con superposiciones |
| Reparto por codigo | 3 min | US$ 0,58 | 4 min 19 s | Mas barato, pero collage de iconos |
| Escenarios y skills | 3 min | US$ 1,12 | 4 min 25 s | Mejor narrativa |
| Mejor estetica | 3 min | US$ 1,54 | 6 min 44 s | Lindo, pero movimiento pobre y muy ilustrado |
| Reglas estrictas | 3 min | US$ 2,15 | 9 min 8 s | Movimiento con sentido, poca semejanza con la referencia |
| Dibujos minimos | 3 min | US$ 0,96 | 4 min 21 s | Estetica cercana, pero pobre y estatico |
| Sincronia por palabra y camara | 3 min | US$ 1,56 | No medido | Mucho movimiento, pero objetos cortados e ideas confusas |
| Con Revisor y Auditor | 30 s | Aprox. US$ 0,85 con control | 7 min 18 s | Continuidad y encabezado bien; una escena sin aprobar y sin explosion |

**Control de calidad:** sobre un video ya hecho, el Revisor detecto correctamente una linea de tiempo sin sentido y una contradiccion entre imagen y voz; el Auditor corrigio un rechazo injusto y encontro errores que se habian escapado. Pero el Revisor rechazo 10 de 12 escenas. Con correccion automatica, el resultado oscilo: 1 de 2 rechazadas, luego 2 de 2, luego 1 de 2.

**Render en una PC local a 720p:** unos 6 minutos por cada 3 minutos de video. Una vez se colgo durante una hora sin error, y la repeticion salio bien; la causa es desconocida.

## 5. Diagnostico actual

- Cada regla nueva corrige un defecto y mueve otro: demasiado texto -> sin texto; demasiado detalle -> muy pobre; quieto -> movimiento de mas.
- La mayor parte de la dificultad es que la IA invente, desde cero en cada escena, una animacion con ritmo, composicion y sentido fisico parejos.
- Revisar y corregir detecta errores, pero no eleva el nivel creativo y encarece el proceso.
- Los agentes no aprenden entre corridas. Lo unico que los mejora es lo guardado: instrucciones, ejemplos y codigo.
- Extrapolando linealmente el ultimo clip, un video de 20 minutos costaria cerca de US$ 35, lo cual no es viable. Sin ciclo de correcciones, la estimacion anterior era de US$ 7 a 10.

## 6. Hipotesis actual

Crear un **motor de recursos de demostracion** en codigo: balanza, acumulacion de personas, mecanismo con explosion, comparacion de dos condiciones, plano con recorrido, barras y contadores. Cada recurso tendria su animacion, composicion y camara ya resueltas.

La IA se encargaria de elegir el recurso, poner los objetos y datos del guion y sincronizar con las palabras. La creacion libre quedaria como excepcion, y el control de calidad se reduciria a una revision.

**Dudas:** el dueno del producto quiere que la IA interprete y cree, no un video de plantillas repetitivas. Tampoco esta confirmado que estos recursos cubran bien cualquier nicho.

## 7. Restricciones

- Tiene que servir para cualquier nicho y guion, sin copiar videos concretos.
- Todo dato en pantalla debe salir del guion.
- Costo razonable por video y tiempo de espera aceptable.
- Generacion automatica: el usuario solo entrega titulo y guion, y revisa en una preview.
- Preferencia por dibujos generados con codigo. Las imagenes por IA no se probaron.
- Los videos de referencia sirven como ejemplo de metodo, no para reproducir su contenido ni identidad.

## 8. Lo que quiero que me respondas

1. Es correcto el diagnostico? Que esta mal planteado?
2. Conviene un motor de recursos, IA libre, o una mezcla? Como evitar que los videos se vean repetidos?
3. Hay mejor forma de hacer que la IA diseñe animaciones: generar codigo Remotion directamente, un lenguaje de escenas distinto, otra libreria u otras herramientas?
4. Como lograr consistencia de dibujo y composicion sin regla tras regla?
5. Como planificar demostraciones visuales potentes a partir de cualquier guion?
6. Como organizarias los agentes y modelos para maximizar calidad por dolar?
7. Como evaluar calidad de forma objetiva, sin depender de una persona mirando cada prueba?
8. Si tuvieras que llegar a un resultado publicable con el menor gasto posible, cuales serian tus primeros tres experimentos?
