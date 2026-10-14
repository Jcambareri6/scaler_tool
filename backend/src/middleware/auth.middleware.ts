import type { Request, Response, NextFunction } from "express";
import type { User } from "@supabase/supabase-js";
import { createAuthClient } from "../lib/supabase.js";
import { getAccountStatus, isAdmin } from "../lib/accounts.js";

// getUser(token) solo valida el token, no guarda sesion: alcanza con uno.
const authClient = createAuthClient();

// Bypass de auth SOLO para desarrollo local -- mismo criterio que
// MOCK_PROVIDERS (lib/mock.ts): requiere un env var EXPLICITO, nunca se
// activa por accidente. Con DISABLE_AUTH=true no hace falta loguearse ni
// mandar Authorization -- toda request queda scopeada al usuario de
// DEV_USER_ID (tiene que ser el UUID real de un usuario existente en
// Supabase Auth, sino las queries por user_id no van a devolver nada).
function isAuthDisabled(): boolean {
    return process.env.DISABLE_AUTH === "true";
}

// Solo valida el token y setea req.user, sin mirar si la cuenta esta
// aprobada. Lo usa GET /auth/me, que es justamente donde el frontend se
// entera de que la cuenta esta pendiente.
export async function authenticateOnly(req: Request, res: Response, next: NextFunction) {
    if (isAuthDisabled()) {
        const devUserId = process.env.DEV_USER_ID;
        if (!devUserId) {
            return res.status(500).json({
                error: "DISABLE_AUTH=true pero falta DEV_USER_ID en .env (UUID de un usuario real de Supabase Auth)",
            });
        }
        req.user = {
            id: devUserId,
            email: "dev@local",
            app_metadata: {},
            user_metadata: {},
            aud: "authenticated",
            created_at: new Date().toISOString(),
        } as User;
        return next();
    }

    const authHeader = req.headers.authorization;
    if(!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });

    }
    const token = authHeader.replace("Bearer ", "");
    // Cliente de sesion aparte (ver lib/supabase.ts): el del backend nunca
    // toca auth, asi ninguna sesion de usuario se le queda pegada.
    const { data : {user},error } = await authClient.auth.getUser(token);
    if (error  || !user ){
        return res.status(401).json({ error: "invalid or expired token" });
    }
    req.user = user;
    next();
}

// Token valido + cuenta aprobada. Es el middleware de todas las rutas de la
// app (y de la extension, que usa la misma API): una cuenta recien
// registrada no puede hacer nada hasta que un admin la apruebe. Los admins
// pasan siempre; con DISABLE_AUTH (solo desarrollo local) no se chequea.
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    await authenticateOnly(req, res, async () => {
        if (isAuthDisabled() || isAdmin(req.user!.id)) return next();
        try {
            const status = await getAccountStatus(req.user!.id, req.user!.email ?? "");
            if (status === "pending") {
                return res.status(403).json({
                    error: "Tu cuenta está esperando aprobación. Avisale al administrador para que la habilite.",
                    code: "ACCOUNT_PENDING",
                });
            }
            if (status === "rejected") {
                return res.status(403).json({
                    error: "Tu cuenta no fue aprobada. Contactá al administrador.",
                    code: "ACCOUNT_REJECTED",
                });
            }
            next();
        } catch (error) {
            console.error("[auth] no se pudo verificar la aprobacion de la cuenta:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    });
}

// Rutas solo para administradores (ADMIN_USER_IDS, ver lib/accounts.ts):
// providers y panel de admin. Debe correr DESPUES de authMiddleware, que es
// quien setea req.user.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!isAdmin(req.user!.id)) {
        return res.status(403).json({ error: "Forbidden" });
    }
    next();
}
