import { Router } from "express";
import { listJobs, getJob, approveStockReview } from "./job.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Los Jobs solo los crea y los mueve de estado el sistema (pipeline.service,
// approveStockReview, orchestrator y worker). No hay POST ni PATCH para el
// usuario: con PATCH se podia, por ejemplo, pasar un Job a RENDERING o a
// COMPLETED a mano sin que corriera nada.

// Mounted at /projects/:project_id/jobs
export const jobListRouter = Router({ mergeParams: true });
jobListRouter.get("/", authMiddleware, listJobs);

// Mounted at /jobs/:job_id
export const jobRouter = Router({ mergeParams: true });
jobRouter.get("/", authMiddleware, getJob);
jobRouter.post("/approve-stock-review", authMiddleware, approveStockReview);
