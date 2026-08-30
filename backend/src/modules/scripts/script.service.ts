import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedProject } from "../../lib/ownership.js";
import type { ScriptDetail } from "./script.types.js";

export async function createScript(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;
    const { content } = req.body;

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data, error } = await supabase
      .from("scripts")
      .insert({
        video_project_id: project_id,
        content: content ?? {},
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "This project already has a script",
        });
      }

      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getScript(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data: script, error: scriptError } = await supabase
      .from("scripts")
      .select("*")
      .eq("video_project_id", project_id)
      .single();

    if (scriptError) {
      if (scriptError.code === "PGRST116") {
        return res.status(404).json({ error: "Script not found" });
      }
      throw scriptError;
    }

    const { data: scenes, error: scenesError } = await supabase
      .from("scenes")
      .select("*")
      .eq("script_id", script.id)
      .order("order", { ascending: true });

    if (scenesError) {
      throw scenesError;
    }

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("*")
      .eq("video_project_id", project_id)
      .not("scene_id", "is", null);

    if (assetsError) {
      throw assetsError;
    }

    const scriptDetail: ScriptDetail = {
      ...script,
      scenes: (scenes ?? []).map((scene) => ({
        ...scene,
        assets: (assets ?? []).filter((asset) => asset.scene_id === scene.id),
      })),
    };

    return res.status(200).json(scriptDetail);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateScript(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;
    const { content } = req.body;

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data, error } = await supabase
      .from("scripts")
      .update({ content })
      .eq("video_project_id", project_id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Script not found" });
      }
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
