import { Router } from "express";
import multer from "multer";
import { extractText } from "./file.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mounted at /files. Endpoint utilitario y sin estado -- no pertenece a
// ningun recurso (project/script_style), solo convierte un archivo subido
// (.txt/.docx/.pdf) a texto plano para que el caller lo use donde quiera.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const fileRouter = Router();

fileRouter.post("/extract-text", authMiddleware, upload.single("file"), extractText);

export default fileRouter;
