import type { OverlaySpec } from "../types/shared/typeShared.js";
import { normalizeToken, tokenizeScript, type TokenTiming } from "./wordAlignment.js";

// Cuando aparece y cuanto dura cada grafico animado (ver motion/ y
// render_video). Dos pasos:
// 1. anchorSceneOverlays (build_timeline): ancla cada overlay a la palabra
//    exacta del guion donde se narra su texto, con el timing real de
//    Whisper -- el grafico entra justo cuando la voz lo dice.
// 2. placeOverlays (render_video): reparte duraciones sin que dos graficos
//    se pisen.

// Cuanto antes de la palabra entra el grafico (que ya este en pantalla
// cuando el oyente escucha la cifra).
// 0.2: con 0.35 se sentia adelantado en el preview (la cifra ya estaba
// armada antes de que la voz llegara a decirla).
const LEAD_IN_SECONDS = 0.2;
const MIN_ON_SCREEN_SECONDS = 1.5;
const GAP_BETWEEN_SECONDS = 0.2;

// Default de segundos en pantalla por tipo (el planificador puede pisarlo
// con spec.duration).
const DEFAULT_DURATIONS: Partial<Record<OverlaySpec["type"], number>> = {
  big_number: 4.5,
  data_viz_single: 6,
  versus: 6,
  timeline: 7,
  location: 4,
  title_card: 3.5,
  lower_third: 4,
  rank_reveal: 4,
  // Dato fijo en esquina: acompaña un tramo largo, no un instante.
  badge: 7,
  cta: 4,
  kinetic_quote: 3.5,
  list: 6.5,
  profile_card: 6,
  myth_fact: 5.5,
  scale_compare: 5,
  line_chart: 7,
  pivot_question: 3.5,
  card_grid: 7,
  scoreboard: 5,
  strike_word: 3.5,
  phrase_swap: 4.5,
  chapter_index: 6,
  number_phrase: 4,
  person_card: 5,
  milestone: 5,
  subscribe_cta: 4.5,
  map_globe: 5,
  map_marker: 5.5,
};

export interface TimedOverlay extends OverlaySpec {
  // Segundo absoluto del video en que se narra el texto (sin el lead-in).
  start_seconds?: number;
}

// Posicion (indice de token) de `text` dentro de los tokens de la escena,
// comparando normalizado ("1.500" vs "1500", acentos, puntuacion) y sin
// espacios entre palabras: una cifra partida en dos tokens ("1." "600", de
// escenas armadas antes del fix de build_scenes) igual matchea "1.600" --
// antes caia al inicio de la escena y el grafico entraba segundos antes de
// que la voz dijera la cifra. El match tiene que empezar y terminar en un
// limite de palabra, para no encontrar pedazos sueltos.
function findTokenIndex(sceneTokens: string[], text: string): number {
  const needle = tokenizeScript(text).map(normalizeToken).filter(Boolean);
  if (needle.length === 0) return -1;
  const hay = sceneTokens.map(normalizeToken);
  const target = needle.join("");

  const starts: number[] = [];
  let joined = "";
  for (const token of hay) {
    starts.push(joined.length);
    joined += token;
  }
  const boundaries = new Set([...starts, joined.length]);
  for (let pos = joined.indexOf(target); pos >= 0; pos = joined.indexOf(target, pos + 1)) {
    if (!boundaries.has(pos) || !boundaries.has(pos + target.length)) continue;
    // Primer token con contenido que arranca en `pos` (los vacios, "—",
    // comparten posicion con el siguiente).
    for (let i = 0; i < hay.length; i++) if (starts[i] === pos && hay[i]) return i;
  }
  // Sin match completo: al menos la primera palabra con contenido.
  return hay.indexOf(needle[0]!);
}

export function anchorSceneOverlays(
  overlays: OverlaySpec[],
  sceneTokens: string[],
  firstTokenIndex: number,
  wordTimings: TokenTiming[] | null,
  sceneStart: number,
  sceneEnd: number
): TimedOverlay[] {
  return overlays.map((overlay) => {
    const idx = findTokenIndex(sceneTokens, overlay.text);
    const timing = idx >= 0 ? wordTimings?.[firstTokenIndex + idx] : undefined;
    // Sin timing real (o sin match): proporcional dentro de la escena.
    const ratio = idx >= 0 && sceneTokens.length > 0 ? idx / sceneTokens.length : (overlay.anchor ?? 0);
    const start = timing && timing.end > 0 ? timing.start : sceneStart + ratio * (sceneEnd - sceneStart);
    return { ...overlay, start_seconds: Math.max(0, start) };
  });
}

export interface OverlaySceneTiming {
  start_seconds?: number | undefined;
  end_seconds?: number | undefined;
  overlay?: TimedOverlay | null | undefined;
  overlays?: TimedOverlay[] | null | undefined;
}

export interface PlacedOverlay {
  spec: OverlaySpec;
  start: number;
  end: number;
}

// Timelines de antes de anchorSceneOverlays no traen start_seconds: se usa
// el anchor relativo (0-1) dentro de la escena.
export function placeOverlays(scenes: OverlaySceneTiming[], supportedTypes?: readonly string[]): PlacedOverlay[] {
  const candidates: PlacedOverlay[] = [];
  for (const scene of scenes) {
    const sceneStart = scene.start_seconds;
    const sceneEnd = scene.end_seconds;
    if (sceneStart === undefined || sceneEnd === undefined || sceneEnd <= sceneStart) continue;
    const list = scene.overlays?.length ? scene.overlays : scene.overlay ? [scene.overlay] : [];
    for (const spec of list) {
      if (!spec || spec.type === "ninguno" || !spec.text?.trim()) continue;
      if (supportedTypes && !supportedTypes.includes(spec.type)) continue;
      const narrated = spec.start_seconds ?? sceneStart + (spec.anchor ?? 0) * (sceneEnd - sceneStart);
      const start = Math.max(0, narrated - LEAD_IN_SECONDS);
      const wanted = spec.duration ?? DEFAULT_DURATIONS[spec.type] ?? 4;
      const { start_seconds: _s, anchor: _a, ...clean } = spec as TimedOverlay;
      candidates.push({ spec: clean, start, end: start + wanted });
    }
  }

  // Nunca dos a la vez: si el anterior sigue en pantalla, se corta antes
  // del siguiente; si queda demasiado corto, se descarta el siguiente.
  candidates.sort((a, b) => a.start - b.start);
  const placed: PlacedOverlay[] = [];
  for (const c of candidates) {
    const prev = placed[placed.length - 1];
    if (prev && c.start < prev.end + GAP_BETWEEN_SECONDS) {
      const cut = c.start - GAP_BETWEEN_SECONDS;
      if (cut - prev.start >= MIN_ON_SCREEN_SECONDS) prev.end = cut;
      else continue;
    }
    placed.push(c);
  }
  const result = placed.filter((p) => p.end - p.start >= MIN_ON_SCREEN_SECONDS);

  // Capitulos: numero en orden y en que parte del video caen (barra de
  // progreso del title_card). Se calcula aca, que ve el video entero, para
  // que el render y el preview del front reciban lo mismo.
  const videoEnd = Math.max(0, ...scenes.map((s) => s.end_seconds ?? 0));
  let chapter = 0;
  for (const p of result) {
    if (p.spec.type !== "title_card") continue;
    chapter += 1;
    p.spec = { ...p.spec, chapter, ...(videoEnd > 0 ? { progress: Math.min(1, p.start / videoEnd) } : {}) };
  }
  return result;
}

// Capa fija de navegacion (Ciencia y Vida, Como Funciona El Mundo): una
// linea arriba todo el video con canal · tema a la izquierda y el capitulo
// a la derecha. Un tramo por capitulo (los title_card ya ubicados): al
// cambiar de capitulo se va y vuelve a entrar con el nuevo. Va aparte de
// placeOverlays porque convive con los demas graficos.
const NAV_TEXT = {
  es: { chapter: "Capítulo", case: "Caso", of: "de", prologue: "Prólogo" },
  en: { chapter: "Chapter", case: "Case", of: "of", prologue: "Prologue" },
  pt: { chapter: "Capítulo", case: "Caso", of: "de", prologue: "Prólogo" },
} as const;
// Antes del primer capitulo: si es mas corto que esto no se muestra
// "Prologo" (el capitulo arranca casi con el video).
const MIN_PROLOGUE_SECONDS = 8;

function clip(text: string, max: number): string {
  const clean = text.trim().replace(/[.!:;,]+$/, "");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function placeNavHeaders(
  placed: PlacedOverlay[],
  videoEnd: number,
  ctx: { channel?: string | null; topic?: string | null; locale?: string | null }
): PlacedOverlay[] {
  if (videoEnd <= 0) return [];
  const words = NAV_TEXT[((ctx.locale ?? "es").slice(0, 2) as keyof typeof NAV_TEXT)] ?? NAV_TEXT.es;
  const left = [ctx.channel?.trim(), ctx.topic ? clip(ctx.topic, 64) : null].filter(Boolean).join(" · ");
  const chapters = placed.filter((p) => p.spec.type === "title_card");
  // "Caso 1 de 6" si los capitulos son casos de una lista ("Caso 2: ...").
  const isCases = chapters.length > 0 && chapters.every((c) => /^s*caso|^s*case/i.test(`${c.spec.label ?? ""} ${c.spec.text}`.trim()));
  const unit = isCases ? words.case : words.chapter;

  const header = (label: string, start: number, end: number): PlacedOverlay => ({
    spec: { type: "nav_header", text: left, source: "script", ...(label ? { label } : {}) },
    start,
    end,
  });
  // Sin capitulos no hay estructura que mostrar: canal · tema solo no aporta.
  if (chapters.length === 0) return [];

  const result: PlacedOverlay[] = [];
  if (chapters[0]!.start >= MIN_PROLOGUE_SECONDS) result.push(header(words.prologue, 0, chapters[0]!.start));
  chapters.forEach((c, i) => {
    const title = isCases ? "" : clip(c.spec.text, 34);
    const label = `${unit} ${i + 1} ${words.of} ${chapters.length}${title ? ` · ${title}` : ""}`;
    const start = i === 0 && result.length === 0 ? 0 : c.start;
    result.push(header(label, start, chapters[i + 1]?.start ?? videoEnd));
  });
  return result;
}
