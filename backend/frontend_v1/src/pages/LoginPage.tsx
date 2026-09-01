import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { authService } from "@/services/auth.service";

type Mode = "login" | "register";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

  return (
    <div
      className="min-h-screen flex items-center justify-center p-8 relative overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <div
        className="pointer-events-none fixed rounded-full"
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

      <div className="w-full max-w-sm relative">
        <div className="mb-8 text-center">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: "linear-gradient(135deg, #7c6aff 0%, #5b4de8 100%)",
              boxShadow: "0 0 16px rgba(124,106,255,0.4)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
            Skaler Tool
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
            {mode === "login" ? "Inicia sesion para continuar" : "Creá tu cuenta"}
          </p>
        </div>

        <div
          className="rounded-2xl p-6 space-y-4"
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
              <svg width="15" height="15" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            Continuar con Google
          </button>

          <div className="flex items-center gap-3">
            <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.08)" }} />
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>o</span>
            <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.08)" }} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              className="block text-[11px] font-medium uppercase tracking-widest mb-1.5"
              style={{ color: "var(--muted-foreground)" }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              autoComplete="email"
              className="input-glass w-full rounded-xl px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label
              className="block text-[11px] font-medium uppercase tracking-widest mb-1.5"
              style={{ color: "var(--muted-foreground)" }}
            >
              Contrasena
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="input-glass w-full rounded-xl px-4 py-3 text-sm"
            />
          </div>

          {error && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.09)", color: "rgba(252,165,165,0.95)", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
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
            }}
            className="font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--primary)" }}
          >
            {mode === "login" ? "Crear una" : "Iniciar sesion"}
          </button>
        </p>
      </div>
    </div>
  );
}
