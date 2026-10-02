import { useEffect, useState } from "react";
import { projectsService, type VisualBible } from "@/services/projects.service";

interface Props {
  projectId: string;
  // Cambia cada vez que se cargan los prompts (la biblia se arma sola la
  // primera vez que se piden) -- dispara una relectura.
  refreshKey: number;
  // Tras editar o rehacer la biblia, los prompts quedan viejos: el padre los
  // vuelve a pedir (se rehacen solos los que no se editaron a mano).
  onBibleChanged: () => void;
}

const panelStyle = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" };

// Biblia visual del video: la ficha fija (personajes, lugares, epoca,
// paleta) que la IA arma leyendo el guion completo + el diseño del canal, y
// que siguen todos los prompts para que las imagenes sean una secuencia
// coherente. Si un personaje sale mal descrito, se corrige aca una vez y se
// arregla en todas las escenas.
export default function VisualBiblePanel({ projectId, refreshKey, onBibleChanged }: Props) {
  const [bible, setBible] = useState<VisualBible | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "regenerate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsService
      .getVisualBible(projectId)
      .then((b) => {
        setBible(b);
        setDraft(b.text ?? "");
      })
      .catch(() => setBible(null));
  }, [projectId, refreshKey]);

  if (!bible?.text) return null;

  const run = async (kind: "save" | "regenerate") => {
    setBusy(kind);
    setError(null);
    try {
      const next =
        kind === "save"
          ? await projectsService.updateVisualBible(projectId, { text: draft })
          : await projectsService.updateVisualBible(projectId, { regenerate: true });
      setBible(next);
      setDraft(next.text ?? "");
      onBibleChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la biblia visual");
    }
    setBusy(null);
  };

  return (
    <div className="rounded-xl p-3 space-y-2" style={panelStyle}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
          Biblia visual del video
          <span className="font-normal" style={{ color: "var(--muted-foreground)" }}>
            {" "}· personajes, lugares y estilo fijos para todas las escenas
            {bible.edited ? " · editada a mano" : ""}
          </span>
        </span>
        <span className="text-[11px]" style={{ color: "var(--accent)" }}>{open ? "Ocultar" : "Ver / editar"}</span>
      </button>
      {bible.stale && (
        <p className="text-[11px]" style={{ color: "#fbbf24" }}>
          El guion o el diseño del canal cambiaron desde que se armó: conviene rehacerla.
        </p>
      )}
      {open && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            className="input-glass w-full rounded-lg px-2.5 py-2 text-xs resize-y font-mono"
          />
          {error && <p className="text-[11px]" style={{ color: "rgba(252,165,165,0.95)" }}>{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-[11px] mr-auto" style={{ color: "var(--muted-foreground)" }}>
              Al cambiarla se rehacen los prompts (menos los que editaste a mano).
            </span>
            <button
              onClick={() => run("regenerate")}
              disabled={busy !== null}
              className="btn-secondary text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {busy === "regenerate" ? "Rehaciendo..." : "Rehacer con IA"}
            </button>
            <button
              onClick={() => run("save")}
              disabled={busy !== null || !draft.trim() || draft.trim() === (bible.text ?? "").trim()}
              className="btn-primary text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {busy === "save" ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
