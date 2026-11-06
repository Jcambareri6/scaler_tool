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
  // En una escena clara el agua es celeste: el texto claro no se leia ahi
  // (s8, s23 del Titanic), asi que va tinta oscura con halo blanco tambien en el mar.
  const light = scene?.recurso ? (scene.recurso.fondo ?? (scene.recurso.tipo === "esquema_capas" || scene.recurso.tipo === "leccion" ? "claro" : "oscuro")) === "claro" : scene?.background === "light";
  const visibles = chunk.words.filter((w) => w.start <= t);
  if (visibles.length === 0) return null;

  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64 * s, display: "flex", justifyContent: "center", padding: `0 ${200 * s}px` }}>
      <div
        style={{
          textAlign: "center",
          fontFamily: theme.fontSans,
          fontWeight: 500,
          fontSize: 44 * s,
          lineHeight: 1.25,
          letterSpacing: 0.2 * s,
          color: light ? DOC.tintaClaro : "#E1E8EF",
          textShadow: light ? `0 0 ${6 * s}px rgba(255,255,255,0.95), 0 0 ${14 * s}px rgba(255,255,255,0.85)` : `0 ${2 * s}px ${10 * s}px rgba(0,0,0,0.75)`,
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
                      // En claro la palabra azul se perdia sobre el agua celeste: tinta
                      // oscura y el azul queda en el subrayado.
                      color: light ? DOC.tintaClaro : DOC.resaltadoOscuro,
                      fontWeight: light ? 700 : undefined,
                      textDecoration: "underline",
                      textDecorationColor: light ? DOC.resaltadoClaro : undefined,
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
