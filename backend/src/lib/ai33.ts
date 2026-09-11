import { supabase } from "./supabase.js";
import { withRetry } from "./retry.js";
import { fetchWithTimeout } from "./http.js";

export const AI33_BASE_URL = "https://api.ai33.pro";
export const AUDIO_BUCKET = "audio";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

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

  await ensureAudioBucket();
  const path = `${storageKey}.mp3`;
  const { error: uploadError } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(path, audioBuffer, { contentType: "audio/mpeg", upsert: true });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path);

  // ai33.pro no confirma en su doc que la tarea de TTS traiga duracion en
  // metadata -- si no viene, se estima por cantidad de palabras (mismo
  // fallback que usa build_timeline mientras no hay transcripcion real).
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const durationSeconds = task.metadata?.duration ?? Math.max(10, Math.ceil(words / 2.5));

  return { storage_key: publicUrl, duration_seconds: Math.round(durationSeconds) };
}
