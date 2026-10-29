import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { formatNumber, parseLiteralNumber, type CompactNumber } from "../lib/literal";

// Frames entre una columna y la siguiente.
const BAR_STAGGER = 6;
const MAX_BARS = 5;

// Comparacion de 2 a 5 valores (data_viz_single): columnas que crecen de a
// una con su cifra contando arriba y a que corresponde abajo. La mas alta va
// en el color de acento con brillo; el resto en blanco. El valor y el texto
// salen literales del guion (`items`), solo cambia como se escribe la cifra.
export function BarChart({
  spec,
  theme,
  exit: withExit = true,
  locale,
}: {
  spec: OverlaySpec;
  theme: Theme;
  exit?: boolean | undefined;
  locale?: string | undefined;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const s = height / 1080;

  const bars = (spec.items ?? [])
    .map((item) => ({ item, parsed: parseLiteralNumber(item.text) }))
    .filter((b): b is { item: { label: string; text: string }; parsed: CompactNumber } => b.parsed !== null && b.parsed.value >= 0)
    .slice(0, MAX_BARS);
  if (bars.length < 2) return null;

  const max = Math.max(...bars.map((b) => b.parsed.value)) || 1;
  const highlight = bars.findIndex((b) => b.parsed.value === max);
  const exit = withExit
    ? interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const enter = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 });

  const chartHeight = 440 * s;
  const barWidth = (bars.length <= 3 ? 150 : 120) * s;
  const gap = (bars.length <= 3 ? 110 : 90) * s;
  const shadow = "0 2px 20px rgba(0,0,0,0.5)";

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse 60% 65% at 50% 55%, ${theme.scrim}, transparent 78%)`, opacity: enter(0) }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        {spec.label && (
          <div
            style={{
              marginBottom: 56 * s,
              fontFamily: theme.fontSans,
              fontWeight: 600,
              fontSize: 34 * s,
              letterSpacing: 8 * s,
              textTransform: "uppercase",
              color: theme.textMuted,
              textShadow: shadow,
              opacity: enter(0),
            }}
          >
            {spec.label}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap, height: chartHeight + 90 * s }}>
          {bars.map(({ item, parsed }, i) => {
            const delay = 6 + i * BAR_STAGGER;
            const grow = interpolate(frame, [delay, delay + 22], [0, 1], {
              easing: Easing.out(Easing.cubic),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const isTop = i === highlight;
            const color = isTop ? theme.accent : theme.text;
            const barHeight = Math.max(6 * s, (parsed.value / max) * chartHeight);
            return (
              <div key={i} style={{ width: barWidth, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  style={{
                    marginBottom: 14 * s,
                    fontFamily: theme.fontSans,
                    fontWeight: 800,
                    // Con 4-5 columnas, "1.670 km/h" se pisaba con la de al lado.
                    fontSize: (bars.length <= 3 ? (isTop ? 54 : 44) : isTop ? 46 : 38) * s,
                    whiteSpace: "nowrap",
                    color,
                    textShadow: shadow,
                    fontVariantNumeric: "tabular-nums",
                    opacity: enter(delay),
                  }}
                >
                  {parsed.prefix && <span style={{ fontSize: "0.7em" }}>{parsed.prefix}</span>}
                  {formatNumber(parsed.value * grow, parsed, locale)}
                  {parsed.unit && <span style={{ fontSize: "0.5em", fontWeight: 600, marginLeft: 6 * s }}>{parsed.unit}</span>}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: barHeight * grow,
                    background: isTop ? theme.accent : "rgba(255,255,255,0.88)",
                    borderRadius: `${6 * s}px ${6 * s}px 0 0`,
                    boxShadow: isTop ? `0 0 ${40 * s}px ${theme.accent}80` : "0 2px 20px rgba(0,0,0,0.35)",
                  }}
                />
              </div>
            );
          })}
        </div>
        {/* Linea de base + nombres, aparte para que alineen aunque las cifras cambien de ancho. */}
        <div style={{ width: bars.length * barWidth + (bars.length - 1) * gap + 60 * s, height: 2 * s, background: "rgba(255,255,255,0.35)", opacity: enter(4) }} />
        <div style={{ display: "flex", gap, marginTop: 18 * s }}>
          {bars.map(({ item }, i) => (
            <div
              key={i}
              style={{
                width: barWidth,
                textAlign: "center",
                fontFamily: theme.fontSans,
                fontWeight: 600,
                fontSize: 28 * s,
                lineHeight: 1.15,
                color: i === highlight ? theme.text : theme.textMuted,
                textShadow: shadow,
                opacity: enter(6 + i * BAR_STAGGER + 8),
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
