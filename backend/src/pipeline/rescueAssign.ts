// FASE 2 DEL RESCATE (pedido del cliente, 27/11/2026): la busqueda de
// candidatos corre en paralelo, pero la ASIGNACION se decide de a un plano y
// en orden de aparicion, mirando a los vecinos ya decididos. Asi no hay
// carreras: antes cada plano del rescate reservaba su animacion en paralelo
// y bloqueaba a sus dos vecinos (Malvinas, 26/11: 19 de 20 fallas por "el
// plano de al lado ya tiene animacion").
//
// Este modulo no toca red ni base: decide con lo que recibe. Lo usa
// rescueGaps (documentalPipeline.ts) y lo prueban scripts/tests/rescate.test.ts.

// Un candidato ya aprobado por el juez para un plano.
export interface RescueOption<T = unknown> {
  // "youtube:abc", "commons:123"... (sin el @momento): no repetir cerca.
  base: string;
  // Clave unica del material (para no usar dos veces lo mismo).
  key: string;
  step: "toma_aprobada" | "busqueda_tema" | "wikipedia_articulo";
  // Tope de usos de este video/imagen en todo el documental.
  maxUses: number;
  payload: T;
}

// Mismo video o imagen: no a 3 planos o menos de distancia.
export const RESCUE_NEAR = 3;

// Elige, para el plano `index`, el primer candidato (en el orden del juez)
// que no repite video/imagen con los planos ya decididos a RESCUE_NEAR o menos
// y que no paso su tope de usos. `originAt(i)` es el origen del plano i si ya
// esta decidido (undefined si no). No modifica nada.
export function pickOption<T>(
  index: number,
  options: RescueOption<T>[],
  originAt: (i: number) => string | undefined,
  usesOf: (base: string) => number,
  taken: (key: string) => boolean
): RescueOption<T> | null {
  const near = new Set<string>();
  for (let d = 1; d <= RESCUE_NEAR; d++) {
    for (const i of [index - d, index + d]) {
      const o = originAt(i);
      if (o) near.add(o);
    }
  }
  return options.find((o) => !near.has(o.base) && usesOf(o.base) < o.maxUses && !taken(o.key)) ?? null;
}

// ---------- Recortes de material ya aprobado ----------

export interface CropSpec {
  // Centro relativo de la ventana (0..1) y cuanto se acerca (1,5x a 2x).
  x: number;
  y: number;
  zoom: number;
  // Clip: segundo del archivo desde donde arranca (otro momento).
  t?: number;
  // Movimiento de camara forzado (distinto al del uso original).
  motion?: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "push";
  // Ultimo recurso: la imagen desenfocada detras del rotulo de falla.
  blur?: boolean;
}

// Un recorte bien formado (lo que viene de assets.metadata.crop).
export function isCrop(value: unknown): value is CropSpec {
  const c = value as Partial<CropSpec> | null | undefined;
  return !!c && typeof c.x === "number" && typeof c.y === "number" && typeof c.zoom === "number" && c.zoom >= 1;
}

// Material aprobado del video que se puede recortar.
export interface CropSource {
  // Indice (en byOrder) del plano donde se uso el original.
  index: number;
  // Clave del material (storage_key): cuenta los recortes por fuente.
  key: string;
  tema?: string;
  type: "VIDEO" | "IMAGE";
}

// Zonas de la imagen que NO son el centro (el uso original la muestra entera,
// centrada): cada recorte de una misma fuente toma una zona distinta.
export const CROP_REGIONS: { x: number; y: number }[] = [
  { x: 0.25, y: 0.3 },
  { x: 0.75, y: 0.7 },
  { x: 0.75, y: 0.3 },
  { x: 0.25, y: 0.7 },
];
const CROP_ZOOMS = [1.6, 1.9];
const CROP_MOTIONS: NonNullable<CropSpec["motion"]>[] = ["pan_right", "zoom_out", "pan_left", "push"];

// Limites: el recorte va a 5 planos o mas del uso original, como mucho 2 por
// fuente, y nunca dos recortes de la misma fuente seguidos. Del mismo tramo:
// mismo tema_bloque o hasta 10 planos de distancia.
export const CROP_MIN_GAP = 5;
export const CROP_MAX_PER_SOURCE = 2;
export const CROP_WINDOW = 10;

export interface CropState {
  // Recortes ya hechos por fuente (indices de los planos que los usan).
  bySource: Map<string, number[]>;
}

// Fuentes posibles para el plano `index`, de la mas cercana a la mas lejana.
// `cropOf(i)` = clave de la fuente si el plano i ya es un recorte.
export function cropCandidates(
  index: number,
  tema: string | undefined,
  sources: CropSource[],
  state: CropState,
  cropOf: (i: number) => string | undefined
): CropSource[] {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  return sources
    .filter((s) => {
      const dist = Math.abs(s.index - index);
      const sameTramo = (!!tema && norm(s.tema) === norm(tema)) || dist <= CROP_WINDOW;
      if (!sameTramo || dist < CROP_MIN_GAP) return false;
      const done = state.bySource.get(s.key) ?? [];
      if (done.length >= CROP_MAX_PER_SOURCE) return false;
      // Nunca dos recortes de la misma fuente seguidos.
      if (cropOf(index - 1) === s.key || cropOf(index + 1) === s.key) return false;
      return true;
    })
    .sort((a, b) => Math.abs(a.index - index) - Math.abs(b.index - index));
}

// El encuadre del n-esimo recorte (0, 1) de una fuente: zona, zoom y
// movimiento distintos entre si y distintos del uso original (entero y centrado).
export function cropSpecFor(nth: number, type: "VIDEO" | "IMAGE", clipSeconds?: number, planeSeconds?: number): CropSpec {
  const region = CROP_REGIONS[nth % CROP_REGIONS.length]!;
  const spec: CropSpec = { ...region, zoom: CROP_ZOOMS[nth % CROP_ZOOMS.length]!, motion: CROP_MOTIONS[nth % CROP_MOTIONS.length]! };
  // Clip: otro momento. El original arranca en 0; el recorte, lo mas lejos
  // posible dentro del archivo (sin pasarse del final).
  if (type === "VIDEO" && clipSeconds && planeSeconds) {
    const room = Math.max(0, clipSeconds - planeSeconds);
    if (room > 0.5) spec.t = Math.round((nth === 0 ? room : room / 2) * 100) / 100;
  }
  return spec;
}

// Filtro ffmpeg del recorte (antes de escalar): ventana de iw/zoom x ih/zoom
// cuyo centro queda en (x, y) relativo, sin salirse de la imagen.
export function cropFilter(crop: CropSpec): string {
  const z = Math.max(1, crop.zoom);
  const { fx, fy } = cropOffset(crop);
  return `crop=iw/${z}:ih/${z}:(iw-iw/${z})*${fx.toFixed(4)}:(ih-ih/${z})*${fy.toFixed(4)}`;
}

// Lugar que la frase nombra como NOMBRE PROPIO: alguna palabra con mayuscula,
// tal como esta escrita en la frase ("historia argentina" no cuenta; "la
// Argentina" e "isla Martín García" si).
export function isProperName(span: string): boolean {
  return span.trim().split(/\s+/).some((w) => /^[A-ZÁÉÍÓÚÜÑ]/.test(w));
}

// Desplazamiento de la ventana del recorte como fraccion de lo que sobra
// (0 = borde izquierdo/superior, 1 = derecho/inferior). El render lo usa en
// crop=... y la preview en transform-origin (mismo resultado).
export function cropOffset(crop: CropSpec): { fx: number; fy: number } {
  const z = Math.max(1, crop.zoom);
  const span = 1 - 1 / z || 1;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { fx: clamp((crop.x - 0.5 / z) / span), fy: clamp((crop.y - 0.5 / z) / span) };
}
