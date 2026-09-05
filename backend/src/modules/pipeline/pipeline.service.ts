import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedProject } from "../../lib/ownership.js";
import { runPreRenderPipeline } from "../../pipeline/orchestrator.js";

export async function runPipeline(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        video_project_id: project.id,
        type: "FULL_PIPELINE",
        status: "RUNNING",
        progress: 0,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (jobError || !job) {
      return res.status(400).json({ error: jobError?.message ?? "Failed to create job" });
    }

    // El pipeline corre en background a partir de aca -- la request
    // responde de una con el Job recien creado, en vez de bloquear varios
    // minutos (voz + Whisper + N escenas en paralelo + timeline) en una
    // sola conexion HTTP. El frontend (PreviewPanel) ya hace polling del
    // estado del Job; orchestrator.ts va actualizando status/progress a
    // medida que avanza.
    res.status(202).json(job);

    runPreRenderPipeline(project.id, { userId, jobId: job.id }).catch(async (pipelineError) => {
      const message =
        pipelineError instanceof Error ? pipelineError.message : "Pipeline failed";
      await supabase
        .from("jobs")
        .update({ status: "FAILED", error: message, finished_at: new Date().toISOString() })
        .eq("id", job.id);
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
