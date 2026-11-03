---
name: animacion
description: Como armar y animar un escenario completo con componentes, personajes y pasos atados a las frases de la voz. Usar siempre antes de disenar una escena.
---

# Animacion de escenarios

Tu trabajo es dirigir una demostracion: planteo, tension y remate en la palabra exacta.

## Composicion

- Un solo lugar. Elegi una linea de suelo y apoya todo sobre ella.
- Usa el cuadro completo: lo importante entre x 12 y 88, y entre y 20 y 82. Arriba de y 10 esta la capa fija: ahi no va nada.
- Nada se sale del cuadro ni se pisa. `over: true` solo cuando es fisico: una persona delante de un panel, algo adentro de un cuarto.
- Con dibujos no uses title, text, chip, card ni number. Podes sumar hasta 3 `label` muy cortos, de 1 a 4 palabras, pegados a lo que nombran y sin tocar ningun dibujo: "el cuerpo sigue", "88 muertes". Solo si suman algo.
- Pocos objetos y grandes: la escena ocupa al menos el 60% del ancho.
- Nunca ocultes todo: en cada frase queda algo a la vista.
- `background`: light para escenas fisicas, dark para tension o datos.

## Ritmo

- Siempre pasa algo: cada 3 a 6 segundos hay un cambio visible que cuenta algo nuevo. Se suma una pieza, cambia un estado, un personaje actua o la camara se acerca. Una imagen nunca queda igual mas de 6 segundos.
- Todo va en la PALABRA exacta: cada paso importante lleva `word` con la palabra de esa frase donde ocurre. Sin `word`, el paso cae al empezar la frase y se ve antes de tiempo.
- Todo texto y todo grafico entra con un `show` con `word`: aparece cuando la voz lo dice, ni antes ni despues.
- El remate es uno solo, claro y fuerte, en su palabra clave.
- Cada movimiento significa algo. Como mucho 3 `loop` por escena, y solo si el objeto se mueve de verdad (una rueda, humo).
- Causa y efecto: la cantidad o la accion provoca el cambio. Las 88 figuras se apilan una por una con `stagger`, y recien despues la balanza gira hacia ese lado.
- Si la voz dice "explota", hay destello, piezas que vuelan y temblor: es el remate.

## Pasos

`{phrase, action, target, part?, duration?, ...}`

| action | Campos | Uso |
|---|---|---|
| `show` / `hide` | | Entra o sale un elemento |
| `move` | `dx`, `dy` en % del tamano del componente | Trasladar: mover 100 = su propio ancho |
| `rotate` | `deg` | Girar (palancas, agujas, puertas) |
| `scale` | `factor` | Crecer o achicarse |
| `paint` | `tone`: alert, ok, accent, neutral | Cambiar de estado |
| `loop` | `loop`: spin (ruedas, helices), float (humo, nubes), shake (temblor), pulse (luces) | Movimiento continuo desde esa frase |
| `act` | `act`, `duration` | Accion de un personaje |
| `camera` | `zoom` (1 a 1.4), `duration` de 1.5 a 3 | La camara se acerca al `target`; con zoom 1 vuelve al plano general |

La camara es suave y se usa poco: un movimiento cada 7 segundos como mucho, solo hacia lo importante, y volve a abrir para la consecuencia. Lo que se ve en el acercamiento no se corta: ubica el objeto lejos de los bordes.

Cada movimiento tiene que tener sentido fisico:

- Lo que esta fijo en el mundo no se mueve: edificios, chimeneas, muros, muebles y maquinas grandes quedan quietos. Solo se mueven sus partes moviles (una aguja, una barra, una puerta, el humo).
- Solo los objetos chicos se trasladan con `move`, hasta 24% de ancho. Si algo grande se tiene que notar vivo, usa humo, luces o temblor.
- `over` solo vale para piezas chicas, hasta 20% de ancho. Lo grande va separado.

`part` aplica el paso a una parte del componente. `from_index`, `to_index` y `stagger` eligen ejemplares de un pictograma.

## Personajes

Los personajes actuan en casi todas las escenas donde aparecen.

- `walk` y `run`: siempre con un `move` del personaje en la misma frase y con la misma `duration`.
- `press`, `push`, `point`, `look`, `recoil`, `fall`. Una pose clara y breve vale mas que muchos gestos.
- Reaccionan: si algo estalla, `recoil` o `fall`; si suena una alarma, `look`.

## Ejemplo: "un operador aprieta el boton y el reactor se dispara"

```json
{
  "background": "dark",
  "elements": [
    { "id": "sala", "kind": "drawing", "component": "sala_control", "x": 34, "y": 52, "w": 58 },
    { "id": "reactor", "kind": "drawing", "component": "reactor", "x": 76, "y": 54, "w": 30 },
    { "id": "panel", "kind": "drawing", "component": "panel", "x": 45, "y": 66, "w": 16, "over": true },
    { "id": "operador", "kind": "drawing", "component": "operador", "x": 16, "y": 62, "w": 8, "over": true },
    { "id": "senal", "kind": "drawing", "component": "pulso", "x": 54, "y": 76, "w": 2, "over": true }
  ],
  "steps": [
    { "phrase": "p1", "action": "loop", "target": "reactor", "part": "humo", "loop": "float" },
    { "phrase": "p1", "action": "act", "target": "operador", "act": "walk", "duration": 3 },
    { "phrase": "p1", "action": "move", "target": "operador", "dx": 240, "duration": 3 },
    { "phrase": "p2", "action": "act", "target": "operador", "act": "press", "duration": 1.2 },
    { "phrase": "p2", "action": "paint", "target": "panel", "part": "boton", "tone": "alert" },
    { "phrase": "p3", "action": "show", "target": "senal" },
    { "phrase": "p3", "action": "move", "target": "senal", "dx": 900, "duration": 1.5 },
    { "phrase": "p4", "action": "move", "target": "reactor", "part": "barras", "dy": 40, "duration": 2 },
    { "phrase": "p5", "action": "paint", "target": "reactor", "part": "nucleo", "tone": "alert" },
    { "phrase": "p5", "action": "loop", "target": "reactor", "loop": "shake" },
    { "phrase": "p6", "action": "act", "target": "operador", "act": "recoil", "duration": 1.4 }
  ]
}
```

Si la idea empieza con "GRAFICO: tipo", arma ese grafico del catalogo y nada mas.

Fijate: el personaje actua, cada efecto tiene su causa y todo ocurre sobre un mismo suelo.

## Ejemplo: cantidad que pesa

```json
{
  "background": "dark",
  "elements": [
    { "id": "balanza", "kind": "drawing", "component": "balanza", "x": 50, "y": 34, "w": 60 },
    { "id": "lado_a", "kind": "drawing", "component": "persona", "x": 26, "y": 60, "w": 16, "repeat_count": 11, "repeat_columns": 6 },
    { "id": "lado_b", "kind": "drawing", "component": "persona", "x": 74, "y": 66, "w": 22, "repeat_count": 88, "repeat_columns": 13 },
    { "id": "n_a", "kind": "label", "text": "11", "x": 26, "y": 48 },
    { "id": "n_b", "kind": "label", "text": "88", "x": 74, "y": 48 }
  ],
  "steps": [
    { "phrase": "p2", "word": "calculo", "action": "camera", "target": "balanza", "zoom": 1.3 },
    { "phrase": "p3", "word": "cinturones", "action": "camera", "target": "lado_a", "zoom": 1.5 },
    { "phrase": "p3", "word": "once", "action": "show", "target": "lado_a", "stagger": 0.05 },
    { "phrase": "p3", "word": "once", "action": "show", "target": "n_a" },
    { "phrase": "p4", "word": "despedidos", "action": "rotate", "target": "balanza", "part": "viga", "deg": -3 },
    { "phrase": "p5", "word": "ochenta", "action": "camera", "target": "balanza", "zoom": 1 },
    { "phrase": "p5", "word": "ochenta", "action": "show", "target": "lado_b", "stagger": 0.02 },
    { "phrase": "p5", "word": "ocho", "action": "show", "target": "n_b" },
    { "phrase": "p5", "word": "muertes", "action": "paint", "target": "lado_b", "tone": "alert" },
    { "phrase": "p6", "word": "dejado", "action": "rotate", "target": "balanza", "part": "viga", "deg": 13, "duration": 2 }
  ]
}
```

Cada cambio cae en su palabra y la pantalla nunca queda igual mucho tiempo. Una linea, un triangulo y figuras alcanzan.
