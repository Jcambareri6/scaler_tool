import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { isSessionExpired, SESSION_EXPIRED_EVENT } from "@/lib/api";
import { savePostLoginRedirect } from "./RequireAuth";

const CHECK_EVERY_MS = 60_000;

// Cartel de sesion vencida (ver SESSION_MAX_MS en lib/api.ts): aparece a las
// 3 h del login o cuando un pedido ya no se puede renovar. No cierra la
// sesion ni saca al usuario de donde esta -- el vuelve a entrar cuando
// quiera, y despues vuelve a esta misma pagina.
export default function SessionExpiredBanner() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [expired, setExpired] = useState(isSessionExpired);

  useEffect(() => {
    const show = () => setExpired(true);
    const timer = setInterval(() => {
      if (isSessionExpired()) setExpired(true);
    }, CHECK_EVERY_MS);
    window.addEventListener(SESSION_EXPIRED_EVENT, show);
    return () => {
      clearInterval(timer);
      window.removeEventListener(SESSION_EXPIRED_EVENT, show);
    };
  }, []);

  if (!expired) return null;

  const relogin = () => {
    savePostLoginRedirect(location.pathname + location.search);
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div
      role="alert"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl max-w-[calc(100vw-32px)]"
      style={{
        background: "rgba(30,10,10,0.95)",
        border: "1px solid rgba(227,11,16,0.4)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
      }}
    >
      <span className="text-xs" style={{ color: "var(--foreground)" }}>
        Tu sesión venció. Volvé a iniciar sesión para seguir guardando cambios.
      </span>
      <button
        onClick={relogin}
        className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg"
        style={{ background: "#E30B10", color: "#fff" }}
      >
        Iniciar sesión
      </button>
    </div>
  );
}
