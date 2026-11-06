import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

const MAX_CARDS = 6;
const CARD_STAGGER = 5;

// Grilla de tarjetas (El Niño: "THE NINE STRONG EL NIÑOS"): muchos casos a
// la vez, cada tarjeta entra de a una con que es arriba (`label`: el año, el
// nombre) y su dato abajo (`text`). `text` del grafico = titulo. Todo literal.
export function CardGrid({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const cards = (spec.items ?? []).slice(0, MAX_CARDS);
  if (cards.length < 2) return null;
  const perRow = cards.length <= 4 ? cards.length : 3;
  const cardWidth = (perRow <= 2 ? 440 : perRow === 3 ? 400 : 330) * s;
  const gap = 28 * s;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.42)", opacity: enter(0) }} />
      <Scrim color={theme.scrim} at="50% 52%" size="85% 80%" opacity={enter(0)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 44 * s, textTransform: "uppercase", letterSpacing: 2 * s, color: theme.text, textShadow: TEXT_SHADOW, opacity: enter(0) }}>
          {spec.text}
        </div>
        <div style={{ width: 120 * s, height: 4 * s, margin: `${18 * s}px 0 ${44 * s}px`, background: theme.accent, transform: `scaleX(${draw(2, 16)})` }} />
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap, width: perRow * cardWidth + (perRow - 1) * gap }}>
          {cards.map((card, i) => {
            const t = enter(8 + i * CARD_STAGGER, 16);
            return (
              <div
                key={i}
                style={{
                  width: cardWidth,
                  boxSizing: "border-box",
                  padding: `${26 * s}px ${30 * s}px`,
                  background: "rgba(8,10,14,0.62)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderTop: `${4 * s}px solid ${theme.accent}`,
                  borderRadius: 10 * s,
                  opacity: t,
                  transform: `translateY(${(1 - t) * 30 * s}px)`,
                }}
              >
                {card.label && (
                  <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 24 * s, letterSpacing: 4 * s, textTransform: "uppercase", color: theme.accent }}>
                    {card.label}
                  </div>
                )}
                <div style={{ marginTop: 10 * s, fontFamily: theme.fontSans, fontWeight: 700, fontSize: 36 * s, lineHeight: 1.15, color: theme.text }}>
                  {card.text}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
