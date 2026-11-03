import { Easing, interpolate } from "remotion";
import { DOC } from "../scenes/palette";
import type { Momento, Recurso, Significado } from "./tipos";

// Piezas comunes de los recursos: las 3 curvas de tiempo del estilo, colores
// por significado y busqueda de momentos. Coordenadas en un lienzo de
// 1920x1080 (el SVG escala al tamano del video).

export const ANCHO = 1920;
export const ALTO = 1080;
export const SUELO = 780;

// Entrada estandar: 0,45 s con frenado suave.
export const entra = (t: number, at: number | undefined, dur = 0.45) =>
  at === undefined ? 0 : interpolate(t, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

// Remate: golpe seco de 0,25 s, sin rebote.
export const golpe = (t: number, at: number | undefined, dur = 0.25) =>
  at === undefined ? 0 : interpolate(t, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.exp) });

// Pieza que se mueve: acelera y frena.
export const mecanismo = (t: number, at: number | undefined, dur: number) =>
  at === undefined ? 0 : interpolate(t, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function mezcla(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const r = pa.map((v, i) => Math.round(lerp(v, pb[i]!, k)));
  return `rgb(${r[0]},${r[1]},${r[2]})`;
}

// Tinta del esquema sobre fondo claro (medida en la referencia).
export const T = {
  tinta: "#1A2028",
  linea: "#2A3340",
  relleno: "#D5DCE3",
  rellenoSuave: "#DFE5EB",
  gris: "#8A96A3",
  texto: "#3A4552",
  dato2: "#F0C050",
};

export function colorDe(sig: Significado | undefined, claro: boolean): string {
  if (sig === "seguro") return DOC.seguro;
  if (sig === "peligro") return DOC.peligro;
  if (sig === "foco") return DOC.foco;
  return claro ? T.tinta : DOC.tintaOscuro;
}

export const momentos = (rec: Recurso, hace: string) => rec.momentos.filter((m) => m.hace === hace).sort((a, b) => a.at - b.at);
export const momento = (rec: Recurso, hace: string, filtro?: (m: Momento) => boolean) => momentos(rec, hace).find((m) => !filtro || filtro(m));
// Segundo del remate (la palabra del giro), si hay.
export const remateAt = (rec: Recurso) => rec.momentos.find((m) => m.remate)?.at;
