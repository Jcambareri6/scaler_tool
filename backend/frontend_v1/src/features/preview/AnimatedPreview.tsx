import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AnimatedVideo } from "@motion/scenes/AnimatedVideo";
import { FPS } from "@motion/catalog";
import type { AnimatedScene, AnimatedVideoProps } from "@motion/scenes/types";
import { projectsService } from "@/services/projects.service";
import type { Job } from "@/types";

interface Props {
  projectId: string;
  jobId: string;
  onApproved: (job: Job) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

const RECURSOS: Record<string, string> = { ubicacion: "Mapa", esquema_capas: "Esquema" };

function formatSeconds(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// Que muestra cada escena, en palabras: recurso del formato documental o el
// grafico a pantalla completa.
function describe(scene: AnimatedScene): { tipo: string; texto: string } {
  const recurso = scene.recurso as { tipo?: string; titulo?: { texto: string }[]; contenido?: Record<string, unknown> } | undefined;
  if (recurso?.tipo) {
    const contenido = recurso.contenido ?? {};
    const texto = recurso.titulo?.[0]?.texto ?? [contenido.lugar, contenido.principal].find((v) => typeof v === "string") ?? "";
    return { tipo: RECURSOS[recurso.tipo] ?? recurso.tipo, texto: String(texto) };
  }
  const spec = (scene.elements[0] as { spec?: { type?: string; text?: string } } | undefined)?.spec;
  return { tipo: spec?.type === "kinetic_quote" ? "Cita" : (spec?.type ?? "Escena"), texto: spec?.text ?? "" };
}

// Formato todo animado: misma pantalla de revision que los otros formatos
// (StockReviewPanel), con el video completo en vivo antes de renderizar -- los
// mismos componentes que dibuja el render (backend/motion) y la voz real.
export default function AnimatedPreview({ projectId, jobId, onApproved, onRegenerate, regenerating }: Props) {
  const [video, setVideo] = useState<AnimatedVideoProps | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    projectsService
      .getOverlays(projectId)
      .then(({ animated, theme, locale }) => {
        if (animated) setVideo({ ...animated, theme, locale, audioSrc: animated.audioSrc ?? undefined } as AnimatedVideoProps);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => setCurrentTime(e.detail.frame / FPS);
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, [video]);

  const approve = async () => {
    setApproving(true);
    setError(null);
    try {
      onApproved(await projectsService.approveStockReview(jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el render");
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(227,11,16,0.2)", borderTopColor: "#FF8A8D" }} />
      </div>
    );
  }

  const scenes = video?.scenes ?? [];
  const playing = scenes.find((s) => currentTime >= s.start && currentTime < s.end)?.id ?? null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-3 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          Revisá el video antes del render final
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          El video animado completo, con la voz real, tal como va a salir en el render.
        </p>
        {error && <p className="text-xs mt-2" style={{ color: "#f87171" }}>{error}</p>}
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 flex items-center justify-center px-4 xl:px-6 py-2" style={{ containerType: "size" }}>
            {video ? (
              <div
                className="relative rounded-2xl overflow-hidden"
                style={{ aspectRatio: "16/9", width: "min(100%, 56rem, calc(100cqh * 16 / 9))", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <Player
                  ref={playerRef}
                  component={AnimatedVideo}
                  inputProps={video}
                  durationInFrames={Math.max(1, Math.round(video.durationSeconds * FPS))}
                  fps={FPS}
                  compositionWidth={1920}
                  compositionHeight={1080}
                  style={{ width: "100%", height: "100%" }}
                  controls
                  acknowledgeRemotionLicense
                />
              </div>
            ) : (
              <p className="text-sm" style={{ color: "#FF8A8D" }}>Este proyecto no tiene escenas animadas: generá el video de nuevo.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 xl:px-6 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <span className="text-xs font-mono whitespace-nowrap" style={{ color: "var(--muted-foreground)" }}>
              {formatSeconds(currentTime)} / {formatSeconds(video?.durationSeconds ?? 0)}
            </span>
            <div className="flex items-center justify-end gap-2 ml-auto">
              <button
                onClick={onRegenerate}
                disabled={approving || regenerating}
                className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {regenerating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Regenerando...
                  </>
                ) : (
                  "Regenerar todo"
                )}
              </button>
              <button
                onClick={approve}
                disabled={!video || approving || regenerating}
                className="btn-primary flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl whitespace-nowrap shrink-0 disabled:opacity-50"
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
          </div>
        </div>

        {/* Columna derecha: escenas del plan animado; click = saltar ahi. */}
        <div className="w-80 min-w-80 h-full flex flex-col" style={{ borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
              {scenes.length} escenas
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pt-3 pb-3 space-y-1.5">
            {scenes.map((scene, i) => {
              const { tipo, texto } = describe(scene);
              const active = scene.id === playing;
              return (
                <button
                  key={scene.id}
                  onClick={() => playerRef.current?.seekTo(Math.round(scene.start * FPS))}
                  className="w-full text-left p-2.5 rounded-xl transition-all duration-150"
                  style={
                    active
                      ? { background: "rgba(227,11,16,0.08)", border: "1px solid rgba(255,138,141,0.45)" }
                      : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }
                  }
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>
                      {i + 1} · {formatSeconds(scene.start)}–{formatSeconds(scene.end)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}>
                      {tipo}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--foreground)" }}>
                    {texto || "Sin texto"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
