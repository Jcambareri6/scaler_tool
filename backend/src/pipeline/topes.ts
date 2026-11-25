// TOPES DE PANTALLA (como acortarLargos de MaV): un rotulo sobre textura no
// aguanta mas de 3 s y una foto "de tema" (stock, rescate, busqueda amplia)
// mas de 4 s sin que el espectador sienta que el video se trabo. Primero se
// parte el plano con otra imagen; si no hay, se alargan los vecinos.

export const TOPE_ROTULO = 3;
export const TOPE_FOTO_TEMA = 4;
// Solo actua si el plano pasa el tope por mas de esto.
export const TOPE_MARGIN = 0.5;
// La segunda parte tiene que durar al menos esto.
export const MIN_PART = 2.2;
// Lo minimo que tienen que ceder los vecinos para que valga la pena.
export const MIN_CEDED = 0.4;
// El corte va 120 ms antes de la palabra.
const WORD_LEAD = 0.12;

// Fotos de "tema" (rescate): el paso 2 busca con el tema del tramo y el 3 trae
// las imagenes del articulo; commons_tema/youtube_tema son de corridas viejas.
const TEMA_VIAS = new Set(["busqueda_tema", "wikipedia_articulo", "commons_tema", "youtube_tema"]);
const STOCK_PROVIDERS = new Set(["pexels", "pixabay", "coverr"]);

export interface CapVisual {
  provider: string;
  via: string;
  type: "VIDEO" | "IMAGE";
  // El QA final la marco como foto de stock.
  stock?: boolean;
}

// Tope de pantalla de un visual, o null si no tiene.
export function capFor(v: CapVisual): number | null {
  if (v.provider === "textura") return TOPE_ROTULO;
  if (v.type === "IMAGE" && (v.stock || STOCK_PROVIDERS.has(v.provider) || TEMA_VIAS.has(v.via))) return TOPE_FOTO_TEMA;
  return null;
}

// Donde partir: el comienzo de la palabra (-120 ms) mas cercano al tope,
// entre 2,2 s y tope + 0,6 s, dejando al menos 2,2 s para la segunda parte.
export function cutPoint(words: { start: number }[], start: number, end: number, cap: number): number | null {
  let best: number | null = null;
  for (const w of words) {
    const t = w.start - WORD_LEAD;
    const offset = t - start;
    if (offset < MIN_PART || offset > cap + 0.6 || end - t < MIN_PART) continue;
    if (best === null || Math.abs(offset - cap) < Math.abs(best - start - cap)) best = t;
  }
  return best;
}

// Cuanto puede alargarse un vecino: un grafico o mapa hasta 8 s, una foto
// hasta 7 s (4 si es de tema), un clip hasta min(9 s, su duracion / 0,6).
export function neighbourMax(n: { type?: "VIDEO" | "IMAGE"; graphic: boolean; cap: number | null; clipSeconds?: number }): number {
  if (n.graphic) return 8;
  if (n.type === "IMAGE") return n.cap ?? 7;
  if (n.type === "VIDEO") return Math.min(9, (n.clipSeconds ?? 9 * 0.6) / 0.6);
  return 0;
}

// Reparto del exceso entre el siguiente (entra antes) y el anterior (sale
// despues). Null si ceden menos de 0,4 s: el plano queda como esta.
export function planExtension(excess: number, prevRoom: number, nextRoom: number): { next: number; prev: number } | null {
  const next = Math.max(0, Math.min(excess, nextRoom));
  const prev = Math.max(0, Math.min(excess - next, prevRoom));
  if (next + prev < MIN_CEDED) return null;
  return { next: round(next), prev: round(prev) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
