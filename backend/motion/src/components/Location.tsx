import { AbsoluteFill, interpolate } from "remotion";
import { MapPin } from "lucide-react";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

// Lugar: un pin que cae y rebota, barra de acento, el nombre del lugar en
// mayusculas espaciadas y su dato (`label`) debajo. Abajo a la izquierda,
// como un rotulo de ubicacion.
export function Location({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { frame, s, enter, draw, exit } = useMotion(withExit);
  const drop = enter(0, 16);
  // Pequeño rebote al aterrizar.
  const bounce = Math.sin(Math.PI * interpolate(frame, [12, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) * -12 * s;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="18% 80%" size="45% 40%" opacity={enter(0)} />
      <div style={{ position: "absolute", left: 140 * s, bottom: 150 * s, display: "flex", alignItems: "flex-end", gap: 26 * s }}>
        <MapPin
          size={110 * s}
          strokeWidth={1.8}
          color={theme.accent}
          style={{ opacity: drop, transform: `translateY(${(1 - drop) * -120 * s + bounce}px)`, filter: `drop-shadow(0 0 ${16 * s}px ${theme.accent}90)` }}
        />
        <div>
          <div style={{ width: 120 * s * draw(8, 22), height: 4 * s, background: theme.accent, marginBottom: 18 * s }} />
          <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 74 * s, letterSpacing: 10 * s, textTransform: "uppercase", color: theme.text, textShadow: TEXT_SHADOW, opacity: enter(8), transform: `translateX(${(1 - enter(8)) * 24 * s}px)` }}>
            {spec.text}
          </div>
          {spec.label && (
            <div style={{ marginTop: 8 * s, fontFamily: theme.fontSans, fontWeight: 400, fontSize: 34 * s, color: theme.textMuted, textShadow: TEXT_SHADOW, opacity: enter(16) }}>
              {spec.label}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}
