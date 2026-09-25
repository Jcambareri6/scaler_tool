import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import type { ReactNode } from "react";

const DISABLE_AUTH = import.meta.env.VITE_DISABLE_AUTH === "true";
const REDIRECT_KEY = "skaler_post_login_redirect";

// Guarda a donde volver despues del login (ej: un link de invitacion a un
// workspace). sessionStorage y no state del router porque el login con
// OAuth pasa por /auth/callback y pierde el state.
export function savePostLoginRedirect(path: string): void {
  try {
    sessionStorage.setItem(REDIRECT_KEY, path);
  } catch {
    // sin storage: se vuelve al inicio
  }
}

export function consumePostLoginRedirect(): string {
  try {
    const path = sessionStorage.getItem(REDIRECT_KEY);
    sessionStorage.removeItem(REDIRECT_KEY);
    if (path && path.startsWith("/") && !path.startsWith("//")) return path;
  } catch {
    // idem
  }
  return "/";
}

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!DISABLE_AUTH && !user) {
    if (location.pathname !== "/") savePostLoginRedirect(location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
