import 'dotenv/config';
import express from "express";


import { supabase } from './lib/supabase.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import authRouter from "../src/modules/auth/auth.route.js";
import Projectrouter from './modules/projects/projects.routes.js';
import scriptRouter from './modules/scripts/script.route.js';
import { sceneListRouter, sceneRouter } from './modules/scenes/scene.route.js';
import { jobListRouter, jobRouter } from './modules/jobs/job.route.js';

const app = express();


app.use(express.json());



app.use("/auth",authRouter)
app.use("/projects",Projectrouter)
app.use("/projects/:project_id/script", scriptRouter)
app.use("/scripts/:script_id/scenes", sceneListRouter)
app.use("/scenes/:scene_id", sceneRouter)
app.use("/projects/:project_id/jobs", jobListRouter)
app.use("/jobs/:job_id", jobRouter)

export default app;