import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme";

// Lienzo del formato todo animado (reemplaza al stock): fondo oscuro con un
// brillo del acento del canal, grilla tenue que se desplaza muy despacio
// (para que el fondo nunca este quieto del todo) y viñeta.
export function Canvas({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const s = height / 1080;
  const cell = 80 * s;
  const drift = (frame * 0.15 * s) % cell;

  return (
    <AbsoluteFill style={{ background: "#0a0f18" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at 25% 20%, ${theme.accent}22, transparent 70%), radial-gradient(ellipse 60% 60% at 85% 90%, ${theme.accent}14, transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: `${drift}px ${drift}px`,
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 85% at 50% 50%, transparent 55%, rgba(0,0,0,0.65))" }} />
    </AbsoluteFill>
  );
}
