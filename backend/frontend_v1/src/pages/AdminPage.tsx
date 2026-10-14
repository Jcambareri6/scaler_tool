import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAccount } from "@/lib/accountContext";
import { useToast } from "@/lib/toastContext";
import ConfirmModal from "@/components/ConfirmModal";
import { formatRelativeTime } from "@/lib/format";
import { adminService, type AdminUser, type CreditMovement } from "@/services/account.service";

// Panel de administracion: aprobar o rechazar cuentas nuevas y cargar videos
// a los alumnos despues de que pagan. Solo admins (ADMIN_USER_IDS en el
// backend); el backend igual rechaza a cualquier otro.

const cardStyle = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};

// Paquete que se vende (20 videos por 25 USD): boton rapido al cargar.
const PACKAGE_VIDEOS = 20;

type Tab = "pending" | "approved" | "rejected";

const TAB_LABELS: Record<Tab, string> = {
  pending: "Pendientes",
  approved: "Aprobados",
  rejected: "Rechazados",
};

const REASON_LABELS: Record<CreditMovement["reason"], string> = {
  welcome: "Bienvenida",
  admin_load: "Carga",
  admin_remove: "Corrección",
  render: "Render",
  render_refund: "Devolución (render fallido)",
};

export default function AdminPage() {
  const { account, refresh: refreshAccount } = useAccount();
  const { showToast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminUser | null>(null);
  const [loadingFor, setLoadingFor] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await adminService.listUsers());
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo cargar la lista de usuarios");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (account && !account.isAdmin) return <Navigate to="/" replace />;

  const replaceUser = (updated: AdminUser) => {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    setLoadingFor((current) => (current?.id === updated.id ? updated : current));
    if (updated.id === account?.id) void refreshAccount();
  };

  const runAction = async (user: AdminUser, action: () => Promise<AdminUser>, successMessage: string) => {
    setBusyId(user.id);
    try {
      replaceUser(await action());
      showToast("success", successMessage);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo completar la acción");
    } finally {
      setBusyId(null);
    }
  };

  const counts: Record<Tab, number> = {
    pending: users.filter((u) => u.status === "pending").length,
    approved: users.filter((u) => u.status === "approved").length,
    rejected: users.filter((u) => u.status === "rejected").length,
  };
  const visible = users.filter((u) => u.status === tab);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
          Administración
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Aprobá las cuentas nuevas y cargá videos a los alumnos.
        </p>
      </div>

      <div className="flex gap-1.5 rounded-xl p-1 mb-5 w-fit" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="text-xs font-medium px-4 py-1.5 rounded-lg transition-all duration-150"
            style={
              tab === t
                ? { background: "rgba(227,11,16,0.15)", border: "1px solid rgba(227,11,16,0.3)", color: "var(--foreground)" }
                : { background: "transparent", border: "1px solid transparent", color: "var(--muted-foreground)" }
            }
          >
            {TAB_LABELS[t]} ({counts[t]})
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={cardStyle}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(227,11,16,0.2)", borderTopColor: "#FF8A8D" }} />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            {tab === "pending" ? "No hay cuentas esperando aprobación." : "No hay cuentas en esta lista."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
                  <th className="px-5 py-3 font-medium">Usuario</th>
                  {tab === "approved" && <th className="px-3 py-3 font-medium text-right">Disponibles</th>}
                  {tab === "approved" && <th className="px-3 py-3 font-medium text-right">Usados</th>}
                  <th className="px-3 py-3 font-medium">{tab === "approved" ? "Último render" : "Registro"}</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <td className="px-5 py-3">
                      <span style={{ color: "var(--foreground)" }}>{u.email || u.id}</span>
                      {u.isAdmin && <Badge>Admin</Badge>}
                      {u.unlimited && <Badge>Sin límite</Badge>}
                    </td>
                    {tab === "approved" && (
                      <td
                        className="px-3 py-3 text-right font-medium"
                        style={{ color: !u.unlimited && u.videosAvailable === 0 ? "rgba(252,165,165,0.95)" : "var(--foreground)" }}
                      >
                        {u.unlimited ? "—" : u.videosAvailable}
                      </td>
                    )}
                    {tab === "approved" && (
                      <td className="px-3 py-3 text-right" style={{ color: "var(--muted-foreground)" }}>
                        {u.videosUsed}
                      </td>
                    )}
                    <td className="px-3 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
                      {tab === "approved"
                        ? u.lastRenderAt
                          ? formatRelativeTime(u.lastRenderAt)
                          : "Nunca"
                        : formatRelativeTime(u.createdAt)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        {u.status !== "approved" && (
                          <button
                            onClick={() => runAction(u, () => adminService.approve(u.id), `${u.email} aprobado`)}
                            disabled={busyId === u.id}
                            className="btn-primary text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                          >
                            Aprobar
                          </button>
                        )}
                        {u.status === "approved" && (
                          <button
                            onClick={() => setLoadingFor(u)}
                            disabled={busyId === u.id}
                            className="btn-primary text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                          >
                            Videos
                          </button>
                        )}
                        {u.status !== "rejected" && !u.isAdmin && (
                          <button
                            onClick={() => setRejecting(u)}
                            disabled={busyId === u.id}
                            className="btn-secondary text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                          >
                            Rechazar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejecting && (
        <ConfirmModal
          title="Rechazar cuenta"
          message={`${rejecting.email} no va a poder usar Scaler Tool. Podés aprobarla más adelante desde "Rechazados".`}
          confirmLabel="Rechazar"
          danger
          loading={busyId === rejecting.id}
          onCancel={() => setRejecting(null)}
          onConfirm={async () => {
            await runAction(rejecting, () => adminService.reject(rejecting.id), `${rejecting.email} rechazado`);
            setRejecting(null);
          }}
        />
      )}

      {loadingFor && (
        <CreditsModal
          user={loadingFor}
          onClose={() => setLoadingFor(null)}
          onUpdated={replaceUser}
        />
      )}
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span
      className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-md align-middle"
      style={{ background: "rgba(227,11,16,0.12)", border: "1px solid rgba(227,11,16,0.25)", color: "#FF8A8D" }}
    >
      {children}
    </span>
  );
}

// Cargar o sacar videos a un usuario, con su historial.
function CreditsModal({
  user,
  onClose,
  onUpdated,
}: {
  user: AdminUser;
  onClose: () => void;
  onUpdated: (user: AdminUser) => void;
}) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState(String(PACKAGE_VIDEOS));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movements, setMovements] = useState<CreditMovement[] | null>(null);

  const loadMovements = useCallback(() => {
    adminService
      .listMovements(user.id)
      .then(setMovements)
      .catch(() => setMovements([]));
  }, [user.id]);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  const handleSave = async () => {
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) {
      setError("Poné un número entero distinto de 0 (negativo para sacar videos)");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await adminService.adjustCredits(user.id, value, note);
      onUpdated(updated);
      showToast("success", value > 0 ? `+${value} videos a ${user.email}` : `${value} videos a ${user.email}`);
      setNote("");
      loadMovements();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleUnlimited = async () => {
    setSaving(true);
    setError(null);
    try {
      onUpdated(await adminService.setUnlimited(user.id, !user.unlimited));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={() => !saving && onClose()}
    >
      <div className="glass-md w-full max-w-md rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            Videos de {user.email}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
            {user.unlimited
              ? "Cuenta sin límite: renderiza sin descontar videos."
              : `Tiene ${user.videosAvailable} ${user.videosAvailable === 1 ? "video disponible" : "videos disponibles"} (usó ${user.videosUsed}).`}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="w-28">
              <label className="block text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
                Cantidad
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-glass w-full rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
                Nota
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="Ej: pagó 25 USD por transferencia"
                className="input-glass w-full rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            Paquete: {PACKAGE_VIDEOS} videos. Un número negativo saca videos (para corregir una carga).
          </p>
          {error && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.09)", color: "rgba(252,165,165,0.95)", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving} className="btn-secondary flex-1 py-2.5 text-sm font-medium rounded-xl">
              Cerrar
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 py-2.5 text-sm font-medium rounded-xl disabled:opacity-50">
              {saving ? "Guardando..." : Number(amount) < 0 ? "Sacar videos" : "Cargar videos"}
            </button>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg cursor-pointer" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <span className="text-xs" style={{ color: "var(--foreground)" }}>
            Sin límite (cuenta del equipo, no descuenta videos)
          </span>
          <input type="checkbox" checked={user.unlimited} onChange={handleToggleUnlimited} disabled={saving} className="w-4 h-4 accent-[#E30B10]" />
        </label>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
            Historial
          </p>
          {movements === null ? (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Cargando...</p>
          ) : movements.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Sin movimientos todavía.</p>
          ) : (
            <ul className="space-y-1.5">
              {movements.map((m) => (
                <li key={m.id} className="flex items-baseline gap-3 text-xs">
                  <span className="w-10 text-right font-medium shrink-0" style={{ color: m.amount > 0 ? "#86efac" : "rgba(252,165,165,0.95)" }}>
                    {m.amount > 0 ? `+${m.amount}` : m.amount}
                  </span>
                  <span className="flex-1 min-w-0 truncate" style={{ color: "var(--foreground)" }}>
                    {REASON_LABELS[m.reason]}
                    {m.projectTitle ? ` · ${m.projectTitle}` : ""}
                    {m.note ? ` · ${m.note}` : ""}
                  </span>
                  <span className="shrink-0" style={{ color: "var(--muted-foreground)" }}>
                    {formatRelativeTime(m.createdAt)}
                    {m.createdByEmail ? ` · ${m.createdByEmail.split("@")[0]}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
