import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { useMotion } from "../lib/anim";

const MAX_ITEMS = 5;

// Panel lateral (GoMotion: "Dos periodos geologicos", "Vida del canon"): el
// video sigue a la izquierda y a la derecha entra un panel oscuro con una
// linea de acento, el titulo y las vinetas. `text` = titulo, `items` = vinetas.
export function SidePanel({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, width, enter, draw, exit } = useMotion(withExit);
  const entries = (spec.items ?? []).slice(0, MAX_ITEMS);
  if (entries.length < 1) return null;
  const panel = enter(0, 20);
  const panelWidth = width * 0.42;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: panelWidth,
          background: "linear-gradient(90deg, rgba(10,14,18,0.94), rgba(10,14,18,0.98))",
          borderLeft: `${5 * s}px solid ${theme.accent}`,
          transform: `translateX(${(1 - panel) * panelWidth}px)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: `0 ${90 * s}px`,
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 46 * s, letterSpacing: 2 * s, textTransform: "uppercase", color: theme.text, lineHeight: 1.1, opacity: enter(10) }}>
          {spec.text}
        </div>
        <div style={{ height: 4 * s, width: 120 * s * draw(14, 30), background: theme.accent, margin: `${22 * s}px 0 ${34 * s}px` }} />
        {entries.map((entry, i) => {
          const t = enter(20 + i * 8, 14);
          return (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 18 * s, marginBottom: 20 * s, opacity: t, transform: `translateX(${(1 - t) * 24 * s}px)` }}>
              <span style={{ width: 12 * s, height: 12 * s, borderRadius: "50%", background: theme.accent, flexShrink: 0, transform: `translateY(${-6 * s}px)` }} />
              <span style={{ fontFamily: theme.fontSans, fontWeight: 500, fontSize: 36 * s, color: theme.textMuted, lineHeight: 1.2 }}>
                {entry.text}
                {entry.label && <span style={{ color: theme.accent, fontWeight: 700 }}>{`  ${entry.label}`}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
