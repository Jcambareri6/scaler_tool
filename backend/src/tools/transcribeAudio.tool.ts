import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "module";
import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { supabase } from "../lib/supabase.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";

// ffmpeg-static es CJS puro -- mismo patron que renderVideo.tool.ts.
const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

// Whisper transcribe un audio completo (varios minutos) en una sola
// request no-stream -- mas lento que una llamada de chat corta.
const WHISPER_TIMEOUT_MS = 3 * 60 * 1000;

// Limite real de /v1/audio/transcriptions es 26214400 bytes (25MB) -- se
// deja margen de seguridad porque el tamaño final tras re-encodear no es
// exacto.
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;

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

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg-static no resolvio el binario de ffmpeg"));
      return;
    }
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg salio con codigo ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

// Los guiones largos (generate_script con approx_chars alto) producen
// narraciones que pueden superar el limite de 25MB de Whisper -- ai33.pro
// no da control sobre el bitrate de salida del TTS, asi que se re-encodea
// aca a 16kHz mono (la frecuencia interna que usa Whisper igual, sin
// perdida de calidad de transcripcion) antes de mandarlo, si hace falta.
async function compressForWhisper(buffer: Buffer): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), "skaler-whisper-"));
  const inputPath = path.join(workDir, "input.mp3");
  const outputPath = path.join(workDir, "output.mp3");
  try {
    await writeFile(inputPath, buffer);
    await runFfmpeg(["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-b:a", "64k", outputPath]);
    return Buffer.from(await readFile(outputPath));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// Whisper no es un servicio aparte -- es el modelo de transcripcion de
// OpenAI (endpoint /v1/audio/transcriptions), asi que reusa el mismo
// Provider "openai" que ya usan generate_script/el Agent en vez de pedir
// una key propia.
async function transcribeWithOpenAI(
  storageKey: string,
  apiKey: string
): Promise<TranscribeAudioOutput> {
  const audioResponse = await fetchWithTimeout(storageKey);
  if (!audioResponse.ok) {
    throw new Error(`No se pudo descargar el audio a transcribir (${audioResponse.status})`);
  }
  let audioBuffer: Buffer = Buffer.from(await audioResponse.arrayBuffer());
  let filename = storageKey.split("/").pop()?.split("?")[0] || "audio.mp3";

  if (audioBuffer.byteLength > WHISPER_MAX_BYTES) {
    audioBuffer = await compressForWhisper(audioBuffer);
    filename = "compressed.mp3";
    if (audioBuffer.byteLength > WHISPER_MAX_BYTES) {
      throw new Error(
        `El audio sigue superando el limite de Whisper (25MB) despues de comprimirlo (${audioBuffer.byteLength} bytes) -- el guion es demasiado largo para transcribirlo en una sola pasada`
      );
    }
  }

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(audioBuffer)]), filename);
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");
  formData.append("timestamp_granularities[]", "segment");

  const data = await withRetry(async () => {
    const response = await fetchWithTimeout(
      OPENAI_TRANSCRIPTIONS_URL,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      },
      WHISPER_TIMEOUT_MS
    );

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
