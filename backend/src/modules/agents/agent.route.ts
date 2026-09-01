import { Router } from "express";
import {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  runAgentEndpoint,
} from "./agent.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Configuraciones de Agent (name/description/model/configuration), no
// scoped por usuario — mismo criterio que Providers (Etapa 9): no hay rol
// admin todavia, cualquier usuario autenticado administra.
const agentRouter = Router();

agentRouter.post("/run", authMiddleware, runAgentEndpoint);
agentRouter.post("/", authMiddleware, createAgent);
agentRouter.get("/", authMiddleware, listAgents);
agentRouter.get("/:agent_id", authMiddleware, getAgent);
agentRouter.patch("/:agent_id", authMiddleware, updateAgent);
agentRouter.delete("/:agent_id", authMiddleware, deleteAgent);

export default agentRouter;
