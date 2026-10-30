import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";

// Etiqueta de hito (gusanos y plastico: "BREAKTHROUGH · 2018"): chica,
// arriba a la izquierda (debajo de la capa fija de navegacion), para situar
// un tramo en el tiempo sin tapar el video. `text` = que paso, `label` = la
// fecha; literales del guion.
export function MilestoneTag({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const t = enter(0, 14);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div
        style={{
          position: "absolute",
          left: 64 * s,
          top: 110 * s,
          display: "flex",
          alignItems: "center",
          gap: 16 * s,
          padding: `${12 * s}px ${22 * s}px`,
          background: "rgba(0,0,0,0.55)",
          borderLeft: `${5 * s}px solid ${theme.accent}`,
          opacity: t,
          clipPath: `inset(0 ${(1 - draw(0, 14)) * 100}% 0 0)`,
        }}
      >
        <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 30 * s, letterSpacing: 4 * s, textTransform: "uppercase", color: theme.text, textShadow: TEXT_SHADOW }}>
          {spec.text}
        </span>
        {spec.label && (
          <>
            <span style={{ width: 8 * s, height: 8 * s, borderRadius: "50%", background: theme.accent }} />
            <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 30 * s, letterSpacing: 3 * s, color: theme.accent, fontVariantNumeric: "tabular-nums" }}>
              {spec.label}
            </span>
          </>
        )}
      </div>
    </AbsoluteFill>
  );
}
