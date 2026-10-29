import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { parseLiteralNumber } from "../lib/literal";
import { iconFor } from "../lib/icons";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

// Mas de esto ya no se cuenta a simple vista: se dibujan MAX_ICONS y se
// deja la cifra escrita.
const MAX_ICONS = 12;

// Escala/analogia ("pesa como 3 autos"): el icono del objeto repetido N
// veces, apareciendo de a uno, con la frase literal debajo. El ultimo en
// acento remata la cuenta.
export function ScaleCompare({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, exit } = useMotion(withExit);
  const n = Math.round(parseLiteralNumber(spec.text)?.value ?? 1);
  const count = Math.max(1, Math.min(MAX_ICONS, n));
  const Icon = iconFor(spec.icon);
  const size = (count <= 4 ? 150 : count <= 8 ? 110 : 84) * s;
  const stagger = count <= 6 ? 5 : 3;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="50% 52%" size="60% 55%" opacity={enter(0)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 48 * s }}>
        {spec.label && (
          <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 32 * s, letterSpacing: 8 * s, textTransform: "uppercase", color: theme.textMuted, textShadow: TEXT_SHADOW, opacity: enter(0) }}>
            {spec.label}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 26 * s, maxWidth: 1300 * s }}>
          {Array.from({ length: count }, (_, i) => {
            const t = enter(4 + i * stagger, 14);
            const isLast = i === count - 1;
            return (
              <Icon
                key={i}
                size={size}
                strokeWidth={1.6}
                color={isLast ? theme.accent : theme.text}
                style={{
                  opacity: t,
                  transform: `translateY(${(1 - t) * 30 * s}px) scale(${0.6 + 0.4 * t})`,
                  filter: isLast ? `drop-shadow(0 0 ${18 * s}px ${theme.accent})` : "drop-shadow(0 2px 12px rgba(0,0,0,0.5))",
                }}
              />
            );
          })}
        </div>
        <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 76 * s, textTransform: "uppercase", color: theme.text, textShadow: TEXT_SHADOW, opacity: enter(8 + count * stagger), transform: `translateY(${(1 - enter(8 + count * stagger)) * 20 * s}px)` }}>
          {spec.text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
