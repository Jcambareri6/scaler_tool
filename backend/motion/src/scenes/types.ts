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
  // graphic: cualquier grafico del catalogo (spec), a pantalla completa ·
  // drawing: un componente dibujado (ver Drawing.tsx) · label: etiqueta chica
  // pegada a un dibujo.
  kind: "title" | "text" | "number" | "chip" | "card" | "graphic" | "drawing" | "label";
  slot: Slot;
  text?: string;
  // number: la cifra ("4.300 metros"); card: el valor.
  value?: string;
  // card y number: que es (etiqueta chica).
  label?: string;
  tone?: Tone;
  spec?: OverlaySpec;
  // drawing: id del componente. drawing y label: centro y ancho en % del cuadro.
  component?: string;
  x?: number;
  y?: number;
  w?: number;
  // drawing: ejemplares en grilla (pictograma).
  repeat?: { count: number; columns: number };
}

// Un dibujo de la biblioteca del video: SVG con partes nombradas (data-part).
export interface DrawingComponent {
  id: string;
  name: string;
  width: number;
  height: number;
  svg: string;
  parts: Record<string, string | null>;
}

export interface SceneStep {
  // Segundo del video (no de la escena) en que pasa.
  at: number;
  action: "show" | "set" | "highlight" | "strike" | "hide" | "move" | "rotate" | "scale" | "paint" | "loop" | "act" | "camera";
  target: string;
  // camera: acercamiento hacia el elemento (1 = plano general).
  zoom?: number;
  // act: accion de un personaje con esqueleto (ver Drawing.tsx).
  act?: "walk" | "run" | "press" | "push" | "point" | "look" | "recoil" | "fall";
  // Dibujos: parte del componente y ejemplares a los que aplica; stagger =
  // segundos entre un ejemplar y el siguiente; duration = cuanto tarda.
  part?: string;
  from_index?: number;
  to_index?: number;
  stagger?: number;
  duration?: number;
  // move: en % del tamano del componente. rotate: grados. scale: factor.
  dx?: number;
  dy?: number;
  deg?: number;
  factor?: number;
  // loop: movimiento continuo desde ese momento.
  loop?: "spin" | "float" | "shake" | "pulse";
  // "set": lo que cambia.
  text?: string;
  value?: string;
  tone?: Tone;
}

export interface AnimatedScene {
  id: string;
  start: number;
  end: number;
  // Lienzo: claro para escenas fisicas, oscuro para datos (por defecto oscuro).
  background?: "light" | "dark";
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
  // Biblioteca visual de este video.
  components?: Record<string, DrawingComponent>;
  theme?: string | PaletteTheme;
  locale?: string;
  // Capa fija de navegacion (nav_header, placeNavHeaders del backend).
  nav?: TimedSpec[];
  // Subtitulos palabra por palabra ya cortados en tramos (lib/captions).
  captions?: CaptionChunk[];
  // Narracion (URL publica); el video se renderiza con la voz.
  audioSrc?: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}
