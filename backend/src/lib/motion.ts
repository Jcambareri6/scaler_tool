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
  // blur: desenfoque del video de abajo mientras el grafico esta en
  // pantalla, en px a 1080p (ver motionOverlayGraph).
  components: Record<string, { introSeconds: number; blur?: number }>;
}

// Rampa de entrada del desenfoque (la salida acompaña el fundido del
// grafico, EXIT_FADE_SECONDS) y cuantos pasos tiene cada rampa.
const BLUR_RAMP_IN_SECONDS = 0.3;
const BLUR_RAMP_STEPS = 5;

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
  // Desenfoque del video de abajo (sigma de gblur), ya escalado a la
  // resolucion del video desde el px-a-1080p del catalogo.
  blur: number;
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
    const blur = ((motionCatalog()?.components[p.spec.type]?.blur ?? 0) * options.height) / 1080;
    return m ? [{ path: m.path, start: p.start, end: p.end, introSeconds: m.durationSeconds, blur }] : [];
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

  // Desenfoque del video de abajo mientras hay un grafico que lo pide
  // (capitulos, frases...): un solo gblur para todo el video, apagado
  // (enable) fuera de esas ventanas, y sendcmd le sube/baja el sigma en
  // rampas cortas para que no salte de golpe.
  const blurred = clips.filter((c) => c.blur > 0);
  if (blurred.length > 0) {
    const cmds: string[] = [];
    const windows: string[] = [];
    for (const clip of blurred) {
      const end = clip.start + Math.max(clip.introSeconds, clip.end - clip.start);
      windows.push(`between(t,${clip.start.toFixed(3)},${end.toFixed(3)})`);
      for (let k = 1; k <= BLUR_RAMP_STEPS; k++) {
        const f = k / BLUR_RAMP_STEPS;
        cmds.push(`${(clip.start + BLUR_RAMP_IN_SECONDS * (f - 1 / BLUR_RAMP_STEPS)).toFixed(3)} gblur@bg sigma ${(clip.blur * f).toFixed(2)}`);
        cmds.push(`${(end - EXIT_FADE_SECONDS * (1 - (k - 1) / BLUR_RAMP_STEPS)).toFixed(3)} gblur@bg sigma ${(clip.blur * (1 - f)).toFixed(2)}`);
      }
    }
    cmds.sort((a, b) => parseFloat(a) - parseFloat(b));
    parts.push(
      `[${current}]sendcmd=c='${cmds.join(";")}',gblur@bg=sigma=0:enable='${windows.join("+")}'[mblur]`
    );
    current = "mblur";
  }

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
