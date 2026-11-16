import { spawn } from "node:child_process";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { uploadPublicFile } from "./storage.js";
import type { VisualCandidate } from "./documentalSources.js";

// METRAJE DE YOUTUBE (como MaV, youtubePlano.js): busqueda con yt-dlp, el
// juez elige por miniatura + titulo, y recien ahi se baja SOLO un tramo del
// video (sin audio), se revisa con cuadros reales y se sube a R2.
//
// RIESGO LEGAL: es material con copyright y sin licencia verificada. Queda
// APAGADO salvo DOCUMENTAL_YOUTUBE=on (local, para probar). No habilitar en
// produccion sin resolver el tema de derechos.

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

const YTDLP = process.env.YTDLP_PATH?.trim() || "yt-dlp";
// YouTube bloquea las IPs de datacenter (el worker de Hetzner): con un proxy
// residencial (ej: http://usuario:clave@pr.oxylabs.io:7777) la busqueda y la
// descarga salen por IPs de hogares. Sin la variable, conexion directa.
function proxyArgs(): string[] {
  const proxy = process.env.YTDLP_PROXY?.trim();
  return proxy ? ["--proxy", proxy] : [];
}
const SEARCH_RESULTS = 8;
const MAX_VIDEO_SECONDS = 3 * 60 * 60;
const MIN_VIDEO_SECONDS = 20;

// Lo que MaV descarta por titulo: reacciones, recopilaciones, podcasts,
// shorts, directos, gameplay, memes, "stock footage" y videos hechos con IA.
// Mas peliculas, ficcion, simulaciones y videos de fans: en la prueba del
// Titanic entraron escenas de la pelicula de 1997 y un simulador.
export const BLOCKED_TITLE =
  /\b(react(ion|s|ing)?|reaccion|compilation|recopilaci[oó]n|podcast|#?shorts?|live|en vivo|directo|stream|gameplay|let'?s play|meme|stock footage|ai generated|generad[oa] con ia|midjourney|sora|tiktok|movie|film scene|scene|escena|trailer|tr[aá]iler|1997|cameron|dicaprio|winslet|hollywood|pel[ií]cula|series|episode|cgi|3d|animation|animated|animaci[oó]n|cartoon|simulat\w*|simulador|sandbox|game|juego|roblox|minecraft|remix|music video|amv|edit|fan ?made|tribute|lyrics|legend goes on)\b/i;

export function youtubeEnabled(): boolean {
  return process.env.DOCUMENTAL_YOUTUBE?.trim().toLowerCase() === "on";
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} tardo mas de ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    proc.stdout.on("data", (c) => (out += c.toString()));
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${code}: ${err.slice(-300)}`));
    });
  });
}

interface FlatEntry {
  id?: string;
  title?: string;
  duration?: number;
  channel?: string;
  uploader?: string;
  live_status?: string;
}

export async function searchYouTubeVideos(query: string): Promise<VisualCandidate[]> {
  const raw = await run(YTDLP, [`ytsearch${SEARCH_RESULTS}:${query}`, "--flat-playlist", "-J", "--no-warnings", ...proxyArgs()], 45_000);
  const entries = ((JSON.parse(raw) as { entries?: FlatEntry[] }).entries ?? []).filter(
    (e) =>
      e.id &&
      e.title &&
      !BLOCKED_TITLE.test(e.title) &&
      (e.live_status ?? "not_live") === "not_live" &&
      (e.duration ?? 0) >= MIN_VIDEO_SECONDS &&
      (e.duration ?? 0) <= MAX_VIDEO_SECONDS
  );
  return entries.slice(0, 4).map((e) => ({
    provider: "youtube",
    external_id: e.id!,
    type: "VIDEO" as const,
    url: `https://www.youtube.com/watch?v=${e.id}`,
    thumb_url: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
    duration_seconds: e.duration!,
    video_seconds: e.duration!,
    title: e.title!,
    ...(e.channel || e.uploader ? { author: (e.channel ?? e.uploader)!.slice(0, 120) } : {}),
    license: "YouTube (sin licencia verificada)",
    source_page: `https://www.youtube.com/watch?v=${e.id}`,
    query,
  }));
}

// Baja un tramo del video (sin audio, <=720p) a workDir. Por defecto arranca
// pasado el 30% para saltear presentaciones y cortinas de apertura; el
// rescate pide otros momentos del mismo video (startFraction).
export async function downloadYouTubeSegment(candidate: VisualCandidate, seconds: number, workDir: string, startFraction = 0.3, startSeconds?: number): Promise<string> {
  const total = candidate.video_seconds ?? candidate.duration_seconds ?? 120;
  const needed = Math.min(Math.max(seconds, 2.5), 12);
  // Ventana mas larga que el plano (MaV: plano + 25% + 6 s) para encontrar
  // adentro un tramo sin cortes de plano.
  const length = Math.min(needed * 1.25 + 6, 24);
  // Nunca el principio del video (intro, logos): 6% con minimo 10 s y maximo 30 s.
  const intro = Math.min(30, Math.max(10, total * 0.06));
  // Momento de los subtitulos (subtitleMoments) o una fraccion del video.
  const wanted = startSeconds !== undefined ? startSeconds - 2 : total * startFraction;
  const start = Math.max(intro, Math.min(wanted, total - length - 2));
  const raw = path.join(workDir, `yt-${candidate.external_id}-${Math.round(start)}-raw.mp4`);
  const out = path.join(workDir, `yt-${candidate.external_id}-${Math.round(start)}.mp4`);
  await downloadSection(candidate.url, start, length, raw);
  await cleanSegment(raw, needed, out);
  await rm(raw, { force: true }).catch(() => undefined);
  return out;
}

// Tramo limpio (MaV, youtubePlano.tramoLimpio): cortes de plano con
// select='gt(scene,0.22)' y fundidos a negro con blackdetect; se usa el tramo
// sin cortes que contiene el centro de la ventana (o el mas largo). Si queda
// corto se ralentiza hasta 0,5x; nunca se repite ni se congela.
async function cleanSegment(raw: string, needed: number, out: string): Promise<void> {
  if (!ffmpegPath) throw new Error("ffmpeg-static no resolvio el binario");
  const probe = await runCapture(ffmpegPath, ["-hide_banner", "-i", raw, "-an", "-vf", "blackdetect=d=0.03:pix_th=0.10,select='gt(scene,0.22)',showinfo", "-f", "null", "-"], 90_000);
  // Imagen quieta (MaV: freezedetect) y barras negras (cropdetect), en otra pasada.
  const still = await runCapture(ffmpegPath, ["-hide_banner", "-i", raw, "-an", "-vf", "freezedetect=n=0.003:d=0.5,cropdetect=limit=40:round=2:reset=1", "-f", "null", "-"], 90_000).catch(() => "");
  const dur = Number(probe.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)?.slice(1).reduce((acc, v, i) => acc + Number(v) * [3600, 60, 1][i]!, 0) ?? 0);
  if (!dur) throw new Error("no se pudo leer la duracion del tramo");
  const cuts = [...probe.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const blacks = [...probe.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const MARGIN = 0.15;
  // Limites: inicio, cortes, bordes de los negros, fin.
  const bounds = [0, ...cuts, ...blacks.flat(), dur].sort((a, b) => a - b);
  const pieces: { a: number; b: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i]! + (i === 0 ? 0 : MARGIN);
    const b = bounds[i + 1]! - (i + 1 === bounds.length - 1 ? 0 : MARGIN);
    const inBlack = blacks.some(([s, e]) => a >= s - 0.01 && b <= e + 0.01);
    if (b - a > 0.5 && !inBlack) pieces.push({ a, b });
  }
  const center = dur / 2;
  const usable = pieces.filter((p) => p.b - p.a >= needed * 0.5);
  const pick = usable.find((p) => p.a <= center && center <= p.b && p.b - p.a >= needed) ?? usable.sort((x, y) => y.b - y.a - (x.b - x.a))[0];
  if (!pick) throw new Error("sin tramo limpio (demasiados cortes de plano)");
  const len = pick.b - pick.a;
  const take = Math.min(len, needed);
  const from = len > needed ? Math.max(pick.a, Math.min(center - needed / 2, pick.b - needed)) : pick.a;
  const slow = take < needed ? Math.min(2, needed / take) : 1; // 0,5x como minimo
  if (frozenShare(still, from, from + take, dur) > 0.8) throw new Error("el tramo es una imagen fija (mas del 80 % quieto)");
  const crop = barsCrop(still);
  const filters = [...(crop ? [crop] : []), ...(slow > 1 ? [`setpts=${slow.toFixed(3)}*PTS`] : [])];
  await runCapture(
    ffmpegPath,
    ["-y", "-hide_banner", "-loglevel", "error", "-ss", from.toFixed(2), "-i", raw, "-t", take.toFixed(2), "-an",
      ...(filters.length ? ["-vf", filters.join(",")] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    120_000
  );
  const info = await stat(out);
  if (info.size < 30_000) throw new Error("el tramo limpio quedo vacio");
}

// ---------- Momento guiado por subtitulos (MaV: youtubePlano, yt:281-308) ----------

export interface Cue {
  start: number;
  text: string;
}

const STOPWORDS = new Set(["para", "como", "pero", "este", "esta", "esto", "estos", "estas", "desde", "entre", "sobre", "donde", "cuando", "with", "from", "that", "this", "their", "there", "which", "about", "into", "the", "and"]);

function normWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

// Palabras clave del plano para buscar en los subtitulos.
export function subtitleKeywords(parts: (string | undefined)[]): string[] {
  return [...new Set(parts.flatMap((p) => (p ? normWords(p) : [])))].slice(0, 8);
}

// Lee un .vtt: tiempo de inicio y texto de cada cue (sin etiquetas).
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const m = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->/.exec(block);
    if (!m) continue;
    const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const text = block
      .split(/\r?\n/)
      .filter((l) => !l.includes("-->") && !/^\d+$/.test(l.trim()))
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) cues.push({ start, text });
  }
  return cues;
}

// Ventanas de 12 s que abre cada palabra clave, puntuadas por cuantas caen
// adentro; separadas al menos 20 s, nada antes de los 8 s, como mucho 2.
export function momentsFromCues(cues: Cue[], keywords: string[]): number[] {
  if (keywords.length === 0) return [];
  const hits = cues.filter((c) => normWords(c.text).some((w) => keywords.includes(w))).map((c) => c.start);
  const windows = hits
    .filter((t) => t >= 8)
    .map((t) => ({ t, score: hits.filter((h) => h >= t && h <= t + 12).length }))
    .sort((a, b) => b.score - a.score || a.t - b.t);
  const out: number[] = [];
  for (const w of windows) {
    if (out.every((t) => Math.abs(t - w.t) >= 20)) out.push(w.t);
    if (out.length === 2) break;
  }
  return out;
}

// Subtitulos del video (manuales o automaticos, es/en) sin bajar el video.
// hasSubs = false si no hay: el que llama usa una fraccion del video.
export async function subtitleMoments(candidate: VisualCandidate, keywords: string[], workDir: string): Promise<{ hasSubs: boolean; moments: number[] }> {
  const base = path.join(workDir, `subs-${candidate.external_id}`);
  // Los originales primero: la traduccion automatica ("es" de un video en
  // ingles) es la que mas 429 da. Con --ignore-errors sigue si falla uno, y
  // aunque yt-dlp termine con error se lee lo que haya bajado.
  await run(
    YTDLP,
    [candidate.url, "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en-orig,es-orig,en,es", "--sub-format", "vtt", "--ignore-errors", "--no-warnings", "--no-playlist", ...proxyArgs(), "-o", `${base}.%(ext)s`],
    60_000
  ).catch(() => undefined);
  const files = (await readdir(workDir)).filter((f) => f.startsWith(path.basename(base)) && f.endsWith(".vtt"));
  if (files.length === 0) return { hasSubs: false, moments: [] };
  const cues = (await Promise.all(files.map((f) => readFile(path.join(workDir, f), "utf-8").catch(() => "")))).flatMap(parseVtt);
  await Promise.all(files.map((f) => rm(path.join(workDir, f), { force: true }).catch(() => undefined)));
  return { hasSubs: cues.length > 0, moments: momentsFromCues(cues, keywords) };
}

// Fraccion de [a, b] con la imagen quieta (lineas lavfi.freezedetect).
export function frozenShare(log: string, a: number, b: number, dur: number): number {
  const starts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  let frozen = 0;
  starts.forEach((s, i) => {
    const e = ends[i] ?? dur;
    frozen += Math.max(0, Math.min(b, e) - Math.max(a, s));
  });
  return b > a ? frozen / (b - a) : 0;
}

// Recorte de barras negras (MaV): el crop=w:h:x:y que mas se repite, solo si
// aparece en >= 60 % de los cuadros, recorta >= 3 % y deja >= 40 % de ancho y alto.
export function barsCrop(log: string): string | null {
  const size = /, (\d{2,5})x(\d{2,5})[, ]/.exec(log);
  const crops = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => m.slice(1, 5).map(Number) as [number, number, number, number]);
  if (!size || crops.length < 5) return null;
  const W = Number(size[1]);
  const H = Number(size[2]);
  const counts = new Map<string, number>();
  for (const c of crops) counts.set(c.join(":"), (counts.get(c.join(":")) ?? 0) + 1);
  const [best, n] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]!;
  if (n / crops.length < 0.6) return null;
  const [w, h] = best.split(":").map(Number) as [number, number];
  const removed = 1 - (w * h) / (W * H);
  if (removed < 0.03 || w < W * 0.4 || h < H * 0.4) return null;
  return `crop=${best}`;
}

function runCapture(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${path.basename(cmd)} tardo mas de ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`${path.basename(cmd)} ${code}: ${err.slice(-300)}`));
    });
  });
}

async function downloadSection(url: string, start: number, length: number, out: string): Promise<void> {
  await run(
    YTDLP,
    [
      url,
      "-f",
      "bv*[height<=720][ext=mp4]/bv*[height<=720]",
      "--download-sections",
      `*${start.toFixed(1)}-${(start + length).toFixed(1)}`,
      "--force-keyframes-at-cuts",
      "--remux-video",
      "mp4",
      ...(ffmpegPath ? ["--ffmpeg-location", ffmpegPath] : []),
      "--no-warnings",
      "--no-playlist",
      ...proxyArgs(),
      "-o",
      out,
    ],
    180_000
  );
  const info = await stat(out);
  if (info.size < 50_000) throw new Error("el tramo bajado esta vacio");
}

export async function uploadYouTubeSegment(localPath: string, candidate: VisualCandidate, projectId: string): Promise<string> {
  return uploadPublicFile({
    bucket: "scene-uploads",
    r2Prefix: "skaler-media",
    path: `${projectId}/youtube-${candidate.external_id}-${Date.now()}.mp4`,
    contentType: "video/mp4",
    body: localPath,
  });
}
