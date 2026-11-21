import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { useMotion } from "../lib/anim";

// Conceptos en circulos (GoMotion: "Identidad / Resistencia / Sagrado"): 2 a 4
// ideas cortas, cada una dentro de un anillo que se dibuja, de a una. Pantalla
// entera oscura (catalog: full). `items` = los conceptos ({text, <= 2 palabras}),
// `text` = titulo (opcional).
export function ConceptCircles({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, width, height, enter, draw, exit } = useMotion(withExit);
  const items = (spec.items ?? []).slice(0, 4);
  if (items.length < 2) return null;
  const r = 130 * s;
  const gap = Math.min(380 * s, (width * 0.8) / items.length);
  const cx0 = width / 2 - (gap * (items.length - 1)) / 2;
  const cy = height * 0.53;

  return (
    <AbsoluteFill style={{ opacity: exit, background: "#050505" }}>
      {spec.text && (
        <div style={{ position: "absolute", top: 150 * s, width: "100%", textAlign: "center", fontFamily: theme.fontSans, fontWeight: 700, fontSize: 34 * s, letterSpacing: 6 * s, textTransform: "uppercase", color: theme.textMuted, opacity: enter(0) }}>
          {spec.text}
        </div>
      )}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {items.map((_, i) => {
          const ring = draw(6 + i * 12, 24 + i * 12);
          return (
            <circle
              key={i}
              cx={cx0 + gap * i}
              cy={cy}
              r={r}
              fill="none"
              stroke={theme.text}
              strokeWidth={4 * s}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - ring}
              transform={`rotate(-90 ${cx0 + gap * i} ${cy})`}
              style={{ filter: `drop-shadow(0 0 ${10 * s}px rgba(255,255,255,0.35))` }}
            />
          );
        })}
      </svg>
      {items.map((item, i) => {
        const t = enter(18 + i * 12, 12);
        // La palabra mas larga de la entrada entra en el circulo con margen.
        const longest = Math.max(...item.text.split(/\s+/).map((w) => w.length), 1);
        const size = Math.min(30 * s, (r * 2 * 0.72) / (longest * 0.66));
        return (
          <div key={i} style={{ position: "absolute", left: cx0 + gap * i - r, top: cy - r, width: r * 2, height: r * 2, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", opacity: t }}>
            <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: size, letterSpacing: 2 * s, textTransform: "uppercase", color: theme.text, padding: `0 ${18 * s}px`, lineHeight: 1.15 }}>{item.text}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
