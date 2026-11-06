import { Composition } from "remotion";
import { Overlay } from "./Overlay";
import { FPS } from "./catalog";
import type { OverlayProps } from "./spec";
import { AnimatedVideo } from "./scenes/AnimatedVideo";
import type { AnimatedVideoProps } from "./scenes/types";

// Una sola composicion generica: el tipo de grafico, el tema, la duracion y
// la resolucion llegan por props (los arma el backend por cada momento del
// guion; ver scripts/render-overlays.ts).
export function Root() {
  return (
    <>
    <Composition
      id="Overlay"
      component={Overlay}
      fps={FPS}
      width={1920}
      height={1080}
      durationInFrames={FPS * 4}
      defaultProps={{
        spec: { type: "big_number", text: "más de 1.000 km por hora", label: "viento hacia el este" },
        theme: "documental",
        durationSeconds: 4.5,
      } satisfies OverlayProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSeconds * FPS)),
        width: props.width ?? 1920,
        height: props.height ?? 1080,
      })}
    />
    {/* Formato todo animado: el video entero (scenes/AnimatedVideo.tsx). */}
    <Composition
      id="AnimatedVideo"
      component={AnimatedVideo}
      fps={FPS}
      width={1920}
      height={1080}
      durationInFrames={FPS * 10}
      defaultProps={{ scenes: [], durationSeconds: 10 } satisfies AnimatedVideoProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSeconds * FPS)),
        width: props.width ?? 1920,
        height: props.height ?? 1080,
      })}
    />
    </>
  );
}
