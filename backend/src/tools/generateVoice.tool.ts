import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { generateWithAi33 } from "../lib/ai33.js";
import { supabase } from "../lib/supabase.js";

export interface GenerateVoiceInput {
  script_id: string;
  text: string;
  voice_id?: string;
}

export interface GenerateVoiceOutput {
  storage_key: string;
  duration_seconds: number;
  asset_id: string;
}

// La Tool persiste su propio Asset (mismo criterio que generate_script
// self-persiste en `scripts`) -- asi el resultado queda disponible tanto
// si la corre el pipeline (orchestrator.ts) como si la llama directo el
// tab Audio via POST /tools/generate_voice/execute, que no tiene ningun
// paso propio de persistencia (ver tool.service.ts::executeTool).
async function persistAudioAsset(
  scriptId: string,
  storageKey: string,
  durationSeconds: number
): Promise<string> {
  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("video_project_id")
    .eq("id", scriptId)
    .single();
  if (scriptError || !script) {
    throw new Error(`No se encontro el script ${scriptId} para asociar el audio`);
  }

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .insert({
      video_project_id: script.video_project_id,
      scene_id: null,
      type: "AUDIO",
      storage_key: storageKey,
      metadata: { duration_seconds: durationSeconds },
    })
    .select("id")
    .single();
  if (assetError || !asset) {
    throw new Error(assetError?.message ?? "No se pudo guardar el Asset de audio");
  }

  return asset.id;
}

// Voz real confirmada contra GET /v3/voices en la cuenta del proyecto --
// se puede pisar por provider.configuration.voice_id (o input.voice_id)
// con cualquier voz con prefijo de proveedor (minimax_, elevenlabs_,
// clone_, edge_, kokoro_, vbee_, fishaudio_).
const DEFAULT_VOICE_ID = "minimax_209539195289677";

export const generateVoiceTool: ToolDefinition<
  GenerateVoiceInput,
  GenerateVoiceOutput
> = {
  name: "generate_voice",
  description:
    "Convierte texto a voz (ai33.pro -- Minimax/ElevenLabs/etc. segun el voice_id) y sube el audio a Storage.",
  parameters: {
    type: "object",
    properties: {
      script_id: { type: "string", description: "UUID del script a narrar" },
      text: { type: "string", description: "Texto a convertir en voz" },
      voice_id: {
        type: "string",
        description:
          "Voz con prefijo de proveedor (ej: minimax_..., elevenlabs_..., clone_...) -- opcional",
      },
    },
    required: ["script_id", "text"],
  },
  async execute({ script_id, text, voice_id }) {
    const provider = await getActiveProvider("ai33");
    if (!provider?.api_key) {
      if (isMockMode()) {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const storageKey = `mock://audio/${script_id}.mp3`;
        const durationSeconds = Math.max(10, Math.ceil(words / 2.5));
        const assetId = await persistAudioAsset(script_id, storageKey, durationSeconds);
        return { storage_key: storageKey, duration_seconds: durationSeconds, asset_id: assetId };
      }
      throw new ProviderNotConfiguredError("generate_voice");
    }

    const resolvedVoiceId =
      voice_id ?? (provider.configuration?.voice_id as string | undefined) ?? DEFAULT_VOICE_ID;

    const result = await generateWithAi33(script_id, text, provider.api_key, resolvedVoiceId);
    const assetId = await persistAudioAsset(script_id, result.storage_key, result.duration_seconds);
    return { ...result, asset_id: assetId };
  },
};
