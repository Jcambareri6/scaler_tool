import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";

export interface GenerateVoiceInput {
  script_id: string;
  text: string;
  voice_id?: string;
}

export interface GenerateVoiceOutput {
  storage_key: string;
  duration_seconds: number;
}

// Orden de proveedor definido en el LEEME (seccion 10): ElevenLabs primero,
// Gemini solo como fallback si ElevenLabs falla.
export const generateVoiceTool: ToolDefinition<
  GenerateVoiceInput,
  GenerateVoiceOutput
> = {
  name: "generate_voice",
  description:
    "Convierte texto a voz (ElevenLabs -> Gemini fallback) y sube el audio a Storage.",
  parameters: {
    type: "object",
    properties: {
      script_id: { type: "string", description: "UUID del script a narrar" },
      text: { type: "string", description: "Texto a convertir en voz" },
      voice_id: { type: "string", description: "Voz especifica del provider (opcional)" },
    },
    required: ["script_id", "text"],
  },
  async execute({ script_id, text }) {
    const provider = await getActiveProvider("elevenlabs");
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
    // Provider configurado, pero el cliente HTTP de ElevenLabs todavia no
    // esta implementado.
    throw new Error(
      `Provider "elevenlabs" is active but its API client is not implemented yet`
    );
  },
};
