import { useEffect, useMemo, useRef, useState } from "react";
import { projectsService } from "@/services/projects.service";
import type { Asset, Job, Scene } from "@/types";

interface Props {
  projectId: string;
  jobId: string;
  onApproved: (job: Job) => void;
  // Reintentar todo el pipeline (voz -> Whisper -> escenas -> stock) desde
  // esta pantalla -- sin esto, una vez que el job ya esta en
  // AWAITING_STOCK_REVIEW no hay forma de volver a dispararlo, solo de
  // aprobar lo que ya se generó.
  onRegenerate: () => void;
  regenerating: boolean;
}

// Escala adaptativa: un guion largo (10+ minutos, comun en este proyecto)
// a una escala fija de px/segundo arma un timeline de decenas de miles de
// px de ancho -- inusable, solo se ve la primera escena sin scrollear una
// eternidad. Se apunta a que el timeline entero ronde TARGET_WIDTH px,
// escalando px/segundo segun la duracion total, con piso y techo para que
// ni un video de 1 hora quede ilegible ni uno de 20 segundos quede
// microscopico.
const TARGET_TIMELINE_WIDTH = 1600;
const MIN_PIXELS_PER_SECOND = 3;
const MAX_PIXELS_PER_SECOND = 40;
const MIN_CLIP_WIDTH = 40;

function parseTimeToSeconds(time: string): number {
  const [mm, ss] = time.split(":").map((n) => Number(n) || 0);
  return (mm ?? 0) * 60 + (ss ?? 0);
}

function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

// Barras decorativas para el track de audio -- no hay datos reales de
// amplitud (el backend no analiza la onda), solo da "sensacion" de forma de
// onda tipo CapCut. Determinista por indice para que no titile en cada
// render.
function waveformHeight(index: number): number {
  let value = (index + 1) * 9301 + 49297;
  value = value % 233280;
  const rnd = value / 233280;
  return 22 + rnd * 55;
}

interface TimelineSegment {
  scene: Scene;
  asset: Asset | null;
  startSec: number;
  endSec: number;
}

// metadata.sequence lo asigna replaceStockSegmentsForScene -- define el
// orden de reproduccion cuando una escena necesito mas de un clip para
// cubrir toda su duracion (ningun candidato solo le alcanzaba).
function sequenceOf(asset: Asset): number {
  const value = asset.metadata?.sequence;
  return typeof value === "number" ? value : 0;
}

// Gate humano (Job.status === AWAITING_STOCK_REVIEW): timeline estilo
// CapCut -- track de video (clips de stock por escena, ancho proporcional
// a su duracion real) + track de audio (la narracion completa), con un
// solo playhead compartido. El <audio> es el reloj maestro: el <video> de
// arriba solo sigue que escena le toca mostrar segun currentTime, no tiene
// su propio audio (queda muted). storage_key en esta fase ya es una URL
// fetcheable (CDN de stock o nuestro bucket de audio), no depende de que
// el frontend resuelva Storage por su cuenta.
export default function StockReviewPanel({ projectId, jobId, onApproved, onRegenerate, regenerating }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [audioAsset, setAudioAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    Promise.all([
      projectsService.getScenes(projectId),
      projectsService.getSceneVideoAssets(projectId),
      projectsService.getAudioAsset(projectId),
    ]).then(([sceneRows, stockRows, audio]) => {
      setScenes(sceneRows.sort((a, b) => a.order - b.order));
      setAssets(stockRows);
      setAudioAsset(audio);
      setLoading(false);
    });
  }, [projectId]);

  // Una escena puede necesitar mas de un clip para cubrir toda su duracion
  // (replaceStockSegmentsForScene completa con otro candidato en vez de
  // repetir el mismo) -- cada asset de la escena se subdivide dentro de la
  // ventana de tiempo real de esa escena, en orden (metadata.sequence),
  // usando metadata.duration_seconds como su porcion. Si la escena no
  // tiene ningun asset, queda un solo segmento sin clip cubriendo toda la
  // ventana (igual que antes).
  const segments = useMemo<TimelineSegment[]>(() => {
    const result: TimelineSegment[] = [];
    for (const scene of scenes) {
      const startSec = parseTimeToSeconds(scene.timeStart);
      const endSec = parseTimeToSeconds(scene.timeEnd);
      const sceneAssets = assets.filter((a) => a.sceneId === scene.id).sort((a, b) => sequenceOf(a) - sequenceOf(b));

      if (sceneAssets.length === 0) {
        result.push({ scene, asset: null, startSec, endSec });
        continue;
      }

      let cursor = startSec;
      sceneAssets.forEach((asset, i) => {
        const isLast = i === sceneAssets.length - 1;
        const allocated = Number(asset.metadata?.duration_seconds) || (endSec - startSec) / sceneAssets.length;
        const segEnd = isLast ? endSec : Math.min(endSec, cursor + allocated);
        result.push({ scene, asset, startSec: cursor, endSec: segEnd });
        cursor = segEnd;
      });
    }
    return result;
  }, [scenes, assets]);

  const totalDuration = segments.length > 0 ? segments[segments.length - 1]!.endSec : 0;

  const pixelsPerSecond =
    totalDuration > 0
      ? Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, TARGET_TIMELINE_WIDTH / totalDuration))
      : MAX_PIXELS_PER_SECOND;

  const activeSegmentIndex = useMemo(() => {
    const idx = segments.findIndex((s) => currentTime >= s.startSec && currentTime < s.endSec);
    if (idx !== -1) return idx;
    // currentTime cayo en un hueco entre dos escenas (pausas reales en la
    // narracion -- las escenas no siempre quedan pegadas una a la otra) o
    // despues de la ultima. Nos quedamos en el ultimo segmento cuyo inicio
    // ya paso -- si saltaramos al segmento 0 en cada hueco, el video pega
    // un salto para atras en cada pausa en vez de sostener el clip actual
    // hasta que arranque el proximo segmento de verdad.
    for (let i = segments.length - 1; i >= 0; i--) {
      if (currentTime >= segments[i]!.startSec) return i;
    }
    return 0;
  }, [segments, currentTime]);

  const activeSegment = segments[activeSegmentIndex] ?? null;

  // El <video> sigue al segmento activo: cambia de fuente cuando el
  // playhead cruza a otro clip (sea de la misma escena completandola, o de
  // la escena siguiente), y arranca desde su propio inicio (no tiene forma
  // de "seekear" dentro de un clip ajeno al de la narracion). `loop` en el
  // elemento cubre el caso de un clip de stock mas corto que su segmento
  // (aun despues de completar con otro clip puede sobrar un resto chico) --
  // sin esto el video llegaba a su ultimo frame y se quedaba congelado ahi.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSegment?.asset) return;
    if (!video.src.endsWith(activeSegment.asset.storageKey)) {
      video.src = activeSegment.asset.storageKey;
      video.currentTime = 0;
    }
    if (isPlaying) video.play().catch(() => {});
    else video.pause();
  }, [activeSegment, isPlaying]);

  const handleTogglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play().catch(() => {});
  };

  const handleSeek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(seconds, 0), totalDuration);
    setCurrentTime(audio.currentTime);
  };

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

  const timelineWidth = Math.max(totalDuration * pixelsPerSecond, 400);
  const waveformBarCount = Math.floor(timelineWidth / 4);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-3 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          Revisá el video antes del render final
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Estos son los clips que el sistema eligió automáticamente para cada escena.
        </p>
        {error && <p className="text-xs mt-2" style={{ color: "#f87171" }}>{error}</p>}
      </div>

      {/* Preview grande */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-6">
        <div
          className="relative w-full max-w-2xl rounded-2xl overflow-hidden flex items-center justify-center"
          style={{ aspectRatio: "16/9", background: "#020408", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {activeSegment?.asset ? (
            <video ref={videoRef} muted playsInline loop className="w-full h-full object-cover" />
          ) : (
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>Sin clip para esta escena</p>
          )}

          {activeSegment && (
            <div
              className="absolute bottom-2 left-2 px-2 py-1 rounded-md text-[11px] font-mono"
              style={{ background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.8)", backdropFilter: "blur(4px)" }}
            >
              Escena {activeSegment.scene.order} · {activeSegment.scene.timeStart}–{activeSegment.scene.timeEnd}
            </div>
          )}
        </div>
      </div>

      {audioAsset && (
        <audio
          ref={audioRef}
          src={audioAsset.storageKey}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          className="hidden"
        />
      )}

      {/* Toolbar: play/pause, tiempo, aprobar */}
      <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTogglePlay}
            disabled={!audioAsset}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-opacity disabled:opacity-40"
            style={{ background: "rgba(124,106,255,0.15)", border: "1px solid rgba(124,106,255,0.3)" }}
          >
            {isPlaying ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#c4b5fd"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#c4b5fd" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <span className="text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>
            {formatSeconds(currentTime)} / {formatSeconds(totalDuration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRegenerate}
            disabled={approving || regenerating}
            className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
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
            onClick={handleApprove}
            disabled={approving || regenerating}
            className="btn-primary flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl disabled:opacity-50"
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

      {/* Timeline: track de video + track de audio */}
      <div className="px-6 pb-5 overflow-x-auto" style={{ background: "rgba(0,0,0,0.15)" }}>
        <div style={{ width: timelineWidth, position: "relative" }} className="pt-3">
          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
            style={{ left: currentTime * pixelsPerSecond, background: "#a78bfa", boxShadow: "0 0 6px rgba(167,155,255,0.8)" }}
          />

          {/* Track de video -- una escena con mas de un clip aparece como
              varios bloques contiguos con el mismo numero de escena. */}
          <div className="flex gap-0.5 mb-1">
            {segments.length === 0 ? (
              <p className="text-xs py-4" style={{ color: "var(--muted-foreground)" }}>
                Todavía no hay escenas para mostrar.
              </p>
            ) : (
              segments.map((segment, i) => {
                const widthPx = Math.max((segment.endSec - segment.startSec) * pixelsPerSecond, MIN_CLIP_WIDTH);
                return (
                  <button
                    key={segment.asset?.id ?? `${segment.scene.id}-empty`}
                    onClick={() => handleSeek(segment.startSec)}
                    className="relative shrink-0 rounded-md overflow-hidden text-left transition-all"
                    style={{
                      width: widthPx,
                      height: 84,
                      background: "#111319",
                      border: i === activeSegmentIndex ? "2px solid #a78bfa" : "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {segment.asset ? (
                      <video src={segment.asset.storageKey} muted playsInline preload="metadata" className="w-full h-full object-cover opacity-80" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                        <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>sin clip</span>
                      </div>
                    )}
                    <span
                      className="absolute top-1 left-1 px-1 rounded text-[10px] font-mono"
                      style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
                    >
                      {segment.scene.order}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Track de audio */}
          {audioAsset && totalDuration > 0 && (
            <div
              className="flex items-end gap-[2px] rounded-md px-2"
              style={{ height: 48, background: "rgba(124,106,255,0.08)", border: "1px solid rgba(124,106,255,0.15)" }}
            >
              {Array.from({ length: waveformBarCount }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full"
                  style={{ height: `${waveformHeight(i)}%`, background: "rgba(167,155,255,0.55)", minWidth: 1 }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
