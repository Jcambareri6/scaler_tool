import { AbsoluteFill, interpolate } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, uiText, useMotion } from "../lib/anim";

// Mito vs realidad: el mito (`text`) aparece, una linea lo tacha y se
// apaga; debajo entra la realidad (`label`) en acento. Los rotulos
// "Mito"/"Realidad" son de interfaz, en el idioma del canal.
export function MythFact({ spec, theme, exit: withExit, locale }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined; locale?: string | undefined }) {
  const { frame, s, enter, draw, exit } = useMotion(withExit);
  const strike = draw(18, 30);
  const dim = interpolate(frame, [30, 38], [1, 0.45], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fact = enter(36, 18);

  // Rotulo en su propia linea (bloque angosto centrado): inline-block lo
  // dejaba pegado a la frase del mito.
  const tag = (text: string, color: string, opacity: number) => (
    <div style={{ display: "table", margin: "0 auto", fontFamily: theme.fontSans, fontWeight: 700, fontSize: 26 * s, letterSpacing: 8 * s, textTransform: "uppercase", color, borderBottom: `${2 * s}px solid ${color}`, paddingBottom: 6 * s, marginBottom: 20 * s, opacity }}>
      {text}
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="50% 50%" size="65% 65%" opacity={enter(0)} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 70 * s, textAlign: "center" }}>
        <div style={{ opacity: enter(2) * dim, maxWidth: 1400 * s }}>
          {tag(uiText(locale, "myth"), theme.textMuted, 1)}
          <div style={{ position: "relative", display: "inline-block", fontFamily: theme.fontSans, fontWeight: 700, fontSize: 64 * s, lineHeight: 1.15, color: theme.text, textShadow: TEXT_SHADOW }}>
            {spec.text}
            <div style={{ position: "absolute", left: 0, top: "52%", height: 6 * s, width: `${strike * 100}%`, background: "#FF4D4D", boxShadow: "0 0 12px rgba(255,77,77,0.6)" }} />
          </div>
        </div>
        <div style={{ opacity: fact, transform: `translateY(${(1 - fact) * 24 * s}px)`, maxWidth: 1400 * s }}>
          {tag(uiText(locale, "fact"), theme.accent, 1)}
          <div style={{ fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 84 * s, lineHeight: 1.08, color: theme.accent, textShadow: `0 0 ${30 * s}px ${theme.accent}55, ${TEXT_SHADOW}` }}>
            {spec.label}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
