import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedScript } from "../../lib/ownership.js";

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
