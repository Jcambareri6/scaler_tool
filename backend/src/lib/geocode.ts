import { fetchWithTimeout } from "./http.js";

// GEOCODIFICADOR (como coordenadas de MaV): el montajista escribe lat/lon de
// memoria y a veces se equivoca por cientos de km (un pueblo en el pais de
// al lado, un map_marker sin coordenada valida). Nominatim (OpenStreetMap,
// gratis, sin clave) da la coordenada real y el tamano del sitio (su caja),
// que elige el zoom del mapa. Politica de uso: 1 consulta por segundo y un
// User-Agent que identifique la app; se cachea por proceso.

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "SkalerTool-documental/1.0";
// Si la coordenada del modelo cae a mas de esto de todo resultado, se corrige.
export const MAX_DRIFT_KM = 25;
const MIN_INTERVAL_MS = 1100;
// Un pueblo o ciudad antes que su municipio/partido/estado del mismo nombre
// (el centro de un municipio grande cae lejos del pueblo).
const SETTLEMENT = new Set(["city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter", "locality", "island", "islet"]);

export interface GeoResult {
  lat: number;
  lon: number;
  // Radio aproximado del sitio (km), de su caja: elige el zoom.
  km: number;
  name: string;
  kind: string;
}

const cache = new Map<string, Promise<GeoResult[]>>();
let queue: Promise<unknown> = Promise.resolve();

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Radio de la caja [sur, norte, oeste, este] en km (mitad de la diagonal).
export function bboxRadiusKm(bbox: [number, number, number, number]): number {
  const [south, north, west, east] = bbox;
  return haversineKm({ lat: south, lon: west }, { lat: north, lon: east }) / 2;
}

async function lookup(query: string): Promise<GeoResult[]> {
  // Serializado: Nominatim pide como mucho 1 consulta por segundo.
  const run = queue.then(async () => {
    const started = Date.now();
    try {
      const url = `${ENDPOINT}?${new URLSearchParams({ q: query, format: "jsonv2", limit: "5", "accept-language": "es,en" })}`;
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } }, 15_000);
      if (!res.ok) return [];
      const rows = (await res.json()) as { lat: string; lon: string; boundingbox?: string[]; display_name?: string; addresstype?: string; type?: string }[];
      return rows.flatMap((r) => {
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
        const bbox = (r.boundingbox ?? []).map(Number);
        const km = bbox.length === 4 && bbox.every(Number.isFinite) ? bboxRadiusKm(bbox as [number, number, number, number]) : 5;
        return [{ lat, lon, km: Math.max(0.3, Math.round(km * 10) / 10), name: r.display_name ?? query, kind: r.addresstype ?? r.type ?? "" }];
      });
    } catch {
      return [];
    } finally {
      const wait = MIN_INTERVAL_MS - (Date.now() - started);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

export function geocode(query: string): Promise<GeoResult[]> {
  const key = query.trim().toLowerCase();
  if (!key) return Promise.resolve([]);
  if (!cache.has(key)) cache.set(key, lookup(query.trim()));
  return cache.get(key)!;
}

// El mejor resultado: el primero que sea un pueblo/ciudad si lo hay entre los
// primeros, si no el primero (un canal, un monumento, un pais).
export function bestResult(results: GeoResult[], near?: { lat: number; lon: number }): GeoResult | undefined {
  // Sin coordenada del modelo: el resultado mas cercano a los otros lugares
  // del video ("Tulum" solo tambien es un pueblo de Turquia).
  if (near) {
    const inRange = results.filter((r) => haversineKm(near, r) <= NEAR_MAX_KM).sort((a, b) => haversineKm(near, a) - haversineKm(near, b));
    if (inRange.length) return inRange.find((r) => SETTLEMENT.has(r.kind)) ?? inRange[0];
  }
  const top = results.slice(0, 3);
  if (top[0] && !SETTLEMENT.has(top[0].kind)) return top.find((r) => SETTLEMENT.has(r.kind)) ?? top[0];
  return top[0];
}

// Un lugar sin coordenada se busca a menos de esto de los otros del video.
const NEAR_MAX_KM = 2500;

// Coordenada final de un lugar: la del modelo si cae cerca (<= 25 km) de
// algun resultado; si no (o si falta), la del mejor resultado. El tamano del
// sitio sale del resultado elegido o del mas cercano a la coordenada.
export async function correctPlace(
  name: string,
  model: { lat: number; lon: number } | undefined,
  near?: { lat: number; lon: number }
): Promise<{ lat: number; lon: number; km?: number; corrected: boolean } | null> {
  const results = name ? await geocode(name) : [];
  const validModel =
    model && Number.isFinite(model.lat) && Number.isFinite(model.lon) && Math.abs(model.lat) <= 90 && Math.abs(model.lon) <= 180 && !(model.lat === 0 && model.lon === 0)
      ? model
      : undefined;
  if (results.length === 0) return validModel ? { ...validModel, corrected: false } : null;
  if (validModel) {
    const near = results
      .map((r) => ({ r, d: haversineKm(validModel, r) }))
      .filter((x) => x.d <= Math.max(MAX_DRIFT_KM, x.r.km))
      .sort((a, b) => a.d - b.d)[0];
    if (near) return { lat: validModel.lat, lon: validModel.lon, km: Math.min(near.r.km, 50), corrected: false };
  }
  const best = bestResult(results, validModel ? undefined : near)!;
  return { lat: best.lat, lon: best.lon, km: best.km, corrected: true };
}
