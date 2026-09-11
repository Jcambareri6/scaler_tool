import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { fetchWithTimeout } from "../lib/http.js";
import { AI33_BASE_URL } from "../lib/ai33.js";

export interface ListVoicesInput {
  [key: string]: never;
}

export interface VoiceOption {
  voice_id: string;
  name: string;
  engine: string;
}

export interface ListVoicesOutput {
  voices: VoiceOption[];
}

// ai33.pro no tiene un endpoint unico para "todas las voces" -- GET
// /v3/voices exige un query param `provider` con el motor puntual (devuelve
// 400 "unsupported_voice_provider" si no se manda). Se consulta cada motor
// soportado por separado y se fusionan los resultados.
const AI33_PROVIDERS = [
  "minimax",
  "elevenlabs",
  "edge",
  "kokoro",
  "vbee",
  "fishaudio",
  "clone",
] as const;

const MOCK_VOICES: VoiceOption[] = [
  { voice_id: "minimax_209539195289677", name: "Minimax (default)", engine: "minimax" },
  { voice_id: "elevenlabs_sample_voice", name: "ElevenLabs (mock)", engine: "elevenlabs" },
  { voice_id: "edge_sample_voice", name: "Edge TTS (mock)", engine: "edge" },
];

// La forma exacta del body de GET /v3/voices?provider=X no esta
// documentada -- se acepta tanto un array plano como un objeto
// { voices: [...] } / { data: [...] }, y se toleran distintos nombres de
// campo para id/nombre.
function normalizeAi33Voices(raw: unknown, engine: string): VoiceOption[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { voices?: unknown[] })?.voices)
      ? (raw as { voices: unknown[] }).voices
      : Array.isArray((raw as { data?: unknown[] })?.data)
        ? (raw as { data: unknown[] }).data
        : [];

  return list
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      const voiceId = (item.voice_id ?? item.id ?? item.voiceId) as string | undefined;
      if (!voiceId) return null;
      const name = (item.name ?? item.voice_name ?? voiceId) as string;
      return { voice_id: voiceId, name, engine };
    })
    .filter((voice): voice is VoiceOption => voice !== null);
}

// Un motor sin acceso/plan en la cuenta (o momentaneamente caido) no debe
// tirar abajo el listado completo -- se lo saltea y se sigue con el resto.
async function fetchVoicesForProvider(
  engine: string,
  apiKey: string
): Promise<{ voices: VoiceOption[]; ok: boolean }> {
  try {
    const response = await fetchWithTimeout(`${AI33_BASE_URL}/v3/voices?provider=${engine}`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!response.ok) return { voices: [], ok: false };
    const raw = await response.json();
    return { voices: normalizeAi33Voices(raw, engine), ok: true };
  } catch {
    return { voices: [], ok: false };
  }
}

export const listVoicesTool: ToolDefinition<ListVoicesInput, ListVoicesOutput> = {
  name: "list_voices",
  description: "Lista las voces disponibles en ai33.pro (Minimax/ElevenLabs/Edge/etc.)",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    const provider = await getActiveProvider("ai33");
    if (!provider?.api_key) {
      if (isMockMode()) return { voices: MOCK_VOICES };
      throw new ProviderNotConfiguredError("list_voices");
    }

    const results = await Promise.all(
      AI33_PROVIDERS.map((engine) => fetchVoicesForProvider(engine, provider.api_key!))
    );

    // Si TODOS los motores fallaron (ej. api key invalida), es un problema
    // real de configuracion -- no un catalogo vacio -- asi que se avisa en
    // vez de devolver silenciosamente una lista vacia.
    if (results.every((r) => !r.ok)) {
      throw new Error("ai33.pro no devolvio voces para ningun motor -- revisa la api key del provider");
    }

    return { voices: results.flatMap((r) => r.voices) };
  },
};
