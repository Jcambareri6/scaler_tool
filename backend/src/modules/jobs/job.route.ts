import { Router } from "express";
import {
  createJob,
  listJobs,
  getJob,
  updateJob,
  approveStockReview,
} from "./job.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mounted at /projects/:project_id/jobs
export const jobListRouter = Router({ mergeParams: true });
jobListRouter.post("/", authMiddleware, createJob);
jobListRouter.get("/", authMiddleware, listJobs);

// Mounted at /jobs/:job_id
export const jobRouter = Router({ mergeParams: true });
jobRouter.get("/", authMiddleware, getJob);
jobRouter.patch("/", authMiddleware, updateJob);
jobRouter.post("/approve-stock-review", authMiddleware, approveStockReview);
