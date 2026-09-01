import { Router } from "express";
import {
  createProvider,
  listProviders,
  getProvider,
  updateProvider,
  deleteProvider,
} from "./provider.service.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

// Providers son configuracion global del sistema, no scoped por usuario
// (no hay rol admin todavia — cualquier usuario autenticado puede
// administrarlos, ver Etapa 9 del roadmap).
const providerRouter = Router();

providerRouter.post("/", authMiddleware, createProvider);
providerRouter.get("/", authMiddleware, listProviders);
providerRouter.get("/:provider_id", authMiddleware, getProvider);
providerRouter.patch("/:provider_id", authMiddleware, updateProvider);
providerRouter.delete("/:provider_id", authMiddleware, deleteProvider);

export default providerRouter;
