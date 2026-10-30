import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";

const MAX_LAYERS = 6;
const LAYER_STAGGER = 8;

// Corte por capas (terremoto del Tibet: corteza / manto / raiz con medidas):
// un bloque en corte con las capas de arriba hacia abajo, que aparecen de a
// una, y a la derecha de cada una su nombre (`items[].text`) y su medida
// (`items[].label`, opcional) con una cota. Sirve para cualquier cosa por
// capas: la Tierra, la atmosfera, el oceano, la piel. `text` = titulo.
export function LayersDiagram({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, width, enter, draw, exit } = useMotion(withExit);
  const layers = (spec.items ?? []).slice(0, MAX_LAYERS);
  if (layers.length < 2) return null;

  const blockWidth = 640 * s;
  const blockHeight = 620 * s;
  const bandHeight = blockHeight / layers.length;
  const left = width * 0.16;
  const top = 250 * s;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.55)", opacity: enter(0) }} />
      <div style={{ position: "absolute", left, top: 120 * s, fontFamily: theme.fontSans, fontWeight: 800, fontSize: 46 * s, textTransform: "uppercase", letterSpacing: 2 * s, color: theme.text, textShadow: TEXT_SHADOW, opacity: enter(0) }}>
        {spec.text}
      </div>
      {layers.map((layer, i) => {
        const delay = 6 + i * LAYER_STAGGER;
        const t = enter(delay, 14);
        // De claro (arriba) a oscuro (abajo), todo en el acento.
        const shade = 0.85 - (0.6 * i) / Math.max(1, layers.length - 1);
        const y = top + i * bandHeight;
        return (
          <div key={i}>
            <div
              style={{
                position: "absolute",
                left,
                top: y,
                width: blockWidth,
                height: bandHeight,
                background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent}cc)`,
                filter: `brightness(${shade})`,
                borderTop: i === 0 ? "none" : "2px solid rgba(0,0,0,0.35)",
                transform: `scaleX(${t})`,
                transformOrigin: "left",
              }}
            />
            {/* Cota: linea horizontal hasta el texto y marca vertical del espesor. */}
            <div style={{ position: "absolute", left: left + blockWidth + 20 * s, top: y + bandHeight / 2, width: 70 * s, height: 2 * s, background: theme.textMuted, transform: `scaleX(${draw(delay + 8, delay + 16)})`, transformOrigin: "left" }} />
            <div style={{ position: "absolute", left: left + blockWidth + 20 * s, top: y + 6 * s, width: 2 * s, height: bandHeight - 12 * s, background: "rgba(255,255,255,0.35)", opacity: draw(delay + 8, delay + 16) }} />
            <div
              style={{
                position: "absolute",
                left: left + blockWidth + 110 * s,
                top: y + bandHeight / 2,
                transform: `translateY(-50%) translateX(${(1 - enter(delay + 10)) * -16 * s}px)`,
                opacity: enter(delay + 10),
                whiteSpace: "nowrap",
              }}
            >
              <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 44 * s, color: theme.text, textShadow: TEXT_SHADOW }}>{layer.text}</div>
              {layer.label && (
                <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 30 * s, letterSpacing: 2 * s, color: theme.accent, textShadow: TEXT_SHADOW }}>{layer.label}</div>
              )}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
