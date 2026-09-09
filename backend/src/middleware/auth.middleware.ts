import type { Request, Response, NextFunction } from "express";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase.js";

// Bypass de auth SOLO para desarrollo local -- mismo criterio que
// MOCK_PROVIDERS (lib/mock.ts): requiere un env var EXPLICITO, nunca se
// activa por accidente. Con DISABLE_AUTH=true no hace falta loguearse ni
// mandar Authorization -- toda request queda scopeada al usuario de
// DEV_USER_ID (tiene que ser el UUID real de un usuario existente en
// Supabase Auth, sino las queries por user_id no van a devolver nada).
function isAuthDisabled(): boolean {
    return process.env.DISABLE_AUTH === "true";
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
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
    const { data : {user},error } = await supabase.auth.getUser(token);
    if (error  || !user ){
        return res.status(401).json({ error: "invalid or expired token" });
    }
    req.user = user;
    next();
}
