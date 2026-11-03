import { useEffect, useState } from "react";
import { Player } from "@remotion/player";
import { AnimatedVideo } from "@motion/scenes/AnimatedVideo";
import { FPS } from "@motion/catalog";
import type { AnimatedVideoProps } from "@motion/scenes/types";
import { projectsService } from "@/services/projects.service";
import type { Job } from "@/types";

interface Props {
  projectId: string;
  jobId: string;
  onApproved: (job: Job) => void;
}

// Formato todo animado: el video completo en vivo antes de renderizar, con los
// mismos componentes que dibuja el render (backend/motion) y la voz real.
export default function AnimatedPreview({ projectId, jobId, onApproved }: Props) {
  const [video, setVideo] = useState<AnimatedVideoProps | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsService
      .getOverlays(projectId)
      .then(({ animated, theme, locale }) => {
        if (animated) setVideo({ ...animated, theme, locale, audioSrc: animated.audioSrc ?? undefined } as AnimatedVideoProps);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

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

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
      {video ? (
        <div className="w-full max-w-4xl rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <Player
            component={AnimatedVideo}
            inputProps={video}
            durationInFrames={Math.max(1, Math.round(video.durationSeconds * FPS))}
            fps={FPS}
            compositionWidth={1920}
            compositionHeight={1080}
            style={{ width: "100%" }}
            controls
            acknowledgeRemotionLicense
          />
        </div>
      ) : (
        <p className="text-sm" style={{ color: "#FF8A8D" }}>Este proyecto no tiene escenas animadas: generá el video de nuevo.</p>
      )}
      <button
        type="button"
        disabled={!video || approving}
        className="px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
        style={{ background: "#E30B10", color: "#fff" }}
        onClick={approve}
      >
        Renderizar video
      </button>
      {error && <p className="text-xs" style={{ color: "#FF8A8D" }}>{error}</p>}
    </div>
  );
}
