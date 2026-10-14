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

// Limites por usuario para los endpoints que gastan credito de APIs sin
// pasar por /tools. skipFailedRequests: un pedido rechazado (ej: 409 porque
// el proyecto ya se esta procesando) no consume cupo.
function perUserLimiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: true,
    keyGenerator: (req: Request) => req.user!.id,
    message: { error: message },
  });
}

// POST /projects/:id/pipeline/run: cada preview paga Whisper + LLM (y la voz
// si cambio el guion) y ocupa un lugar en la cola del worker.
export const pipelineRateLimiter = perUserLimiter(
  60 * 60 * 1000,
  10,
  "Llegaste al máximo de 10 previews por hora, probá de nuevo en un rato"
);

// POST /scripts/:id/scenes/image-prompts (prompts para Flow, lo usa la extension).
export const imagePromptsRateLimiter = perUserLimiter(
  60 * 60 * 1000,
  30,
  "Llegaste al máximo de pedidos de prompts por hora, probá de nuevo en un rato"
);

// POST /scenes/:id/regenerate-visual (keywords por LLM + busqueda de stock).
export const regenerateVisualRateLimiter = perUserLimiter(
  60 * 60 * 1000,
  120,
  "Llegaste al máximo de cambios de visual por hora, probá de nuevo en un rato"
);
