import { Router } from "express";
import { runPipeline } from "./pipeline.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mounted at /projects/:project_id/pipeline
const pipelineRouter = Router({ mergeParams: true });
pipelineRouter.post("/run", authMiddleware, runPipeline);

export default pipelineRouter;
