import type { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    console.log("authMiddleware called");
    const authHeader = req.headers.authorization; 
    if(!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });

    }
    const token = authHeader.replace("Bearer ", "");
    const { data : {user},error } = await supabase.auth.getUser(token);
    console.log(user)
    if (error  || !user ){
        return res.status(401).json({ error: "invalid or expired token" });
    }
    req.user = user;
    next();
}
