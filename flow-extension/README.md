# Extensión Scaler Tool → Google Flow

Manda el prompt de cada escena a Google Flow, espera la imagen (o el video),
la descarga y la carga sola en su escena de Scaler Tool. Corre en **tu**
Chrome, con **tu** sesión de Flow: usa los créditos de tu plan y la app
nunca ve tu cuenta de Google.

## Instalar (modo desarrollador)

1. Chrome → `chrome://extensions`
2. Activar **Modo de desarrollador** (arriba a la derecha).
3. **Cargar descomprimida** → elegir esta carpeta (`flow-extension/`).
4. Fijar el ícono de la extensión en la barra.

Si cambiás algo del código: botón ↻ de la extensión en `chrome://extensions`
y recargar la pestaña de Flow.

## Usar

1. Levantá el backend (`cd backend && npm run dev`) o usá el deployado.
2. Abrí Scaler Tool (`localhost:8443`) e iniciá sesión: la extensión toma
   esa sesión sola (`app-bridge.js`) y se conecta con tu usuario, sin login
   aparte. Usa el refresh token de la app para renovarse cuando vence el
   access token, y si cerrás sesión en la app también se desconecta.
   (Sesiones iniciadas antes de este cambio no guardaban el refresh token:
   cerrá sesión y volvé a entrar una vez.) Como alternativa, en *Conectar a
   mano* sigue el login con email/contraseña.
3. Elegí el proyecto → *Cargar prompts del proyecto* (los arma la IA la
   primera vez y quedan guardados en cada escena; se pueden editar desde la
   app en Escenas → *Imágenes en lote (Flow)*).
   - *Solo escenas sin visual* y *Desde escena N* para completar lo que falte.
4. Abrí Google Flow (`flow.google.com`) en otra pestaña, entrá a un proyecto y dejá elegido el
   modo (**imagen** o **video**) y el formato **16:9**.
5. En la extensión: **▶ Empezar**. Podés cerrar el popup: sigue solo. No
   cierres ni recargues la pestaña de Flow mientras corre.

Cada escena va pasando por *en cola → generando → ✓ cargada*. Si una falla
(Flow rechaza el prompt, tarda demasiado, etc.) se reintenta según
*Reintentos*; si sigue fallando queda en **✗ error** con el motivo y la
corrida sigue con la próxima. Al final: **↻ Reintentar fallidas**. Si querés
cambiar el prompt de una que falló, editalo en la app y volvé a *Cargar
prompts* con *Solo escenas sin visual*.

## Diseño visual y continuidad entre escenas

Los prompts que manda la extensión los arma la app así:

1. Lee el **guion completo con sus timestamps** junto con el **diseño visual
   del canal** (Equipo → *Plantilla del canal*) y arma la **biblia visual**
   del video: personajes con descripción fija, lugares, época, paleta y cómo
   evoluciona la historia.
2. Escribe los prompts por tramos de escenas consecutivas siguiendo esa
   biblia y las instrucciones del equipo ("prompt imágenes con
   timestamps"): cada prompt es autosuficiente, repite la descripción exacta
   de los personajes y no repite la composición de la escena anterior.

La biblia se puede ver y corregir en la app (Escenas → *Imágenes en lote* →
*Biblia visual del video*). Si cambiás el diseño, la biblia o el guion, al
volver a tocar *Cargar prompts del proyecto* se rehacen solos los prompts
viejos (los que editaste a mano no se tocan; para esos usá *Otro prompt*).

## Si Flow cambia y deja de andar

Flow no tiene API: la extensión "maneja" la página como lo harías vos. Si
Google cambia el diseño:

1. **Avanzado → Probar detección en la pestaña de Flow** dice si encuentra el
   cuadro de prompt y el botón de generar.
2. Si no los encuentra: clic derecho sobre el elemento en Flow →
   *Inspeccionar* → copiá un selector CSS (ej. `#id` o `textarea[...]`) y
   pegalo en *Selector del cuadro de prompt* / *del botón generar* →
   *Guardar*.
3. *Selector de resultados* sirve si toma imágenes que no son el resultado
   (por defecto toma cualquier `img`/`video` nuevo de más de 200 px que
   aparezca después de apretar generar).

## Cómo funciona

- `popup.*` — conexión, elección de proyecto, cola y progreso.
- `content.js` — corre dentro de Flow: escribe el prompt, aprieta generar,
  detecta el resultado nuevo y lo descarga. Toma el **primero** de las
  variantes que devuelve Flow.
- `background.js` — habla con el backend (`/image-prompts` y
  `/batch-visuals`, los mismos endpoints que usa la carga en lote de la app)
  y baja los resultados que Flow sirve desde otros dominios.
- El estado vive en `chrome.storage.local`: si cerrás el popup o se recarga
  Flow, la cola no se pierde (la escena que estaba a medias vuelve a la cola).

Nota: lo que se descarga es la imagen tal como Flow la muestra en la
página, que puede tener menos resolución que el botón "Descargar" de Flow.
