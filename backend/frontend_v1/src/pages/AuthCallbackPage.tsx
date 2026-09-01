import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { api, setToken } from "@/lib/api";
import type { AuthUser } from "@/services/auth.service";

// Supabase redirige aca con el token en el fragment de la URL (flujo
// implicito): #access_token=...&refresh_token=...
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const errorDescription = params.get("error_description");

    if (errorDescription) {
      setError(errorDescription);
      return;
    }

    if (!accessToken) {
      setError("No se recibio un token de acceso");
      return;
    }

    setToken(accessToken);
    api
      .get<AuthUser>("/auth/me")
      .then((user) => {
        setSession(accessToken, user);
        navigate("/", { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "No se pudo completar el login");
      });
  }, [navigate, setSession]);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-8"
      style={{ background: "var(--background)" }}
    >
      {error ? (
        <p
          className="text-sm rounded-lg px-4 py-3 max-w-sm text-center"
          style={{
            background: "rgba(239,68,68,0.09)",
            color: "rgba(252,165,165,0.95)",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          {error}
        </p>
      ) : (
        <div
          className="w-6 h-6 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(124,106,255,0.2)", borderTopColor: "var(--primary)" }}
        />
      )}
    </div>
  );
}
