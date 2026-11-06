import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

const MAX_NODES = 5;
const NODE_STAGGER = 8;

// Indice de lo que viene (Ciencia y Vida: "01 Cómo frena un tren" en un
// recuadro unido al siguiente): las partes en orden como nodos conectados
// por una linea; la primera (la que arranca ahora) en el acento. `text` =
// titulo, `items` = las partes ({label: "", text: el titulo}).
export function ChapterIndex({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const nodes = (spec.items ?? []).slice(0, MAX_NODES);
  if (nodes.length < 2) return null;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.35)", opacity: enter(0) }} />
      <Scrim color={theme.scrim} at="40% 50%" size="70% 80%" opacity={enter(0)} />
      <div style={{ position: "absolute", left: 260 * s, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div
          style={{
            marginBottom: 40 * s,
            fontFamily: theme.fontSans,
            fontWeight: 600,
            fontSize: 28 * s,
            letterSpacing: 8 * s,
            textTransform: "uppercase",
            color: theme.textMuted,
            textShadow: TEXT_SHADOW,
            opacity: enter(0),
          }}
        >
          {spec.text}
        </div>
        {nodes.map((node, i) => {
          const delay = 6 + i * NODE_STAGGER;
          const t = enter(delay, 14);
          const current = i === 0;
          return (
            <div key={i}>
              {i > 0 && (
                <div
                  style={{
                    marginLeft: 36 * s,
                    width: 3 * s,
                    height: 34 * s,
                    background: "rgba(255,255,255,0.4)",
                    transform: `scaleY(${draw(delay - 6, delay)})`,
                    transformOrigin: "top",
                  }}
                />
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 26 * s, opacity: current ? t : t * 0.7, transform: `translateX(${(1 - t) * -30 * s}px)` }}>
                <div
                  style={{
                    width: 75 * s,
                    height: 62 * s,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `${3 * s}px solid ${current ? theme.accent : "rgba(255,255,255,0.5)"}`,
                    borderRadius: 8 * s,
                    background: current ? `${theme.accent}26` : "rgba(0,0,0,0.35)",
                    fontFamily: theme.fontSans,
                    fontWeight: 800,
                    fontSize: 30 * s,
                    fontVariantNumeric: "tabular-nums",
                    color: current ? theme.accent : theme.text,
                    boxShadow: current ? `0 0 ${24 * s}px ${theme.accent}60` : "none",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div style={{ fontFamily: theme.fontSans, fontWeight: current ? 800 : 600, fontSize: (current ? 46 : 38) * s, color: theme.text, textShadow: TEXT_SHADOW }}>
                  {node.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
