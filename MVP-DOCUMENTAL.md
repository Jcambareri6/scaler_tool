# MVP: formato documental (estilo Make a Videos) — cómo probarlo

Rama: `claude/confident-franklin-0shhr9`. Plan completo: `PLAN-stock-con-graficos-estilo-mav.md`.
**Solo lo ven los admins** (`ADMIN_USER_IDS`); el resto de los usuarios no ve ningún cambio.

## 1. Qué hace

1. Elegís **"Documental"** y un **estilo** (12 estilos, sin los que dependen de YouTube).
2. El guion se escribe con la estructura documental del estilo (gancho, contexto, desarrollo, el hecho, consecuencias, cierre) nombrando personas, lugares, fechas y cifras.
3. Voz + Whisper (igual que hoy).
4. **Montajista** (Claude Opus, skill `backend/skills/montaje-documental`) arma el **plan de planos por frase**: qué se ve (persona, lugar, cosa, metraje, ambiente, mapa), la búsqueda, el año, los gráficos de métricas con texto literal, los rótulos y los capítulos.
5. **Verificador** en código: cobertura sin huecos, duración por tipo de plano, nunca dos gráficos seguidos, presupuesto de gráficos por minuto y % del tiempo, nombres solo sobre la foto de esa persona.
6. **Buscadores** con licencia de uso comercial, por tipo de plano: Wikidata (fotos de personas y cosas con nombre propio), Wikimedia Commons, Openverse, archive.org (dominio público), tu stock (Pexels, Pixabay, Coverr) y, si no hay nada, imagen IA (SnapGen).
7. **Juez visual** (Claude Sonnet con visión) mira miniaturas reales de los candidatos y elige el que muestra lo que dice la voz o los rechaza (`generico`, `equivocado`, `persona`, `epoca`, `texto`, `oscuro`, `marca_agua`). Si no pasa nada, prueba la fuente siguiente; si no, un plano seguro.
8. **Revisión** humana como siempre (pestaña Preview), con tus gráficos animados en vivo.
9. **Render documental**: gradación, viñeta y capa del estilo, destello cálido cada N planos, movimientos de cámara que no se repiten, cortes de zoom en los clips, corte seco, subtítulos documentales, **tus gráficos animados encima**, música con ducking (si cargaste la biblioteca), efectos de sonido sintetizados en cada gráfico y volumen normalizado a −14 LUFS.
10. **Control de calidad** del MP4 (negro, imagen congelada, volumen) y **capítulos + créditos** listos para copiar en la descripción de YouTube.

## 2. Qué hay que hacer antes de probar

1. **Migraciones** (Supabase), en orden: las de `backend/supabase/migrations` que falten y `supabase/migrations/20261112000000_documental_format.sql` (formato `documental`, `video_style`, `documental_plan` y tabla `music_library`).
2. **Deploy** del backend (API) y del **worker** (`docker compose -f docker-compose.worker.yml up -d --build`): el worker tiene Remotion (gráficos) y la fuente Roboto. Deploy del frontend.
3. **Provider `anthropic`** activo (ya lo tenés). Opcional, en `configuration`:
   - `montaje_model` (default `claude-opus-5-5`)
   - `juez_model` (default `claude-sonnet-5-5`)
4. **R2** configurado (ya lo tenés): todo el material externo se copia a R2 antes del render.
5. **Música (opcional)**: sin pistas el video sale con voz + efectos. Para cargar pistas con licencia de uso comercial (por ejemplo, Kevin MacLeod, CC BY 4.0):
   ```bash
   cd backend && npx tsx scripts/seed-music.ts musica.json
   ```
   (el formato de `musica.json` está explicado al principio del script). Los créditos de la pista salen solos.
6. **Red del servidor**: el worker tiene que poder llegar a `www.wikidata.org`, `commons.wikimedia.org`, `upload.wikimedia.org`, `thumb.wikimedia.org`, `api.openverse.org` y `archive.org`.

## 3. Cómo probarlo (5 minutos de tu tiempo)

1. Entrá como admin → **Nuevo proyecto** → "¿Qué video querés hacer?" → **Documental** → elegí un estilo (para empezar: **Documental** o **Profundo**).
2. Generá el guion (tema concreto, por ejemplo, "El desastre de Chernóbil") y la voz.
3. Pestaña **Preview** → ya aparece "Documental" con el estilo elegido → **Generar**.
4. Cuando llegue a revisión: mirá plano por plano; los que no te gusten se reemplazan como siempre.
5. Aprobá y renderizá. Al terminar, abajo del video: resumen del juez, control de calidad, **capítulos** y **créditos** para copiar.

Para comparar: el mismo guion en "Stock con gráficos" y en "Documental".

## 4. Qué se probó y qué no

| Probado acá | Resultado |
|---|---|
| Verificador del montajista con el guion real de Chernóbil y un plan con errores a propósito | OK (`scripts/tests/montajista.test.ts`) |
| Buscadores contra las APIs reales (Wikidata, Commons, Openverse, archive.org) y filtro de licencias (descarta NC y ND) | OK (`scripts/tests/sources.live.ts`) |
| Ensayo en seco: plan → verificador → cadena de fuentes por plano, con red real | OK: foto de Pripyat, foto de la central, sala de control de los años 60 (PD), bola de fuego de Trinity (PD) (`scripts/tests/documental.dryrun.ts`) |
| Juez: lectura del veredicto y miniaturas de candidatos reales | OK (`scripts/tests/judge.test.ts`) |
| Filtros del render con FFmpeg real: 3 looks, 5 movimientos, cortes de zoom, mezcla con ducking y efectos, QC | OK (`scripts/tests/documentalRender.test.ts`, `renderBatch.test.ts`) |
| Build del backend y del frontend, galería y resumen en pantalla | OK |

**No se pudo probar acá** (no tengo tus credenciales de Supabase ni de Anthropic):
- La llamada real al **Montajista** (Opus) y al **Juez** (Sonnet): el prompt y el formato están armados; si el Montajista falla, el sistema cae a un plan simple y te lo avisa en el resumen.
- Un **pipeline completo contra tu base** (guardar planos, timeline, render y subida).
- **Wikimedia limita mucho** a IPs compartidas (429). En tu servidor debería andar bien, pero si ves muchos "plano seguro", es eso.

Comandos para correr las pruebas en tu máquina (con red):
```bash
cd backend && npx tsx scripts/tests/montajista.test.ts
```
```bash
cd backend && npx tsx scripts/tests/documentalRender.test.ts
```
```bash
cd backend && npx tsx scripts/tests/documental.dryrun.ts profundo
```

## 5. Qué falta (siguientes pasos)

| Pendiente | Por qué no entró en el MVP |
|---|---|
| Dissolve de 700 ms en los cambios de capítulo | Requiere duraciones de transición por corte en el render; hoy es corte seco + destellos |
| Capturas de Wikipedia con la frase resaltada (clase `pagina`) y datos del Banco Mundial para `line_chart` | Piezas nuevas; el Montajista hoy no las pide |
| Componentes propios de estilos (marco de Expediente, banda de Noticiero, papel e hilo rojo de Collage) | Hoy esos estilos se diferencian por look, sonido, fuentes y gráficos, no por marcos propios |
| En la revisión, mostrar por plano su tipo, fuente, licencia y veredicto del juez | Los datos ya se guardan (`assets.metadata.qa`, `license`...); falta pintarlos en `StockReviewPanel` |
| Música distinta por capítulo | Hoy una pista por video según el estilo |
| Caché de búsquedas de 14 días y dedupe perceptivo (dHash) | Hoy dedupe por id y URL dentro del video |
| Montajista como Managed Agent en Claude Platform | Hoy corre por la API de mensajes con el patrón de `documentalDirector` (hub en código); la skill ya está lista para subirla con `setup-managed-agents.ts` |
| Asistente con pasos (stepper) dentro del proyecto | Está el "¿Qué video querés hacer?" al crear y el formato en Preview |
| Vertical 9:16 | Fuera de alcance por ahora |
