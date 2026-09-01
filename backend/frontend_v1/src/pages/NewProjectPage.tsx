import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { projectsService } from "@/services/projects.service";
import { scriptStylesService } from "@/services/scriptStyles.service";
import type { ScriptStyle } from "@/types";

const starters = [
  { label: "Una idea", icon: "💡", placeholder: "Quiero crear un video sobre..." },
  { label: "Un tema", icon: "📚", placeholder: "El tema es la historia del..." },
  { label: "Un prompt", icon: "⚡", placeholder: "Genera un video documental de 3 minutos sobre..." },
  { label: "Un guion", icon: "📄", placeholder: "APERTURA\n\nEn un mundo donde..." },
  { label: "Transcripción", icon: "🎙️", placeholder: "Transcripción del audio o entrevista..." },
];

export default function NewProjectPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [activeStarter, setActiveStarter] = useState(0);
  const [creating, setCreating] = useState(false);
  const [styles, setStyles] = useState<ScriptStyle[]>([]);
  const [scriptStyleId, setScriptStyleId] = useState("");

  useEffect(() => {
    scriptStylesService.list().then(setStyles);
  }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    const project = await projectsService.createProject(
      title.trim(),
      content.trim() || undefined,
      scriptStyleId || undefined
    );
    navigate(`/projects/${project.id}`);
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight mb-2" style={{ color: "var(--foreground)" }}>
            Nuevo proyecto
          </h1>
          <p style={{ color: "var(--muted-foreground)" }}>
            Contale a la IA de qué se trata tu video y empezamos juntos.
          </p>
        </div>

        {/* Starter pills */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          {starters.map((s, i) => (
            <button
              key={i}
              onClick={() => { setActiveStarter(i); setContent(""); }}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-150"
              style={
                activeStarter === i
                  ? {
                      background: "rgba(124,106,255,0.15)",
                      border: "1px solid rgba(124,106,255,0.35)",
                      color: "#c4b5fd",
                      backdropFilter: "blur(8px)",
                    }
                  : {
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.09)",
                      color: "var(--muted-foreground)",
                      backdropFilter: "blur(8px)",
                    }
              }
            >
              <span>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Glass form */}
        <div
          className="rounded-2xl p-6 space-y-5"
          style={{
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.04) inset",
          }}
        >
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-widest mb-1.5" style={{ color: "var(--muted-foreground)" }}>
              Título del proyecto
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Historia de River Plate"
              className="input-glass w-full rounded-xl px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium uppercase tracking-widest mb-1.5" style={{ color: "var(--muted-foreground)" }}>
              {starters[activeStarter].label}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={starters[activeStarter].placeholder}
              rows={6}
              className="input-glass w-full rounded-xl px-4 py-3 text-sm resize-none"
            />
          </div>

          {styles.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-widest mb-1.5" style={{ color: "var(--muted-foreground)" }}>
                Estilo de guion (opcional)
              </label>
              <select
                value={scriptStyleId}
                onChange={(e) => setScriptStyleId(e.target.value)}
                className="input-glass w-full rounded-xl px-4 py-3 text-sm"
              >
                <option value="">Sin estilo</option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.status !== "READY" ? `(${s.status})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={!title.trim() || creating}
            className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-xl"
          >
            {creating ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creando proyecto...
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Crear proyecto
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
