import { Router } from "express";
import {
  createScene,
  listScenes,
  getScene,
  updateScene,
  deleteScene,
  reorderScenes,
} from "./scene.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mounted at /scripts/:script_id/scenes
export const sceneListRouter = Router({ mergeParams: true });
sceneListRouter.post("/", authMiddleware, createScene);
sceneListRouter.get("/", authMiddleware, listScenes);
sceneListRouter.patch("/reorder", authMiddleware, reorderScenes);

// Mounted at /scenes/:scene_id
export const sceneRouter = Router({ mergeParams: true });
sceneRouter.get("/", authMiddleware, getScene);
sceneRouter.patch("/", authMiddleware, updateScene);
sceneRouter.delete("/", authMiddleware, deleteScene);
