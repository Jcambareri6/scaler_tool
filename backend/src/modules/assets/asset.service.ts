import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import {
  getOwnedProject,
  getOwnedAsset,
  getSceneVideoProjectId,
} from "../../lib/ownership.js";

export async function createAsset(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;
    const { type, storage_key, scene_id, metadata } = req.body;

    if (typeof type !== "string" || type.trim() === "") {
      return res.status(400).json({ error: "type is required" });
    }
    if (typeof storage_key !== "string" || storage_key.trim() === "") {
      return res.status(400).json({ error: "storage_key is required" });
    }

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (scene_id) {
      const sceneProjectId = await getSceneVideoProjectId(scene_id);
      if (sceneProjectId !== project_id) {
        return res.status(400).json({ error: "scene_id does not belong to this project" });
      }
    }

    const { data, error } = await supabase
      .from("assets")
      .insert({
        video_project_id: project_id,
        scene_id: scene_id ?? null,
        type,
        storage_key,
        metadata: metadata ?? {},
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

export async function listAssets(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("video_project_id", project_id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getAsset(req: Request, res: Response) {
  try {
    const { asset_id } = req.params;
    const userId = req.user!.id;

    const asset = await getOwnedAsset(asset_id, userId);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    return res.status(200).json(asset);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateAsset(req: Request, res: Response) {
  try {
    const { asset_id } = req.params;
    const userId = req.user!.id;
    const { type, storage_key, scene_id, metadata } = req.body;

    const asset = await getOwnedAsset(asset_id, userId);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    if (scene_id) {
      const sceneProjectId = await getSceneVideoProjectId(scene_id);
      if (sceneProjectId !== asset.video_project_id) {
        return res.status(400).json({ error: "scene_id does not belong to this project" });
      }
    }

    const update: Record<string, unknown> = {};
    if (type !== undefined) update.type = type;
    if (storage_key !== undefined) update.storage_key = storage_key;
    if (scene_id !== undefined) update.scene_id = scene_id;
    if (metadata !== undefined) update.metadata = metadata;

    const { data, error } = await supabase
      .from("assets")
      .update(update)
      .eq("id", asset_id)
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

export async function deleteAsset(req: Request, res: Response) {
  try {
    const { asset_id } = req.params;
    const userId = req.user!.id;

    const asset = await getOwnedAsset(asset_id, userId);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const { error } = await supabase.from("assets").delete().eq("id", asset_id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
