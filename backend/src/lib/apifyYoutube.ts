import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { envInt } from "./env.js";
import { Semaforo, limpiar } from "./youtubeGuard.js";

// YOUTUBE POR APIFY: YouTube bloquea las IPs de datacenter (el worker de
// Hetzner) y el proxy residencial cobra por GB (5-40 USD por documental de
// 20 min). El actor coder2077/youtube-video-downloader de Apify resuelve el
// bloqueo de su lado y cobra por video (1,69 USD cada 1.000, sin importar la
// duracion; los fallos no se cobran). Devuelve un enlace al video ENTERO que
// dura 5 minutos y se abre hasta 3 veces. La hoja de cuadros lo baja entero a
// un archivo local (16 momentos = demasiadas aperturas del enlace); un tramo
// suelto se lee desde el enlace hasta el final del tramo (apifyLink) y, si
// eso falla, del video entero. Prueba del 20/11/2026 desde el worker: 24/25 videos
// reales de los pilotos, 2-39 s cada uno.
//
// Token y config en la tabla providers (slug "apify", type
// "youtube_download"; configuration.actor y configuration.format). Apagarlo
// = is_active false. Si falla, el que llama sigue por el camino de siempre
// (proxy o directo).

const DEFAULT_ACTOR = "coder2077~youtube-video-downloader";
const CACHE_DIR = path.join(os.tmpdir(), "skaler-apify-yt");
// Tope del cache en disco: un video de 720p pesa 20-600 MB.
const CACHE_MAX_BYTES = envInt("APIFY_YT_CACHE_MB", 6000) * 1024 * 1024;
// Plan gratis de Apify: 5 corridas a la vez como maximo.
const apifySlots = new Semaforo(envInt("APIFY_YT_PARALELO", 4), "apify");
// Videos de mas de 10 min en 480p (antes 30): en el piloto bajaban 340-600 MB
// en 720p para usar 6 segundos de plano.
const LONG_VIDEO_SECONDS = 10 * 60;
// La descarga se corta si no llega NADA en este tiempo (no por duracion
// total: con 5 min fijos se perdian videos grandes que venian bien), con un
// tope de 20 min por video.
const STALL_MS = 45_000;
const MAX_DOWNLOAD_MS = 20 * 60_000;

type ApifyConfig = { token: string; actor: string; format: string };

// La fila del proveedor se lee una vez cada 5 minutos (no en cada video).
let config: { value: ApifyConfig | null; at: number } | null = null;
export async function apifyConfig(): Promise<ApifyConfig | null> {
  if (config && Date.now() - config.at < 5 * 60_000) return config.value;
  // Import diferido: asi youtubeSource no arrastra el cliente de Supabase al
  // cargarse (las pruebas sin red ni .env lo importan).
  const { getActiveProvider } = await import("./providers.js");
  const provider = await getActiveProvider("apify").catch(() => null);
  const conf = (provider?.configuration ?? {}) as { actor?: string; format?: string };
  const value = provider?.api_key?.trim()
    ? { token: provider.api_key.trim(), actor: conf.actor?.trim() || DEFAULT_ACTOR, format: conf.format?.trim() || "720p" }
    : null;
  config = { value, at: Date.now() };
  return value;
}

export async function apifyEnabled(): Promise<boolean> {
  return (await apifyConfig()) !== null;
}

function videoId(url: string): string | null {
  return /(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(url)?.[1] ?? null;
}

// Un archivo por video (lo comparten la hoja de cuadros y los tramos) y una
// sola descarga en vuelo por video.
const inFlight = new Map<string, Promise<string>>();
const lastUse = new Map<string, number>();

export function apifyVideoFile(url: string, durationSeconds?: number): Promise<string> {
  const id = videoId(url);
  if (!id) return Promise.reject(new Error("apify: no es un enlace de video de YouTube"));
  const cached = inFlight.get(id);
  if (cached) {
    lastUse.set(id, Date.now());
    return cached;
  }
  const job = apifySlots.con(async () => {
    const conf = await apifyConfig();
    if (!conf) throw new Error("apify: sin proveedor activo");
    const format = durationSeconds && durationSeconds > LONG_VIDEO_SECONDS ? "480p" : conf.format;
    return fetchVideo(id, format, conf);
  }).catch((err) => {
    inFlight.delete(id);
    throw err;
  });
  inFlight.set(id, job);
  lastUse.set(id, Date.now());
  return job;
}

// Video ya bajado entero (o bajandose) por la hoja de cuadros: el tramo sale
// de ese archivo, sin pedir nada mas a Apify.
export function apifyFileIfCached(url: string): Promise<string> | null {
  const id = videoId(url);
  const cached = id ? inFlight.get(id) : undefined;
  if (!cached) return null;
  lastUse.set(id!, Date.now());
  return cached;
}

// SOLO EL ENLACE, para leer un tramo sin bajar el video entero (en un video
// largo la descarga entera tardaba hasta 20 min, medicion del 25/11/2026).
// OJO: el enlace (fastsaver) NO acepta pedidos por rango (responde 200 sin
// accept-ranges ni tamano y un Range da 4xx): ffmpeg lo lee DE CORRIDO desde
// el principio y corta apenas termina el tramo (no baja lo que viene
// despues). Prueba: tramo del minuto 15 de un video de 25 min en 196 s
// contra 1238 s bajando el video entero.
// El enlace vence a los 5 min y se abre hasta 3 veces: se reusa para otros
// momentos del mismo video durante LINK_TTL_MS y como mucho LINK_MAX_USES
// veces; despues, uno nuevo. Mismo formato que la descarga entera (480p en
// videos largos): se lee todo lo anterior al tramo.
const LINK_TTL_MS = 4 * 60_000;
const LINK_MAX_USES = 2;
const links = new Map<string, { url: Promise<string>; at: number; uses: number }>();

export async function apifyLink(url: string, opts: { fresh?: boolean; durationSeconds?: number } = {}): Promise<{ link: string; reused: boolean }> {
  const id = videoId(url);
  if (!id) throw new Error("apify: no es un enlace de video de YouTube");
  const conf = await apifyConfig();
  if (!conf) throw new Error("apify: sin proveedor activo");
  const format = opts.durationSeconds && opts.durationSeconds > LONG_VIDEO_SECONDS ? "480p" : conf.format;
  const key = `${id}-${format}`;
  const entry = links.get(key);
  if (!opts.fresh && entry && Date.now() - entry.at < LINK_TTL_MS && entry.uses < LINK_MAX_USES) {
    entry.uses += 1;
    return { link: await entry.url, reused: true };
  }
  const fresh = { url: apifySlots.con(() => requestLink(id, format, conf)), at: Date.now(), uses: 1 };
  links.set(key, fresh);
  fresh.url.catch(() => {
    if (links.get(key) === fresh) links.delete(key);
  });
  return { link: await fresh.url, reused: false };
}

// El enlace fallo al leerlo (vencido, ya abierto 3 veces): no se reusa.
export function forgetApifyLink(url: string): void {
  const id = videoId(url);
  if (!id) return;
  for (const key of [...links.keys()]) if (key.startsWith(`${id}-`)) links.delete(key);
}

async function requestLink(id: string, format: string, conf: ApifyConfig): Promise<string> {
  const res = await fetch(`https://api.apify.com/v2/acts/${conf.actor}/run-sync-get-dataset-items?timeout=120`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${conf.token}` },
    body: JSON.stringify({ urls: [`https://www.youtube.com/watch?v=${id}`], format }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) throw new Error(`apify: HTTP ${res.status} ${limpiar((await res.text().catch(() => "")).slice(0, 200))}`);
  const items = (await res.json()) as { ok?: boolean; error?: string; download_url?: string }[];
  const item = items[0];
  if (!item?.download_url) throw new Error(`apify: sin enlace (${item?.error ?? "sin resultado"})`);
  return item.download_url;
}

async function fetchVideo(id: string, format: string, conf: ApifyConfig): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const item = { download_url: await requestLink(id, format, conf) };

  const file = path.join(CACHE_DIR, `${id}-${format}.mp4`);
  // Vigia de la descarga: aborta si pasan STALL_MS sin datos o MAX_DOWNLOAD_MS en total.
  const abort = new AbortController();
  let stall = setTimeout(() => abort.abort(new Error("apify: la descarga se trabo (45 s sin datos)")), STALL_MS);
  const total = setTimeout(() => abort.abort(new Error("apify: la descarga paso los 20 min")), MAX_DOWNLOAD_MS);
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => abort.abort(new Error("apify: la descarga se trabo (45 s sin datos)")), STALL_MS);
  };
  try {
    // El servidor de descarga a veces satura (429/5xx): hasta 3 intentos con pausa.
    let body: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      body = await fetch(item.download_url, { signal: abort.signal });
      alive();
      if (body.ok || ![429, 500, 502, 503, 504].includes(body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
    }
    if (!body?.ok || !body.body) throw new Error(`apify: descarga HTTP ${body?.status ?? "?"}`);
    const watched = new Transform({
      transform(chunk, _enc, done) {
        alive();
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(body.body as unknown as WebReadableStream), watched, createWriteStream(file), { signal: abort.signal });
    const size = (await stat(file)).size;
    if (size < 50_000) throw new Error("apify: el video bajado esta vacio");
  } catch (err) {
    await rm(file, { force: true }).catch(() => undefined);
    throw abort.signal.aborted && abort.signal.reason instanceof Error ? abort.signal.reason : err;
  } finally {
    clearTimeout(stall);
    clearTimeout(total);
  }
  void trimCache();
  return file;
}

// Borra los videos usados hace mas tiempo hasta quedar bajo el tope. Nunca
// uno usado en los ultimos 10 minutos (puede estar cortandose un tramo).
async function trimCache(): Promise<void> {
  const names = await readdir(CACHE_DIR).catch(() => [] as string[]);
  const files = await Promise.all(
    names.map(async (name) => {
      const full = path.join(CACHE_DIR, name);
      const info = await stat(full).catch(() => null);
      const id = name.slice(0, 11);
      return info ? { full, id, size: info.size, used: lastUse.get(id) ?? info.mtimeMs } : null;
    })
  );
  const list = files.filter((f): f is NonNullable<typeof f> => f !== null).sort((a, b) => a.used - b.used);
  let total = list.reduce((sum, f) => sum + f.size, 0);
  for (const f of list) {
    if (total <= CACHE_MAX_BYTES) break;
    if (Date.now() - f.used < 10 * 60_000) continue;
    await rm(f.full, { force: true }).catch(() => undefined);
    inFlight.delete(f.id);
    lastUse.delete(f.id);
    total -= f.size;
  }
}
