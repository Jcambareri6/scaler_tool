import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { workspacesService } from "@/services/workspaces.service";
import { projectsService } from "@/services/projects.service";
import type { VideoProject, Workspace } from "@/types";

// "Compartir" de un proyecto = elegir en que workspace vive (como mover un
// archivo a una carpeta compartida en Drive). Solo lo ven los miembros de
// ese workspace; el resto de tus proyectos no se comparte.
interface Props {
  project: VideoProject;
  onClose: () => void;
  onMoved: (project: VideoProject) => void;
}

export default function ShareProjectModal({ project, onClose, onMoved }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workspacesService
      .list()
      .then((all) => setWorkspaces(all.filter((ws) => ws.myRole !== "viewer")))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron cargar los workspaces"));
  }, []);

  const handleMove = async (ws: Workspace) => {
    if (ws.id === project.workspaceId) return;
    setSavingId(ws.id);
    setError(null);
    try {
      const updated = await projectsService.updateProject(project.id, { workspaceId: ws.id });
      if (updated) onMoved({ ...updated, myRole: project.myRole });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo compartir el proyecto");
      setSavingId(null);
    }
  };

  const hasTeamWorkspace = (workspaces ?? []).some((ws) => !ws.isPersonal);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-4"
        style={{ background: "var(--card, #15151c)", border: "1px solid rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Compartir proyecto</p>
          <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            Elegí en qué workspace vive "{project.title}". Solo los miembros de ese workspace lo van a ver.
          </p>
        </div>

        {error && (
          <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.09)", color: "rgba(252,165,165,0.95)" }}>
            {error}
          </p>
        )}

        {!workspaces ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</p>
        ) : (
          <div className="space-y-1.5">
            {workspaces.map((ws) => {
              const current = ws.id === project.workspaceId;
              return (
                <button
                  key={ws.id}
                  onClick={() => handleMove(ws)}
                  disabled={current || savingId !== null}
                  className="w-full flex items-center justify-between gap-3 text-left rounded-xl px-3 py-2.5 disabled:cursor-default"
                  style={{
                    background: current ? "rgba(124,106,255,0.14)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${current ? "rgba(124,106,255,0.35)" : "rgba(255,255,255,0.07)"}`,
                    color: "var(--foreground)",
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{ws.name}</p>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      {ws.isPersonal ? "Solo vos (privado)" : `${ws.memberCount} miembro${ws.memberCount === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "var(--muted-foreground)" }}>
                    {current ? "Actual" : savingId === ws.id ? "Moviendo..." : "Mover acá"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          {hasTeamWorkspace
            ? "Para sumar gente a un workspace, invitala desde "
            : "Todavía no tenés un workspace de equipo. Creá uno (ej: \"Con mi editor\") e invitá a tu editor desde "}
          <Link to="/workspaces" className="underline" style={{ color: "rgba(196,188,255,0.95)" }}>Equipo</Link>.
        </p>

        <div className="flex justify-end">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm rounded-xl">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
