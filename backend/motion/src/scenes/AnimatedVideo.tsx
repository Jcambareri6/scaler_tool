import "../fonts";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { resolveTheme } from "../theme";
import { Canvas } from "./Canvas";
import { Captions } from "./Captions";
import { DocNav } from "./DocNav";
import { DOC_PALETTE } from "./palette";
import { fechasEnSpec } from "../lib/fechas";
import { SCENE_OVERLAP, SceneView } from "./Scene";
import type { AnimatedVideoProps } from "./types";

// El video entero del formato todo animado: lienzo, escenas (cada una en su
// Sequence), capa fija de navegacion y subtitulos. A diferencia de los
// graficos sueltos del formato stock, aca se renderiza cada cuadro del video.
export function AnimatedVideo({ scenes, components, locale, nav, captions, audioSrc }: AnimatedVideoProps) {
  const { fps } = useVideoConfig();
  // Paleta fija del formato documental: se ignora la del nicho (props.theme),
  // porque aca los colores tienen significado (ver scenes/palette.ts).
  const palette = DOC_PALETTE;
  const theme = resolveTheme(palette);
  const frames = (seconds: number) => Math.max(1, Math.round(seconds * fps));

  return (
    <AbsoluteFill>
      <Canvas theme={theme} />
      {audioSrc && <Audio src={audioSrc} />}
      {scenes.map((scene) => (
        <Sequence key={scene.id} from={Math.round(scene.start * fps)} durationInFrames={frames(scene.end - scene.start) + SCENE_OVERLAP}>
          <SceneView scene={scene} components={components} theme={theme} palette={palette} locale={locale} />
        </Sequence>
      ))}
      {/* Linea de capitulo propia del formato: sin sombra, color segun el fondo. */}
      {nav && nav.length > 0 && <DocNav nav={nav.map((n) => ({ ...n, spec: fechasEnSpec(n.spec) }))} scenes={scenes} />}
      {captions && captions.length > 0 && <Captions chunks={captions} theme={theme} scenes={scenes} />}
    </AbsoluteFill>
  );
}
