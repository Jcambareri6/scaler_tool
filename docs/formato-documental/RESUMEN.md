# Formato documental animado — resumen

## La idea en una línea
**La IA decide qué se muestra; el código decide dónde y cómo se ve.**

## Qué aprendimos de la referencia (Ciencia y Vida, estilo de los videos de trenes)
- **Pocas distribuciones fijas que se repiten; lo que cambia es el contenido.** Por ejemplo, la curva con velocímetro aparece 3 veces en el mismo lugar y solo cambian los números.
- Siempre en el mismo lugar: título arriba a la izquierda, capítulo arriba a la derecha, subtítulo abajo al centro, línea del suelo fija.
- Fondo **claro** para mecanismos ("cómo funciona") y **oscuro** para datos, lugares y giros.
- Colores con significado: **rojo = peligro, verde = seguro, azul solo para el texto resaltado.**
- Ritmo: casi sin cortes (fundidos), nunca una pantalla congelada, quietud de 3–5 s mientras habla la voz y **remate seco (< 0,4 s) en la palabra clave**.
- Sin explosiones: los eventos son "contenidos" (zigzag + halo rojo + etiqueta).

## Qué está bien y qué falla hoy en Skaler
- ✅ **La sincronía por palabra es perfecta.** No se toca.
- ❌ Segundos congelados (11 de 30), azul en todo, zoom que hace saltar el encuadre, coordenadas que elige la IA (solapes y objetos cortados), explosión azul, rojo antes del remate.
- **8 de 10 problemas son del motor, no de la IA.**

## Lo que ya está hecho
- Análisis completo de la referencia + catálogo de 22 recursos.
- **Clip modelo** de 30 s hecho a mano (sin IA): 0 segundos congelados, aprobado.
- Script de métricas sin IA (`medir-movimiento.py`).
- Todo en la rama `formato-documental`. Detalle en `INFORME.md`.

## Cómo va a funcionar
1. **Entrada:** título + guion → voz → tiempos por palabra.
2. **Plan (Opus, 1 llamada por video):** por cada momento importante elige el **recurso**, completa el **contenido** del guion y marca la **palabra de remate** y el **fondo**. Sin colores, posiciones ni zoom.
3. **Control del plan, en texto y antes de animar:** datos solo del guion, nada rojo antes del remate, variedad de recursos.
4. **Escenas (Sonnet o Haiku):** solo completan los espacios del recurso.
5. **Motor (código):** cada recurso tiene sus lugares fijos; los dibujos se escalan a su lugar, las cantidades se reparten en grilla y las etiquetas prueban posiciones hasta no chocar. Le suma colores por significado, movimiento de base, subtítulos, fundidos y fechas DD/MM/AAAA.
6. **Control final:** métricas de código + 1 revisión visual con una hoja de cuadros. Como máximo 1 corrección; si no mejora, la escena pasa a un recurso seguro.
7. **Salida:** preview → render.

## Fases propuestas
| Fase | Qué | Cómo se sabe que salió bien |
|---|---|---|
| 1 | **Base del motor:** colores con significado, movimiento de base, sin zoom (con lupa), fundidos, fechas, subtítulos activos | Re-render de Chernobyl: ≤ 2 segundos congelados cada 30 s |
| 2 | **Primeros 4 recursos** a partir del clip modelo: `ubicacion`, `mecanismo`, `contraste`, `evento` | El clip modelo sale igual, armado desde un JSON chico |
| 3 | **Nuevo formato del plan:** recurso + contenido + palabras, sin coordenadas | La IA genera el plan de Chernobyl y el resultado se parece al clip modelo |
| 4 | **Agentes simplificados:** 1 llamada de plan, control en texto, 1 revisión visual | Menor costo por video y sin rondas que oscilan |
| 5 | **Más recursos** (balanza, A/B, pictogramas, contador, barras, documento, lección…) + prueba con 8–10 guiones de nichos distintos | Métricas parejas en todos los nichos |
