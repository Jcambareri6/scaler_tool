import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
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
  const raw = await run(YTDLP, [`ytsearch${SEARCH_RESULTS}:${query}`, "--flat-playlist", "-J", "--no-warnings"], 45_000);
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
export async function downloadYouTubeSegment(candidate: VisualCandidate, seconds: number, workDir: string, startFraction = 0.3): Promise<string> {
  const total = candidate.video_seconds ?? candidate.duration_seconds ?? 120;
  const needed = Math.min(Math.max(seconds, 2.5), 12);
  // Ventana mas larga que el plano (MaV: plano + 25% + 6 s) para encontrar
  // adentro un tramo sin cortes de plano.
  const length = Math.min(needed * 1.25 + 6, 24);
  // Nunca el principio del video (intro, logos): 6% con minimo 10 s y maximo 30 s.
  const intro = Math.min(30, Math.max(10, total * 0.06));
  const start = Math.max(intro, Math.min(total * startFraction, total - length - 2));
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
  await runCapture(
    ffmpegPath,
    ["-y", "-hide_banner", "-loglevel", "error", "-ss", from.toFixed(2), "-i", raw, "-t", take.toFixed(2), "-an",
      ...(slow > 1 ? ["-vf", `setpts=${slow.toFixed(3)}*PTS`] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    120_000
  );
  const info = await stat(out);
  if (info.size < 30_000) throw new Error("el tramo limpio quedo vacio");
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
