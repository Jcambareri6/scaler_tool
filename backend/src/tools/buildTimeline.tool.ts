import type { ToolDefinition } from "./tool.types.js";
import type { TranscribedWord } from "./transcribeAudio.tool.js";
import { getOwnedProject } from "../lib/ownership.js";
import { supabase } from "../lib/supabase.js";

export interface BuildTimelineInput {
  video_project_id: string;
}

export interface BuildTimelineOutput {
  timeline_id: string;
  content: Record<string, unknown>;
}

interface SceneRow {
  id: string;
  order: number;
  content: Record<string, unknown> | null;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

// LEEME (seccion 5): el timing de cada escena tiene que salir de Whisper
// (audio real), no de una estimacion por cantidad de palabras -- eso es
// solo el fallback "timeline_base" antes de que exista transcripcion. Las
// escenas reconstruyen full_text en orden (contrato de generate_script), asi
// que alcanza con consumir la lista de palabras transcriptas de forma
// secuencial, tomando para cada escena la cantidad de palabras que le
// corresponde: start = la primera palabra que le toca, end = la ultima.
// Si el conteo de palabras no matchea (audio real distinto al texto, o
// transcripcion parcial) las escenas que se quedan sin palabras reales caen
// al fallback proporcional de mas abajo, no rompen el resto.
function alignScenesToWords(
  sceneRows: SceneRow[],
  words: TranscribedWord[]
): Map<string, { start: number; end: number }> {
  const timingByScene = new Map<string, { start: number; end: number }>();
  let wordIndex = 0;

  for (const scene of sceneRows) {
    const sceneText = ((scene.content as { text?: string } | null)?.text) ?? "";
    const sceneWordCount = wordCount(sceneText);
    if (sceneWordCount === 0) continue;

    const slice = words.slice(wordIndex, wordIndex + sceneWordCount);
    if (slice.length === 0) break;

    timingByScene.set(scene.id, {
      start: slice[0]!.start,
      end: slice[slice.length - 1]!.end,
    });
    wordIndex += slice.length;
  }

  return timingByScene;
}

// Sin Provider, como generate_overlay (Gap del LEEME "timeline_base" +
// "resuelto"): se llama dos veces en el pipeline (ver
// src/pipeline/orchestrator.ts) -- una apenas hay audio, todavia sin
// transcripcion (reparte tiempo proporcional a la longitud de texto de cada
// escena) y otra despues de transcribir + resolver stock/overlays (ya con
// `timelines.content.words` disponible, usa el timing real de Whisper via
// alignScenesToWords). Siempre recalcula desde la DB en vez de recibir los
// datos como parametro -- asi nunca depende de que el LLM se los pase bien
// (mismo criterio que search_stock/generate_overlay).
export const buildTimelineTool: ToolDefinition<BuildTimelineInput, BuildTimelineOutput> = {
  name: "build_timeline",
  description:
    "Arma/actualiza el Timeline del proyecto: reparte tiempos por escena y fusiona audio + assets + overlays ya resueltos.",
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

    const { data: fullProject, error: projectError } = await supabase
      .from("video_projects")
      .select("target_duration")
      .eq("id", video_project_id)
      .single();
    if (projectError) throw new Error(projectError.message);

    const { data: script, error: scriptError } = await supabase
      .from("scripts")
      .select("id")
      .eq("video_project_id", video_project_id)
      .single();
    if (scriptError || !script) {
      throw new Error("El proyecto no tiene guion todavia");
    }

    const { data: scenes, error: scenesError } = await supabase
      .from("scenes")
      .select("id, order, content")
      .eq("script_id", script.id)
      .order("order", { ascending: true });
    if (scenesError) throw new Error(scenesError.message);
    const sceneRows = (scenes ?? []) as SceneRow[];

    const { data: audioAsset } = await supabase
      .from("assets")
      .select("id, storage_key, metadata")
      .eq("video_project_id", video_project_id)
      .eq("type", "AUDIO")
      .is("scene_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: visualAssets } = await supabase
      .from("assets")
      .select("scene_id, storage_key, metadata")
      .eq("video_project_id", video_project_id)
      .not("scene_id", "is", null);

    const { data: existingTimeline } = await supabase
      .from("timelines")
      .select("*")
      .eq("video_project_id", video_project_id)
      .maybeSingle();

    const audioDuration =
      (audioAsset?.metadata as { duration_seconds?: number } | null)?.duration_seconds;
    const totalWords = sceneRows.reduce(
      (sum, s) => sum + wordCount(((s.content as { text?: string } | null)?.text) ?? ""),
      0
    );
    const totalDuration =
      audioDuration ?? fullProject?.target_duration ?? Math.max(10, Math.ceil(totalWords / 2.5));

    const transcribedWords =
      ((existingTimeline?.content as { words?: TranscribedWord[] } | null)?.words) ?? [];
    const realTiming =
      transcribedWords.length > 0 ? alignScenesToWords(sceneRows, transcribedWords) : null;

    let cursor = 0;
    const timelineScenes: Record<string, unknown>[] = [];

    for (const scene of sceneRows) {
      const sceneText = ((scene.content as { text?: string } | null)?.text) ?? "";
      const real = realTiming?.get(scene.id);

      let start: number;
      let end: number;
      if (real) {
        start = real.start;
        end = real.end;
      } else {
        // Fallback proporcional: todavia no hay transcripcion (timeline
        // "base") o esta escena quedo afuera de la alineacion real.
        const share = totalWords > 0 ? wordCount(sceneText) / totalWords : 1 / (sceneRows.length || 1);
        start = cursor;
        end = cursor + totalDuration * share;
      }
      cursor = end;
      const durationSeconds = end - start;

      const visualAsset = (visualAssets ?? []).find((a) => a.scene_id === scene.id);
      const overlay = (scene.content as { overlay?: unknown } | null)?.overlay ?? null;

      const updatedContent = {
        ...(scene.content ?? {}),
        timeStart: formatTime(start),
        timeEnd: formatTime(end),
        duration: `${Math.round(durationSeconds)}s`,
      };

      const { error: updateSceneError } = await supabase
        .from("scenes")
        .update({ content: updatedContent })
        .eq("id", scene.id);
      if (updateSceneError) throw new Error(updateSceneError.message);

      timelineScenes.push({
        scene_id: scene.id,
        order: scene.order,
        start: formatTime(start),
        end: formatTime(end),
        asset: visualAsset
          ? { storage_key: visualAsset.storage_key, metadata: visualAsset.metadata }
          : null,
        overlay,
      });
    }

    const previousContent = (existingTimeline?.content as Record<string, unknown> | null) ?? {};
    const content: Record<string, unknown> = {
      ...previousContent,
      scenes: timelineScenes,
      audio: audioAsset
        ? { asset_id: audioAsset.id, storage_key: audioAsset.storage_key, duration_seconds: audioDuration }
        : previousContent.audio ?? null,
    };

    if (existingTimeline) {
      const { error: updateError } = await supabase
        .from("timelines")
        .update({ content })
        .eq("id", existingTimeline.id);
      if (updateError) throw new Error(updateError.message);
      return { timeline_id: existingTimeline.id, content };
    }

    const { data: inserted, error: insertError } = await supabase
      .from("timelines")
      .insert({ video_project_id, content })
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(insertError?.message ?? "Failed to create timeline");
    }

    return { timeline_id: inserted.id, content };
  },
};
