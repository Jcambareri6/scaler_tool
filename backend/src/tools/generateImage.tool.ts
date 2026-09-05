import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { supabase } from "../lib/supabase.js";
import { withRetry } from "../lib/retry.js";

export interface GenerateImageInput {
  prompt: string;
  scene_id?: string;
}

export interface GenerateImageOutput {
  storage_key: string;
}

// Alternativa mas barata a generate_video para escenas donde no hace falta
// movimiento real (ver render_video.tool.ts: se muestra con efecto Ken
// Burns, zoom/pan lento, en vez de una foto fija) -- mismo proveedor/cuenta
// que generate_video (SnapGen, api.snapgen.org), pero gpt-image-2 sale
// ~$0.01 la imagen contra $0.10+ el clip de video mas corto.
const SNAPGEN_BASE_URL = "https://api.snapgen.org";
const AI_IMAGE_BUCKET = "ai-image";
const REQUEST_TIMEOUT_MS = 60 * 1000;

function randomId(): string {
  return Math.random().toString(36).slice(2);
}

async function ensureAiImageBucket(): Promise<void> {
  const { error } = await supabase.storage.createBucket(AI_IMAGE_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(error.message);
  }
}

async function generateWithSnapgen(prompt: string, apiKey: string, model: string): Promise<GenerateImageOutput> {
  const data = await withRetry(async () => {
    const response = await fetch(`${SNAPGEN_BASE_URL}/v1/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // size "1536x1024" (apaisado) matchea mejor el output fijo 16:9 de
      // render_video.tool.ts que el default cuadrado -- de todas formas se
      // recorta ahi (scale+crop), pero asi el recorte es menor.
      body: JSON.stringify({ model, prompt, size: "1536x1024" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SnapGen image API error (${response.status}): ${body}`);
    }
    return (await response.json()) as { data: { b64_json: string }[] };
  });

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("SnapGen no devolvio una imagen para el pedido");
  }
  const imageBuffer = Buffer.from(b64, "base64");

  await ensureAiImageBucket();
  const path = `${Date.now()}-${randomId()}.png`;
  const { error: uploadError } = await supabase.storage
    .from(AI_IMAGE_BUCKET)
    .upload(path, imageBuffer, { contentType: "image/png", upsert: true });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(AI_IMAGE_BUCKET).getPublicUrl(path);

  return { storage_key: publicUrl };
}

export const generateImageTool: ToolDefinition<
  GenerateImageInput,
  GenerateImageOutput
> = {
  name: "generate_image",
  description:
    "Genera una imagen a partir de un prompt (via SnapGen) cuando no hace falta movimiento real en la escena, y la sube a Storage.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Prompt de generacion de imagen" },
      scene_id: { type: "string", description: "UUID de la escena (opcional)" },
    },
    required: ["prompt"],
  },
  async execute({ prompt }) {
    const provider = await getActiveProvider("snapgen");
    if (!provider?.api_key) {
      if (isMockMode()) {
        return {
          storage_key: "https://picsum.photos/1536/1024",
        };
      }
      throw new ProviderNotConfiguredError("generate_image");
    }

    const model = (provider.configuration?.image_model as string | undefined) ?? "gpt-image-2";
    return generateWithSnapgen(prompt, provider.api_key, model);
  },
};
