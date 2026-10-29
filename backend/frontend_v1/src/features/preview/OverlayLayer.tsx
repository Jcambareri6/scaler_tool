import { useEffect, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Overlay } from "@motion/Overlay";
import { FPS } from "@motion/catalog";
import type { ProjectOverlays } from "@/types";

// Cuanto se tolera de desfase con el audio antes de re-sincronizar el
// grafico (timeupdate del <audio> llega ~4 veces por segundo).
const MAX_DRIFT_FRAMES = 6;

interface Props {
  data: ProjectOverlays;
  // Reloj maestro de StockReviewPanel (el <audio> narrado).
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
}

// Graficos animados de la revision de stock: los mismos componentes que
// dibuja el render (backend/motion, via @remotion/player), en los mismos
// segundos (placeOverlays del backend), encima del clip -- igual que los
// subtitulos de ese panel son una capa HTML sobre el video. placeOverlays
// garantiza que nunca hay dos a la vez, asi que alcanza con un Player.
export default function OverlayLayer({ data, currentTime, isPlaying, playbackRate }: Props) {
  const playerRef = useRef<PlayerRef>(null);
  const activeIndex = useMemo(
    () => data.overlays.findIndex((o) => currentTime >= o.start && currentTime < o.end),
    [data.overlays, currentTime]
  );
  const active = activeIndex >= 0 ? data.overlays[activeIndex]! : null;

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !active) return;
    const frame = Math.max(0, Math.round((currentTime - active.start) * FPS));
    if (isPlaying) {
      if (!player.isPlaying()) {
        player.seekTo(frame);
        player.play();
      } else if (Math.abs(player.getCurrentFrame() - frame) > MAX_DRIFT_FRAMES) {
        player.seekTo(frame);
      }
    } else {
      if (player.isPlaying()) player.pause();
      player.seekTo(frame);
    }
  }, [active, currentTime, isPlaying]);

  if (!data.enabled || !active) return null;

  const durationSeconds = active.end - active.start;
  return (
    <Player
      // Un Player por grafico: al cambiar arranca de cero, sin arrastrar
      // el estado del anterior.
      key={activeIndex}
      ref={playerRef}
      component={Overlay}
      inputProps={{ spec: active.spec, theme: data.theme, locale: data.locale, durationSeconds, exit: true }}
      durationInFrames={Math.max(1, Math.round(durationSeconds * FPS))}
      fps={FPS}
      compositionWidth={1920}
      compositionHeight={1080}
      playbackRate={playbackRate}
      controls={false}
      clickToPlay={false}
      acknowledgeRemotionLicense
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
