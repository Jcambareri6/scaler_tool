import { AbsoluteFill, Easing, interpolate } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { formatNumber, parseLiteralNumber } from "../lib/literal";
import { Scrim, TEXT_SHADOW, uiText, useMotion } from "../lib/anim";

// X contra Y: dos barras horizontales finas, una por lado, con su valor
// literal del guion; la mayor en acento. `text` (la conclusion) cierra
// abajo en serif. Si los valores no son cifras comparables, las barras
// quedan del mismo largo y manda el texto.
export function Versus({ spec, theme, exit: withExit, locale }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined; locale?: string | undefined }) {
  const { frame, s, enter, exit } = useMotion(withExit);
  const sides = (spec.items ?? []).slice(0, 2);
  if (sides.length < 2) return null;

  const parsed = sides.map((side) => parseLiteralNumber(side.text));
  const values = parsed.map((p) => p?.value ?? 0);
  const comparable = parsed.every((p) => p !== null) && Math.max(...values) > 0;
  const max = Math.max(...values) || 1;
  const winner = comparable ? values.indexOf(max) : -1;
  const trackWidth = 980 * s;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="50% 50%" size="62% 62%" opacity={enter(0)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <div style={{ width: trackWidth, display: "flex", flexDirection: "column", gap: 54 * s }}>
          {sides.map((side, i) => {
            const delay = 4 + i * 12;
            const grow = interpolate(frame, [delay + 4, delay + 28], [0, 1], {
              easing: Easing.out(Easing.cubic),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const fraction = comparable ? Math.max(0.04, values[i]! / max) : 1;
            const isWin = i === winner;
            const p = parsed[i];
            return (
              <div key={i} style={{ opacity: enter(delay), transform: `translateX(${(1 - enter(delay)) * (i === 0 ? -40 : 40) * s}px)` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 * s }}>
                  <span style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 34 * s, letterSpacing: 6 * s, textTransform: "uppercase", color: theme.textMuted, textShadow: TEXT_SHADOW }}>
                    {side.label}
                  </span>
                  <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 64 * s, color: isWin ? theme.accent : theme.text, textShadow: TEXT_SHADOW, fontVariantNumeric: "tabular-nums" }}>
                    {p ? (
                      <>
                        {p.prefix && <span style={{ fontSize: "0.7em" }}>{p.prefix}</span>}
                        {formatNumber(p.value * grow, p, locale)}
                        {p.unit && <span style={{ fontSize: "0.5em", fontWeight: 600, marginLeft: 8 * s }}>{p.unit}</span>}
                      </>
                    ) : (
                      side.text
                    )}
                  </span>
                </div>
                <div style={{ width: "100%", height: 10 * s, background: "rgba(255,255,255,0.14)", borderRadius: 5 * s }}>
                  <div
                    style={{
                      width: `${fraction * grow * 100}%`,
                      height: "100%",
                      borderRadius: 5 * s,
                      background: isWin ? theme.accent : theme.text,
                      boxShadow: isWin ? `0 0 ${24 * s}px ${theme.accent}90` : "none",
                    }}
                  />
                </div>
                {i === 0 && (
                  <div style={{ textAlign: "center", marginTop: 24 * s, marginBottom: -30 * s, fontFamily: theme.fontSerif, fontStyle: "italic", fontSize: 40 * s, color: theme.textMuted, opacity: enter(10) }}>
                    {uiText(locale, "vs")}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 56 * s, color: theme.accent, textAlign: "center", textShadow: TEXT_SHADOW, opacity: enter(40), transform: `translateY(${(1 - enter(40)) * 16 * s}px)` }}>
            {spec.text}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
