import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import type { Scene } from "../../types/shared/typeShared.js";
import type { ProjectDetail } from "./projects.types.js"
import { getOwnedProject, getWorkspaceRole, getMemberWorkspaceIds, roleAtLeast } from "../../lib/ownership.js";
import { ensurePersonalWorkspace } from "../workspaces/workspace.service.js";

export async function createProject(req: Request, res: Response) {
  try {
    const { title, description, target_duration, content_policy, script_style_id, voice_id, visual_source, transitions_enabled, subtitles_enabled } = req.body;

    const userId = req.user!.id;

    // Sin workspace_id explicito el proyecto va al workspace personal.
    let workspaceId: string = req.body.workspace_id;
    if (workspaceId) {
      const role = await getWorkspaceRole(workspaceId, userId);
      if (!roleAtLeast(role, "editor")) {
        return res.status(403).json({ error: "No tenes permiso para crear proyectos en ese workspace" });
      }
    } else {
      workspaceId = await ensurePersonalWorkspace(userId, req.user!.email);
    }

    const { data, error } = await supabase
      .from("video_projects")
      .insert({
        user_id: userId,
        workspace_id: workspaceId,
        title,
        description,
        target_duration,
        content_policy,
        script_style_id,
        voice_id,
        ...(visual_source ? { visual_source } : {}),
        ...(transitions_enabled !== undefined ? { transitions_enabled } : {}),
        ...(subtitles_enabled !== undefined ? { subtitles_enabled } : {}),
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

    // Borrar afecta a todo el equipo: solo el creador o un admin/owner del
    // workspace (como en Drive, un editor no puede borrar).
    const access = await getOwnedProject(project_id, userId, "admin");
    if (!access) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { error } = await supabase
      .from("video_projects")
      .delete()
      .eq("id", access.id);

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

    const access = await getOwnedProject(project_id, userId, "viewer");
    if (!access) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data: project, error: projectError } = await supabase
      .from("video_projects")
      .select("*")
      .eq("id", access.id)
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
      my_role: access.role,

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
    const workspaceFilter = typeof req.query.workspace_id === "string" ? req.query.workspace_id : null;

    // Proyectos propios + los de cualquier workspace donde soy miembro
    // (equivalente a "Mi unidad" + "Unidades compartidas" de Drive).
    const workspaceIds = await getMemberWorkspaceIds(userId);
    if (workspaceFilter && !workspaceIds.includes(workspaceFilter)) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    let query = supabase.from("video_projects").select("*");
    if (workspaceFilter) {
      query = query.eq("workspace_id", workspaceFilter);
    } else if (workspaceIds.length > 0) {
      query = query.or(`user_id.eq.${userId},workspace_id.in.(${workspaceIds.join(",")})`);
    } else {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

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
    const access = await getOwnedProject(project_id, userId, "viewer");
    if (!access) {
      return res.status(404).json({
        error: "Project not found",
      });
    }

    const { data } = await supabase
      .from("video_projects")
      .select("*")
      .eq("id", access.id)
      .single();

    if (!data) {
      return res.status(404).json({
        error: "Project not found",
      });

    }
    res.status(200).json({ ...data, my_role: access.role });
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

    const { title, description, target_duration, status, content_policy, script_style_id, voice_id, visual_source, transitions_enabled, subtitles_enabled, workspace_id } = req.body;

    const access = await getOwnedProject(project_id, userId, "editor");
    if (!access) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Mover de workspace ("Mover a..." de Drive): hay que poder administrar
    // el proyecto en el origen y poder crear en el destino.
    if (workspace_id !== undefined && workspace_id !== access.workspace_id) {
      if (!roleAtLeast(access.role, "admin")) {
        return res.status(403).json({ error: "Solo el creador o un admin puede mover el proyecto" });
      }
      if (!roleAtLeast(await getWorkspaceRole(workspace_id, userId), "editor")) {
        return res.status(403).json({ error: "No tenes permiso en el workspace destino" });
      }
    }

    const { data, error } = await supabase
      .from("video_projects")
      .update({
        title,
        description,
        target_duration,
        status,
        content_policy,
        script_style_id,
        voice_id,
        ...(visual_source ? { visual_source } : {}),
        ...(transitions_enabled !== undefined ? { transitions_enabled } : {}),
        ...(subtitles_enabled !== undefined ? { subtitles_enabled } : {}),
        ...(workspace_id ? { workspace_id } : {}),
      })
      .eq("id", access.id)
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