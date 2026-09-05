import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import type { Scene } from "../../types/shared/typeShared.js";
import type { ProjectDetail } from "./projects.types.js"

export async function createProject(req: Request, res: Response) {
  try {
    const { title, description, target_duration, content_policy, script_style_id, visual_source } = req.body;

    const userId = req.user!.id;


    const { data, error } = await supabase
      .from("video_projects")
      .insert({
        user_id: userId,
        title,
        description,
        target_duration,
        content_policy,
        script_style_id,
        ...(visual_source ? { visual_source } : {}),
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
export async function deleteProject(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;

    const { error } = await supabase
      .from("video_projects")
      .delete()
      .eq("id", project_id)
      .eq("user_id", userId);

    if (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
export async function getProjectDetail(
  req: Request,
  res: Response
) {
  try {
    const userId = req.user!.id;
    const { project_id } = req.params;

    const { data: project, error: projectError } = await supabase
      .from("video_projects")
      .select("*")
      .eq("id", project_id)
      .eq("user_id", userId)
      .single();

    if (projectError) {
      if (projectError.code === "PGRST116") {
        return res.status(404).json({
          error: "Project not found"
        });
      }

      throw projectError;
    }

    const { data: script, error: scriptError } = await supabase
      .from("scripts")
      .select("*")
      .eq("video_project_id", project_id)
      .single();

    if (scriptError && scriptError.code !== "PGRST116") {
      throw scriptError;
    }

    const { data: timeline, error: timelineError } = await supabase
      .from("timelines")
      .select("*")
      .eq("video_project_id", project_id)
      .single();

    if (timelineError && timelineError.code !== "PGRST116") {
      throw timelineError;
    }

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("*")
      .eq("video_project_id", project_id);

    if (assetsError) {
      throw assetsError;
    }

    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("*")
      .eq("video_project_id", project_id);

    if (jobsError) {
      throw jobsError;
    }

    let scenes: Scene[] = [];

    if (script) {
      const { data: sceneData, error: scenesError } = await supabase
        .from("scenes")
        .select("*")
        .eq("script_id", script.id)
        .order("order", { ascending: true });

      if (scenesError) {
        throw scenesError;
      }

      scenes = sceneData ?? [];
    }

    const scenesWithAssets = scenes.map((scene) => ({
      ...scene,
      assets: (assets ?? []).filter(
        (asset) => asset.scene_id === scene.id
      )
    }));

    const projectDetail: ProjectDetail = {
      ...project,

      script: script
        ? {
            ...script,
            scenes: scenesWithAssets
          }
        : null,

      assets: (assets ?? []).filter(
        (asset) => asset.scene_id === null
      ),

      timeline: timeline ?? null,

      jobs: jobs ?? []
    };

    return res.status(200).json(projectDetail);

  } catch (error) {
    console.error("Error getting project detail:", error);

    return res.status(500).json({
      error: error
    });
  }
}
export async function getProjects(req: Request, res: Response) {

  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from("video_projects")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
export async function getProjectById(req: Request, res: Response) {
  const { project_id } = req.params;
  const userId = req.user!.id;



  try {
    const { data, error } = await supabase
      .from("video_projects")
      .select("*")
      .eq("id", project_id)
      .eq("user_id", userId)
      .single();

    if (!data) {
      return res.status(404).json({
        error: "Project not found",
      });

    }
    res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}


export async function updateProject(req: Request, res: Response) {

  try {
    const { project_id } = req.params;
    const userId = req.user!.id;
    console.log("PROJECT ID:", project_id);
    console.log("USER ID:", userId);

    const { title, description, target_duration, status, content_policy, script_style_id, visual_source } = req.body;

    const { data, error } = await supabase
      .from("video_projects")
      .update({
        title,
        description,
        target_duration,
        status,
        content_policy,
        script_style_id,
        ...(visual_source ? { visual_source } : {}),
      })
      .eq("id", project_id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}