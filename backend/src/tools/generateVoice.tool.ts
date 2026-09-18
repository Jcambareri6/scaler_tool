import { createHash } from "node:crypto";
import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { generateWithAi33 } from "../lib/ai33.js";
import { generateWithEdgeTts, isEdgeTtsEnabled, EDGE_TTS_VOICE_PREFIX, DEFAULT_EDGE_TTS_VOICE } from "../lib/edgeTts.js";
import { supabase } from "../lib/supabase.js";
import { getOwnedScript } from "../lib/ownership.js";

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
  durationSeconds: number,
  voiceKey: string,
  textHash: string
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
      metadata: { duration_seconds: durationSeconds, voice_key: voiceKey, text_hash: textHash },
    })
    .select("id")
    .single();
  if (assetError || !asset) {
    throw new Error(assetError?.message ?? "No se pudo guardar el Asset de audio");
  }

  return asset.id;
}

function hashText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

// Evita pagar TTS de nuevo por el mismo guion+voz -- antes de este chequeo,
// probar una voz en el tab Audio ("Guardar audio para guion") y despues
// correr el pipeline completo desde Preview ("Generar video") generaba (y
// facturaba) la narracion DOS veces: el pipeline llama a generate_voice sin
// saber que ya existe un audio guardado (ver orchestrator.ts paso 1). Si el
// texto o la voz cambiaron, el hash no matchea y se regenera normal.
async function findReusableAudioAsset(
  videoProjectId: string,
  voiceKey: string,
  textHash: string
): Promise<GenerateVoiceOutput | null> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, storage_key, metadata")
    .eq("video_project_id", videoProjectId)
    .eq("type", "AUDIO")
    .is("scene_id", null)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data) return null;

  const match = data.find((row) => {
    const metadata = row.metadata as { voice_key?: string; text_hash?: string } | null;
    return metadata?.voice_key === voiceKey && metadata?.text_hash === textHash;
  });
  if (!match) return null;

  const metadata = match.metadata as { duration_seconds?: number } | null;
  return {
    storage_key: match.storage_key,
    duration_seconds: metadata?.duration_seconds ?? 0,
    asset_id: match.id,
  };
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
  async execute({ script_id, text, voice_id }, ctx) {
    const script = await getOwnedScript(script_id, ctx.userId);
    if (!script) {
      throw new Error("Script not found");
    }

    const voiceKey = voice_id ?? "__default__";
    const textHash = hashText(text);
    const reusable = await findReusableAudioAsset(script.video_project_id, voiceKey, textHash);
    if (reusable) {
      return reusable;
    }

    // Voz de Edge TTS pedida explicitamente (gratis, sin api key) -- solo
    // disponible si ENABLE_EDGE_TTS=true (ver lib/edgeTts.ts), para no
    // depender en produccion de un protocolo no oficial sin SLA.
    if (voice_id?.startsWith(EDGE_TTS_VOICE_PREFIX)) {
      if (!isEdgeTtsEnabled()) {
        throw new Error("Edge TTS no esta habilitado en este entorno (falta ENABLE_EDGE_TTS=true)");
      }
      const edgeVoiceId = voice_id.slice(EDGE_TTS_VOICE_PREFIX.length);
      const result = await generateWithEdgeTts(script_id, text, edgeVoiceId);
      const assetId = await persistAudioAsset(script_id, result.storage_key, result.duration_seconds, voiceKey, textHash);
      return { ...result, asset_id: assetId };
    }

    const provider = await getActiveProvider("ai33");
    if (!provider?.api_key) {
      if (isMockMode()) {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const storageKey = `mock://audio/${script_id}.mp3`;
        const durationSeconds = Math.max(10, Math.ceil(words / 2.5));
        const assetId = await persistAudioAsset(script_id, storageKey, durationSeconds, voiceKey, textHash);
        return { storage_key: storageKey, duration_seconds: durationSeconds, asset_id: assetId };
      }
      // Sin ai33 configurado (y sin pedir una voz suya puntual): solo se
      // cae a Edge TTS si esta habilitado explicitamente -- si no, mismo
      // error que antes de agregar esta integracion.
      if (isEdgeTtsEnabled()) {
        const result = await generateWithEdgeTts(script_id, text, DEFAULT_EDGE_TTS_VOICE);
        const assetId = await persistAudioAsset(script_id, result.storage_key, result.duration_seconds, voiceKey, textHash);
        return { ...result, asset_id: assetId };
      }
      throw new ProviderNotConfiguredError("generate_voice");
    }

    const resolvedVoiceId =
      voice_id ?? (provider.configuration?.voice_id as string | undefined) ?? DEFAULT_VOICE_ID;

    const result = await generateWithAi33(script_id, text, provider.api_key, resolvedVoiceId);
    const assetId = await persistAudioAsset(script_id, result.storage_key, result.duration_seconds, voiceKey, textHash);
    return { ...result, asset_id: assetId };
  },
};
