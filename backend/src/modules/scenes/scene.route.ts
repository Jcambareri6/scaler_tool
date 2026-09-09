import { Router } from "express";
import multer from "multer";
import {
  createScene,
  listScenes,
  getScene,
  updateScene,
  deleteScene,
  reorderScenes,
  regenerateSceneVisual,
  uploadSceneVisual,
} from "./scene.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mismo criterio que files/file.route.ts (memoria, sin tocar disco), pero
// con un limite mas alto -- aca puede venir un clip de video corto, no solo
// un .txt/.docx.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
});

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
sceneRouter.post("/regenerate-visual", authMiddleware, regenerateSceneVisual);
sceneRouter.post("/upload-visual", authMiddleware, upload.single("file"), uploadSceneVisual);
