import { createHash } from "node:crypto";
import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { generateWithAi33 } from "../lib/ai33.js";

export interface PreviewVoiceInput {
  voice_id: string;
  sample_text?: string;
}

export interface PreviewVoiceOutput {
  audio_url: string;
  duration_seconds: number;
}

const DEFAULT_SAMPLE_TEXT = "Hola, esta es una prueba de esta voz para tu proyecto.";

function hashText(text: string): string {
  return createHash("md5").update(text).digest("hex").slice(0, 8);
}

export const previewVoiceTool: ToolDefinition<PreviewVoiceInput, PreviewVoiceOutput> = {
  name: "preview_voice",
  description: "Genera un clip corto de audio para escuchar como suena una voz antes de usarla.",
  parameters: {
    type: "object",
    properties: {
      voice_id: {
        type: "string",
        description: "Voz con prefijo de proveedor (ej: minimax_..., elevenlabs_...)",
      },
      sample_text: {
        type: "string",
        description: "Texto de prueba (opcional, default: frase corta generica)",
      },
    },
    required: ["voice_id"],
  },
  async execute({ voice_id, sample_text }) {
    const provider = await getActiveProvider("ai33");
    if (!provider?.api_key) {
      if (isMockMode()) {
        return { audio_url: `mock://audio/preview-${voice_id}.mp3`, duration_seconds: 3 };
      }
      throw new ProviderNotConfiguredError("preview_voice");
    }

    const text = sample_text?.trim() || DEFAULT_SAMPLE_TEXT;
    // Key estable por (voice_id + texto), con upsert:true en el storage --
    // escuchar la misma voz con el mismo texto de nuevo no vuelve a pegarle
    // a ai33.pro, reusa el mp3 ya generado.
    const storageKey = `previews/${voice_id}-${hashText(text)}`;
    const result = await generateWithAi33(storageKey, text, provider.api_key, voice_id);
    return { audio_url: result.storage_key, duration_seconds: result.duration_seconds };
  },
};
