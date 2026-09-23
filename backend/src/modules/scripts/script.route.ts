import { Router } from "express";
import multer from "multer";
import { createScript, getScript, updateScript, uploadScriptAudio } from "./script.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mismo criterio que files/file.route.ts y scenes/scene.route.ts (memoria,
// sin tocar disco) -- una narracion completa en un formato sin comprimir
// (wav) puede pesar bastante mas que un mp3 corto.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
});

const scriptRouter = Router({ mergeParams: true });

scriptRouter.post("/", authMiddleware, createScript);
scriptRouter.get("/", authMiddleware, getScript);
scriptRouter.patch("/", authMiddleware, updateScript);
scriptRouter.post("/audio", authMiddleware, upload.single("file"), uploadScriptAudio);

export default scriptRouter;
