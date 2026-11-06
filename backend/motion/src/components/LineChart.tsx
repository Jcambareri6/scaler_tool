import { AbsoluteFill, Easing, interpolate } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { formatNumber, parseLiteralNumber, type CompactNumber } from "../lib/literal";
import { Scrim, TEXT_SHADOW, uiText, useMotion } from "../lib/anim";

const MAX_POINTS = 8;
// Frames que tarda la linea en dibujarse entera.
const DRAW_FRAMES = 42;

// Tendencia con fuente (El Niño: "THE PLANET'S TEMPERATURE · NASA"): la
// linea se dibuja de izquierda a derecha y cada punto aparece con su cifra
// cuando la linea llega; el maximo queda marcado en el acento. `text` =
// titulo, `label` = la fuente, `items` = puntos en orden ({label: año o
// etapa, text: valor}). Todo literal del guion.
export function LineChart({ spec, theme, exit: withExit, locale }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined; locale?: string | undefined }) {
  const { s, frame, width, enter, exit } = useMotion(withExit);

  const points = (spec.items ?? [])
    .map((item) => ({ item, parsed: parseLiteralNumber(item.text) }))
    .filter((p): p is { item: { label: string; text: string }; parsed: CompactNumber } => p.parsed !== null)
    .slice(0, MAX_POINTS);
  if (points.length < 2) return null;

  const W = 1360 * s;
  const H = 400 * s;
  const values = points.map((p) => p.parsed.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xy = points.map((p, i) => ({
    x: (i / (points.length - 1)) * W,
    // 15% de aire arriba y abajo para las cifras.
    y: H - (0.15 + (0.7 * (p.parsed.value - min)) / span) * H,
  }));
  const peak = values.indexOf(max);
  const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const length = xy.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - xy[i]!.x, p.y - xy[i]!.y), 0);
  const drawn = interpolate(frame, [8, 8 + DRAW_FRAMES], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Frame en que la linea llega a cada punto (para que aparezca su cifra).
  const reach = (i: number) => 8 + (i / (points.length - 1)) * DRAW_FRAMES;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Mucho texto chico: fondo mas oscuro que una cifra sola. */}
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.42)", opacity: enter(0) }} />
      <Scrim color={theme.scrim} at="50% 50%" size="85% 85%" opacity={enter(0)} />
      <div style={{ position: "absolute", left: (width - W) / 2, top: 170 * s, width: W }}>
        <div style={{ opacity: enter(0), transform: `translateY(${(1 - enter(0)) * 16 * s}px)` }}>
          <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 46 * s, textTransform: "uppercase", letterSpacing: 2 * s, color: theme.text, textShadow: TEXT_SHADOW }}>
            {spec.text}
          </div>
          {spec.label && (
            <div style={{ marginTop: 8 * s, fontFamily: theme.fontSans, fontWeight: 600, fontSize: 22 * s, letterSpacing: 4 * s, textTransform: "uppercase", color: theme.textMuted, textShadow: TEXT_SHADOW }}>
              {uiText(locale, "source")} · {spec.label}
            </div>
          )}
        </div>
        <div style={{ position: "relative", width: W, height: H, marginTop: 70 * s }}>
          <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <line x1={0} y1={H} x2={W * enter(2)} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth={2 * s} />
            <path
              d={path}
              fill="none"
              stroke={theme.text}
              strokeWidth={5 * s}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={length}
              strokeDashoffset={length * (1 - drawn)}
              style={{ filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.5))" }}
            />
            {xy.map((p, i) => {
              const t = enter(reach(i), 12);
              const isPeak = i === peak;
              return (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={(isPeak ? 13 : 8) * s * t}
                  fill={isPeak ? theme.accent : theme.text}
                  style={isPeak ? { filter: `drop-shadow(0 0 ${12 * s}px ${theme.accent})` } : undefined}
                />
              );
            })}
          </svg>
          {/* Cifras y etiquetas en HTML (mejor tipografia que <text>). */}
          {xy.map((p, i) => {
            const t = enter(reach(i), 12);
            const isPeak = i === peak;
            const { parsed, item } = points[i]!;
            const label = { position: "absolute" as const, left: p.x, transform: "translateX(-50%)", whiteSpace: "nowrap" as const, textShadow: TEXT_SHADOW, opacity: t };
            return (
              <div key={i}>
                <div
                  style={{
                    ...label,
                    top: p.y - (isPeak ? 70 : 54) * s,
                    fontFamily: theme.fontSans,
                    fontWeight: 800,
                    fontSize: (isPeak ? 44 : 32) * s,
                    color: isPeak ? theme.accent : theme.text,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {parsed.prefix && <span style={{ fontSize: "0.7em" }}>{parsed.prefix}</span>}
                  {formatNumber(parsed.value, parsed, locale)}
                  {parsed.unit === "°" ? "°" : parsed.unit && <span style={{ fontSize: "0.55em", fontWeight: 600, marginLeft: 4 * s }}>{parsed.unit}</span>}
                </div>
                <div style={{ ...label, top: H + 16 * s, fontFamily: theme.fontSans, fontWeight: 600, fontSize: 26 * s, color: isPeak ? theme.text : theme.textMuted }}>
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
