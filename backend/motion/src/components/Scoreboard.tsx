import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";

// "cuatro a uno": el guion suele decir el resultado en palabras.
const NUMBER_WORDS: Record<string, number> = {
  cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  um: 1, duas: 2, "três": 3, quatro: 4,
};

function score(text: string): string {
  const digits = /\d+/.exec(text);
  if (digits) return digits[0];
  const word = text.toLowerCase().trim().split(/\s+/).find((w) => w in NUMBER_WORDS);
  return word ? String(NUMBER_WORDS[word]) : text.trim();
}

// Marcador (Como Funciona El Mundo: "ALPHAGO 4 · LEE SEDOL 1"): dos lados con
// su nombre (`label`) y su resultado (`text`) en recuadros; el que gana en el
// acento. `text` del grafico = el contexto ("la partida final"), arriba.
export function Scoreboard({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, exit } = useMotion(withExit);
  const sides = (spec.items ?? []).slice(0, 2).map((item) => ({ name: item.label, value: score(item.text) }));
  if (sides.length < 2) return null;
  const [a, b] = [Number(sides[0]!.value), Number(sides[1]!.value)];
  const winner = Number.isFinite(a) && Number.isFinite(b) && a !== b ? (a > b ? 0 : 1) : -1;

  const name = (i: number) => (
    <div
      style={{
        fontFamily: theme.fontSans,
        fontWeight: 800,
        fontSize: 54 * s,
        textTransform: "uppercase",
        letterSpacing: 2 * s,
        color: theme.text,
        textShadow: TEXT_SHADOW,
        whiteSpace: "nowrap",
        opacity: enter(4 + i * 4),
        transform: `translateX(${(1 - enter(4 + i * 4)) * (i === 0 ? -40 : 40) * s}px)`,
      }}
    >
      {sides[i]!.name}
    </div>
  );
  const box = (i: number) => {
    const t = enter(12 + i * 5, 14);
    const won = i === winner;
    return (
      <div
        style={{
          minWidth: 120 * s,
          padding: `${8 * s}px ${26 * s}px`,
          boxSizing: "border-box",
          textAlign: "center",
          fontFamily: theme.fontSans,
          fontWeight: 800,
          fontSize: 96 * s,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          color: won ? "#111" : theme.text,
          background: won ? theme.accent : "rgba(255,255,255,0.12)",
          border: won ? "none" : "2px solid rgba(255,255,255,0.35)",
          borderRadius: 10 * s,
          boxShadow: won ? `0 0 ${36 * s}px ${theme.accent}80` : "none",
          opacity: t,
          transform: `scale(${0.8 + 0.2 * t})`,
        }}
      >
        {sides[i]!.value}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 70% 45% at 50% 50%, rgba(0,0,0,0.6), transparent 80%), rgba(0,0,0,0.3)", opacity: enter(0) }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34 * s }}>
        <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 28 * s, letterSpacing: 8 * s, textTransform: "uppercase", color: theme.textMuted, textShadow: TEXT_SHADOW, opacity: enter(0) }}>
          {spec.text}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 30 * s }}>
          {name(0)}
          {box(0)}
          <div style={{ width: 24 * s, height: 4 * s, background: theme.textMuted, opacity: enter(10) }} />
          {box(1)}
          {name(1)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
