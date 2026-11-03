import { Easing, interpolate, spring, useVideoConfig } from "remotion";
import type { Theme } from "../theme";
import type { AnimatedScene, DrawingComponent, SceneElement, SceneStep, Tone } from "./types";

// Dibujos por componentes del formato todo animado: el Dibujante arma cada
// componente (tren, valija, pasajero) en SVG con partes nombradas, y los pasos
// mueven el componente entero o una parte, de uno o de varios ejemplares.
// Todo sale del segundo t, sin estado: la preview y el render dan lo mismo.

const MOVE_SECONDS = 0.7;
const ENTER_FRAMES = 16;
const TONES: Record<Tone, (theme: Theme) => string> = {
  neutral: (theme) => theme.textMuted,
  accent: (theme) => theme.accent,
  ok: () => "#3DDC84",
  alert: () => "#FF4D4D",
};

const progress = (t: number, at: number, seconds: number) =>
  interpolate(t - at, [0, seconds], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// Segundo real del paso para un ejemplar (stagger: uno detras del otro).
function stepTime(st: SceneStep, index: number): number {
  return st.at + (st.stagger ?? 0) * Math.max(0, index - (st.from_index ?? 0));
}

function applies(st: SceneStep, index: number): boolean {
  return index >= (st.from_index ?? 0) && index <= (st.to_index ?? Number.MAX_SAFE_INTEGER);
}

// Pose acumulada a partir de los pasos ya ocurridos. dx/dy en % del tamano
// del propio componente.
function poseAt(steps: SceneStep[], t: number, index: number, width: number, height: number, theme: Theme) {
  const pose = { x: 0, y: 0, deg: 0, scale: 1, color: undefined as string | undefined };
  for (const st of steps) {
    const at = stepTime(st, index);
    if (at > t) continue;
    const p = progress(t, at, st.duration ?? MOVE_SECONDS);
    if (st.action === "move") {
      pose.x += ((st.dx ?? 0) / 100) * width * p;
      pose.y += ((st.dy ?? 0) / 100) * height * p;
    } else if (st.action === "rotate") {
      pose.deg += (st.deg ?? 0) * p;
    } else if (st.action === "scale") {
      pose.scale *= 1 + ((st.factor ?? 1) - 1) * p;
    } else if (st.action === "paint" && st.tone && p > 0.4) {
      pose.color = TONES[st.tone](theme);
    } else if (st.action === "loop") {
      const since = t - at;
      if (st.loop === "spin") pose.deg += since * 240;
      else if (st.loop === "float") pose.y += Math.sin(since * 2.4) * height * 0.03;
      else if (st.loop === "shake") pose.x += Math.sin(since * 38) * width * 0.008;
      else if (st.loop === "pulse") pose.scale *= 1 + Math.sin(since * 4) * 0.05;
    }
  }
  return pose;
}

// Personajes: todos usan el mismo esqueleto (cabeza, torso, brazo_izq,
// brazo_der, pierna_izq, pierna_der). Una accion devuelve el giro de cada parte
// segun el tiempo que paso; p sube, se sostiene y baja.
function actAngle(act: NonNullable<SceneStep["act"]>, part: string, since: number, seconds: number): number {
  if (since < 0 || since > seconds) return act === "fall" && since > seconds ? (part === "torso" ? 8 : 0) : 0;
  const edge = Math.min(0.25, seconds / 3);
  const p = Math.min(1, since / edge, (seconds - since) / edge);
  const stride = Math.sin(since * 9);
  switch (act) {
    case "walk":
      if (part === "pierna_izq" || part === "brazo_der") return stride * 26 * p;
      if (part === "pierna_der" || part === "brazo_izq") return -stride * 26 * p;
      return 0;
    case "run": {
      const fast = Math.sin(since * 16);
      if (part === "pierna_izq" || part === "brazo_der") return fast * 52 * p;
      if (part === "pierna_der" || part === "brazo_izq") return -fast * 52 * p;
      return part === "torso" ? 12 * p : 0;
    }
    case "press":
      return part === "brazo_der" ? -82 * p : part === "torso" ? 3 * p : 0;
    case "push":
      return part === "brazo_der" || part === "brazo_izq" ? -80 * p : part === "torso" ? 7 * p : 0;
    case "point":
      return part === "brazo_der" ? -95 * p : 0;
    case "look":
      return part === "cabeza" ? 16 * p : 0;
    case "recoil":
      return part === "torso" ? -9 * p : part === "cabeza" ? -10 * p : part === "brazo_der" || part === "brazo_izq" ? -32 * p : 0;
    case "fall":
      return part === "torso" ? 8 * p : part === "pierna_izq" || part === "pierna_der" ? 16 * p : part === "brazo_der" || part === "brazo_izq" ? 30 * p : 0;
  }
}

function DrawingInstance({
  el,
  comp,
  scene,
  index,
  t,
  width,
  theme,
}: {
  el: SceneElement;
  comp: DrawingComponent;
  scene: AnimatedScene;
  index: number;
  t: number;
  width: number;
  theme: Theme;
}) {
  const { fps } = useVideoConfig();
  const height = (width * comp.height) / comp.width;
  const own = scene.steps.filter((st) => st.target === el.id && applies(st, index)).sort((a, b) => a.at - b.at);
  const whole = own.filter((st) => !st.part);

  const shows = whole.filter((st) => st.action === "show");
  const shownAt = shows[0] ? stepTime(shows[0], index) : scene.start;
  if (t < shownAt) return null;
  const hides = whole.filter((st) => st.action === "hide");
  const hiddenAt = hides[0] ? stepTime(hides[0], index) : null;
  const enter = spring({ frame: Math.round((t - shownAt) * fps), fps, config: { damping: 18, stiffness: 140 }, durationInFrames: ENTER_FRAMES });
  const exit = hiddenAt === null ? 1 : 1 - progress(t, hiddenAt, 0.3);
  if (exit <= 0) return null;

  const pose = poseAt(whole, t, index, width, height, theme);
  const selector = `[data-d="${el.id}-${index}"]`;
  const css = [
    `${selector} [data-part]{transform-box:fill-box;transform-origin:center}`,
    ...Object.entries(comp.parts).map(([part, pivot]) => {
      const steps = own.filter((st) => st.part === part);
      const p = poseAt(steps, t, index, comp.width, comp.height, theme);
      for (const st of whole) {
        if (st.action === "act" && st.act) p.deg += actAngle(st.act, part, t - stepTime(st, index), st.duration ?? 1.2);
      }
      const rules = [`transform:translate(${p.x}px,${p.y}px) rotate(${p.deg}deg) scale(${p.scale})`];
      if (pivot) rules.push(`transform-origin:${pivot}`);
      const paint = p.color ? `${selector} [data-part="${part}"],${selector} [data-part="${part}"] *:not([fill="none"]){fill:${p.color}}` : "";
      return `${selector} [data-part="${part}"]{${rules.join(";")}}${paint}`;
    }),
    pose.color ? `${selector} svg *:not([fill="none"]){fill:${pose.color}}` : "",
  ].join("");

  return (
    <div
      data-d={`${el.id}-${index}`}
      style={{
        width,
        opacity: enter * exit,
        transform: `translate(${pose.x}px, ${pose.y}px) rotate(${pose.deg}deg) scale(${pose.scale * (0.92 + 0.08 * enter)})`,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <svg
        viewBox={`0 0 ${comp.width} ${comp.height}`}
        width={width}
        height={height}
        style={{
          display: "block",
          overflow: "visible",
          color: theme.text,
          ["--accent" as string]: theme.accent,
          // Sombra suave para despegar el dibujo del lienzo.
          filter: `drop-shadow(0 ${width * 0.012}px ${width * 0.028}px rgba(0,0,0,0.3))`,
        }}
        dangerouslySetInnerHTML={{ __html: comp.svg }}
      />
    </div>
  );
}

// x/y (centro) y w, en % del cuadro. Con repeat, los ejemplares llenan una
// grilla de ese ancho (pictograma: 20 pasajeros, 12 se pintan de rojo).
export function DrawingView({ el, comp, scene, t, theme }: { el: SceneElement; comp: DrawingComponent; scene: AnimatedScene; t: number; theme: Theme }) {
  const { width: videoWidth } = useVideoConfig();
  const boxWidth = ((el.w ?? 40) / 100) * videoWidth;
  const count = el.repeat?.count ?? 1;
  const columns = Math.min(count, el.repeat?.columns ?? count);
  const cell = boxWidth / columns;
  const itemWidth = count > 1 ? cell * 0.8 : boxWidth;

  return (
    <div
      style={{
        position: "absolute",
        left: `${el.x ?? 50}%`,
        top: `${el.y ?? 50}%`,
        width: boxWidth,
        transform: "translate(-50%, -50%)",
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, ${cell}px)`,
        justifyItems: "center",
        rowGap: cell * 0.2,
      }}
    >
      {Array.from({ length: count }, (_, index) => (
        <DrawingInstance key={index} el={el} comp={comp} scene={scene} index={index} t={t} width={itemWidth} theme={theme} />
      ))}
    </div>
  );
}
