import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

const clean = (word: string) => word.toLowerCase().replace(/[¿?¡!.,;:"«»“”]/g, "");

// Pregunta pivote (Ciencia y Vida: "¿Por qué no frenó?"): la pregunta sola en
// el centro, palabra por palabra, y despues se subraya la palabra clave
// (`label`, de la misma pregunta) en el acento. Abre intriga antes de una
// parte nueva.
export function PivotQuestion({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const words = spec.text.trim().split(/\s+/);
  const key = (spec.label ?? "").trim().split(/\s+/).map(clean).filter(Boolean);
  // Donde arranca la palabra clave dentro de la pregunta (-1 si no esta).
  const keyAt = key.length
    ? words.findIndex((_, i) => key.every((k, j) => clean(words[i + j] ?? "") === k))
    : -1;
  const lastWordAt = 4 + (words.length - 1) * 4;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.35)", opacity: enter(0) }} />
      <Scrim color={theme.scrim} at="50% 50%" size="70% 60%" opacity={enter(0)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: `0 ${200 * s}px` }}>
        <div
          style={{
            fontFamily: theme.fontSerif,
            fontWeight: 500,
            fontSize: (words.length > 6 ? 92 : 112) * s,
            lineHeight: 1.12,
            textAlign: "center",
            color: theme.text,
            textShadow: TEXT_SHADOW,
          }}
        >
          {words.map((word, i) => {
            const t = enter(4 + i * 4, 14);
            const isKey = keyAt >= 0 && i >= keyAt && i < keyAt + key.length;
            return (
              <span key={i}>
                {i > 0 ? " " : ""}
                <span
                  style={{
                    display: "inline-block",
                    position: "relative",
                    opacity: t,
                    transform: `translateY(${(1 - t) * 24 * s}px)`,
                    color: isKey ? theme.accent : undefined,
                  }}
                >
                  {word}
                  {isKey && (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 4 * s,
                        height: 6 * s,
                        background: theme.accent,
                        transform: `scaleX(${draw(lastWordAt + 6, lastWordAt + 18)})`,
                        transformOrigin: "left",
                        boxShadow: `0 0 ${14 * s}px ${theme.accent}80`,
                      }}
                    />
                  )}
                </span>
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
