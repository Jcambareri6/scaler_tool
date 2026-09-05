import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedScript } from "../../lib/ownership.js";
import { runTool } from "../../tools/index.js";
import {
  replaceStockSegmentsForScene,
  setAiVideoSegmentsForScene,
  setAiImageForScene,
  type AiVideoSegment,
} from "../../lib/stockSegments.js";
import type { SearchStockInput, SearchStockOutput } from "../../tools/searchStock.tool.js";
import type {
  GenerateStockKeywordsInput,
  GenerateStockKeywordsOutput,
} from "../../tools/generateStockKeywords.tool.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "../../tools/generateVideo.tool.js";
import type {
  GenerateVideoPromptInput,
  GenerateVideoPromptOutput,
} from "../../tools/generateVideoPrompt.tool.js";
import type { GenerateImageInput, GenerateImageOutput } from "../../tools/generateImage.tool.js";
import type { ContentPolicy } from "../../types/shared/typeShared.js";

// Tope de seguridad, mismo criterio que orchestrator.ts::generateAiVisual --
// evita gasto descontrolado si generate_video devolviera duration_seconds 0.
const MAX_AI_VIDEO_SEGMENTS = 10;

export async function createScene(req: Request, res: Response) {
  try {
    const { script_id } = req.params;
    const userId = req.user!.id;
    const { order, content } = req.body;

    const script = await getOwnedScript(script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Script not found" });
    }

    const { data, error } = await supabase
      .from("scenes")
      .insert({
        script_id,
        order,
        content: content ?? {},
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function listScenes(req: Request, res: Response) {
  try {
    const { script_id } = req.params;
    const userId = req.user!.id;

    const script = await getOwnedScript(script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Script not found" });
    }

    const { data, error } = await supabase
      .from("scenes")
      .select("*")
      .eq("script_id", script_id)
      .order("order", { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getScene(req: Request, res: Response) {
  try {
    const { scene_id } = req.params;
    const userId = req.user!.id;

    const { data: scene, error: sceneError } = await supabase
      .from("scenes")
      .select("*")
      .eq("id", scene_id)
      .single();

    if (sceneError || !scene) {
      return res.status(404).json({ error: "Scene not found" });
    }

    const script = await getOwnedScript(scene.script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Scene not found" });
    }

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("*")
      .eq("scene_id", scene_id);

    if (assetsError) {
      throw assetsError;
    }

    return res.status(200).json({ ...scene, assets: assets ?? [] });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateScene(req: Request, res: Response) {
  try {
    const { scene_id } = req.params;
    const userId = req.user!.id;
    const { order, content } = req.body;

    const { data: scene, error: sceneError } = await supabase
      .from("scenes")
      .select("id, script_id")
      .eq("id", scene_id)
      .single();

    if (sceneError || !scene) {
      return res.status(404).json({ error: "Scene not found" });
    }

    const script = await getOwnedScript(scene.script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Scene not found" });
    }

    const { data, error } = await supabase
      .from("scenes")
      .update({ order, content })
      .eq("id", scene_id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteScene(req: Request, res: Response) {
  try {
    const { scene_id } = req.params;
    const userId = req.user!.id;

    const { data: scene, error: sceneError } = await supabase
      .from("scenes")
      .select("id, script_id")
      .eq("id", scene_id)
      .single();

    if (sceneError || !scene) {
      return res.status(404).json({ error: "Scene not found" });
    }

    const script = await getOwnedScript(scene.script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Scene not found" });
    }

    const { error } = await supabase.from("scenes").delete().eq("id", scene_id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Repromptea el stock de UNA escena puntual (fuera del pipeline
// determinístico completo): reusa la misma Tool search_stock, pero con
// keywords derivadas de un prompt custom (si lo mandan) o del texto de la
// narrativa de la escena, y evita repetir el clip que ya estaba elegido.
// Actualiza el Asset existente en vez de duplicarlo, y refresca
// timelines.content para que no quede una foto vieja del asset de la
// escena (ver build_timeline en tools/buildTimeline.tool.ts).
export async function regenerateSceneVisual(req: Request, res: Response) {
  try {
    const { scene_id } = req.params;
    const userId = req.user!.id;
    const { prompt, source, ai_prompt } = (req.body ?? {}) as {
      prompt?: string;
      source?: "stock" | "ai" | "ai_image";
      ai_prompt?: string;
    };

    const { data: scene, error: sceneError } = await supabase
      .from("scenes")
      .select("id, script_id, content")
      .eq("id", scene_id)
      .single();
    if (sceneError || !scene) {
      return res.status(404).json({ error: "Scene not found" });
    }

    const script = await getOwnedScript(scene.script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Scene not found" });
    }

    const { data: project, error: projectError } = await supabase
      .from("video_projects")
      .select("id, title, content_policy")
      .eq("id", script.video_project_id)
      .single();
    if (projectError || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const sceneText = ((scene.content as { text?: string } | null)?.text) ?? "";
    const durationMatch = ((scene.content as { duration?: unknown } | null)?.duration as string | undefined)
      ?.match(/(\d+(?:\.\d+)?)/);
    const minDurationSeconds = durationMatch ? Number(durationMatch[1]) : 30;

    // "ai" / "ai_image": mismo flujo que el pipeline automatico en modo
    // visual_source "ai" (ver orchestrator.ts), pero con el prompt que haya
    // tipeado el usuario aca en vez de uno derivado automaticamente -- si
    // lo deja vacio, se deriva uno igual (generate_video_prompt) a partir
    // de la narrativa de la escena. Ambas fuentes comparten esta derivacion
    // de prompt (el prompt de video le sirve igual a la imagen: describe
    // una escena filmable, que es tambien una buena descripcion de imagen).
    if (source === "ai" || source === "ai_image") {
      const customAiPrompt = typeof ai_prompt === "string" && ai_prompt.trim() ? ai_prompt.trim() : null;
      let visualPrompt = customAiPrompt;
      if (!visualPrompt) {
        if (!sceneText.trim()) {
          return res.status(400).json({
            error: "No hay texto para generar el prompt de IA (mandá un prompt o cargá la narrativa de la escena primero)",
          });
        }
        const videoTopic = (project as { title?: string }).title;
        const contentPolicy = (project as { content_policy?: ContentPolicy | null }).content_policy ?? undefined;
        const promptResult = await runTool<GenerateVideoPromptInput, GenerateVideoPromptOutput>(
          "generate_video_prompt",
          {
            scene_text: sceneText,
            ...(videoTopic ? { video_topic: videoTopic } : {}),
            ...(contentPolicy ? { content_policy: contentPolicy } : {}),
          },
          { userId }
        );
        visualPrompt = promptResult.prompt;
      }

      if (source === "ai_image") {
        let image: GenerateImageOutput;
        try {
          image = await runTool<GenerateImageInput, GenerateImageOutput>(
            "generate_image",
            { prompt: visualPrompt, scene_id: scene_id as string },
            { userId }
          );
        } catch (toolError) {
          const message = toolError instanceof Error ? toolError.message : "generate_image failed";
          return res.status(400).json({ error: message });
        }

        await setAiImageForScene(project.id, scene_id as string, {
          storage_key: image.storage_key,
          prompt: visualPrompt,
        });

        const { data: imageAsset, error: imageAssetError } = await supabase
          .from("assets")
          .select("*")
          .eq("scene_id", scene_id)
          .eq("type", "IMAGE");
        if (imageAssetError) return res.status(400).json({ error: imageAssetError.message });

        try {
          await runTool("build_timeline", { video_project_id: project.id }, { userId });
        } catch {
          // No bloqueante, ver comentario equivalente mas abajo en la rama de stock.
        }

        return res.status(200).json(imageAsset ?? []);
      }

      // "ai": el modelo de video (Veo 3.1 8s fijos, Seedance 2 hasta 15s)
      // genera clips mas cortos que la escena -- se piden varios seguidos
      // con el mismo prompt hasta cubrirla entera (mismo criterio que
      // orchestrator.ts::generateAiVisual y que search_stock completando
      // con mas de un candidato).
      const segments: AiVideoSegment[] = [];
      let remaining = minDurationSeconds;
      try {
        for (let i = 0; i < MAX_AI_VIDEO_SEGMENTS && remaining > 0.5; i++) {
          const video = await runTool<GenerateVideoInput, GenerateVideoOutput>(
            "generate_video",
            { prompt: visualPrompt, scene_id: scene_id as string, duration_seconds: remaining },
            { userId }
          );
          segments.push({ storage_key: video.storage_key, duration_seconds: video.duration_seconds, prompt: visualPrompt });
          remaining -= video.duration_seconds || 0.5;
        }
      } catch (toolError) {
        const message = toolError instanceof Error ? toolError.message : "generate_video failed";
        return res.status(400).json({ error: message });
      }

      await setAiVideoSegmentsForScene(project.id, scene_id as string, segments);

      const { data: aiAsset, error: aiAssetError } = await supabase
        .from("assets")
        .select("*")
        .eq("scene_id", scene_id)
        .eq("type", "VIDEO");
      if (aiAssetError) return res.status(400).json({ error: aiAssetError.message });

      try {
        await runTool("build_timeline", { video_project_id: project.id }, { userId });
      } catch {
        // No bloqueante, ver comentario equivalente mas abajo en la rama de stock.
      }

      return res.status(200).json(aiAsset ?? []);
    }

    const customPrompt = typeof prompt === "string" && prompt.trim() ? prompt.trim() : null;
    const promptText = customPrompt ?? sceneText;
    if (!promptText.trim()) {
      return res.status(400).json({
        error: "No hay texto para buscar stock (mandá un prompt o cargá la narrativa de la escena primero)",
      });
    }
    // Con prompt custom: se busca tal cual lo escribio el usuario (permite
    // separar con comas para dar variantes), sin pasar por la IA -- eso
    // esta pensado para traducir/interpretar un parrafo de narrativa, no
    // para reinterpretar una busqueda que el usuario ya tipeo a proposito.
    let keywords: string[];
    if (customPrompt) {
      keywords = customPrompt.split(",").map((p) => p.trim()).filter(Boolean);
    } else {
      const videoTopic = (project as { title?: string }).title;
      const contentPolicy = (project as { content_policy?: ContentPolicy | null }).content_policy ?? undefined;
      const keywordsResult = await runTool<GenerateStockKeywordsInput, GenerateStockKeywordsOutput>(
        "generate_stock_keywords",
        {
          scene_text: promptText,
          ...(videoTopic ? { video_topic: videoTopic } : {}),
          ...(contentPolicy ? { content_policy: contentPolicy } : {}),
        },
        { userId }
      );
      keywords = keywordsResult.keywords;
    }

    let searchOutput: SearchStockOutput;
    try {
      searchOutput = await runTool<SearchStockInput, SearchStockOutput>(
        "search_stock",
        {
          keywords,
          ...(project.content_policy ? { content_policy: project.content_policy } : {}),
          min_duration_seconds: minDurationSeconds,
        },
        { userId }
      );
    } catch (toolError) {
      const message = toolError instanceof Error ? toolError.message : "search_stock failed";
      return res.status(400).json({ error: message });
    }

    if (searchOutput.candidates.length === 0) {
      return res.status(404).json({ error: "No se encontraron clips de stock para ese prompt" });
    }

    // Mismo criterio que el pipeline automatico: si ningun candidato solo
    // alcanza para cubrir la escena entera, se completa con mas clips
    // distintos en vez de repetir el mismo (ver replaceStockSegmentsForScene).
    // Ademas de no repetir DENTRO de esta escena, tampoco se repite un clip
    // que ya este en uso en OTRA escena del mismo video -- se arma el set
    // a partir de lo que ya hay guardado en `assets` para el resto de las
    // escenas del proyecto (esta escena se excluye porque se va a
    // reemplazar entera).
    const { data: otherSceneAssets, error: otherAssetsError } = await supabase
      .from("assets")
      .select("metadata")
      .eq("video_project_id", project.id)
      .eq("type", "VIDEO")
      .neq("scene_id", scene_id as string)
      .contains("metadata", { kind: "stock_preview" });
    if (otherAssetsError) return res.status(400).json({ error: otherAssetsError.message });
    const usedStockKeys = new Set<string>(
      (otherSceneAssets ?? [])
        .map((row) => row.metadata as { provider?: string; external_id?: string } | null)
        .filter((meta): meta is { provider: string; external_id: string } => !!meta?.provider && !!meta?.external_id)
        .map((meta) => `${meta.provider}:${meta.external_id}`)
    );
    await replaceStockSegmentsForScene(project.id, scene_id as string, searchOutput.candidates, minDurationSeconds, usedStockKeys);

    const { data: segments, error: segmentsError } = await supabase
      .from("assets")
      .select("*")
      .eq("scene_id", scene_id)
      .eq("type", "VIDEO")
      .order("created_at", { ascending: true });
    if (segmentsError) return res.status(400).json({ error: segmentsError.message });

    try {
      await runTool("build_timeline", { video_project_id: project.id }, { userId });
    } catch {
      // No bloqueante: los Assets ya quedaron persistidos, y el proximo
      // build_timeline (por ejemplo al aprobar el render) los vuelve a
      // resolver de todas formas.
    }

    return res.status(200).json(segments ?? []);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function reorderScenes(req: Request, res: Response) {
  try {
    const { script_id } = req.params;
    const userId = req.user!.id;
    const { scenes } = req.body as { scenes: { id: string; order: number }[] };

    const script = await getOwnedScript(script_id, userId);
    if (!script) {
      return res.status(404).json({ error: "Script not found" });
    }

    if (!Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ error: "scenes must be a non-empty array" });
    }

    for (const { id, order } of scenes) {
      const { error } = await supabase
        .from("scenes")
        .update({ order })
        .eq("id", id)
        .eq("script_id", script_id);

      if (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    const { data, error } = await supabase
      .from("scenes")
      .select("*")
      .eq("script_id", script_id)
      .order("order", { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
