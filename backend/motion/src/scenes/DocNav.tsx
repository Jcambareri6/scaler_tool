import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { DOC } from "./palette";
import type { AnimatedScene, TimedSpec } from "./types";

// Linea de capitulo del formato documental (referencia: chica, sin caja ni
// sombra): tema arriba a la izquierda, "CAPITULO · NOMBRE" arriba a la derecha
// con el punto azul. El color sigue al fondo de la escena.
export function DocNav({ nav, scenes }: { nav: TimedSpec[]; scenes: AnimatedScene[] }) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const n = nav.find((x) => t >= x.start && t < x.end);
  if (!n) return null;
  const s = height / 1080;
  const scene = scenes.find((sc) => t >= sc.start && t < sc.end);
  const claro = scene?.recurso ? (scene.recurso.fondo ?? (scene.recurso.tipo === "esquema_capas" ? "claro" : "oscuro")) === "claro" : scene?.background === "light";
  const k = interpolate(t - n.start, [0, 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const color = claro ? "rgba(58,69,82,0.7)" : "rgba(201,211,222,0.7)";
  const base = { fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 19 * s, letterSpacing: 2.5 * s, textTransform: "uppercase" as const, whiteSpace: "nowrap" as const };
  return (
    <div style={{ position: "absolute", left: 48 * s, right: 48 * s, top: 30 * s, display: "flex", justifyContent: "space-between", opacity: k }}>
      <div style={{ ...base, color }}>{n.spec.text}</div>
      {n.spec.label && (
        <div style={{ ...base, color }}>
          <span style={{ color: claro ? DOC.resaltadoClaro : DOC.resaltadoOscuro }}>● </span>
          {n.spec.label}
        </div>
      )}
    </div>
  );
}
