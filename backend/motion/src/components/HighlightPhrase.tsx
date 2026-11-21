import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

const WORD_STAGGER = 3;

function bare(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

// Frase sobre el VIDEO con palabras resaltadas en una caja de color
// (GoMotion: "Algo que cambio PARA SIEMPRE el canon"). A diferencia de
// kinetic_quote (centrada, pantalla oscura), va a la izquierda y deja ver el
// video. `text` = la frase, `label` = las palabras resaltadas (literales).
export function HighlightPhrase({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, exit } = useMotion(withExit);
  const words = spec.text.trim().replace(/[.…]+$/, "").split(/\s+/);
  const keys = new Set((spec.label ?? "").split(/\s+/).map(bare).filter(Boolean));
  // Lineas de ~3 palabras (como GoMotion): se cortan por cantidad de letras.
  const lines: string[][] = [[]];
  for (const w of words) {
    const line = lines[lines.length - 1]!;
    if (line.length && line.join(" ").length + w.length > 22) lines.push([w]);
    else line.push(w);
  }
  let index = 0;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="28% 50%" size="55% 65%" opacity={enter(0)} />
      <div style={{ position: "absolute", left: 170 * s, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 * s }}>
        {lines.map((line, li) => (
          <div key={li} style={{ display: "flex", gap: 16 * s }}>
            {line.map((w) => {
              const k = index++;
              const t = enter(4 + k * WORD_STAGGER, 12);
              const hit = keys.has(bare(w));
              return (
                <span
                  key={k}
                  style={{
                    fontFamily: theme.fontSans,
                    fontWeight: 800,
                    fontSize: 64 * s,
                    lineHeight: 1.15,
                    textTransform: "uppercase",
                    color: hit ? "#0d0d0d" : theme.text,
                    textShadow: hit ? "none" : TEXT_SHADOW,
                    background: hit ? theme.accent : "transparent",
                    padding: hit ? `0 ${12 * s}px` : 0,
                    opacity: t,
                    transform: `translateY(${(1 - t) * 18 * s}px)`,
                    display: "inline-block",
                  }}
                >
                  {w}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}
