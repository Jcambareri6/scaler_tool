import "../fonts";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { Overlay } from "../Overlay";
import { resolveTheme } from "../theme";
import { Canvas } from "./Canvas";
import { Captions } from "./Captions";
import { SceneView } from "./Scene";
import type { AnimatedVideoProps } from "./types";

// El video entero del formato todo animado: lienzo, escenas (cada una en su
// Sequence), capa fija de navegacion y subtitulos. A diferencia de los
// graficos sueltos del formato stock, aca se renderiza cada cuadro del video.
export function AnimatedVideo({ scenes, theme: palette, locale, nav, captions, audioSrc }: AnimatedVideoProps) {
  const { fps } = useVideoConfig();
  const theme = resolveTheme(palette);
  const frames = (seconds: number) => Math.max(1, Math.round(seconds * fps));

  return (
    <AbsoluteFill>
      <Canvas theme={theme} />
      {audioSrc && <Audio src={audioSrc} />}
      {scenes.map((scene) => (
        <Sequence key={scene.id} from={Math.round(scene.start * fps)} durationInFrames={frames(scene.end - scene.start)}>
          <SceneView scene={scene} theme={theme} palette={palette} locale={locale} />
        </Sequence>
      ))}
      {(nav ?? []).map((n, i) => (
        <Sequence key={`nav-${i}`} from={Math.round(n.start * fps)} durationInFrames={frames(n.end - n.start)} layout="none">
          <Overlay spec={n.spec} theme={palette} locale={locale} durationSeconds={n.end - n.start} exit />
        </Sequence>
      ))}
      {captions && captions.length > 0 && <Captions chunks={captions} theme={theme} />}
    </AbsoluteFill>
  );
}
