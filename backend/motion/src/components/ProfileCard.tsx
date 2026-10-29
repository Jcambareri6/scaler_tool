import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

const MAX_FACTS = 4;

// Ficha de un protagonista (especie, persona, objeto): a la derecha, para
// dejar el sujeto del video a la vista. Nombre en serif con una linea de
// acento, y los datos clave en columnas (que dato arriba, valor abajo).
export function ProfileCard({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const facts = (spec.items ?? []).slice(0, MAX_FACTS);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="78% 50%" size="45% 70%" opacity={enter(0)} />
      <div style={{ position: "absolute", right: 150 * s, top: 0, bottom: 0, width: 760 * s, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 96 * s, lineHeight: 1, color: theme.text, textShadow: TEXT_SHADOW, opacity: enter(2), transform: `translateY(${(1 - enter(2)) * 20 * s}px)` }}>
          {spec.text}
        </div>
        {spec.label && (
          <div style={{ marginTop: 10 * s, fontFamily: theme.fontSerif, fontStyle: "italic", fontSize: 40 * s, color: theme.textMuted, textShadow: TEXT_SHADOW, opacity: enter(8) }}>
            {spec.label}
          </div>
        )}
        <div style={{ width: 760 * s * draw(6, 24), height: 2 * s, background: theme.accent, margin: `${30 * s}px 0` }} />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(2, Math.max(1, facts.length))}, 1fr)`, rowGap: 30 * s, columnGap: 40 * s }}>
          {facts.map((fact, i) => {
            const t = enter(14 + i * 6, 16);
            return (
              <div key={i} style={{ opacity: t, transform: `translateY(${(1 - t) * 16 * s}px)` }}>
                <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 24 * s, letterSpacing: 5 * s, textTransform: "uppercase", color: theme.textMuted, textShadow: TEXT_SHADOW }}>
                  {fact.label}
                </div>
                <div style={{ marginTop: 6 * s, fontFamily: theme.fontSans, fontWeight: 800, fontSize: 48 * s, color: theme.accent, textShadow: TEXT_SHADOW }}>
                  {fact.text}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
