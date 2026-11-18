// Caches del documental en Postgres (como las de Redis de MaV): regenerar un
// video o relanzarlo despues de un fallo no vuelve a pagar busquedas, hojas y
// llamadas al juez para las frases que ya tenian material aprobado.
// Tablas: yt_search_cache y shot_cache (supabase/migrations/20261117000000).
// Si la base falla, se sigue sin cache (nunca frena la generacion).

import { createHash } from "node:crypto";
import { supabase } from "./supabase.js";
import type { VisualCandidate } from "./documentalSources.js";

// Subir la version invalida toda la cache de planos (cambio de reglas del juez).
export const SHOT_CACHE_VERSION = "v1";
const SEARCH_TTL_MS = 6 * 3600_000;
const SHOT_TTL_MS = 14 * 86_400_000;

export async function cachedSearch(query: string): Promise<VisualCandidate[] | null> {
  try {
    const { data } = await supabase.from("yt_search_cache").select("results, created_at").eq("query", query).maybeSingle();
    if (!data || Date.now() - new Date(data.created_at as string).getTime() > SEARCH_TTL_MS) return null;
    return data.results as VisualCandidate[];
  } catch {
    return null;
  }
}

export async function storeSearch(query: string, results: VisualCandidate[]): Promise<void> {
  if (!results.length) return;
  try {
    await supabase.from("yt_search_cache").upsert({ query, results, created_at: new Date().toISOString() });
  } catch {
    // sin cache
  }
}

export function shotCacheKey(parts: (string | number | undefined | null)[]): string {
  const norm = parts.map((p) => String(p ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim());
  return createHash("sha1").update([SHOT_CACHE_VERSION, ...norm].join("::")).digest("hex");
}

export async function cachedShot(key: string): Promise<{ candidate: VisualCandidate; reason: string | null; source: string | null } | null> {
  try {
    const { data } = await supabase.from("shot_cache").select("candidate, reason, source, created_at").eq("key", key).maybeSingle();
    if (!data || Date.now() - new Date(data.created_at as string).getTime() > SHOT_TTL_MS) return null;
    return { candidate: data.candidate as VisualCandidate, reason: (data.reason as string | null) ?? null, source: (data.source as string | null) ?? null };
  } catch {
    return null;
  }
}

export async function storeShot(key: string, candidate: VisualCandidate, reason: string | undefined, source: string): Promise<void> {
  // Solo material propio y estable: un archivo en R2 o una fuente con URL fija
  // (nunca un tramo local ni un fallo).
  if (!/^https?:\/\//.test(candidate.url)) return;
  try {
    await supabase.from("shot_cache").upsert({ key, candidate, reason: reason ?? null, source, created_at: new Date().toISOString() });
  } catch {
    // sin cache
  }
}

// El QA final rechazo ese material: no vuelve a salir de la cache.
export async function forgetShot(key: string): Promise<void> {
  try {
    await supabase.from("shot_cache").delete().eq("key", key);
  } catch {
    // sin cache
  }
}
