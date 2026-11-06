# motion — gráficos animados con Remotion

Componentes animados (cifras, comparaciones, mapas, diagramas…) que el render
superpone sobre el video base de ffmpeg.

## Cómo encaja en el pipeline

1. `plan_overlays` (backend) lee el guion completo y elige qué gráfico va en
   cada momento, **solo entre los tipos de `catalog.json`**.
2. `generate_overlay` valida en modo estricto (textos literales del guion).
3. `build_timeline` ancla cada gráfico a la palabra exacta donde se narra
   (timing de Whisper, `src/lib/overlayTiming.ts` del backend).
4. `render_video` ubica los gráficos sin que se pisen, llama a
   `scripts/render-overlays.ts` (un solo navegador para todo el video) y
   superpone los clips en la pasada final de ffmpeg (`src/lib/motion.ts`).

Remotion renderiza **solo la animación de entrada** de cada gráfico
(`introSeconds` en `catalog.json`); ffmpeg congela el último frame el resto
del tiempo y hace el fundido de salida. Los gráficos salen a la resolución
del proyecto (720p/1080p) y con el formato de números del idioma del canal.

Si el paquete no está instalado (ej. la API en Render sin worker) o el render
de gráficos falla, el video sale igual, sin gráficos.

## Agregar un componente

1. Componente en `src/components/` (recibe `spec`, `theme`, `exit`, `locale`).
2. Caso en `src/Overlay.tsx`.
3. Entrada en `catalog.json` con su `introSeconds`.
4. Descripción para el planificador en `TYPE_GUIDE` de
   `backend/src/tools/planOverlays.tool.ts`.

## Comandos

```bash
npm install
npm run build            # compila los componentes a build/ (lo hace el Dockerfile)
npm run ensure-browser   # baja el Chrome Headless Shell (lo hace el Dockerfile)
npm run typecheck
npm run render:sample -- out video-base.mp4 1   # prueba suelta
```

Variables: `REMOTION_BROWSER_EXECUTABLE` (usar un Chrome ya instalado),
`REMOTION_CONCURRENCY`, y en el backend `MOTION_DIR` (default `./motion`).

## Mediciones (contenedor de 4 núcleos)

| Caso | Tiempo |
|---|---|
| Fase 0: gráfico completo de 4.5 s a 1080p (135 frames) | 14.1 s |
| Fase 1: 2 gráficos a 720p, solo entrada (2 × 51 frames), con arranque del navegador | 8.9 s |
| Superponer 2 gráficos en 16 s de video 720p | 6.2 s |

Proyección para un video de 20 min con un gráfico cada 30 s (40 gráficos):
~2–3 min a 720p, ~5 min a 1080p. La pasada final de ffmpeg ya existía.

## Licencia

Remotion es gratis para empresas de hasta 3 personas; con 4 o más hace falta
la Company License (ver https://remotion.dev/docs/license).

## Desenfoque del fondo

Cada tipo del catálogo puede pedir que el video de abajo se desenfoque
mientras está en pantalla (`blur`, en px a 1080p; 0 = nada). Lo aplica quien
junta las capas: ffmpeg en el render (`motionOverlayGraph`: un solo `gblur`
apagado fuera de esas ventanas, con rampas por `sendcmd`) y CSS en la revisión
de stock del front. Hoy: cifras 0, barras 6, frase cinética 10, capítulos 14.
