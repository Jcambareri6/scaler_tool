// Recorte de material ya aprobado (rescate del documental, backend
// pipeline/rescueAssign.ts): otra zona de la imagen, con zoom, y en un clip
// otro momento. El render lo hace con ffmpeg (crop=...); aca se reproduce con
// CSS: scale(zoom) con transform-origin en la misma fraccion que el
// desplazamiento de la ventana, que deja a la vista exactamente esa zona.

export interface CropSpec {
  x: number;
  y: number;
  zoom: number;
  t?: number;
  blur?: boolean;
}

export function cropOf(metadata: Record<string, unknown> | null | undefined): CropSpec | null {
  const c = metadata?.crop as Partial<CropSpec> | undefined;
  return c && typeof c.x === "number" && typeof c.y === "number" && typeof c.zoom === "number" && c.zoom >= 1 ? (c as CropSpec) : null;
}

// Misma cuenta que cropOffset() del backend.
export function cropOffset(crop: CropSpec): { fx: number; fy: number } {
  const z = Math.max(1, crop.zoom);
  const span = 1 - 1 / z || 1;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { fx: clamp((crop.x - 0.5 / z) / span), fy: clamp((crop.y - 0.5 / z) / span) };
}

// Estilo del <img>/<video> con el recorte (y el desenfoque del rotulo de falla).
export function cropStyle(crop: CropSpec | null, extraScale = 1): { transform?: string; transformOrigin?: string; filter?: string } {
  if (!crop) return {};
  const { fx, fy } = cropOffset(crop);
  return {
    transform: `scale(${(crop.zoom * extraScale).toFixed(3)})`,
    transformOrigin: `${(fx * 100).toFixed(1)}% ${(fy * 100).toFixed(1)}%`,
    ...(crop.blur ? { filter: "blur(10px)" } : {}),
  };
}
