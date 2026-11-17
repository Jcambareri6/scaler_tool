import { spawn } from "node:child_process";
import { ffmpegForNetwork } from "./ffmpegBin.js";

// HUELLA VISUAL (dHash, como rellenarPlan.js de MaV): dos fuentes distintas
// suelen traer la MISMA foto (Commons y Openverse, o un clip de stock subido
// a dos sitios) y el filtro por URL no la ve. Cada cuadro se reduce a 9x8 y
// 8x9 grises: 64 bits horizontales + 64 verticales = 128 bits.
// Calibracion de MaV: mismo plano en dos momentos del mismo video 16-19,
// planos distintos del mismo clip 28+, clips distintos 55+. Umbral 22.

// ffmpeg que puede leer de la red (en el worker, el de Debian: ver lib/ffmpegBin.ts).
const ffmpegPath = ffmpegForNetwork;

export const HASH_THRESHOLD = 22;
// Por debajo de esta desviacion el cuadro es casi liso (negro, cielo): su
// hash coincidiria con cualquier otro liso, asi que no se guarda.
const FLAT_STDDEV = 12;
const TIMEOUT_MS = 45_000;

export interface Huella {
  // Un hash de 128 bits (dos bigint de 64) por cuadro util.
  frames: { h: bigint; v: bigint }[];
}

function grayPixels(input: string, w: number, h: number, seek?: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static no resolvio el binario"));
    const remote = /^https?:\/\//.test(input);
    const args = [
      ...(remote ? ["-rw_timeout", "15000000"] : []),
      ...(seek !== undefined ? ["-ss", seek.toFixed(2)] : []),
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      `scale=${w}:${h}:flags=area,format=gray`,
      "-f",
      "rawvideo",
      "-",
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg tardo demasiado (huella)"));
    }, TIMEOUT_MS);
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      if (code === 0 && out.length >= w * h) resolve(out.subarray(0, w * h));
      else reject(new Error(`ffmpeg ${code} (huella)`));
    });
  });
}

function stddev(px: Buffer): number {
  let sum = 0;
  for (const p of px) sum += p;
  const mean = sum / px.length;
  let acc = 0;
  for (const p of px) acc += (p - mean) ** 2;
  return Math.sqrt(acc / px.length);
}

// dHash horizontal: 9x8, cada pixel contra el de su derecha.
export function dhashH(px: Buffer): bigint {
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
  return bits;
}

// dHash vertical: 8x9, cada pixel contra el de abajo.
export function dhashV(px: Buffer): bigint {
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 8 + x]! > px[(y + 1) * 8 + x]! ? 1n : 0n);
  return bits;
}

function popcount(n: bigint): number {
  let count = 0;
  while (n) {
    count += Number(n & 1n);
    n >>= 1n;
  }
  return count;
}

export function distance(a: { h: bigint; v: bigint }, b: { h: bigint; v: bigint }): number {
  return popcount(a.h ^ b.h) + popcount(a.v ^ b.v);
}

async function frameHash(input: string, seek?: number): Promise<{ h: bigint; v: bigint } | null> {
  const flat = await grayPixels(input, 16, 16, seek);
  if (stddev(flat) < FLAT_STDDEV) return null;
  const [h, v] = await Promise.all([grayPixels(input, 9, 8, seek), grayPixels(input, 8, 9, seek)]);
  return { h: dhashH(h), v: dhashV(v) };
}

// Huella de un visual: la imagen, o 3 cuadros de un clip (20, 50 y 80 %).
// Si falla (CDN caido, formato raro) devuelve null: el visual pasa igual.
export async function fingerprint(url: string, type: "VIDEO" | "IMAGE", durationSeconds?: number): Promise<Huella | null> {
  try {
    const seeks = type === "VIDEO" ? [0.2, 0.5, 0.8].map((f) => f * Math.max(1, durationSeconds ?? 6)) : [undefined];
    const frames = (await Promise.all(seeks.map((s) => frameHash(url, s).catch(() => null)))).filter((f): f is { h: bigint; v: bigint } => !!f);
    return { frames };
  } catch {
    return null;
  }
}

// Dos visuales son el mismo si algun par de cuadros queda a <= umbral.
export function sameVisual(a: Huella, b: Huella, threshold = HASH_THRESHOLD): boolean {
  return a.frames.some((fa) => b.frames.some((fb) => distance(fa, fb) <= threshold));
}

// Registro de lo ya aceptado en el video. `claim` es sincronico despues de
// calcular la huella, asi dos planos en paralelo no aceptan la misma imagen.
export class HuellaRegistry {
  private readonly accepted: { key: string; huella: Huella }[] = [];

  duplicateOf(huella: Huella | null): string | null {
    if (!huella?.frames.length) return null;
    return this.accepted.find((a) => sameVisual(a.huella, huella))?.key ?? null;
  }

  // Devuelve la clave del visual repetido, o null si se acepto.
  claim(key: string, huella: Huella | null): string | null {
    const dup = this.duplicateOf(huella);
    if (dup) return dup;
    if (huella?.frames.length) this.accepted.push({ key, huella });
    return null;
  }

  release(key: string): void {
    const i = this.accepted.findIndex((a) => a.key === key);
    if (i >= 0) this.accepted.splice(i, 1);
  }
}
