import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { createRequire } from "module";
import { supabase } from "./supabase.js";
import { withRetry } from "./retry.js";
import { fetchWithTimeout } from "./http.js";
import { getAudioDurationSeconds } from "./audioDuration.js";
import { getActiveProvider } from "./providers.js";
import { resolveR2Config, uploadFileToR2 } from "./r2.js";
import { makeWorkDir } from "./workDir.js";

// ffmpeg-static es CJS puro -- mismo patron que renderVideo.tool.ts /
// transcribeAudio.tool.ts.
const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

export const AI33_BASE_URL = "https://api.ai33.pro";
export const AUDIO_BUCKET = "audio";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60 * 60 * 1000;

export interface Ai33TaskResponse {
  id: string;
  status: "doing" | "done" | "error";
  error_message: string | null;
  metadata?: {
    audio_url?: string;
    duration?: number;
  };
}

export interface Ai33VoiceResult {
  storage_key: string;
  duration_seconds: number;
}

export async function ensureAudioBucket(): Promise<void> {
  const { error } = await supabase.storage.createBucket(AUDIO_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(error.message);
  }
}

// Mismo criterio de prioridad que render_video (ver renderVideo.tool.ts):
// R2 sube en streaming y no tiene techo practico de tamaño -- Supabase
// Storage si tiene un limite de proyecto, y una narracion de un guion largo
// puede pasarlo ("The object exceeded the maximum allowed size"). Sin
// provider "r2" configurado (Settings > Providers, mismas credenciales que
// ya usa el render final) cae a Supabase Storage como antes.
async function uploadAudioFile(localPath: string, storageKey: string): Promise<string> {
  const r2Provider = await getActiveProvider("r2");
  const r2Config = resolveR2Config(r2Provider);
  if (r2Config && r2Provider?.api_key) {
    return uploadFileToR2(localPath, `skaler-audio/${storageKey}.mp3`, "audio/mpeg", r2Config, r2Provider.api_key);
  }

  await ensureAudioBucket();
  const buffer = await readFile(localPath);
  const path = `${storageKey}.mp3`;
  const { error: uploadError } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(path, buffer, { contentType: "audio/mpeg", upsert: true });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path);
  return publicUrl;
}

// v3/text-to-speech de ai33.pro es asincronico -- devuelve un task_id y hay
// que consultar GET /v1/task/:id hasta que status sea "done" (o "error").
export async function pollAi33Task(taskId: string, apiKey: string): Promise<Ai33TaskResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // Reintento corto por vuelta de polling -- una tarea puede tardar
    // minutos, no tiene sentido tirar todo por un blip de red puntual en
    // una sola consulta de estado.
    const task = await withRetry(
      async () => {
        const response = await fetchWithTimeout(`${AI33_BASE_URL}/v1/task/${taskId}`, {
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`ai33.pro task API error (${response.status}): ${body}`);
        }
        return (await response.json()) as Ai33TaskResponse;
      },
      { retries: 2 }
    );
    if (task.status === "done") return task;
    if (task.status === "error") {
      throw new Error(`ai33.pro TTS task failed: ${task.error_message ?? "unknown error"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("ai33.pro TTS task timed out");
}

// Genera audio con ai33.pro y lo sube a nuestro propio Storage bajo
// `${storageKey}.mp3` -- storageKey puede ser un script_id (audio final,
// generateVoice.tool.ts) o una key sintetica tipo `previews/xxx`
// (previewVoice.tool.ts). No depende de que el audio siga vivo en el CDN
// de ai33.pro despues de generado.
export async function generateWithAi33(
  storageKey: string,
  text: string,
  apiKey: string,
  voiceId: string
): Promise<Ai33VoiceResult> {
  const formData = new FormData();
  formData.append("text", text);
  formData.append("voice_id", voiceId);
  formData.append("with_transcript", "true");

  const submitted = await withRetry(async () => {
    const submitResponse = await fetchWithTimeout(`${AI33_BASE_URL}/v3/text-to-speech`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: formData,
    });
    if (!submitResponse.ok) {
      const body = await submitResponse.text();
      throw new Error(`ai33.pro API error (${submitResponse.status}): ${body}`);
    }
    return (await submitResponse.json()) as { success: boolean; task_id: string };
  });
  if (!submitted.task_id) {
    throw new Error("ai33.pro no devolvio task_id para el pedido de voz");
  }

  const task = await pollAi33Task(submitted.task_id, apiKey);
  const audioUrl = task.metadata?.audio_url;
  if (!audioUrl) {
    throw new Error("ai33.pro no devolvio audio_url para la tarea completada");
  }

  // Se descarga y se re-sube a nuestro propio Storage en vez de guardar la
  // URL de ai33.pro tal cual -- no depende de que ese archivo siga vivo en
  // su CDN despues.
  const audioBuffer = await withRetry(async () => {
    const audioResponse = await fetchWithTimeout(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`No se pudo descargar el audio generado (${audioResponse.status})`);
    }
    return Buffer.from(await audioResponse.arrayBuffer());
  });

  // El archivo tal cual lo entrega ai33.pro (mismo bitrate/calidad que
  // siempre) se escribe una sola vez a disco -- sirve tanto para medir la
  // duracion real con ffmpeg como para subirlo (a R2 o a Supabase Storage,
  // ver uploadAudioFile), sin tocar la calidad del TTS en absoluto.
  let durationSeconds: number | null = null;
  const probeDir = await makeWorkDir("skaler-ai33-probe-");
  let publicUrl: string;
  try {
    const probePath = nodePath.join(probeDir, "probe.mp3");
    await writeFile(probePath, audioBuffer);
    // Duracion REAL del archivo descargado (ffmpeg) -- lo que ai33.pro "dice"
    // que dura (task.metadata.duration) es un reporte propio del proveedor
    // que puede no coincidir con el mp3 real (visto en produccion: el
    // timeline se armaba con esa duracion reportada, mas larga que el audio
    // real, y el render final quedaba mas corto que lo que mostraba la UI).
    durationSeconds = await getAudioDurationSeconds(probePath);
    publicUrl = await uploadAudioFile(probePath, storageKey);
  } finally {
    try {
      await rm(probeDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[ai33] no se pudo limpiar ${probeDir}:`, cleanupError);
    }
  }
  if (!durationSeconds) {
    // No se pudo medir el archivo (ffmpeg-static ausente, etc.) -- fallback
    // a lo que reporta ai33.pro, y si tampoco viene, estimacion por
    // cantidad de palabras.
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    durationSeconds = task.metadata?.duration ?? Math.max(10, Math.ceil(words / 2.5));
  }

  return { storage_key: publicUrl, duration_seconds: Math.round(durationSeconds) };
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

// Contraparte de generateWithAi33 para audio que el usuario sube a mano
// (en vez de pagarle a ai33.pro por un guion largo que puede tardar mas de
// lo que aguanta el polling) -- se re-encodea a mp3 real (el nombre del
// archivo importa: Whisper decide el formato por la extension, no por el
// contenido) y se sube a la MISMA key que usa el TTS (`${storageKey}.mp3`),
// asi el resto del pipeline (transcribe_audio, render_video) no necesita
// saber de donde salio el audio.
export async function uploadUserAudio(
  storageKey: string,
  buffer: Buffer,
  originalExtension: string
): Promise<Ai33VoiceResult> {
  const workDir = await makeWorkDir("skaler-audio-upload-");
  try {
    const inputPath = nodePath.join(workDir, `input.${originalExtension || "bin"}`);
    const outputPath = nodePath.join(workDir, "output.mp3");
    await writeFile(inputPath, buffer);
    // Mono 128k alcanza de sobra para narracion hablada -- con guiones largos
    // (30-90 min) un 192k estereo se iba arriba del limite de tamaño del
    // bucket de Storage ("The object exceeded the maximum allowed size").
    await runFfmpeg(["-y", "-i", inputPath, "-ar", "44100", "-ac", "1", "-b:a", "128k", outputPath]);

    const durationSeconds = await getAudioDurationSeconds(outputPath);
    if (!durationSeconds) {
      throw new Error("No se pudo medir la duracion del audio subido");
    }

    const publicUrl = await uploadAudioFile(outputPath, storageKey);

    return { storage_key: publicUrl, duration_seconds: Math.round(durationSeconds) };
  } finally {
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[ai33] no se pudo limpiar ${workDir}:`, cleanupError);
    }
  }
}
