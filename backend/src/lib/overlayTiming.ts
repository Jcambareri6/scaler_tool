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
const LEAD_IN_SECONDS = 0.35;
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
  badge: 4,
  cta: 4,
};

export interface TimedOverlay extends OverlaySpec {
  // Segundo absoluto del video en que se narra el texto (sin el lead-in).
  start_seconds?: number;
}

// Posicion (indice de token) de `text` dentro de los tokens de la escena,
// comparando normalizado ("1.500" vs "1500", acentos, puntuacion).
function findTokenIndex(sceneTokens: string[], text: string): number {
  const needle = tokenizeScript(text).map(normalizeToken).filter(Boolean);
  if (needle.length === 0) return -1;
  const hay = sceneTokens.map(normalizeToken);
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length && ok; k++) ok = hay[i + k] === needle[k];
    if (ok) return i;
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
  return placed.filter((p) => p.end - p.start >= MIN_ON_SCREEN_SECONDS);
}
