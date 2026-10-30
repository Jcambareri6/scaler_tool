import type { OverlaySpec } from "../spec";
import type { PaletteTheme } from "../theme";

// Formato todo animado (DISENO-director-graficos.md, "Diseño del modo todo
// animado"): no hay stock, Remotion dibuja el video entero. El video es una
// lista de ESCENAS; cada escena tiene elementos y PASOS atados a frases de
// la voz (segundos del video, con el timing de Whisper). Cada paso hace una
// sola cosa: mostrar, cambiar, resaltar, tachar u ocultar un elemento.
// Capas de cada cuadro: lienzo -> escena -> capa fija -> subtitulos.

// Zona de la pantalla donde se apila el elemento. "full" = ocupa todo el
// cuadro (los graficos del catalogo).
export type Slot = "top" | "center" | "left" | "right" | "bottom" | "full";

// Color de estado de un chip o tarjeta.
export type Tone = "neutral" | "accent" | "ok" | "alert";

export interface SceneElement {
  id: string;
  // title: titulo grande · text: frase · number: cifra que cuenta al cambiar
  // · chip: cartel de estado ("PARADO") · card: dato con etiqueta ·
  // graphic: cualquier grafico del catalogo (spec), a pantalla completa.
  kind: "title" | "text" | "number" | "chip" | "card" | "graphic";
  slot: Slot;
  text?: string;
  // number: la cifra ("4.300 metros"); card: el valor.
  value?: string;
  // card y number: que es (etiqueta chica).
  label?: string;
  tone?: Tone;
  spec?: OverlaySpec;
}

export interface SceneStep {
  // Segundo del video (no de la escena) en que pasa.
  at: number;
  action: "show" | "set" | "highlight" | "strike" | "hide";
  target: string;
  // "set": lo que cambia.
  text?: string;
  value?: string;
  tone?: Tone;
}

export interface AnimatedScene {
  id: string;
  start: number;
  end: number;
  elements: SceneElement[];
  steps: SceneStep[];
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionChunk {
  start: number;
  end: number;
  words: CaptionWord[];
}

export interface TimedSpec {
  start: number;
  end: number;
  spec: OverlaySpec;
}

export interface AnimatedVideoProps {
  scenes: AnimatedScene[];
  theme?: string | PaletteTheme;
  locale?: string;
  // Capa fija de navegacion (nav_header, placeNavHeaders del backend).
  nav?: TimedSpec[];
  // Subtitulos palabra por palabra ya cortados en tramos (lib/captions).
  captions?: CaptionChunk[];
  durationSeconds: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}
