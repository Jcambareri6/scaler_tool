import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { useMotion } from "../lib/anim";

const MAX_ITEMS = 5;
// Frames entre un tilde y el siguiente.
const TICK_STAGGER = 14;

// Libreta con lista que se va tildando (GoMotion: "Roca caliza", "Panuelo
// rojo"). Tarjeta a la derecha sobre el video: banda roja con el titulo y
// hoja rayada con las entradas, que se tildan de a una.
// `text` = titulo, `items` = entradas ({label: "", text}).
export function Checklist({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const entries = (spec.items ?? []).slice(0, MAX_ITEMS);
  if (entries.length < 2) return null;
  const card = enter(0, 18);
  const band = "#8f1f1f";

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div
        style={{
          position: "absolute",
          right: 110 * s,
          top: 150 * s,
          width: 640 * s,
          boxShadow: `0 ${20 * s}px ${50 * s}px rgba(0,0,0,0.45)`,
          opacity: card,
          transform: `translateX(${(1 - card) * 80 * s}px) rotate(${(1 - card) * 3}deg)`,
        }}
      >
        <div style={{ background: band, padding: `${16 * s}px ${30 * s}px`, fontFamily: theme.fontSans, fontWeight: 800, fontSize: 30 * s, letterSpacing: 3 * s, textTransform: "uppercase", color: "#fff" }}>
          {spec.text}
        </div>
        <div style={{ background: "#f6efe0", padding: `${14 * s}px ${30 * s}px ${24 * s}px` }}>
          {entries.map((entry, i) => {
            const t0 = 14 + i * TICK_STAGGER;
            const show = enter(t0, 12);
            const tick = draw(t0 + 6, t0 + 14);
            return (
              // Renglon de libreta: la linea va DEBAJO de cada entrada, no por el medio.
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 22 * s, height: 68 * s, borderBottom: `${2 * s}px solid rgba(120,90,60,0.25)`, opacity: show }}>
                <svg width={38 * s} height={38 * s} viewBox="0 0 38 38" style={{ flexShrink: 0 }}>
                  <rect x={3} y={3} width={32} height={32} rx={4} fill="none" stroke="#5a4632" strokeWidth={3} />
                  <path d="M9 20 L16 27 L30 10" fill="none" stroke={band} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={40} strokeDashoffset={40 * (1 - tick)} />
                </svg>
                <span style={{ fontFamily: theme.fontSerif, fontStyle: "italic", fontWeight: 600, fontSize: 36 * s, color: "#2f2418", lineHeight: 1.1 }}>
                  {entry.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
