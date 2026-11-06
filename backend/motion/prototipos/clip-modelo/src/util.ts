import { Easing, interpolate } from 'remotion';

export const FPS = 30;

// Entrada estándar: 0,45 s con frenado suave.
export const entra = (t: number, at: number, dur = 0.45) =>
  interpolate(t, [at, at + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

// Remate: golpe seco de 0,25 s, sin rebote.
export const golpe = (t: number, at: number, dur = 0.25) =>
  interpolate(t, [at, at + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.exp),
  });

// Movimiento de mecanismo: acelera y frena.
export const mecanismo = (t: number, at: number, dur: number) =>
  interpolate(t, [at, at + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// Mezcla de colores hex.
export const mezcla = (a: string, b: string, k: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const r = pa.map((v, i) => Math.round(lerp(v, pb[i], k)));
  return `rgb(${r[0]},${r[1]},${r[2]})`;
};
