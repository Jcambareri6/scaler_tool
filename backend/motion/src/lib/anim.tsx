import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Piezas comunes de los componentes: entrada con resorte, salida con
// fundido (solo en preview; en el render la hace ffmpeg, exit=false) y el
// velo que oscurece el video detras para que el texto se lea.

export const TEXT_SHADOW = "0 2px 24px rgba(0,0,0,0.5)";

export function useMotion(withExit: boolean | undefined) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const s = height / 1080;
  // 0 -> 1 con resorte suave a partir de `delay` frames.
  const enter = (delay: number, frames = 18) =>
    spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: frames });
  // 0 -> 1 lineal con easing externo opcional, para lineas que se dibujan.
  const draw = (from: number, to: number) =>
    interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exit =
    withExit === false
      ? 1
      : interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  return { frame, fps, s, width, height, enter, draw, exit };
}

export function Scrim({ color, at, size, opacity }: { color: string; at: string; size: string; opacity: number }) {
  return (
    <AbsoluteFill
      style={{ background: `radial-gradient(ellipse ${size} at ${at}, ${color}, transparent 75%)`, opacity }}
    />
  );
}

// Textos fijos de interfaz (no salen del guion) segun el idioma del canal.
export function uiText(locale: string | undefined, key: "myth" | "fact" | "vs"): string {
  const lang = (locale ?? "es").slice(0, 2);
  const table = {
    myth: { es: "Mito", en: "Myth", pt: "Mito" },
    fact: { es: "Realidad", en: "Fact", pt: "Realidade" },
    vs: { es: "vs", en: "vs", pt: "vs" },
  } as const;
  return table[key][lang as "es" | "en" | "pt"] ?? table[key].es;
}
