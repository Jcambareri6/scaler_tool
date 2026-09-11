import { runTool } from "../tools/index.js";
import { supabase } from "../lib/supabase.js";
import {
  replaceStockSegmentsForScene,
  setAiVideoSegmentsForScene,
  appendStockHistory,
  type AiVideoSegment,
} from "../lib/stockSegments.js";
import { syncProjectStatus } from "../lib/projectStatus.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import type { ContentPolicy, VisualSource, JobStatus } from "../types/shared/typeShared.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "../tools/generateVideo.tool.js";
import type {
  GenerateVideoPromptInput,
  GenerateVideoPromptOutput,
} from "../tools/generateVideoPrompt.tool.js";
import type { GenerateVoiceInput, GenerateVoiceOutput } from "../tools/generateVoice.tool.js";
import type {
  TranscribeAudioInput,
  TranscribeAudioOutput,
} from "../tools/transcribeAudio.tool.js";
import type { SearchStockInput, SearchStockOutput } from "../tools/searchStock.tool.js";
import type {
  GenerateStockKeywordsInput,
  GenerateStockKeywordsOutput,
} from "../tools/generateStockKeywords.tool.js";
import type {
  GenerateVisualContextInput,
  GenerateVisualContextOutput,
} from "../tools/generateVisualContext.tool.js";
import type { GenerateOverlayInput, GenerateOverlayOutput } from "../tools/generateOverlay.tool.js";
import type { RenderVideoInput, RenderVideoOutput } from "../tools/renderVideo.tool.js";
import type { BuildTimelineInput, BuildTimelineOutput } from "../tools/buildTimeline.tool.js";
import type { BuildScenesInput, BuildScenesOutput } from "../tools/buildScenes.tool.js";

export interface PipelineContext {
  userId: string;
  jobId: string;
}

interface SceneRow {
  id: string;
  order: number;
  content: Record<string, unknown> | null;
}

// scene.content.duration lo escribe build_timeline como "${N}s" (ver
// buildTimeline.tool.ts) -- se parsea para pasarle a search_stock un piso
// de duracion, asi el clip elegido no corta antes de que termine la
// narracion de esa escena.
function parseDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
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

async function setJobStatus(
  jobId: string,
  videoProjectId: string,
  status: JobStatus,
  extra: Record<string, unknown> = {}
) {
  const { error } = await supabase.from("jobs").update({ status, ...extra }).eq("id", jobId);
  if (error) throw new Error(error.message);
  await syncProjectStatus(videoProjectId, status);
}

// El pipeline ahora corre en background (ver pipeline.service.ts) -- estos
// updates de progreso son lo que el polling del frontend (PreviewPanel)
// termina mostrando de verdad, en vez de quedar mudos hasta el final.
async function bumpProgress(jobId: string, progress: number) {
  const { error } = await supabase.from("jobs").update({ progress }).eq("id", jobId);
  if (error) throw new Error(error.message);
}

// Concurrencia limitada para el loop por escena: cada escena es
// independiente (keywords -> stock -> overlay), asi que procesar varias a
// la vez baja mucho el tiempo total sin cambiar el resultado. El limite
// evita pegarle a los rate limits de OpenAI/Pexels/etc. con 20-30 llamadas
// simultaneas.
const SCENE_CONCURRENCY = 4;

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

  await setJobStatus(ctx.jobId, projectId, "SCRIPT_DONE", { progress: 5 });

  const toolCtx = { userId: ctx.userId, jobId: ctx.jobId };

  // 1. Voz -- respeta la voz elegida en el tab Audio (project.voice_id); si
  // no hay ninguna elegida, generate_voice cae a su DEFAULT_VOICE_ID.
  const voice = await runTool<GenerateVoiceInput, GenerateVoiceOutput>(
    "generate_voice",
    {
      script_id: script.id,
      text: scriptText,
      ...(project.voice_id ? { voice_id: project.voice_id as string } : {}),
    },
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

  await setJobStatus(ctx.jobId, projectId, "AUDIO_DONE", { progress: 15 });

  // 2. Timeline base -- todavia no hay escenas (se arman recien en el paso
  // 4), asi que esta pasada solo deja creado el registro de timeline con
  // la info de audio, para que el paso 3 tenga donde fusionar la
  // transcripcion.
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
          ...(transcription.duration_seconds ? { duration_seconds: transcription.duration_seconds } : {}),
        },
      })
      .eq("id", timelineAfterVoice.id);
    if (mergeError) throw new Error(mergeError.message);
  }

  // 4. Armar las escenas (LEEME seccion 5: recien ahora, con audio real +
  // transcripcion, no antes) -- reemplaza cualquier escena vieja del
  // guion anterior.
  await runTool<BuildScenesInput, BuildScenesOutput>(
    "build_scenes",
    { video_project_id: projectId },
    toolCtx
  );

  // 5-6. Stock + overlay por escena
  const { data: scenes, error: scenesError } = await supabase
    .from("scenes")
    .select("id, order, content")
    .eq("script_id", script.id)
    .order("order", { ascending: true });
  if (scenesError) throw new Error(scenesError.message);

  const contentPolicy = (project.content_policy as ContentPolicy | null) ?? undefined;
  const videoTopic = (project as { title?: string }).title;
  const visualSource = ((project as { visual_source?: VisualSource }).visual_source ?? "stock") as VisualSource;
  const sceneRows = (scenes ?? []) as SceneRow[];

  // Compartido entre todas las escenas de esta corrida -- evita que dos
  // escenas distintas terminen usando el mismo clip de stock (ver
  // replaceStockSegmentsForScene).
  const usedStockKeys = new Set<string>();

  // Contexto visual global (Fase 1 del prompt del cliente de stock, ver
  // generate_visual_context): UNA sola vez por video, no por escena, para
  // que las 4 queries de cada escena (Fase 2, generate_stock_keywords) sean
  // coherentes entre si -- misma epoca, misma ubicacion, mismo tono. Solo
  // hace falta si alguna escena va a buscar stock ("stock"/"mixed" -- "ai"
  // no usa keywords de stock en absoluto).
  const sceneKeywords = new Map<string, string[]>();
  if (visualSource !== "ai" && sceneRows.length > 0) {
    const contextResult = await runTool<GenerateVisualContextInput, GenerateVisualContextOutput>(
      "generate_visual_context",
      { full_text: scriptText, ...(videoTopic ? { video_topic: videoTopic } : {}) },
      toolCtx
    );

    // Generacion de las 4 queries POR ESCENA en orden SECUENCIAL -- a
    // diferencia del resto del loop (que corre en paralelo con
    // SCENE_CONCURRENCY), la regla del cliente de "no repetir queries entre
    // bloques adyacentes" necesita conocer que devolvio la escena anterior
    // antes de pedir la siguiente. Es solo texto corto por LLM, no busqueda
    // de stock, asi que el costo de serializar este paso puntual es bajo.
    let previousQueries: string[] | undefined;
    for (const scene of sceneRows) {
      const sceneText = ((scene.content as { text?: string } | null)?.text) ?? "";
      const keywordsResult = await runTool<GenerateStockKeywordsInput, GenerateStockKeywordsOutput>(
        "generate_stock_keywords",
        {
          scene_text: sceneText,
          ...(videoTopic ? { video_topic: videoTopic } : {}),
          ...(contentPolicy ? { content_policy: contentPolicy } : {}),
          visual_context: contextResult.visual_context,
          ...(previousQueries ? { previous_scene_queries: previousQueries } : {}),
        },
        toolCtx
      );
      sceneKeywords.set(scene.id, keywordsResult.keywords);
      previousQueries = keywordsResult.keywords;
    }
  }

  // "mixed": si el mejor candidato de stock cubre menos de esta fraccion de
  // la duracion de la escena (o no hay ninguno), se genera el clip con IA
  // para esa escena en vez de rellenar con varios clips cortitos.
  const MIXED_AI_FALLBACK_COVERAGE = 0.5;

  // Tope de seguridad: los modelos de video (Veo 3.1 8s fijos, Seedance 2
  // hasta 15s) generan clips mucho mas cortos que una escena tipica
  // (30-40s), asi que hace falta pedir varios seguidos para cubrirla
  // entera (mismo criterio que search_stock completando con mas de un
  // candidato). El tope evita gasto descontrolado si `duration_seconds`
  // llegara a venir en 0 por algun bug/respuesta rara del proveedor.
  const MAX_AI_VIDEO_SEGMENTS = 10;

  async function generateAiVisual(sceneId: string, sceneText: string, minDurationSeconds: number): Promise<void> {
    const promptResult = await runTool<GenerateVideoPromptInput, GenerateVideoPromptOutput>(
      "generate_video_prompt",
      {
        scene_text: sceneText,
        ...(videoTopic ? { video_topic: videoTopic } : {}),
        ...(contentPolicy ? { content_policy: contentPolicy } : {}),
      },
      toolCtx
    );

    const segments: AiVideoSegment[] = [];
    let remaining = minDurationSeconds;
    for (let i = 0; i < MAX_AI_VIDEO_SEGMENTS && remaining > 0.5; i++) {
      const video = await runTool<GenerateVideoInput, GenerateVideoOutput>(
        "generate_video",
        { prompt: promptResult.prompt, scene_id: sceneId, duration_seconds: remaining },
        toolCtx
      );
      segments.push({
        storage_key: video.storage_key,
        duration_seconds: video.duration_seconds,
        prompt: promptResult.prompt,
      });
      remaining -= video.duration_seconds || 0.5;
    }
    await setAiVideoSegmentsForScene(projectId, sceneId, segments);
  }

  // Cada escena es independiente (keywords -> stock -> overlay no comparten
  // estado entre si), asi que se procesan varias a la vez en vez de una por
  // una -- con 20-30 escenas eso son minutos de espera secuencial sin
  // ninguna ventaja real. El progreso del Job (30% a 90%) avanza a medida
  // que van terminando, no todas juntas al final.
  let completedScenes = 0;
  await mapWithConcurrency(sceneRows, SCENE_CONCURRENCY, async (scene) => {
    const sceneText = ((scene.content as { text?: string } | null)?.text) ?? "";
    // build_scenes siempre deja `duration` seteado -- el fallback es solo
    // defensivo para no dejar una escena sin ningun clip si por algun
    // motivo faltara.
    const minDurationSeconds = parseDurationSeconds((scene.content as { duration?: unknown } | null)?.duration) ?? 30;

    if (visualSource === "ai") {
      await generateAiVisual(scene.id, sceneText, minDurationSeconds);
    } else {
      // LEEME (seccion 2): "OpenAI es el director visual", decide que
      // buscar en stock -- las keywords (4 por escena, en cascada) ya se
      // generaron arriba en orden secuencial, con contexto global y sin
      // repetir la escena anterior (ver sceneKeywords mas arriba).
      const keywords = sceneKeywords.get(scene.id) ?? [];

      // exclude_keys: sin esto, la cascada de search_stock se corta en la
      // primera keyword que traiga CUALQUIER resultado no bloqueado, sin
      // saber si esos resultados ya estan gastados en otra escena de este
      // mismo video -- con keywords de nicho el stock disponible puede ser
      // 2-3 clips nada mas, asi que dos escenas con contenido similar
      // terminaban recibiendo la misma tanda agotada de candidatos.
      const stock = await runTool<SearchStockInput, SearchStockOutput>(
        "search_stock",
        {
          keywords,
          ...(contentPolicy ? { content_policy: contentPolicy } : {}),
          min_duration_seconds: minDurationSeconds,
          exclude_keys: Array.from(usedStockKeys),
        },
        toolCtx
      );

      const bestCandidateSeconds = stock.candidates[0]?.duration_seconds ?? 0;
      const coverage = minDurationSeconds > 0 ? bestCandidateSeconds / minDurationSeconds : 1;
      const stockFallsShort = stock.candidates.length === 0 || coverage < MIXED_AI_FALLBACK_COVERAGE;

      if (visualSource === "mixed" && stockFallsShort) {
        await generateAiVisual(scene.id, sceneText, minDurationSeconds);
      } else {
        const { usedKeys } = await replaceStockSegmentsForScene(
          projectId,
          scene.id,
          stock.candidates,
          minDurationSeconds,
          usedStockKeys
        );
        // Deja registro de que clips ya se usaron en ESTA escena (sobrevive
        // al borrado de Assets que hace cada regeneracion puntual, ver
        // regenerateSceneVisual en scene.service.ts) -- sin esto, la primera
        // vez que el usuario regenera una escena desde el pipeline
        // automatico no tiene memoria de que candidato ya se probo aca.
        await appendStockHistory(scene.id, scene.content as Record<string, unknown> | null, usedKeys);
      }
    }

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

    completedScenes += 1;
    if (sceneRows.length > 0) {
      const progress = 30 + Math.round((completedScenes / sceneRows.length) * 60);
      await bumpProgress(ctx.jobId, progress);
    }
  });

  await setJobStatus(ctx.jobId, projectId, "VISUALS_DONE", { progress: 90 });

  // 7. Timeline resuelto (vuelve a leer la DB, ahora con escenas + assets +
  // overlays)
  await runTool<BuildTimelineInput, BuildTimelineOutput>(
    "build_timeline",
    { video_project_id: projectId },
    toolCtx
  );

  // 8. Gate humano
  await setJobStatus(ctx.jobId, projectId, "AWAITING_STOCK_REVIEW", { progress: 100 });
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

  // approveStockReview ya puso el Job en RENDERING con el progreso previo
  // (100 de la fase anterior) -- se resetea para que el polling del
  // frontend no muestre "100%" mientras FFmpeg todavia esta trabajando.
  await bumpProgress(ctx.jobId, 10);

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

  await setJobStatus(ctx.jobId, projectId, "COMPLETED", {
    progress: 100,
    finished_at: new Date().toISOString(),
  });
}
