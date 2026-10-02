import type { Request, Response } from "express";
import { createHash } from "crypto";
import { supabase } from "../../lib/supabase.js";
import { getOwnedScript } from "../../lib/ownership.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { runTool } from "../../tools/index.js";
import { setUploadedVisualForScene, uploadSceneAssetFile } from "../../lib/stockSegments.js";
import type {
  GenerateVisualBibleInput,
  GenerateVisualBibleOutput,
  GenerateImagePromptSequenceInput,
  GenerateImagePromptSequenceOutput,
  SequenceScene,
} from "../../tools/generateImagePromptSequence.tool.js";
import type { ContentPolicy } from "../../types/shared/typeShared.js";
import { getChannelSettingsForProject, visualStyleKey } from "../../lib/channelSettings.js";

// Flujo "generar afuera y cargar en lote" (ej: Google Flow, que no tiene
// API): 1) la app arma un prompt de imagen por escena y el usuario los
// exporta numerados (o la extension los manda sola a Flow); 2) el resultado
// se sube a su escena en tandas chicas.
//
// Continuidad visual: los prompts NO se arman escena por escena sueltas
// (asi cada imagen salia distinta). Primero se arma la biblia visual del
// video (guion completo + diseño visual del canal: personajes, lugares,
// epoca, paleta) y despues los prompts por tramos de escenas consecutivas
// siguiendo esa biblia -- ver tools/generateImagePromptSequence.tool.ts.

// Escenas por llamada al LLM: suficientes para que encadene un tramo de la
// historia, pocas para que no se "olvide" de ninguna.
const SEQUENCE_CHUNK_SIZE = 8;
// Tramos en paralelo (cada uno ya lleva toda la biblia, asi que no pierden
// consistencia entre si).
const SEQUENCE_CONCURRENCY = 3;
// Escenas vecinas que se pasan como contexto antes/despues de cada tramo.
const CONTEXT_BEFORE = 2;
const CONTEXT_AFTER = 1;
// Subidas a Storage simultaneas dentro de una tanda.
const UPLOAD_CONCURRENCY = 3;
// Tope de archivos por request: el frontend manda tandas chicas (los
// archivos viven en memoria con multer.memoryStorage, y una tanda chica
// hace que un fallo puntual no tire abajo toda la carga).
export const MAX_BATCH_FILES = 10;

interface SceneRow {
  id: string;
  order: number;
  content: Record<string, unknown> | null;
}

export interface SceneImagePrompt {
  scene_id: string;
  order: number;
  text: string;
  image_prompt: string | null;
  has_visual: boolean;
  // Para que el frontend los conserve al guardar la escena (el PATCH
  // reemplaza content entero).
  image_prompt_style_key: string | null;
  image_prompt_edited: boolean;
  error?: string;
}

interface StoredVisualBible {
  text: string;
  key: string;
  edited: boolean;
  updated_at: string;
}

function textOf(scene: SceneRow | undefined): string {
  const text = scene?.content?.text;
  return typeof text === "string" ? text : "";
}

// "00:12 - 00:20" a partir de timeStart/timeEnd (los arma build_scenes).
function timeOf(scene: SceneRow): string | undefined {
  const start = scene.content?.timeStart;
  const end = scene.content?.timeEnd;
  if (typeof start !== "string" || !start) return undefined;
  return typeof end === "string" && end ? `${start} - ${end}` : start;
}

function sequenceSceneOf(scene: SceneRow): SequenceScene {
  const time = timeOf(scene);
  return { order: scene.order, text: textOf(scene), ...(time ? { time } : {}) };
}

function promptOf(scene: SceneRow | undefined): string | null {
  const prompt = scene?.content?.imagePrompt;
  return typeof prompt === "string" && prompt.trim() ? prompt.trim() : null;
}

function hashOf(...parts: string[]): string {
  return createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

function missingColumnError(message: string): Error {
  return /visual_bible|column/i.test(message)
    ? new Error("Falta correr la migracion 20261002010000_workspace_defaults_visual_bible.sql en Supabase")
    : new Error(message);
}

function readStoredBible(value: unknown): StoredVisualBible | null {
  const v = value as Partial<StoredVisualBible> | null;
  if (!v || typeof v.text !== "string") return null;
  return { text: v.text, key: typeof v.key === "string" ? v.key : "", edited: v.edited === true, updated_at: v.updated_at ?? "" };
}

interface VisualContext {
  projectId: string;
  scriptId: string;
  videoTopic?: string;
  contentPolicy?: ContentPolicy;
  visualStyle: string | null;
  userId: string;
}

async function loadScenes(scriptId: string): Promise<SceneRow[]> {
  const { data, error } = await supabase
    .from("scenes")
    .select("id, order, content")
    .eq("script_id", scriptId)
    .order("order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SceneRow[];
}

// Huella de "con que guion y que diseño se armo la biblia": si cambia el
// guion de las escenas o el diseño del canal, la biblia vieja ya no sirve.
function bibleKeyFor(scenes: SceneRow[], visualStyle: string | null): string {
  return hashOf(visualStyle ?? "", ...scenes.map((s) => `${s.order}:${textOf(s)}`));
}

async function saveBible(scriptId: string, bible: StoredVisualBible | null): Promise<void> {
  const { error } = await supabase.from("scripts").update({ visual_bible: bible }).eq("id", scriptId);
  if (error) throw missingColumnError(error.message);
}

// Devuelve la biblia vigente: la guardada si sigue valiendo (o si el usuario
// la edito a mano), o una nueva generada con el guion completo.
async function ensureVisualBible(
  ctx: VisualContext,
  scenes: SceneRow[],
  options: { force?: boolean } = {}
): Promise<StoredVisualBible> {
  const { data: script, error } = await supabase.from("scripts").select("visual_bible").eq("id", ctx.scriptId).single();
  if (error) throw missingColumnError(error.message);

  const key = bibleKeyFor(scenes, ctx.visualStyle);
  const stored = readStoredBible(script?.visual_bible);
  if (stored && !options.force && (stored.edited || stored.key === key)) return stored;

  const sequenceScenes: SequenceScene[] = scenes.filter((s) => textOf(s).trim()).map(sequenceSceneOf);
  const { bible } = await runTool<GenerateVisualBibleInput, GenerateVisualBibleOutput>(
    "generate_visual_bible",
    {
      scenes: sequenceScenes,
      ...(ctx.videoTopic ? { video_topic: ctx.videoTopic } : {}),
      ...(ctx.visualStyle ? { visual_style: ctx.visualStyle } : {}),
      ...(ctx.contentPolicy ? { content_policy: ctx.contentPolicy } : {}),
    },
    { userId: ctx.userId }
  );
  const next: StoredVisualBible = { text: bible, key, edited: false, updated_at: new Date().toISOString() };
  await saveBible(ctx.scriptId, next);
  return next;
}

async function loadVisualContext(scriptId: string, videoProjectId: string, userId: string): Promise<VisualContext> {
  const { data: project, error } = await supabase
    .from("video_projects")
    .select("id, title, content_policy")
    .eq("id", videoProjectId)
    .single();
  if (error || !project) throw new Error("Project not found");
  const channel = await getChannelSettingsForProject(project.id);
  const videoTopic = (project as { title?: string }).title;
  const contentPolicy = (project as { content_policy?: ContentPolicy | null }).content_policy ?? undefined;
  return {
    projectId: project.id,
    scriptId,
    ...(videoTopic ? { videoTopic } : {}),
    ...(contentPolicy ? { contentPolicy } : {}),
    visualStyle: channel.visual_style_prompt,
    userId,
  };
}

// Corta las escenas a generar en tramos de escenas CONSECUTIVAS (un hueco
// -- una escena que no se regenera -- corta el tramo), de a lo sumo
// SEQUENCE_CHUNK_SIZE.
function consecutiveChunks(scenes: SceneRow[], needs: Set<string>): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  scenes.forEach((scene, index) => {
    if (needs.has(scene.id)) {
      current.push(index);
      if (current.length >= SEQUENCE_CHUNK_SIZE) {
        chunks.push(current);
        current = [];
      }
    } else if (current.length) {
      chunks.push(current);
      current = [];
    }
  });
  if (current.length) chunks.push(current);
  return chunks;
}

// POST /scripts/:script_id/scenes/image-prompts
// Body: { regenerate?: boolean, scene_ids?: string[] }
// Devuelve un prompt de imagen por escena (en orden). Los que ya existen en
// scene.content.imagePrompt se reusan (asi el usuario puede editarlos a mano
// y exportar de nuevo sin perderlos); solo se generan los que faltan, salvo
// regenerate=true (opcionalmente limitado a scene_ids). Un fallo del LLM en
// un tramo no corta el resto: esas escenas vuelven con `error`.
// Cada prompt guarda la huella (imagePromptStyleKey) del diseño del canal +
// biblia con que se armo: si cualquiera de los dos cambia, los prompts viejos
// se rehacen solos -- salvo los editados a mano (imagePromptEdited), que no
// se pisan nunca sin regenerate explicito.
export async function generateSceneImagePrompts(req: Request, res: Response) {
  try {
    const { script_id } = req.params;
    const userId = req.user!.id;
    const { regenerate, scene_ids } = (req.body ?? {}) as { regenerate?: boolean; scene_ids?: unknown };

    const script = await getOwnedScript(script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Script not found" });
    }

    const sceneList = await loadScenes(script.id);
    if (sceneList.length === 0) {
      return res.status(400).json({ error: "El guion todavia no tiene escenas" });
    }

    const { data: visualAssets, error: assetsError } = await supabase
      .from("assets")
      .select("scene_id")
      .in(
        "scene_id",
        sceneList.map((s) => s.id)
      )
      .in("type", ["VIDEO", "IMAGE"]);
    if (assetsError) return res.status(400).json({ error: assetsError.message });
    const scenesWithVisual = new Set((visualAssets ?? []).map((a) => a.scene_id as string));

    const onlyIds = Array.isArray(scene_ids)
      ? new Set(scene_ids.filter((id): id is string => typeof id === "string"))
      : null;

    let ctx: VisualContext;
    let bible: StoredVisualBible;
    try {
      ctx = await loadVisualContext(script.id, script.video_project_id, userId);
      bible = await ensureVisualBible(ctx, sceneList);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo armar la biblia visual" });
    }
    const contextKey = hashOf(visualStyleKey(ctx.visualStyle), bible.text);

    const errors = new Map<string, string>();
    const needs = new Set<string>();
    for (const scene of sceneList) {
      const existing = promptOf(scene);
      const storedKey = typeof scene.content?.imagePromptStyleKey === "string" ? scene.content.imagePromptStyleKey : "none";
      const editedByUser = scene.content?.imagePromptEdited === true;
      const stale = !!existing && !editedByUser && storedKey !== contextKey;
      const wanted = regenerate === true ? !onlyIds || onlyIds.has(scene.id) : !existing || stale;
      if (!wanted) continue;
      if (!textOf(scene).trim()) {
        errors.set(scene.id, "La escena no tiene narrativa para derivar el prompt");
        continue;
      }
      needs.add(scene.id);
    }

    const fullScript = sceneList.filter((s) => textOf(s).trim()).map(sequenceSceneOf);
    const generated = new Map<string, string>();
    await mapWithConcurrency(consecutiveChunks(sceneList, needs), SEQUENCE_CONCURRENCY, async (indexes) => {
      const chunkScenes = indexes.map((i) => sceneList[i]!);
      const first = indexes[0]!;
      const last = indexes[indexes.length - 1]!;
      const neighbor = (scene: SceneRow) => {
        // El prompt viejo de una vecina sirve de referencia solo si no se
        // esta rehaciendo en esta misma corrida.
        const prompt = needs.has(scene.id) ? null : promptOf(scene);
        return { ...sequenceSceneOf(scene), ...(prompt ? { prompt } : {}) };
      };
      const before = sceneList.slice(Math.max(0, first - CONTEXT_BEFORE), first).filter((s) => textOf(s).trim());
      const after = sceneList.slice(last + 1, last + 1 + CONTEXT_AFTER).filter((s) => textOf(s).trim());

      try {
        const { prompts } = await runTool<GenerateImagePromptSequenceInput, GenerateImagePromptSequenceOutput>(
          "generate_image_prompt_sequence",
          {
            bible: bible.text,
            scenes: chunkScenes.map(sequenceSceneOf),
            full_script: fullScript,
            context_before: before.map(neighbor),
            context_after: after.map(neighbor),
            ...(ctx.videoTopic ? { video_topic: ctx.videoTopic } : {}),
            ...(ctx.visualStyle ? { visual_style: ctx.visualStyle } : {}),
            ...(ctx.contentPolicy ? { content_policy: ctx.contentPolicy } : {}),
          },
          { userId }
        );
        const byOrder = new Map(prompts.map((p) => [p.order, p.prompt]));
        for (const scene of chunkScenes) {
          const prompt = byOrder.get(scene.order);
          if (!prompt) {
            errors.set(scene.id, "La IA no devolvio prompt para esta escena (proba con 'Otro prompt')");
            continue;
          }
          // Se relee content justo antes de escribir: entre la lectura
          // inicial y aca pueden haber pasado varios segundos de LLM, y el
          // UPDATE pisa el JSON entero.
          const { data: fresh } = await supabase.from("scenes").select("content").eq("id", scene.id).single();
          const { error: updateError } = await supabase
            .from("scenes")
            .update({
              content: {
                ...((fresh?.content as Record<string, unknown> | null) ?? scene.content ?? {}),
                imagePrompt: prompt,
                imagePromptStyleKey: contextKey,
                imagePromptEdited: false,
              },
            })
            .eq("id", scene.id);
          if (updateError) {
            errors.set(scene.id, updateError.message);
            continue;
          }
          generated.set(scene.id, prompt);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "No se pudo generar el prompt";
        for (const scene of chunkScenes) errors.set(scene.id, message);
      }
    });

    const result: SceneImagePrompt[] = sceneList.map((scene) => {
      const fresh = generated.get(scene.id);
      const error = errors.get(scene.id);
      return {
        scene_id: scene.id,
        order: scene.order,
        text: textOf(scene),
        has_visual: scenesWithVisual.has(scene.id),
        image_prompt: fresh ?? promptOf(scene),
        image_prompt_style_key: fresh
          ? contextKey
          : typeof scene.content?.imagePromptStyleKey === "string"
            ? scene.content.imagePromptStyleKey
            : null,
        image_prompt_edited: fresh ? false : scene.content?.imagePromptEdited === true,
        ...(error ? { error } : {}),
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /scripts/:script_id/scenes/visual-bible
// La biblia visual vigente del video (si no existe todavia, text null: se
// arma sola la primera vez que se piden los prompts). `stale`: el guion o el
// diseño del canal cambiaron desde que se armo.
export async function getVisualBible(req: Request, res: Response) {
  try {
    const script = await getOwnedScript(req.params.script_id, req.user!.id, "viewer");
    if (!script) return res.status(404).json({ error: "Script not found" });

    const stored = readStoredBible((script as { visual_bible?: unknown }).visual_bible);
    if (!stored) return res.status(200).json({ text: null, edited: false, stale: false, updated_at: null });

    const ctx = await loadVisualContext(script.id, script.video_project_id, req.user!.id);
    const scenes = await loadScenes(script.id);
    return res.status(200).json({
      text: stored.text,
      edited: stored.edited,
      stale: stored.key !== bibleKeyFor(scenes, ctx.visualStyle),
      updated_at: stored.updated_at,
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

// PUT /scripts/:script_id/scenes/visual-bible
// Body: { text: string } -> la guarda como editada a mano (no se rehace sola)
//       { regenerate: true } -> la vuelve a armar con el guion y el diseño actuales
// En ambos casos los prompts no editados se rehacen la proxima vez que se
// pidan (cambia la huella).
export async function updateVisualBible(req: Request, res: Response) {
  try {
    const script = await getOwnedScript(req.params.script_id, req.user!.id);
    if (!script) return res.status(404).json({ error: "Script not found" });
    const { text, regenerate } = (req.body ?? {}) as { text?: unknown; regenerate?: unknown };

    const scenes = await loadScenes(script.id);
    const ctx = await loadVisualContext(script.id, script.video_project_id, req.user!.id);

    let bible: StoredVisualBible;
    try {
      if (regenerate === true) {
        bible = await ensureVisualBible(ctx, scenes, { force: true });
      } else if (typeof text === "string" && text.trim()) {
        bible = { text: text.trim().slice(0, 12000), key: bibleKeyFor(scenes, ctx.visualStyle), edited: true, updated_at: new Date().toISOString() };
        await saveBible(script.id, bible);
      } else {
        return res.status(400).json({ error: "Mandá text o regenerate: true" });
      }
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo guardar la biblia visual" });
    }

    return res.status(200).json({ text: bible.text, edited: bible.edited, stale: false, updated_at: bible.updated_at });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export interface BatchVisualResult {
  scene_id: string;
  file_name: string;
  ok: boolean;
  error?: string;
}

// POST /scripts/:script_id/scenes/batch-visuals (multipart)
// Campos: files[] (imagenes o videos) + scene_ids (JSON array, misma
// longitud y orden que files). Cada archivo reemplaza el visual de su
// escena (misma semantica que "subir propio" de una escena, ver
// scene.service.ts::uploadSceneVisual), y build_timeline corre UNA vez al
// final de la tanda en vez de una vez por archivo. Responde 200 con el
// resultado por archivo aunque alguno falle, para que el frontend pueda
// marcar solo esos y dejar reintentarlos.
export async function uploadBatchSceneVisuals(req: Request, res: Response) {
  try {
    const { script_id } = req.params;
    const userId = req.user!.id;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    if (files.length === 0) {
      return res.status(400).json({ error: "files is required" });
    }

    let sceneIds: unknown;
    try {
      sceneIds = JSON.parse(String(req.body?.scene_ids ?? ""));
    } catch {
      return res.status(400).json({ error: "scene_ids debe ser un JSON array" });
    }
    if (
      !Array.isArray(sceneIds) ||
      sceneIds.length !== files.length ||
      !sceneIds.every((id) => typeof id === "string")
    ) {
      return res.status(400).json({ error: "scene_ids debe tener un id por archivo, en el mismo orden" });
    }
    if (new Set(sceneIds).size !== sceneIds.length) {
      return res.status(400).json({ error: "Hay mas de un archivo para la misma escena" });
    }

    const script = await getOwnedScript(script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Script not found" });
    }

    // Todas las escenas tienen que ser de ESTE script (ownership ya resuelto
    // arriba) -- nunca confiar en ids sueltos del body.
    const { data: ownedScenes, error: scenesError } = await supabase
      .from("scenes")
      .select("id")
      .eq("script_id", script_id)
      .in("id", sceneIds as string[]);
    if (scenesError) return res.status(400).json({ error: scenesError.message });
    const ownedIds = new Set((ownedScenes ?? []).map((s) => s.id as string));

    const results = await mapWithConcurrency(files, UPLOAD_CONCURRENCY, async (file, index): Promise<BatchVisualResult> => {
      const sceneId = (sceneIds as string[])[index]!;
      const base = { scene_id: sceneId, file_name: file.originalname };
      if (!ownedIds.has(sceneId)) return { ...base, ok: false, error: "Scene not found" };

      const isVideo = file.mimetype.startsWith("video/");
      const isImage = file.mimetype.startsWith("image/");
      if (!isVideo && !isImage) return { ...base, ok: false, error: "El archivo debe ser un video o una imagen" };

      try {
        const extension = (file.originalname.split(".").pop() || (isVideo ? "mp4" : "png")).toLowerCase();
        const storageKey = await uploadSceneAssetFile(file.buffer, file.mimetype, extension);
        await setUploadedVisualForScene(script.video_project_id, sceneId, {
          storage_key: storageKey,
          type: isVideo ? "VIDEO" : "IMAGE",
        });
        return { ...base, ok: true };
      } catch (err) {
        return { ...base, ok: false, error: err instanceof Error ? err.message : "No se pudo cargar el archivo" };
      }
    });

    const okSceneIds = results.filter((r) => r.ok).map((r) => r.scene_id);
    let assets: unknown[] = [];
    if (okSceneIds.length > 0) {
      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .in("scene_id", okSceneIds)
        .in("type", ["VIDEO", "IMAGE"]);
      if (error) return res.status(400).json({ error: error.message });
      assets = data ?? [];

      try {
        await runTool("build_timeline", { video_project_id: script.video_project_id }, { userId });
      } catch {
        // No bloqueante, mismo criterio que las otras ramas de regenerate-visual.
      }
    }

    return res.status(200).json({ results, assets });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
