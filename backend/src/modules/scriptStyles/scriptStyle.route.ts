import { Router } from "express";
import {
  createScriptStyle,
  listScriptStyles,
  getScriptStyle,
  updateScriptStyle,
  deleteScriptStyle,
  generateScriptStyle,
} from "./scriptStyle.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Mounted at /script-styles. Recurso propio del usuario (como /providers),
// no anidado bajo /projects/:id -- un script_style se reusa en muchos
// proyectos, no pertenece a uno solo.
const scriptStyleRouter = Router();

scriptStyleRouter.post("/", authMiddleware, createScriptStyle);
scriptStyleRouter.get("/", authMiddleware, listScriptStyles);
scriptStyleRouter.get("/:script_style_id", authMiddleware, getScriptStyle);
scriptStyleRouter.patch("/:script_style_id", authMiddleware, updateScriptStyle);
scriptStyleRouter.delete("/:script_style_id", authMiddleware, deleteScriptStyle);
scriptStyleRouter.post("/:script_style_id/generate", authMiddleware, generateScriptStyle);

export default scriptStyleRouter;
