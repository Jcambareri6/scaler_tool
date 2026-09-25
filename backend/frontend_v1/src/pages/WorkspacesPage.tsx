import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { useToast } from "@/lib/toastContext";
import ConfirmModal from "@/components/ConfirmModal";
import { workspacesService, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/services/workspaces.service";
import type { Workspace, WorkspaceMember, WorkspaceInvite, WorkspaceRole, MyInvite } from "@/types";

// Gestion de equipo al estilo Drive/Figma: lista de workspaces a la
// izquierda, y del seleccionado: miembros con su rol, invitaciones
// pendientes (con link copiable) y formulario para invitar por email.

const cardStyle = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};

const labelClass = "text-[11px] font-medium uppercase tracking-widest";
const INVITABLE: WorkspaceRole[] = ["editor", "viewer", "admin"];

type PendingConfirm =
  | { kind: "remove"; member: WorkspaceMember }
  | { kind: "leave" }
  | { kind: "delete" };

export default function WorkspacesPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [myInvites, setMyInvites] = useState<MyInvite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [myRole, setMyRole] = useState<WorkspaceRole | null>(null);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = workspaces.find((ws) => ws.id === selectedId) ?? null;
  const canManage = myRole === "owner" || myRole === "admin";

  const loadWorkspaces = useCallback(async () => {
    const [list, pending] = await Promise.all([
      workspacesService.list(),
      workspacesService.myInvites().catch(() => []),
    ]);
    setWorkspaces(list);
    setMyInvites(pending);
    setSelectedId((prev) => (prev && list.some((ws) => ws.id === prev) ? prev : list[0]?.id ?? null));
    setLoading(false);
  }, []);

  const loadMembers = useCallback(async (id: string) => {
    try {
      const res = await workspacesService.members(id);
      setMembers(res.members);
      setInvites(res.invites);
      setMyRole(res.myRole);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudieron cargar los miembros");
    }
  }, [showToast]);

  useEffect(() => {
    loadWorkspaces().catch((err) => {
      showToast("error", err instanceof Error ? err.message : "No se pudieron cargar los workspaces");
      setLoading(false);
    });
  }, [loadWorkspaces, showToast]);

  useEffect(() => {
    if (selectedId) loadMembers(selectedId);
  }, [selectedId, loadMembers]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const ws = await workspacesService.create(newName.trim());
      setNewName("");
      await loadWorkspaces();
      setSelectedId(ws.id);
      showToast("success", `Workspace "${ws.name}" creado`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo crear el workspace");
    }
    setCreating(false);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("success", "Link copiado");
    } catch {
      showToast("info", text);
    }
  };

  const handleInvite = async () => {
    if (!selectedId || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      const invite = await workspacesService.invite(selectedId, inviteEmail.trim(), inviteRole);
      setInviteEmail("");
      await loadMembers(selectedId);
      await copy(invite.inviteUrl);
      showToast("success", `Invitación creada para ${invite.email} — mandale el link`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo invitar");
    }
    setInviting(false);
  };

  const handleRoleChange = async (member: WorkspaceMember, role: WorkspaceRole) => {
    if (!selectedId) return;
    try {
      await workspacesService.updateMemberRole(selectedId, member.userId, role);
      setMembers((prev) => prev.map((m) => (m.userId === member.userId ? { ...m, role } : m)));
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo cambiar el rol");
    }
  };

  const handleRevoke = async (invite: WorkspaceInvite) => {
    if (!selectedId) return;
    try {
      await workspacesService.revokeInvite(selectedId, invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo revocar");
    }
  };

  const handleAcceptMine = async (invite: MyInvite) => {
    try {
      const { workspaceId } = await workspacesService.acceptInvite(invite.token);
      await loadWorkspaces();
      setSelectedId(workspaceId);
      showToast("success", `Te uniste a "${invite.workspaceName}"`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo aceptar");
    }
  };

  const runConfirm = async () => {
    if (!confirm || !selectedId || !user) return;
    setBusy(true);
    try {
      if (confirm.kind === "remove") {
        await workspacesService.removeMember(selectedId, confirm.member.userId);
        setMembers((prev) => prev.filter((m) => m.userId !== confirm.member.userId));
      } else if (confirm.kind === "leave") {
        await workspacesService.removeMember(selectedId, user.id);
        setSelectedId(null);
        await loadWorkspaces();
      } else {
        await workspacesService.delete(selectedId);
        setSelectedId(null);
        await loadWorkspaces();
      }
      setConfirm(null);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo completar la acción");
    }
    setBusy(false);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
          Equipo
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Compartí proyectos con tu equipo: invitá miembros para ver previews, editar escenas y cambiar clips
        </p>
      </div>

      {myInvites.length > 0 && (
        <div className="rounded-2xl p-4 mb-6 space-y-2" style={{ ...cardStyle, border: "1px solid rgba(124,106,255,0.35)" }}>
          <p className={labelClass} style={{ color: "rgba(196,188,255,0.95)" }}>Invitaciones para vos</p>
          {myInvites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3">
              <p className="text-sm" style={{ color: "var(--foreground)" }}>
                <strong>{inv.workspaceName}</strong>
                <span style={{ color: "var(--muted-foreground)" }}> · como {ROLE_LABELS[inv.role]}</span>
              </p>
              <button onClick={() => handleAcceptMine(inv)} className="btn-primary px-3 py-1.5 text-xs font-medium rounded-lg">
                Aceptar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(220px, 280px) 1fr" }}>
        {/* Lista de workspaces */}
        <div className="space-y-3">
          <div className="rounded-2xl p-2 space-y-1" style={cardStyle}>
            {loading ? (
              <p className="text-sm p-3" style={{ color: "var(--muted-foreground)" }}>Cargando...</p>
            ) : (
              workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => setSelectedId(ws.id)}
                  className="w-full text-left rounded-xl px-3 py-2.5 transition-colors"
                  style={{
                    background: ws.id === selectedId ? "rgba(124,106,255,0.14)" : "transparent",
                    color: "var(--foreground)",
                  }}
                >
                  <p className="text-sm font-medium truncate">{ws.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    {ws.isPersonal ? "Personal" : `${ws.memberCount} miembro${ws.memberCount === 1 ? "" : "s"}`} · {ROLE_LABELS[ws.myRole]}
                  </p>
                </button>
              ))
            )}
          </div>

          <div className="rounded-2xl p-3 space-y-2" style={cardStyle}>
            <p className={labelClass} style={{ color: "var(--muted-foreground)" }}>Nuevo workspace</p>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Ej: Canal Documentales"
              className="input-glass w-full rounded-xl px-3 py-2 text-sm"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="btn-primary w-full px-3 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear workspace"}
            </button>
          </div>
        </div>

        {/* Detalle */}
        {selected && (
          <div className="space-y-4 min-w-0">
            <div className="rounded-2xl p-5 flex items-center justify-between gap-3" style={cardStyle}>
              <div className="min-w-0">
                <p className="text-lg font-semibold truncate" style={{ color: "var(--foreground)" }}>{selected.name}</p>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Tu rol: {ROLE_LABELS[selected.myRole]} — {ROLE_DESCRIPTIONS[selected.myRole]}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => navigate("/projects")}
                  className="px-3 py-1.5 text-xs rounded-lg"
                  style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}
                >
                  Ver proyectos
                </button>
                {!selected.isPersonal && selected.myRole !== "owner" && (
                  <button onClick={() => setConfirm({ kind: "leave" })} className="px-3 py-1.5 text-xs rounded-lg" style={{ color: "rgba(252,165,165,0.95)", border: "1px solid rgba(239,68,68,0.3)" }}>
                    Salir
                  </button>
                )}
                {!selected.isPersonal && selected.myRole === "owner" && (
                  <button onClick={() => setConfirm({ kind: "delete" })} className="px-3 py-1.5 text-xs rounded-lg" style={{ color: "rgba(252,165,165,0.95)", border: "1px solid rgba(239,68,68,0.3)" }}>
                    Eliminar
                  </button>
                )}
              </div>
            </div>

            {canManage && (
              <div className="rounded-2xl p-5 space-y-3" style={cardStyle}>
                <p className={labelClass} style={{ color: "var(--muted-foreground)" }}>Invitar por email</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                    placeholder="persona@email.com"
                    className="input-glass flex-1 min-w-[200px] rounded-xl px-3 py-2 text-sm"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                    className="input-glass rounded-xl px-3 py-2 text-sm"
                  >
                    {INVITABLE.filter((r) => r !== "admin" || myRole === "owner").map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail.trim()}
                    className="btn-primary px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
                  >
                    {inviting ? "Invitando..." : "Invitar"}
                  </button>
                </div>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  {ROLE_DESCRIPTIONS[inviteRole]}. Se genera un link (vence en 7 días) que solo puede aceptar esa cuenta.
                </p>
              </div>
            )}

            <div className="rounded-2xl p-5" style={cardStyle}>
              <p className={`${labelClass} mb-3`} style={{ color: "var(--muted-foreground)" }}>
                Miembros ({members.length})
              </p>
              <div className="space-y-1">
                {members.map((m) => {
                  const isMe = m.userId === user?.id;
                  const editable = canManage && m.role !== "owner" && !isMe && (myRole === "owner" || m.role !== "admin");
                  return (
                    <div key={m.userId} className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                          style={{ background: "rgba(124,106,255,0.2)", color: "rgba(196,188,255,0.95)" }}
                        >
                          {(m.email ?? "?")[0].toUpperCase()}
                        </div>
                        <p className="text-sm truncate" style={{ color: "var(--foreground)" }}>
                          {m.email ?? m.userId}
                          {isMe && <span style={{ color: "var(--muted-foreground)" }}> (vos)</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {editable ? (
                          <>
                            <select
                              value={m.role}
                              onChange={(e) => handleRoleChange(m, e.target.value as WorkspaceRole)}
                              className="input-glass rounded-lg px-2 py-1 text-xs"
                            >
                              {INVITABLE.filter((r) => r !== "admin" || myRole === "owner").map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => setConfirm({ kind: "remove", member: m })}
                              className="text-xs px-2 py-1 rounded-lg"
                              style={{ color: "rgba(252,165,165,0.95)" }}
                            >
                              Quitar
                            </button>
                          </>
                        ) : (
                          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{ROLE_LABELS[m.role]}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {canManage && invites.length > 0 && (
              <div className="rounded-2xl p-5" style={cardStyle}>
                <p className={`${labelClass} mb-3`} style={{ color: "var(--muted-foreground)" }}>
                  Invitaciones pendientes
                </p>
                <div className="space-y-1">
                  {invites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                      <p className="text-sm truncate" style={{ color: "var(--foreground)" }}>
                        {inv.email}
                        <span style={{ color: "var(--muted-foreground)" }}>
                          {" "}· {ROLE_LABELS[inv.role]} · vence {new Date(inv.expiresAt).toLocaleDateString()}
                        </span>
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => copy(inv.inviteUrl)} className="text-xs px-2 py-1 rounded-lg" style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}>
                          Copiar link
                        </button>
                        <button onClick={() => handleRevoke(inv)} className="text-xs px-2 py-1 rounded-lg" style={{ color: "rgba(252,165,165,0.95)" }}>
                          Revocar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.kind === "remove" ? "Quitar miembro" : confirm.kind === "leave" ? "Salir del workspace" : "Eliminar workspace"}
          message={
            confirm.kind === "remove"
              ? `¿Quitar a ${confirm.member.email ?? "este miembro"}? Pierde acceso a todos los proyectos del workspace.`
              : confirm.kind === "leave"
                ? `¿Salir de "${selected?.name}"? Vas a perder acceso a sus proyectos.`
                : `¿Eliminar "${selected?.name}"? Los proyectos no se borran: vuelven a quedar solo para su creador.`
          }
          confirmLabel={confirm.kind === "remove" ? "Quitar" : confirm.kind === "leave" ? "Salir" : "Eliminar"}
          danger
          loading={busy}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
