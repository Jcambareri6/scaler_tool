import { Composition } from "remotion";
import { Overlay } from "./Overlay";
import type { OverlayProps } from "./spec";

const FPS = 30;

// Una sola composicion generica: el tipo de grafico, el tema y la duracion
// llegan por props (los arma el backend por cada momento del guion).
export function Root() {
  return (
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
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.round(props.durationSeconds * FPS)) })}
    />
  );
}
