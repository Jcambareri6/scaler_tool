import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme";
import { DOC } from "./palette";
import type { AnimatedScene, CaptionChunk } from "./types";

// Subtitulos del formato documental (estilo de la referencia): abajo al
// centro, chicos y sin caja; el tramo crece palabra por palabra con la voz y
// la palabra que se dice va en azul subrayada. El color sigue al fondo de la
// escena (tinta oscura sobre claro, gris claro sobre oscuro).
export function Captions({ chunks, theme, scenes }: { chunks: CaptionChunk[]; theme: Theme; scenes?: AnimatedScene[] }) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const chunk = chunks.find((c) => t >= c.start && t < c.end);
  if (!chunk) return null;
  const s = height / 1080;
  const scene = scenes?.find((sc) => t >= sc.start && t < sc.end);
  const light = scene?.background === "light";
  const visibles = chunk.words.filter((w) => w.start <= t);
  if (visibles.length === 0) return null;

  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64 * s, display: "flex", justifyContent: "center", padding: `0 ${200 * s}px` }}>
      <div
        style={{
          textAlign: "center",
          fontFamily: theme.fontSans,
          fontWeight: 500,
          fontSize: 38 * s,
          lineHeight: 1.25,
          letterSpacing: 0.2 * s,
          color: light ? "#3A4552" : "#C9D3DE",
        }}
      >
        {visibles.map((w, i) => {
          const actual = i === visibles.length - 1;
          return (
            <span
              key={i}
              style={
                actual
                  ? {
                      color: light ? DOC.resaltadoClaro : DOC.resaltadoOscuro,
                      textDecoration: "underline",
                      textUnderlineOffset: 6 * s,
                      textDecorationThickness: 2 * s,
                    }
                  : undefined
              }
            >
              {i > 0 ? " " : ""}
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
