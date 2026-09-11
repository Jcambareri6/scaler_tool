import { useEffect, useRef, useState, type ReactNode } from "react";
import { scriptStylesService } from "@/services/scriptStyles.service";
import { filesService } from "@/services/files.service";
import type { ScriptStyle } from "@/types";

// Movido tal cual desde src/features/script/ScriptPanel.tsx -- antes vivia
// "escondido" dentro de la pestaña Script de un proyecto, ahora es su
// propia seccion del nav ("Estilo de narración") porque un ScriptStyle es
// un recurso global por usuario, reusable entre proyectos, no algo que
// pertenezca a un proyecto puntual.

// Cada slot de guion de referencia acepta texto pegado y/o un archivo .txt
// adjuntado -- adjuntar un archivo reemplaza el contenido del textarea con
// el texto leido, pero el usuario puede seguir editandolo a mano despues.
function ReferenceScriptSlot({
  index,
  value,
  onChange,
}: {
  index: number;
  value: string;
  onChange: (text: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;
    setFileError(null);
    setExtracting(true);
    try {
      const text = await filesService.extractText(file);
      onChange(text);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "No se pudo leer el archivo");
    } finally {
      setExtracting(false);
      // Permite volver a elegir el mismo archivo (o reintentar) sin que el
      // input ignore el cambio por tener el mismo valor que antes.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          Guion de referencia {index + 1}
        </span>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.docx,.pdf"
            className="hidden"
            onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={extracting}
            className="text-[11px] transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ color: "var(--primary)" }}
          >
            {extracting ? "Leyendo archivo..." : "Adjuntar archivo (.txt, .docx, .pdf)"}
          </button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Pegá el texto del guion ${index + 1} o adjuntá un archivo (.txt, .docx, .pdf)`}
        rows={4}
        className="input-glass w-full rounded-lg px-3 py-2 text-xs font-mono resize-none"
      />
      {fileError && <p className="text-[11px]" style={{ color: "#f87171" }}>{fileError}</p>}
    </div>
  );
}

type CreateMode = "ai" | "manual";

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
      style={
        active
          ? { background: "var(--primary)", color: "var(--primary-foreground, #fff)" }
          : { background: "rgba(255,255,255,0.04)", color: "var(--muted-foreground)" }
      }
    >
      {children}
    </button>
  );
}

function CreateStyleModal({
  onCreated,
  onClose,
}: {
  onCreated: (style: ScriptStyle) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<CreateMode>("ai");
  const [name, setName] = useState("");
  const [scripts, setScripts] = useState(["", "", ""]);
  const [masterPrompt, setMasterPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;
    setFileError(null);
    setExtracting(true);
    try {
      const text = await filesService.extractText(file);
      setMasterPrompt(text);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "No se pudo leer el archivo");
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Completá el nombre del estilo");
      return;
    }

    if (mode === "manual") {
      if (!masterPrompt.trim()) {
        setError("Pegá o subí el prompt maestro");
        return;
      }
      setCreating(true);
      setError(null);
      try {
        const created = await scriptStylesService.createWithMasterPrompt(name.trim(), masterPrompt.trim());
        onCreated(created);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo crear el estilo");
      } finally {
        setCreating(false);
      }
      return;
    }

    const referenceScripts = scripts.map((s) => s.trim()).filter(Boolean);
    if (referenceScripts.length === 0) {
      setError("Completá al menos un guion de referencia");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await scriptStylesService.create(name.trim(), referenceScripts);
      const ready = await scriptStylesService.generate(created.id);
      onCreated(ready);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el estilo");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={() => !creating && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-md w-full max-w-lg rounded-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          Nuevo estilo de narración (Prompt Maestro)
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del canal/cliente"
          className="input-glass w-full rounded-lg px-3 py-2 text-sm"
        />

        <div className="flex gap-1.5">
          <ModeTab active={mode === "ai"} onClick={() => setMode("ai")}>
            Generar con IA desde guiones
          </ModeTab>
          <ModeTab active={mode === "manual"} onClick={() => setMode("manual")}>
            Cargar prompt maestro propio
          </ModeTab>
        </div>

        {mode === "ai" ? (
          scripts.map((s, i) => (
            <ReferenceScriptSlot
              key={i}
              index={i}
              value={s}
              onChange={(text) => {
                const next = [...scripts];
                next[i] = text;
                setScripts(next);
              }}
            />
          ))
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                Prompt maestro
              </span>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.docx,.pdf"
                  className="hidden"
                  onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extracting}
                  className="text-[11px] transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ color: "var(--primary)" }}
                >
                  {extracting ? "Leyendo archivo..." : "Adjuntar archivo (.txt, .docx, .pdf)"}
                </button>
              </div>
            </div>
            <textarea
              value={masterPrompt}
              onChange={(e) => setMasterPrompt(e.target.value)}
              placeholder="Pegá el prompt maestro ya escrito, o adjuntá un archivo (.txt, .docx, .pdf)"
              rows={10}
              className="input-glass w-full rounded-lg px-3 py-2 text-xs font-mono resize-none"
            />
            {fileError && <p className="text-[11px]" style={{ color: "#f87171" }}>{fileError}</p>}
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Este estilo queda listo al instante, sin pasar por el análisis de IA.
            </p>
          </div>
        )}

        {error && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="btn-primary flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50"
          >
            {creating ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {mode === "ai" ? "Analizando..." : "Creando..."}
              </>
            ) : mode === "ai" ? (
              "Analizar y crear"
            ) : (
              "Crear estilo"
            )}
          </button>
          <button
            onClick={onClose}
            disabled={creating}
            className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function statusColor(status: ScriptStyle["status"]): string {
  if (status === "READY") return "#34d399";
  if (status === "FAILED") return "#f87171";
  return "#fbbf24";
}

function statusText(status: ScriptStyle["status"]): string {
  if (status === "READY") return "Listo";
  if (status === "FAILED") return "Error";
  return "Analizando";
}

function StyleCard({ style, onDelete }: { style: ScriptStyle; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar el estilo "${style.name}"? Esto no afecta los proyectos que ya lo usaron.`)) return;
    setDeleting(true);
    try {
      await scriptStylesService.delete(style.id);
      onDelete(style.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{style.name}</h3>
        <span
          className="inline-flex items-center gap-1.5 rounded-full font-mono font-medium tracking-wide text-[10px] px-2 py-0.5"
          style={{ background: "rgba(255,255,255,0.05)", color: statusColor(style.status), border: `1px solid ${statusColor(style.status)}33` }}
        >
          {statusText(style.status)}
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>
        {style.referenceScripts.length > 0
          ? `${style.referenceScripts.length} guion(es) de referencia analizados`
          : "Prompt maestro cargado manualmente"}
      </p>
      {style.error && (
        <p className="text-xs mb-3" style={{ color: "#f87171" }}>{style.error}</p>
      )}
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
        style={{ color: "#f87171" }}
      >
        {deleting ? "Eliminando..." : "Eliminar"}
      </button>
    </div>
  );
}

export default function ScriptStylesPage() {
  const [styles, setStyles] = useState<ScriptStyle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    scriptStylesService.list().then((data) => {
      setStyles(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
            Estilo de narración
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Analizá guiones de un canal de referencia para replicar su forma de narrar
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nuevo estilo
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-2xl p-5 animate-pulse" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", height: 120 }} />
          ))}
        </div>
      ) : styles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: "rgba(124,106,255,0.1)", border: "1px solid rgba(124,106,255,0.2)" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(167,155,255,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          </div>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>Sin estilos todavía</p>
          <p className="text-sm mb-6 max-w-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Subí 3 guiones de un canal de referencia y la IA arma un "Prompt Maestro" para replicar su estilo en tus proyectos.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl">
            Crear el primero
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {styles.map((style) => (
            <StyleCard key={style.id} style={style} onDelete={(id) => setStyles((prev) => prev.filter((s) => s.id !== id))} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateStyleModal
          onCreated={(style) => {
            setStyles((prev) => [style, ...prev]);
            setShowCreate(false);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
