import type { DocumentalStyle } from "./documentalStyles.js";

// Piezas de ffmpeg del LOOK documental (estilo Make a Videos), separadas del
// render para poder probarlas solas (scripts/tests/documentalRender.test.ts).
// render_video las usa solo con video_format = "documental".

const FPS = 30;
// Destello calido: dura esto al principio del plano.
const FLASH_SECONDS = 0.35;
const FLASH_STRENGTH = 0.22;

// Gradacion + viñeta + capa del estilo, por segmento. `segmentIndex` es la
// posicion global del plano en el video (para el destello cada N planos).
export function lookFilter(look: DocumentalStyle["look"], segmentIndex: number): string {
  const flash = look.flashEvery > 0 && segmentIndex > 0 && segmentIndex % look.flashEvery === 0;
  // Las comas dentro de una expresion van escapadas en un filtergraph.
  const brightness = flash
    ? `'${look.brightness}+${FLASH_STRENGTH}*max(0\\,1-t/${FLASH_SECONDS})'`
    : `${look.brightness}`;
  const parts = [`eq=contrast=${look.contrast}:saturation=${look.saturation}:brightness=${brightness}${flash ? ":eval=frame" : ""}`];
  if (flash) {
    // El destello tira a calido (como la "floracion" de MaV).
    parts.push(`colorbalance=rh=0.06:gh=0.03:bh=-0.04`);
  }
  if (look.layer === "bn") parts.push("noise=alls=10:allf=t");
  if (look.layer === "old_movie") parts.push("noise=alls=14:allf=t", "eq=gamma=0.95");
  if (look.layer === "paper") parts.push("colorbalance=rs=0.06:gs=0.03:bs=-0.06:rm=0.04:bm=-0.04");
  if (look.vignette) parts.push("vignette=angle=PI/5");
  return parts.join(",");
}

// ---------- Movimiento de camara sobre fotos ----------

export type Motion = "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "push";
const MOTIONS: Motion[] = ["zoom_in", "pan_right", "zoom_out", "pan_left", "push"];

// Nunca el mismo movimiento que el plano anterior (MaV). Deterministico por
// indice, asi el preview y el render coinciden.
export function motionFor(segmentIndex: number, previous: Motion | null): Motion {
  let motion = MOTIONS[segmentIndex % MOTIONS.length]!;
  if (motion === previous) motion = MOTIONS[(segmentIndex + 1) % MOTIONS.length]!;
  return motion;
}

const MAX_ZOOM = 1.12;
const PAN_ZOOM = 1.1;

// Expresiones z/x/y de zoompan (`on` = cuadro de salida, `total` cuadros).
export function zoompanExpr(motion: Motion, totalFrames: number, startZoom = 1): { z: string; x: string; y: string } {
  const n = Math.max(1, totalFrames - 1);
  const center = { x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
  const from = Math.max(1, startZoom);
  const to = Math.max(from + 0.02, MAX_ZOOM * startZoom);
  switch (motion) {
    case "zoom_in":
      return { z: `${from}+${((to - from) / n).toFixed(8)}*on`, ...center };
    case "zoom_out":
      return { z: `${to}-${((to - from) / n).toFixed(8)}*on`, ...center };
    case "pan_left":
      return { z: `${PAN_ZOOM}`, x: `(iw-iw/zoom)*(1-on/${n})`, y: center.y };
    case "pan_right":
      return { z: `${PAN_ZOOM}`, x: `(iw-iw/zoom)*on/${n}`, y: center.y };
    case "push":
      // Empuje hacia el tercio superior (caras, cabezas, letreros).
      return { z: `${from}+${((to + 0.04 - from) / n).toFixed(8)}*on`, x: center.x, y: "max(0\\,ih/3-ih/zoom/2)" };
  }
}

// ---------- Cortes de zoom dentro de los clips ----------

// Alterna encuadre abierto y cerrado cada `every` segundos ("dos camaras").
// Se aplica sobre un cuadro ya escalado a `upscaled` y despues se baja a la
// salida con lanczos.
export function zoomCutFilter(every: number, out: { width: number; height: number }, upscale = 1.3): string {
  const w = Math.round(out.width * upscale);
  const h = Math.round(out.height * upscale);
  const z = `if(lt(mod(it\\,${2 * every})\\,${every})\\,1.06\\,1.24)`;
  return (
    `scale=${w}:${h}:flags=lanczos,` +
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${FPS},` +
    `scale=${out.width}:${out.height}:flags=lanczos`
  );
}

// ---------- Sonido ----------

export interface SfxCue {
  at: number; // segundos
  kind: "whoosh" | "hit" | "tick";
}

// Efectos sintetizados con ffmpeg (sin archivos externos ni licencias).
export const SFX_SOURCES: Record<SfxCue["kind"], string> = {
  // Ruido filtrado que barre de grave a agudo, 0.7 s.
  whoosh: "anoisesrc=d=0.7:c=pink:a=0.6,highpass=f=300,lowpass=f=5000,afade=t=in:d=0.3,afade=t=out:st=0.35:d=0.35",
  // Golpe grave, 0.5 s.
  hit: "sine=f=60:d=0.5,volume=2.5,afade=t=out:st=0.05:d=0.45",
  // Tic de reloj, 0.08 s.
  tick: "sine=f=2200:d=0.08,afade=t=out:st=0.01:d=0.07",
};

const SFX_BY_OVERLAY: Record<string, SfxCue["kind"]> = {
  title_card: "whoosh",
  chapter_index: "whoosh",
  map_marker: "whoosh",
  map_globe: "whoosh",
  big_number: "hit",
  number_phrase: "hit",
  scoreboard: "hit",
  versus: "hit",
  data_viz_single: "hit",
  line_chart: "hit",
  timeline: "tick",
  milestone: "tick",
};

// Un efecto por grafico, con separacion minima (MaV: "nunca encima").
export function sfxCues(overlays: { start: number; type: string }[], minGap = 3): SfxCue[] {
  const cues: SfxCue[] = [];
  for (const o of [...overlays].sort((a, b) => a.start - b.start)) {
    const kind = SFX_BY_OVERLAY[o.type];
    if (!kind) continue;
    const last = cues[cues.length - 1];
    if (last && o.start - last.at < minGap) continue;
    cues.push({ at: Math.max(0, o.start), kind });
  }
  return cues;
}

// Mezcla final: voz + musica (en loop, con ducking por sidechain bajo la voz)
// + efectos, normalizada a -14 LUFS (lo que normaliza YouTube).
// Inputs: 0 = voz; 1 = musica (si hay). Los efectos van por lavfi.
export function audioMixArgs(opts: {
  voicePath: string;
  musicPath: string | null;
  duration: number;
  sound: DocumentalStyle["sound"];
  sfx: SfxCue[];
  outPath: string;
}): string[] {
  const { sound, duration } = opts;
  const args = ["-y", "-i", opts.voicePath];
  if (opts.musicPath) args.push("-stream_loop", "-1", "-i", opts.musicPath);
  const parts: string[] = [];
  const mixInputs: string[] = [];
  parts.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][voicekey]`);
  mixInputs.push("[voice]");
  if (opts.musicPath) {
    const fadeOut = Math.max(0, duration - 3);
    parts.push(
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${duration.toFixed(2)},volume=${sound.musicVolume},` +
        `afade=t=in:d=2,afade=t=out:st=${fadeOut.toFixed(2)}:d=3[music]`
    );
    // Ducking: cuando habla la voz la musica baja a ~duckTo de su nivel.
    const ratio = Math.min(20, Math.max(2, 1 / Math.max(0.05, sound.duckTo)));
    parts.push(`[music][voicekey]sidechaincompress=threshold=0.02:ratio=${ratio.toFixed(1)}:attack=30:release=500[ducked]`);
    mixInputs.push("[ducked]");
  } else {
    parts.push("[voicekey]anullsink");
  }
  opts.sfx.forEach((cue, i) => {
    const ms = Math.round(cue.at * 1000);
    parts.push(`${SFX_SOURCES[cue.kind]},aformat=sample_rates=48000:channel_layouts=stereo,volume=${sound.sfxVolume},adelay=${ms}|${ms}[sfx${i}]`);
    mixInputs.push(`[sfx${i}]`);
  });
  parts.push(
    `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:normalize=0,` +
      `loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[mix]`
  );
  args.push("-filter_complex", parts.join(";"), "-map", "[mix]", "-c:a", "flac", opts.outPath);
  return args;
}

// ---------- Control de calidad del MP4 ----------

export interface RenderQc {
  black_segments: { start: number; end: number }[];
  frozen_segments: { start: number; end: number }[];
  integrated_lufs: number | null;
  true_peak_db: number | null;
  warnings: string[];
}

export const QC_FILTER_ARGS = ["-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"];

export function parseQc(stderr: string): RenderQc {
  const black = [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const freezeStarts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const freezeEnds = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const frozen = freezeStarts.map((start, i) => ({ start, end: freezeEnds[i] ?? start }));
  // El resumen final de ebur128: "I: -14.2 LUFS" y "Peak: -1.6 dBFS".
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = summary.match(/I:\s*(-?[\d.]+)\s*LUFS/);
  const peak = summary.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);
  const integrated = lufs ? Number(lufs[1]) : null;
  const truePeak = peak ? Number(peak[1]) : null;
  const warnings: string[] = [];
  if (black.length) warnings.push(`${black.length} tramo(s) en negro`);
  if (frozen.length) warnings.push(`${frozen.length} tramo(s) con la imagen congelada`);
  if (integrated !== null && Math.abs(integrated + 14) > 2) warnings.push(`volumen ${integrated} LUFS (objetivo -14)`);
  if (truePeak !== null && truePeak > -0.5) warnings.push(`pico de audio ${truePeak} dBFS (riesgo de saturar)`);
  return { black_segments: black, frozen_segments: frozen, integrated_lufs: integrated, true_peak_db: truePeak, warnings };
}
