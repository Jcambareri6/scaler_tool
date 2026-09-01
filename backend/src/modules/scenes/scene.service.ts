import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedScript } from "../../lib/ownership.js";
import { deriveKeywords } from "../../lib/keywords.js";
import { runTool } from "../../tools/index.js";
import type { SearchStockInput, SearchStockOutput } from "../../tools/searchStock.tool.js";

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
    const { prompt } = (req.body ?? {}) as { prompt?: string };

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
      .select("id, content_policy")
      .eq("id", script.video_project_id)
      .single();
    if (projectError || !project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const sceneText = ((scene.content as { text?: string } | null)?.text) ?? "";
    const customPrompt = typeof prompt === "string" && prompt.trim() ? prompt.trim() : null;
    const promptText = customPrompt ?? sceneText;
    if (!promptText.trim()) {
      return res.status(400).json({
        error: "No hay texto para buscar stock (mandá un prompt o cargá la narrativa de la escena primero)",
      });
    }
    // Con prompt custom: se busca tal cual lo escribio el usuario (permite
    // separar con comas para dar variantes), sin pasar por deriveKeywords
    // -- esa heuristica esta pensada para extraer keywords de un parrafo de
    // narrativa (donde no toda palabra importa igual), no para respetar una
    // busqueda que el usuario tipeo a proposito. Si la trocearamos igual,
    // la primera palabra que sobreviva el filtro (no necesariamente la mas
    // relevante) termina definiendo el resultado, porque el primer
    // candidato devuelto es el de la primera keyword.
    const keywords = customPrompt
      ? customPrompt.split(",").map((p) => p.trim()).filter(Boolean)
      : deriveKeywords(promptText);

    const { data: existingAsset } = await supabase
      .from("assets")
      .select("id, metadata")
      .eq("scene_id", scene_id)
      .eq("type", "VIDEO")
      .contains("metadata", { kind: "stock_preview" })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let searchOutput: SearchStockOutput;
    try {
      searchOutput = await runTool<SearchStockInput, SearchStockOutput>(
        "search_stock",
        {
          keywords,
          ...(project.content_policy ? { content_policy: project.content_policy } : {}),
        },
        { userId }
      );
    } catch (toolError) {
      const message = toolError instanceof Error ? toolError.message : "search_stock failed";
      return res.status(400).json({ error: message });
    }

    const previousExternalId = (existingAsset?.metadata as { external_id?: string } | null)
      ?.external_id;
    const chosen =
      searchOutput.candidates.find((c) => c.external_id !== previousExternalId) ??
      searchOutput.candidates[0];

    if (!chosen) {
      return res.status(404).json({ error: "No se encontraron clips de stock para ese prompt" });
    }

    const assetPayload = {
      video_project_id: project.id,
      scene_id,
      type: "VIDEO",
      storage_key: chosen.preview_url,
      metadata: {
        kind: "stock_preview",
        provider: chosen.provider,
        external_id: chosen.external_id,
        url: chosen.url,
        prompt: promptText,
      },
    };

    let asset;
    if (existingAsset) {
      const { data, error } = await supabase
        .from("assets")
        .update(assetPayload)
        .eq("id", existingAsset.id)
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      asset = data;
    } else {
      const { data, error } = await supabase
        .from("assets")
        .insert(assetPayload)
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      asset = data;
    }

    try {
      await runTool("build_timeline", { video_project_id: project.id }, { userId });
    } catch {
      // No bloqueante: el Asset ya quedo persistido, y el proximo
      // build_timeline (por ejemplo al aprobar el render) lo vuelve a
      // resolver de todas formas.
    }

    return res.status(200).json(asset);
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
