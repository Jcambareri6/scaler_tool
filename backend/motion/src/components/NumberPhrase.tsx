import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

// Cifra dentro de una frase (Como Funciona El Mundo: "UNA VEZ DE CADA
// 10.000"): la frase en mayusculas y la cifra en un recuadro del acento que
// entra con un golpe. `text` = la frase literal, con la cifra.
export function NumberPhrase({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, exit } = useMotion(withExit);
  const match = /\d[\d.,\s]*\d|\d/.exec(spec.text);
  if (!match) return null;
  const before = spec.text.slice(0, match.index).trim();
  const after = spec.text.slice(match.index + match[0].length).trim();
  const t = enter(0, 14);
  const hit = enter(10, 12);
  const font = {
    fontFamily: theme.fontSans,
    fontWeight: 800,
    fontSize: (spec.text.length > 28 ? 64 : 80) * s,
    letterSpacing: 2 * s,
    textTransform: "uppercase" as const,
    textShadow: TEXT_SHADOW,
  };

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.3)", opacity: t }} />
      <Scrim color={theme.scrim} at="50% 50%" size="75% 50%" opacity={t} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: `0 ${140 * s}px` }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: `${16 * s}px ${22 * s}px`, color: theme.text }}>
          {before && <span style={{ ...font, opacity: t, transform: `translateY(${(1 - t) * 18 * s}px)` }}>{before}</span>}
          <span
            style={{
              ...font,
              padding: `${4 * s}px ${22 * s}px`,
              borderRadius: 8 * s,
              background: theme.accent,
              color: "#111",
              textShadow: "none",
              fontVariantNumeric: "tabular-nums",
              boxShadow: `0 0 ${36 * s}px ${theme.accent}70`,
              opacity: hit,
              transform: `scale(${1.25 - 0.25 * hit})`,
            }}
          >
            {match[0].trim()}
          </span>
          {after && <span style={{ ...font, opacity: enter(14, 14) }}>{after}</span>}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
