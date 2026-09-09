import { useEffect, useMemo, useRef, useState } from "react";
import { projectsService } from "@/services/projects.service";
import ScenePanel from "./ScenePanel";
import SceneReplaceModal from "./SceneReplaceModal";
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

const WAVEFORM_BAR_COUNT = 160;

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

// Gate humano (Job.status === AWAITING_STOCK_REVIEW). Layout tipo
// "panel de escenas a la derecha" (ver mejoras-interfaz-preview-scalertool.md):
// player grande a la izquierda + lista vertical de escenas a la derecha, en
// vez del filmstrip horizontal de antes -- cada fila mapea 1:1 con una
// escena real, no con un ancho proporcional a su duracion. La franja
// inferior queda solo para scrubbing temporal global (waveform), no como
// selector de escena. El <audio> sigue siendo el reloj maestro: el
// <video>/<img> de arriba solo sigue que escena le toca mostrar segun
// currentTime, no tiene su propio audio (queda muted). storage_key en esta
// fase ya es una URL fetcheable (CDN de stock o nuestro bucket de audio),
// no depende de que el frontend resuelva Storage por su cuenta.
export default function StockReviewPanel({ projectId, jobId, onApproved, onRegenerate, regenerating }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [audioAsset, setAudioAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacingScene, setReplacingScene] = useState<Scene | null>(null);
  // Seleccion explicita (solo cambia con un click en una fila de ScenePanel)
  // -- distinta de "que segmento esta sonando ahora" (activeSegment, mas
  // abajo). El boton "Reemplazar clip" arranca deshabilitado y solo se
  // habilita cuando hay una escena tocada, no simplemente porque el audio
  // este pasando por ahi.
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

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
  // Solo aplica a assets de video -- una imagen (IA o subida a mano) se
  // muestra directo con <img>, no pasa por este elemento.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSegment?.asset || activeSegment.asset.type !== "VIDEO") return;
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

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (totalDuration <= 0 || !waveformRef.current) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const fraction = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    handleSeek(fraction * totalDuration);
  };

  // Click en una fila del panel de escenas: salta el player al inicio de
  // esa escena (no de un segmento puntual -- si la escena tiene varios
  // clips, siempre arranca desde el primero) y la marca como seleccionada,
  // que es lo que habilita el boton "Reemplazar clip" de arriba del panel.
  const handleSelectScene = (scene: Scene) => {
    setSelectedSceneId(scene.id);
    handleSeek(parseTimeToSeconds(scene.timeStart));
  };

  const handleOpenReplace = () => {
    const scene = scenes.find((s) => s.id === selectedSceneId);
    if (scene) setReplacingScene(scene);
  };

  const handleReplaced = (sceneId: string, newAssets: Asset[]) => {
    setAssets((prev) => [...prev.filter((a) => a.sceneId !== sceneId), ...newAssets]);
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

      <div className="flex-1 min-h-0 flex">
        {/* Columna izquierda: player + barra contextual + toolbar + scrubber */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 flex items-center justify-center px-6">
            <div
              className="relative w-full max-w-2xl rounded-2xl overflow-hidden flex items-center justify-center"
              style={{ aspectRatio: "16/9", background: "#020408", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {activeSegment?.asset ? (
                activeSegment.asset.type === "IMAGE" ? (
                  <img key={activeSegment.asset.id} src={activeSegment.asset.storageKey} className="w-full h-full object-cover" alt="Visual de la escena" />
                ) : (
                  <video ref={videoRef} muted playsInline loop className="w-full h-full object-cover" />
                )
              ) : (
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>Sin clip para esta escena</p>
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

          {/* Scrubbing temporal global: solo waveform, ya no mezcla miniaturas
              de escena (ver diagnostico en mejoras-interfaz-preview-scalertool.md). */}
          <div className="px-6 pb-5" style={{ background: "rgba(0,0,0,0.15)" }}>
            <div
              ref={waveformRef}
              onClick={handleWaveformClick}
              className="relative pt-3"
              style={{ cursor: totalDuration > 0 ? "pointer" : "default" }}
            >
              {audioAsset && totalDuration > 0 && (
                <>
                  {/* Playhead */}
                  <div
                    className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
                    style={{ left: `${(currentTime / totalDuration) * 100}%`, background: "#a78bfa", boxShadow: "0 0 6px rgba(167,155,255,0.8)" }}
                  />
                  {/* Marcadores de limite de escena -- referencia liviana, no
                      son clickeables por si (el click va a handleWaveformClick). */}
                  {scenes.map((scene) => (
                    <div
                      key={scene.id}
                      className="absolute top-3 pointer-events-none"
                      style={{
                        left: `${(parseTimeToSeconds(scene.timeStart) / totalDuration) * 100}%`,
                        width: 1,
                        height: 48,
                        background: "rgba(255,255,255,0.14)",
                      }}
                    />
                  ))}

                  <div
                    className="flex items-end gap-[2px] rounded-md px-2"
                    style={{ height: 48, background: "rgba(124,106,255,0.08)", border: "1px solid rgba(124,106,255,0.15)" }}
                  >
                    {Array.from({ length: WAVEFORM_BAR_COUNT }).map((_, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-full"
                        style={{ height: `${waveformHeight(i)}%`, background: "rgba(167,155,255,0.55)", minWidth: 1 }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Columna derecha: panel vertical de escenas */}
        <ScenePanel
          scenes={scenes}
          assets={assets}
          selectedSceneId={selectedSceneId}
          playingSceneId={activeSegment?.scene.id ?? null}
          onSelectScene={handleSelectScene}
          onReplace={handleOpenReplace}
        />
      </div>

      {replacingScene && (
        <SceneReplaceModal
          scene={replacingScene}
          currentAssets={assets.filter((a) => a.sceneId === replacingScene.id)}
          onClose={() => setReplacingScene(null)}
          onReplaced={handleReplaced}
        />
      )}
    </div>
  );
}
