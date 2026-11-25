# Formato documental de Skaler: descripción completa

Este archivo describe el formato documental tal como está hecho en el backend de Skaler (`backend/src/pipeline/documentalPipeline.ts` y sus piezas), para hacer lo mismo desde una skill de Claude, sin la base de datos ni el worker.

## 1. La idea

Un documental hecho con **material real** (fotos y video de archivo, metraje filmado, mapas) y **gráficos animados encima**. No se dibuja nada: en cada momento se decide **qué se ve**, se busca y un juez con visión elige.

- La IA decide **qué** se muestra. El código decide **dónde y cómo** se ve: duraciones, colores, movimientos y cortes.
- **La imagen cambia cuando cambia lo que se dice.** Cada plano muestra el sujeto concreto de su frase: la persona nombrada, el lugar exacto, el objeto, el hecho.
- Un **formato** o **estilo** es un conjunto de valores sobre el mismo motor, no un flujo propio. Ver la sección 9.

## 2. Flujo completo

| # | Paso | En Skaler | En la skill |
|---|---|---|---|
| 1 | Guion | `generate_script` con el `script.skeleton` y el `script.tone` del estilo | Claude escribe el guion con el esqueleto del formato |
| 2 | Voz | TTS (ElevenLabs, ai33 o Edge) | El usuario sube `voz.mp3` o se genera con TTS |
| 3 | Tiempos por palabra | Whisper (`transcribeAudio`) + alineación con el guion (`wordAlignment.ts`) | `faster-whisper` con `word_timestamps` y alineación con `difflib` |
| 4 | Plan de planos | **Montajista** (Sonnet, una llamada): `director/montajista.ts` + skill `montaje-documental` | Claude arma `plan.json` (sección 4) |
| 5 | Verificador | Código, sin volver al modelo: cobertura, duraciones, presupuesto de gráficos | Claude revisa el plan con la lista de la sección 5 |
| 6 | Lugares y datos | Geocodificador (`geocode.ts`) y Banco Mundial (`datosAbiertos.ts`) | Coordenadas reales; datos solo si están en una fuente pública |
| 7 | Biblioteca del video | Busca en YouTube todas las búsquedas del plan una sola vez, arma hojas de 16 cuadros y marca los cuadros aptos (`documentalLibrary.ts`) | `scripts/buscar_youtube.sh` + `scripts/hoja_contactos.sh` |
| 8 | Fuentes por plano | Cadena por clase (sección 6) | Lo mismo, más los clips que pase el usuario |
| 9 | Juez visual | Haiku con visión elige o rechaza candidatos con códigos (sección 7) | Claude mira las hojas de contactos y decide |
| 10 | Bajar el tramo | Solo el pedazo que se usa, sin audio, limpio (sección 8) | `scripts/bajar_tramo.py` |
| 11 | Rescate | Planos sin material: otro momento del mismo video, foto del tema, stock con juez y, al final, imagen IA o rótulo | Reglas de la sección 6.3 |
| 12 | QA | Brillo y vacíos sin modelo; QA final con visión en tandas; topes de pantalla; control de relleno seguido | Hoja de contactos del video entero y la lista de la sección 10 |
| 13 | Render | Look del estilo, movimiento en fotos, cortes de zoom, subtítulos, gráficos de Remotion, música con ducking, efectos, −14 LUFS | `scripts/montar.py` (look, movimiento, voz, música); los gráficos animados quedan para Skaler |
| 14 | Entrega | MP4 + capítulos + créditos para la descripción de YouTube | Igual |

## 3. Clases de plano

| Clase | Cuándo | Qué se busca | Duración base |
|---|---|---|---|
| `persona` | La frase nombra a una persona concreta | Retrato real de esa persona (Wikidata, Commons). `entidad` = nombre exacto de Wikipedia | 3,2–6 s |
| `lugar` | Nombra un lugar concreto | Foto o video del lugar; si es histórico, de la época | 3–9 s |
| `cosa` | Nombra un objeto, máquina, documento, obra o animal concreto | Foto o video de esa cosa | 2,5–8 s |
| `metraje` | Un hecho, una acción o un sujeto real filmado | Video real de archivo o metraje filmado; `anio` si es histórico | 2,5–9 s |
| `ambiente` | Solo transiciones e ideas abstractas | Fotos libres del tema; el stock es el último recurso. Como mucho el 20 % de los planos | 2,5–9 s |
| `mapa` | La ubicación importa para entender | Mapa animado (`map_marker`, `map_globe`); no se busca material. Uno cada 45 s como mucho, nunca dos seguidos | 4–7 s |
| `grafico` | Una cifra, una comparación, una fecha o una lista que conviene ver | Gráfico animado con texto literal del guion | 3–9 s |

## 4. El plan (`plan.json`)

Es la salida del montajista. Los planos se anclan a **palabras** (índices de las palabras de Whisper), no a frases.

```json
{
  "tema": "El desastre de Chernóbil",
  "formato": "profundo",
  "lugar_historia": "Ucrania (URSS)",
  "capitulos": [
    { "titulo": "La central", "desde": 1, "animo": "documental" },
    { "titulo": "La noche del 26", "desde": 9, "animo": "tension" }
  ],
  "planos": [
    {
      "n": 1,
      "desde_palabra": 0,
      "hasta_palabra": 11,
      "inicio": 0.0,
      "fin": 3.4,
      "frase": "El 26 de abril de 1986, el reactor 4 de Chernóbil explotó.",
      "clase": "metraje",
      "sujeto": "Reactor 4 destruido",
      "query": "Chernobyl reactor 4 1986 aerial",
      "query_local": "Чернобыль 4 энергоблок 1986",
      "respaldo": ["Chernobyl power plant 1986 footage"],
      "entidad": null,
      "anio": 1986,
      "obligatorio": ["reactor destruido"],
      "grafico": null,
      "rotulo": { "type": "milestone", "text": "La explosión", "label": "26/04/1986" },
      "capitulo": null
    }
  ]
}
```

Campos:

- `clase`, `sujeto`, `query` (en inglés, de 2 a 6 palabras, concreta y visual), `query_local` (en el idioma del lugar de la historia), `respaldo` (1 o 2 búsquedas de otro ángulo de la misma frase).
- `entidad`: nombre exacto de Wikipedia para `persona` y para `cosa` con nombre propio.
- `anio`: si el plano es histórico. Decide el orden de las fuentes y el código `epoca` del juez.
- `obligatorio`: lo que la frase nombra y **tiene** que verse. Va al juez.
- `lugar` (solo en `mapa`): `{ "nombre", "lat", "lon", "km" }`.
- `grafico` y `rotulo`: `{ "type", "text", "label", "items", "icon", "geo" }`. Los tipos están en `graficos.md`.
- `capitulo`: número de capítulo si el plano abre uno. Ese plano lleva solo la tarjeta del capítulo.

## 5. Reglas del montaje (las verifica el código)

**Cobertura y ritmo**
- Sin huecos: cada palabra cae en un plano.
- Los planos duran entre 2,5 y 9 s y arrancan en la palabra que nombra lo que se ve.
- Primer minuto: un plano por frase como mínimo, de 2,5 a 4 s, con preferencia por metraje en movimiento. La foto de la primera persona, un mapa del primer lugar y la primera fecha como `milestone`. Después del minuto, de 4 a 6 s.
- No repetir la misma clase más de 3 planos seguidos, salvo que cambie el sujeto.
- Una persona no queda más de 6 s y un mapa necesita al menos 4 s.
- Topes de pantalla: un rótulo solo, 3 s; una foto del tema (rescate), 4 s. Si se pasa, se parte el plano o se alargan los vecinos.
- Nunca 2 planos de relleno seguidos (mapa, rótulo o textura).

**Gráficos**
- Solo datos que están **literalmente** en la frase del plano o en la de al lado. El texto se copia del guion. Excepción: el nombre del lugar en `map_marker` y la etiqueta corta de un `milestone`.
- Nunca dos gráficos seguidos y con la separación mínima del formato (`minGraphicGapSeconds`).
- Presupuesto del formato: `graphicsPerMinute`, `graphicsPerMinuteHook` (primer minuto) y `maxGraphicShare` (% del tiempo). Lo que no entra pasa a rótulo (`big_number` → `milestone`).
- Mapas animados: uno cada 35 s como mucho.
- Solo tipos de `graphics.favor` del formato, nunca de `graphics.forbid`.
- Si al sacar el gráfico se entiende igual, se saca. Las frases de transición no llevan gráfico.
- Metáforas: se muestra el sujeto real, no el objeto de la comparación.

**Rótulos**
- `lower_third` con nombre y rol solo sobre un plano `persona` de esa persona, la primera vez que aparece.
- `milestone` la primera vez que se dice un año importante. Fechas en formato DD/MM/AAAA.

**Capítulos**
- De 4 a 6, solo donde el guion cambia de parte, nunca en los primeros 20 s.
- Título de 2 a 4 palabras, sin números ("El barco", "El choque", "Las consecuencias").
- `animo` elige la música: `documental`, `tension`, `triste`, `epico`, `misterio`, `esperanza`.
- Tarjeta en pantalla solo en videos de 3 min o más, capítulos de 60 s o más y con 90 s entre tarjetas.

## 6. Fuentes

### 6.1 Orden por clase (`sourceChain`)

| Clase | Orden (histórico = `anio` < 1990) |
|---|---|
| `persona` | Wikidata → Commons → Openverse |
| `lugar` | histórico: Commons → archive.org → YouTube → Openverse; actual: YouTube → Commons → Openverse |
| `cosa` | con `entidad`: Wikidata → Commons → YouTube → Openverse; sin `entidad`: Commons → YouTube → Openverse |
| `metraje` | archivo primero o histórico: archive.org → YouTube → Commons; si no: YouTube → archive.org → Commons |
| `ambiente`, `grafico` | histórico: archive.org → Openverse → Commons; si no: Openverse → Commons → YouTube |
| `mapa` | ninguna (mapa animado) |

El stock (Pexels, Pixabay, Coverr) no está en la cadena: solo entra en el rescate y con juez. Si `sources.archiveFirst` es `true`, el metraje va siempre primero a archivo.

Licencias aceptadas: dominio público, CC0, CC BY y CC BY-SA. Se descartan NC y ND. Cada asset guarda `license`, `author` y `source_page` para los créditos.

### 6.2 YouTube

- **Búsqueda**: `yt-dlp "ytsearch8:<query>" --flat-playlist -J`. Se descartan directos, videos de menos de 60 s o de más de 3 h, títulos de listas ("top 10", "curiosidades") y canales de podcast, clips, reacciones, vlogs o entrevistas. Se ordena por palabras de la búsqueda en el título, palabras de metraje limpio ("drone", "aerial", "footage", "archive", "1950s") y duración entre 2 y 30 min. Quedan 4 candidatos.
- **Búsqueda doble**: `query` en inglés y `query_local` en el idioma del lugar (un tema de México tiene más metraje en castellano).
- **Momento**: con subtítulos del video se buscan las palabras del plano (`subtitleMoments`); si no, los cuadros aptos de la hoja; si no, el 30 % del video. Nunca dentro de la intro (los primeros 10 a 30 s).
- **Usos**: un mismo video se usa varias veces en momentos distintos, con un tope según el largo del documental (`ytMaxUses`).
- **Licencia**: en Skaler, YouTube está apagado salvo `DOCUMENTAL_YOUTUBE=on` y busca en todo YouTube. En la skill la búsqueda usa el filtro Creative Commons de YouTube (`sp=EgIwAQ%3D%3D`) y confirma el campo `license` de cada video antes de bajarlo. Si no es CC BY, no se baja salvo que el usuario declare sus derechos (`--licencia`). Cada tramo guarda su crédito (`.credito.json`) y `creditos.py` arma el texto para la descripción.

### 6.3 Rescate (planos sin material)

En este orden:
1. Otro momento apto de un video de YouTube ya aprobado para el mismo tema.
2. Foto del tema (b-roll de la misma historia) con el juez de tema.
3. Stock con juez.
4. Imagen IA (SnapGen) con el estilo del formato.
5. Mapa satelital del lugar de la historia o rótulo de texto.

## 7. Juez visual

Mira candidatos (miniatura o hoja de cuadros) y lo que dice la voz en ese momento. Devuelve:

```json
{ "justificacion": "...", "elegido": 2, "veredictos": [
  { "i": 0, "codigo": "generico", "motivo": "playa cualquiera", "camara": false, "marca": false, "logo_esquina": null },
  { "i": 2, "codigo": "ok", "motivo": "sala de control real", "camara": false, "marca": false, "logo_esquina": "br", "cuadro": 7, "cuadros_ok": [5, 6, 7, 8] }
] }
```

| Código | Significa |
|---|---|
| `ok` | Muestra el sujeto de la frase y sirve en un documental serio |
| `generico` | Relleno que podría ir en cualquier video. También: presentador a cámara, reacción, recopilación, animación |
| `equivocado` | Otra cosa, otro lugar u otro hecho, aunque se parezca. Si el título nombra otro lugar, es equivocado |
| `persona` | Otra persona, o no es un retrato de la persona nombrada (placa, tumba, monumento, foto grupal) |
| `epoca` | Plano histórico con cosas modernas, o al revés |
| `texto` | Texto, subtítulos o gráficos quemados |
| `oscuro` | Muy oscuro, borroso o de baja calidad |
| `marca_agua` | Marca de agua o logo grande |
| `ficcion` | Película, serie, dramatización, animación, CGI, videojuego o remix |

- `camara: true` (alguien mira o habla a cámara) o `marca: true` descartan el candidato.
- Un logo **chico** de canal en una sola esquina no descarta: se recorta (`logo_esquina`: `tl`, `tr`, `bl` o `br`).
- Para `ambiente` alcanza con que sea coherente con la frase, la época y el lugar.
- Si ninguno sirve, `elegido: null`. No se aprueba por cortesía.
- **Juez de tema** (rescate): la pregunta cambia de "¿es la cosa?" a "¿es de esta historia?" (mismo país, lugar y época).

## 8. Bajar y limpiar el tramo de YouTube

Qué hace `downloadYouTubeSegment` + `cleanSegment` (y `scripts/bajar_tramo.py`):

1. Largo a bajar: `min(necesario × 1,25 + 6, 24)` s, con el necesario entre 2,5 y 12 s.
2. Inicio: el momento elegido menos 2 s, nunca dentro de la intro ni pegado al final.
3. `yt-dlp --download-sections "*inicio-fin" --force-keyframes-at-cuts --remux-video mp4`: solo ese tramo. Con proxy residencial si YouTube bloquea la IP (`YTDLP_PROXY`). Alternativa: Apify.
4. Detecta cortes de plano (`select='gt(scene,0.22)'`) y negros (`blackdetect`), y se queda con el pedazo continuo más largo cerca del centro: **ningún corte dentro del plano**.
5. Descarta el tramo si más del 80 % está quieto (`freezedetect`).
6. Recorta barras negras (`cropdetect`) y el logo de la esquina (recorte del 16 %).
7. Si el pedazo limpio es más corto que el plano, lo ralentiza hasta 0,5×.
8. Sin audio, H.264 CRF 20, `yuv420p`, `+faststart`.

## 9. Formatos (estilos)

Cada formato es un JSON con estos bloques (ver `formatos/_plantilla.json` y los 12 de Skaler en `formatos/`):

| Bloque | Qué decide |
|---|---|
| `id`, `name`, `description`, `idealFor`, `examples`, `category` | Identidad y galería |
| `script.skeleton`, `script.tone` | Estructura del guion (gancho, contexto, desarrollo, hecho, consecuencias, cierre) y tono |
| `plan.durations` | Rango de segundos por clase de plano |
| `plan.prefer` | Clases que se prefieren cuando hay duda, en orden |
| `plan.graphicsPerMinute`, `graphicsPerMinuteHook`, `maxGraphicShare`, `minGraphicGapSeconds` | Presupuesto de gráficos |
| `sources.archiveFirst`, `sources.epochHint` | Archivo antes que YouTube o stock y qué tipo de archivo |
| `graphics.favor`, `graphics.forbid`, `graphics.palette`, `graphics.mapBase` | Qué gráficos usar, paleta y fondo de mapas (`satellite` o `dark`) |
| `look.contrast`, `saturation`, `brightness`, `vignette`, `layer` | Gradación de color y capa (`bn`, `old_movie`, `paper`) |
| `look.flashEvery`, `look.zoomCutEvery` | Destello cálido cada N planos y cortes de zoom dentro de los clips cada N s |
| `captions.font`, `size`, `words`, `uppercase` | Subtítulos (5 palabras por línea, Roboto Condensed 54 px a 1080p por defecto) |
| `sound.mood`, `musicVolume`, `duckTo`, `sfxVolume` | Música (22 % sin voz, al 35 % de eso con voz) y efectos |
| `mapaCartoon` (opcional) | El video entero como mapa explicativo |

| Formato | Para qué | Rasgos |
|---|---|---|
| `documental` | Cualquier tema con rigor | 5 gráficos/min, look neutro |
| `clasico` | Biografías y hechos históricos | Personas primero, 2 gráficos/min |
| `profundo` | Guerras, operaciones, misiones | Archivo primero, más contraste, música de tensión |
| `expediente` | Crímenes y misterios | Citas, fechas y documentos; fuente Special Elite |
| `horizonte` | Países, población, economía | Gráficos de datos reales, 45 % del tiempo con gráficos |
| `locomotoras` | Máquinas, ingeniería, rutas | Cosas primero, mapas y fichas técnicas |
| `almanaque` | Fichas de personajes, objetos y lugares | Pocos gráficos, archivo primero |
| `noticiero` | Actualidad | Cronologías y cifras, sin viñeta |
| `historia` | Imperios y civilizaciones | Pinturas y mapas antiguos, capa de papel, épico |
| `mapa` | Geografía y rutas | Todo el video como mapa explicativo |
| `collage` | Historias, cultura, conspiraciones | Capa de papel, misterio |
| `nocturno` | Guerra fría y espionaje | Blanco y negro, grano, tensión |

## 10. Render y control de calidad

**Look por plano** (`lookFilter`): `eq=contrast:saturation:brightness`, destello cálido de 0,35 s cada `flashEvery` planos, capa (`bn`: grano; `old_movie`: grano + gamma; `paper`: tinte cálido) y viñeta.

**Movimiento en fotos** (`motionFor`): `zoom_in`, `pan_right`, `zoom_out`, `pan_left` y `push` (hacia el tercio superior), nunca el mismo que el plano anterior. Zoom máximo 1,12.

**Cortes de zoom en clips** (`zoomCutFilter`): alterna encuadre abierto (1,06) y cerrado (1,24) cada `zoomCutEvery` s, como si hubiera dos cámaras.

**Cortes**: secos entre planos; destellos como puntuación.

**Sonido**: música del ánimo del capítulo con ducking bajo la voz, efectos (`whoosh`, `hit`, `tick`, `paper`) al entrar un gráfico, con 6,5 s entre efectos y nunca en dos gráficos seguidos (sin `tick` en temas serios), silencios de música de ~1,2 s en hasta 2 cifras grandes, y el total normalizado a −14 LUFS.

**QC del MP4**: `blackdetect` (negros de más de 0,5 s), `freezedetect` (imagen congelada de más de 2 s) y `ebur128` (volumen).

**QA antes del render**:
- Planos oscuros o vacíos → rescate.
- Hoja de contactos del video entero, revisada en tandas con visión. Como mucho una corrección por plano; si no mejora, pasa a un plano seguro.
- Relleno seguido (2 o más planos de mapa, rótulo o textura) → aviso para la revisión.

**Entrega**: capítulos `MM:SS Título` y créditos de cada asset (autor, licencia, página) para la descripción de YouTube.
