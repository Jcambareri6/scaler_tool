import { AbsoluteFill, interpolate, spring } from "remotion";
import { Bell } from "lucide-react";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { useMotion } from "../lib/anim";

// Pedido de suscripcion/like/comentario: pildora en acento abajo al centro,
// que entra con un rebote, con la campanita que se sacude una vez. El texto
// es el de la narracion ("suscríbete y activa la campana").
export function CallToAction({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { frame, fps, s, exit } = useMotion(withExit);
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 160 }, durationInFrames: 24 });
  // Sacudida de la campana: oscilacion que se apaga.
  const ring = interpolate(frame, [16, 40], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const angle = Math.sin((frame - 16) * 0.9) * 22 * ring * (frame >= 16 ? 1 : 0);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 130 * s, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20 * s,
            padding: `${22 * s}px ${44 * s}px`,
            borderRadius: 999,
            background: theme.accent,
            boxShadow: `0 10px 40px rgba(0,0,0,0.45), 0 0 ${40 * s}px ${theme.accent}60`,
            transform: `scale(${pop})`,
            opacity: Math.min(1, pop * 1.5),
          }}
        >
          <Bell size={46 * s} strokeWidth={2.4} color="#111" style={{ transform: `rotate(${angle}deg)`, transformOrigin: "50% 10%" }} />
          <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 42 * s, letterSpacing: 2 * s, textTransform: "uppercase", color: "#111" }}>
            {spec.text}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
