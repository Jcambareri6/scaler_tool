import { createHash } from "node:crypto";
import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { generateWithAi33 } from "../lib/ai33.js";
import { generateWithEdgeTts, isEdgeTtsEnabled, EDGE_TTS_VOICE_PREFIX } from "../lib/edgeTts.js";

export interface PreviewVoiceInput {
  voice_id: string;
  // Ignorado: la muestra usa siempre DEFAULT_SAMPLE_TEXT (ver execute).
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

// Muestras ya generadas en este proceso, por voice_id: escuchar la misma voz
// de nuevo (cualquier usuario) no vuelve a pegarle a ai33. Se pierde al
// reiniciar la API, pero con texto fijo cada voz cuesta una sola vez por
// proceso y el mp3 en Storage queda en la misma key.
const previewCache = new Map<string, PreviewVoiceOutput>();

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
    },
    required: ["voice_id"],
  },
  async execute({ voice_id }) {
    // Texto fijo a proposito: con texto libre, cada muestra podia ser un
    // pedido de TTS de cualquier largo pagado con el credito de ai33.
    const text = DEFAULT_SAMPLE_TEXT;
    const cached = previewCache.get(voice_id);
    if (cached) return cached;

    if (voice_id.startsWith(EDGE_TTS_VOICE_PREFIX)) {
      if (!isEdgeTtsEnabled()) {
        throw new Error("Edge TTS no esta habilitado en este entorno (falta ENABLE_EDGE_TTS=true)");
      }
      const edgeVoiceId = voice_id.slice(EDGE_TTS_VOICE_PREFIX.length);
      const storageKey = `previews/${voice_id}-${hashText(text)}`;
      const result = await generateWithEdgeTts(storageKey, text, edgeVoiceId);
      const output = { audio_url: result.storage_key, duration_seconds: result.duration_seconds };
      previewCache.set(voice_id, output);
      return output;
    }

    const provider = await getActiveProvider("ai33");
    if (!provider?.api_key) {
      if (isMockMode()) {
        return { audio_url: `mock://audio/preview-${voice_id}.mp3`, duration_seconds: 3 };
      }
      throw new ProviderNotConfiguredError("preview_voice");
    }

    // Key estable por (voice_id + texto), con upsert:true en el storage.
    const storageKey = `previews/${voice_id}-${hashText(text)}`;
    const result = await generateWithAi33(storageKey, text, provider.api_key, voice_id);
    const output = { audio_url: result.storage_key, duration_seconds: result.duration_seconds };
    previewCache.set(voice_id, output);
    return output;
  },
};
