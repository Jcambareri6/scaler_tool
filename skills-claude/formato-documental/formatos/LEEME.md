# Formatos

Cada archivo `.json` es un formato (estilo). Los 12 de Skaler salen tal cual de `backend/src/lib/documentalStyles.ts`. Qué hace cada campo: `../referencia/formato.md`, sección 9.

## Sumar un formato

1. Copiar `_plantilla.json` como `<id>.json` (id en minúsculas, sin espacios).
2. Completar los campos. Lo mínimo: `id`, `name`, `description`, `script`, `plan.prefer`, `graphics.favor`, `look` y `sound.mood`.
3. Si viene de un video de referencia, ponerlo en `referencias`. Esos videos se estudian, **nunca** se usan como metraje.
4. Lo que no entra en los campos (marcos propios, cómo arranca el video, qué evitar) va en `notas`. La skill lo lee antes de armar el plan.

## Sacar un formato de un video de referencia

Cuando el usuario pasa un video o un canal y dice "quiero este formato":

1. Bajar el video en baja calidad (o pedírselo al usuario) y armar hojas de contactos: `python scripts/hoja_contactos.py ref.mp4 ref.jpg --cuadros 48`.
2. Medir el ritmo con detección de cortes: `ffmpeg -i ref.mp4 -vf "select='gt(scene,0.3)',showinfo" -f null -` → segundos promedio por plano, y aparte el del primer minuto.
3. Mirar y anotar:
   - Proporción de clases de plano (persona, lugar, cosa, metraje, ambiente, mapa, gráfico) → `plan.prefer` y `plan.durations`.
   - Gráficos por minuto y cuáles se repiten → `plan.graphicsPerMinute`, `graphics.favor` y `graphics.forbid`.
   - Archivo o material actual, color o blanco y negro, grano, viñeta → `sources` y `look`.
   - Subtítulos: fuente, tamaño, palabras por línea, mayúsculas → `captions`.
   - Música y efectos → `sound`.
   - Estructura del guion (cómo arranca, cuánto contexto, dónde está el giro) → `script.skeleton` y `script.tone`.
4. Escribir el JSON y mostrarle al usuario una tabla corta: qué se midió y qué valor quedó.
5. Probar con un tema corto (60 a 90 s) antes de un video largo.

## Pasarlo a Skaler

Cuando el formato funciona en la skill, se agrega a `DOCUMENTAL_STYLES` en `backend/src/lib/documentalStyles.ts` con los mismos campos (`referencias` y `notas` no existen ahí: van como comentario). La galería del front lo muestra sola.
