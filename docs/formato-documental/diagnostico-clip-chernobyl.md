# Skaler "todo animado" — diagnóstico del clip de Chernobyl y plan

Base: los dos clips de 30,7 s (`chernobil-30s` y `chernobil-30s-revisado`) comparados con el estilo A de Ciencia y Vida (ver `analisis-visual-ciencia-y-vida.md`). Hojas de cuadros en `referencias/skaler_chernobil_*.jpg`.

**Actualización:** revisé el guion, los tiempos por palabra (`guion-30s-palabras.json`) y los dos planes (`plan-escenas-30s.json` y `plan-escenas-30s-revisado.json`). Ver la sección 1b.

---

## 1b. Lo que muestran el JSON y el guion

**La sincronía está perfecta.** Crucé los 31 pasos del plan revisado con las palabras: todos caen exactamente al inicio de su palabra (diferencia 0,00 s). Por ejemplo, "pulsa" → se aprieta el botón; "apagar" → bajan las barras; "freno" → etiqueta; "explota" → explosión. **La sincronización por palabra no es el problema.**

Los problemas están en **qué** se anima y **cómo**:

| # | Hallazgo en el JSON | Consecuencia en el video |
|---|---|---|
| 2 | No existe ningún elemento de subtítulo en el formato del plan (solo `nav_header`) | Los subtítulos no son parte del motor: hay que agregarlos como capa fija |
| 3 | Escena del mapa: **un solo paso** (`show mapa` en 0 s) para 9,8 s | 7 s congelados mientras la voz dice "Central Nuclear de Chernobyl, en la Ucrania Soviética" |
| 4 | Entre 20,28 s, 22,96 s y 24,74 s no hay pasos, y el motor no agrega movimiento de base | Más segundos congelados |
| 5 | `paint reactor.nucleo alert` + `scale` en "emergencia" (20,28 s) | **El reactor se pone rojo antes de tiempo.** La voz todavía dice "es el último recurso", que suena seguro, y la imagen ya anticipa el desastre. Se arruina el remate |
| 6 | `paint boton_rojo alert` en "sola" (17,20 s) | Cambio de color sin significado |
| 7 | `camera zoom 1.3` en "pulsa" y `zoom 1` en "apagar" | Los saltos de encuadre, y las etiquetas que cambian de lugar |
| 8 | El componente `explosion` usa `var(--accent)`, que es **#6CC6FF (azul)**; `scale 2.6` + `loop spin` | Explosión azul que crece fuera del cuadro y gira |
| 9 | Cada dibujo lleva coordenadas `x/y/w` absolutas elegidas por la IA, todas con `slot: "full"` | La composición depende de que la IA calcule bien posiciones; de ahí los solapes y objetos cortados de otras pruebas |
| 10 | `theme.accent` azul para personaje, barras, cartel, ciudad y explosión | El azul pierde significado; el rojo (`alert`) se usa para el botón, el núcleo y las luces |

**Corrección a mi diagnóstico anterior:** propuse un medidor de potencia que se dispara. **No corresponde para este tramo:** el guion no dice que las barras aumentaron la potencia, y mostrarlo sería agregar un dato que no está. El remate correcto con este guion es el **contraste entre lo que se espera y lo que pasa**:
- en "apagar" y "último recurso" → todo pasa a verde / seguro (barras entran, aparece un escudo o el reactor se calma);
- en "explota" → golpe seco, todo pasa a rojo.

Es el recurso "A/B con condición invertida": la imagen promete una cosa y el remate la contradice, sin inventar datos.

---

## 1. Qué hace hoy el clip revisado

| Tiempo | Qué se ve |
|---|---|
| 0–9 s | Mapa oscuro de Europa, Ucrania resaltada, pin y etiqueta "CHERNOBYL · 26 de abril de 1986, 1 y 23 de la madrugada" |
| 10–28 s | Una sola escena: operador azul, consola gris y reactor con barras. Botón que pasa a rojo (18 s), barras que bajan (19 s), borde rojo en el reactor (21 s), etiqueta "freno de mano" (23 s), mini gráfico de barras sin rótulo (25 s), reactor que se llena de rojo (28 s) |
| 29–30 s | Estallido en forma de estrella **azul** con humo gris, que tapa la etiqueta y se sale del cuadro |

**Mejoró respecto de v1:**
- Arranca con ubicación (mapa + fecha), igual que la referencia.
- Una sola escena coherente en vez de 3 sueltas.
- Desapareció el reloj vacío de v1, que mostraba "□□:□□" sin números.
- El encabezado se lee bien ("CAPÍTULO 1 DE 1 · EL BOTÓN FINAL").

---

## 2. Brecha contra la referencia, medida

| Medida | Referencia (3 tramos de 30 s) | Skaler v1 | Skaler v2 |
|---|---|---|---|
| Segundos **totalmente congelados** (de 30) | 0–2 | 7 | **11** |
| Intensidad del remate (pico / promedio de movimiento) | 8–9 (balanza, choque) | 4,8 | 5,8 |
| Subtítulo con palabra resaltada | siempre | no | **no** |
| Título de escena y fuente | sí | no | no |

En la referencia nunca hay un segundo muerto: aunque el esquema esté quieto, el subtítulo avanza palabra por palabra y la cámara deriva muy despacio. En Skaler hay tramos de 7 s con la imagen literalmente congelada (2–9 s y 20–28 s).

---

## 3. Lo que falta, ordenado por impacto

| # | Problema | En el clip | Cómo es en la referencia | Arreglo | Quién lo arregla |
|---|---|---|---|---|---|
| 1 | **No hay subtítulo** | ningún texto que siga a la voz | subtítulo abajo, 5–8 palabras, una palabra en azul subrayada | componente fijo con los tiempos de Whisper | código (sin IA) |
| 2 | **Segundos congelados** | 11 de 30 | 0–2 | deriva de cámara constante + capas que entran con la voz | código + reglas del recurso |
| 3 | **El remate no aprovecha la ironía** | el reactor ya se pone rojo en "emergencia", antes del remate | la imagen promete algo y el remate lo contradice | en "apagar / último recurso" todo pasa a verde o seguro; en "explota", golpe seco a rojo. Sin datos nuevos (ver 1b) | Multimedia (idea) + recurso "condición invertida" |
| 4 | **Color sin significado** | azul en todo: operador, barras, pantalla, explosión | objetos negros o grises; azul solo en texto; rojo = peligro; verde = seguro | tema de color en código | código |
| 5 | **Explosión** | estrella azul que tapa la etiqueta y se sale del cuadro | no hay explosiones; el evento es contenido: zigzag, halo rojo, etiqueta y cifra en el mismo cuadro, y después quietud | recurso "evento contenido" | código |
| 6 | **El encuadre salta** | la composición cambia de escala entre 15→16 s y 18→19 s, y "Reactor 4" cambia de lugar | encuadre fijo por escena; el detalle se muestra con una lupa | cámara del motor: solo deriva lenta | código |
| 7 | **Etiquetas sueltas** | "freno de mano" flota arriba, lejos del objeto | etiqueta pegada al objeto, del color de su significado | posición relativa al objeto | código |
| 8 | **Métrica sin rótulo** | mini gráfico de 5 barras sin número ni nombre | toda métrica tiene número y nombre, y suele ser el remate | regla del recurso: sin rótulo no se dibuja | verificador |
| 9 | **Fondo siempre oscuro** | todo azul noche | claro para mecanismos (cómo funciona), oscuro para datos y giros | Multimedia elige el fondo por tipo de escena | Multimedia + tema |
| 10 | **Personaje** | figura azul con contorno blanco | pictograma negro sólido, sin cara | un único personaje en código | código |

**Conclusión:** de los 10 problemas, 8 se resuelven en código, una sola vez y para siempre. Solo el 3 y parte del 9 necesitan una mejor idea de la IA. Eso confirma el diagnóstico: hoy se le pide a la IA que invente cosas que tendrían que venir resueltas.

---

## 4. Plan

### Fase 0 — "Tema A" en código, sin IA
1. **Colores con significado:** fondo claro ~#E8ECF0 y oscuro ~#050A14, con viñeta suave; rojo #E85030 = peligro; verde = seguro; azul #0068B0 solo para el texto resaltado; amarillo para el segundo dato.
2. **Capa fija de texto:**
   - subtítulo con palabra resaltada (de los tiempos de Whisper);
   - título de escena arriba a la izquierda;
   - capítulo arriba a la derecha;
   - fuente abajo a la izquierda;
   - etiquetas pegadas a los objetos.
3. **Cámara:** encuadre fijo por escena + deriva lenta constante. Transiciones: solo fundido de ~0,6 s. Sin saltos de escala.
4. **Personaje único:** pictograma negro con poses (de pie, sentado, agarrado, inclinado, caído) y pictograma de persona para grillas.
5. **Reglas de tiempo comunes a todo recurso:** entrada en 0,3–0,6 s; remate como golpe seco de 0,4 s o menos en la palabra ancla; después, quietud con etiqueta.

**Prueba de que funcionó:** volver a renderizar el mismo clip de Chernobyl solo con esto. Deberían desaparecer los problemas 1, 2, 4, 6, 7 y 10 sin tocar los agentes.

### Fase 1 — Motor de recursos (los 12 más frecuentes del catálogo)
1. Esquema por capas.
2. A/B lado a lado.
3. **A/B con condición invertida** ("la trampa").
4. Contadores.
5. Barras comparativas.
6. Grilla de pictogramas con cambio de estado.
7. Balanza.
8. Ley que escala.
9. Ubicación en mapa o globo.
10. Documento a máquina con sello.
11. Tarjeta de lección o frase de giro.
12. **Evento contenido** (reemplaza las explosiones), más medidor o indicador genérico (velocímetro, potencia, temperatura).

Cada recurso:
- tiene espacios a completar (contenido, etiquetas, cifras, palabras ancla) y ninguna coordenada;
- resuelve su propia composición, por lo que no puede haber solapes ni objetos cortados;
- acepta sumar capas, para que un mismo esquema vuelva varias veces en el video.

### Fase 2 — Agentes más simples y baratos
| Paso | Quién | Qué hace |
|---|---|---|
| Plan | Opus, **1 llamada por video** | Por cada momento clave: afirmación, tipo, recurso elegido + 1 alternativa, palabra del remate y fondo claro u oscuro. Define 3–5 esquemas que vuelven a lo largo del video |
| Control del plan | Código + Sonnet en texto | Prueba de falsedad ("¿la imagen cambiaría si la afirmación fuera falsa?"), variedad de recursos y datos solo del guion. **Antes de animar nada** |
| Escenas | Sonnet o Haiku | Solo completa los espacios del recurso, en JSON |
| Dibujos | Sonnet, solo lo que falta | Biblioteca compartida entre videos + normalizador de SVG (grosor, paleta) |
| Verificador | Código | Con composición resuelta por el motor, solo controla datos del guion, segundos congelados, métricas sin rótulo y remates en su palabra |
| Revisión visual | Sonnet, **1 hoja de cuadros por video** | Una imagen como las de `referencias/`, no 4 capturas por escena. El Auditor queda solo para muestreo |
| Corrección | Código | Como máximo 1 ronda de cambios puntuales. Si no mejora la nota, la escena baja a un recurso seguro del mismo tipo. Así no hay oscilación |

### Fase 3 — Medir en vez de opinar
Conjunto fijo de 8–10 guiones de nichos distintos, en tramos de 60–90 s. Cada cambio se corre sobre todos y se compara con la referencia, con las mismas medidas de este informe:
- segundos congelados (meta: 2 de cada 30 o menos);
- intensidad del remate (meta: 7 o más);
- remates que caen a 0,3 s o menos de su palabra ancla;
- subtítulo presente, texto en pantalla dentro de límite, métricas con rótulo;
- variedad de recursos por video;
- más una comparación a ciegas contra la versión anterior.

---

## 5. Próximos pasos concretos
1. **Hacer la Fase 0** (subtítulo, tema de color, movimiento de base, cámara sin saltos) y volver a renderizar este mismo clip. Es el experimento más barato y el que más mejora debería dar.
2. **Programar primero 3 recursos:** "ubicación con capas" (mapa que suma lugar y fecha mientras habla la voz), "condición invertida" y "evento contenido". Con eso, este clip queda: mapa vivo → sala y reactor en fondo claro → "apagar" en verde → "explota" como golpe rojo contenido.
3. **Cambiar el formato del plan:** que la IA elija recurso y complete contenido y palabras ancla, sin `x/y/w` ni componentes de explosión propios. La sincronía por palabra que ya funciona se mantiene igual.
