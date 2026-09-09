import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import type { ReactNode } from "react";

const DISABLE_AUTH = import.meta.env.VITE_DISABLE_AUTH === "true";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!DISABLE_AUTH && !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
