import { fetchWithTimeout } from "./http.js";

// DATOS ABIERTOS (como datosAbiertos.js de MaV): series del Banco Mundial
// (gratis, sin clave) para graficos con cifras REALES de un pais: linea de un
// indicador en el tiempo y piramide de poblacion. El montajista elige el
// indicador (alias de la tabla) y el pais (ISO3); si no hay datos, el
// grafico se quita: "un grafico con una linea inventada es peor que ningun
// grafico". Cache en memoria por proceso.

const API = "https://api.worldbank.org/v2";
const TIMEOUT_MS = 20_000;
export const SOURCE_NAME = "Banco Mundial";

// Alias -> codigo del Banco Mundial (tabla de MaV, directorV2.js:378-394).
export const INDICATORS: Record<string, { code: string; nombre: string }> = {
  fertilidad: { code: "SP.DYN.TFRT.IN", nombre: "Hijos por mujer" },
  natalidad: { code: "SP.DYN.CBRT.IN", nombre: "Nacimientos por cada 1000 habitantes" },
  mortalidad: { code: "SP.DYN.CDRT.IN", nombre: "Muertes por cada 1000 habitantes" },
  "esperanza-vida": { code: "SP.DYN.LE00.IN", nombre: "Esperanza de vida (años)" },
  poblacion: { code: "SP.POP.TOTL", nombre: "Población" },
  "mayores-65": { code: "SP.POP.65UP.TO.ZS", nombre: "Mayores de 65 (% de la población)" },
  urbana: { code: "SP.URB.TOTL.IN.ZS", nombre: "Población urbana (%)" },
  pib: { code: "NY.GDP.MKTP.CD", nombre: "PIB (US$)" },
  "pib-habitante": { code: "NY.GDP.PCAP.CD", nombre: "PIB por habitante (US$)" },
  crecimiento: { code: "NY.GDP.MKTP.KD.ZG", nombre: "Crecimiento del PIB (%)" },
  inflacion: { code: "FP.CPI.TOTL.ZG", nombre: "Inflación (%)" },
  paro: { code: "SL.UEM.TOTL.ZS", nombre: "Desempleo (%)" },
  deuda: { code: "GC.DOD.TOTL.GD.ZS", nombre: "Deuda pública (% del PIB)" },
  "gasto-militar": { code: "MS.MIL.XPND.GD.ZS", nombre: "Gasto militar (% del PIB)" },
  "cambio-dolar": { code: "PA.NUS.FCRF", nombre: "Tipo de cambio (por US$)" },
  emisiones: { code: "EN.GHG.CO2.PC.CE.AR5", nombre: "Emisiones de CO2 por habitante (t)" },
};

// 17 grupos de 5 anios (0-4 ... 80+), como los publica el Banco Mundial.
export const AGE_GROUPS = ["0004", "0509", "1014", "1519", "2024", "2529", "3034", "3539", "4044", "4549", "5054", "5559", "6064", "6569", "7074", "7579", "80UP"];
export const AGE_LABELS = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80+"];

export interface Serie {
  pais: string;
  iso: string;
  indicador: string;
  nombre: string;
  puntos: { anio: number; valor: number }[];
  fuente: string;
}

export interface Piramide {
  pais: string;
  iso: string;
  // % del total de ese anio por grupo (17) y sexo.
  anios: { anio: number; hombres: number[]; mujeres: number[] }[];
  fuente: string;
}

const cache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, fn().catch(() => null));
  return cache.get(key) as Promise<T>;
}

// Solo un codigo ISO de 2-3 letras (el modelo del plan lo escribe).
export function countryCode(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2,3}$/.test(s) ? s : null;
}

// Alias de la tabla o un codigo del Banco Mundial escrito directo.
export function indicatorCode(value: unknown): { code: string; nombre: string } | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (INDICATORS[s.toLowerCase()]) return INDICATORS[s.toLowerCase()]!;
  return /^[A-Z0-9_.]{4,40}$/.test(s) ? { code: s, nombre: s } : null;
}

type WbRow = { date: string; value: number | null; country?: { value?: string }; countryiso3code?: string; indicator?: { value?: string } };

async function wbSeries(iso: string, code: string, from: number, to: number, source?: number): Promise<WbRow[]> {
  const params = new URLSearchParams({ format: "json", per_page: "20000", date: `${from}:${to}`, ...(source ? { source: String(source) } : {}) });
  const res = await fetchWithTimeout(`${API}/country/${iso}/indicator/${code}?${params}`, {}, TIMEOUT_MS);
  if (!res.ok) return [];
  const body = (await res.json()) as [unknown, WbRow[] | null] | unknown;
  return Array.isArray(body) && Array.isArray(body[1]) ? (body[1] as WbRow[]) : [];
}

// Serie de un indicador. Null si hay menos de 2 puntos.
export function serie(pais: string, indicador: string, desde: number, hasta: number): Promise<Serie | null> {
  const iso = countryCode(pais);
  const ind = indicatorCode(indicador);
  if (!iso || !ind) return Promise.resolve(null);
  const from = Math.max(1960, Math.min(desde, hasta));
  const to = Math.min(2050, Math.max(desde, hasta));
  return cached(`serie:${iso}:${ind.code}:${from}:${to}`, async () => {
    const rows = await wbSeries(iso, ind.code, from, to);
    const puntos = rows
      .filter((r) => r.value !== null && Number.isFinite(Number(r.value)) && /^\d{4}$/.test(r.date))
      .map((r) => ({ anio: Number(r.date), valor: Number(r.value) }))
      .sort((a, b) => a.anio - b.anio);
    if (puntos.length < 2) return null;
    return { pais: rows[0]?.country?.value ?? iso, iso, indicador: ind.code, nombre: ind.nombre, puntos, fuente: SOURCE_NAME };
  });
}

// Piramide de poblacion (fuente 40 del Banco Mundial: estimaciones y
// proyecciones hasta 2050). Cada grupo como % del total del anio; un anio
// cuyos grupos no suman el total publicado (+-2 %) se descarta.
export function poblacion(pais: string, anios: number[]): Promise<Piramide | null> {
  const iso = countryCode(pais);
  const years = [...new Set(anios.filter((a) => a >= 1960 && a <= 2050))].sort((a, b) => a - b).slice(0, 4);
  if (!iso || years.length === 0) return Promise.resolve(null);
  return cached(`piramide:${iso}:${years.join(",")}`, async () => {
    const from = years[0]!;
    const to = years[years.length - 1]!;
    const codes = AGE_GROUPS.flatMap((g) => [`SP.POP.${g}.MA`, `SP.POP.${g}.FE`]);
    const values = new Map<string, number>();
    // De a 12 indicadores por pedido (como MaV), separados por ";".
    for (let i = 0; i < codes.length; i += 12) {
      const chunk = codes.slice(i, i + 12);
      const rows = await wbSeries(iso, chunk.join(";"), from, to, 40);
      for (const r of rows) {
        const code = (r as { indicator?: { id?: string } }).indicator?.id;
        if (code && r.value !== null) values.set(`${code}:${r.date}`, Number(r.value));
      }
    }
    const totals = new Map((await wbSeries(iso, "SP.POP.TOTL", from, to, 40)).filter((r) => r.value !== null).map((r) => [Number(r.date), Number(r.value)]));
    const out: Piramide["anios"] = [];
    for (const anio of years) {
      const men = AGE_GROUPS.map((g) => values.get(`SP.POP.${g}.MA:${anio}`));
      const women = AGE_GROUPS.map((g) => values.get(`SP.POP.${g}.FE:${anio}`));
      if (men.some((v) => v === undefined) || women.some((v) => v === undefined)) continue;
      const sum = [...men, ...women].reduce((a, b) => a! + b!, 0)!;
      const total = totals.get(anio);
      if (total && Math.abs(sum - total) / total > 0.02) continue;
      out.push({ anio, hombres: men.map((v) => (v! / sum) * 100), mujeres: women.map((v) => (v! / sum) * 100) });
    }
    return out.length ? { pais: iso, iso, anios: out, fuente: SOURCE_NAME } : null;
  });
}

// Redondeo de MaV: >= 100 sin decimales, >= 10 uno, si no dos. Coma decimal
// y sin separador de miles (los pone la plantilla).
export function formatValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toFixed(decimals).replace(".", ",");
}

// Hasta `max` puntos muestreados, siempre con el primero y el ultimo.
export function samplePoints<T>(points: T[], max = 10): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]!);
  return out;
}
