import { Router } from "express";
import { authMiddleware, requireAdmin } from "../../middleware/auth.middleware.js";
import { adjustCredits, approveUser, listMovements, listUsers, rejectUser, setUnlimited } from "./admin.service.js";

// Mounted at /admin -- solo administradores (ADMIN_USER_IDS).
const adminRouter = Router();
adminRouter.use(authMiddleware, requireAdmin);

adminRouter.get("/users", listUsers);
adminRouter.post("/users/:user_id/approve", approveUser);
adminRouter.post("/users/:user_id/reject", rejectUser);
adminRouter.post("/users/:user_id/credits", adjustCredits);
adminRouter.post("/users/:user_id/unlimited", setUnlimited);
adminRouter.get("/users/:user_id/movements", listMovements);

export default adminRouter;
