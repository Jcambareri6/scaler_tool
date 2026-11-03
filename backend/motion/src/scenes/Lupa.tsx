import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useVideoConfig } from "remotion";
import { DOC } from "./palette";
import type { AnimatedScene, SceneElement } from "./types";

// Lupa del formato documental: el detalle se muestra en un circulo con el
// dibujo ampliado, unido al objeto por una linea punteada. El encuadre no se
// mueve nunca (la referencia casi no usa camara). Reemplaza a los pasos
// "camera": un acercamiento (zoom > 1) abre la lupa sobre su elemento y una
// vuelta al plano general (zoom <= 1) la cierra. Los agentes no cambian.

const ENTER_SECONDS = 0.4;
const EXIT_SECONDS = 0.3;

export interface LupaState {
  target: SceneElement;
  openAt: number;
  closeAt: number | null;
  zoom: number;
}

// Lupa abierta en el segundo t (la ultima que se abrio), o null.
export function lupaAt(scene: AnimatedScene, t: number): LupaState | null {
  const cameras = scene.steps.filter((st) => st.action === "camera" && st.at <= t).sort((a, b) => a.at - b.at);
  let lupa: LupaState | null = null;
  for (const st of cameras) {
    const zoom = st.zoom ?? 1;
    if (zoom > 1) {
      const target = scene.elements.find((e) => e.id === st.target);
      if (target && target.kind === "drawing") lupa = { target, openAt: st.at, closeAt: null, zoom };
    } else if (lupa && lupa.closeAt === null) {
      lupa.closeAt = st.at;
    }
  }
  if (lupa?.closeAt !== null && lupa && t > lupa.closeAt + EXIT_SECONDS) return null;
  return lupa;
}

// Caja de un dibujo en pixeles (centro x/y y ancho w en % del cuadro).
export interface Caja {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function Lupa({ lupa, t, light, cajas, children }: { lupa: LupaState; t: number; light: boolean; cajas: Caja[]; children: ReactNode }) {
  const { width: W, height: H } = useVideoConfig();
  const s = H / 1080;
  const enter = interpolate(t - lupa.openAt, [0, ENTER_SECONDS], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exit = lupa.closeAt === null ? 1 : interpolate(t - lupa.closeAt, [0, EXIT_SECONDS], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = enter * exit;
  if (opacity <= 0.001) return null;

  // Objeto ampliado y lugar de la lupa: se prueban arriba, derecha, izquierda
  // y abajo del objeto; gana el primero que entra en el cuadro (lejos del
  // titulo y del subtitulo) y no tapa ningun dibujo. Si ninguno, el que menos tapa.
  const tx = ((lupa.target.x ?? 50) / 100) * W;
  const ty = ((lupa.target.y ?? 50) / 100) * H;
  const R = 0.15 * H;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const gap = R * 1.25;
  const lejos = (b: Caja) => Math.max(gap, (b.x1 - b.x0) / 2 + R * 0.4);
  const propia = cajas.find((b) => tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1);
  const alto = propia ? (propia.y1 - propia.y0) / 2 + R * 0.6 : gap;
  const ancho = propia ? lejos(propia) + R * 0.3 : gap;
  const candidatos: [number, number][] = [
    [tx, ty - alto - R * 0.4],
    [tx + ancho + R * 0.4, ty],
    [tx - ancho - R * 0.4, ty],
    [tx, ty + alto + R * 0.4],
  ];
  const dentro = ([x, y]: [number, number]) => x - R >= 0.03 * W && x + R <= 0.97 * W && y - R >= 0.1 * H && y + R <= 0.84 * H;
  const tapa = ([x, y]: [number, number]) =>
    cajas.reduce((sum, b) => sum + Math.max(0, Math.min(x + R, b.x1) - Math.max(x - R, b.x0)) * Math.max(0, Math.min(y + R, b.y1) - Math.max(y - R, b.y0)), 0);
  const ordenados = candidatos
    .map((c) => [clamp(c[0], R + 0.03 * W, 0.97 * W - R), clamp(c[1], R + 0.1 * H, 0.84 * H - R)] as [number, number])
    .map((c, i) => ({ c, i, ok: dentro(c), area: tapa(c) }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.area - b.area || a.i - b.i);
  const [lx, ly] = ordenados[0]!.c;
  const k = clamp(lupa.zoom * 1.8, 1.8, 3);
  const grow = 0.85 + 0.15 * enter;

  // Linea punteada del objeto al borde de la lupa.
  const dx = tx - lx;
  const dy = ty - ly;
  const dist = Math.hypot(dx, dy) || 1;
  const ex = lx + (dx / dist) * R;
  const ey = ly + (dy / dist) * R;
  const ink = light ? DOC.tintaClaro : DOC.tintaOscuro;

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <line x1={tx} y1={ty} x2={ex} y2={ey} stroke={ink} strokeWidth={2 * s} strokeDasharray={`${6 * s} ${6 * s}`} opacity={0.7} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: lx - R,
          top: ly - R,
          width: 2 * R,
          height: 2 * R,
          borderRadius: "50%",
          background: light ? "#FFFFFF" : "#0B1424",
          boxShadow: `0 ${6 * s}px ${24 * s}px rgba(0,0,0,0.25)`,
          transform: `scale(${grow})`,
        }}
      />
      <AbsoluteFill style={{ clipPath: `circle(${(R - 2 * s) * grow}px at ${lx}px ${ly}px)` }}>
        <AbsoluteFill style={{ transform: `translate(${lx - tx}px, ${ly - ty}px) scale(${k})`, transformOrigin: `${tx}px ${ty}px` }}>{children}</AbsoluteFill>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: lx - R,
          top: ly - R,
          width: 2 * R,
          height: 2 * R,
          borderRadius: "50%",
          border: `${3 * s}px solid ${ink}`,
          boxSizing: "border-box",
          transform: `scale(${grow})`,
        }}
      />
    </AbsoluteFill>
  );
}
