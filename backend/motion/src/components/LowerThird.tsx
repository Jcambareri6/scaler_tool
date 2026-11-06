import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

// Definicion de un concepto/termino: abajo a la izquierda, barra vertical de
// acento que crece, el termino en bold y la definicion corta debajo. Se
// descubre de izquierda a derecha (mascara), sin tapar el video.
export function LowerThird({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const bar = draw(0, 12);
  const reveal = enter(6, 20);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Velo mas cerrado que el resto: el rotulo va sobre el video sin
          desenfoque, y sobre stock claro y con detalle se perdia. */}
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 28%, transparent 45%)", opacity: enter(0) }} />
      <Scrim color={theme.scrim} at="15% 85%" size="45% 35%" opacity={enter(0)} />
      <div style={{ position: "absolute", left: 140 * s, bottom: 150 * s, display: "flex", alignItems: "stretch", gap: 28 * s }}>
        <div style={{ width: 6 * s, background: theme.accent, transform: `scaleY(${bar})`, transformOrigin: "bottom", boxShadow: `0 0 ${16 * s}px ${theme.accent}80` }} />
        <div style={{ clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`, maxWidth: 1100 * s }}>
          <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 64 * s, lineHeight: 1.05, color: theme.text, textShadow: TEXT_SHADOW }}>
            {spec.text}
          </div>
          {spec.label && (
            <div style={{ marginTop: 12 * s, fontFamily: theme.fontSans, fontWeight: 400, fontSize: 34 * s, lineHeight: 1.25, color: theme.textMuted, textShadow: TEXT_SHADOW, opacity: enter(14) }}>
              {spec.label}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}
