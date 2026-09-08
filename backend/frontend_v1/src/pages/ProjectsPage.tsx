import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { projectsService } from "@/services/projects.service";
import ProjectCard from "@/components/ProjectCard";
import { statusLabel } from "@/components/StatusBadge";
import { useProjectFilters } from "@/features/projects/useProjectFilters";
import type { ProjectStatus, VideoProject } from "@/types";

const STATUS_OPTIONS: ProjectStatus[] = ["DRAFT", "IN_PROGRESS", "GENERATING", "DONE", "ERROR"];

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: "rgba(124,106,255,0.1)", border: "1px solid rgba(124,106,255,0.2)" }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(167,155,255,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.845v6.31a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
        </svg>
      </div>
      {hasFilters ? (
        <>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Ningún proyecto coincide</p>
          <p className="text-sm mb-6 max-w-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Probá con otra búsqueda o cambiá el filtro de estado.
          </p>
          <button onClick={onClear} className="btn-secondary px-4 py-2 text-sm font-medium rounded-xl">
            Limpiar filtros
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Sin proyectos todavía</p>
          <p className="text-sm mb-6 max-w-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Creá tu primer proyecto de video con IA. Solo necesitás una idea para empezar.
          </p>
          <Link to="/projects/new" className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nuevo proyecto
          </Link>
        </>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const { filters, setFilters, filtered } = useProjectFilters(projects);

  useEffect(() => {
    projectsService.getProjects().then((data) => {
      setProjects(data);
      setLoading(false);
    });
  }, []);

  const hasActiveFilters = filters.search.trim() !== "" || filters.status !== "ALL";

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
            Proyectos
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Todos tus proyectos de video con IA
          </p>
        </div>
        <Link
          to="/projects/new"
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nuevo proyecto
        </Link>
      </div>

      {/* Buscador + filtro de estado */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }}>
            <SearchIcon />
          </span>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Buscar por nombre..."
            className="input-glass w-full rounded-xl pl-9 pr-3 py-2.5 text-sm"
          />
        </div>
        <select
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as ProjectStatus | "ALL" }))}
          className="input-glass rounded-xl px-3 py-2.5 text-sm"
        >
          <option value="ALL">Todos los estados</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl p-5 animate-pulse"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", height: 220 }}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters} onClear={() => setFilters({ search: "", status: "ALL" })} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
