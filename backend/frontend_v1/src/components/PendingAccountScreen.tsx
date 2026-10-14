import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { useAccount } from "@/lib/accountContext";

// Lo que ve una cuenta recien registrada (o rechazada) en vez de la app:
// el backend le rechaza todos los pedidos hasta que un admin la apruebe
// desde el panel de Administracion.
export default function PendingAccountScreen() {
  const { account, refresh } = useAccount();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const rejected = account?.status === "rejected";

  const handleCheck = async () => {
    setChecking(true);
    await refresh();
    setChecking(false);
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex items-center justify-center h-screen p-6" style={{ background: "var(--background)" }}>
      <div className="glass-md w-full max-w-sm rounded-2xl p-8 text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: "rgba(227,11,16,0.1)", border: "1px solid rgba(227,11,16,0.2)" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,138,141,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {rejected ? (
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </>
            )}
          </svg>
        </div>
        <p className="text-base font-semibold mb-2" style={{ color: "var(--foreground)" }}>
          {rejected ? "Tu cuenta no fue aprobada" : "Tu cuenta está pendiente"}
        </p>
        <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--muted-foreground)" }}>
          {rejected
            ? "Si creés que es un error, contactá al administrador."
            : "El administrador tiene que aprobarla antes de que puedas usar Scaler Tool. Avisale para que la habilite."}
        </p>
        {account?.email && (
          <p className="text-xs mb-6" style={{ color: "var(--muted-foreground)" }}>
            {account.email}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {!rejected && (
            <button
              onClick={handleCheck}
              disabled={checking}
              className="btn-primary flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-xl disabled:opacity-50"
            >
              {checking ? "Revisando..." : "Ya me aprobaron, revisar"}
            </button>
          )}
          <button onClick={handleLogout} className="btn-secondary py-2.5 text-sm font-medium rounded-xl">
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
