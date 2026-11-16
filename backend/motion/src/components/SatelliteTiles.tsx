import { useState, type ReactElement } from "react";
import { Img } from "remotion";
import type { GeoProjection } from "d3-geo";

// Teselas satelitales de Esri World Imagery (como MaV, mapa-base.tsx) debajo
// del mapa vectorial. d3.geoMercator es la misma Mercator esferica de las
// teselas web: cada tesela se ubica proyectando sus esquinas con la misma
// proyeccion del mapa, asi sigue el acercamiento cuadro a cuadro.
// Si una tesela no carga (sin red, mar abierto sin datos a ese zoom), se
// oculta y queda el fondo oscuro: nunca frena el render.

const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const TILE_SIZE = 256;
const MAX_ZOOM = 17;
const MAX_LAT = 85.0511;

function lonToX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

function latToY(lat: number, z: number): number {
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

function xToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function yToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

// Zoom de teselas para la escala de la proyeccion: el mundo mide 2*PI*scale px.
export function tileZoom(scale: number): number {
  const worldPx = 2 * Math.PI * scale;
  return Math.max(1, Math.min(MAX_ZOOM, Math.round(Math.log2(worldPx / TILE_SIZE))));
}

export function SatelliteTiles({ projection, width, height, opacity }: { projection: GeoProjection; width: number; height: number; opacity: number }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const z = tileZoom(projection.scale());
  // Esquinas visibles -> rango de teselas.
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([px, py]) => projection.invert?.([px!, py!]) ?? [0, 0]);
  const lons = corners.map((c) => c[0]!);
  const lats = corners.map((c) => c[1]!);
  const n = 2 ** z;
  const x0 = Math.max(0, Math.floor(lonToX(Math.min(...lons), z)));
  const x1 = Math.min(n - 1, Math.floor(lonToX(Math.max(...lons), z)));
  const y0 = Math.max(0, Math.floor(latToY(Math.max(...lats), z)));
  const y1 = Math.min(n - 1, Math.floor(latToY(Math.min(...lats), z)));
  // Tope de seguridad: con un encuadre raro no se piden cientos de teselas.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 160) return null;

  const tiles: ReactElement[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const key = `${z}/${x}/${y}`;
      if (failed.has(key)) continue;
      const nw = projection([xToLon(x, z), yToLat(y, z)]);
      const se = projection([xToLon(x + 1, z), yToLat(y + 1, z)]);
      if (!nw || !se) continue;
      tiles.push(
        <Img
          key={key}
          src={TILE_URL(z, x, y)}
          maxRetries={2}
          onError={() => {
            console.warn(`[mapa] tesela ${key} no cargo`);
            setFailed((prev) => new Set(prev).add(key));
          }}
          style={{ position: "absolute", left: nw[0], top: nw[1], width: se[0] - nw[0] + 1, height: se[1] - nw[1] + 1 }}
        />
      );
    }
  }
  return <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity }}>{tiles}</div>;
}
