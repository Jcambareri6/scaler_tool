import { AbsoluteFill, Easing, interpolate, useVideoConfig } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { Scrim, TEXT_SHADOW, useMotion } from "../lib/anim";

const AGE_LABELS = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80+"];

// Piramide de poblacion con datos reales (Banco Mundial, como piramide.tsx de
// MaV): entra el primer anio; despues las barras cambian de anio en anio
// hasta el 90 % del plano, con el anio corriendo arriba. El primer anio queda
// como contorno discontinuo para comparar. Dos cifras (menores de 15 y
// mayores de 65) cambian con ella. `text` = titulo, `label` = fuente.
export function PopulationPyramid({ spec, theme, exit: withExit, locale }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined; locale?: string | undefined }) {
  const { s, frame, width, enter, exit } = useMotion(withExit);
  const { durationInFrames } = useVideoConfig();
  const years = spec.pyramid?.years ?? [];
  if (years.length === 0) return null;

  // Anio "continuo": 0 hasta el 20 % del plano, y avanza hasta el ultimo al 90 %.
  const t = interpolate(frame, [durationInFrames * 0.2, durationInFrames * 0.9], [0, years.length - 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const i0 = Math.floor(t);
  const i1 = Math.min(years.length - 1, i0 + 1);
  const f = t - i0;
  const mix = (a: number[], b: number[]) => a.map((v, k) => v + (b[k]! - v) * f);
  const men = mix(years[i0]!.men, years[i1]!.men);
  const women = mix(years[i0]!.women, years[i1]!.women);
  const year = Math.round(years[i0]!.year + (years[i1]!.year - years[i0]!.year) * f);
  const first = years[0]!;

  const maxPct = Math.max(...years.flatMap((y) => [...y.men, ...y.women]), 1);
  const half = 520 * s;
  const rowH = 30 * s;
  const gap = 4 * s;
  const H = AGE_LABELS.length * (rowH + gap);
  const center = width / 2;
  const top = 260 * s;
  const grow = enter(4, 18);
  const bar = (pct: number) => (pct / maxPct) * half * grow;
  const sum = (arr: number[], from: number, to: number) => arr.slice(from, to).reduce((a, b) => a + b, 0);
  const under15 = sum(men, 0, 3) + sum(women, 0, 3);
  const over65 = sum(men, 13, 17) + sum(women, 13, 17);
  const fmt = (v: number) => v.toLocaleString(locale ?? "es-AR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scrim color={theme.scrim} at="50% 50%" size="90% 90%" opacity={enter(0)} />
      <div style={{ position: "absolute", top: 70 * s, width: "100%", textAlign: "center", opacity: enter(0, 14) }}>
        <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 46 * s, textTransform: "uppercase", letterSpacing: 2 * s, color: theme.text, textShadow: TEXT_SHADOW }}>{spec.text}</div>
        <div style={{ marginTop: 6 * s, fontFamily: theme.fontSans, fontWeight: 800, fontSize: 72 * s, color: theme.accent, textShadow: TEXT_SHADOW }}>{year}</div>
      </div>
      {AGE_LABELS.map((label, k) => {
        const row = AGE_LABELS.length - 1 - k;
        const y = top + row * (rowH + gap);
        return (
          <div key={label}>
            {/* Primer anio: contorno discontinuo para comparar. */}
            <div style={{ position: "absolute", top: y, left: center - 40 * s - bar(first.men[k]!), width: bar(first.men[k]!), height: rowH, border: `${2 * s}px dashed rgba(255,255,255,0.35)`, boxSizing: "border-box" }} />
            <div style={{ position: "absolute", top: y, left: center + 40 * s, width: bar(first.women[k]!), height: rowH, border: `${2 * s}px dashed rgba(255,255,255,0.35)`, boxSizing: "border-box" }} />
            <div style={{ position: "absolute", top: y, left: center - 40 * s - bar(men[k]!), width: bar(men[k]!), height: rowH, background: theme.text, opacity: 0.85 }} />
            <div style={{ position: "absolute", top: y, left: center + 40 * s, width: bar(women[k]!), height: rowH, background: theme.accent, opacity: 0.9 }} />
            <div style={{ position: "absolute", top: y + rowH * 0.1, left: center - 40 * s, width: 80 * s, textAlign: "center", fontFamily: theme.fontSans, fontSize: 19 * s, color: theme.textMuted }}>{label}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", top: top + H + 12 * s, left: center - 40 * s - half, fontFamily: theme.fontSans, fontWeight: 700, fontSize: 26 * s, color: theme.text, opacity: grow }}>
        HOMBRES
      </div>
      <div style={{ position: "absolute", top: top + H + 12 * s, right: center - 40 * s - half, fontFamily: theme.fontSans, fontWeight: 700, fontSize: 26 * s, color: theme.accent, opacity: grow, textAlign: "right" }}>
        MUJERES
      </div>
      <div style={{ position: "absolute", top: top + H + 56 * s, width: "100%", textAlign: "center", fontFamily: theme.fontSans, fontWeight: 700, fontSize: 30 * s, color: theme.text, textShadow: TEXT_SHADOW, opacity: grow }}>
        Menores de 15: {fmt(under15)} % · Mayores de 65: {fmt(over65)} %
      </div>
      <div style={{ position: "absolute", bottom: 40 * s, width: "100%", textAlign: "center", fontFamily: theme.fontSans, fontSize: 22 * s, letterSpacing: 3 * s, textTransform: "uppercase", color: theme.textMuted, opacity: enter(10, 14) }}>
        {spec.label ? `Fuente: ${spec.label}` : "Sin datos"}
      </div>
    </AbsoluteFill>
  );
}
