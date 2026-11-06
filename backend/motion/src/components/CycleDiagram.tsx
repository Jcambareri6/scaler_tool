import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";

const MAX_STEPS = 6;
const STEP_STAGGER = 9;

// Ciclo (agua, carbono, vida de una estrella, un circulo vicioso): los pasos
// (`items[].text`) alrededor de un circulo, que aparecen en orden mientras
// una flecha recorre el anillo de uno al siguiente y vuelve al primero.
// `text` = el nombre del ciclo, en el centro.
export function CycleDiagram({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, width, height, enter, draw, exit } = useMotion(withExit);
  const steps = (spec.items ?? []).slice(0, MAX_STEPS);
  if (steps.length < 3) return null;

  const cx = width / 2;
  const cy = height * 0.53;
  const r = 340 * s;
  const n = steps.length;
  // Primer paso arriba, en sentido horario.
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const at = (i: number, radius = r) => [cx + radius * Math.cos(angle(i)), cy + radius * Math.sin(angle(i))] as const;
  const circumference = 2 * Math.PI * r;
  const ring = draw(8, 8 + n * STEP_STAGGER);
  // Punta de la flecha sobre el anillo, donde va el dibujo.
  const head = angle(0) + 2 * Math.PI * ring;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.5)", opacity: enter(0) }} />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={3 * s} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={theme.accent}
          strokeWidth={5 * s}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ring)}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ filter: `drop-shadow(0 0 ${10 * s}px ${theme.accent}80)` }}
        />
        {ring > 0.01 && ring < 0.999 && (
          <polygon
            points={`0,${-12 * s} ${20 * s},0 0,${12 * s}`}
            fill={theme.accent}
            transform={`translate(${cx + r * Math.cos(head)} ${cy + r * Math.sin(head)}) rotate(${(head * 180) / Math.PI + 90})`}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          left: cx - 160 * s,
          width: 320 * s,
          top: cy,
          transform: "translateY(-50%)",
          textAlign: "center",
          fontFamily: theme.fontSerif,
          fontWeight: 500,
          fontSize: 50 * s,
          lineHeight: 1.05,
          color: theme.text,
          textShadow: TEXT_SHADOW,
          opacity: enter(0),
        }}
      >
        {spec.text}
      </div>
      {steps.map((step, i) => {
        const t = enter(6 + i * STEP_STAGGER, 14);
        const [x, y] = at(i);
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * t})`, opacity: t }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14 * s,
                padding: `${12 * s}px ${22 * s}px`,
                borderRadius: 999,
                background: "rgba(10,12,16,0.9)",
                border: `2px solid ${theme.accent}`,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 26 * s, color: theme.accent }}>{i + 1}</span>
              <span style={{ fontFamily: theme.fontSans, fontWeight: 700, fontSize: 32 * s, color: theme.text }}>{step.text}</span>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
