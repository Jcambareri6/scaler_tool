import type { ToolDefinition } from "./tool.types.js";
import { getOwnedProject } from "../lib/ownership.js";
import { supabase } from "../lib/supabase.js";
import type { TranscribedWord } from "./transcribeAudio.tool.js";

export interface BuildScenesInput {
  video_project_id: string;
}

export interface BuiltScene {
  order: number;
  text: string;
  timeStart: string;
  timeEnd: string;
}

export interface BuildScenesOutput {
  scenes: BuiltScene[];
}

// LEEME (seccion 5): las escenas se arman DESPUES de tener audio real y
// transcripcion (Whisper), no adivinadas por el guionista al mismo tiempo
// que escribe el texto -- asi el limite de cada escena cae exactamente
// donde se dice esa parte en la voz real, en vez de una aproximacion.
const TARGET_SCENE_SECONDS = 35;
const MAX_SCENE_SECONDS = 60;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// Split deterministico por oraciones -- no hace falta un LLM para esto, y
// mantenerlo mecanico evita otro punto donde el texto de la escena pueda
// desviarse del full_text real.
function splitIntoSentences(fullText: string): string[] {
  const sentences: string[] = [];
  const regex = /[^.!?]+[.!?]+(?:\s+|$)/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = regex.exec(fullText)) !== null) {
    sentences.push(match[0].trim());
    lastIndex = regex.lastIndex;
  }
  const rest = fullText.slice(lastIndex).trim();
  if (rest) sentences.push(rest);
  return sentences.filter(Boolean);
}

interface AlignedSentence {
  text: string;
  start: number;
  end: number;
}

// Las oraciones concatenadas reconstruyen full_text en orden, igual que las
// escenas lo hacian antes -- alcanza con consumir la lista de palabras
// transcriptas de forma secuencial (mismo criterio que
// buildTimeline.tool.ts::alignScenesToWords, pero a nivel oracion).
function alignSentencesToWords(sentences: string[], words: TranscribedWord[]): AlignedSentence[] {
  const aligned: AlignedSentence[] = [];
  let wordIndex = 0;

  for (const sentence of sentences) {
    const count = wordCount(sentence);
    if (count === 0) continue;

    const slice = words.slice(wordIndex, wordIndex + count);
    if (slice.length === 0) break;

    aligned.push({ text: sentence, start: slice[0]!.start, end: slice[slice.length - 1]!.end });
    wordIndex += slice.length;
  }

  return aligned;
}

// Agrupa oraciones consecutivas en escenas apuntando a TARGET_SCENE_SECONDS
// de narracion real, sin pasar MAX_SCENE_SECONDS -- nunca corta a mitad de
// una oracion.
function groupIntoScenes(sentences: AlignedSentence[]): { text: string; start: number; end: number }[] {
  const scenes: { text: string; start: number; end: number }[] = [];
  let current: AlignedSentence[] = [];

  for (const sentence of sentences) {
    if (current.length > 0) {
      const wouldBeDuration = sentence.end - current[0]!.start;
      if (wouldBeDuration > MAX_SCENE_SECONDS) {
        scenes.push(commitScene(current));
        current = [];
      }
    }

    current.push(sentence);
    const currentDuration = sentence.end - current[0]!.start;
    if (currentDuration >= TARGET_SCENE_SECONDS) {
      scenes.push(commitScene(current));
      current = [];
    }
  }

  if (current.length > 0) scenes.push(commitScene(current));
  return scenes;
}

function commitScene(sentences: AlignedSentence[]): { text: string; start: number; end: number } {
  return {
    text: sentences.map((s) => s.text).join(" "),
    start: sentences[0]!.start,
    end: sentences[sentences.length - 1]!.end,
  };
}

function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export const buildScenesTool: ToolDefinition<BuildScenesInput, BuildScenesOutput> = {
  name: "build_scenes",
  description:
    "Arma las escenas del proyecto a partir del guion y el timing real de la voz ya transcripta (Whisper). Reemplaza cualquier escena previa.",
  parameters: {
    type: "object",
    properties: {
      video_project_id: { type: "string", description: "UUID del proyecto" },
    },
    required: ["video_project_id"],
  },
  async execute({ video_project_id }, ctx) {
    const project = await getOwnedProject(video_project_id, ctx.userId);
    if (!project) {
      throw new Error("Project not found");
    }

    const { data: script, error: scriptError } = await supabase
      .from("scripts")
      .select("id, content")
      .eq("video_project_id", video_project_id)
      .single();
    if (scriptError || !script) {
      throw new Error("El proyecto no tiene guion todavia");
    }

    const fullText = ((script.content as { text?: string } | null)?.text) ?? "";
    if (!fullText.trim()) {
      throw new Error("El guion del proyecto esta vacio");
    }

    const { data: timeline } = await supabase
      .from("timelines")
      .select("content")
      .eq("video_project_id", video_project_id)
      .maybeSingle();
    const timelineContent = timeline?.content as { words?: TranscribedWord[]; duration_seconds?: number } | null;
    const words = timelineContent?.words ?? [];
    const audioDurationSeconds = timelineContent?.duration_seconds;
    if (words.length === 0) {
      throw new Error(
        "Todavia no hay transcripcion (Whisper) para este proyecto -- corre generate_voice + transcribe_audio primero"
      );
    }

    const sentences = splitIntoSentences(fullText);
    const alignedSentences = alignSentencesToWords(sentences, words);
    const grouped = groupIntoScenes(alignedSentences);

    if (grouped.length === 0) {
      throw new Error("No se pudieron armar escenas a partir de la transcripcion");
    }

    // El end de la ultima palabra transcripta casi siempre queda unos
    // segundos antes del final REAL del audio (silencio/fade de cola) --
    // sin esto, la ultima escena "termina" antes de que el audio termine
    // de verdad, y el preview se queda mostrando el ultimo clip en loop
    // durante ese resto sin ningun corte, dando la sensacion de que el
    // video sigue sin fin despues de que el usuario deja de prestarle
    // atencion al audio.
    const lastScene = grouped[grouped.length - 1]!;
    if (audioDurationSeconds && audioDurationSeconds > lastScene.end) {
      lastScene.end = audioDurationSeconds;
    }

    // Regenerar las escenas reemplaza las anteriores por completo -- son un
    // desglose derivado del guion + audio real, no ediciones manuales a
    // preservar (mismo criterio que generate_script usaba antes).
    const { error: deleteError } = await supabase.from("scenes").delete().eq("script_id", script.id);
    if (deleteError) throw new Error(deleteError.message);

    const rows = grouped.map((scene, index) => ({
      script_id: script.id,
      order: index + 1,
      content: {
        text: scene.text,
        timeStart: formatTime(scene.start),
        timeEnd: formatTime(scene.end),
        duration: `${Math.round(scene.end - scene.start)}s`,
      },
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("scenes")
      .insert(rows)
      .select("order, content");
    if (insertError) throw new Error(insertError.message);

    return {
      scenes: (inserted ?? [])
        .map((row) => ({
          order: row.order as number,
          text: ((row.content as { text?: string } | null)?.text) ?? "",
          timeStart: ((row.content as { timeStart?: string } | null)?.timeStart) ?? "00:00",
          timeEnd: ((row.content as { timeEnd?: string } | null)?.timeEnd) ?? "00:00",
        }))
        .sort((a, b) => a.order - b.order),
    };
  },
};
