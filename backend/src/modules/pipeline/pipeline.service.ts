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

    try {
      await runPreRenderPipeline(project.id, { userId, jobId: job.id });
    } catch (pipelineError) {
      const message =
        pipelineError instanceof Error ? pipelineError.message : "Pipeline failed";
      await supabase
        .from("jobs")
        .update({ status: "FAILED", error: message, finished_at: new Date().toISOString() })
        .eq("id", job.id);
      return res.status(400).json({ error: message, job_id: job.id });
    }

    const { data: updatedJob } = await supabase.from("jobs").select("*").eq("id", job.id).single();
    return res.status(200).json(updatedJob ?? job);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
