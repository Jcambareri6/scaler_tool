import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { BigNumberSpec } from "../spec";
import type { Theme } from "../theme";
import { formatNumber, parseLiteralNumber } from "../lib/literal";

// Cifra que impacta: guion de acento arriba, prefijo y unidad en acento,
// numero enorme que cuenta desde 0, descripcion debajo. Sin caja: va
// directo sobre el video, con un velo suave a la izquierda para que se lea.
export function BigNumber({ spec, theme }: { spec: BigNumberSpec; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const s = height / 1080;

  const parsed = parseLiteralNumber(spec.text);
  const countFrames = Math.round(fps * 1.3);
  const counted = interpolate(frame, [4, 4 + countFrames], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const enter = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 });
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dash = interpolate(frame, [0, 14], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateRight: "clamp" });

  const shadow = "0 2px 24px rgba(0,0,0,0.45)";
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 55% 60% at 20% 45%, ${theme.scrim}, transparent 70%)`,
          opacity: enter(0),
        }}
      />
      <div style={{ position: "absolute", left: 190 * s, top: 330 * s, display: "flex", flexDirection: "column" }}>
        <div style={{ width: 70 * s * dash, height: 3 * s, background: theme.accent, marginBottom: 34 * s }} />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14 * s,
            fontFamily: theme.fontSans,
            textShadow: shadow,
            opacity: enter(2),
            transform: `translateY(${(1 - enter(2)) * 24 * s}px)`,
          }}
        >
          {parsed ? (
            <>
              {parsed.prefix && (
                <span style={{ color: theme.accent, fontWeight: 600, fontSize: 120 * s }}>{parsed.prefix}</span>
              )}
              <span
                style={{
                  color: theme.text,
                  fontWeight: 800,
                  fontSize: 190 * s,
                  letterSpacing: -4 * s,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatNumber(parsed.value * counted, parsed)}
              </span>
              {parsed.unit && (
                <span style={{ color: theme.accent, fontWeight: 600, fontSize: 64 * s }}>{parsed.unit}</span>
              )}
            </>
          ) : (
            <span style={{ color: theme.text, fontWeight: 800, fontSize: 130 * s }}>{spec.text}</span>
          )}
        </div>
        {spec.label && (
          <div
            style={{
              marginTop: 18 * s,
              fontFamily: theme.fontSans,
              fontWeight: 400,
              fontSize: 46 * s,
              color: theme.textMuted,
              textShadow: shadow,
              opacity: enter(10),
              transform: `translateY(${(1 - enter(10)) * 16 * s}px)`,
            }}
          >
            {spec.label}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
