import type { Request, Response } from "express";
import { listTools, runTool, ProviderNotConfiguredError } from "../../tools/index.js";
import { getOwnedJob } from "../../lib/ownership.js";
import { getExecutionMode } from "../../lib/jobQueue.js";

// Mensajes que las propias tools lanzan a proposito y son seguros de
// mostrar tal cual (no filtran detalles de Postgres ni de proveedores
// externos) -- cualquier otro error se loguea server-side y se devuelve
// generico, para no repetir el leak de "OpenAI API error (...): <body>" o
// similares directo al cliente.
const SAFE_ERROR_MESSAGES = new Set([
  "Project not found",
  "Script not found",
  "Asset not found",
  "Job not found",
]);

function isSafeToolError(error: unknown): error is Error {
  return (
    error instanceof ProviderNotConfiguredError ||
    (error instanceof Error && SAFE_ERROR_MESSAGES.has(error.message))
  );
}

export async function listAvailableTools(_req: Request, res: Response) {
  return res.status(200).json(listTools());
}

export async function executeTool(req: Request, res: Response) {
  try {
    const toolName = req.params.tool_name;
    if (typeof toolName !== "string") {
      return res.status(400).json({ error: "tool_name is required" });
    }

    // Con EXECUTION_MODE=queue la API corre en un plan chico sin ffmpeg
    // pesado: el render solo se dispara aprobando el stock
    // (POST /jobs/:id/approve-stock-review), que lo encola para el worker.
    if (toolName === "render_video" && getExecutionMode() === "queue") {
      return res.status(409).json({
        error: "El render corre en el servidor de render: aprobá el stock del proyecto para encolarlo.",
      });
    }

    const userId = req.user!.id;
    const { job_id, input } = req.body as { job_id?: string; input?: unknown };

    if (job_id) {
      const job = await getOwnedJob(job_id, userId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
    }

    const output = await runTool(toolName, input ?? {}, {
      userId,
      ...(job_id ? { jobId: job_id } : {}),
    });
    return res.status(200).json({ output });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not registered")) {
      return res.status(404).json({ error: error.message });
    }
    if (isSafeToolError(error)) {
      return res.status(400).json({ error: error.message });
    }
    console.error(`Tool "${req.params.tool_name}" execution failed:`, error);
    return res.status(400).json({ error: "No se pudo ejecutar la herramienta, intentá de nuevo." });
  }
}
