import { useEffect, useRef, useState } from "react";
import { projectsService } from "@/services/projects.service";
import { supabase } from "@/lib/supabaseClient";
import { mapJob } from "@/lib/mappers";
import StockReviewPanel from "./StockReviewPanel";
import type { Job, VisualSource, Asset } from "@/types";

interface Props {
  projectId: string;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height: 6, background: "rgba(255,255,255,0.06)" }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${value}%`,
          background: "linear-gradient(90deg, #7c6aff, #6366f1)",
          boxShadow: "0 0 8px rgba(124,106,255,0.4)",
        }}
      />
    </div>
  );
}

function JobStatus({ job }: { job: Job }) {
  return (
    <div
      className="rounded-2xl p-6 space-y-5 w-full max-w-md"
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(124,106,255,0.12)", border: "1px solid rgba(124,106,255,0.2)" }}
        >
          <span className="w-4 h-4 border-2 rounded-full animate-spin inline-block" style={{ borderColor: "rgba(167,155,255,0.2)", borderTopColor: "#a78bfa" }} />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Generando video</p>
          <p className="text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>{job.message}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Progreso</span>
          <span className="text-xs font-mono" style={{ color: "#a78bfa" }}>{job.progress}%</span>
        </div>
        <ProgressBar value={job.progress} />
      </div>
    </div>
  );
}

export default function PreviewPanel({ projectId }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visualSource, setVisualSource] = useState<VisualSource>("stock");
  const [renderAsset, setRenderAsset] = useState<Asset | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    projectsService.getJob(projectId).then((j) => {
      setJob(j);
      setLoading(false);
    });
    // Precarga el modo elegido la ultima vez para este proyecto (persiste
    // en video_projects.visual_source) -- si el usuario ya lo eligio antes,
    // no vuelve a "stock" por default en cada visita al tab.
    projectsService.getProjectById(projectId).then((p) => {
      if (p) setVisualSource(p.visualSource);
    });
  }, [projectId]);

  // El pipeline corre en background en el backend (ver pipeline.service.ts /
  // job.service.ts::approveStockReview) y va actualizando status/progress
  // en la fila del Job a medida que procesa cada paso. En vez de preguntar
  // "¿ya termino?" cada pocos segundos (lo que en un video de varios
  // minutos son decenas de requests), el frontend se suscribe a los
  // cambios de esa fila puntual via Supabase Realtime -- el servidor
  // avisa, el navegador no pregunta nada.
  useEffect(() => {
    if (!job?.id) return;
    const channel = supabase
      .channel(`job-${job.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${job.id}` },
        (payload) => {
          setJob(mapJob(payload.new as Parameters<typeof mapJob>[0]));
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [job?.id]);

  // El render final (Cloudinary o Storage, ver render_video.tool.ts) recien
  // existe como Asset una vez que el Job llega a DONE -- se trae aparte en
  // vez de meterlo en el Job para no acoplar el polling/realtime de arriba
  // a esta consulta.
  useEffect(() => {
    if (job?.status !== "DONE") {
      setRenderAsset(null);
      return;
    }
    projectsService.getFinalRenderAsset(projectId).then(setRenderAsset);
  }, [projectId, job?.status]);

  const handleDownload = async () => {
    if (!renderAsset) return;
    setDownloading(true);
    try {
      // <a download> no fuerza la descarga en recursos cross-origin (el
      // video vive en Cloudinary/Supabase, no en este dominio) -- se trae
      // como blob y se dispara la descarga desde un object URL propio, que
      // si es same-origin para el navegador.
      const response = await fetch(renderAsset.storageKey);
      if (!response.ok) throw new Error("No se pudo descargar el video");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${projectId}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descargar el video");
    } finally {
      setDownloading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // El pipeline automatico (orchestrator.ts) lee visual_source del
      // proyecto para decidir stock/IA/mixto por escena -- se persiste
      // antes de arrancar para que la corrida use lo que se eligio ahora.
      await projectsService.updateProject(projectId, { visualSource });
      const newJob = await projectsService.runPipeline(projectId);
      setJob(newJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la generación");
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

  if (job?.status === "AWAITING_STOCK_REVIEW") {
    return (
      <StockReviewPanel
        projectId={projectId}
        jobId={job.id}
        onApproved={setJob}
        onRegenerate={handleGenerate}
        regenerating={generating}
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
      {/* Video player */}
      <div
        className="w-full max-w-2xl rounded-2xl flex items-center justify-center relative overflow-hidden"
        style={{
          aspectRatio: "16/9",
          background: "#020408",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 50%, rgba(60,50,140,0.15) 0%, transparent 65%)" }} />

        {job?.status === "DONE" && renderAsset ? (
          <video
            key={renderAsset.id}
            src={renderAsset.storageKey}
            controls
            className="w-full h-full object-contain relative"
          />
        ) : job?.status === "DONE" ? (
          <div className="relative text-center">
            <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-2" style={{ borderColor: "rgba(167,155,255,0.2)", borderTopColor: "#a78bfa" }} />
            <p className="text-xs" style={{ color: "#a78bfa" }}>Cargando video...</p>
          </div>
        ) : job?.status === "RUNNING" || job?.status === "QUEUED" ? (
          <div className="relative text-center">
            <div className="w-10 h-10 border-2 rounded-full animate-spin mx-auto mb-2" style={{ borderColor: "rgba(167,155,255,0.15)", borderTopColor: "#a78bfa" }} />
            <p className="text-xs" style={{ color: "rgba(167,155,255,0.6)" }}>Generando...</p>
          </div>
        ) : (
          <div className="relative text-center">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2">
              <path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.845v6.31a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
            </svg>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Preview del video</p>
          </div>
        )}
      </div>

      {/* Status / actions */}
      {job?.status === "RUNNING" || job?.status === "QUEUED" ? (
        <JobStatus job={job} />
      ) : job?.status === "DONE" ? (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <div className="flex items-center gap-2" style={{ color: "#34d399" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="text-sm font-medium">Video generado exitosamente</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Regenerar
            </button>
            <button
              onClick={handleDownload}
              disabled={!renderAsset || downloading}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
            >
              {downloading ? (
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
              Descargar
            </button>
          </div>
          {error && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
        </div>
      ) : job?.status === "FAILED" ? (
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <p className="text-sm" style={{ color: "#f87171" }}>{job.message || "La generación falló."}</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl disabled:opacity-50"
          >
            {generating ? "Reintentando..." : "Reintentar"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm max-w-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Cuando el guion y las escenas estén listos, generá el video final con IA.
          </p>

          {/* Fuente visual para TODAS las escenas de esta corrida (ver
              orchestrator.ts) -- se puede pisar despues por escena en el
              tab Scenes. */}
          <div className="flex flex-col gap-1.5 w-full max-w-xs">
            <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
              Fuente de los clips
            </span>
            <div className="flex gap-2">
              {(
                [
                  { value: "stock" as const, label: "Stock" },
                  { value: "ai" as const, label: "Solo IA" },
                  { value: "mixed" as const, label: "Mixto" },
                ]
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setVisualSource(opt.value)}
                  className="flex-1 text-xs font-medium py-2 rounded-lg transition-all duration-150"
                  style={
                    visualSource === opt.value
                      ? { background: "rgba(124,106,255,0.15)", border: "1px solid rgba(124,106,255,0.3)", color: "var(--foreground)" }
                      : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--muted-foreground)" }
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl disabled:opacity-50"
          >
            {generating ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Iniciando...</>
            ) : (
              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></svg> Generar video</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
