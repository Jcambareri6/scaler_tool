import { isAdmin } from "./accounts.js";

// Formatos de video (video_projects.video_format). El formato decide que hay
// de base en el video, no el nicho: el mismo formato sirve para cualquier
// tema.
// - "stock": stock o video con IA de base, con graficos animados opcionales
//   encima (overlays_enabled).
// - "animated": todo animado, sin stock: Remotion dibuja el video entero.
// - "documental": material real con licencia elegido plano a plano por el
//   montajista y el juez visual, con los graficos animados encima y el look
//   del estilo (lib/documentalStyles.ts).
// Para sumar un formato: agregarlo aca, al check de la migracion y al
// selector del front (PreviewPanel).
export const VIDEO_FORMATS = ["stock", "animated", "documental"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export function isVideoFormat(value: unknown): value is VideoFormat {
  return typeof value === "string" && (VIDEO_FORMATS as readonly string[]).includes(value);
}

// Los formatos nuevos son solo para admins mientras se prueban: para el
// resto cualquier proyecto se comporta como "stock".
export function effectiveFormat(value: unknown, userId: string): VideoFormat {
  return isVideoFormat(value) && value !== "stock" && isAdmin(userId) ? value : "stock";
}
