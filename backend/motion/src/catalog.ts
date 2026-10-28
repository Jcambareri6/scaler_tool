import catalogJson from "../catalog.json";

// Fuente unica de que componentes existen: el backend lee el mismo
// catalog.json para que el planificador solo pida estos tipos.
// introSeconds = cuanto dura la animacion de entrada; despues el grafico
// queda quieto, asi que el render solo genera esos frames y ffmpeg congela
// el ultimo el resto del tiempo (y hace el fundido de salida).
export interface CatalogEntry {
  introSeconds: number;
}

export const FPS: number = catalogJson.fps;
export const CATALOG: Record<string, CatalogEntry> = catalogJson.components;
