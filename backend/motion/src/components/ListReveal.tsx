import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

const MAX_ENTRIES = 5;
// Frames entre una entrada y la siguiente.
const ENTRY_STAGGER = 9;

// Enumeracion: titulo arriba y las entradas sumandose de a una, con su
// numero calado en acento ("01", "02"...). A la izquierda, deja ver el video.
export function ListReveal({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, exit } = useMotion(withExit);
  const entries = (spec.items ?? []).slice(0, MAX_ENTRIES);
  if (entries.length < 2) return null;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="25% 50%" size="50% 70%" opacity={enter(0)} />
      <div style={{ position: "absolute", left: 170 * s, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 1000 * s }}>
        <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 32 * s, letterSpacing: 8 * s, textTransform: "uppercase", color: theme.accent, textShadow: TEXT_SHADOW, marginBottom: 40 * s, opacity: enter(0) }}>
          {spec.text}
        </div>
        {entries.map((entry, i) => {
          const t = enter(8 + i * ENTRY_STAGGER, 16);
          return (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 30 * s, marginBottom: 26 * s, opacity: t, transform: `translateX(${(1 - t) * -36 * s}px)` }}>
              <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 52 * s, color: "transparent", WebkitTextStroke: `${2 * s}px ${theme.accent}`, minWidth: 80 * s }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontFamily: theme.fontSans, fontWeight: 700, fontSize: 50 * s, lineHeight: 1.1, color: theme.text, textShadow: TEXT_SHADOW }}>
                {entry.text}
                {entry.label && <span style={{ fontWeight: 400, color: theme.textMuted, fontSize: "0.7em" }}>{`  ${entry.label}`}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
