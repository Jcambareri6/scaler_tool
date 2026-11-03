# Sistema de agentes para generar videos todo animados

## Objetivo

Skaler recibe un **titulo y un guion de cualquier tema** y debe generar un video animado completo, sin stock: dibujos, personajes, graficos y metricas sincronizados con la voz. No copia un video: interpreta cada guion y aplica un mismo metodo visual.

Busco ideas para mejorar la calidad, reducir costo y lograr resultados consistentes en cualquier nicho.

## Stack

Backend en TypeScript, Supabase, Claude Managed Agents y Remotion. El sistema recibe el guion, el audio y cada palabra con su tiempo, y entrega un plan de escenas que se puede ver en una preview y luego renderizar.

## Agentes y piezas

| Pieza | Tipo y modelo | Que hace |
|---|---|---|
| **Multimedia** | Agente, Opus 5.5 | Lee el guion y define capitulos, escenas, que demuestra cada una, su remate, titulos cortos y la biblioteca visual del video |
| **Dibujante** | Agente, Sonnet 5.5, en paralelo | Dibuja en SVG cada objeto y personaje, con partes moviles nombradas. Cada objeto se dibuja una vez y se reutiliza en ese video |
| **Escenas** | Agente, Sonnet 5.5, en paralelo | Ubica los componentes y crea los pasos de animacion, la camara y la entrada de textos y metricas, atados a palabras exactas |
| **Verificador** | Codigo | Controla reglas exactas: datos del guion, objetos fuera de cuadro, solapes, pantallas vacias, ritmo, encabezado, cantidad de texto y uso correcto de componentes |
| **Revisor** | Agente con vision, Sonnet 5.5 | Mira capturas reales de cada escena y evalua si coinciden con la voz y si se entienden |
| **Auditor** | Agente con vision, Opus 5.5 | Busca lo que el Revisor dejo pasar, frena rechazos sin fundamento y mira la coherencia del video completo |

Las **skills** guardan el conocimiento reutilizable de los agentes: direccion visual, dibujo y animacion. Incluyen fichas de cuando usar y cuando no usar cada recurso.

## Iteracion para cualquier video

1. **Entrada:** el usuario carga titulo y guion. Se genera o reutiliza la voz, y se transcribe con tiempo por palabra.
2. **Plan:** Multimedia entrega la estructura y la biblioteca. El Verificador la devuelve si falla.
3. **Dibujo:** el codigo reparte lotes entre Dibujantes, hasta 10 a la vez. Cada componente rechazado vuelve con el motivo, hasta 3 intentos.
4. **Escenas:** el codigo abre una sesion por tramo, hasta 10 a la vez. Cada entrega pasa por el Verificador, hasta 3 intentos. Se guarda la mejor version de cada escena.
5. **Capturas:** Remotion renderiza 4 imagenes reales por escena.
6. **Control visual:** Revisor y Auditor analizan esas capturas.
7. **Correccion:** cada escena rechazada vuelve a Escenas con sus motivos y su version actual. Se repiten capturas y control, con hasta 2 rondas de correccion.
8. **Salida:** se guarda el plan. Si una escena sigue con problemas, queda registrada como pendiente. El usuario ve la preview en Skaler y decide renderizar.

Si falla el flujo con agentes, el sistema cae a un esquema mas simple para no perder el video.

## Lo que probamos

- **Un coordinador que dirige a los demas:** resulto caro porque se despertaba con cada evento. Lo reemplazamos por reparto desde codigo y el costo bajo mucho.
- **Reglas mas estrictas:** evitan errores, pero suben costo y tiempo, y no aumentan la creatividad.
- **Mas detalle en los dibujos:** se ve mejor, pero reduce claridad y movimiento.
- **Dibujos minimos:** bajan costo y mejoran claridad, pero sin buenas ideas el video queda pobre.
- **Revisor y Auditor:** detectan errores reales, incluso incoherencias entre imagen y voz. Pero corregir escenas mal nacidas sale caro y a veces rompe otra cosa.
- **Sincronizacion por palabra:** resolvio textos que aparecian antes de tiempo.

## Problemas abiertos

1. Las ideas visuales no siempre demuestran el tema: muchas veces solo lo ilustran.
2. La IA no mantiene ritmo, composicion y calidad parejos si inventa cada animacion desde cero.
3. La correccion automatica puede oscilar y encarecer el proceso.
4. Hoy los agentes no aprenden de una corrida a otra: solo mejoran si cambiamos sus instrucciones, ejemplos o codigo.
5. Personajes y eventos fuertes, como una explosion, todavia no se ven del todo bien.
6. El render puede colgarse: hace falta limite de tiempo y reintento.

## Propuesta en evaluacion

Crear un motor de recursos en codigo con animaciones probadas: balanzas, acumulaciones, mecanismos, comparaciones, recorridos y metricas. La IA elegiria el recurso, completaria el contenido y sincronizaria. La creacion libre quedaria como excepcion y el control de calidad se reduciria a una revision.

## Que ideas necesito

- Mejor arquitectura para maximizar calidad por dolar.
- Como lograr demostraciones visuales potentes para cualquier guion.
- Como combinar plantillas y creatividad sin que los videos se repitan.
- Como evaluar calidad automaticamente.
- Como hacer que el sistema aprenda de cada video y mejore de verdad.
