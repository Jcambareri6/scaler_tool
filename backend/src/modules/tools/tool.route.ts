import { Router } from "express";
import { listAvailableTools, executeTool } from "./tool.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const toolRouter = Router();

toolRouter.get("/", authMiddleware, listAvailableTools);
toolRouter.post("/:tool_name/execute", authMiddleware, executeTool);

export default toolRouter;
