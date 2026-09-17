import { Router } from "express";
import {
  createProvider,
  listProviders,
  getProvider,
  updateProvider,
  deleteProvider,
} from "./provider.service.js";
import { authMiddleware, requireAdmin } from "../../middleware/auth.middleware.js";

// Providers son configuracion global del sistema, no scoped por usuario.
// Gateado a ADMIN_USER_IDS (stopgap hasta el rol admin real, ver
// requireAdmin en auth.middleware.ts / Etapa 9 del roadmap). El frontend
// no llama a estas rutas hoy, asi que gatear tambien los GET no rompe nada.
const providerRouter = Router();

providerRouter.post("/", authMiddleware, requireAdmin, createProvider);
providerRouter.get("/", authMiddleware, requireAdmin, listProviders);
providerRouter.get("/:provider_id", authMiddleware, requireAdmin, getProvider);
providerRouter.patch("/:provider_id", authMiddleware, requireAdmin, updateProvider);
providerRouter.delete("/:provider_id", authMiddleware, requireAdmin, deleteProvider);

export default providerRouter;
