import 'dotenv/config';
import express from "express";
import cors from "cors";


import { supabase } from './lib/supabase.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import authRouter from "./modules/auth/auth.route.js";
import Projectrouter from './modules/projects/projects.routes.js';
import scriptRouter from './modules/scripts/script.route.js';
import { sceneListRouter, sceneRouter } from './modules/scenes/scene.route.js';
import { jobListRouter, jobRouter } from './modules/jobs/job.route.js';
import { assetListRouter, assetRouter } from './modules/assets/asset.route.js';
import toolRouter from './modules/tools/tool.route.js';
import providerRouter from './modules/providers/provider.route.js';
import agentRouter from './modules/agents/agent.route.js';
import pipelineRouter from './modules/pipeline/pipeline.route.js';
import scriptStyleRouter from './modules/scriptStyles/scriptStyle.route.js';
import fileRouter from './modules/files/file.route.js';

const app = express();

// Frontend/vite.config.ts corre en 8443 por default (o el $PORT que le
// pasen); FRONTEND_ORIGIN permite overridear/agregar otro origen en .env.
const allowedOrigins = [
  "http://localhost:8443",
  "http://127.0.0.1:8443",
  ...(process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : []),
];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Sin auth a proposito -- lo pega el health check de Render (u otro
// orquestador) para saber si el proceso esta vivo, antes de que exista
// cualquier concepto de usuario logueado.
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

app.use("/auth",authRouter)
app.use("/projects",Projectrouter)
app.use("/projects/:project_id/script", scriptRouter)
app.use("/scripts/:script_id/scenes", sceneListRouter)
app.use("/scenes/:scene_id", sceneRouter)
app.use("/projects/:project_id/jobs", jobListRouter)
app.use("/jobs/:job_id", jobRouter)
app.use("/projects/:project_id/assets", assetListRouter)
app.use("/assets/:asset_id", assetRouter)
app.use("/projects/:project_id/pipeline", pipelineRouter)
app.use("/tools", toolRouter)
app.use("/providers", providerRouter)
app.use("/agents", agentRouter)
app.use("/script-styles", scriptStyleRouter)
app.use("/files", fileRouter)

export default app;