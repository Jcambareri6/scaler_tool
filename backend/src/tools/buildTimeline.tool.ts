import type { ToolDefinition } from "./tool.types.js";
import type { TranscribedWord } from "./transcribeAudio.tool.js";
import { getOwnedProject } from "../lib/ownership.js";
import { supabase } from "../lib/supabase.js";
import { alignScriptTokens, tokenizeScript, type TokenTiming } from "../lib/wordAlignment.js";

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
// escenas reconstruyen full_text en orden (contrato de generate_script): se
// alinean sus tokens contra las palabras de Whisper (alignScriptTokens) y
// cada escena toma start = su primer token, end = el ultimo.

// Cuantas palabras del guion agrupa cada cue de subtitulo -- ~8 palabras es
// el tamaño tipico de una linea de subtitulo legible (2-3s de habla a ritmo
// normal), bastante mas corto que los segmentos de Whisper (que pueden durar
// una frase entera en pantalla).
const CAPTION_WORDS_PER_CUE = 8;

function sceneTokens(scene: SceneRow): string[] {
  return tokenizeScript(((scene.content as { text?: string } | null)?.text) ?? "");
}

// Subtitulos (para render_video.tool.ts y el preview del frontend): en vez
// del texto que Whisper CREYO escuchar (transcription.segments, que se
// equivoca con nombres propios, numeros, jerga -- reportado en produccion),
// se arma con el guion real (siempre exacto, ya escrito/validado por el
// usuario) con el timing de Whisper de cada palabra via alignScriptTokens
// (tolera que guion y transcripcion no tengan exactamente las mismas
// palabras). El timing de Whisper es confiable (viene del audio real); el
// RECONOCIMIENTO de texto de Whisper no tiene por que serlo.
function buildCaptionSegments(
  scriptWords: string[],
  timings: TokenTiming[]
): { text: string; start: number; end: number }[] {
  const cues: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < scriptWords.length; i += CAPTION_WORDS_PER_CUE) {
    const last = Math.min(i + CAPTION_WORDS_PER_CUE, scriptWords.length) - 1;
    cues.push({
      text: scriptWords.slice(i, last + 1).join(" "),
      start: timings[i]!.start,
      end: timings[last]!.end,
    });
  }
  return cues;
}

function alignScenesToWords(
  sceneRows: SceneRow[],
  timings: TokenTiming[]
): Map<string, { start: number; end: number }> {
  const timingByScene = new Map<string, { start: number; end: number }>();
  let tokenIndex = 0;

  for (const scene of sceneRows) {
    const count = sceneTokens(scene).length;
    if (count === 0) continue;
    timingByScene.set(scene.id, {
      start: timings[tokenIndex]!.start,
      end: timings[tokenIndex + count - 1]!.end,
    });
    tokenIndex += count;
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

    const { data: visualAssetsRaw } = await supabase
      .from("assets")
      .select("scene_id, storage_key, metadata, type")
      .eq("video_project_id", video_project_id)
      .not("scene_id", "is", null);

    interface VisualAssetRow {
      scene_id: string;
      storage_key: string;
      metadata: Record<string, unknown> | null;
      type: string;
    }

    // Una escena puede tener mas de un asset de stock (replaceStockSegmentsForScene
    // completa con otro clip en vez de repetir el mismo cuando ninguno solo
    // le alcanza) -- se agrupan por escena y se ordenan por metadata.sequence.
    const visualAssetsByScene = new Map<string, VisualAssetRow[]>();
    for (const asset of (visualAssetsRaw ?? []) as VisualAssetRow[]) {
      const list = visualAssetsByScene.get(asset.scene_id) ?? [];
      list.push(asset);
      visualAssetsByScene.set(asset.scene_id, list);
    }
    for (const list of visualAssetsByScene.values()) {
      list.sort((a, b) => {
        const seqA = Number((a.metadata as { sequence?: number } | null)?.sequence ?? 0);
        const seqB = Number((b.metadata as { sequence?: number } | null)?.sequence ?? 0);
        return seqA - seqB;
      });
    }

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
    const scriptWords = sceneRows.flatMap(sceneTokens);
    const wordTimings = transcribedWords.length > 0 ? alignScriptTokens(scriptWords, transcribedWords) : null;
    const realTiming = wordTimings ? alignScenesToWords(sceneRows, wordTimings) : null;

    // Primero los rangos de todas las escenas, despues se vuelven contiguos:
    // cada escena visual dura hasta que arranca la siguiente (las pausas de
    // la narracion entre escenas quedan cubiertas por el clip actual), la
    // primera arranca en 0 y la ultima llega al final real del audio. Asi
    // el video, el preview y el audio cubren exactamente el mismo tiempo --
    // antes el render estiraba huecos por su cuenta y el ultimo tramo de
    // audio quedaba cortado por `-shortest`.
    let cursor = 0;
    const ranges = sceneRows.map((scene) => {
      const sceneText = ((scene.content as { text?: string } | null)?.text) ?? "";
      const real = realTiming?.get(scene.id);
      if (real) {
        cursor = real.end;
        return { start: real.start, end: real.end };
      }
      // Fallback proporcional: todavia no hay transcripcion (timeline
      // "base") o esta escena no tiene texto.
      const share = totalWords > 0 ? wordCount(sceneText) / totalWords : 1 / (sceneRows.length || 1);
      const start = cursor;
      cursor = cursor + totalDuration * share;
      return { start, end: cursor };
    });
    if (ranges.length > 0) {
      ranges[0]!.start = 0;
      for (let i = 0; i < ranges.length - 1; i++) {
        const nextStart = ranges[i + 1]!.start;
        if (nextStart > ranges[i]!.start) ranges[i]!.end = nextStart;
      }
      const whisperDuration = (existingTimeline?.content as { duration_seconds?: number } | null)?.duration_seconds;
      const audioEnd = Math.max(audioDuration ?? 0, whisperDuration ?? 0);
      const last = ranges[ranges.length - 1]!;
      if (audioEnd > last.end) last.end = audioEnd;
    }

    const timelineScenes: Record<string, unknown>[] = [];

    for (const [sceneIndex, scene] of sceneRows.entries()) {
      const { start, end } = ranges[sceneIndex]!;
      const durationSeconds = end - start;

      const sceneVisualAssets = visualAssetsByScene.get(scene.id) ?? [];
      const overlay = (scene.content as { overlay?: unknown } | null)?.overlay ?? null;

      // Reparte [start, end] de la escena entre sus assets en orden,
      // usando metadata.duration_seconds como porcion de cada uno (el
      // ultimo siempre cierra justo en `end`, sin importar redondeos).
      let assetCursor = start;
      const sceneAssets = sceneVisualAssets.map((asset, i) => {
        const isLast = i === sceneVisualAssets.length - 1;
        const allocated =
          Number((asset.metadata as { duration_seconds?: number } | null)?.duration_seconds) ||
          durationSeconds / sceneVisualAssets.length;
        const segStart = assetCursor;
        const segEnd = isLast ? end : Math.min(end, assetCursor + allocated);
        assetCursor = segEnd;
        return {
          storage_key: asset.storage_key,
          metadata: asset.metadata,
          type: asset.type,
          start: formatTime(segStart),
          end: formatTime(segEnd),
          // `start`/`end` ("MM:SS") redondean al segundo -- el render y el
          // preview usan estos para no acumular ese error en cada corte.
          start_seconds: segStart,
          end_seconds: segEnd,
        };
      });

      const updatedContent = {
        ...(scene.content ?? {}),
        timeStart: formatTime(start),
        timeEnd: formatTime(end),
        startSeconds: start,
        endSeconds: end,
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
        start_seconds: start,
        end_seconds: end,
        // `assets`: uno o mas clips (en orden) que juntos cubren toda la
        // escena. Se mantiene tambien `asset` (el primero) para no romper
        // consumidores viejos del timeline que todavia esperan uno solo.
        assets: sceneAssets,
        asset: sceneAssets[0]
          ? { storage_key: sceneAssets[0].storage_key, metadata: sceneAssets[0].metadata, type: sceneAssets[0].type }
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
      // Pisa transcription.segments (texto tal cual lo entendio Whisper) con
      // cues armados desde el guion real -- ver buildCaptionSegments. Solo
      // cuando ya hay transcripcion real; sin eso se deja lo que hubiera
      // (timeline "base", ver comentario del Tool mas abajo).
      ...(wordTimings ? { segments: buildCaptionSegments(scriptWords, wordTimings) } : {}),
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
