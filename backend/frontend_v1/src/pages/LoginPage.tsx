import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { authService } from "@/services/auth.service";

type Mode = "login" | "register";

// Wordmark chico y discreto -- mismo isotipo que el Sidebar (cuadrado con
// gradiente de marca + play icon), reusado aca para consistencia visual
// entre login y app logueada.
function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 justify-center mb-6">
      <div
        className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
        style={{ background: "linear-gradient(135deg, #7c6aff 0%, #5b4de8 100%)", boxShadow: "0 0 14px rgba(124,106,255,0.4)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
      <span className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
        Scaler<span style={{ color: "var(--primary)" }}>Tool</span>
      </span>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

// Panel visual (mitad derecha, oculto en mobile): gradiente de marca +
// formas geometricas abstractas en SVG -- mismo criterio que los blobs
// decorativos de Layout.tsx, sin usar fotos de stock.
function AuthVisualPanel() {
  return (
    <div
      className="w-full h-full relative overflow-hidden flex items-end p-12"
      style={{ background: "linear-gradient(160deg, #0b0a1f 0%, #1a1440 55%, #3a2e8f 100%)" }}
    >
      {/* Formas abstractas */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 900" fill="none" aria-hidden>
        <circle cx="650" cy="120" r="220" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <circle cx="650" cy="120" r="140" stroke="rgba(124,106,255,0.25)" strokeWidth="1" />
        <circle cx="120" cy="760" r="180" fill="url(#glow)" />
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(124,106,255,0.35)" />
            <stop offset="100%" stopColor="rgba(124,106,255,0)" />
          </radialGradient>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="800" height="900" fill="url(#grid)" />
        <line x1="0" y1="420" x2="800" y2="360" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        <line x1="0" y1="470" x2="800" y2="410" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      </svg>

      <div className="relative max-w-md">
        <p className="text-2xl font-medium leading-snug tracking-tight text-white">
          Escalá tu producción de video sin fricción.
        </p>
        <p className="text-sm mt-3 leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
          De la idea al guion, la voz y el render final — Scaler Tool arma tu video con IA en cada paso.
        </p>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3">
      <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.08)" }} />
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>o continuá con</span>
      <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.08)" }} />
    </div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [forgotNotice, setForgotNotice] = useState(false);

  const emailId = useId();
  const passwordId = useId();

  const handleGoogleLogin = async () => {
    setError(null);
    setOauthLoading(true);
    try {
      await authService.signInWithOAuth("google");
      // no seteamos oauthLoading(false) aca: la pagina redirige afuera
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar con Google");
      setOauthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      if (mode === "login") {
        await login(email.trim(), password);
        navigate("/");
      } else {
        const { requiresLogin } = await register(email.trim(), password);
        if (requiresLogin) {
          setInfo("Cuenta creada. Revisa tu email para confirmar antes de iniciar sesion.");
          setMode("login");
        } else {
          navigate("/");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salio mal");
    } finally {
      setSubmitting(false);
    }
  };

  // No hay flujo de recuperacion de contrasena implementado todavia (login/
  // register pegan contra nuestro propio backend, no directo a Supabase) --
  // en vez de un link roto, muestra un aviso in-place. Cuando exista el
  // endpoint real, esto pasa a llamar authService.resetPassword(email).
  const handleForgotPassword = () => setForgotNotice(true);

  return (
    <div className="min-h-screen flex" style={{ background: "var(--background)" }}>
      {/* Lado formulario */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative">
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            width: 700,
            height: 700,
            top: "-18%",
            left: "-10%",
            background: "radial-gradient(circle, rgba(99,77,220,0.10) 0%, transparent 70%)",
            filter: "blur(1px)",
          }}
          aria-hidden
        />

        <div className="w-full max-w-[400px] relative" style={{ animation: "fadeInUp 0.5s ease-out" }}>
          <BrandMark />

          <div className="mb-7 text-center">
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
              {mode === "login" ? "Bienvenido de nuevo" : "Creá tu cuenta"}
            </h1>
            <p className="text-sm mt-1.5" style={{ color: "var(--muted-foreground)" }}>
              {mode === "login" ? "Inicia sesion en Scaler Tool para continuar" : "Empezá a generar videos con IA en minutos"}
            </p>
          </div>

          <div
            className="rounded-2xl p-6 space-y-5"
            style={{
              background: "rgba(255,255,255,0.04)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.04) inset",
            }}
          >
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={oauthLoading || submitting}
              className="btn-secondary w-full flex items-center justify-center gap-2.5 py-3 text-sm font-medium rounded-xl disabled:opacity-50"
            >
              {oauthLoading ? (
                <span className="inline-block w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.2)", borderTopColor: "rgba(255,255,255,0.7)" }} />
              ) : (
                <GoogleIcon />
              )}
              Continuar con Google
            </button>

            <Divider />

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor={emailId}
                  className="block text-[11px] font-medium uppercase tracking-widest mb-1.5"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Email
                </label>
                <input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  autoComplete="email"
                  required
                  className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor={passwordId}
                    className="block text-[11px] font-medium uppercase tracking-widest"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    Contrasena
                  </label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-[11px] font-medium transition-opacity hover:opacity-80"
                      style={{ color: "var(--primary)" }}
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  )}
                </div>
                <input
                  id={passwordId}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={mode === "register" ? 6 : undefined}
                  className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                />
                {error && (
                  <p className="text-xs mt-2" style={{ color: "rgba(252,165,165,0.95)" }}>
                    {error}
                  </p>
                )}
              </div>

              {mode === "login" && (
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "var(--muted-foreground)" }}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="w-3.5 h-3.5 rounded"
                    style={{ accentColor: "var(--primary)" }}
                  />
                  Recordarme
                </label>
              )}

              {forgotNotice && (
                <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(124,106,255,0.08)", color: "rgba(196,189,255,0.95)", border: "1px solid rgba(124,106,255,0.18)" }}>
                  Todavía no está disponible la recuperación automática — escribinos a soporte para restablecer tu contraseña.
                </p>
              )}

              {info && (
                <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(16,185,129,0.08)", color: "rgba(52,211,153,0.95)", border: "1px solid rgba(52,211,153,0.18)" }}>
                  {info}
                </p>
              )}

              <button
                type="submit"
                disabled={!email.trim() || !password.trim() || submitting}
                className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-xl"
              >
                {submitting ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {mode === "login" ? "Ingresando..." : "Creando cuenta..."}
                  </>
                ) : mode === "login" ? (
                  "Ingresar"
                ) : (
                  "Crear cuenta"
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-sm mt-5" style={{ color: "var(--muted-foreground)" }}>
            {mode === "login" ? "No tenes cuenta?" : "Ya tenes cuenta?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
                setInfo(null);
                setForgotNotice(false);
              }}
              className="font-medium transition-opacity hover:opacity-80"
              style={{ color: "var(--primary)" }}
            >
              {mode === "login" ? "Crear una" : "Iniciar sesion"}
            </button>
          </p>
        </div>
      </div>

      {/* Lado visual -- oculto en mobile */}
      <div className="hidden lg:block flex-1">
        <AuthVisualPanel />
      </div>
    </div>
  );
}
