import type { PaletteTheme } from "./theme";
// Contrato entre el backend (OverlaySpec en typeShared.ts) y los
// componentes. Mismo shape: `text`/`label`/`items` salen literales del guion.
export interface OverlayItem {
  label: string;
  text: string;
}

export interface OverlaySpec {
  type: string;
  text: string;
  label?: string;
  items?: OverlayItem[];
  // title_card: numero de capitulo y fraccion del video (0-1) en que
  // arranca; los calcula placeOverlays en el backend.
  chapter?: number;
  progress?: number;
  // scale_compare: clave de lib/icons.ts (lista en catalog.json "icons").
  icon?: string;
  // Mapas: coordenada del lugar (`text`) y, en map_marker, un segundo lugar
  // de referencia. No se muestran como texto: solo ubican el mapa.
  geo?: GeoPoint;
  ref?: GeoPoint & { name: string };
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface OverlayProps {
  spec: OverlaySpec;
  // Nombre de tema ("documental") o la paleta del canal/nicho (theme.ts).
  theme?: string | PaletteTheme;
  // Duracion total en pantalla (preview/editor). Al renderizar para el
  // video final solo se genera la entrada (ver catalog.ts) y `exit` va en
  // false: la salida la hace ffmpeg.
  durationSeconds: number;
  exit?: boolean;
  // Formato de las cifras ("es-AR" -> 1.500,5; "en-US" -> 1,500.5).
  locale?: string;
  width?: number;
  height?: number;
  // Necesario para que <Composition> acepte los props (Record<string, unknown>).
  [key: string]: unknown;
}
