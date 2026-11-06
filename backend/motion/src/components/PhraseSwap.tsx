import { AbsoluteFill, interpolate } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

// Frase que se reemplaza (Como Funciona El Mundo: "UN TALENTO QUE NADIE
// ENTENDÍA" -> "UN PUNTO CIEGO QUE TAMPOCO"): la primera (`text`) se lee,
// se desenfoca y se va, y en el mismo lugar entra la segunda (`label`) en el
// acento. Contrapone dos ideas. Las dos literales del guion.
export function PhraseSwap({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, frame, enter, exit } = useMotion(withExit);
  const first = enter(0, 14);
  // La primera aguanta ~1 s y se funde en la segunda.
  const out = interpolate(frame, [30, 42], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const second = enter(36, 16);
  const size = (text: string) => (text.length > 26 ? 76 : 96);
  const style = (text: string) => ({
    position: "absolute" as const,
    left: 160 * s,
    right: 160 * s,
    textAlign: "center" as const,
    fontFamily: theme.fontSans,
    fontWeight: 800,
    fontSize: size(text) * s,
    lineHeight: 1.1,
    letterSpacing: 2 * s,
    textTransform: "uppercase" as const,
    textShadow: TEXT_SHADOW,
  });

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.3)", opacity: first }} />
      <Scrim color={theme.scrim} at="50% 50%" size="75% 55%" opacity={first} />
      <AbsoluteFill style={{ justifyContent: "center" }}>
        <div style={{ position: "relative", height: 260 * s, display: "flex", alignItems: "center" }}>
          <div
            style={{
              ...style(spec.text),
              color: theme.text,
              opacity: first * (1 - out),
              filter: `blur(${out * 14 * s}px)`,
              transform: `translateY(${-out * 20 * s}px)`,
            }}
          >
            {spec.text}
          </div>
          {spec.label && (
            <div
              style={{
                ...style(spec.label),
                color: theme.accent,
                opacity: second,
                filter: `blur(${(1 - second) * 14 * s}px)`,
                transform: `translateY(${(1 - second) * 20 * s}px)`,
              }}
            >
              {spec.label}
            </div>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
