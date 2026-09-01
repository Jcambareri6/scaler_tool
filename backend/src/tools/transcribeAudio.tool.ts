import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { supabase } from "../lib/supabase.js";

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

  return { words: transcribedWords, segments };
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
    const provider = await getActiveProvider("whisper");
    if (!provider?.api_key) {
      if (isMockMode()) {
        return mockTranscribe(asset_id);
      }
      throw new ProviderNotConfiguredError("transcribe_audio");
    }
    throw new Error(
      `Provider "whisper" is active but its client is not implemented yet`
    );
  },
};
