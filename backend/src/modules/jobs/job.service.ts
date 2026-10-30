import type { Request, Response } from "express";
import { effectiveFormat } from "../../lib/formats.js";
import { supabase } from "../../lib/supabase.js";
import { getOwnedProject, getOwnedJob } from "../../lib/ownership.js";
import { runRenderPipeline } from "../../pipeline/orchestrator.js";
import { errorMessage } from "../../lib/errors.js";
import { syncProjectStatus } from "../../lib/projectStatus.js";
import { getExecutionMode, pendingQueueFields } from "../../lib/jobQueue.js";
import { renderQueue } from "../../lib/renderQueue.js";
import { chargeRender, refundRender } from "../../lib/accounts.js";
import type { JobStatus } from "../../types/shared/typeShared.js";

export async function listJobs(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;

    const project = await getOwnedProject(project_id, userId, "viewer");
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

    const job = await getOwnedJob(job_id, userId, "viewer");
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    return res.status(200).json(job);
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

    // Formato todo animado: el render de video entero con Remotion todavia
    // no esta. Se frena antes de descontar el video.
    const { data: formatRow } = await supabase
      .from("video_projects")
      .select("video_format")
      .eq("id", job.video_project_id)
      .maybeSingle();
    if (effectiveFormat(formatRow?.video_format, userId) === "animated") {
      return res.status(400).json({ error: "El render del formato todo animado todavía no está disponible." });
    }

    // Contador de videos: el primer Renderizar de un proyecto descuenta 1
    // video al dueno del proyecto (no al miembro del workspace que aprieta
    // el boton). Re-renderizar un proyecto ya cobrado, o uno de una cuenta
    // sin limite, no descuenta. Ver charge_render en la migracion.
    const charge = await chargeRender(job.video_project_id);
    if (charge === "no_credits") {
      return res.status(402).json({
        error: "Se terminaron tus videos. Contactá al administrador para cargar más.",
        code: "NO_VIDEO_CREDITS",
      });
    }
    // Si el render no llega a encolarse, el video recien descontado se
    // devuelve (solo si se desconto en ESTE pedido).
    const undoCharge = () => (charge === "charged" ? refundRender(job.video_project_id) : Promise.resolve());

    // progress:1 marca "en cola, todavia no arranco a renderizar de verdad"
    // -- runRenderPipeline pisa esto con progress:10 recien cuando arranca
    // de verdad: en inline cuando el semaforo de renderQueue lo deja correr
    // (ver abajo), en queue cuando el worker toma el job. Sin esto, un
    // render que queda esperando turno se ve identico en la UI a uno que ya
    // esta procesando FFmpeg.
    // EXECUTION_MODE=queue: el mismo Job (que ya paso por la cola de
    // pre_render) se re-encola en la cola de render para el worker. El
    // filtro por status evita que un doble click lo encole dos veces.
    const queued = getExecutionMode() === "queue";
    const { data, error } = await supabase
      .from("jobs")
      .update({
        status: "RENDERING" satisfies JobStatus,
        progress: 1,
        progress_message: queued ? "En cola, esperando al servidor de render..." : "Preparando el render...",
        ...(queued ? { ...pendingQueueFields("render", userId), error: null } : {}),
      })
      .eq("id", job_id)
      .eq("status", "AWAITING_STOCK_REVIEW")
      .select()
      .maybeSingle();

    if (error) {
      await undoCharge();
      return res.status(400).json({ error: error.message });
    }
    if (!data) {
      await undoCharge();
      return res.status(409).json({ error: "Job is no longer awaiting stock review" });
    }
    await syncProjectStatus(job.video_project_id, "RENDERING");

    // Mismo criterio que runPipeline: el render (descarga de clips + FFmpeg)
    // corre en background, la request responde ya con el Job en RENDERING.
    res.status(202).json(data);
    if (queued) return;

    // renderQueue serializa los renders pesados (ffmpeg) -- un solo render
    // ya puede pasar los 4GB de RAM y llenar /tmp por si solo (ver
    // renderVideo.tool.ts), asi que dos al mismo tiempo tiraban abajo la
    // instancia entera. Si ya hay uno corriendo, este queda esperando su
    // turno en vez de arrancar en paralelo.
    renderQueue
      .run(() => runRenderPipeline(job.video_project_id, { userId, jobId: job.id }))
      .catch(async (pipelineError) => {
        const message = errorMessage(pipelineError, "Render failed");
        await supabase
          .from("jobs")
          .update({ status: "FAILED", error: message, finished_at: new Date().toISOString() })
          .eq("id", job_id);
        await syncProjectStatus(job.video_project_id, "FAILED");
        // Render fallido: si el proyecto nunca llego a tener un video final,
        // se devuelve el video descontado.
        await refundRender(job.video_project_id);
      });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
