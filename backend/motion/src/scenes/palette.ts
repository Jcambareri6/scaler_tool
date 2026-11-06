import type { PaletteTheme, Theme } from "../theme";
import type { Tone } from "./types";

// Paleta fija del formato documental animado (docs/formato-documental/INFORME.md).
// Los colores tienen significado y no los elige la IA ni el nicho:
//   rojo = peligro, verde = seguro, naranja = foco (lo que se mira),
//   azul SOLO para el texto resaltado.
// Los objetos van en tinta neutra segun el fondo de la escena.
export const DOC = {
  peligro: "#E85030",
  seguro: "#2EB872",
  foco: "#F29A3A", // personaje u objeto en foco: contrasta en fondo claro y oscuro
  resaltadoClaro: "#0068B0", // texto resaltado sobre fondo claro
  resaltadoOscuro: "#4DA3E0", // texto resaltado sobre fondo oscuro
  tintaClaro: "#1A2028", // objetos y texto sobre fondo claro
  tintaOscuro: "#E6ECF2", // objetos y texto sobre fondo oscuro
  apagadoClaro: "rgba(26,32,40,0.62)",
  apagadoOscuro: "rgba(230,236,242,0.72)",
  fondoOscuro: "#050A14",
};

// Tema del formato segun el fondo de la escena. `accent` queda solo para el
// texto resaltado (subtitulo, highlight); los objetos usan `text`.
export function docTheme(base: Theme, light: boolean): Theme {
  return {
    ...base,
    accent: light ? DOC.resaltadoClaro : DOC.resaltadoOscuro,
    text: light ? DOC.tintaClaro : DOC.tintaOscuro,
    textMuted: light ? DOC.apagadoClaro : DOC.apagadoOscuro,
    fontSerif: base.fontSans,
  };
}

// Paleta que reciben los graficos del catalogo y la capa fija (siempre sobre
// el lienzo oscuro del formato).
export const DOC_PALETTE: PaletteTheme = {
  accent: DOC.resaltadoOscuro,
  text: "#FFFFFF",
  textMuted: DOC.apagadoOscuro,
  scrim: "rgba(5,10,20,0.6)",
  titleFont: "sans",
};

// Color de un tono (chips, tarjetas, etiquetas y pintura de dibujos).
// "accent" es el foco (naranja), nunca azul; sin tono va la tinta del fondo.
export function toneColor(tone: Tone | undefined, theme: Theme): string {
  if (tone === "alert") return DOC.peligro;
  if (tone === "ok") return DOC.seguro;
  if (tone === "accent") return DOC.foco;
  if (tone === "neutral") return theme.textMuted;
  return theme.text;
}
