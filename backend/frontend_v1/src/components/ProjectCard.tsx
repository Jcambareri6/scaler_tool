import { useState } from "react";
import { Link } from "react-router-dom";
import StatusBadge from "@/components/StatusBadge";
import ConfirmModal from "@/components/ConfirmModal";
import { formatRelativeTime } from "@/lib/mocks";
import { projectsService } from "@/services/projects.service";
import { useToast } from "@/lib/toastContext";
import type { VideoProject } from "@/types";

// Compartida entre DashboardPage y ProjectsPage -- antes vivia duplicada
// dentro de DashboardPage.tsx.
export default function ProjectCard({
  project,
  onDeleted,
}: {
  project: VideoProject;
  // Opcional: si no se pasa, no se muestra el boton de borrar (ej. si algun
  // dia se reusa esta card en un contexto de solo lectura).
  onDeleted?: (id: string) => void;
}) {
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await projectsService.deleteProject(project.id);
      setConfirming(false);
      onDeleted?.(project.id);
      showToast("success", `"${project.title}" eliminado`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo eliminar el proyecto");
      setDeleting(false);
    }
  };

  return (
    <div className="relative group/card">
      <Link
        to={`/projects/${project.id}`}
        className="group block rounded-2xl transition-all duration-200"
        style={{
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
          padding: 20,
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.border = "1px solid rgba(124,106,255,0.25)";
          el.style.background = "rgba(124,106,255,0.06)";
          el.style.boxShadow = "0 4px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(124,106,255,0.1) inset";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.border = "1px solid rgba(255,255,255,0.08)";
          el.style.background = "rgba(255,255,255,0.04)";
          el.style.boxShadow = "0 4px 24px rgba(0,0,0,0.25)";
        }}
      >
        {/* Thumbnail */}
        <div
          className="w-full h-32 rounded-xl mb-4 flex items-center justify-center relative overflow-hidden"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 30% 40%, rgba(99,77,220,0.14) 0%, transparent 70%)" }}
          />
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="relative"
          >
            <path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.845v6.31a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
          </svg>
        </div>

        <div className="flex items-start justify-between gap-2 mb-2">
          <h3
            className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-white transition-colors"
            style={{ color: "var(--foreground)" }}
          >
            {project.title}
          </h3>
          <StatusBadge status={project.status} />
        </div>

        {project.description && (
          <p className="text-xs leading-relaxed line-clamp-2 mb-3" style={{ color: "var(--muted-foreground)" }}>
            {project.description}
          </p>
        )}

        <p className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
          {formatRelativeTime(project.updatedAt)}
        </p>
      </Link>

      {onDeleted && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirming(true);
          }}
          title="Eliminar proyecto"
          className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity"
          style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(252,165,165,0.9)" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}

      {confirming && (
        <ConfirmModal
          title="Eliminar proyecto"
          message={`¿Eliminar "${project.title}"? Esta acción no se puede deshacer.`}
          confirmLabel={deleting ? "Eliminando..." : "Eliminar"}
          danger
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
