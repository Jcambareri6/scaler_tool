// BIBLIOTECA DEL VIDEO: el material de YouTube se busca y se escanea UNA vez
// para todo el documental, no plano por plano.
//
// Antes cada plano buscaba, armaba hojas de 16 cuadros de sus videos (aunque
// otro plano ya hubiera escaneado el mismo video) y el juez rechazaba 10 a 20
// candidatos. Ahora:
//   1. se juntan los videos que aparecen en las busquedas de TODOS los planos
//      (primero los que aparecen en varias y nombran el lugar);
//   2. cada video se escanea una sola vez (hoja de 16 cuadros);
//   3. el juez describe cada cuadro en pocas palabras y marca si sirve (sin
//      gente a camara, sin texto encima, del lugar correcto);
//   4. cada plano recibe los videos cuyos cuadros describen lo que dice su
//      frase, con la hoja ya armada: el juez solo confirma.
// Si la biblioteca no tiene nada para una frase, el plano busca como antes.

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { VisualCandidate } from "./documentalSources.js";
import { rankYouTube, searchYouTubeVideos, youtubeContactSheet } from "./youtubeSource.js";
import { frenoYoutube } from "./youtubeGuard.js";
import { mapWithConcurrency } from "./concurrency.js";
import { envInt } from "./env.js";
import { claudeJudge, type LogoCorner } from "../director/visualJudge.js";

export interface LibraryFrame {
  t: number;
  desc: string;
  ok: boolean;
}

export interface LibraryVideo {
  candidate: VisualCandidate;
  frames: LibraryFrame[];
  logoCorner?: LogoCorner;
  sheetPath: string;
}

const LIB_MIN_VIDEOS = envInt("DOCUMENTAL_LIB_MIN", 12);
const LIB_MAX_VIDEOS = envInt("DOCUMENTAL_LIB_MAX", 30);
const VIDEOS_PER_CALL = 2;
const INDEX_PARALLEL = 4;

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(["para", "como", "pero", "este", "esta", "esto", "unos", "unas", "sobre", "desde", "hasta", "entre", "donde", "cuando", "with", "from", "that", "this", "into", "over"]);
// Raiz corta: "rocas"/"roca", "montana"/"montanas", "aerea"/"aereo".
const stem = (w: string) => w.replace(/(es|s)$/, "").slice(0, 6);
export function terms(text: string): string[] {
  return [...new Set(plain(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem))];
}

const INDEX_PROMPT = (topic: string, place: string, n: number) => `Te paso ${n} hojas de 16 cuadros (4x4, en orden de tiempo: de izquierda a derecha y de arriba abajo) de videos de YouTube, para un documental sobre: ${topic}. La historia pasa en: ${place || "(sin lugar)"}.

Para CADA video:
- "lugar_ok": true si el video es de ESE lugar (no de otro pais o region parecida).
- "marca": true si tiene una marca de agua de verdad (agencia de stock, logo o texto semitransparente encima, logo grande o en el centro).
- "logo_esquina": si lo unico es un logo CHICO de canal en una esquina: "tl", "tr", "bl" o "br"; si no, null.
- "cuadros": para CADA uno de los 16 cuadros:
  - "ok": false si alguien mira, posa o habla a camara (vlogger, selfie, presentador), si hay texto o titulos grandes encima, si es animacion, CGI o videojuego, o si esta negro, borroso o es una pantalla de titulo. Si no, true.
  - "d": que muestra, en 4 a 10 palabras en castellano, CONCRETAS: el lugar, el objeto, la accion y el tipo de toma ("toma aerea del salar con camionetas", "locomotora oxidada en el desierto").

Responde SOLO JSON: {"videos": [{"i": 1, "lugar_ok": true, "marca": false, "logo_esquina": null, "cuadros": [{"n": 1, "ok": true, "d": "..."}]}]}`;

function jsonOf(text: string): { videos?: Record<string, unknown>[] } | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1)) as { videos?: Record<string, unknown>[] };
  } catch {
    return null;
  }
}

export async function buildLibrary(opts: {
  client: Anthropic;
  model: string;
  usage: Record<string, number>;
  workDir: string;
  queries: string[];
  topic: string;
  place: string;
  shots: number;
}): Promise<LibraryVideo[]> {
  if (frenoYoutube.abierto()) return [];
  const dir = path.join(opts.workDir, "biblioteca");
  await mkdir(dir, { recursive: true });

  // 1. Todas las busquedas (en cache o en curso por la busqueda adelantada).
  const placeName = opts.place.split(",")[0]?.trim() ?? "";
  const queries = [...new Set([...opts.queries, ...(placeName ? [`${placeName} drone`, `${placeName} documental`] : [])].map((q) => q.trim()).filter(Boolean))];
  const results = await Promise.all(queries.map((q) => searchYouTubeVideos(q).catch(() => [] as VisualCandidate[])));
  const seen = new Map<string, { c: VisualCandidate; hits: number }>();
  for (const list of results) for (const c of list) {
    const e = seen.get(c.external_id);
    if (e) e.hits += 1;
    else seen.set(c.external_id, { c, hits: 1 });
  }
  // Primero los que aparecen en varias busquedas; a igual cantidad, el puntaje por titulo.
  const ranked = rankYouTube([...seen.values()].map((e) => ({ ...e.c, hits: e.hits })), `${placeName} ${opts.topic}`).sort((a, b) => b.hits - a.hits);
  const want = Math.min(LIB_MAX_VIDEOS, Math.max(LIB_MIN_VIDEOS, Math.round(opts.shots / 2)));
  const picked = ranked.slice(0, want);
  if (picked.length === 0) return [];

  // 2. Una hoja de 16 cuadros por video, una sola vez.
  const sheets = await mapWithConcurrency(picked, 6, async (c, k) => {
    const sheet = await youtubeContactSheet(c, dir, `lib-${k}`).catch(() => null);
    return sheet ? { c, sheet } : null;
  });
  const ready = sheets.filter((s): s is { c: VisualCandidate & { hits: number }; sheet: { path: string; times: number[] } } => s !== null);

  // 3. El juez describe cada cuadro (de a 2 videos por llamada, en paralelo).
  const groups: (typeof ready)[] = [];
  for (let i = 0; i < ready.length; i += VIDEOS_PER_CALL) groups.push(ready.slice(i, i + VIDEOS_PER_CALL));
  const library: LibraryVideo[] = [];
  const { readFile } = await import("node:fs/promises");
  await mapWithConcurrency(groups, INDEX_PARALLEL, async (group) => {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const [k, g] of group.entries()) {
      content.push({ type: "text", text: `Video ${k + 1}: "${(g.c.title ?? "").slice(0, 90)}"` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await readFile(g.sheet.path)).toString("base64") } });
    }
    content.push({ type: "text", text: INDEX_PROMPT(opts.topic, opts.place, group.length) });
    try {
      const message = await claudeJudge(opts.client, { model: opts.model, max_tokens: 9000, messages: [{ role: "user", content }] });
      opts.usage.biblioteca_input = (opts.usage.biblioteca_input ?? 0) + message.usage.input_tokens;
      opts.usage.biblioteca_output = (opts.usage.biblioteca_output ?? 0) + message.usage.output_tokens;
      const parsed = jsonOf(message.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
      for (const v of parsed?.videos ?? []) {
        const g = group[Number(v.i) - 1];
        if (!g || v.lugar_ok === false || v.marca === true) continue;
        const corner = ["tl", "tr", "bl", "br"].includes(String(v.logo_esquina)) ? (String(v.logo_esquina) as LogoCorner) : undefined;
        const frames: LibraryFrame[] = [];
        for (const f of (v.cuadros as Record<string, unknown>[] | undefined) ?? []) {
          const n = Number(f.n);
          const t = g.sheet.times[n - 1];
          if (!Number.isInteger(n) || t === undefined) continue;
          frames.push({ t, desc: String(f.d ?? "").slice(0, 120), ok: f.ok === true });
        }
        if (frames.some((f) => f.ok)) library.push({ candidate: { ...g.c, sheet_times: g.sheet.times }, frames, ...(corner ? { logoCorner: corner } : {}), sheetPath: g.sheet.path });
      }
    } catch (err) {
      console.warn(`[biblioteca] no se pudo indexar una tanda: ${(err as Error).message.slice(0, 160)}`);
    }
  });
  return library;
}

// Los videos de la biblioteca cuyos cuadros (aptos) describen lo que dice el
// plano, mejor puntaje primero. Cada candidato lleva su hoja ya armada.
export function libraryCandidates(
  library: LibraryVideo[],
  text: string,
  exclude: (c: VisualCandidate) => boolean,
  max = 3
): VisualCandidate[] {
  const want = terms(text);
  if (want.length === 0) return [];
  const scored = library
    .filter((v) => !exclude(v.candidate))
    .map((v) => {
      const best = Math.max(0, ...v.frames.filter((f) => f.ok).map((f) => terms(f.desc).filter((w) => want.includes(w)).length));
      return { v, best };
    })
    .filter((x) => x.best > 0)
    .sort((a, b) => b.best - a.best);
  return scored.slice(0, max).map(({ v }) => ({ ...v.candidate, sheet_path: v.sheetPath, ...(v.logoCorner ? { logo_corner: v.logoCorner } : {}) }));
}

// Copia la hoja ya armada al lugar donde la espera el juez (que borra su copia).
export async function useLibrarySheet(sheetPath: string, out: string): Promise<boolean> {
  return copyFile(sheetPath, out).then(() => true).catch(() => false);
}
