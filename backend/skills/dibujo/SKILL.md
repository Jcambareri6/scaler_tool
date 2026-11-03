---
name: dibujo
description: Reglas para dibujar en SVG los componentes y personajes de un video animado, con partes moviles. Usar siempre antes de dibujar.
---

# Dibujo de componentes

Cada componente se dibuja una vez y se reutiliza. Tiene que entenderse de un vistazo, aun en tamano chico.

## Estilo

- Esquema minimo: lo menos posible para que se entienda. Una balanza es una linea y un triangulo. Si una forma no explica nada, sacala.
- Formas planas con uno o dos tonos, sin sombras, degradados, texturas ni detalles decorativos.
- Colores sobrios. Un solo acento por objeto: el color se reserva para lo que importa.
- Visto de costado salvo que la descripcion pida otra cosa, apoyado sobre la base del viewBox.
- Sin texto, letras ni numeros.
- `currentColor` para el cuerpo, `var(--accent)` para el detalle principal, hex solo si el objeto lo pide. Tiene que verse sobre fondo claro y oscuro.

## SVG

- Solo el contenido interno, sin la etiqueta svg: `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`.
- Atributos con comillas dobles. Coordenadas dentro de `0 0 width height`. Maximo 14000 caracteres.
- Cada pieza que pueda moverse va en un elemento con `id` en minusculas: `rueda_a`, `puerta`, `humo`, `barra_1`.
- Sin `transform` en un elemento con `id`: si hace falta, ponelo en un `g` de adentro.
- `data-pivot="50% 0%"` marca el punto de giro (la bisagra de una puerta).

## Personajes

Figura simple de color plano, sin cara, ropa ni detalles: cabeza redonda, torso tipo capsula, brazos y piernas como capsulas alargadas. Lo que cuenta es la pose. Si hace falta distinguir un rol, cambia el color o suma un solo objeto. Viewbox alto y angosto (por ejemplo 120 x 400).

Partes obligatorias, con estos nombres exactos:

| Parte | data-pivot |
|---|---|
| `cabeza` | `50% 100%` |
| `torso` | ninguno |
| `brazo_izq` | `50% 0%` |
| `brazo_der` | `50% 0%` |
| `pierna_izq` | `50% 0%` |
| `pierna_der` | `50% 0%` |

Cada parte queda como grupo propio, con el brazo y la pierna colgando rectos: el giro lo hace la animacion. El rol se nota por casco, delantal, gorra o herramienta, siempre dentro de una de esas partes.

## Animales y maquinas

Separa lo que se mueve: patas, cola, ruedas, helices, puertas, agujas y palancas, cada uno con su punto de giro.
