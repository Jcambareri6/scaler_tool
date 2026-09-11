import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// ffmpeg-static es CJS puro (`module.exports = <path>`) con un .d.ts en
// sintaxis "export default" que no interopera bien bajo module: nodenext
// -- mismo patron que pdf-parse en transcribeAudio.tool.ts, se importa con
// require via createRequire en vez de pelear con los tipos.
import { createRequire } from "module";
import { v2 as cloudinary } from "cloudinary";
import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { supabase } from "../lib/supabase.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { resolveR2Config, uploadFileToR2 } from "../lib/r2.js";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

export interface RenderVideoInput {
  video_project_id: string;
  timeline_id: string;
}

export interface RenderVideoOutput {
  storage_key: string;
  duration_seconds: number;
}

const RENDER_BUCKET = "renders";
// 720p/30fps: suficiente calidad para revisar, mantiene los tiempos de
// render razonables (el clip mas lento en esto es descargar+codificar, no
// la resolucion).
const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;

function parseTime(value: string): number {
  const [mm, ss] = value.split(":").map(Number);
  return (mm ?? 0) * 60 + (ss ?? 0);
}

async function mockRender(videoProjectId: string, timelineId: string): Promise<RenderVideoOutput> {
  const { data: timeline, error } = await supabase
    .from("timelines")
    .select("content")
    .eq("id", timelineId)
    .single();
  if (error || !timeline) {
    throw new Error("Timeline not found");
  }

  const scenes = ((timeline.content as { scenes?: { end: string }[] } | null)?.scenes) ?? [];
  const durationSeconds = scenes.length > 0 ? parseTime(scenes[scenes.length - 1]!.end) : 0;

  return {
    storage_key: `mock://render/${videoProjectId}.mp4`,
    duration_seconds: durationSeconds,
  };
}

interface TimelineAssetEntry {
  storage_key: string;
  start: string;
  end: string;
  type?: string | undefined;
}

interface TimelineSceneEntry {
  scene_id: string;
  order: number;
  start: string;
  end: string;
  // Una escena cubierta por mas de un clip (replaceStockSegmentsForScene
  // completo con otro candidato en vez de repetir el mismo) trae varios
  // aca, cada uno con su propio sub-tramo de tiempo. `asset` (singular) se
  // mantiene solo para compatibilidad con timelines viejos sin `assets`.
  asset: { storage_key: string; type?: string } | null;
  assets?: TimelineAssetEntry[];
}

interface TimelineContent {
  scenes?: TimelineSceneEntry[];
  audio?: { storage_key: string } | null;
}

interface RenderSegment {
  storageKey: string;
  start: string;
  end: string;
  // Timelines viejos (de antes de que existiera generate_image) no tienen
  // `type` guardado -- se asume VIDEO, que es como se comportaba todo esto
  // antes de que IMAGE existiera.
  isImage: boolean;
}

function flattenSegments(scenes: TimelineSceneEntry[]): RenderSegment[] {
  const segments: RenderSegment[] = [];
  for (const scene of scenes) {
    const assets: TimelineAssetEntry[] =
      scene.assets && scene.assets.length > 0
        ? scene.assets
        : scene.asset
          ? [{ storage_key: scene.asset.storage_key, start: scene.start, end: scene.end, type: scene.asset.type }]
          : [];
    for (const asset of assets) {
      if (!asset.storage_key) continue;
      segments.push({
        storageKey: asset.storage_key,
        start: asset.start,
        end: asset.end,
        isImage: asset.type === "IMAGE",
      });
    }
  }
  return segments;
}

const DOWNLOAD_TIMEOUT_MS = 60 * 1000;

async function downloadTo(url: string, destPath: string): Promise<void> {
  const buffer = await withRetry(async () => {
    const response = await fetchWithTimeout(url, {}, DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`No se pudo descargar ${url} (${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  });
  await writeFile(destPath, buffer);
}

// Cloudinary sirve el render final por CDN (reproduce bien en un <video> del
// navegador y tiene descarga directa) -- Supabase Storage queda como
// fallback si el provider no esta configurado, para no romper instalaciones
// viejas sin cuenta de Cloudinary. Credenciales van en la fila `providers`
// (slug "cloudinary"): api_key column = api_secret, configuration =
// { cloud_name, api_key } (el api_key PUBLICO de Cloudinary, distinto del
// secret).
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

async function uploadRenderToCloudinary(
  videoProjectId: string,
  outputPath: string,
  cloudName: string,
  apiKey: string,
  apiSecret: string
): Promise<string> {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  // uploader.upload (sin _large) rechaza con 413 "Payload Too Large" para
  // videos de mas de ~100MB (limite de subida no fragmentada de Cloudinary,
  // visto en produccion) -- upload_large sube en chunks y no tiene ese
  // techo, sirve igual para archivos chicos asi que no hace falta elegir
  // entre uno u otro segun tamano.
  // OJO: sin callback, upload_large NO devuelve una Promise -- devuelve
  // directo el stream interno de subida (confirmado en produccion: el
  // "resultado" resultaba ser el objeto Writable, no la respuesta de
  // Cloudinary, y secure_url salia undefined). El tipo del .d.ts sugiere lo
  // contrario, pero hay que pasarle el callback si o si y envolverlo en una
  // Promise a mano para obtener el resultado real.
  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    cloudinary.uploader.upload_large(
      outputPath,
      {
        resource_type: "video",
        folder: "skaler-renders",
        public_id: videoProjectId,
        overwrite: true,
        timeout: CLOUDINARY_UPLOAD_TIMEOUT_MS,
      },
      (error, uploadResult) => {
        if (error) reject(error);
        else if (!uploadResult) reject(new Error("Cloudinary no devolvio resultado para la subida"));
        else resolve(uploadResult as { secure_url: string });
      }
    );
  });
  return result.secure_url;
}

async function uploadRenderToSupabase(videoProjectId: string, outputBuffer: Buffer): Promise<string> {
  const { error: bucketError } = await supabase.storage.createBucket(RENDER_BUCKET, { public: true });
  if (bucketError && !/already exists/i.test(bucketError.message)) {
    throw new Error(bucketError.message);
  }

  const renderPath = `${videoProjectId}.mp4`;
  const { error: uploadError } = await supabase.storage
    .from(RENDER_BUCKET)
    .upload(renderPath, outputBuffer, { contentType: "video/mp4", upsert: true });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(RENDER_BUCKET).getPublicUrl(renderPath);
  return publicUrl;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg-static no resolvio el binario de ffmpeg"));
      return;
    }
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg salio con codigo ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

const OUTPUT_FPS = 30;
// Ken Burns escalaba 2x antes para no perder nitidez al hacer zoom-in --
// bajado a 1.4x: el filtro `zoompan` de ffmpeg es conocido por consumir
// memoria de forma desproporcionada al tamaño del frame que procesa, y esa
// resolucion extra sumaba bastante sin aportar demasiado a la nitidez
// percibida en un output final de 1280x720.
const KEN_BURNS_UPSCALE = 1.4;

// Cuantos segmentos entran en CADA ffmpeg individual antes de armar el
// video final. Procesar TODOS los segmentos en un solo ffmpeg (como se
// hacia antes) hace que la memoria necesaria crezca con la cantidad de
// segmentos SIN TECHO -- confirmado en produccion: 22-26 segmentos se
// quedaron sin memoria tanto en un plan de 512MB como en uno de 4GB. Con
// tandas chicas, la memoria de cada ffmpeg queda acotada al tamaño de la
// tanda, sin importar cuantos segmentos tenga el video en total.
const BATCH_SIZE = 4;

// Cloudinary rechaza subidas de mas de 100MB en la cuenta actual (visto en
// produccion: "File size too large. Got 107751893. Maximum is 104857600").
// Con CRF por defecto el peso final depende del contenido y puede pasarse
// (paso con un video de 12:44 -> 107.75MB). Para no depender de eso, se
// calcula un bitrate de video objetivo segun la duracion total, apuntando a
// un poco menos de 100MB (SAFETY_MARGIN) para dejar margen al overhead del
// contenedor y a que la estimacion de audio no sea exacta al byte.
const CLOUDINARY_MAX_BYTES = 100 * 1024 * 1024;
const CLOUDINARY_SAFETY_MARGIN = 0.92;
const AUDIO_BITRATE_BPS = 128_000;
// Piso de calidad: por debajo de esto el video queda visiblemente pixelado.
// Un video tan largo que necesitaria menos que esto para entrar en 100MB va
// a pasarse igual (se prioriza que se vea aceptable antes que cumplir el
// limite a cualquier costo) -- ver log de warning cuando esto pasa.
const MIN_VIDEO_BITRATE_BPS = 400_000;

// Devuelve null si no hace falta acotar el bitrate (destino sin limite de
// tamano, ej. Supabase Storage) -- en ese caso se deja el CRF por defecto de
// libx264, que da mejor calidad que fijar un bitrate a mano.
function computeTargetVideoBitrateBps(durationSeconds: number, capToCloudinaryLimit: boolean): number | null {
  if (!capToCloudinaryLimit || durationSeconds <= 0) return null;
  const budgetBits = CLOUDINARY_MAX_BYTES * 8 * CLOUDINARY_SAFETY_MARGIN;
  const videoBudgetBps = budgetBits / durationSeconds - AUDIO_BITRATE_BPS;
  return Math.max(MIN_VIDEO_BITRATE_BPS, Math.floor(videoBudgetBps));
}

// Arma los argumentos de ffmpeg (inputs + filter_complex) para UNA tanda de
// segmentos -- misma logica de siempre (loop+zoompan para imagenes,
// stream_loop+scale para video), generalizada para operar sobre un
// subconjunto en vez de la lista completa.
function buildFfmpegArgsForBatch(
  batchSegments: RenderSegment[],
  batchClipPaths: string[]
): { inputArgs: string[]; filterComplex: string } {
  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  batchSegments.forEach((segment, i) => {
    const duration = Math.max(0.1, parseTime(segment.end) - parseTime(segment.start));
    if (segment.isImage) {
      const totalFrames = Math.max(1, Math.round(duration * OUTPUT_FPS));
      const upscaledWidth = Math.round(OUTPUT_WIDTH * KEN_BURNS_UPSCALE);
      const upscaledHeight = Math.round(OUTPUT_HEIGHT * KEN_BURNS_UPSCALE);
      inputArgs.push("-loop", "1", "-i", batchClipPaths[i]!);
      // OJO: `-framerate`/`-t` en el input MULTIPLICA la duracion en vez de
      // fijarla junto con `d` de zoompan (validado localmente: con -t 3 a
      // 30fps son 90 frames de input, y zoompan aplica d=90 POR CADA UNO,
      // dando 8100 frames = 4:30 en vez de 3s) -- `d` solo controla cuantos
      // frames salen de esta rama.
      filterParts.push(
        `[${i}:v]scale=${upscaledWidth}:${upscaledHeight}:force_original_aspect_ratio=increase,` +
          `crop=${upscaledWidth}:${upscaledHeight},` +
          `zoompan=z='min(zoom+0.0015,1.3)':d=${totalFrames}:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:fps=${OUTPUT_FPS},setsar=1[v${i}]`
      );
    } else {
      inputArgs.push("-stream_loop", "-1", "-t", duration.toFixed(2), "-i", batchClipPaths[i]!);
      filterParts.push(
        `[${i}:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,` +
          `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1,fps=${OUTPUT_FPS}[v${i}]`
      );
    }
  });
  const concatInputs = batchSegments.map((_, i) => `[v${i}]`).join("");
  const filterComplex = `${filterParts.join(";")};${concatInputs}concat=n=${batchSegments.length}:v=1:a=0[outv]`;
  return { inputArgs, filterComplex };
}

// Args de codec de video para pasarle a ffmpeg en cada tanda. Sin bitrate
// objetivo (null) se deja el CRF por defecto de libx264 -- mejor calidad,
// usado cuando el destino final no tiene limite de tamano (Supabase
// Storage). Con bitrate objetivo, se fuerza para que la suma de tandas de
// como resultado un archivo final de un tamano predecible.
function videoCodecArgs(targetVideoBitrateBps: number | null): string[] {
  if (targetVideoBitrateBps === null) {
    return ["-c:v", "libx264", "-preset", "veryfast"];
  }
  return [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    `${targetVideoBitrateBps}`,
    "-maxrate",
    `${Math.round(targetVideoBitrateBps * 1.2)}`,
    "-bufsize",
    `${Math.round(targetVideoBitrateBps * 2)}`,
  ];
}

// Composicion real: descarga cada clip de stock y el audio narrado, procesa
// los segmentos EN TANDAS chicas (ver BATCH_SIZE) para mantener acotada la
// memoria de cada ffmpeg sin importar cuantos segmentos tenga el video, y
// al final pega las tandas ya codificadas sin recomprimir (`-c copy`, cero
// perdida de calidad) junto con el audio narrado completo.
async function realRender(videoProjectId: string, timelineId: string): Promise<RenderVideoOutput> {
  const { data: timeline, error } = await supabase
    .from("timelines")
    .select("content")
    .eq("id", timelineId)
    .single();
  if (error || !timeline) {
    throw new Error("Timeline not found");
  }

  const content = timeline.content as TimelineContent;
  const scenes = (content.scenes ?? []).sort((a, b) => a.order - b.order);
  const segments = flattenSegments(scenes);

  if (segments.length === 0) {
    throw new Error("El timeline no tiene escenas con clips de video asignados todavia");
  }
  if (!content.audio?.storage_key) {
    throw new Error("El timeline no tiene audio narrado todavia");
  }

  const totalDuration = parseTime(scenes[scenes.length - 1]!.end);

  // Orden de prioridad de destino: R2 > Cloudinary > Supabase Storage. Solo
  // Cloudinary tiene el limite de 100MB (ver CLOUDINARY_MAX_BYTES) -- R2 y
  // Supabase Storage no, asi que en esos casos se prioriza calidad (CRF por
  // defecto) en vez de forzar un bitrate a mano.
  const r2Provider = await getActiveProvider("r2");
  const r2Config = resolveR2Config(r2Provider);
  const usingR2 = Boolean(r2Config && r2Provider?.api_key);

  const cloudinaryProvider = usingR2 ? null : await getActiveProvider("cloudinary");
  const cloudName = cloudinaryProvider?.configuration?.cloud_name as string | undefined;
  const cloudinaryApiKey = cloudinaryProvider?.configuration?.api_key as string | undefined;
  const usingCloudinary = Boolean(cloudinaryProvider?.api_key && cloudName && cloudinaryApiKey);

  const targetVideoBitrateBps = computeTargetVideoBitrateBps(totalDuration, usingCloudinary);
  if (targetVideoBitrateBps !== null) {
    console.log(
      `[render_video] ajustando bitrate de video a ~${Math.round(targetVideoBitrateBps / 1000)}kbps ` +
        `para que el final (${Math.round(totalDuration)}s) entre en el limite de 100MB de Cloudinary`
    );
    if (targetVideoBitrateBps === MIN_VIDEO_BITRATE_BPS) {
      console.warn(
        `[render_video] video muy largo (${Math.round(totalDuration)}s): no entra en 100MB sin bajar del piso de calidad minimo, va a pesar mas de 100MB igual`
      );
    }
  }

  console.log(`[render_video] starting render for project ${videoProjectId} (${segments.length} segmentos)`);
  const workDir = await mkdtemp(path.join(tmpdir(), "skaler-render-"));
  try {
    const audioPath = path.join(workDir, "narration.mp3");
    await downloadTo(content.audio.storage_key, audioPath);

    console.log(`[render_video] descargando ${segments.length} clips/imagenes...`);
    const clipPaths = await mapWithConcurrency(segments, 5, async (segment, i) => {
      // La extension real importa: el demuxer "image2" (usado con -loop 1
      // para las imagenes generadas) espera un patron de secuencia tipo
      // %03d cuando el archivo no tiene extension, y falla con "does not
      // contain an image sequence pattern" -- .png/.mp4 alcanza para que
      // ffmpeg detecte el formato solo, sin forzar -f explicito.
      const clipPath = path.join(workDir, segment.isImage ? `segment-${i}.png` : `segment-${i}.mp4`);
      await downloadTo(segment.storageKey, clipPath);
      return clipPath;
    });

    const totalBatches = Math.ceil(segments.length / BATCH_SIZE);
    const batchOutputPaths: string[] = [];
    for (let b = 0; b < totalBatches; b++) {
      const batchStart = b * BATCH_SIZE;
      const batchSegments = segments.slice(batchStart, batchStart + BATCH_SIZE);
      const batchClipPaths = clipPaths.slice(batchStart, batchStart + BATCH_SIZE);
      const { inputArgs, filterComplex } = buildFfmpegArgsForBatch(batchSegments, batchClipPaths);
      const batchOutputPath = path.join(workDir, `batch-${b}.mp4`);

      console.log(`[render_video] corriendo ffmpeg (tanda ${b + 1}/${totalBatches}, ${batchSegments.length} segmentos)...`);
      await runFfmpeg([
        ...inputArgs,
        "-filter_complex",
        filterComplex,
        "-map",
        "[outv]",
        ...videoCodecArgs(targetVideoBitrateBps),
        "-y",
        batchOutputPath,
      ]);
      batchOutputPaths.push(batchOutputPath);
    }

    // Union final: las tandas ya estan codificadas con el mismo codec/
    // resolucion/fps, asi que pegarlas con el demuxer "concat" + `-c:v copy`
    // no vuelve a comprimir nada (cero perdida de calidad) -- mucho mas
    // liviano en memoria que un unico ffmpeg gigante. El audio narrado
    // completo se mezcla en este mismo paso.
    const concatListPath = path.join(workDir, "concat-list.txt");
    const concatListContent = batchOutputPaths
      .map((p) => `file '${p.replace(/\\/g, "/")}'`)
      .join("\n");
    await writeFile(concatListPath, concatListContent);

    const outputPath = path.join(workDir, "final.mp4");
    console.log(`[render_video] uniendo ${totalBatches} tandas + audio...`);
    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-i",
      audioPath,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      `${AUDIO_BITRATE_BPS}`,
      "-shortest",
      "-y",
      outputPath,
    ]);

    console.log(`[render_video] ffmpeg listo, subiendo...`);
    let publicUrl: string;
    if (usingR2 && r2Config && r2Provider?.api_key) {
      publicUrl = await uploadFileToR2(
        outputPath,
        `skaler-renders/${videoProjectId}.mp4`,
        "video/mp4",
        r2Config,
        r2Provider.api_key
      );
    } else if (usingCloudinary && cloudName && cloudinaryApiKey && cloudinaryProvider?.api_key) {
      publicUrl = await uploadRenderToCloudinary(videoProjectId, outputPath, cloudName, cloudinaryApiKey, cloudinaryProvider.api_key);
    } else {
      const outputBuffer = await readFile(outputPath);
      publicUrl = await uploadRenderToSupabase(videoProjectId, outputBuffer);
    }
    console.log(`[render_video] listo: ${publicUrl}`);

    return { storage_key: publicUrl, duration_seconds: Math.round(totalDuration) };
  } finally {
    // En Windows, rm() a veces tira ENOTEMPTY porque el OS todavia no
    // solto un archivo que uso ffmpeg (visto en produccion) -- si esto
    // pasa DESPUES de un render+upload exitoso, tirar el error ac aca
    // pisaba el resultado bueno y hacia parecer que todo el render fallo.
    // Es solo limpieza de un temp dir, no vale la pena que tumbe un
    // resultado que ya se genero bien.
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[render_video] no se pudo limpiar ${workDir}:`, cleanupError);
    }
  }
}

// Composicion final (FFmpeg): une clips + audio + overlays ya renderizados
// segun el Timeline. Es el ultimo paso del pipeline (Etapa 12).
export const renderVideoTool: ToolDefinition<RenderVideoInput, RenderVideoOutput> = {
  name: "render_video",
  description:
    "Compone el video final (clips + audio + overlays) a partir del Timeline resuelto.",
  parameters: {
    type: "object",
    properties: {
      video_project_id: { type: "string", description: "UUID del proyecto" },
      timeline_id: { type: "string", description: "UUID del timeline resuelto" },
    },
    required: ["video_project_id", "timeline_id"],
  },
  async execute({ video_project_id, timeline_id }) {
    const provider = await getActiveProvider("ffmpeg");
    if (!provider?.is_active) {
      if (isMockMode()) {
        return mockRender(video_project_id, timeline_id);
      }
      throw new ProviderNotConfiguredError("render_video");
    }
    return realRender(video_project_id, timeline_id);
  },
};
