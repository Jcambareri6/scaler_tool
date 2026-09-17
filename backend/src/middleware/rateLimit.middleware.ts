import rateLimit from "express-rate-limit";
import type { Request } from "express";

// /auth/register y /auth/login no tienen otra proteccion contra fuerza
// bruta / spam de cuentas -- por IP, ventana corta.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos, esperá unos minutos e intentá de nuevo" },
});

// POST /tools/:tool_name/execute dispara llamadas pagas a LLM/TTS/Whisper y
// jobs de ffmpeg -- corre despues de authMiddleware, asi que se limita por
// usuario en vez de por IP.
export const toolsRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user!.id,
  message: { error: "Demasiadas ejecuciones, esperá unos minutos e intentá de nuevo" },
});
