import { AbsoluteFill, Easing, interpolate, spring, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Overlay } from "../Overlay";
import type { Theme, PaletteTheme } from "../theme";
import { TEXT_SHADOW } from "../lib/anim";
import { formatNumber, parseLiteralNumber } from "../lib/literal";
import type { AnimatedScene, SceneElement, Slot, Tone } from "./types";

// Fundido de entrada/salida de cada escena y de cada elemento (frames).
const SCENE_FADE = 10;
const ELEMENT_IN = 14;
const ELEMENT_OUT = 8;
// Lo que tarda una cifra en contar hasta su valor nuevo.
const COUNT_SECONDS = 0.8;

// Rojo fijo del tachado (igual que strike_word).
const STRIKE = "#FF4D4D";
const TONE_COLORS: Record<Tone, string> = { neutral: "rgba(255,255,255,0.75)", accent: "", ok: "#3DDC84", alert: "#FF4D4D" };

interface ElementState {
  visible: boolean;
  shownAt: number;
  hiddenAt: number | null;
  text?: string | undefined;
  value?: string | undefined;
  tone?: Tone | undefined;
  // value anterior y cuando cambio (para que la cifra cuente).
  prevValue?: string | undefined;
  changedAt: number | null;
  highlightedAt: number | null;
  struckAt: number | null;
}

// Estado de un elemento en el segundo t: arranca como esta definido y se le
// aplican, en orden, los pasos que ya pasaron. Sin paso "show" es visible
// desde el inicio de la escena.
function stateAt(el: SceneElement, scene: AnimatedScene, t: number): ElementState {
  const steps = scene.steps.filter((st) => st.target === el.id).sort((a, b) => a.at - b.at);
  const hasShow = steps.some((st) => st.action === "show");
  const state: ElementState = {
    visible: !hasShow,
    shownAt: scene.start,
    hiddenAt: null,
    text: el.text,
    value: el.value,
    tone: el.tone,
    changedAt: null,
    highlightedAt: null,
    struckAt: null,
  };
  for (const st of steps) {
    if (st.at > t) break;
    if (st.action === "show") {
      state.visible = true;
      state.shownAt = st.at;
      state.hiddenAt = null;
    } else if (st.action === "hide") {
      state.hiddenAt = st.at;
    } else if (st.action === "set") {
      if (st.value !== undefined) {
        state.prevValue = state.value;
        state.value = st.value;
        state.changedAt = st.at;
      }
      if (st.text !== undefined) state.text = st.text;
      if (st.tone !== undefined) state.tone = st.tone;
    } else if (st.action === "highlight") {
      state.highlightedAt = st.at;
    } else if (st.action === "strike") {
      state.struckAt = st.at;
    }
  }
  return state;
}

function NumberValue({ state, t, theme, locale }: { state: ElementState; t: number; theme: Theme; locale?: string | undefined }) {
  const target = state.value ? parseLiteralNumber(state.value) : null;
  if (!target) return <>{state.value}</>;
  const from = state.prevValue ? (parseLiteralNumber(state.prevValue)?.value ?? 0) : 0;
  const since = state.changedAt ?? state.shownAt;
  const p = interpolate(t - since, [0, COUNT_SECONDS], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {target.prefix && <span style={{ fontSize: "0.6em" }}>{target.prefix}</span>}
      {formatNumber(from + (target.value - from) * p, target, locale)}
      {target.unit && <span style={{ fontSize: "0.5em", fontWeight: 700, marginLeft: "0.15em", color: theme.accent }}>{target.unit}</span>}
    </span>
  );
}

function ElementView({ el, state, t, s, theme, locale }: { el: SceneElement; state: ElementState; t: number; s: number; theme: Theme; locale?: string | undefined }) {
  const { fps } = useVideoConfig();
  const frame = Math.round(t * fps);
  const inP = spring({ frame: frame - Math.round(state.shownAt * fps), fps, config: { damping: 200 }, durationInFrames: ELEMENT_IN });
  const outP = state.hiddenAt === null ? 1 : interpolate(frame - Math.round(state.hiddenAt * fps), [0, ELEMENT_OUT], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = inP * outP;
  if (opacity <= 0.001) return null;
  const glow = state.highlightedAt !== null ? interpolate(t - state.highlightedAt, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const strike = state.struckAt !== null ? interpolate(t - state.struckAt, [0, 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const toneColor = state.tone ? TONE_COLORS[state.tone] || theme.accent : theme.accent;
  const base = { opacity, transform: `translateY(${(1 - inP) * 24 * s}px)`, position: "relative" as const };

  const strikeLine =
    strike > 0 ? (
      <div
        style={{
          position: "absolute",
          left: -8 * s,
          right: -8 * s,
          top: "52%",
          height: 10 * s,
          borderRadius: 5 * s,
          background: STRIKE,
          transform: `rotate(-3deg) scaleX(${strike})`,
          transformOrigin: "left",
        }}
      />
    ) : null;

  if (el.kind === "title" || el.kind === "text") {
    const isTitle = el.kind === "title";
    return (
      <div style={base}>
        <div
          style={{
            fontFamily: isTitle ? theme.fontSerif : theme.fontSans,
            fontWeight: isTitle ? 500 : 700,
            fontSize: (isTitle ? 110 : 56) * s,
            lineHeight: 1.1,
            textAlign: "center",
            color: glow > 0 ? theme.accent : theme.text,
            textShadow: glow > 0 ? `0 0 ${24 * s * glow}px ${theme.accent}90` : TEXT_SHADOW,
            opacity: 1 - 0.45 * strike,
          }}
        >
          {state.text}
        </div>
        {strikeLine}
      </div>
    );
  }

  if (el.kind === "number") {
    return (
      <div style={{ ...base, textAlign: "center" }}>
        {el.label && (
          <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 32 * s, letterSpacing: 6 * s, textTransform: "uppercase", color: theme.textMuted }}>{el.label}</div>
        )}
        <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 170 * s, lineHeight: 1, color: glow > 0 ? theme.accent : theme.text, textShadow: TEXT_SHADOW }}>
          <NumberValue state={state} t={t} theme={theme} locale={locale} />
        </div>
        {strikeLine}
      </div>
    );
  }

  if (el.kind === "chip") {
    return (
      <div style={base}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12 * s,
            padding: `${14 * s}px ${30 * s}px`,
            borderRadius: 999,
            border: `${2 * s}px solid ${toneColor}`,
            background: `${toneColor.startsWith("#") ? toneColor : "#ffffff"}1f`,
            fontFamily: theme.fontSans,
            fontWeight: 800,
            fontSize: 36 * s,
            letterSpacing: 4 * s,
            textTransform: "uppercase",
            color: theme.text,
          }}
        >
          <span style={{ width: 12 * s, height: 12 * s, borderRadius: "50%", background: toneColor, boxShadow: `0 0 ${10 * s}px ${toneColor}` }} />
          {state.text}
        </div>
      </div>
    );
  }

  // card
  return (
    <div style={base}>
      <div
        style={{
          minWidth: 480 * s,
          padding: `${30 * s}px ${38 * s}px`,
          borderRadius: 14 * s,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderLeft: `${5 * s}px solid ${toneColor}`,
          boxShadow: glow > 0 ? `0 0 ${30 * s * glow}px ${theme.accent}55` : "none",
        }}
      >
        {el.label && (
          <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 26 * s, letterSpacing: 5 * s, textTransform: "uppercase", color: theme.textMuted }}>{el.label}</div>
        )}
        <div style={{ marginTop: 8 * s, fontFamily: theme.fontSans, fontWeight: 800, fontSize: 68 * s, lineHeight: 1.05, color: theme.text }}>{state.text}</div>
        {state.value && (
          <div style={{ marginTop: 10 * s, fontFamily: theme.fontSans, fontWeight: 800, fontSize: 72 * s, lineHeight: 1, color: theme.accent }}>
            <NumberValue state={state} t={t} theme={theme} locale={locale} />
          </div>
        )}
      </div>
    </div>
  );
}

// Zonas fijas de la pantalla (a 1080p). Con left/right en uso, el centro se
// achica a una columna del medio.
function slotBox(slot: Exclude<Slot, "full">, split: boolean, s: number, width: number): React.CSSProperties {
  const side = 140 * s;
  if (slot === "top") return { left: side, right: side, top: 140 * s, height: 180 * s, justifyContent: "flex-end" };
  // Anclado abajo y sin alto fijo: crece hacia arriba, nunca sobre los subtitulos.
  if (slot === "bottom") return { left: side, right: side, bottom: 200 * s, justifyContent: "flex-end" };
  const middle = { top: 330 * s, bottom: 400 * s, justifyContent: "center" };
  if (slot === "left") return { ...middle, left: side, width: width / 2 - side - 40 * s };
  if (slot === "right") return { ...middle, right: side, width: width / 2 - side - 40 * s };
  return split ? { ...middle, left: width / 2 - 200 * s, width: 400 * s } : { ...middle, left: side, right: side, top: 250 * s, bottom: 300 * s };
}

export function SceneView({ scene, theme, palette, locale }: { scene: AnimatedScene; theme: Theme; palette: string | PaletteTheme | undefined; locale?: string | undefined }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = height / 1080;
  // Dentro de la Sequence el frame es relativo a la escena.
  const t = scene.start + frame / fps;
  const total = Math.round((scene.end - scene.start) * fps);
  const fade = Math.min(
    interpolate(frame, [0, SCENE_FADE], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(frame, [total - SCENE_FADE, total], [1, 0], { extrapolateLeft: "clamp" })
  );
  const states = scene.elements.map((el) => ({ el, state: stateAt(el, scene, t) })).filter(({ state }) => state.visible);
  // Columnas solo si hay algo a los costados EN PANTALLA: un titulo que va
  // antes de las tarjetas usa todo el ancho.
  const split = states.some(({ el }) => el.slot === "left" || el.slot === "right");
  const slots: Exclude<Slot, "full">[] = ["top", "left", "center", "right", "bottom"];

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {/* Graficos del catalogo: a pantalla completa, desde que se muestran. */}
      {scene.elements
        .filter((el) => el.kind === "graphic" && el.spec)
        .map((el) => {
          const state = stateAt(el, scene, scene.end);
          const from = Math.max(0, Math.round((state.shownAt - scene.start) * fps));
          const until = state.hiddenAt ?? scene.end;
          const duration = Math.max(1, Math.round((until - state.shownAt) * fps));
          return (
            <Sequence key={el.id} from={from} durationInFrames={duration} layout="none">
              <Overlay spec={el.spec!} theme={palette} locale={locale} durationSeconds={duration / fps} exit />
            </Sequence>
          );
        })}
      {slots.map((slot) => {
        const items = states.filter(({ el }) => el.slot === slot && el.kind !== "graphic");
        if (items.length === 0) return null;
        return (
          <div key={slot} style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center", gap: 28 * s, ...slotBox(slot, split, s, width) }}>
            {items.map(({ el, state }) => (
              <ElementView key={el.id} el={el} state={state} t={t} s={s} theme={theme} locale={locale} />
            ))}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
