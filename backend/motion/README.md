# motion — gráficos animados con Remotion

Componentes animados (cifras, comparaciones, mapas, diagramas…) que el render
superpone sobre el video base de ffmpeg. Arquitectura:

1. El backend decide qué gráfico va en cada momento del guion (spec en `src/spec.ts`).
2. Remotion renderiza **solo esos tramos** como clips con transparencia (ProRes 4444).
3. ffmpeg los superpone sobre el video base en el segundo exacto.

Temas por canal/género en `src/theme.ts`; cifras del guion → forma compacta en
`src/lib/literal.ts` ("más de 1.000 km por hora" → `+` `1.000` `km/h`, mismo número).

## Fase 0 (prueba técnica)

```bash
npm install
REMOTION_BROWSER_EXECUTABLE=/ruta/a/chrome-headless-shell \
FFMPEG_PATH=/ruta/a/ffmpeg \
npm run render:sample -- out video-base.mp4 1
```

Sin `REMOTION_BROWSER_EXECUTABLE`, Remotion baja su propio Chrome Headless Shell.
`SAMPLE_SECONDS` cambia la duración del clip; `REMOTION_CONCURRENCY` los hilos.

### Resultados (contenedor de 4 núcleos, 1080p, 30 fps)

| Paso | Tiempo |
|---|---|
| bundle (una vez por proceso, se puede cachear) | 14.7 s |
| abrir navegador + elegir composición | 2.5 s |
| render 135 frames (4.5 s de gráfico) | 14.1 s |
| render 540 frames (18 s) | 48.2 s → ~11 frames/s |
| superponer con ffmpeg (6.5 s de video) | 10.3 s |

Concurrencia 4 no mejoró (14.2 s): el costo está en capturar PNG + codificar ProRes.
ProRes 4444 pesa ~14 MB/s (temporal, se borra después de componer).

Proyección: un video de 20 min con un gráfico cada 30 s (40 × 4.5 s = 5.400 frames)
≈ 8 min extra de render. Optimizaciones pendientes para la Fase 1:

- Renderizar solo la parte animada y congelar el último frame en ffmpeg
  (la mayoría de los gráficos quedan quietos después de ~1.5 s): −50 % o más.
- Renderizar a 720p cuando el proyecto es 720p: ~−55 % de píxeles.
- Todos los gráficos de un video en un solo proceso (bundle y navegador una vez).
- Si hace falta escalar: Remotion Lambda (render en paralelo en AWS).
