---
name: formato-documental
description: Hacer videos documentales con material real (fotos, archivo y clips de YouTube o del usuario) y el look de un formato, como el formato documental de Skaler. Usar cuando pidan un documental, un video con metraje real a partir de un guion, bajar clips para un video, o sumar o probar un formato nuevo de video.
---

# Formato documental

Documental con material **real** elegido plano a plano, con el look de un **formato**. La IA decide **qué** se ve; los scripts deciden **cómo** se ve.

Antes de empezar, leer:
- `referencia/formato.md`: el formato completo (clases de plano, reglas del montaje, fuentes, juez, render).
- `referencia/graficos.md`: los tipos de gráfico animado.
- El JSON del formato elegido en `formatos/`. Si tiene `notas` o `referencias`, leerlas.

Scripts en `scripts/` (Python 3.10+, ffmpeg y yt-dlp; `faster-whisper` para los tiempos por palabra). Corren igual en Linux, macOS y Windows.

## Flujo

1. **Formato.** Si el usuario no lo dice, proponer uno de `formatos/` según el tema (tabla en `referencia/formato.md`, sección 9). Si pasa un formato nuevo, ver la sección "Formatos nuevos" abajo.
2. **Guion.** Con `script.skeleton` y `script.tone` del formato. Nombrar personas, lugares, fechas y cifras: eso es lo que después se muestra. ~150 palabras por minuto. Verificar los datos; no inventar cifras. Guardarlo en `guion.txt` (solo lo que se narra).
3. **Voz.** El usuario sube `voz.mp3` (o se genera con TTS).
4. **Tiempos por palabra.**
   `python scripts/palabras.py voz.mp3 guion.txt palabras.json`
5. **Plan.** Armar `plan.json` con el formato de `referencia/formato.md`, sección 4, siguiendo **todas** las reglas de la sección 5 y los valores del formato (duraciones, `prefer`, presupuesto de gráficos, `favor`/`forbid`). Los planos arrancan en la palabra que nombra lo que se ve. Antes de buscar, revisar el plan contra la lista de la sección 5 y mostrarle al usuario una tabla corta (n, tiempo, clase, sujeto, búsqueda, gráfico).
6. **Material**, plano por plano, en el orden de fuentes de la sección 6:
   - Clips que pasó el usuario: primero esos. Armar su hoja (`python scripts/hoja_contactos.py clip.mp4 hoja.jpg`), elegir el momento y cortarlo (`python scripts/bajar_tramo.py clip.mp4 --momento 95 --dur 4.5 --salida planos/03.mp4`).
   - YouTube: `python scripts/buscar_youtube.py "<query>"` (y otra vez con `query_local`). Elegir por título y miniatura, armar la hoja de cuadros del candidato y recién ahí bajar solo el tramo: `python scripts/bajar_tramo.py URL --momento <segundo> --dur <s> --salida planos/NN.mp4 [--logo br]`.
   - Fotos (Wikidata, Commons, Openverse, archive.org): bajarlas a `planos/` y guardar autor, licencia y página para los créditos. Solo dominio público, CC0, CC BY y CC BY-SA.
7. **Juez.** Mirar cada candidato (miniatura u hoja) contra la frase y decidir con los códigos de la sección 7. Ser estricto: si nada sirve, buscar otra vez con `respaldo` o pasar al rescate (sección 6.3). Nunca aprobar por cortesía.
8. **Revisión.** `python scripts/hoja_contactos.py planos/ hoja_video.jpg` y revisar el video entero: sin planos repetidos, sin relleno seguido, nada de otra época u otro lugar. Corregir lo que falle (como mucho una vuelta por plano).
9. **Montaje.** Completar `archivo` en cada plano y:
   `python scripts/montar.py plan.json --formato formatos/<id>.json --voz voz.mp3 --palabras palabras.json --salida video.mp4 [--musica musica.mp3] [--borrador]`
   Primero con `--borrador` (720p, rápido). El script imprime el QC: negros, congelados y LUFS (tiene que dar −14).
10. **Entrega.** El MP4, los capítulos (`MM:SS Título`) y los créditos de cada foto y clip para la descripción de YouTube.

## Formatos nuevos

El usuario va a pasar formatos para sumar, como JSON, como texto o como un video de referencia.
- Copiar `formatos/_plantilla.json` y completarla. Cómo sacar los valores de un video de referencia: `formatos/LEEME.md`.
- Si algo del formato no entra en los campos, va en `notas` y se respeta en el plan.
- Probar con un tema corto (60 a 90 s) y mostrar el borrador antes de un video largo.
- Si el formato pide algo que el motor no hace (un marco propio, una transición especial), decirlo y proponer cómo hacerlo.

## Reglas

- **La imagen cambia cuando cambia lo que se dice.** Cada plano muestra el sujeto concreto de su frase, nunca un "fondo lindo" si la frase nombra algo que se puede mostrar.
- Los gráficos solo con datos que están **literalmente** en el guion.
- Nada de presentadores a cámara, vloggers, reacciones, ficción, animación, CGI ni marcas de agua. Un logo chico de canal en una esquina se recorta (`--logo`).
- Ningún corte de plano dentro de un plano (`bajar_tramo.py` ya lo evita).
- YouTube es material con copyright sin licencia verificada: sirve para probar el formato. Para publicar, avisarle al usuario y preferir sus clips o material con licencia.
- Si YouTube bloquea la descarga desde el servidor (bot check, 429), poner un proxy residencial en `YTDLP_PROXY` o darle al usuario el comando para bajar el tramo en su PC:
  `yt-dlp --download-sections "*95-110" -f "bv*[height<=1080]" -o "%(id)s_95.mp4" URL`
- Los videos de referencia se estudian, nunca se usan como metraje.
- Probar primero con poco material; si funciona, recién ahí el video largo.
