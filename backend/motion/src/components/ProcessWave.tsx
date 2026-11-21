import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { useMotion } from "../lib/anim";

// Proceso sobre una curva (GoMotion: "Pequenas grietas -> lluvia y raices ->
// bloque se suelta"): una onda que se dibuja de izquierda a derecha entre el
// primer paso y el ultimo, y los pasos del medio como puntos sobre la onda.
// Pantalla entera (catalog: full). `items` = pasos en orden (3 a 5),
// `text` = titulo (opcional).
export function ProcessWave({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, width, height, enter, draw, exit } = useMotion(withExit);
  const steps = (spec.items ?? []).slice(0, 5);
  if (steps.length < 3) return null;
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  const middle = steps.slice(1, -1);
  const x0 = width * 0.34;
  const x1 = width * 0.66;
  const cy = height * 0.52;
  const amp = 120 * s;
  const cycles = 2;
  const y = (x: number) => cy - amp * Math.sin(((x - x0) / (x1 - x0)) * cycles * 2 * Math.PI);
  const points = Array.from({ length: 121 }, (_, k) => x0 + ((x1 - x0) * k) / 120);
  const d = points.map((x, k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y(x).toFixed(1)}`).join(" ");
  const wave = draw(10, 46);
  const dot = "#7CFC4A";
  const label = (text: string) => (
    <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 34 * s, letterSpacing: 2 * s, textTransform: "uppercase", color: theme.text, whiteSpace: "nowrap" }}>{text}</span>
  );

  return (
    <AbsoluteFill style={{ opacity: exit, background: "radial-gradient(ellipse 80% 70% at 50% 50%, #142233, #0a1220)" }}>
      {spec.text && (
        <div style={{ position: "absolute", top: 80 * s, width: "100%", textAlign: "center", fontFamily: theme.fontSans, fontWeight: 700, fontSize: 30 * s, letterSpacing: 6 * s, textTransform: "uppercase", color: theme.textMuted, opacity: enter(0) }}>
          {spec.text}
        </div>
      )}
      <div style={{ position: "absolute", right: width - x0 + 40 * s, top: cy - 24 * s, opacity: enter(2) }}>{label(first.text)}</div>
      <div style={{ position: "absolute", left: x1 + 40 * s, top: cy - 24 * s, opacity: enter(44) }}>{label(last.text)}</div>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <path d={d} fill="none" stroke={theme.text} strokeWidth={7 * s} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - wave} />
      </svg>
      {middle.map((step, i) => {
        // Puntos en las crestas y los valles de la onda (nunca donde cruza el
        // centro: ahi la etiqueta quedaba encima de la linea).
        const peaks = [0.125, 0.375, 0.625, 0.875];
        const pick = middle.length === 1 ? [0.625] : middle.length === 2 ? [0.375, 0.625] : [0.125, 0.375, 0.625];
        const px = x0 + (x1 - x0) * (pick[i] ?? peaks[i % 4]!);
        const py = y(px);
        const t = enter(14 + ((i + 1) / (middle.length + 1)) * 32, 10);
        const above = py < cy;
        return (
          <div key={i} style={{ position: "absolute", left: px, top: py, opacity: t }}>
            <div style={{ position: "absolute", left: -14 * s, top: -14 * s, width: 28 * s, height: 28 * s, borderRadius: "50%", background: dot, boxShadow: `0 0 ${18 * s}px ${dot}` }} />
            <div style={{ position: "absolute", left: 0, transform: "translateX(-50%)", top: above ? -66 * s : 30 * s, fontFamily: theme.fontSans, fontWeight: 700, fontSize: 24 * s, letterSpacing: 2 * s, textTransform: "uppercase", color: theme.text, whiteSpace: "nowrap" }}>
              {step.text}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
