import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlacedOverlay } from "./overlayTiming.js";

// Puente con el paquete motion/ (Remotion): los graficos animados se
// renderizan en un proceso aparte (Chromium) y vuelven como clips con
// transparencia que render_video superpone en la pasada final.

const MOTION_DIR = process.env.MOTION_DIR ?? path.resolve(process.cwd(), "motion");
// Fundido de salida que hace ffmpeg (Remotion solo genera la entrada).
const EXIT_FADE_SECONDS = 0.4;

interface Catalog {
  fps: number;
  components: Record<string, { introSeconds: number }>;
}

let cachedCatalog: Catalog | null | undefined;

// Que componentes existen (motion/catalog.json). null si el paquete no
// esta instalado (ej. la API en Render sin el worker): sin graficos, el
// video se genera igual.
export function motionCatalog(): Catalog | null {
  if (cachedCatalog !== undefined) return cachedCatalog;
  const file = path.join(MOTION_DIR, "catalog.json");
  const installed = existsSync(file) && existsSync(path.join(MOTION_DIR, "node_modules"));
  cachedCatalog = installed ? (JSON.parse(readFileSync(file, "utf-8")) as Catalog) : null;
  return cachedCatalog;
}

export function supportedOverlayTypes(): string[] {
  return Object.keys(motionCatalog()?.components ?? {});
}

// Idioma del canal (texto libre de la configuracion del canal) -> formato
// de las cifras en pantalla.
export function numberLocale(channelLanguage: string | null | undefined): string {
  const lang = (channelLanguage ?? "").toLowerCase();
  if (/ingl|english|^en\b/.test(lang)) return "en-US";
  if (/portug|^pt\b/.test(lang)) return "pt-BR";
  return "es-AR";
}

export interface MotionClip {
  path: string;
  start: number;
  end: number;
  // Lo que dura la animacion renderizada; el resto se congela.
  introSeconds: number;
}

export async function renderMotionClips(
  placed: PlacedOverlay[],
  options: {
    width: number;
    height: number;
    theme: string | null;
    locale: string;
    workDir: string;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<MotionClip[]> {
  if (placed.length === 0) return [];
  const outDir = path.join(options.workDir, "motion");
  await mkdir(outDir, { recursive: true });
  const jobPath = path.join(outDir, "job.json");
  await writeFile(
    jobPath,
    JSON.stringify({
      outDir,
      width: options.width,
      height: options.height,
      theme: options.theme ?? undefined,
      locale: options.locale,
      items: placed.map((p, i) => ({ id: `overlay-${i}`, spec: p.spec })),
    })
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/render-overlays.ts", jobPath], {
      cwd: MOTION_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrTail = "";
    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const m = /^PROGRESS (\d+) (\d+)/.exec(line);
        if (m) options.onProgress?.(Number(m[1]), Number(m[2]));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`motion termino con codigo ${code}: ${stderrTail}`))
    );
  });

  const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf-8")) as {
    id: string;
    path: string;
    durationSeconds: number;
  }[];
  const byId = new Map(manifest.map((m) => [m.id, m]));
  return placed.flatMap((p, i) => {
    const m = byId.get(`overlay-${i}`);
    return m ? [{ path: m.path, start: p.start, end: p.end, introSeconds: m.durationSeconds }] : [];
  });
}

// Inputs + filtergraph para superponer los clips sobre `[baseLabel]`.
// Cada clip: congela su ultimo frame hasta completar la duracion, fundido
// de salida en el alfa, y se corre a su segundo del video.
export function motionOverlayGraph(
  clips: MotionClip[],
  baseLabel: string,
  firstInputIndex: number
): { inputArgs: string[]; filter: string; outLabel: string } {
  const inputArgs: string[] = [];
  const parts: string[] = [];
  let current = baseLabel;
  clips.forEach((clip, i) => {
    const input = firstInputIndex + i;
    const total = Math.max(clip.introSeconds, clip.end - clip.start);
    const hold = Math.max(0, total - clip.introSeconds);
    const fadeStart = Math.max(0, total - EXIT_FADE_SECONDS);
    inputArgs.push("-i", clip.path);
    parts.push(
      `[${input}:v]tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},` +
        `fade=t=out:st=${fadeStart.toFixed(3)}:d=${EXIT_FADE_SECONDS}:alpha=1,` +
        `setpts=PTS-STARTPTS+${clip.start.toFixed(3)}/TB[mo${i}]`
    );
    const next = `mv${i}`;
    parts.push(`[${current}][mo${i}]overlay=eof_action=pass:format=auto[${next}]`);
    current = next;
  });
  return { inputArgs, filter: parts.join(";"), outLabel: current };
}
