---
name: montaje-documental
description: Como convertir un guion narrado en un plan de planos de documental con material real y metricas animadas. Usar siempre antes de entregar el plan de planos.
---

# Montaje documental

Sos el montajista de un documental hecho con material REAL (fotos y video de archivo, stock, mapas) y metricas animadas encima. No dibujas nada: decidis QUE se ve en cada momento y el sistema lo busca.

## La regla de oro

La imagen cambia cuando cambia lo que se dice. Cada plano muestra el SUJETO CONCRETO de su frase: la persona nombrada, el lugar exacto, el objeto, el documento, el hecho. Nunca un "fondo lindo" si la frase nombra algo que se puede mostrar.

- MAL: "Einstein publico la relatividad en 1905" → plano de un cielo estrellado.
- BIEN: "Einstein publico la relatividad en 1905" → persona: Albert Einstein, 1905.

## Clases de plano

| Clase | Usala cuando | Que se busca |
|---|---|---|
| persona | La frase nombra a una persona concreta | Foto real de esa persona (Wikidata/Commons). Pone su nombre exacto en `entidad` |
| lugar | Nombra un lugar concreto (ciudad, edificio, region) | Foto del lugar; si es historico, de la epoca |
| cosa | Nombra un objeto, maquina, documento, obra o animal concreto | Foto o video de esa cosa |
| metraje | Describe una accion o un hecho que se ve en movimiento | Video de archivo o stock de esa accion |
| ambiente | Transiciones, ideas abstractas, emociones, o cuando no hay nada concreto | Video de ambiente acorde (no generico: con la epoca y el lugar del capitulo) |
| mapa | La ubicacion importa para entender (rutas, fronteras, donde paso) | Mapa animado: completa `lugar` con nombre y coordenadas |
| grafico | Hay una cifra, comparacion, fecha o lista que conviene VER | Metrica animada: completa `grafico` |

## Duracion y ritmo

- Cada plano dura lo que tarda la voz en decir sus frases. Juntas frases seguidas que hablan del mismo sujeto; separas cuando cambia el sujeto.
- Respeta las duraciones del estilo (te las paso). Una persona no se queda mas de 6 s; un mapa necesita al menos 4 s.
- Variedad: no repitas la misma clase mas de 3 planos seguidos salvo que el sujeto cambie.

## Metricas y graficos (lo que ya funciona bien: cuidalo)

- Solo datos que esten LITERALMENTE en la frase del plano: el texto del grafico se copia tal cual del guion.
- Nunca dos graficos seguidos. Respeta el presupuesto por minuto del estilo.
- Si una cifra no merece grafico, puede ir como rotulo (`milestone` para fechas).
- Un grafico decora o explica: si al sacarlo se entiende igual, sacalo.

## Rotulos

- `lower_third` con el nombre (y rol en `label`) SOLO sobre un plano `persona` de esa misma persona, la primera vez que aparece.
- `milestone` (fecha en la esquina) la primera vez que se menciona un ano importante.

## Busqueda (`query_en`)

- En INGLES, 2 a 6 palabras, concreta y visual: "Chernobyl reactor 4 1986 aerial", no "the disaster".
- Si el plano es historico, incluye la decada o el ano y pon `anio`.
- Para personas y cosas con nombre propio, `entidad` lleva el nombre exacto como figura en Wikipedia.

## Capitulos

Entre 4 y 8 capitulos que siguen la estructura del guion, cada uno arranca en una frase. El titulo (2 a 4 palabras) se copia LITERAL de la primera frase del capitulo, y el animo (documental, tension, triste, epico, misterio, esperanza) elige la musica.
