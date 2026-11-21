import { AbsoluteFill, Img } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { useMotion } from "../lib/anim";

const MAX_NODES = 4;

// Arbol con fotos (GoMotion: "Fosiles marinos -> caliza -> coral"): una linea
// amarilla que cruza la pantalla y, colgando arriba y abajo, cada concepto con
// su foto chica y su nombre. Pantalla entera (catalog: full).
// `text` = titulo (opcional), `items` = nodos ({text: nombre, image?: foto}).
export function PhotoTree({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, width, height, enter, draw, exit } = useMotion(withExit);
  const nodes = (spec.items ?? []).slice(0, MAX_NODES);
  if (nodes.length < 2) return null;
  const line = "#F2C230";
  const spineY = height * 0.5;
  const left = width * 0.1;
  const right = width * 0.9;
  const spine = draw(0, 24);
  const step = (right - left) / (nodes.length + 1);
  const thumbW = 300 * s;
  const thumbH = 190 * s;
  const reach = 150 * s;

  return (
    <AbsoluteFill style={{ opacity: exit, background: "radial-gradient(ellipse 80% 70% at 50% 50%, #2a2a2a, #121212)" }}>
      {spec.text && (
        <div style={{ position: "absolute", top: 70 * s, width: "100%", textAlign: "center", fontFamily: theme.fontSans, fontWeight: 700, fontSize: 32 * s, letterSpacing: 6 * s, textTransform: "uppercase", color: theme.textMuted, opacity: enter(0) }}>
          {spec.text}
        </div>
      )}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <line x1={left} y1={spineY} x2={left + (right - left) * spine} y2={spineY} stroke={line} strokeWidth={8 * s} strokeLinecap="round" />
        {nodes.map((_, i) => {
          const x = left + step * (i + 1);
          const up = i % 2 === 0;
          const grow = draw(16 + i * 10, 28 + i * 10);
          return <line key={i} x1={x} y1={spineY} x2={x} y2={spineY + (up ? -1 : 1) * reach * grow} stroke={line} strokeWidth={8 * s} strokeLinecap="round" />;
        })}
      </svg>
      {nodes.map((node, i) => {
        const x = left + step * (i + 1);
        const up = i % 2 === 0;
        const t = enter(26 + i * 10, 14);
        const top = up ? spineY - reach - thumbH - 50 * s : spineY + reach;
        return (
          <div key={i} style={{ position: "absolute", left: x - thumbW / 2, top, width: thumbW, display: "flex", flexDirection: up ? "column" : "column-reverse", alignItems: "center", gap: 12 * s, opacity: t, transform: `scale(${0.85 + 0.15 * t})` }}>
            <div style={{ fontFamily: theme.fontSans, fontWeight: 700, fontSize: 24 * s, letterSpacing: 3 * s, textTransform: "uppercase", color: theme.text, textAlign: "center" }}>{node.text}</div>
            <div style={{ width: thumbW, height: thumbH, border: `${4 * s}px solid ${line}`, background: "#1d1d1d", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {node.image ? (
                <Img src={node.image} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => undefined} />
              ) : (
                <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 64 * s, color: line }}>{i + 1}</span>
              )}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
