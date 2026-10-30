import { AbsoluteFill } from "remotion";
import { User } from "lucide-react";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";

// Ficha de persona sin foto (gusanos y plastico: "John McGeehan · PETase
// researcher"): silueta en un circulo, nombre en tipografia pesada y su rol
// en serif italica, abajo a la izquierda. Para presentar a alguien sin una
// imagen libre. `text` = nombre, `label` = rol; literales del guion.
export function PersonCard({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const t = enter(0, 16);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 50%)", opacity: t }} />
      <div style={{ position: "absolute", left: 110 * s, bottom: 150 * s, display: "flex", alignItems: "center", gap: 30 * s }}>
        <div
          style={{
            width: 140 * s,
            height: 140 * s,
            borderRadius: "50%",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            overflow: "hidden",
            background: "rgba(255,255,255,0.1)",
            border: `${3 * s}px solid ${theme.accent}`,
            boxShadow: `0 0 ${30 * s}px ${theme.accent}50`,
            opacity: t,
            transform: `scale(${0.85 + 0.15 * t})`,
          }}
        >
          <User size={150 * s} strokeWidth={1.4} color={theme.textMuted} style={{ marginBottom: -22 * s }} />
        </div>
        <div>
          <div
            style={{
              fontFamily: theme.fontSans,
              fontWeight: 800,
              fontSize: 60 * s,
              lineHeight: 1.05,
              color: theme.text,
              textShadow: TEXT_SHADOW,
              opacity: enter(4),
              transform: `translateX(${(1 - enter(4)) * -24 * s}px)`,
            }}
          >
            {spec.text}
          </div>
          <div style={{ width: 90 * s, height: 3 * s, margin: `${12 * s}px 0`, background: theme.accent, transform: `scaleX(${draw(8, 20)})`, transformOrigin: "left" }} />
          {spec.label && (
            <div style={{ fontFamily: theme.fontSerif, fontStyle: "italic", fontWeight: 500, fontSize: 40 * s, color: theme.textMuted, textShadow: TEXT_SHADOW, opacity: enter(10) }}>
              {spec.label}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}
