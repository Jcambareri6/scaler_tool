# mapa-cartoon: the animated explainer map

One shot is one JSON object (`escena`) for the `map_cartoon` template. Real satellite imagery is the background. On top of it, real countries (from world-atlas) become raised slabs of flat colour with a thin light edge. They rise into place, and the main one has a cartoon face. On top of the map: pipelines and dashed arrows that draw themselves, huge counting numbers, sticker icons that pop in, a speech-bubble title, a year with a rewind icon, and rotated sea or place names.

The look comes from geopolitics explainer channels: bold, readable and playful. Every shot shows ONE idea from its narration line, with 2-5 elements entering at the moment the narrator says them.

## Schema (all times in seconds from the start of the shot)
```json
{
  "centro": {"lat": 34.5, "lon": 104},
  "km": 5600,
  "paises": [{"nombre": "China", "color": "#E8312A", "en": 0.2, "cara": true, "animo": "feliz", "mira": [-0.7, 0.3], "tamCara": 28}],
  "rutas": [{"tipo": "tubo", "puntos": [[39.9, 116.4], [43.8, 87.6]], "en": 1.0, "dur": 1.3, "arco": -0.22, "color": "#E8312A"}],
  "cifra": {"texto": "12M", "sub": "barriles al día", "color": "#7CE36B", "en": 1.9, "coma": true, "hasta": 4},
  "anio": {"texto": "2025", "rebobinar": true, "en": 0.1, "hasta": 1.6},
  "bocadillo": {"texto": "¿Puede China escapar de Ormuz?", "en": 0.15},
  "etiquetas": [{"texto": "Golfo Pérsico", "lat": 27, "lon": 51.2, "giro": -28, "en": 1.9, "tam": 40}],
  "iconos": [{"tipo": "barril", "lat": 39.5, "lon": 116, "en": 2.6, "escala": 0.8, "texto": "14"}]
}
```
- `centro`: map centre. `km`: visible width in km (country ~3000-7000, sea/region ~1500-2500, continent ~9000).
- `rutas[].tipo`: "tubo" or "flecha".

## Rules
- **Country names:** use world-atlas English names ("China", "Russia", "Iran", "Kazakhstan", "Saudi Arabia", "United States of America", "United Kingdom"...). Spanish names for common countries are also understood.
- **`en: -1`:** the country is already in place from the previous shot (no rise). Use it for countries that continue from the shot before.
- **Colours:** red `#E8312A` for the protagonist, blue `#2F7FE0`, yellow `#E9C443`, orange `#F2A541` and green `#4FB36B` for others. Neighbours get different colours.
- **Faces:** only the protagonist country (sometimes a rival). `animo` is feliz, serio, preocupado or sorpresa, and must match the narration. `mira` [dx, dy] makes the face look toward the thing being talked about.
- **Routes:**
  - `"tubo"` is a pipeline over land, as real waypoints.
  - `"flecha"` is a dashed movement arrow. With 2 points it curves (`arco`). With many points it follows them.
  - SEA ROUTES MUST STAY AT SEA: give enough waypoints to go around coasts (for example Hormuz → Arabian Sea → south of Sri Lanka (5.4, 84) → Malacca strait (5.3, 97.4) (3.3, 100.2) (1.6, 102.9) → Singapore (1.15, 104.2) → South China Sea).
- **Numbers:** `cifra` is the one big number of the shot (count-up). Put the unit in `sub`. Use `coma: true` for a Spanish decimal comma ("4,5M"). The number must be one the narration says (the written script is authoritative).
- **Icons:** `tipo` is one of pozo, barril, barriles, fabrica, refineria, camion, calendario (`texto` = the day number), documento, flecha-arriba, flecha-abajo, barco, alerta. Place them on the real spot (lat/lon) or in screen fractions (x, y 0-1). Use 1-5 per shot, with `escala` 0.6-1.1.
- **Bubble and year:**
  - `bocadillo` holds the question or title of the video. Use it only in a shot that asks something.
  - `anio` is for when the narration jumps to or names a year.
- **Timing:** time `en` to the words of the narration line, never all at once. Keep important elements away from the frame edges.
- **Framing:** `km` is about 1.5 times the width of what must be seen whole, so it fits with air around it. Approximate widths: China 5200 km (km ≈ 7500), Russia 9000, USA 4500, India 3000, Iran 2200, Persian Gulf region 1200 (km ≈ 1800-2200), a strait or city zone 300-800. Never crop the protagonist country when it has the face.
- **Nothing overlaps:**
  - The top third of the frame (centre) belongs to `cifra`, `anio` and `bocadillo`: no icon there when the shot has one of them.
  - Icons never sit on top of an `etiqueta` or a face; keep about 6% of the frame between them.
  - At most 4 icons per shot.
- **A place inside one country** (a coast, a city, a region): zoom in (km 300-1500). At that zoom the country slab turns into a light tint so the real satellite shows: tell the place with `etiquetas` placed exactly on the spot, `rutas`, `iconos` and the `cifra`, not with the slab. Put the face only in wide shots (km >= 2500) and not in every shot: when the face appears all the time it stops meaning anything.
- **Variety:** do not repeat the same framing and the same cast shot after shot; alternate wide and close framings with the story.
- **Camera:** never a constant zoom-in.
  - Consecutive shots are joined automatically by a smooth camera flight from the previous framing, so just choose a good `centro`/`km` for each shot.
  - Inside a shot the camera barely drifts. Optional `"camara": {"mov": "quieto"}` holds it still (good for shots that read numbers or labels). `"camara": {"zoom": 0.02}` gives a slow push-in and `-0.02` a slow pull-out. `"camara": {"deriva": [0.02, 0]}` drifts slowly to one side (fractions of the frame over the whole shot).
- **Answer format:** only JSON, no comments.
