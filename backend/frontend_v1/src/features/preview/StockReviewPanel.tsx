import { useEffect, useState } from "react";
import { projectsService } from "@/services/projects.service";
import type { Asset, Job } from "@/types";

interface Props {
  projectId: string;
  jobId: string;
  onApproved: (job: Job) => void;
}

// Gate humano (Job.status === AWAITING_STOCK_REVIEW): muestra el clip de
// stock ya elegido por escena (metadata.kind === "stock_preview",
// asignado en pipeline/orchestrator.ts::selectStockForScene) para que el
// usuario lo confirme antes del render final. storage_key en esta fase es
// la URL directa del CDN de Pexels/Pixabay, asi que el <video> reproduce
// sin depender de Storage propio todavia.
export default function StockReviewPanel({ projectId, jobId, onApproved }: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsService.getStockPreviewAssets(projectId).then((rows) => {
      setAssets(rows);
      setLoading(false);
    });
  }, [projectId]);

  const handleApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      const job = await projectsService.approveStockReview(jobId);
      onApproved(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aprobar el stock");
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(124,106,255,0.2)", borderTopColor: "#a78bfa" }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center h-full p-8 gap-6 overflow-y-auto">
      <div className="text-center max-w-md">
        <p className="text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
          Revisá el stock por escena
        </p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          Estos son los clips que el sistema eligió automáticamente para cada escena. Aprobá para
          continuar con el render final.
        </p>
      </div>

      {error && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}

      <div className="grid grid-cols-2 gap-4 w-full max-w-2xl">
        {assets.length === 0 ? (
          <p className="text-xs col-span-2 text-center" style={{ color: "var(--muted-foreground)" }}>
            Todavía no hay clips de stock para revisar.
          </p>
        ) : (
          assets.map((asset) => (
            <div
              key={asset.id}
              className="rounded-xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              <video src={asset.storageKey} controls className="w-full aspect-video bg-black" />
              <div className="px-3 py-2 text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
                {typeof asset.metadata?.provider === "string" ? asset.metadata.provider : "stock"}
              </div>
            </div>
          ))
        )}
      </div>

      <button
        onClick={handleApprove}
        disabled={approving}
        className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl disabled:opacity-50"
      >
        {approving ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Renderizando...
          </>
        ) : (
          "Aprobar y renderizar"
        )}
      </button>
    </div>
  );
}
