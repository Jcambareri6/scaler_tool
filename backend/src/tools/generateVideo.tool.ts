import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { withRetry } from "../lib/retry.js";

export interface GenerateVideoInput {
  prompt: string;
  scene_id?: string;
  duration_seconds?: number;
}

export interface GenerateVideoOutput {
  storage_key: string;
  duration_seconds: number;
}

// Alternativa a search_stock cuando no hay clip de stock que sirva (o
// cuando el usuario elige directamente "IA" como visual_source): genera el
// clip con SnapGen (gateway que reexpone Veo 3.1 / Seedance 2 / Gemini
// Omni) en vez de buscarlo. IMPORTANTE: no confundir con snapgen.ai (la web
// de consumo, sin API) -- esto pega contra api.snapgen.org.
const SNAPGEN_BASE_URL = "https://api.snapgen.org";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 8 * 60 * 1000;
// El fetch nativo de Node no tiene timeout por default -- si la conexion a
// SnapGen se cuelga (red, proxy, TLS lento) sin devolver ni error ni
// response, la promesa queda pendiente para siempre y withRetry nunca llega
// a reintentar porque esta esperando a que fn() termine. Con esto, un
// cuelgue de red se convierte en un timeout normal (retryable) en vez de un
// hang silencioso indefinido.
const SUBMIT_TIMEOUT_MS = 30 * 1000;
const POLL_REQUEST_TIMEOUT_MS = 20 * 1000;
// SnapGen no acepta cualquier duracion -- cada modelo tiene su propio set
// fijo (confirmado contra docs.snapgen.org/api-manual/video/* el
// 2026-09-05): los Veo 3.1 (todas sus variantes: lite, lite-4k, fast,
// fast-4k, fast-ref, quality, quality-4k) son de 8s FIJOS, no un rango: no
// existe "7" ni "6" para estos modelos, el request lo rechazaria. Seedance 2
// (video-ds-2.0 / video-ds-2.0-fast) es el que realmente soporta variantes:
// 5, 10 o 15s.
const VEO_3_1_MODELS = new Set([
  "veo3-1-lite",
  "veo3-1-lite-4k",
  "veo3-1-fast",
  "veo3-1-fast-4k",
  "veo3-1-fast-ref",
  "veo3-1-quality",
  "veo3-1-quality-4k",
]);
const SEEDANCE_2_SECONDS = [5, 10, 15];

// La doc de SnapGen (docs.snapgen.org/api-reference/task-status) dice
// status "completed" y result.videos[].url -- probado contra la API real el
// 2026-09-05 con una key valida, el shape real es DISTINTO: status
// "succeeded" (nunca "completed") y result.urls[] plano, sin el nivel
// "videos". Por eso el polling se quedaba esperando los 8 minutos enteros
// sin detectar nunca que habia terminado, aunque SnapGen ya tenia el video
// listo en ~1 minuto. Se dejan ambos shapes soportados (por las dudas
// otro modelo/version devuelva el de la doc) pero SIN confiar en el string
// exacto de `status` para decidir si termino -- eso es lo que fallo.
interface SnapgenTaskResponse {
  id: string;
  status: string;
  result: { urls?: string[]; videos?: { url: string[]; expires_at?: number }[] } | null;
  error: { message: string } | null;
}

function extractVideoUrl(task: SnapgenTaskResponse): string | undefined {
  return task.result?.urls?.[0] ?? task.result?.videos?.[0]?.url?.[0];
}

function closestSupportedSeconds(target: number, model: string): number {
  const supported = VEO_3_1_MODELS.has(model) ? [8] : SEEDANCE_2_SECONDS;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best
  );
}

async function pollSnapgenTask(taskId: string, apiKey: string): Promise<SnapgenTaskResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const task = await withRetry(
      async () => {
        const response = await fetch(`${SNAPGEN_BASE_URL}/v1/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`SnapGen task API error (${response.status}): ${body}`);
        }
        return (await response.json()) as SnapgenTaskResponse;
      },
      { retries: 2 }
    );
    if (task.error) {
      throw new Error(`SnapGen video task failed: ${task.error.message}`);
    }
    if (extractVideoUrl(task)) return task;

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("SnapGen video task timed out");
}

async function generateWithSnapgen(
  prompt: string,
  durationSeconds: number,
  apiKey: string,
  model: string
): Promise<GenerateVideoOutput> {
  const seconds = closestSupportedSeconds(durationSeconds, model);

  console.log(`[generate_video] submitting to SnapGen (model=${model}, seconds=${seconds})`);
  // SIN retry automatico: a diferencia de search_stock/generate_stock_keywords
  // (llamadas de solo lectura, seguras de repetir), este POST arranca una
  // generacion que SnapGen cobra apenas la acepta. Si la respuesta tarda mas
  // de SUBMIT_TIMEOUT_MS o la conexion se corta, NO hay forma de saber si
  // SnapGen ya recibio y arranco el pedido (y ya lo cobro) o no -- withRetry
  // trataba ese caso ("sin status HTTP identificable") como retryable y
  // reintentaba el POST hasta 3 veces mas, pudiendo disparar varios pedidos
  // pagos en paralelo para una sola generacion que el usuario nunca llego a
  // ver (plata gastada sin nada persistido). Mejor fallar fuerte y que el
  // reintento sea una decision explicita del usuario (click de nuevo), no
  // automatica y silenciosa.
  const response = await fetch(`${SNAPGEN_BASE_URL}/v1/videos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    // aspect_ratio es requerido por Veo 3.1 / Seedance 2 (docs.snapgen.org):
    // 16:9 matchea la salida fija de render_video.tool.ts (1280x720).
    body: JSON.stringify({ model, prompt, seconds: String(seconds), aspect_ratio: "16:9" }),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SnapGen API error (${response.status}): ${body}`);
  }
  const submitted = (await response.json()) as { id: string };
  if (!submitted.id) {
    throw new Error("SnapGen no devolvio id de tarea para el pedido de video");
  }
  console.log(`[generate_video] task ${submitted.id} queued, polling...`);

  const task = await pollSnapgenTask(submitted.id, apiKey);
  const videoUrl = extractVideoUrl(task);
  if (!videoUrl) {
    throw new Error("SnapGen no devolvio una URL de video para la tarea completada");
  }
  console.log(`[generate_video] task ${submitted.id} completed.`);

  // La URL de SnapGen vence a los 14 dias (segun su doc), pero se usa
  // directa como storage_key en vez de descargarla y volver a subirla a
  // Storage propio: render_video.tool.ts ya descarga cada clip de nuevo al
  // momento de renderizar, asi que alcanza sobra dentro de esa ventana, y
  // evita el paso extra (descarga + upload) como punto de falla.
  return { storage_key: videoUrl, duration_seconds: seconds };
}

export const generateVideoTool: ToolDefinition<GenerateVideoInput, GenerateVideoOutput> = {
  name: "generate_video",
  description:
    "Genera un clip de video con IA (SnapGen) a partir de un prompt cuando no hay stock adecuado o el usuario elige IA como fuente visual.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Prompt de generacion de video (en ingles, descriptivo)" },
      scene_id: { type: "string", description: "UUID de la escena (opcional, solo trazabilidad)" },
      duration_seconds: { type: "number", description: "Duracion objetivo del clip (se redondea al valor soportado mas cercano)" },
    },
    required: ["prompt"],
  },
  async execute({ prompt, duration_seconds }) {
    const provider = await getActiveProvider("snapgen");
    if (!provider?.api_key) {
      if (isMockMode()) {
        return {
          storage_key: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          duration_seconds: duration_seconds ?? 5,
        };
      }
      throw new ProviderNotConfiguredError("generate_video");
    }

    const model = (provider.configuration?.model as string | undefined) ?? "veo3-1-lite";
    return generateWithSnapgen(prompt, duration_seconds ?? 5, provider.api_key, model);
  },
};
