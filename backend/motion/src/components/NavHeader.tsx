import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";

// Capa fija de navegacion (Ciencia y Vida, Como Funciona El Mundo): una
// linea arriba durante todo el tramo. A la izquierda canal · tema (`text`),
// a la derecha donde estamos (`label`: "CAPÍTULO 2 DE 4 · LA CASA LARGA",
// "CASO 1 DE 6", "PRÓLOGO"). No la planifica el LLM: la arma placeNavHeaders
// en el backend, un tramo por capitulo. El de la derecha se escribe letra a
// letra al cambiar de capitulo.
export function NavHeader({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, frame, enter, exit } = useMotion(withExit);
  const t = enter(0, 14);
  const label = spec.label ?? "";
  const typed = label.slice(0, Math.max(0, Math.floor((frame - 4) * 1.6)));

  const textStyle = {
    fontFamily: theme.fontSans,
    fontWeight: 600,
    fontSize: 21 * s,
    letterSpacing: 3.5 * s,
    textTransform: "uppercase" as const,
    textShadow: TEXT_SHADOW,
    whiteSpace: "nowrap" as const,
  };

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Sombra arriba para que la linea se lea sobre cualquier stock. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          height: 150 * s,
          background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)",
          opacity: t,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 64 * s,
          right: 64 * s,
          top: 40 * s,
          display: "flex",
          justifyContent: "space-between",
          gap: 40 * s,
          opacity: t,
          transform: `translateY(${(1 - t) * -12 * s}px)`,
        }}
      >
        <div style={{ ...textStyle, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis" }}>{spec.text}</div>
        {label && (
          <div style={{ ...textStyle, color: theme.text, display: "flex", alignItems: "center", gap: 12 * s }}>
            <span
              style={{
                width: 10 * s,
                height: 10 * s,
                borderRadius: "50%",
                background: theme.accent,
                boxShadow: `0 0 ${10 * s}px ${theme.accent}`,
              }}
            />
            <span>{typed}</span>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
