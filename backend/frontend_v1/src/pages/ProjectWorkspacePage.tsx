import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { projectsService } from "@/services/projects.service";
import StatusBadge from "@/components/StatusBadge";
import ScriptPanel from "@/features/script/ScriptPanel";
import ScenesPanel from "@/features/scenes/ScenesPanel";
import AudioPanel from "@/features/audio/AudioPanel";
import PreviewPanel from "@/features/preview/PreviewPanel";
import type { VideoProject } from "@/types";

type Tab = "script" | "scenes" | "audio" | "preview";

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "script",
    label: "Script",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: "audio",
    label: "Audio",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </svg>
    ),
  },
  {
    id: "scenes",
    label: "Scenes",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
        <polyline points="17 2 12 7 7 2" />
      </svg>
    ),
  },
  {
    id: "preview",
    label: "Preview",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    ),
  },
];

export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("script");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    projectsService.getProjectById(projectId).then((p) => {
      if (!p) navigate("/");
      setProject(p);
      setLoading(false);
    });
  }, [projectId, navigate]);

  if (loading || !project || !projectId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className="w-6 h-6 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(124,106,255,0.2)", borderTopColor: "var(--primary)" }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Glass header */}
      <header
        className="glass-header flex items-center gap-4 px-5 h-14 flex-shrink-0 sticky top-0 z-10"
      >
        <button
          onClick={() => navigate("/")}
          className="transition-colors"
          style={{ color: "var(--muted-foreground)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div style={{ width: 1, height: 20, background: "var(--border)" }} />

        <div className="flex-1 flex items-center gap-3 min-w-0">
          <h1 className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
            {project.title}
          </h1>
          <StatusBadge status={project.status} />
        </div>

        {/* Tab nav */}
        <nav
          className="flex items-center gap-0.5 rounded-xl p-1"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-150"
                style={{
                  color: active ? "var(--foreground)" : "var(--muted-foreground)",
                  background: active ? "rgba(255,255,255,0.08)" : "transparent",
                  border: active ? "1px solid rgba(255,255,255,0.1)" : "1px solid transparent",
                  backdropFilter: active ? "blur(8px)" : "none",
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div style={{ width: 1, height: 20, background: "var(--border)" }} />

        <button
          className="btn-secondary flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Compartir
        </button>
      </header>

      {/* Panel */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "script" && <ScriptPanel projectId={projectId} project={project} />}
        {activeTab === "audio" && <AudioPanel projectId={projectId} project={project} />}
        {activeTab === "scenes" && <ScenesPanel projectId={projectId} />}
        {activeTab === "preview" && <PreviewPanel projectId={projectId} />}
      </div>
    </div>
  );
}
