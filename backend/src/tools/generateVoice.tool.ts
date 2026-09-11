import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { generateWithAi33 } from "../lib/ai33.js";

export interface GenerateVoiceInput {
  script_id: string;
  text: string;
  voice_id?: string;
}

export interface GenerateVoiceOutput {
  storage_key: string;
  duration_seconds: number;
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
        return {
          storage_key: `mock://audio/${script_id}.mp3`,
          duration_seconds: Math.max(10, Math.ceil(words / 2.5)),
        };
      }
      throw new ProviderNotConfiguredError("generate_voice");
    }

    const resolvedVoiceId =
      voice_id ?? (provider.configuration?.voice_id as string | undefined) ?? DEFAULT_VOICE_ID;

    return generateWithAi33(script_id, text, provider.api_key, resolvedVoiceId);
  },
};
