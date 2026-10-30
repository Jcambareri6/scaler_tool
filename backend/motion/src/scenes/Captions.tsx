import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme";
import type { CaptionChunk } from "./types";

// Subtitulos palabra por palabra dentro del video (en el formato animado los
// dibuja Remotion, no ffmpeg): mismo estilo que el .ass del formato stock
// (backend lib/captions.ts) -- blanco en negrita y la palabra que se dice en
// el acento.
export function Captions({ chunks, theme }: { chunks: CaptionChunk[]; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const chunk = chunks.find((c) => t >= c.start && t < c.end);
  if (!chunk) return null;
  const s = height / 1080;

  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 80 * s, display: "flex", justifyContent: "center", padding: `0 ${160 * s}px` }}>
      <div
        style={{
          textAlign: "center",
          fontFamily: theme.fontSans,
          fontWeight: 800,
          fontSize: 58 * s,
          lineHeight: 1.15,
          color: "#fff",
          textShadow: `0 0 ${4 * s}px #000, 0 0 ${4 * s}px #000, 0 ${3 * s}px ${3 * s}px rgba(0,0,0,0.6)`,
        }}
      >
        {chunk.words.map((w, i) => {
          const next = chunk.words[i + 1];
          const on = t >= w.start && (!next || t < next.start);
          return (
            <span key={i} style={on ? { color: theme.accent } : undefined}>
              {i > 0 ? " " : ""}
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
