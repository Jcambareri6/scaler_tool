import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { EdgeTTS } from "node-edge-tts";
import { supabase } from "./supabase.js";
import { ensureAudioBucket, AUDIO_BUCKET } from "./ai33.js";
import { getAudioDurationSeconds } from "./audioDuration.js";
import { makeWorkDir } from "./workDir.js";

// Prefijo que distingue una voz de Edge TTS (gratis, sin api key) de las
// voces de ai33.pro (minimax_/elevenlabs_/edge_/etc, ver generateVoice.tool.ts) --
// "edge_" ya esta tomado por el motor "edge" que ai33.pro revende con costo,
// asi que se usa "edgetts_" para la integracion directa y gratuita.
export const EDGE_TTS_VOICE_PREFIX = "edgetts_";

export interface EdgeTtsVoiceOption {
  voice_id: string;
  name: string;
  engine: "edgetts";
}

// Catalogo curado (no exhaustivo) de voces neuronales de Microsoft Edge en
// español + un par en ingles -- se puede usar CUALQUIER voz valida de
// Edge/Azure Speech pasandola con el prefijo edgetts_ aunque no figure aca.
export const EDGE_TTS_VOICES: EdgeTtsVoiceOption[] = [
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}es-AR-ElenaNeural`, name: "Elena (Argentina, mujer)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}es-AR-TomasNeural`, name: "Tomas (Argentina, hombre)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}es-MX-DaliaNeural`, name: "Dalia (Mexico, mujer)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}es-MX-JorgeNeural`, name: "Jorge (Mexico, hombre)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}es-ES-ElviraNeural`, name: "Elvira (España, mujer)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}es-ES-AlvaroNeural`, name: "Alvaro (España, hombre)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}es-US-PalomaNeural`, name: "Paloma (US Español, mujer)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}es-US-AlonsoNeural`, name: "Alonso (US Español, hombre)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}en-US-AriaNeural`, name: "Aria (US English, female)", engine: "edgetts" },
  { voice_id: `${EDGE_TTS_VOICE_PREFIX}en-US-GuyNeural`, name: "Guy (US English, male)", engine: "edgetts" },
];

export const DEFAULT_EDGE_TTS_VOICE = "es-AR-ElenaNeural";

// Apagado por default a proposito -- es el mismo protocolo no oficial que
// usa "Leer en voz alta" de Edge (no una API soportada por Microsoft, sin
// SLA ni garantia de que siga andando igual), asi que se mantiene detras de
// un flag explicito para poder probarlo en local sin que quede activo en
// produccion sin querer (mismo criterio que MOCK_PROVIDERS/DISABLE_AUTH en
// lib/mock.ts / auth.middleware.ts).
export function isEdgeTtsEnabled(): boolean {
  return process.env.ENABLE_EDGE_TTS === "true";
}

export interface EdgeTtsResult {
  storage_key: string;
  duration_seconds: number;
}

// Generoso a proposito: Edge TTS genera bastante mas rapido que tiempo
// real, pero un guion largo (varios minutos de narracion) puede tardar mas
// que el default de la libreria (10s) en una red lenta.
const EDGE_TTS_TIMEOUT_MS = 60_000;

interface EdgeSubtitleCue {
  part: string;
  start: number; // ms
  end: number; // ms
}

// Genera audio gratis con el servicio de "Leer en voz alta" de Microsoft
// Edge -- protocolo no oficial (sin api key, sin cuenta) que ya usan varios
// proyectos open source (ver node-edge-tts) -- y lo sube a nuestro propio
// Storage, mismo bucket/convencion que generateWithAi33 (`${storageKey}.mp3`),
// asi que el resto del pipeline (persistAudioAsset, etc.) no distingue de
// donde salio el audio.
export async function generateWithEdgeTts(
  storageKey: string,
  text: string,
  voiceId: string
): Promise<EdgeTtsResult> {
  const workDir = await makeWorkDir("skaler-edge-tts-");
  try {
    const audioPath = path.join(workDir, "speech.mp3");
    const tts = new EdgeTTS({ voice: voiceId, timeout: EDGE_TTS_TIMEOUT_MS, saveSubtitles: true });
    await tts.ttsPromise(text, audioPath);

    const audioBuffer = await readFile(audioPath);

    // Duracion REAL del archivo generado (ffmpeg) -- el timing del ultimo
    // cue de subtitulos que devuelve Edge TTS es el end de la ULTIMA
    // PALABRA reconocida, no el largo real del mp3 (puede quedar corto si
    // Whisper/el propio motor no llega a cubrir el guion completo, dejando
    // el timeline armado con una duracion mayor a la del audio real -- visto
    // en produccion: el render quedaba mas corto que lo que mostraba la UI).
    let durationSeconds = await getAudioDurationSeconds(audioPath);
    if (!durationSeconds) {
      // ffmpeg-static ausente o archivo no leible -- fallback al timing de
      // subtitulos, y si tampoco hay, estimacion por cantidad de palabras.
      try {
        const subtitlesRaw = await readFile(`${audioPath}.json`, "utf-8");
        const cues = JSON.parse(subtitlesRaw) as EdgeSubtitleCue[];
        const lastCue = cues[cues.length - 1];
        if (lastCue) durationSeconds = lastCue.end / 1000;
      } catch {
        // Sin json de subtitulos (texto vacio, o formato inesperado) -- se
        // cae al fallback de abajo.
      }
    }
    if (!durationSeconds) {
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      durationSeconds = Math.max(3, Math.ceil(words / 2.5));
    }

    await ensureAudioBucket();
    const objectPath = `${storageKey}.mp3`;
    const { error: uploadError } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(objectPath, audioBuffer, { contentType: "audio/mpeg", upsert: true });
    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(objectPath);

    return { storage_key: publicUrl, duration_seconds: Math.round(durationSeconds) };
  } catch (error) {
    // node-edge-tts a veces rechaza con un string plano ("Timed out") en vez
    // de un Error -- se normaliza para que tool_executions.error sea legible.
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    // En Windows, rm() a veces tira ENOTEMPTY porque el OS todavia no solto
    // el mp3/json que uso node-edge-tts (mismo problema ya visto y resuelto
    // en renderVideo.tool.ts) -- si esto pasa DESPUES de un audio generado y
    // subido con exito, tirar el error aca pisaba el resultado bueno y hacia
    // parecer que toda la generacion de voz habia fallado.
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[edge_tts] no se pudo limpiar ${workDir}:`, cleanupError);
    }
  }
}
