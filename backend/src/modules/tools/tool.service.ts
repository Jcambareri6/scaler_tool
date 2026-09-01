import type { Request, Response } from "express";
import { listTools, runTool } from "../../tools/index.js";
import { getOwnedJob } from "../../lib/ownership.js";

export async function listAvailableTools(_req: Request, res: Response) {
  return res.status(200).json(listTools());
}

export async function executeTool(req: Request, res: Response) {
  try {
    const toolName = req.params.tool_name;
    if (typeof toolName !== "string") {
      return res.status(400).json({ error: "tool_name is required" });
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
    const message = error instanceof Error ? error.message : "Tool execution failed";
    if (message.includes("is not registered")) {
      return res.status(404).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
}
