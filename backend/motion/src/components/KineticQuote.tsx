import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";

// Frames entre una palabra y la siguiente.
const WORD_STAGGER = 4;

// Comparacion sin mayusculas, acentos ni puntuacion: "Nunca," == "nunca".
function bare(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

// Frase clave del guion para LEER: mayusculas bold centradas, entran palabra
// por palabra (suben y se enfocan), y la palabra clave (`label`) va en el
// color de acento con un pequeño golpe de escala cuando aparece.
export function KineticQuote({
  spec,
  theme,
  exit: withExit = true,
}: {
  spec: OverlaySpec;
  theme: Theme;
  exit?: boolean | undefined;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const s = height / 1080;

  // El punto final no se muestra (en pantalla la frase se lee mejor sin el);
  // "?" y "!" si, cambian el sentido.
  const words = spec.text.trim().replace(/[.…]+$/, "").split(/\s+/);
  const keyWords = new Set((spec.label ?? "").split(/\s+/).map(bare).filter(Boolean));
  const exit = withExit
    ? interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const scrim = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 65% 50% at 50% 50%, ${theme.scrim}, transparent 75%)`,
          opacity: scrim,
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            maxWidth: 1500 * s,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            columnGap: 26 * s,
            rowGap: 6 * s,
            fontFamily: theme.fontSans,
            fontWeight: 800,
            fontSize: 92 * s,
            lineHeight: 1.08,
            letterSpacing: 1 * s,
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          {words.map((word, i) => {
            const delay = 4 + i * WORD_STAGGER;
            const t = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 16 });
            const isKey = keyWords.has(bare(word));
            const pop = isKey
              ? interpolate(spring({ frame: frame - delay - 6, fps, config: { damping: 12, stiffness: 180 } }), [0, 1], [1, 1.08])
              : 1;
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  color: isKey ? theme.accent : theme.text,
                  opacity: t,
                  filter: `blur(${(1 - t) * 8 * s}px)`,
                  transform: `translateY(${(1 - t) * 40 * s}px) scale(${pop})`,
                  textShadow: isKey ? `0 0 ${28 * s}px ${theme.accent}66, 0 2px 24px rgba(0,0,0,0.5)` : "0 2px 24px rgba(0,0,0,0.5)",
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
