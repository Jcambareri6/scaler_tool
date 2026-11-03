import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme";
import { DOC } from "./palette";

// Lienzo del formato todo animado (reemplaza al stock): azul noche fijo, una
// grilla tenue que se desplaza muy despacio
// (para que el fondo nunca este quieto del todo) y viñeta.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Canvas(_props: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const s = height / 1080;
  const cell = 80 * s;
  const drift = (frame * 0.15 * s) % cell;

  return (
    // Azul noche con viñeta, sin brillo de color: el acento es solo para texto.
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 75% at 50% 45%, #0B1424 0%, ${DOC.fondoOscuro} 80%)` }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)",
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: `${drift}px ${drift}px`,
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 85% at 50% 50%, transparent 55%, rgba(0,0,0,0.65))" }} />
    </AbsoluteFill>
  );
}
