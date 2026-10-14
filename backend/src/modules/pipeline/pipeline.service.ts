import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedProject } from "../../lib/ownership.js";
import { runPreRenderPipeline } from "../../pipeline/orchestrator.js";
import { errorMessage } from "../../lib/errors.js";
import { syncProjectStatus } from "../../lib/projectStatus.js";
import { getExecutionMode, pendingQueueFields } from "../../lib/jobQueue.js";
import type { JobStatus } from "../../types/shared/typeShared.js";

// Estados en los que el proyecto ya tiene un trabajo en curso (preview
// generandose o render corriendo): no se lanza otra preview encima.
const IN_PROGRESS_STATUSES: JobStatus[] = ["QUEUED", "RUNNING", "SCRIPT_DONE", "AUDIO_DONE", "VISUALS_DONE", "RENDERING"];

// Un job "en curso" mas viejo que esto se considera colgado (ej: la API se
// reinicio a mitad de camino en modo inline y nunca lo marco FAILED) y no
// bloquea una preview nueva -- si no, el proyecto quedaria trabado para siempre.
const STALE_JOB_MS = 3 * 60 * 60 * 1000;

export async function runPipeline(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;

    const project = await getOwnedProject(project_id, userId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Una preview a la vez por proyecto: sin esto, apretar "Generar" varias
    // veces encolaba N pipelines (cada uno paga Whisper y LLM) y llenaba la
    // cola del worker, frenando a todos los demas usuarios.
    const { data: running, error: runningError } = await supabase
      .from("jobs")
      .select("id")
      .eq("video_project_id", project.id)
      .in("status", IN_PROGRESS_STATUSES)
      .gte("created_at", new Date(Date.now() - STALE_JOB_MS).toISOString())
      .limit(1);
    if (runningError) {
      return res.status(500).json({ error: "Internal server error" });
    }
    if (running && running.length > 0) {
      return res.status(409).json({ error: "Este proyecto ya se está procesando: esperá a que termine" });
    }

    // EXECUTION_MODE=queue: el Job queda QUEUED en la cola y lo toma el
    // worker (src/worker.ts), que lo pasa a RUNNING al arrancar. Inline:
    // como siempre, el pipeline corre en este mismo proceso.
    const queued = getExecutionMode() === "queue";
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert(
        queued
          ? {
              video_project_id: project.id,
              type: "FULL_PIPELINE",
              status: "QUEUED",
              progress: 0,
              progress_message: "En cola, esperando al servidor de procesamiento...",
              ...pendingQueueFields("pre_render", userId),
            }
          : {
              video_project_id: project.id,
              type: "FULL_PIPELINE",
              status: "RUNNING",
              progress: 0,
              started_at: new Date().toISOString(),
            }
      )
      .select()
      .single();
    if (jobError || !job) {
      return res.status(400).json({ error: jobError?.message ?? "Failed to create job" });
    }
    await syncProjectStatus(project.id, queued ? "QUEUED" : "RUNNING");

    // El pipeline corre en background a partir de aca -- la request
    // responde de una con el Job recien creado, en vez de bloquear varios
    // minutos (voz + Whisper + N escenas en paralelo + timeline) en una
    // sola conexion HTTP. El frontend (PreviewPanel) ya hace polling del
    // estado del Job; orchestrator.ts va actualizando status/progress a
    // medida que avanza.
    res.status(202).json(job);
    if (queued) return;

    runPreRenderPipeline(project.id, { userId, jobId: job.id }).catch(async (pipelineError) => {
      const message = errorMessage(pipelineError, "Pipeline failed");
      await supabase
        .from("jobs")
        .update({ status: "FAILED", error: message, finished_at: new Date().toISOString() })
        .eq("id", job.id);
      await syncProjectStatus(project.id, "FAILED");
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
