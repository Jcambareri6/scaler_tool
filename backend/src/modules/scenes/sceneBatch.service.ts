import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedScript } from "../../lib/ownership.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { runTool } from "../../tools/index.js";
import { setUploadedVisualForScene, uploadSceneAssetFile } from "../../lib/stockSegments.js";
import type {
  GenerateVideoPromptInput,
  GenerateVideoPromptOutput,
} from "../../tools/generateVideoPrompt.tool.js";
import type { ContentPolicy } from "../../types/shared/typeShared.js";

// Flujo "generar afuera y cargar en lote" (ej: Google Flow, que no tiene
// API): 1) la app arma un prompt de imagen por escena y el usuario los
// exporta numerados; 2) el usuario genera en la herramienta externa y sube
// todo junto -- el frontend empareja cada archivo con su escena (por numero
// en el nombre o por orden) y lo manda aca en tandas chicas.

// Pedidos simultaneos al LLM al armar los prompts -- mismo orden de
// magnitud que el pipeline (ver orchestrator.ts).
const PROMPT_CONCURRENCY = 4;
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
  error?: string;
}

// POST /scripts/:script_id/scenes/image-prompts
// Body: { regenerate?: boolean, scene_ids?: string[] }
// Devuelve un prompt de imagen por escena (en orden). Los que ya existen en
// scene.content.imagePrompt se reusan (asi el usuario puede editarlos a mano
// y exportar de nuevo sin perderlos); solo se generan los que faltan, salvo
// regenerate=true (opcionalmente limitado a scene_ids). Un fallo del LLM en
// una escena no corta el resto: esa escena vuelve con `error`.
export async function generateSceneImagePrompts(req: Request, res: Response) {
  try {
    const { script_id } = req.params;
    const userId = req.user!.id;
    const { regenerate, scene_ids } = (req.body ?? {}) as { regenerate?: boolean; scene_ids?: unknown };

    const script = await getOwnedScript(script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Script not found" });
    }

    const { data: project, error: projectError } = await supabase
      .from("video_projects")
      .select("id, title, content_policy")
      .eq("id", script.video_project_id)
      .single();
    if (projectError || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data: scenes, error: scenesError } = await supabase
      .from("scenes")
      .select("id, order, content")
      .eq("script_id", script_id)
      .order("order", { ascending: true });
    if (scenesError) return res.status(400).json({ error: scenesError.message });

    const sceneList = (scenes ?? []) as SceneRow[];
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
    const videoTopic = (project as { title?: string }).title;
    const contentPolicy = (project as { content_policy?: ContentPolicy | null }).content_policy ?? undefined;

    const result = await mapWithConcurrency(sceneList, PROMPT_CONCURRENCY, async (scene): Promise<SceneImagePrompt> => {
      const content = scene.content ?? {};
      const text = typeof content.text === "string" ? content.text : "";
      const existing =
        typeof content.imagePrompt === "string" && content.imagePrompt.trim() ? content.imagePrompt.trim() : null;
      const base = {
        scene_id: scene.id,
        order: scene.order,
        text,
        has_visual: scenesWithVisual.has(scene.id),
      };

      const shouldGenerate = regenerate === true ? !onlyIds || onlyIds.has(scene.id) : !existing;
      if (!shouldGenerate) return { ...base, image_prompt: existing };
      if (!text.trim()) {
        return { ...base, image_prompt: existing, error: "La escena no tiene narrativa para derivar el prompt" };
      }

      try {
        const { prompt } = await runTool<GenerateVideoPromptInput, GenerateVideoPromptOutput>(
          "generate_video_prompt",
          {
            scene_text: text,
            ...(videoTopic ? { video_topic: videoTopic } : {}),
            ...(contentPolicy ? { content_policy: contentPolicy } : {}),
          },
          { userId }
        );
        // Se relee content justo antes de escribir: entre la lectura inicial
        // y aca pueden haber pasado varios segundos de LLM, y el UPDATE pisa
        // el JSON entero.
        const { data: fresh } = await supabase.from("scenes").select("content").eq("id", scene.id).single();
        const { error: updateError } = await supabase
          .from("scenes")
          .update({ content: { ...((fresh?.content as Record<string, unknown> | null) ?? content), imagePrompt: prompt } })
          .eq("id", scene.id);
        if (updateError) throw new Error(updateError.message);
        return { ...base, image_prompt: prompt };
      } catch (err) {
        return {
          ...base,
          image_prompt: existing,
          error: err instanceof Error ? err.message : "No se pudo generar el prompt",
        };
      }
    });

    return res.status(200).json(result);
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
