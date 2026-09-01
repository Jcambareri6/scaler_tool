import { runTool } from "../tools/index.js";
import { supabase } from "../lib/supabase.js";
import { deriveKeywords } from "../lib/keywords.js";
import type { ContentPolicy } from "../types/shared/typeShared.js";
import type { GenerateVoiceInput, GenerateVoiceOutput } from "../tools/generateVoice.tool.js";
import type {
  TranscribeAudioInput,
  TranscribeAudioOutput,
} from "../tools/transcribeAudio.tool.js";
import type { SearchStockInput, SearchStockOutput, StockCandidate } from "../tools/searchStock.tool.js";
import type { GenerateOverlayInput, GenerateOverlayOutput } from "../tools/generateOverlay.tool.js";
import type { RenderVideoInput, RenderVideoOutput } from "../tools/renderVideo.tool.js";
import type { BuildTimelineInput, BuildTimelineOutput } from "../tools/buildTimeline.tool.js";

export interface PipelineContext {
  userId: string;
  jobId: string;
}

interface SceneRow {
  id: string;
  order: number;
  content: Record<string, unknown> | null;
}

async function getProjectOrThrow(projectId: string, userId: string) {
  const { data: project, error } = await supabase
    .from("video_projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (error || !project) {
    throw new Error("Project not found");
  }
  return project;
}

async function selectStockForScene(
  projectId: string,
  scene: SceneRow,
  candidates: StockCandidate[]
) {
  const chosen = candidates[0];
  if (!chosen) return null;

  const { data, error } = await supabase
    .from("assets")
    .insert({
      video_project_id: projectId,
      scene_id: scene.id,
      type: "VIDEO",
      // Fase actual: storage_key apunta directo al CDN de Pexels/Pixabay/
      // mock -- todavia no se descarga a Storage propio (ver plan).
      storage_key: chosen.preview_url,
      metadata: {
        kind: "stock_preview",
        provider: chosen.provider,
        external_id: chosen.external_id,
        url: chosen.url,
      },
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function setJobStatus(jobId: string, status: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabase.from("jobs").update({ status, ...extra }).eq("id", jobId);
  if (error) throw new Error(error.message);
}

// Motor deterministico: corre los pasos del pipeline en orden fijo,
// resolviendo cada id consultando la DB directamente. Ninguna Tool recibe
// un id "adivinado" por un LLM -- el Agent conversacional sigue existiendo
// aparte, para pedidos puntuales, pero no orquesta este flujo.
export async function runPreRenderPipeline(projectId: string, ctx: PipelineContext) {
  const project = await getProjectOrThrow(projectId, ctx.userId);

  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("id, content")
    .eq("video_project_id", projectId)
    .single();
  if (scriptError || !script) {
    throw new Error("El proyecto no tiene guion todavia -- generalo primero");
  }

  const scriptText = ((script.content as { text?: string } | null)?.text) ?? "";
  if (!scriptText.trim()) {
    throw new Error("El guion del proyecto esta vacio");
  }

  const toolCtx = { userId: ctx.userId, jobId: ctx.jobId };

  // 1. Voz
  const voice = await runTool<GenerateVoiceInput, GenerateVoiceOutput>(
    "generate_voice",
    { script_id: script.id, text: scriptText },
    toolCtx
  );
  const { data: audioAsset, error: audioAssetError } = await supabase
    .from("assets")
    .insert({
      video_project_id: projectId,
      scene_id: null,
      type: "AUDIO",
      storage_key: voice.storage_key,
      metadata: { duration_seconds: voice.duration_seconds },
    })
    .select()
    .single();
  if (audioAssetError || !audioAsset) {
    throw new Error(audioAssetError?.message ?? "Failed to create audio asset");
  }

  // 2. Timeline base (reparte tiempo por escena proporcional al texto)
  await runTool<BuildTimelineInput, BuildTimelineOutput>(
    "build_timeline",
    { video_project_id: projectId },
    toolCtx
  );

  // 3. Whisper -- se fusiona directo en timelines.content, no hace falta
  // otra Tool para este paso puntual (es solo plumbing de datos).
  const transcription = await runTool<TranscribeAudioInput, TranscribeAudioOutput>(
    "transcribe_audio",
    { asset_id: audioAsset.id },
    toolCtx
  );
  const { data: timelineAfterVoice } = await supabase
    .from("timelines")
    .select("id, content")
    .eq("video_project_id", projectId)
    .single();
  if (timelineAfterVoice) {
    const { error: mergeError } = await supabase
      .from("timelines")
      .update({
        content: {
          ...(timelineAfterVoice.content as Record<string, unknown>),
          words: transcription.words,
          segments: transcription.segments,
        },
      })
      .eq("id", timelineAfterVoice.id);
    if (mergeError) throw new Error(mergeError.message);
  }

  // 4-5. Stock + overlay por escena
  const { data: scenes, error: scenesError } = await supabase
    .from("scenes")
    .select("id, order, content")
    .eq("script_id", script.id)
    .order("order", { ascending: true });
  if (scenesError) throw new Error(scenesError.message);

  const contentPolicy = (project.content_policy as ContentPolicy | null) ?? undefined;

  for (const scene of (scenes ?? []) as SceneRow[]) {
    const sceneText = ((scene.content as { text?: string } | null)?.text) ?? "";
    const keywords = deriveKeywords(sceneText);

    const stock = await runTool<SearchStockInput, SearchStockOutput>(
      "search_stock",
      { keywords, ...(contentPolicy ? { content_policy: contentPolicy } : {}) },
      toolCtx
    );
    await selectStockForScene(projectId, scene, stock.candidates);

    // Sin decision de producto todavia sobre que overlay corresponde a
    // cada escena (queda fuera de esta fase) -- se valida "ninguno" para
    // que el paso quede trazado sin inventar texto.
    const overlayResult = await runTool<GenerateOverlayInput, GenerateOverlayOutput>(
      "generate_overlay",
      {
        scene_id: scene.id,
        script_text: sceneText,
        overlay: { type: "ninguno", text: "", source: "script" },
      },
      toolCtx
    );

    const { error: sceneUpdateError } = await supabase
      .from("scenes")
      .update({ content: { ...(scene.content ?? {}), overlay: overlayResult.overlay } })
      .eq("id", scene.id);
    if (sceneUpdateError) throw new Error(sceneUpdateError.message);
  }

  // 6. Timeline resuelto (vuelve a leer la DB, ahora con assets + overlays)
  await runTool<BuildTimelineInput, BuildTimelineOutput>(
    "build_timeline",
    { video_project_id: projectId },
    toolCtx
  );

  // 7. Gate humano
  await setJobStatus(ctx.jobId, "AWAITING_STOCK_REVIEW");
}

export async function runRenderPipeline(projectId: string, ctx: PipelineContext) {
  const { data: timeline, error: timelineError } = await supabase
    .from("timelines")
    .select("id")
    .eq("video_project_id", projectId)
    .single();
  if (timelineError || !timeline) {
    throw new Error("Timeline not found");
  }

  const toolCtx = { userId: ctx.userId, jobId: ctx.jobId };

  const render = await runTool<RenderVideoInput, RenderVideoOutput>(
    "render_video",
    { video_project_id: projectId, timeline_id: timeline.id },
    toolCtx
  );

  const { error: assetError } = await supabase.from("assets").insert({
    video_project_id: projectId,
    scene_id: null,
    type: "VIDEO",
    storage_key: render.storage_key,
    metadata: { kind: "final_render", duration_seconds: render.duration_seconds },
  });
  if (assetError) throw new Error(assetError.message);

  await setJobStatus(ctx.jobId, "COMPLETED", {
    progress: 100,
    finished_at: new Date().toISOString(),
  });
}
