import { Router } from "express";
import { createScript, getScript, updateScript } from "./script.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const scriptRouter = Router({ mergeParams: true });

scriptRouter.post("/", authMiddleware, createScript);
scriptRouter.get("/", authMiddleware, getScript);
scriptRouter.patch("/", authMiddleware, updateScript);

export default scriptRouter;
