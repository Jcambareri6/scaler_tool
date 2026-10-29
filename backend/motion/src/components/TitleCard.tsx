import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";

// Inicio de capitulo (o la pregunta central del video): el video queda
// oscurecido, numero de capitulo gigante solo en contorno detras, titulo
// en serif, bajada en mayusculas espaciadas y una barra fina arriba que se
// llena hasta la parte del video en que arranca el capitulo. Sin cajas.
export function TitleCard({
  spec,
  theme,
  exit: withExit = true,
}: {
  spec: OverlaySpec;
  theme: Theme;
  exit?: boolean | undefined;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const s = height / 1080;

  const enter = (delay: number, frames = 22) =>
    spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: frames });
  const exit = withExit
    ? interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  const progress = typeof spec.progress === "number" ? Math.min(1, Math.max(0, spec.progress)) : null;
  const barFill = interpolate(frame, [6, 36], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rule = interpolate(frame, [8, 30], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const chapter = typeof spec.chapter === "number" ? String(spec.chapter).padStart(2, "0") : null;
  const shadow = "0 2px 30px rgba(0,0,0,0.5)";

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Velo: mas cerrado que el de las cifras -- el capitulo "corta" el video. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 80% 75% at 35% 50%, ${theme.scrim}, rgba(0,0,0,0.82))`,
          opacity: enter(0, 14),
        }}
      />

      {progress !== null && (
        <div style={{ position: "absolute", left: 0, top: 0, width, height: 6 * s, background: "rgba(255,255,255,0.14)", opacity: enter(0, 12) }}>
          <div style={{ width: width * progress * barFill, height: "100%", background: theme.accent }} />
        </div>
      )}

      {chapter && (
        <div
          style={{
            position: "absolute",
            left: 120 * s,
            top: 150 * s,
            fontFamily: theme.fontSans,
            fontWeight: 800,
            fontSize: 620 * s,
            lineHeight: 1,
            letterSpacing: -20 * s,
            color: "transparent",
            WebkitTextStroke: `${3 * s}px ${theme.accent}`,
            opacity: 0.28 * enter(0, 30),
            transform: `translateX(${(1 - enter(0, 30)) * -40 * s}px)`,
          }}
        >
          {chapter}
        </div>
      )}

      <div style={{ position: "absolute", left: 200 * s, top: 410 * s, width: 1400 * s, display: "flex", flexDirection: "column" }}>
        <div style={{ width: 90 * s * rule, height: 3 * s, background: theme.accent, marginBottom: 36 * s }} />
        <div
          style={{
            fontFamily: theme.fontSerif,
            fontWeight: 500,
            fontSize: 112 * s,
            lineHeight: 1.05,
            color: theme.text,
            textShadow: shadow,
            opacity: enter(6),
            transform: `translateY(${(1 - enter(6)) * 28 * s}px)`,
          }}
        >
          {spec.text}
        </div>
        {spec.label && (
          <div
            style={{
              marginTop: 30 * s,
              fontFamily: theme.fontSans,
              fontWeight: 600,
              fontSize: 30 * s,
              letterSpacing: 8 * s,
              textTransform: "uppercase",
              color: theme.textMuted,
              textShadow: shadow,
              opacity: enter(16),
              transform: `translateY(${(1 - enter(16)) * 16 * s}px)`,
            }}
          >
            {spec.label}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
