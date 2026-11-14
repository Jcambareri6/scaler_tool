import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { uploadPublicFile } from "../lib/storage.js";
import { WIKIMEDIA_UA } from "../lib/documentalSources.js";

// QA final del documental (como MaV, qaPlan.js), sin modelo:
// - medidas de cada plano: brillo medio < 22 = "oscuro", variacion < 5 = "vacio";
// - hoja de contactos: 6 columnas, un cuadro por plano con su numero, clase y
//   origen, borde rojo en los que conviene revisar. Se sube a R2 y se muestra
//   en el resumen del documental.

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

export const DARK_LUMA = 22;
export const FLAT_RANGE = 5;
const TILE_W = 320;
const TILE_H = 180;
const COLS = 6;

function ffmpeg(args: string[], timeoutMs = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static no resolvio el binario"));
    const proc = spawn(ffmpegPath, ["-hide_banner", ...args], { windowsHide: true });
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg tardo mas de ${timeoutMs / 1000} s`));
    }, timeoutMs);
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`));
    });
  });
}

// Un cuadro chico del plano (el del 1,5 s en video) en un jpg local.
export async function grabFrame(url: string, type: "VIDEO" | "IMAGE", out: string): Promise<string> {
  const remote = /^https?:\/\//.test(url);
  await ffmpeg([
    "-y",
    "-loglevel",
    "error",
    ...(remote ? ["-user_agent", WIKIMEDIA_UA, "-rw_timeout", "15000000"] : []),
    ...(type === "VIDEO" ? ["-ss", "1.5"] : []),
    "-i",
    url,
    "-frames:v",
    "1",
    "-vf",
    `scale=${TILE_W}:${TILE_H}:force_original_aspect_ratio=decrease`,
    "-q:v",
    "4",
    out,
  ]);
  return out;
}

// Brillo medio y variacion (rango entre el 10% y el 90% de luma) del cuadro.
export async function frameStats(framePath: string): Promise<{ luma: number; range: number } | null> {
  const log = await ffmpeg(["-i", framePath, "-vf", "signalstats,metadata=print", "-f", "null", "-"], 20_000).catch(() => "");
  const num = (key: string) => Number(log.match(new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`))?.[1]);
  const luma = num("YAVG");
  const low = num("YLOW");
  const high = num("YHIGH");
  if (!Number.isFinite(luma)) return null;
  return { luma, range: Number.isFinite(low) && Number.isFinite(high) ? high - low : 255 };
}

export function qaCode(stats: { luma: number; range: number } | null): "oscuro" | "vacio" | null {
  if (!stats) return null;
  if (stats.luma < DARK_LUMA) return "oscuro";
  if (stats.range < FLAT_RANGE) return "vacio";
  return null;
}

function fontFile(): string | null {
  const candidates = [
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Bold.ttf",
    "/usr/share/fonts/truetype/roboto/Roboto-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ];
  return candidates.find((f) => existsSync(f)) ?? null;
}

export interface SheetTile {
  frame: string | null;
  label: string;
  flagged: boolean;
}

// Hoja de contactos: un mosaico por plano + grilla de COLS columnas.
export async function contactSheet(tiles: SheetTile[], workDir: string, projectId: string): Promise<string | null> {
  if (!tiles.length) return null;
  const font = fontFile();
  const fontArg = font ? `fontfile='${font.replace(/:/g, "\\:")}':` : "";
  const tilePaths: string[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    const out = path.join(workDir, `tile-${String(i).padStart(3, "0")}.jpg`);
    const label = t.label.replace(/['":\\%,;]/g, " ").slice(0, 40);
    const border = t.flagged ? `,drawbox=x=0:y=0:w=iw:h=ih:color=red:t=6` : "";
    const text = font ? `,drawbox=x=0:y=ih-26:w=iw:h=26:color=black@0.7:t=fill,drawtext=${fontArg}text='${label}':x=6:y=h-21:fontsize=15:fontcolor=white` : "";
    const input = t.frame ? ["-i", t.frame] : ["-f", "lavfi", "-i", `color=c=0x444444:s=${TILE_W}x${TILE_H}`];
    try {
      await ffmpeg([
        "-y",
        "-loglevel",
        "error",
        ...input,
        "-frames:v",
        "1",
        "-vf",
        `scale=${TILE_W}:${TILE_H}:force_original_aspect_ratio=decrease,pad=${TILE_W}:${TILE_H}:(ow-iw)/2:(oh-ih)/2${border}${text}`,
        out,
      ], 20_000);
      tilePaths.push(out);
    } catch {
      // mosaico sin cuadro: se saltea
    }
  }
  if (!tilePaths.length) return null;
  const layout = tilePaths.map((_, k) => `${(k % COLS) * (TILE_W + 4)}_${Math.floor(k / COLS) * (TILE_H + 4)}`).join("|");
  const sheet = path.join(workDir, "hoja.jpg");
  if (tilePaths.length === 1) return uploadPublicFile({ bucket: "scene-uploads", r2Prefix: "skaler-media", path: `${projectId}/hoja-${Date.now()}.jpg`, contentType: "image/jpeg", body: tilePaths[0]! });
  await ffmpeg(
    ["-y", "-loglevel", "error", ...tilePaths.flatMap((p) => ["-i", p]), "-filter_complex", `xstack=inputs=${tilePaths.length}:layout=${layout}:fill=white`, "-frames:v", "1", "-q:v", "5", sheet],
    120_000
  );
  return uploadPublicFile({ bucket: "scene-uploads", r2Prefix: "skaler-media", path: `${projectId}/hoja-${Date.now()}.jpg`, contentType: "image/jpeg", body: sheet });
}
