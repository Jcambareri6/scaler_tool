import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";

// Dato fijo en esquina ("UN DÍA DURA / 1 AÑO"): arriba a la derecha, chico,
// para acompañar un tramo largo sin tapar. Que es (`label`) en mayusculas
// espaciadas y el valor (`text`) en acento, con una linea al costado.
export function CornerBadge({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const t = enter(0, 16);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div
        style={{
          position: "absolute",
          right: 90 * s,
          top: 80 * s,
          display: "flex",
          gap: 20 * s,
          alignItems: "stretch",
          padding: `${18 * s}px ${26 * s}px`,
          background: "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 35%)",
          opacity: t,
          transform: `translateX(${(1 - t) * 40 * s}px)`,
        }}
      >
        <div style={{ textAlign: "right" }}>
          {spec.label && (
            <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 22 * s, letterSpacing: 6 * s, textTransform: "uppercase", color: theme.textMuted, textShadow: TEXT_SHADOW }}>
              {spec.label}
            </div>
          )}
          <div style={{ marginTop: 4 * s, fontFamily: theme.fontSans, fontWeight: 800, fontSize: 52 * s, textTransform: "uppercase", color: theme.accent, textShadow: TEXT_SHADOW, opacity: enter(6) }}>
            {spec.text}
          </div>
        </div>
        <div style={{ width: 4 * s, background: theme.accent, transform: `scaleY(${draw(4, 16)})`, transformOrigin: "top" }} />
      </div>
    </AbsoluteFill>
  );
}
