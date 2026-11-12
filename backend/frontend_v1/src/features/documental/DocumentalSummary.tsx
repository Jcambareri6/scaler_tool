import { useEffect, useState } from "react";
import { documentalService, type DocumentalSummary as Summary } from "@/services/documental.service";

// Resumen del documental: que hizo el montajista y el juez, creditos y
// capitulos listos para pegar en la descripcion de YouTube, y el control de
// calidad del ultimo render (con causa y que hacer, heuristica 9).

interface Props {
  projectId: string;
  // Se vuelve a pedir cuando cambia (ej. al terminar un render).
  refreshKey?: string;
}

function CopyBlock({ label, text, empty }: { label: string; text: string; empty: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
          {label}
        </span>
        {text && (
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="text-[11px] font-medium px-2 py-1 rounded-md focus-visible:ring-2 focus-visible:ring-[#FF8A8D] outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--foreground)" }}
          >
            {copied ? "¡Copiado!" : "Copiar"}
          </button>
        )}
      </div>
      {text ? (
        <pre className="text-[11px] whitespace-pre-wrap max-h-40 overflow-auto rounded-lg p-2" style={{ background: "rgba(0,0,0,0.25)", color: "rgba(255,255,255,0.8)" }}>
          {text}
        </pre>
      ) : (
        <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{empty}</p>
      )}
    </div>
  );
}

export default function DocumentalSummary({ projectId, refreshKey }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    documentalService
      .getSummary(projectId)
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el resumen"));
  }, [projectId, refreshKey]);

  if (error) return <p className="text-xs" style={{ color: "#FF8A8D" }}>{error}</p>;
  if (!summary) return null;

  const shots = summary.plan?.shots ?? [];
  const approved = shots.filter((s) => s.qa === "ok").length;
  const safe = shots.filter((s) => s.qa === "seguro").length;
  const empty = shots.filter((s) => s.source === "none").length;

  return (
    <div className="w-full max-w-xl flex flex-col gap-4 rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
      {summary.plan && (
        <div className="flex flex-wrap gap-2 text-[11px]" aria-label="Resumen del montaje">
          <span className="px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.04)" }}>{shots.length} planos</span>
          <span className="px-2 py-1 rounded-md" style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}>{approved} aprobados por el juez</span>
          {safe > 0 && (
            <span className="px-2 py-1 rounded-md" style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24" }} title="Ningún candidato pasó el juez: se usó un plano de ambiente. Conviene revisarlos.">
              {safe} con plano seguro
            </span>
          )}
          {empty > 0 && (
            <span className="px-2 py-1 rounded-md" style={{ background: "rgba(227,11,16,0.12)", color: "#FF8A8D" }}>
              {empty} sin material: reemplazalos antes de renderizar
            </span>
          )}
          {summary.plan.source === "heuristic" && (
            <span className="px-2 py-1 rounded-md" style={{ background: "rgba(227,11,16,0.12)", color: "#FF8A8D" }}>
              El montajista no respondió: plan automático simple
            </span>
          )}
        </div>
      )}

      {summary.qc && summary.qc.warnings.length > 0 && (
        <div role="status" className="rounded-lg px-3 py-2 text-[11px]" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>
          <strong>Revisá el video final:</strong> {summary.qc.warnings.join(" · ")}. Si hay negro o imagen congelada, reemplazá ese plano y volvé a renderizar.
        </div>
      )}
      {summary.qc && summary.qc.warnings.length === 0 && (
        <p className="text-[11px]" style={{ color: "#34d399" }}>
          Control de calidad OK{summary.qc.integrated_lufs !== null ? ` · volumen ${summary.qc.integrated_lufs} LUFS` : ""}.
        </p>
      )}

      <CopyBlock label="Capítulos para la descripción" text={summary.chaptersText} empty="Todavía no hay capítulos." />
      <CopyBlock label="Créditos para la descripción" text={summary.creditsText} empty="Sin material que requiera créditos." />
    </div>
  );
}
