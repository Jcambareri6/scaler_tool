import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { projectsService } from "@/services/projects.service";
import { useAccount } from "@/lib/accountContext";
import ScenePanel from "./ScenePanel";
import SceneReplaceModal, { type ReplaceParams } from "./SceneReplaceModal";
// Lazy: Remotion pesa ~400 kB y solo hace falta en esta pantalla.
const OverlayLayer = lazy(() => import("./OverlayLayer"));
import type { Asset, Job, ProjectOverlays, Scene } from "@/types";
import { CATALOG } from "@motion/catalog";

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
const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2];

function parseTimeToSeconds(time: string): number {
  const [mm, ss] = time.split(":").map((n) => Number(n) || 0);
  return (mm ?? 0) * 60 + (ss ?? 0);
}

// startSeconds/endSeconds son los tiempos reales; timeStart/timeEnd estan
// redondeados al segundo (solo para mostrar) y quedan de fallback para
// escenas viejas.
function sceneStart(scene: Scene): number {
  return scene.startSeconds ?? parseTimeToSeconds(scene.timeStart);
}

function sceneEnd(scene: Scene): number {
  return scene.endSeconds ?? parseTimeToSeconds(scene.timeEnd);
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
  // Escenas cuyo reemplazo esta corriendo en segundo plano (ver
  // handleReplaceSubmit) -- el modal ya se cerro apenas el usuario confirma,
  // este set es lo unico que le muestra que ese clip todavia esta en vuelo.
  const [replacingSceneIds, setReplacingSceneIds] = useState<Set<string>>(new Set());
  const [audioAsset, setAudioAsset] = useState<Asset | null>(null);
  // Cues de subtitulo (timelines.content.segments, ver build_timeline.tool.ts)
  // -- mismos datos que usa el render final (render_video) y el preview post-
  // render, mostrados aca sincronizados con el mismo audio-clock (currentTime)
  // que ya maneja este componente, para que la revision del gate humano se
  // vea lo mas parecido posible al resultado final.
  const [captionSegments, setCaptionSegments] = useState<{ text: string; start: number; end: number }[]>([]);
  // Graficos animados que va a superponer el render, en vivo sobre el clip.
  const [overlays, setOverlays] = useState<ProjectOverlays | null>(null);
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
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showRateMenu, setShowRateMenu] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

  // Contador de videos: el primer render de un proyecto descuenta 1 video;
  // re-renderizarlo no (renderCharged). Las cuentas sin limite no descuentan.
  const { account, refresh: refreshAccount } = useAccount();
  const [renderCharged, setRenderCharged] = useState<boolean | null>(null);
  // Proyecto "Vacío (solo Flow)" (visual_source "flow", ver orchestrator.ts):
  // las escenas llegan sin clip a proposito, con sus prompts ya armados.
  const [flowOnly, setFlowOnly] = useState(false);
  useEffect(() => {
    projectsService
      .getProjectById(projectId)
      .then((p) => {
        setRenderCharged(p?.renderCharged ?? null);
        setFlowOnly(p?.visualSource === "flow");
      })
      .catch(() => setRenderCharged(null));
  }, [projectId]);
  const willCharge = Boolean(account && !account.unlimited && renderCharged === false);
  const noCredits = willCharge && (account?.videosAvailable ?? 0) <= 0;
  const renderHint = !account || account.unlimited || renderCharged === null
    ? null
    : renderCharged
      ? "Este proyecto ya usó su video: renderizarlo de nuevo no descuenta."
      : noCredits
        ? "Se terminaron tus videos. Contactá al administrador para cargar más."
        : `Usa 1 video (te ${account.videosAvailable === 1 ? "queda 1" : `quedan ${account.videosAvailable}`}).`;

  useEffect(() => {
    Promise.all([
      projectsService.getScenes(projectId),
      projectsService.getSceneVideoAssets(projectId),
      projectsService.getAudioAsset(projectId),
      projectsService.getTimelineSegments(projectId),
    ]).then(([sceneRows, stockRows, audio, segments]) => {
      setScenes(sceneRows.sort((a, b) => a.order - b.order));
      setAssets(stockRows);
      setAudioAsset(audio);
      setCaptionSegments(segments);
      setLoading(false);
    });
    // Aparte: si falla, la revision sigue igual, solo sin graficos.
    projectsService.getOverlays(projectId).then(setOverlays).catch(() => setOverlays(null));
  }, [projectId]);

  // Solo Flow: las imagenes se cargan desde otra pestaña (Escenas ->
  // Imagenes en lote), asi que al volver a esta se releen.
  useEffect(() => {
    if (!flowOnly) return;
    const reload = () => {
      if (document.visibilityState !== "visible") return;
      projectsService.getSceneVideoAssets(projectId).then(setAssets).catch(() => {});
    };
    document.addEventListener("visibilitychange", reload);
    window.addEventListener("focus", reload);
    return () => {
      document.removeEventListener("visibilitychange", reload);
      window.removeEventListener("focus", reload);
    };
  }, [flowOnly, projectId]);

  const scenesWithVisual = useMemo(() => new Set(assets.map((a) => a.sceneId).filter(Boolean)).size, [assets]);
  // Sin ninguna imagen el render falla (no hay nada que mostrar): se frena
  // aca en vez de gastar el intento.
  const missingFlowImages = flowOnly && scenesWithVisual === 0;

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
      const startSec = sceneStart(scene);
      const endSec = sceneEnd(scene);
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

  // Desenfoque del clip mientras hay un grafico que lo pide (capitulos,
  // frases...): mismo valor del catalogo que usa ffmpeg en el render, en px
  // a 1080p, escalado al alto real del player.
  const playerBoxRef = useRef<HTMLDivElement>(null);
  const backdropBlur = useMemo(() => {
    if (!overlays?.enabled) return 0;
    const active = overlays.overlays.find((o) => currentTime >= o.start && currentTime < o.end);
    const px = active ? (CATALOG[active.spec.type]?.blur ?? 0) : 0;
    return px * ((playerBoxRef.current?.clientHeight ?? 1080) / 1080);
  }, [overlays, currentTime]);
  // scale: el blur de CSS deja los bordes transparentes; agrandar apenas el
  // clip los saca de cuadro (overflow-hidden del contenedor).
  const mediaStyle = {
    filter: backdropBlur > 0 ? `blur(${backdropBlur.toFixed(1)}px)` : "none",
    transform: backdropBlur > 0 ? "scale(1.05)" : "none",
    transition: "filter 0.3s ease, transform 0.3s ease",
  };

  const activeCaption = useMemo(
    () => captionSegments.find((c) => currentTime >= c.start && currentTime < c.end) ?? null,
    [captionSegments, currentTime]
  );

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
      // Si se entro al segmento a mitad (seek), el clip arranca desde el
      // punto equivalente -- igual que en el render, donde el clip corre
      // (en loop) desde el inicio del segmento.
      const offset = Math.max(0, (audioRef.current?.currentTime ?? 0) - activeSegment.startSec);
      video.src = activeSegment.asset.storageKey;
      video.addEventListener(
        "loadedmetadata",
        () => {
          video.currentTime = video.duration > 0 ? offset % video.duration : 0;
        },
        { once: true }
      );
    }
    video.playbackRate = playbackRate;
    if (isPlaying) video.play().catch(() => {});
    else video.pause();
  }, [activeSegment, isPlaying, playbackRate]);

  const handleTogglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play().catch(() => {});
  };

  // El audio narrado es el reloj maestro (ver comentario de arriba del
  // componente) -- cambiar su rate alcanza para que currentTime/el resto del
  // scrubbing sigan funcionando igual, solo mas rapido/lento. El <video>
  // activo se sincroniza en el efecto de arriba (dependency `playbackRate`).
  const handleChangeRate = (rate: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
    setPlaybackRate(rate);
    setShowRateMenu(false);
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
    handleSeek(sceneStart(scene));
  };

  const handleOpenReplace = () => {
    const scene = scenes.find((s) => s.id === selectedSceneId);
    if (scene) setReplacingScene(scene);
  };

  // El modal ya se cerro cuando esto se llama -- el reemplazo real corre
  // aca, en segundo plano, para que el usuario pueda seguir viendo/tocando
  // otras escenas mientras tanto en vez de quedar bloqueado por un modal.
  const handleReplaceSubmit = (sceneId: string, params: ReplaceParams) => {
    setReplacingSceneIds((prev) => new Set(prev).add(sceneId));
    setError(null);

    (async () => {
      try {
        const newAssets =
          params.tab === "upload"
            ? await projectsService.uploadSceneVisual(sceneId, params.file)
            : params.tab === "ai"
              ? await projectsService.regenerateSceneVisual(sceneId, { source: "ai", aiPrompt: params.aiPrompt })
              : await projectsService.regenerateSceneVisual(sceneId, { prompt: params.prompt });
        setAssets((prev) => [...prev.filter((a) => a.sceneId !== sceneId), ...newAssets]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo reemplazar el clip");
      } finally {
        setReplacingSceneIds((prev) => {
          const next = new Set(prev);
          next.delete(sceneId);
          return next;
        });
      }
    })();
  };

  const handleApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      const job = await projectsService.approveStockReview(jobId);
      void refreshAccount();
      onApproved(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aprobar el stock");
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

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-3 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          Revisá el video antes del render final
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          {flowOnly
            ? `Escenas vacías con sus prompts listos para Flow · ${scenesWithVisual} de ${scenes.length} con imagen. Cargalas desde la extensión o en Escenas → Imágenes en lote.`
            : "Estos son los clips que el sistema eligió automáticamente para cada escena."}
        </p>
        {error && <p className="text-xs mt-2" style={{ color: "#f87171" }}>{error}</p>}
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Columna izquierda: player + barra contextual + toolbar + scrubber */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* El player se ajusta al ancho Y al alto disponibles (container
              query): en pantallas bajas (notebooks con zoom) antes crecia por
              el ancho y empujaba la barra de abajo fuera de la vista. */}
          <div className="flex-1 min-h-0 flex items-center justify-center px-4 xl:px-6 py-2" style={{ containerType: "size" }}>
            <div
              ref={playerBoxRef}
              className="relative rounded-2xl overflow-hidden flex items-center justify-center"
              style={{ aspectRatio: "16/9", width: "min(100%, 42rem, calc(100cqh * 16 / 9))", background: "#020408", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {activeSegment?.asset ? (
                activeSegment.asset.type === "IMAGE" ? (
                  <img key={activeSegment.asset.id} src={activeSegment.asset.storageKey} className="w-full h-full object-cover" style={mediaStyle} alt="Visual de la escena" />
                ) : (
                  <video ref={videoRef} muted playsInline loop className="w-full h-full object-cover" style={mediaStyle} />
                )
              ) : (
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
                  {flowOnly ? "Escena vacía: falta cargar su imagen de Flow" : "Sin clip para esta escena"}
                </p>
              )}

              {overlays?.enabled && overlays.overlays.length > 0 && (
                <Suspense fallback={null}>
                  <OverlayLayer data={overlays} currentTime={currentTime} isPlaying={isPlaying} playbackRate={playbackRate} />
                </Suspense>
              )}

              {/* Preview de los subtitulos que van a quedar quemados en el
                  render final (ver render_video.tool.ts) -- mismo texto y
                  timing, solo que acá es una capa HTML en vez de pixeles. */}
              {activeCaption && (
                <div
                  className="absolute left-0 right-0 flex justify-center px-6 pointer-events-none"
                  style={{ bottom: "8%" }}
                >
                  <span
                    className="text-center text-sm font-semibold px-3 py-1.5 rounded-md"
                    style={{ color: "#fff", background: "rgba(0,0,0,0.6)", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
                  >
                    {activeCaption.text}
                  </span>
                </div>
              )}

              {/* Boton de play grande centrado -- mismo patron que el
                  reproductor del video final (PreviewPanel), solo visible en
                  pausa. */}
              {audioAsset && !isPlaying && (
                <button
                  onClick={handleTogglePlay}
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.2)" }}
                  aria-label="Reproducir"
                >
                  <span
                    className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                    style={{ background: "rgba(227,11,16,0.9)", boxShadow: "0 8px 32px rgba(227,11,16,0.5)" }}
                  >
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 3 }}>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </button>
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
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 xl:px-6 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={handleTogglePlay}
                disabled={!audioAsset}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-opacity disabled:opacity-40"
                style={{ background: "rgba(227,11,16,0.15)", border: "1px solid rgba(227,11,16,0.3)" }}
              >
                {isPlaying ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="#FFB3B4"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="#FFB3B4" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
              <span className="text-xs font-mono whitespace-nowrap" style={{ color: "var(--muted-foreground)" }}>
                {formatSeconds(currentTime)} / {formatSeconds(totalDuration)}
              </span>

              <div className="relative">
                <button
                  onClick={() => setShowRateMenu((v) => !v)}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--foreground)" }}
                >
                  {playbackRate}x
                </button>
                {showRateMenu && (
                  <div
                    className="absolute bottom-full left-0 mb-1.5 rounded-lg overflow-hidden py-1 z-10"
                    style={{ background: "rgba(22,10,11,0.97)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    {PLAYBACK_RATES.map((rate) => (
                      <button
                        key={rate}
                        onClick={() => handleChangeRate(rate)}
                        className="block w-full text-xs px-4 py-1.5 text-left whitespace-nowrap"
                        style={{ color: rate === playbackRate ? "#FF8A8D" : "rgba(255,255,255,0.85)" }}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

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
              {missingFlowImages ? (
                <span className="text-[11px] max-w-[220px] text-right leading-snug" style={{ color: "var(--muted-foreground)" }}>
                  Cargá las imágenes de Flow para poder renderizar.
                </span>
              ) : renderHint && (
                <span
                  className="text-[11px] max-w-[220px] text-right leading-snug"
                  style={{ color: noCredits ? "rgba(252,165,165,0.95)" : "var(--muted-foreground)" }}
                >
                  {renderHint}
                </span>
              )}
              <button
                onClick={handleApprove}
                disabled={approving || regenerating || noCredits || missingFlowImages}
                title={noCredits ? "Se terminaron tus videos" : missingFlowImages ? "Todavía no hay imágenes cargadas" : undefined}
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

          {/* Scrubbing temporal global: solo waveform, ya no mezcla miniaturas
              de escena (ver diagnostico en mejoras-interfaz-preview-scalertool.md). */}
          <div className="px-4 xl:px-6 pb-5" style={{ background: "rgba(0,0,0,0.15)" }}>
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
                    style={{ left: `${(currentTime / totalDuration) * 100}%`, background: "#FF8A8D", boxShadow: "0 0 6px rgba(255,138,141,0.8)" }}
                  />
                  {/* Marcadores de limite de escena -- referencia liviana, no
                      son clickeables por si (el click va a handleWaveformClick). */}
                  {scenes.map((scene) => (
                    <div
                      key={scene.id}
                      className="absolute top-3 pointer-events-none"
                      style={{
                        left: `${(sceneStart(scene) / totalDuration) * 100}%`,
                        width: 1,
                        height: 48,
                        background: "rgba(255,255,255,0.14)",
                      }}
                    />
                  ))}

                  <div
                    className="flex items-end gap-[2px] rounded-md px-2"
                    style={{ height: 48, background: "rgba(227,11,16,0.08)", border: "1px solid rgba(227,11,16,0.15)" }}
                  >
                    {Array.from({ length: WAVEFORM_BAR_COUNT }).map((_, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-full"
                        style={{ height: `${waveformHeight(i)}%`, background: "rgba(255,138,141,0.55)", minWidth: 1 }}
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
          replacingSceneIds={replacingSceneIds}
          onSelectScene={handleSelectScene}
          onReplace={handleOpenReplace}
        />
      </div>

      {replacingScene && (
        <SceneReplaceModal
          scene={replacingScene}
          currentAssets={assets.filter((a) => a.sceneId === replacingScene.id)}
          onClose={() => setReplacingScene(null)}
          onSubmit={handleReplaceSubmit}
        />
      )}
    </div>
  );
}
