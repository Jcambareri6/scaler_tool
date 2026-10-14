import { Router } from "express";
import { z } from "zod";
import { AuthService } from "./auth.services.js";
import { authenticateOnly } from "../../middleware/auth.middleware.js";
import { ensureAccount, getVideoCredits, isAdmin } from "../../lib/accounts.js";
import { authRateLimiter } from "../../middleware/rateLimit.middleware.js";

const authRouter = Router();

const authService = new AuthService();

const OAUTH_PROVIDERS = ["google", "github"] as const;
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

const credentialsSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(8),
});

authRouter.post("/register", authRateLimiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Email o contraseña inválidos (mínimo 8 caracteres)" });
    }

    try {
        const data = await authService.register(parsed.data);

        return res.status(201).json(data);

    } catch (error) {
        console.error("register failed:", error);
        return res.status(500).json({ message: "No se pudo completar el registro. Intentá de nuevo." });
    }
});

const resendSchema = z.object({
    email: z.string().trim().email(),
});

authRouter.post("/resend-confirmation", authRateLimiter, async (req, res) => {
    const parsed = resendSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Email inválido" });
    }

    try {
        await authService.resendConfirmation(parsed.data.email);
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error("resend confirmation failed:", error);
        // Mensaje generico: no confirmar/negar si el email existe.
        return res.status(200).json({ ok: true });
    }
});

authRouter.post("/login", authRateLimiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Email o contraseña inválidos" });
    }

    try {
        const data = await authService.Login(parsed.data);

        return res.status(200).json(data);

    } catch (error) {
        console.error("login failed:", error);
        return res.status(401).json({ message: "Email o contraseña incorrectos" });
    }
});

// Devuelve la URL de autorizacion de Supabase para el provider pedido; el
// frontend hace window.location.href = url y Supabase se encarga del resto.
// Requiere que el provider este configurado en el dashboard de Supabase
// (Authentication -> Providers) y que redirect_to este en la allowlist de
// Authentication -> URL Configuration -> Redirect URLs.
authRouter.get("/oauth/:provider", async (req, res) => {
    try {
        const { provider } = req.params;

        if (!OAUTH_PROVIDERS.includes(provider as OAuthProvider)) {
            return res.status(400).json({
                error: `Unsupported provider. Allowed: ${OAUTH_PROVIDERS.join(", ")}`,
            });
        }

        const redirectTo =
            (req.query.redirect_to as string | undefined) ??
            `${process.env.FRONTEND_ORIGIN ?? "http://localhost:8443"}/auth/callback`;

        const data = await authService.getOAuthUrl(provider as OAuthProvider, redirectTo);

        return res.status(200).json(data);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "oauth failed";

        return res.status(500).json({ message });
    }
});

authRouter.post("/refresh", async (req, res) => {
    try {
        const { refresh_token } = req.body;

        if (typeof refresh_token !== "string" || refresh_token.trim() === "") {
            return res.status(400).json({ error: "refresh_token is required" });
        }

        const data = await authService.refresh(refresh_token);

        return res.status(200).json(data);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "refresh failed";

        return res.status(401).json({ message });
    }
});

// Datos de la cuenta para el frontend: estado de aprobacion (la pantalla de
// "cuenta pendiente" sale de aca), si es admin y el saldo de videos. Usa
// authenticateOnly: tiene que responder tambien a cuentas no aprobadas.
authRouter.get("/me", authenticateOnly, async (req, res) => {
    const user = req.user!;
    try {
        const admin = isAdmin(user.id);
        const [account, credits] = await Promise.all([
            ensureAccount(user.id, user.email ?? ""),
            getVideoCredits(user.id),
        ]);
        return res.status(200).json({
            id: user.id,
            email: user.email,
            // Un admin nunca queda bloqueado, aunque su fila diga otra cosa.
            status: admin ? "approved" : account.status,
            is_admin: admin,
            unlimited: account.unlimited,
            videos_available: credits.balance,
            videos_used: credits.used,
        });
    } catch (error) {
        console.error("[auth/me] no se pudo leer la cuenta:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

export default authRouter;