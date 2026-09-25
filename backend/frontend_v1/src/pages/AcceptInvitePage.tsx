import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { savePostLoginRedirect } from "@/components/RequireAuth";
import { workspacesService, ROLE_LABELS, ROLE_DESCRIPTIONS, type InvitePreview } from "@/services/workspaces.service";

// Destino del link de invitacion (/invites/:token). Si el usuario no esta
// logueado, RequireAuth guarda esta ruta y vuelve aca despues del login.
export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    workspacesService
      .previewInvite(token)
      .then(setInvite)
      .catch((err) => setError(err instanceof Error ? err.message : "Invitación inválida"));
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      await workspacesService.acceptInvite(token);
      navigate("/workspaces", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aceptar la invitación");
      setAccepting(false);
    }
  };

  return (
    <div className="p-8 max-w-md mx-auto mt-16">
      <div
        className="rounded-2xl p-6 space-y-4"
        style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {error ? (
          <>
            <p className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>No se pudo abrir la invitación</p>
            <p className="text-sm" style={{ color: "rgba(252,165,165,0.95)" }}>{error}</p>
            <button onClick={() => navigate("/")} className="btn-primary px-4 py-2 text-sm rounded-xl">Ir al inicio</button>
          </>
        ) : !invite ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando invitación...</p>
        ) : (
          <>
            <p className="text-[11px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
              Invitación
            </p>
            <p className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
              Te invitaron a <strong>{invite.workspaceName ?? "un workspace"}</strong>
            </p>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Rol: {ROLE_LABELS[invite.role]} — {ROLE_DESCRIPTIONS[invite.role]}
            </p>

            {invite.emailMatches ? (
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="btn-primary w-full px-4 py-2.5 text-sm font-medium rounded-xl disabled:opacity-50"
              >
                {accepting ? "Uniéndome..." : "Aceptar invitación"}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: "rgba(251,191,36,0.9)" }}>
                  Esta invitación es para <strong>{invite.email}</strong>, pero estás logueado como {user?.email}.
                </p>
                <button
                  onClick={() => {
                    savePostLoginRedirect(`/invites/${token}`);
                    logout();
                    navigate("/login");
                  }}
                  className="btn-primary w-full px-4 py-2.5 text-sm font-medium rounded-xl"
                >
                  Cambiar de cuenta
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
