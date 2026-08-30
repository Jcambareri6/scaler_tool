import { Router } from "express";
import { createProject, deleteProject, getProjects, getProjectById,updateProject,getProjectDetail
    
 } from "./project.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const Projectrouter = Router();

Projectrouter.post("/", authMiddleware,createProject);
Projectrouter.get("/", authMiddleware, getProjects);
Projectrouter.get("/:project_id", authMiddleware, getProjectById);

Projectrouter.patch("/:project_id", authMiddleware, updateProject);

Projectrouter.delete("/:project_id", authMiddleware, deleteProject);
Projectrouter.get("/:project_id/details", authMiddleware, getProjectDetail);
export default Projectrouter;