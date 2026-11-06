import catalogJson from "../catalog.json";

// Fuente unica de que componentes existen: el backend lee el mismo
// catalog.json para que el planificador solo pida estos tipos.
// introSeconds = cuanto dura la animacion de entrada; despues el grafico
// queda quieto, asi que el render solo genera esos frames y ffmpeg congela
// el ultimo el resto del tiempo (y hace el fundido de salida).
// blur = cuanto se desenfoca el video de abajo mientras el grafico esta en
// pantalla (px a 1080p; 0 = nada). Lo aplica quien junta las capas: ffmpeg
// en el render (backend lib/motion.ts) y CSS en el preview del front.
export interface CatalogEntry {
  introSeconds: number;
  blur?: number;
}

export const FPS: number = catalogJson.fps;
export const CATALOG: Record<string, CatalogEntry> = catalogJson.components;
