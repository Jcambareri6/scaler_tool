import type { OverlayType } from "../types/shared/typeShared.js";

// Manual de direccion (DISENO-director-graficos.md, "fichas de uso"): para
// cada recurso, que intencion del guion resuelve, cuando no usarlo, que tan
// fuerte es y cada cuanto se puede repetir. El director lo lee resumido
// para elegir; el verificador usa intensidad y fatiga para controlar el
// ritmo con codigo. Sumar un recurso = sumar su ficha aca.

export type Intent =
  | "impactar" // una magnitud que tiene que pegar
  | "comparar" // dos o mas cosas lado a lado
  | "perspectiva" // poner algo en escala con una analogia o proporcion
  | "tiempo" // el paso del tiempo, una fecha, una tendencia
  | "situar" // un lugar en el mundo
  | "explicar" // un mecanismo, capas, un ciclo
  | "estructura" // cambio de parte, lo que viene
  | "remarcar" // una idea o frase que el espectador tiene que leer
  | "intriga" // abrir una pregunta antes de responderla
  | "presentar" // un protagonista, un termino
  | "desmentir" // corregir una creencia
  | "pedir"; // suscripcion, like

export const INTENTS: Intent[] = [
  "impactar",
  "comparar",
  "perspectiva",
  "tiempo",
  "situar",
  "explicar",
  "estructura",
  "remarcar",
  "intriga",
  "presentar",
  "desmentir",
  "pedir",
];

export interface Ficha {
  intents: Intent[];
  // 1 = acompaña sin interrumpir, 3 = toma la pantalla.
  intensity: 1 | 2 | 3;
  // Fatiga: segundos minimos entre dos usos del mismo recurso.
  minGapSeconds: number;
  // Tope por video (sin tope si no esta).
  maxPerVideo?: number;
  avoid: string;
}

export const MANUAL: Partial<Record<OverlayType, Ficha>> = {
  big_number: { intents: ["impactar"], intensity: 2, minGapSeconds: 50, avoid: "cifras sin unidad o sin contexto" },
  number_phrase: { intents: ["impactar", "perspectiva"], intensity: 2, minGapSeconds: 60, avoid: "si la cifra sola ya se entiende (big_number)" },
  data_viz_single: { intents: ["comparar"], intensity: 3, minGapSeconds: 90, avoid: "valores de distinta magnitud o unidad" },
  versus: { intents: ["comparar", "perspectiva"], intensity: 3, minGapSeconds: 90, avoid: "si son mas de 2 cosas" },
  scale_compare: { intents: ["perspectiva"], intensity: 2, minGapSeconds: 120, avoid: "si no hay un objeto cotidiano con que comparar" },
  scoreboard: { intents: ["comparar"], intensity: 2, minGapSeconds: 120, maxPerVideo: 2, avoid: "si no es un resultado o enfrentamiento" },
  card_grid: { intents: ["comparar"], intensity: 3, minGapSeconds: 150, maxPerVideo: 2, avoid: "menos de 3 casos" },
  line_chart: { intents: ["tiempo", "comparar"], intensity: 3, minGapSeconds: 150, maxPerVideo: 2, avoid: "menos de 3 valores en el tiempo" },
  timeline: { intents: ["tiempo"], intensity: 3, minGapSeconds: 120, avoid: "si los hitos no estan en orden" },
  milestone: { intents: ["tiempo", "situar"], intensity: 1, minGapSeconds: 60, avoid: "fechas sin un hecho asociado" },
  map_globe: { intents: ["situar"], intensity: 3, minGapSeconds: 120, maxPerVideo: 3, avoid: "lugares chicos (mejor map_marker) o ya mostrados" },
  map_marker: { intents: ["situar"], intensity: 2, minGapSeconds: 90, avoid: "si el lugar no se puede ubicar en un mapa" },
  location: { intents: ["situar"], intensity: 1, minGapSeconds: 60, avoid: "si conviene ver el lugar en el mapa" },
  layers_diagram: { intents: ["explicar"], intensity: 3, minGapSeconds: 180, maxPerVideo: 2, avoid: "si no es algo por capas" },
  cycle_diagram: { intents: ["explicar"], intensity: 3, minGapSeconds: 180, maxPerVideo: 2, avoid: "si el proceso no vuelve a empezar" },
  list: { intents: ["explicar"], intensity: 2, minGapSeconds: 90, avoid: "si son solo 2 cosas" },
  title_card: { intents: ["estructura"], intensity: 3, minGapSeconds: 60, avoid: "si no cambia de parte de verdad" },
  chapter_index: { intents: ["estructura"], intensity: 2, minGapSeconds: 300, maxPerVideo: 1, avoid: "si el narrador no anuncia las partes" },
  pivot_question: { intents: ["intriga"], intensity: 3, minGapSeconds: 120, maxPerVideo: 3, avoid: "preguntas retoricas sin peso" },
  kinetic_quote: { intents: ["remarcar"], intensity: 3, minGapSeconds: 90, avoid: "frases sin remate" },
  phrase_swap: { intents: ["remarcar", "desmentir"], intensity: 3, minGapSeconds: 150, maxPerVideo: 2, avoid: "si las dos frases no se contraponen" },
  myth_fact: { intents: ["desmentir"], intensity: 3, minGapSeconds: 120, avoid: "si falta la realidad literal" },
  strike_word: { intents: ["desmentir"], intensity: 2, minGapSeconds: 120, maxPerVideo: 2, avoid: "si hay mito y realidad completos (myth_fact)" },
  lower_third: { intents: ["presentar"], intensity: 1, minGapSeconds: 45, avoid: "terminos obvios" },
  person_card: { intents: ["presentar"], intensity: 1, minGapSeconds: 60, avoid: "si hay 2 o mas datos de la persona (profile_card)" },
  profile_card: { intents: ["presentar"], intensity: 2, minGapSeconds: 90, avoid: "menos de 2 datos" },
  rank_reveal: { intents: ["estructura", "impactar"], intensity: 2, minGapSeconds: 40, avoid: "si no es un top/ranking" },
  badge: { intents: ["tiempo", "remarcar"], intensity: 1, minGapSeconds: 90, avoid: "datos que no siguen valiendo un rato" },
  cta: { intents: ["pedir"], intensity: 1, minGapSeconds: 600, maxPerVideo: 1, avoid: "si el guion no lo pide" },
  subscribe_cta: { intents: ["pedir"], intensity: 1, minGapSeconds: 600, maxPerVideo: 1, avoid: "si el guion no lo pide" },
};

// Version corta para el director: una linea por recurso.
export function manualSummary(types: OverlayType[]): string {
  return types
    .filter((t) => MANUAL[t])
    .map((t) => {
      const f = MANUAL[t]!;
      const limit = f.maxPerVideo ? `, max ${f.maxPerVideo} por video` : "";
      return `- ${t}: ${f.intents.join("/")} · intensidad ${f.intensity} · no repetir antes de ${f.minGapSeconds}s${limit} · evitar: ${f.avoid}`;
    })
    .join("\n");
}
