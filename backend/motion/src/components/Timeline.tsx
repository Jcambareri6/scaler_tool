import { AbsoluteFill, Easing, interpolate } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

const MAX_STOPS = 6;

// Secuencia/etapas/fechas: una linea que se dibuja de izquierda a derecha y
// va marcando cada hito al pasar (punto que se enciende, fecha en acento
// arriba, que pasa abajo). El ultimo hito queda destacado.
export function Timeline({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { frame, s, enter, exit } = useMotion(withExit);
  const stops = (spec.items ?? []).slice(0, MAX_STOPS);
  if (stops.length < 2) return null;

  const lineWidth = 1500 * s;
  const lineStart = 8;
  const lineEnd = 8 + 12 * stops.length;
  const drawn = interpolate(frame, [lineStart, lineEnd], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const step = lineWidth / (stops.length - 1);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="50% 55%" size="75% 50%" opacity={enter(0)} />
      {spec.text && (
        <div style={{ position: "absolute", top: 300 * s, width: "100%", textAlign: "center", fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 60 * s, color: theme.text, textShadow: TEXT_SHADOW, opacity: enter(0) }}>
          {spec.text}
        </div>
      )}
      <div style={{ position: "absolute", left: (1920 * s - lineWidth) / 2, top: 560 * s, width: lineWidth }}>
        <div style={{ position: "absolute", left: 0, top: -1.5 * s, width: lineWidth, height: 3 * s, background: "rgba(255,255,255,0.18)" }} />
        <div style={{ position: "absolute", left: 0, top: -1.5 * s, width: lineWidth * drawn, height: 3 * s, background: theme.accent }} />
        {stops.map((stop, i) => {
          const x = i * step;
          // Cada hito se enciende cuando la linea llega a el.
          const reachedAt = lineStart + (lineEnd - lineStart) * (i / (stops.length - 1));
          const t = enter(reachedAt - 2, 14);
          const isLast = i === stops.length - 1;
          return (
            <div key={i} style={{ position: "absolute", left: x, top: 0, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", width: Math.min(step, 340 * s) }}>
              <div style={{ position: "absolute", bottom: 30 * s, fontFamily: theme.fontSans, fontWeight: 800, fontSize: (isLast ? 46 : 38) * s, color: theme.accent, whiteSpace: "nowrap", textShadow: TEXT_SHADOW, opacity: t, transform: `translateY(${(1 - t) * 14 * s}px)` }}>
                {stop.label}
              </div>
              <div style={{ position: "absolute", top: -11 * s, width: 22 * s, height: 22 * s, borderRadius: "50%", background: t > 0.5 ? theme.accent : "rgba(255,255,255,0.3)", boxShadow: isLast && t > 0.5 ? `0 0 ${24 * s}px ${theme.accent}` : "none", transform: `scale(${0.4 + 0.6 * t})` }} />
              <div style={{ position: "absolute", top: 34 * s, textAlign: "center", fontFamily: theme.fontSans, fontWeight: 600, fontSize: 28 * s, lineHeight: 1.2, color: theme.text, textShadow: TEXT_SHADOW, opacity: t }}>
                {stop.text}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
