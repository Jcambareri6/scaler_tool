import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { supabase } from "../lib/supabase.js";
import { withRetry } from "../lib/retry.js";

export interface TranscribeAudioInput {
  asset_id: string;
}

export interface TranscribedWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscribedSegment {
  text: string;
  start: number;
  end: number;
}

export interface TranscribeAudioOutput {
  words: TranscribedWord[];
  segments: TranscribedSegment[];
  // Duracion REAL del archivo de audio (Whisper la calcula del archivo en
  // si) -- distinta del end de la ultima palabra, que casi siempre queda
  // unos segundos antes del final real (silencio/fade de cola). build_scenes
  // la usa para que la ultima escena llegue hasta el final de verdad del
  // audio, si no el ultimo clip de video queda "pegado" en loop durante ese
  // resto sin transicion ni corte.
  duration_seconds?: number;
}

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

// Whisper no es un servicio aparte -- es el modelo de transcripcion de
// OpenAI (endpoint /v1/audio/transcriptions), asi que reusa el mismo
// Provider "openai" que ya usan generate_script/el Agent en vez de pedir
// una key propia.
async function transcribeWithOpenAI(
  storageKey: string,
  apiKey: string
): Promise<TranscribeAudioOutput> {
  const audioResponse = await fetch(storageKey);
  if (!audioResponse.ok) {
    throw new Error(`No se pudo descargar el audio a transcribir (${audioResponse.status})`);
  }
  const audioBlob = await audioResponse.blob();
  const filename = storageKey.split("/").pop()?.split("?")[0] || "audio.mp3";

  const formData = new FormData();
  formData.append("file", audioBlob, filename);
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");
  formData.append("timestamp_granularities[]", "segment");

  const data = await withRetry(async () => {
    const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI transcription API error (${response.status}): ${body}`);
    }

    return (await response.json()) as {
      words?: { word: string; start: number; end: number }[];
      segments?: { text: string; start: number; end: number }[];
      duration?: number;
    };
  });

  return {
    words: (data.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
    segments: (data.segments ?? []).map((s) => ({ text: s.text.trim(), start: s.start, end: s.end })),
    ...(data.duration !== undefined ? { duration_seconds: data.duration } : {}),
  };
}

async function mockTranscribe(assetId: string): Promise<TranscribeAudioOutput> {
  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("video_project_id, metadata")
    .eq("id", assetId)
    .single();
  if (assetError || !asset) {
    throw new Error("Asset not found");
  }

  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("content")
    .eq("video_project_id", asset.video_project_id)
    .single();
  if (scriptError || !script) {
    throw new Error("El proyecto no tiene guion todavia");
  }

  const text = ((script.content as { text?: string } | null)?.text) ?? "";
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const duration =
    (asset.metadata as { duration_seconds?: number } | null)?.duration_seconds ??
    Math.max(10, Math.ceil(words.length / 2.5));

  const perWord = words.length > 0 ? duration / words.length : 0;
  const transcribedWords: TranscribedWord[] = words.map((word, i) => ({
    word,
    start: Number((i * perWord).toFixed(2)),
    end: Number(((i + 1) * perWord).toFixed(2)),
  }));

  const segments: TranscribedSegment[] = [];
  const segmentSize = 10;
  for (let i = 0; i < transcribedWords.length; i += segmentSize) {
    const chunk = transcribedWords.slice(i, i + segmentSize);
    if (chunk.length === 0) continue;
    segments.push({
      text: chunk.map((w) => w.word).join(" "),
      start: chunk[0]!.start,
      end: chunk[chunk.length - 1]!.end,
    });
  }

  return { words: transcribedWords, segments, duration_seconds: duration };
}

export const transcribeAudioTool: ToolDefinition<
  TranscribeAudioInput,
  TranscribeAudioOutput
> = {
  name: "transcribe_audio",
  description:
    "Transcribe un audio (Whisper) y devuelve timing por palabra/segmento para sincronizar overlays.",
  parameters: {
    type: "object",
    properties: {
      asset_id: { type: "string", description: "UUID del asset de audio a transcribir" },
    },
    required: ["asset_id"],
  },
  async execute({ asset_id }) {
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("storage_key")
      .eq("id", asset_id)
      .single();
    if (assetError || !asset) {
      throw new Error("Asset not found");
    }

    // El audio "mock" (generate_voice todavia sin ElevenLabs conectado) no
    // es un archivo real -- no hay nada que descargar y transcribir, asi
    // que se mockea tambien esta parte para no romper el pipeline de
    // prueba end-to-end mientras falta ese provider.
    if (asset.storage_key.startsWith("mock://")) {
      return mockTranscribe(asset_id);
    }

    const provider = await getActiveProvider("openai");
    if (!provider?.api_key) {
      if (isMockMode()) {
        return mockTranscribe(asset_id);
      }
      throw new ProviderNotConfiguredError("transcribe_audio");
    }

    return transcribeWithOpenAI(asset.storage_key, provider.api_key);
  },
};
