import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { projectsService } from "@/services/projects.service";
import StatusBadge from "@/components/StatusBadge";
import { formatRelativeTime } from "@/lib/mocks";
import type { VideoProject } from "@/types";

function EmptyState() {
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
      <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Sin proyectos todavía</p>
      <p className="text-sm mb-6 max-w-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
        Creá tu primer proyecto de video con IA. Solo necesitás una idea para empezar.
      </p>
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
  );
}

function ProjectCard({ project }: { project: VideoProject }) {
  return (
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
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <p className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    projectsService.getProjects().then((data) => {
      setProjects(data);
      setLoading(false);
    });
  }, []);

  const stats = {
    total: projects.length,
    inProgress: projects.filter((p) => p.status === "IN_PROGRESS" || p.status === "GENERATING").length,
    done: projects.filter((p) => p.status === "DONE").length,
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
            Dashboard
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Tus proyectos de video con IA
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

      {/* Stats */}
      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Total proyectos" value={stats.total} />
          <StatCard label="En progreso" value={stats.inProgress} />
          <StatCard label="Completados" value={stats.done} />
        </div>
      )}

      {/* Projects */}
      <div>
        <p
          className="text-xs font-medium uppercase tracking-widest mb-4 px-1"
          style={{ color: "var(--muted-foreground)" }}
        >
          Proyectos recientes
        </p>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl p-5 animate-pulse"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  height: 220,
                }}
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
