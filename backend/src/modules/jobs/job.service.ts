import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedProject, getOwnedJob } from "../../lib/ownership.js";
import { runRenderPipeline } from "../../pipeline/orchestrator.js";
import { errorMessage } from "../../lib/errors.js";
import { syncProjectStatus } from "../../lib/projectStatus.js";
import type { JobStatus } from "../../types/shared/typeShared.js";

// Orden del pipeline (ver CLAUDE.md, gap #1 del LEEME): AWAITING_STOCK_REVIEW
// es el gate obligatorio antes de RENDERING. FAILED puede llegar desde
// cualquier estado en curso; COMPLETED y FAILED son terminales.
const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["SCRIPT_DONE", "FAILED"],
  SCRIPT_DONE: ["AUDIO_DONE", "FAILED"],
  AUDIO_DONE: ["VISUALS_DONE", "FAILED"],
  VISUALS_DONE: ["AWAITING_STOCK_REVIEW", "FAILED"],
  AWAITING_STOCK_REVIEW: ["RENDERING", "FAILED"],
  RENDERING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export async function createJob(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;
    const { type } = req.body;

    if (typeof type !== "string" || type.trim() === "") {
      return res.status(400).json({ error: "type is required" });
    }

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data, error } = await supabase
      .from("jobs")
      .insert({
        video_project_id: project_id,
        type,
        status: "QUEUED",
        progress: 0,
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

export async function listJobs(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { data, error } = await supabase
      .from("jobs")
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

export async function getJob(req: Request, res: Response) {
  try {
    const { job_id } = req.params;
    const userId = req.user!.id;

    const job = await getOwnedJob(job_id, userId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    return res.status(200).json(job);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateJob(req: Request, res: Response) {
  try {
    const { job_id } = req.params;
    const userId = req.user!.id;
    const { status, progress, error: jobError } = req.body as {
      status?: JobStatus;
      progress?: number;
      error?: string | null;
    };

    const job = await getOwnedJob(job_id, userId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (progress !== undefined && (progress < 0 || progress > 100)) {
      return res.status(400).json({ error: "progress must be between 0 and 100" });
    }

    const update: Record<string, unknown> = {};
    if (progress !== undefined) update.progress = progress;
    if (jobError !== undefined) update.error = jobError;

    if (status !== undefined) {
      const allowed = JOB_TRANSITIONS[job.status];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Invalid transition from ${job.status} to ${status}`,
        });
      }
      update.status = status;
      if (status === "RUNNING" && !job.started_at) {
        update.started_at = new Date().toISOString();
      }
      if (status === "COMPLETED" || status === "FAILED") {
        update.finished_at = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from("jobs")
      .update(update)
      .eq("id", job_id)
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

// Gap #1 (LEEME): endpoint de aprobacion humana del stock, unico camino
// para salir de AWAITING_STOCK_REVIEW hacia RENDERING.
export async function approveStockReview(req: Request, res: Response) {
  try {
    const { job_id } = req.params;
    const userId = req.user!.id;

    const job = await getOwnedJob(job_id, userId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (job.status !== "AWAITING_STOCK_REVIEW") {
      return res.status(400).json({
        error: `Job is not awaiting stock review (current status: ${job.status})`,
      });
    }

    const { data, error } = await supabase
      .from("jobs")
      .update({ status: "RENDERING" satisfies JobStatus })
      .eq("id", job_id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }
    await syncProjectStatus(job.video_project_id, "RENDERING");

    // Mismo criterio que runPipeline: el render (descarga de clips + FFmpeg)
    // corre en background, la request responde ya con el Job en RENDERING.
    res.status(202).json(data);

    runRenderPipeline(job.video_project_id, { userId, jobId: job.id }).catch(async (pipelineError) => {
      const message = errorMessage(pipelineError, "Render failed");
      await supabase
        .from("jobs")
        .update({ status: "FAILED", error: message, finished_at: new Date().toISOString() })
        .eq("id", job_id);
      await syncProjectStatus(job.video_project_id, "FAILED");
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
