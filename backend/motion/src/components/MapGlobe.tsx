import { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, useMotion } from "../lib/anim";
import { countries, countryAt, validGeo } from "../lib/geo";

// Frames del giro hasta el lugar.
const SPIN_FRAMES = 44;
// Cuanto gira (grados de longitud) antes de llegar.
const SPIN_DEGREES = 110;

// Globo que gira hasta el lugar (Como Funciona El Mundo: hasta resaltar
// Peru): el planeta en la derecha rota y se inclina hasta centrar la
// coordenada (`geo`), el pais que la contiene se pinta en el acento y cae un
// pin. A la izquierda el lugar (`text`) y su dato (`label`), literales.
export function MapGlobe({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, frame, width, height, enter, exit } = useMotion(withExit);
  const geo = validGeo(spec.geo) ? spec.geo : null;
  const country = useMemo(() => (geo ? countryAt(geo.lon, geo.lat) : null), [geo?.lat, geo?.lon]);
  if (!geo) return null;

  const spin = interpolate(frame, [0, SPIN_FRAMES], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const radius = 400 * s * (0.9 + 0.1 * spin);
  const cx = width * 0.66;
  const cy = height * 0.52;
  // Centrar el lugar: rotate([-lon, -lat]). Arranca girado hacia el este y
  // sin inclinacion.
  const projection = geoOrthographic()
    .scale(radius)
    .translate([cx, cy])
    .rotate([-geo.lon + SPIN_DEGREES * (1 - spin), -geo.lat * spin])
    .clipAngle(90);
  const path = geoPath(projection);
  const lit = enter(SPIN_FRAMES - 6, 14);
  const pin = enter(SPIN_FRAMES, 12);
  const [px, py] = projection([geo.lon, geo.lat]) ?? [cx, cy];

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 80% 90% at 66% 52%, rgba(0,0,0,0.25), rgba(0,0,0,0.6))", opacity: enter(0) }} />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: enter(0, 16) }}>
        <defs>
          <radialGradient id="globe-ocean" cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#1c2a3a" />
            <stop offset="100%" stopColor="#070b12" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={radius} fill="url(#globe-ocean)" stroke={`${theme.accent}55`} strokeWidth={2 * s} style={{ filter: `drop-shadow(0 0 ${40 * s}px ${theme.accent}30)` }} />
        <path d={path(geoGraticule10()) ?? ""} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1 * s} />
        {countries().map((c, i) =>
          c === country ? null : <path key={i} d={path(c) ?? ""} fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.35)" strokeWidth={0.6 * s} />
        )}
        {country && (
          <path
            d={path(country) ?? ""}
            fill={theme.accent}
            fillOpacity={0.25 + 0.6 * lit}
            stroke={theme.accent}
            strokeWidth={2 * s}
            style={{ filter: `drop-shadow(0 0 ${14 * s * lit}px ${theme.accent})` }}
          />
        )}
        {/* Pin: cae al final del giro, con un anillo que se expande. */}
        <circle cx={px} cy={py} r={(10 + 40 * pin) * s} fill="none" stroke={theme.accent} strokeWidth={3 * s} opacity={pin * (1 - pin) * 3} />
        <circle cx={px} cy={py - (1 - pin) * 40 * s} r={9 * s} fill="#fff" stroke={theme.accent} strokeWidth={4 * s} opacity={pin} />
      </svg>
      <div style={{ position: "absolute", left: 140 * s, top: 0, bottom: 0, width: width * 0.36, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ width: 70 * s, height: 4 * s, marginBottom: 26 * s, background: theme.accent, transform: `scaleX(${enter(SPIN_FRAMES - 4)})`, transformOrigin: "left" }} />
        <div
          style={{
            fontFamily: theme.fontSerif,
            fontWeight: 500,
            fontSize: 96 * s,
            lineHeight: 1.02,
            color: theme.text,
            textShadow: TEXT_SHADOW,
            opacity: enter(SPIN_FRAMES - 4),
            transform: `translateY(${(1 - enter(SPIN_FRAMES - 4)) * 20 * s}px)`,
          }}
        >
          {spec.text}
        </div>
        {spec.label && (
          <div style={{ marginTop: 18 * s, fontFamily: theme.fontSans, fontWeight: 600, fontSize: 30 * s, letterSpacing: 5 * s, textTransform: "uppercase", color: theme.textMuted, textShadow: TEXT_SHADOW, opacity: enter(SPIN_FRAMES + 4) }}>
            {spec.label}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
