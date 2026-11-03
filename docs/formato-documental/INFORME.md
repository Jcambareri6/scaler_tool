# Formato documental animado — informe para el agente local

**Rama:** `formato-documental`. **Qué agrega este commit:** solo archivos nuevos (documentación, referencias y un prototipo aislado). No modifica código existente del backend ni del motor.

> **Ojo:** la rama remota estaba en `60db375`. Si tenés commits locales más nuevos en esta rama (por ejemplo, subtítulos, Revisor/Auditor), hacé `git pull --rebase`. No debería haber conflictos porque todo lo de este commit son carpetas nuevas.

---

## 1. Qué se hizo, en orden

1. **Se analizaron los 7 videos reales de Ciencia y Vida** (@cienciayvida19), bajados en 720p:
   - hojas de cuadros con tiempo (1 cuadro cada 3–10 s);
   - ráfagas cuadro a cuadro de 2 animaciones clave;
   - conteo de cortes con `ffmpeg`;
   - colores medidos sobre píxeles.

   Resultado: `analisis-visual-ciencia-y-vida.md` + `referencias/` (hojas de cuadros, nombre = id del video).
2. **Se analizó el clip de Chernobyl de 30 s generado por Skaler** (v1 y revisado), con su guion, tiempos por palabra y los dos JSON del plan. Resultado: `diagnostico-clip-chernobyl.md` + `referencias/skaler_chernobil_*.jpg`.
3. **Se hizo a mano, sin IA, un clip modelo** con los mismos 30 s (misma voz y mismos tiempos por palabra) y el estilo de la referencia, para comprobar que el motor puede llegar a esa calidad antes de seguir gastando en agentes.
   - Código: `backend/motion/prototipos/clip-modelo/`
   - Video: `clips/clip-modelo-chernobyl-30s.mp4`

   **El dueño del producto lo aprobó como dirección** ("está mucho mejor que los videos que ha hecho"), con una corrección: las fechas en formato numérico (26/04/1986), no con número romano.
4. Se agregó `backend/motion/prototipos/medir-movimiento.py`, que mide sin IA los segundos congelados y la intensidad del remate.

---

## 2. Hallazgos clave

### 2.1 La referencia
- **Un método, cuatro estilos.** El canal repite el mismo método en todos sus videos: una idea por pantalla, subtítulo con palabra resaltada, cifras animadas, comparaciones y remate en la palabra. Lo que cambia es el estilo visual. **El estilo a copiar es el "A · Infografía editorial"** (videos del tren y del AVE, este último con 277 mil vistas):
  - fondo **claro** (~#E8ECF0) para mecanismos y fondo **oscuro** (~#050A14) para datos, cifras y giros;
  - esquemas planos de perfil;
  - pictogramas negros sin cara;
  - **rojo = peligro, verde = seguro, azul solo para el texto resaltado**.
- **Ritmo:** casi no hay cortes (0–2 por video de 8 minutos), todo se encadena con fundidos de ~0,6 s. Nunca hay un segundo totalmente congelado. Un esquema queda quieto 3–5 s mientras habla la voz y el **remate es un golpe seco de menos de 0,4 s en la palabra clave**, seguido de quietud.
- **No hay explosiones, partículas ni sacudidas.** Los eventos fuertes son contenidos: zigzag, halo rojo y etiqueta en el mismo cuadro.
- Hay un **catálogo de 22 recursos que se repiten** (sección C del análisis): esquema por capas, antes/después, A/B con la condición invertida, balanza con pictogramas, ley que escala, mapa de calor sobre el objeto, documento a máquina, tarjeta de lección, ubicación con mapa o globo, etc.

### 2.2 El clip de Skaler (revisado)
- **La sincronía por palabra funciona perfecto:** los 31 pasos caen exactamente al inicio de su palabra. **No tocar.**
- Los problemas son de **qué** se anima y **cómo**:

| Problema | Causa en el JSON / motor |
|---|---|
| 11 de 30 segundos congelados | la escena del mapa tiene 1 solo paso para 9,8 s; entre pasos el motor no agrega movimiento de base |
| El reactor se pone rojo en "emergencia", antes del remate | `paint reactor.nucleo alert` en 20,28 s: la IA anticipa el desastre y arruina el contraste |
| Explosión azul que se sale del cuadro | el componente `explosion` usa `var(--accent)` (#6CC6FF) + `scale 2.6` + `loop spin` |
| Saltos de encuadre | `camera zoom 1.3` en "pulsa" y `zoom 1` en "apagar" |
| Solapes y objetos cortados (en otras pruebas) | la IA elige `x/y/w` absolutos para cada dibujo |
| El azul en todo | `theme.accent` se usa para personaje, barras, cartel, ciudad y explosión |

**Conclusión:** de 10 problemas detectados, 8 se resuelven en el código del motor una sola vez. Solo la idea del remate depende de la IA.

### 2.3 Medición
| | Skaler revisado | Clip modelo | Referencia |
|---|---|---|---|
| Segundos congelados (de 30) | 11 | **0** | 0–2 |
| Intensidad del remate (pico/media) | 5,8 | **16** | 8–9 |

---

## 3. Cómo está hecho el clip modelo (`backend/motion/prototipos/clip-modelo/`)

Es un proyecto Remotion aislado, con su propio `package.json`. Está fuera del `include` del `tsconfig` de `motion`, así que no afecta el typecheck.

| Archivo | Qué contiene |
|---|---|
| `src/tema.ts` | colores con significado. **La IA no elige colores:** elige `peligro / seguro / neutro` y el tema lo traduce |
| `src/util.ts` | las 3 curvas de tiempo del estilo: `entra` (0,45 s, frenado suave), `golpe` (0,25 s, seco, para remates) y `mecanismo` (acelera y frena, para piezas que se mueven) |
| `src/Capas.tsx` | capas fijas: subtítulo que crece palabra por palabra con la actual resaltada y subrayada, encabezado de capítulo arriba a la derecha, título de escena arriba a la izquierda, fondo con viñeta |
| `src/EscenaMapa.tsx` | recurso **"ubicación con capas"**: mapa (`world-atlas` + `d3-geo`) con acercamiento lento y continuo; la fecha 26/04/1986 y la hora 01:23 se escriben con la voz; país resaltado; pin con pulso y etiqueta |
| `src/EscenaReactor.tsx` | recurso **"mecanismo con contraste"**: pictograma negro, consola, **lupa** para el detalle del botón (en vez de zoom de cámara), reactor en corte con barras que bajan en "apagar", **verde = seguro** en "último recurso" y "freno de mano", cable y ciudad, **2 s de quietud** antes del remate, y **"evento contenido"** en "explota" (tapa que salta, grietas, halo rojo, escudo que se rompe, escombros con física simple determinística) |
| `src/Clip.tsx` | une todo: fundido de 0,6 s entre escenas, audio, carga de fuentes antes de renderizar |
| `src/palabras.json` | tiempos por palabra (Whisper) del clip |

**Reglas que aplica (y que debería aplicar el motor real):**
1. Toda escena tiene **movimiento de base**: acercamiento o deriva lenta constante (1–2,5 %) + subtítulo que avanza. Nunca hay imagen congelada.
2. **Sin zoom de cámara entre momentos.** El detalle se muestra con una lupa.
3. **Remate = golpe ≤ 0,4 s en la palabra ancla**, después quietud.
4. **Colores por significado**, nunca elegidos por la IA.
5. **Etiquetas pegadas al objeto** y del color de su significado.
6. **Fondo claro para mecanismos, oscuro para datos y ubicaciones.**
7. **Datos solo del guion. Las fechas las formatea el código** (día/mes/año → `26/04/1986`), no la IA.
8. **Sin explosiones:** el evento contenido es zigzag + halo rojo + piezas + etiqueta.

**Correr el prototipo:**
```bash
cd backend/motion/prototipos/clip-modelo && npm install && npm run studio
```
Para renderizar: `npm run render`. Si no encuentra Chrome, agregar `--browser-executable=<ruta>`.

---

## 4. Qué implementar en el motor real (en orden)

### Paso 1 — Base del motor, sin IA (`backend/motion/src/...`)
- **Tema:** reemplazar `accent` como color de objetos por tonos con significado (`peligro`, `seguro`, `neutro`, `dato2`). El azul queda solo para el texto resaltado. Fondo claro u oscuro por escena, con viñeta.
- **Movimiento de base en `Scene`/`Canvas`:** deriva lenta constante en toda escena, aunque el plan no tenga pasos.
- **Cámara:** quitar o restringir la acción `camera` con zoom. Agregar un componente "lupa".
- **Transición:** fundido cruzado de 0,6 s entre escenas.
- **Fechas:** helper que reciba `{dia, mes, anio}` y devuelva `DD/MM/AAAA`.
- **Subtítulos (`Captions.tsx`):** que estén activos en este formato. El commit `60db375` dice "Sin subtítulos en este formato". Estilo: abajo al centro, crecen palabra por palabra, palabra actual en azul subrayada.

**Criterio de aceptación:** re-renderizar el clip de Chernobyl con el plan actual y medir con `python3 backend/motion/prototipos/medir-movimiento.py video.mp4`. Meta: congelados ≤ 2 cada 30 s.

### Paso 2 — Recursos (componentes con espacios a completar, sin coordenadas)
Empezar por los 3 del clip modelo, después seguir con el catálogo:
1. `ubicacion` — mapa/globo + lugar + fecha + capas que entran con la voz.
2. `mecanismo` — esquema por capas + lupa + partes que se mueven + etiquetas.
3. `contraste` — lo esperado (verde) contra lo que pasa (rojo) en la palabra del remate.
4. `evento` — evento contenido, que reemplaza a `explosion`.
5. Después: `ab`, `balanza`, `pictogramas`, `contador`, `barras`, `ley_escala`, `documento`, `leccion`, `lista_descarte`, `checklist`.

Cada recurso resuelve su propia composición: no hay `x/y/w` de la IA, ni solapes, ni objetos cortados.

### Paso 3 — Formato del plan que completa la IA
Propuesta, a ajustar a `spec.ts` y `types.ts`:
```json
{
  "id": "s2",
  "recurso": "mecanismo",
  "fondo": "claro",
  "titulo": "Sala de control",
  "contenido": {
    "objetos": ["consola", "reactor_corte", "ciudad"],
    "personaje": { "rol": "ingeniero", "tarjeta": "25 años" },
    "lupa": { "objeto": "boton", "texto": "APAGAR" }
  },
  "momentos": [
    { "palabra": "pulsa",     "hace": "personaje_aprieta" },
    { "palabra": "apagar",    "hace": "barras_bajan", "significado": "seguro" },
    { "palabra": "freno",     "hace": "etiqueta", "texto": "freno de mano", "significado": "seguro" },
    { "palabra": "explota",   "hace": "evento", "significado": "peligro", "remate": true }
  ]
}
```
- La IA elige el **recurso**, completa el **contenido** y asigna **palabras ancla**. No elige colores, posiciones, zoom ni duraciones.
- **Se mantiene la sincronía por palabra que ya funciona** (`at` = inicio de la palabra).
- Regla del Verificador: **ningún `peligro` antes de la palabra marcada como `remate`** (evita lo de "emergencia").

### Paso 4 — Agentes más baratos
- **Multimedia (Opus), 1 llamada por video:** elige recurso, palabra de remate y fondo por momento. Define 3–5 esquemas que vuelven a lo largo del video.
- **Control del plan antes de animar, en texto:** "¿la imagen cambiaría si la afirmación fuera falsa?", datos solo del guion, variedad de recursos.
- **Escenas:** solo completa espacios (Sonnet o Haiku).
- **Revisión visual:** 1 hoja de cuadros del video completo en vez de 4 capturas por escena. Como máximo 1 ronda de corrección; si no mejora, la escena baja a un recurso seguro.
- **Métricas de código después de cada render**, con `medir-movimiento.py` o su equivalente en TS.

---

## 5. Archivos de este commit
```
docs/formato-documental/
  INFORME.md                           ← este archivo
  analisis-visual-ciencia-y-vida.md    ← análisis completo de la referencia + catálogo de 22 recursos
  diagnostico-clip-chernobyl.md        ← diagnóstico del clip de Skaler (con el JSON) y plan
  clips/clip-modelo-chernobyl-30s.mp4  ← el clip modelo aprobado
  referencias/                         ← hojas de cuadros de la referencia y de Skaler
backend/motion/prototipos/
  clip-modelo/                         ← prototipo Remotion aislado
  medir-movimiento.py                  ← métricas sin IA
```
