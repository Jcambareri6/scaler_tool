import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

// Rojo fijo: el tachado dice "esto es falso" en cualquier paleta.
const STRIKE = "#FF4D4D";

// Palabra tachada (Ciencia y Vida: "IMPOSIBLE"): la palabra grande y despues
// una linea roja la cruza mientras la voz la desmiente; queda atenuada.
// `text` = la palabra o frase corta que se desmiente, literal del guion.
export function StrikeWord({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const t = enter(0, 14);
  const strike = draw(18, 30);
  const long = spec.text.length > 14;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.3)", opacity: t }} />
      <Scrim color={theme.scrim} at="50% 50%" size="65% 50%" opacity={t} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", padding: `0 ${24 * s}px`, opacity: t, transform: `scale(${0.94 + 0.06 * t})` }}>
          <div
            style={{
              fontFamily: theme.fontSans,
              fontWeight: 800,
              fontSize: (long ? 110 : 160) * s,
              letterSpacing: 4 * s,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              color: theme.text,
              textShadow: TEXT_SHADOW,
              opacity: 1 - 0.45 * strike,
            }}
          >
            {spec.text}
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "52%",
              height: 14 * s,
              borderRadius: 7 * s,
              background: STRIKE,
              boxShadow: `0 0 ${24 * s}px ${STRIKE}90`,
              transform: `rotate(-4deg) scaleX(${strike})`,
              transformOrigin: "left",
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
