import { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { geoCircle, geoDistance, geoGraticule10, geoMercator, geoPath } from "d3-geo";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";
import { countries, countryAt, validGeo } from "../lib/geo";
import { SatelliteTiles } from "./SatelliteTiles";

// Frames del acercamiento.
const ZOOM_FRAMES = 40;
// Radio (grados) de la zona visible al final, sin lugar de referencia ni
// tamano del sitio.
const CLOSE_RADIUS = 7;

// Radio final segun el tamano del sitio (geocodificador, como MaV): un
// pueblo de ~4 km se ve de cerca, un pais entero de lejos.
export function closeRadius(km: number | undefined): number {
  if (!km || !Number.isFinite(km)) return CLOSE_RADIUS;
  return Math.max(0.02, Math.min(CLOSE_RADIUS, (km * 2.2) / 111));
}

// Mapa con marcador (terremoto del Tibet: mapa con reticula y "≈ 400 km de
// Lhasa"): mapa plano oscuro que se acerca al lugar (`geo`), pais resaltado,
// reticula que se cierra sobre el punto y el lugar (`text`) con su dato
// (`label`). Con `ref` se suma un segundo punto unido por una linea
// punteada, y el encuadre los incluye a los dos. Ningun numero sale de las
// coordenadas: las distancias van solo si estan en el guion (`label`).
export function MapMarker({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, frame, width, height, enter, draw, exit } = useMotion(withExit);
  const geo = validGeo(spec.geo) ? spec.geo : null;
  const ref = spec.ref && validGeo(spec.ref) && spec.ref.name ? spec.ref : null;
  const country = useMemo(() => (geo ? countryAt(geo.lon, geo.lat) : null), [geo?.lat, geo?.lon]);
  if (!geo) return null;

  const zoom = interpolate(frame, [0, ZOOM_FRAMES], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Encuadre final: un circulo alrededor del lugar, o que entren los dos
  // puntos (radio = mitad de la distancia + margen) centrado entre ambos.
  const center: [number, number] = ref ? [(geo.lon + ref.lon) / 2, (geo.lat + ref.lat) / 2] : [geo.lon, geo.lat];
  const satellite = spec.basemap === "satellite";
  // Los contornos de pais son de baja resolucion: sobre el satelite de cerca
  // (menos de ~1 grado) quedan corridos de la costa real, asi que no se dibujan.
  const outlines = !satellite || closeRadius(geo.km) >= 1;
  const close = closeRadius(geo.km);
  const finalRadius = ref ? Math.max(close, ((geoDistance([geo.lon, geo.lat], [ref.lon, ref.lat]) * 180) / Math.PI) * 0.75) : close;
  // De cerca se arranca mas lejos para dar contexto (de la region al pueblo).
  const radius = finalRadius * (1 + (finalRadius < 1 ? 12 : 3) * (1 - zoom));
  const frameBox: [[number, number], [number, number]] = [
    [width * 0.08, height * 0.12],
    [width * 0.92, height * 0.88],
  ];
  const projection = geoMercator().fitExtent(frameBox, geoCircle().center(center).radius(radius)());
  const path = geoPath(projection);
  const [px, py] = projection([geo.lon, geo.lat]) ?? [width / 2, height / 2];
  const [rx, ry] = ref ? (projection([ref.lon, ref.lat]) ?? [0, 0]) : [0, 0];

  const lit = enter(ZOOM_FRAMES - 10, 14);
  const reticle = enter(ZOOM_FRAMES - 4, 14);
  const line = draw(ZOOM_FRAMES, ZOOM_FRAMES + 16);
  const card = enter(ZOOM_FRAMES + 2, 14);
  // Tarjeta a la derecha del punto salvo que no entre o que ahi este el
  // lugar de referencia (lo taparia).
  const cardLeft = ref ? rx <= px : px < width * 0.6;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {satellite && <SatelliteTiles projection={projection} width={width} height={height} opacity={enter(0, 14)} />}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: enter(0, 14) }}>
        <defs>
          <radialGradient id="map-vignette" cx="50%" cy="50%" r="70%">
            <stop offset="55%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.85)" />
          </radialGradient>
        </defs>
        {/* Satelite: un velo leve para que se lean el punto y la tarjeta. */}
        <rect width={width} height={height} fill="#0a1018" opacity={satellite ? 0.18 : 0.97} />
        {!satellite && <path d={path(geoGraticule10()) ?? ""} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1 * s} />}
        {outlines && countries().map((c, i) =>
          c === country ? null : (
            <path key={i} d={path(c) ?? ""} fill={satellite ? "none" : "rgba(255,255,255,0.13)"} stroke={satellite ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.3)"} strokeWidth={0.8 * s} />
          )
        )}
        {outlines && country && (
          <path d={path(country) ?? ""} fill={theme.accent} fillOpacity={satellite ? 0.04 * lit : 0.06 + 0.12 * lit} stroke={theme.accent} strokeWidth={2.2 * s} strokeOpacity={0.4 + 0.6 * lit} />
        )}
        {ref && (
          <>
            <line
              x1={px}
              y1={py}
              x2={px + (rx - px) * line}
              y2={py + (ry - py) * line}
              stroke={theme.text}
              strokeWidth={3 * s}
              strokeDasharray={`${10 * s} ${8 * s}`}
              opacity={0.8}
            />
            <circle cx={rx} cy={ry} r={8 * s} fill={theme.text} opacity={enter(ZOOM_FRAMES + 10)} />
          </>
        )}
        {/* Reticula: un anillo que se cierra sobre el punto, con marcas. */}
        <g opacity={reticle} transform={`translate(${px} ${py})`}>
          <circle r={(34 + 50 * (1 - reticle)) * s} fill="none" stroke={theme.accent} strokeWidth={3 * s} />
          {[0, 90, 180, 270].map((a) => (
            <line key={a} x1={0} y1={-46 * s} x2={0} y2={-58 * s} stroke={theme.accent} strokeWidth={3 * s} transform={`rotate(${a})`} />
          ))}
          <circle r={7 * s} fill={theme.accent} style={{ filter: `drop-shadow(0 0 ${10 * s}px ${theme.accent})` }} />
        </g>
        <rect width={width} height={height} fill="url(#map-vignette)" />
      </svg>
      {ref && (
        <div
          style={{
            position: "absolute",
            left: rx,
            top: ry + 18 * s,
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontFamily: theme.fontSans,
            fontWeight: 600,
            fontSize: 28 * s,
            letterSpacing: 3 * s,
            textTransform: "uppercase",
            color: theme.text,
            textShadow: TEXT_SHADOW,
            opacity: enter(ZOOM_FRAMES + 12),
          }}
        >
          {ref.name}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          top: py - 60 * s,
          ...(cardLeft ? { left: px + 90 * s } : { right: width - px + 90 * s }),
          padding: `${18 * s}px ${26 * s}px`,
          borderLeft: cardLeft ? `${4 * s}px solid ${theme.accent}` : undefined,
          borderRight: cardLeft ? undefined : `${4 * s}px solid ${theme.accent}`,
          textAlign: cardLeft ? "left" : "right",
          background: "rgba(0,0,0,0.8)",
          opacity: card,
          transform: `translateX(${(1 - card) * (cardLeft ? -24 : 24) * s}px)`,
        }}
      >
        <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 54 * s, textTransform: "uppercase", letterSpacing: 2 * s, color: theme.text, whiteSpace: "nowrap" }}>
          {spec.text}
        </div>
        {spec.label && (
          <div style={{ marginTop: 6 * s, fontFamily: theme.fontSans, fontWeight: 600, fontSize: 28 * s, letterSpacing: 3 * s, color: theme.accent, whiteSpace: "nowrap" }}>
            {spec.label}
          </div>
        )}
      </div>
      {satellite && (
        <div style={{ position: "absolute", right: 14 * s, bottom: 10 * s, fontFamily: theme.fontSans, fontSize: 14 * s, color: "rgba(255,255,255,0.7)", textShadow: TEXT_SHADOW, opacity: enter(0, 14) }}>
          Imagen satelital: Esri, Maxar, Earthstar Geographics
        </div>
      )}
    </AbsoluteFill>
  );
}
