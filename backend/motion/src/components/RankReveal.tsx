import { AbsoluteFill, interpolate } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { parseLiteralNumber } from "../lib/literal";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

// Puesto de un ranking: "#" y numero gigantes que caen desde grande y
// desenfocados hasta su lugar, y el nombre (`label`) en serif al costado.
// Si `text` no trae numero, se muestra tal cual.
export function RankReveal({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, exit } = useMotion(withExit);
  const rank = parseLiteralNumber(spec.text);
  const t = enter(2, 20);
  const scale = interpolate(t, [0, 1], [1.6, 1]);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="35% 50%" size="60% 65%" opacity={enter(0)} />
      <div style={{ position: "absolute", left: 200 * s, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 50 * s }}>
        <div style={{ display: "flex", alignItems: "flex-start", fontFamily: theme.fontSans, fontWeight: 800, color: theme.accent, textShadow: `0 0 ${40 * s}px ${theme.accent}70`, opacity: t, transform: `scale(${scale})`, transformOrigin: "left center", filter: `blur(${(1 - t) * 10 * s}px)` }}>
          {rank ? (
            <>
              <span style={{ fontSize: 120 * s, marginTop: 40 * s, marginRight: 6 * s }}>#</span>
              <span style={{ fontSize: 300 * s, lineHeight: 1 }}>{Math.round(rank.value)}</span>
            </>
          ) : (
            <span style={{ fontSize: 140 * s }}>{spec.text}</span>
          )}
        </div>
        {spec.label && (
          <div style={{ maxWidth: 900 * s, fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 92 * s, lineHeight: 1.05, color: theme.text, textShadow: TEXT_SHADOW, opacity: enter(14), transform: `translateX(${(1 - enter(14)) * 30 * s}px)` }}>
            {spec.label}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
