import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { projectsService } from "@/services/projects.service";
import { scriptStylesService } from "@/services/scriptStyles.service";
import type { Script, VideoProject, ScriptStyle } from "@/types";

interface Props {
  projectId: string;
  project: VideoProject;
}

// La creacion de estilos (subir 3 guiones de referencia, analizarlos con
// el LLM) vive ahora en su propia seccion del nav ("Estilo de narración",
// ver src/pages/ScriptStylesPage.tsx) -- un ScriptStyle es un recurso
// global por usuario, reusable entre proyectos, no algo exclusivo de este
// panel. Aca solo queda elegir CUAL estilo (ya creado) usar para el guion
// de este proyecto puntual, que si es un concern de Script.

export default function ScriptPanel({ projectId, project }: Props) {
  const [script, setScript] = useState<Script | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [styles, setStyles] = useState<ScriptStyle[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState(project.scriptStyleId ?? "");
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [thumbnailDescription, setThumbnailDescription] = useState("");
  // Se guarda como numero (no el string tipeado) para no depender de
  // parsear el formato que haya usado el usuario ("30.000", "30,000",
  // "30 000" son todos formas validas de escribir treinta mil) -- el input
  // limpia todo lo que no sea digito en cada tecla y siempre muestra el
  // numero resultante ya formateado, asi el usuario ve de inmediato si se
  // equivoco (ver handleApproxCharsChange).
  const [approxChars, setApproxChars] = useState<number | undefined>(undefined);
  const [referenceScript, setReferenceScript] = useState("");
  const [keyPoints, setKeyPoints] = useState("");

  useEffect(() => {
    projectsService.getScript(projectId).then((s) => {
      setScript(s);
      setContent(s?.content ?? "");
      setLoading(false);
    });
    scriptStylesService.list().then(setStyles);
  }, [projectId]);

  const handleSave = async () => {
    setSaving(true);
    const s = await projectsService.saveScript(projectId, content);
    setScript(s);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSelectStyle = async (styleId: string) => {
    setSelectedStyleId(styleId);
    await projectsService.updateProject(projectId, { scriptStyleId: styleId });
  };

  const handleApproxCharsChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    setApproxChars(digits ? Number(digits) : undefined);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // Sin campo dedicado de "idea" todavia en la UI: se deriva de la
      // descripcion del proyecto (o el titulo si no hay descripcion).
      const idea = project.description?.trim() || project.title;
      const s = await projectsService.generateScript(projectId, idea, {
        provider,
        scriptStyleId: selectedStyleId || undefined,
        title: project.title,
        thumbnailDescription: thumbnailDescription.trim() || undefined,
        approxChars,
        referenceScript: referenceScript.trim() || undefined,
        keyPoints: keyPoints.trim() || undefined,
      });
      setScript(s);
      setContent(s.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el guion");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(124,106,255,0.2)", borderTopColor: "#a78bfa" }} />
      </div>
    );
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const selectedStyle = styles.find((s) => s.id === selectedStyleId) ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div>
          <h2 className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
            {script?.title ?? "Guion del proyecto"}
          </h2>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
              {wordCount} palabras
            </span>
            {script && (
              <span className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
                ·{" "}
                <span style={{ color: script.status === "FINAL" ? "#34d399" : "#fbbf24" }}>
                  {script.status === "FINAL" ? "Final" : "Borrador"}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-secondary flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50"
          >
            {generating ? (
              <>
                <span className="w-3 h-3 border rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.6)" }} />
                Generando...
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                {script ? "Regenerar" : "Generar"}
              </>
            )}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !content.trim()}
            className="btn-primary flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50"
          >
            {saving ? (
              <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Guardando...</>
            ) : saved ? (
              <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> Guardado</>
            ) : (
              <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg> Guardar</>
            )}
          </button>
        </div>
      </div>

      {/* Estilo de guion (Prompt Maestro por canal) */}
      <div className="px-6 py-4 space-y-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3">
          <label className="text-[11px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
            Estilo de guion
          </label>
          <select
            value={selectedStyleId}
            onChange={(e) => handleSelectStyle(e.target.value)}
            className="input-glass rounded-lg px-2 py-1 text-xs"
          >
            <option value="">Sin estilo</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.status !== "READY" ? `(${s.status})` : ""}
              </option>
            ))}
          </select>
          <label className="text-[11px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
            Modelo
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as "anthropic" | "openai")}
            className="input-glass rounded-lg px-2 py-1 text-xs"
          >
            <option value="anthropic">Claude</option>
            <option value="openai">GPT</option>
          </select>
          <Link
            to="/script-styles"
            className="text-[11px] transition-opacity hover:opacity-80"
            style={{ color: "var(--primary)" }}
          >
            + Crear estilo nuevo
          </Link>
        </div>

        {selectedStyle && selectedStyle.status === "READY" && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={thumbnailDescription}
              onChange={(e) => setThumbnailDescription(e.target.value)}
              placeholder="Miniatura o descripción"
              className="input-glass rounded-lg px-3 py-2 text-xs"
            />
            <input
              type="text"
              inputMode="numeric"
              value={approxChars !== undefined ? approxChars.toLocaleString("es-AR") : ""}
              onChange={(e) => handleApproxCharsChange(e.target.value)}
              placeholder="Cantidad aprox. de caracteres (ej: 30000)"
              className="input-glass rounded-lg px-3 py-2 text-xs"
            />
            <textarea
              value={referenceScript}
              onChange={(e) => setReferenceScript(e.target.value)}
              placeholder="Guion de referencia a adaptar (opcional)"
              rows={2}
              className="input-glass col-span-2 rounded-lg px-3 py-2 text-xs resize-none"
            />
            <textarea
              value={keyPoints}
              onChange={(e) => setKeyPoints(e.target.value)}
              placeholder="Puntos clave a mantener (opcional)"
              rows={2}
              className="input-glass col-span-2 rounded-lg px-3 py-2 text-xs resize-none"
            />
          </div>
        )}
        {selectedStyle && selectedStyle.status !== "READY" && (
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            Este estilo todavía no está listo (status: {selectedStyle.status}).
          </p>
        )}
      </div>

      {error && (
        <p className="text-xs px-6 py-2" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {script || content ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full px-8 py-6 bg-transparent text-sm leading-7 font-mono resize-none focus:outline-none"
            style={{ color: "var(--foreground)" }}
            placeholder="El guion aparecerá aquí. Podés editarlo libremente o pedirle al agente que lo genere."
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 px-8">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Sin guion todavía</p>
              <p className="text-xs max-w-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                Conversá con el agente en Chat para generar el guion, o escribilo vos mismo.
              </p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
            >
              {generating ? "Generando..." : "Generar guion con IA"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
