import { useMemo, type ReactElement } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { geoMercator, geoPath, type GeoProjection } from "d3-geo";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { countries, type Country } from "../lib/geo";
import { SatelliteTiles } from "./SatelliteTiles";

// MAPA EXPLICATIVO (como mapa-cartoon de MaV): el video entero es un mapa
// sobre satelite; cada plano es UNA idea de su frase. Paises reales como
// placas de color en relieve que suben a su lugar (el protagonista con cara),
// rutas que se dibujan, una cifra que cuenta, pegatinas, un bocadillo con la
// pregunta, el anio y nombres de mares o lugares. La camara VUELA desde el
// encuadre del plano anterior (camara.desde, lo calcula el backend) y dentro
// del plano apenas deriva. Todo lo arma `spec.escena` (backend directorMapa).

type LatLon = [number, number];

export interface Escena {
  centro: { lat: number; lon: number };
  km: number;
  paises?: { nombre: string; color?: string; en?: number; hasta?: number; cara?: boolean; animo?: string; mira?: [number, number]; tamCara?: number }[];
  rutas?: { tipo?: "tubo" | "flecha"; puntos: LatLon[]; en?: number; dur?: number; arco?: number; color?: string }[];
  cifra?: { texto: string; sub?: string; color?: string; en?: number; coma?: boolean; hasta?: number };
  anio?: { texto: string; rebobinar?: boolean; en?: number; hasta?: number };
  bocadillo?: { texto: string; en?: number };
  etiquetas?: { texto: string; lat: number; lon: number; giro?: number; en?: number; tam?: number }[];
  iconos?: { tipo: string; lat?: number; lon?: number; x?: number; y?: number; en?: number; escala?: number; texto?: string }[];
  camara?: {
    mov?: string;
    zoom?: number;
    deriva?: [number, number];
    vuelo?: number;
    desde?: { centro: { lat: number; lon: number }; km: number; deriva?: [number, number]; zoom?: number; mantener?: boolean };
  };
}

const R = 6371;

// Nombres en castellano de los paises mas comunes -> world-atlas.
const NOMBRES: Record<string, string> = {
  "estados unidos": "United States of America",
  eeuu: "United States of America",
  "reino unido": "United Kingdom",
  rusia: "Russia",
  "arabia saudita": "Saudi Arabia",
  "arabia saudi": "Saudi Arabia",
  alemania: "Germany",
  francia: "France",
  espana: "Spain",
  italia: "Italy",
  japon: "Japan",
  "corea del sur": "South Korea",
  "corea del norte": "North Korea",
  brasil: "Brazil",
  mexico: "Mexico",
  canada: "Canada",
  irak: "Iraq",
  "emiratos arabes unidos": "United Arab Emirates",
  egipto: "Egypt",
  turquia: "Turkey",
  ucrania: "Ukraine",
  polonia: "Poland",
  "paises bajos": "Netherlands",
  holanda: "Netherlands",
  belgica: "Belgium",
  suiza: "Switzerland",
  grecia: "Greece",
  marruecos: "Morocco",
  argelia: "Algeria",
  sudafrica: "South Africa",
  australia: "Australia",
  "nueva zelanda": "New Zealand",
  filipinas: "Philippines",
  tailandia: "Thailand",
  malasia: "Malaysia",
  singapur: "Singapore",
  pakistan: "Pakistan",
  afganistan: "Afghanistan",
  kazajistan: "Kazakhstan",
  iran: "Iran",
  india: "India",
  peru: "Peru",
  "republica dominicana": "Dominican Rep.",
  "groenlandia": "Greenland",
  noruega: "Norway",
  suecia: "Sweden",
  finlandia: "Finland",
  dinamarca: "Denmark",
  irlanda: "Ireland",
  "nueva guinea": "Papua New Guinea",
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function findCountry(name: string): Country | undefined {
  const all = countries();
  const n = norm(name);
  const target = NOMBRES[n] ? norm(NOMBRES[n]!) : n;
  return all.find((c) => norm(c.properties.name) === target) ?? all.find((c) => norm(c.properties.name).startsWith(target));
}

// Proyeccion para un encuadre: `km` de ancho visible centrado en `centro`.
function projectionFor(centro: { lat: number; lon: number }, km: number, width: number, height: number): GeoProjection {
  const cos = Math.max(0.2, Math.cos((centro.lat * Math.PI) / 180));
  const scale = (width * R * cos) / Math.max(1, km);
  return geoMercator().scale(scale).center([centro.lon, centro.lat]).translate([width / 2, height / 2]);
}

// Curva del vuelo (MaV): seno con un 15 % lineal, sin el paron de la cubica.
const flightEase = (u: number) => 0.15 * u + 0.85 * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u))));

// Cuanto mas se mueve la camara dentro del plano que los valores de MaV
// (deriva ~0,02 del cuadro): con esos el mapa se sentia quieto.
const MOTION_GAIN = 2.5;

// Encuadre al final de un plano: su centro corrido por la deriva (fraccion del
// cuadro) y el km reducido por el zoom. Con una curva suave (no lineal) para
// que la deriva arranque y termine sin tirones.
function endOf(centro: { lat: number; lon: number }, km: number, deriva: [number, number] | undefined, zoom: number | undefined, p: number) {
  const d = deriva ?? [0, 0];
  const cos = Math.max(0.2, Math.cos((centro.lat * Math.PI) / 180));
  const degX = (km / (R * cos)) * (180 / Math.PI);
  const q = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));
  return {
    centro: { lat: centro.lat - d[1] * MOTION_GAIN * q * degX * 0.5625, lon: centro.lon + d[0] * MOTION_GAIN * q * degX },
    km: km * (1 - (zoom ?? 0) * MOTION_GAIN * q),
  };
}

const SEA_NAME = /\b(mar|golfo|oc[eé]ano|caribe|bah[ií]a|estrecho|canal|pen[ií]nsula|selva|sea|gulf|ocean|bay|strait|channel|peninsula)\b/i;

function pathOfRoute(proj: GeoProjection, puntos: LatLon[], arco = 0): string {
  const pts = puntos.map(([lat, lon]) => proj([lon, lat])).filter((p): p is [number, number] => !!p);
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    const [a, b] = pts as [[number, number], [number, number]];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const cx = mx - dy * (arco || -0.18);
    const cy = my + dx * (arco || -0.18);
    return `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`;
  }
  return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}

function Icon({ tipo, k }: { tipo: string; k: number }) {
  const s = 96 * k;
  const ring = <circle cx={s / 2} cy={s / 2} r={s / 2 - 3 * k} fill="#fff" stroke="#111" strokeWidth={3 * k} />;
  const ink = "#1b1b1b";
  const shapes: Record<string, ReactElement> = {
    barril: <rect x={s * 0.32} y={s * 0.22} width={s * 0.36} height={s * 0.56} rx={6 * k} fill="#2b2b2b" />,
    barriles: (
      <>
        <rect x={s * 0.2} y={s * 0.3} width={s * 0.28} height={s * 0.46} rx={5 * k} fill="#2b2b2b" />
        <rect x={s * 0.52} y={s * 0.3} width={s * 0.28} height={s * 0.46} rx={5 * k} fill="#444" />
      </>
    ),
    pozo: <path d={`M${s * 0.3},${s * 0.8} L${s * 0.5},${s * 0.2} L${s * 0.7},${s * 0.8} M${s * 0.36},${s * 0.6} L${s * 0.64},${s * 0.6}`} stroke={ink} strokeWidth={5 * k} fill="none" />,
    fabrica: <path d={`M${s * 0.2},${s * 0.78} V${s * 0.45} L${s * 0.4},${s * 0.55} V${s * 0.45} L${s * 0.6},${s * 0.55} V${s * 0.25} H${s * 0.75} V${s * 0.78} Z`} fill={ink} />,
    refineria: <path d={`M${s * 0.25},${s * 0.78} V${s * 0.35} H${s * 0.38} V${s * 0.78} M${s * 0.5},${s * 0.78} V${s * 0.22} H${s * 0.63} V${s * 0.78} M${s * 0.2},${s * 0.78} H${s * 0.8}`} stroke={ink} strokeWidth={6 * k} fill="none" />,
    camion: <path d={`M${s * 0.15},${s * 0.35} H${s * 0.6} V${s * 0.65} H${s * 0.15} Z M${s * 0.6},${s * 0.45} H${s * 0.78} L${s * 0.85},${s * 0.55} V${s * 0.65} H${s * 0.6} Z`} fill={ink} />,
    barco: <path d={`M${s * 0.15},${s * 0.55} H${s * 0.85} L${s * 0.72},${s * 0.75} H${s * 0.28} Z M${s * 0.35},${s * 0.55} V${s * 0.35} H${s * 0.6} V${s * 0.55}`} fill={ink} />,
    documento: <path d={`M${s * 0.3},${s * 0.2} H${s * 0.6} L${s * 0.72},${s * 0.32} V${s * 0.8} H${s * 0.3} Z`} fill="#fff" stroke={ink} strokeWidth={4 * k} />,
    calendario: <rect x={s * 0.25} y={s * 0.28} width={s * 0.5} height={s * 0.46} rx={5 * k} fill="#fff" stroke="#E8312A" strokeWidth={5 * k} />,
    "flecha-arriba": <path d={`M${s * 0.5},${s * 0.2} L${s * 0.78},${s * 0.52} H${s * 0.6} V${s * 0.8} H${s * 0.4} V${s * 0.52} H${s * 0.22} Z`} fill="#4FB36B" />,
    "flecha-abajo": <path d={`M${s * 0.5},${s * 0.8} L${s * 0.78},${s * 0.48} H${s * 0.6} V${s * 0.2} H${s * 0.4} V${s * 0.48} H${s * 0.22} Z`} fill="#E8312A" />,
    alerta: <path d={`M${s * 0.5},${s * 0.18} L${s * 0.84},${s * 0.78} H${s * 0.16} Z`} fill="#E9C443" stroke={ink} strokeWidth={4 * k} />,
  };
  return (
    <svg width={s} height={s} style={{ overflow: "visible", filter: `drop-shadow(0 ${4 * k}px ${6 * k}px rgba(0,0,0,0.45))` }}>
      {ring}
      {shapes[tipo] ?? shapes.alerta}
    </svg>
  );
}

function Face({ x, y, size, animo, mira, t, k }: { x: number; y: number; size: number; animo?: string; mira?: [number, number]; t: number; k: number }) {
  // tamCara en unidades de MaV (~28): la cara mide ~3x eso en px a 1080p.
  const r = size * 3.4 * k;
  const [mx, my] = mira ?? [0, 0];
  // Parpadeo breve cada ~3 s.
  const blink = t % 3.1 > 2.98 ? 0.15 : 1;
  const eye = (dx: number) => (
    <g transform={`translate(${x + dx * r} ${y - 0.15 * r})`}>
      <ellipse rx={0.32 * r} ry={0.4 * r * blink} fill="#fff" stroke="#111" strokeWidth={2.5 * k} />
      <circle cx={mx * 0.14 * r} cy={my * 0.14 * r} r={0.15 * r * blink} fill="#111" />
    </g>
  );
  const mouths: Record<string, string> = {
    feliz: `M${x - 0.4 * r},${y + 0.45 * r} Q${x},${y + 0.85 * r} ${x + 0.4 * r},${y + 0.45 * r}`,
    serio: `M${x - 0.35 * r},${y + 0.6 * r} L${x + 0.35 * r},${y + 0.6 * r}`,
    preocupado: `M${x - 0.38 * r},${y + 0.75 * r} Q${x},${y + 0.4 * r} ${x + 0.38 * r},${y + 0.75 * r}`,
    sorpresa: `M${x},${y + 0.6 * r} m${-0.18 * r},0 a${0.18 * r},${0.2 * r} 0 1,0 ${0.36 * r},0 a${0.18 * r},${0.2 * r} 0 1,0 ${-0.36 * r},0`,
  };
  return (
    <g>
      {eye(-0.42)}
      {eye(0.42)}
      <path d={mouths[animo ?? "feliz"] ?? mouths.feliz} stroke="#111" strokeWidth={4 * k} fill={animo === "sorpresa" ? "#111" : "none"} strokeLinecap="round" />
    </g>
  );
}

function formatCount(texto: string, progress: number, coma?: boolean): string {
  const m = /([\d.,]+)/.exec(texto);
  if (!m) return texto;
  const raw = m[1]!;
  const value = Number(coma ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return texto;
  const decimals = (coma ? raw.split(",")[1] : raw.split(".")[1])?.length ?? 0;
  let shown = (value * progress).toFixed(decimals);
  if (coma) shown = shown.replace(".", ",");
  return texto.replace(raw, shown);
}

export function MapCartoon({ spec, theme }: { spec: OverlaySpec; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const e = spec.escena as Escena | undefined;
  const k = height / 1080;
  const t = frame / fps;
  const total = durationInFrames / fps;
  const slabs = useMemo(
    () => (e?.paises ?? []).map((p) => ({ p, feature: findCountry(p.nombre) })).filter((x): x is { p: NonNullable<Escena["paises"]>[number]; feature: Country } => !!x.feature),
    [e]
  );
  if (!e?.centro || !Number.isFinite(e.km)) return null;

  // Camara: vuelo desde el plano anterior y despues una deriva suave.
  const cam = e.camara ?? {};
  const vuelo = cam.desde && !cam.desde.mantener ? Math.min(cam.vuelo ?? 1.4, total * 0.6) : 0;
  const from = cam.desde ? endOf(cam.desde.centro, cam.desde.km, cam.desde.deriva, cam.desde.zoom, 1) : null;
  let centro = e.centro;
  let km = e.km;
  if (from && t < vuelo) {
    const u = flightEase(t / vuelo);
    centro = { lat: from.centro.lat + (e.centro.lat - from.centro.lat) * u, lon: from.centro.lon + (e.centro.lon - from.centro.lon) * u };
    km = from.km * Math.pow(e.km / from.km, u);
  } else {
    const p = total > vuelo ? (t - vuelo) / (total - vuelo) : 0;
    const start = cam.desde?.mantener && from ? from : { centro: e.centro, km: e.km };
    const end = endOf(start.centro, start.km, cam.deriva, cam.zoom, p);
    centro = end.centro;
    km = end.km;
  }
  const proj = projectionFor(centro, km, width, height);
  // De cerca (un pais visto a < ~2500 km) la placa solida tapa el satelite y
  // su contorno simplificado ya no calza con la costa real: se vuelve un
  // tinte con borde, sin relieve ni cara. Cambia con el vuelo de camara.
  const solid = interpolate(km, [900, 2500], [0.16, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const path = geoPath(proj);
  const at = (sec: number | undefined, damping = 14) => (sec === undefined || sec < 0 ? 1 : spring({ frame: frame - sec * fps, fps, config: { damping, stiffness: 170, mass: 0.7 } }));
  const fadeOut = (hasta: number | undefined) => (hasta === undefined ? 1 : interpolate(t, [Math.max(0, hasta - 0.45), hasta], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const font = theme.fontSans;

  return (
    <AbsoluteFill style={{ background: "#173248", overflow: "hidden" }}>
      <SatelliteTiles projection={proj} width={width} height={height} opacity={1} />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <rect width={width} height={height} fill="rgba(10,14,20,0.18)" />
        {/* Paises: placa en relieve (copia oscura abajo) que sube a su lugar. */}
        {slabs.map(({ p, feature }, i) => {
          const rise = at(p.en, 13);
          const dy = (1 - rise) * 40 * k;
          const op = Math.min(1, rise * 1.4) * fadeOut(p.hasta);
          const d = path(feature) ?? "";
          const color = p.color ?? "#2F7FE0";
          return (
            <g key={i} opacity={op} transform={`translate(0 ${dy})`}>
              {solid > 0.6 && <path d={d} fill="rgba(0,0,0,0.55)" opacity={(solid - 0.6) / 0.4} transform={`translate(0 ${16 * k})`} />}
              <path d={d} fill={color} fillOpacity={solid} stroke={solid < 1 ? color : "rgba(255,255,255,0.85)"} strokeOpacity={solid < 1 ? 0.9 : 1} strokeWidth={(solid < 1 ? 3 : 3.5) * k} strokeLinejoin="round" />
            </g>
          );
        })}
        {/* Rutas: tubo (oleoducto) o flecha punteada, se dibujan solas. */}
        {(e.rutas ?? []).map((r, i) => {
          const d = pathOfRoute(proj, r.puntos ?? [], r.arco);
          if (!d) return null;
          const en = r.en ?? 0.5;
          const prog = interpolate(t, [en, en + (r.dur ?? 1.2)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const color = r.color ?? "#E8312A";
          const dash = { pathLength: 1, strokeDasharray: `${prog} 1` };
          if (r.tipo === "tubo") {
            return (
              <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d={d} stroke="#5b5b5b" strokeWidth={13 * k} {...dash} />
                <path d={d} stroke={color} strokeWidth={8 * k} {...dash} />
                <path d={d} stroke="rgba(255,255,255,0.7)" strokeWidth={2 * k} {...dash} />
              </g>
            );
          }
          return (
            <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={prog > 0 ? 1 : 0}>
              <path d={d} stroke="#fff" strokeWidth={13 * k} {...dash} />
              <path d={d} stroke={color} strokeWidth={6 * k} pathLength={1} strokeDasharray={`${prog} 1`} />
              <path d={d} stroke="#fff" strokeWidth={2 * k} pathLength={1} strokeDasharray="0.012 0.02" opacity={0.6 * prog} />
              {/* Punta de flecha al llegar. */}
              {(() => {
                const pts = (r.puntos ?? []).map(([la, lo]) => proj([lo, la])).filter((p): p is [number, number] => !!p);
                if (pts.length < 2 || prog < 0.97) return null;
                const [a, b] = [pts[pts.length - 2]!, pts[pts.length - 1]!];
                const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
                return <path d={`M0,0 L${-26 * k},${-15 * k} L${-26 * k},${15 * k} Z`} fill={color} stroke="#fff" strokeWidth={3 * k} transform={`translate(${b[0]} ${b[1]}) rotate(${ang})`} />;
              })()}
            </g>
          );
        })}
        {/* Caras: solo protagonista (o rival), en el centro del pais. */}
        {slabs
          .filter(({ p }) => p.cara && solid > 0.6)
          .map(({ p, feature }, i) => {
            const [cx, cy] = path.centroid(feature);
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
            const rise = at(p.en, 13);
            return (
              <g key={`f${i}`} opacity={Math.min(1, rise * 1.4) * fadeOut(p.hasta)} transform={`translate(0 ${(1 - rise) * 40 * k})`}>
                <Face x={cx} y={cy} size={p.tamCara ?? 28} {...(p.animo ? { animo: p.animo } : {})} {...(p.mira ? { mira: p.mira } : {})} t={t} k={k} />
              </g>
            );
          })}
      </svg>
      {/* Etiquetas. Mares y regiones: texto grande girado con contorno negro
          grueso y sombra (se lee sobre cualquier satelite). Lugares: rotulo
          como el de MaV (punto blanco, linea en codo, nombre en mayusculas
          con sombra y una barrita del acento debajo). */}
      {(e.etiquetas ?? []).map((l, i) => {
        const pt = proj([l.lon, l.lat]);
        if (!pt) return null;
        const s = at(l.en);
        const outline = `0 0 ${2 * k}px #000, 0 0 ${4 * k}px #000, 0 ${3 * k}px ${12 * k}px rgba(0,0,0,0.9)`;
        if (SEA_NAME.test(l.texto)) {
          return (
            <div
              key={`l${i}`}
              style={{
                position: "absolute",
                left: pt[0],
                top: pt[1],
                transform: `translate(-50%,-50%) rotate(${l.giro ?? 0}deg) scale(${0.7 + 0.3 * s})`,
                opacity: s,
                fontFamily: font,
                fontWeight: 900,
                fontSize: (l.tam ?? 34) * 1.3 * k,
                letterSpacing: 4 * k,
                textTransform: "uppercase",
                color: "#fff",
                WebkitTextStroke: `${7 * k}px rgba(0,0,0,0.85)`,
                paintOrder: "stroke fill",
                textShadow: outline,
                whiteSpace: "nowrap",
              }}
            >
              {l.texto}
            </div>
          );
        }
        // Rotulo de lugar: el punto entra primero, despues la linea y el nombre.
        const line = interpolate(s, [0.15, 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const name = interpolate(s, [0.45, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const left = pt[0] > width * 0.72;
        const dx = (left ? -1 : 1) * 46 * k;
        const tilt = ((i * 37) % 7) - 3;
        return (
          <div key={`l${i}`} style={{ position: "absolute", left: pt[0], top: pt[1], opacity: Math.min(1, s * 2) }}>
            <svg width={1} height={1} style={{ position: "absolute", overflow: "visible" }}>
              <circle r={9 * k * Math.min(1, s * 2)} fill="#fff" stroke="#000" strokeWidth={3 * k} />
              <path d={`M0,0 L${dx * 0.55 * line},${-34 * k * line} L${dx * line},${-34 * k * line}`} stroke="#fff" strokeWidth={3.5 * k} fill="none" style={{ filter: `drop-shadow(0 0 ${3 * k}px #000)` }} />
            </svg>
            <div
              style={{
                position: "absolute",
                top: -34 * k,
                ...(left ? { right: -dx + 8 * k } : { left: dx + 8 * k }),
                transform: `translateY(-50%) rotate(${tilt}deg)`,
                opacity: name,
                whiteSpace: "nowrap",
                fontFamily: font,
                fontWeight: 900,
                fontSize: (l.tam ?? 34) * 1.15 * k,
                letterSpacing: 2.5 * k,
                textTransform: "uppercase",
                color: "#fff",
                WebkitTextStroke: `${6 * k}px rgba(0,0,0,0.85)`,
                paintOrder: "stroke fill",
                textShadow: outline,
              }}
            >
              {l.texto}
              <div style={{ height: 6 * k, width: `${name * 100}%`, marginTop: 4 * k, background: "#E8312A", boxShadow: `0 0 ${6 * k}px rgba(0,0,0,0.8)` }} />
            </div>
          </div>
        );
      })}
      {/* Pegatinas. */}
      {(e.iconos ?? []).slice(0, 4).map((ic, i) => {
        const pt: [number, number] | null =
          ic.lat !== undefined && ic.lon !== undefined ? proj([ic.lon, ic.lat]) : ic.x !== undefined && ic.y !== undefined ? [ic.x * width, ic.y * height] : null;
        if (!pt) return null;
        const s = at(ic.en, 11);
        const sc = (ic.escala ?? 0.8) * s;
        return (
          <div
            key={`i${i}`}
            style={{
              position: "absolute",
              left: pt[0],
              // Despues de entrar, flota suave (cada una a su ritmo).
              top: pt[1] + Math.sin(t * 2.2 + i * 1.7) * 5 * k * s,
              transform: `translate(-50%,-50%) scale(${sc}) rotate(${Math.sin(t * 1.6 + i) * 3 * s}deg)`,
              opacity: s,
            }}
          >
            <Icon tipo={ic.tipo} k={k} />
            {ic.texto && (
              <div style={{ position: "absolute", top: 18 * k, width: "100%", textAlign: "center", fontFamily: font, fontWeight: 900, fontSize: 22 * k, color: "#E8312A" }}>{ic.texto}</div>
            )}
          </div>
        );
      })}
      {/* Cifra grande que cuenta (tercio de arriba). */}
      {e.cifra && (
        <div
          style={{
            position: "absolute",
            top: 90 * k,
            width: "100%",
            textAlign: "center",
            opacity: at(e.cifra.en) * fadeOut(e.cifra.hasta),
            fontFamily: font,
            fontWeight: 900,
            color: e.cifra.color ?? "#7CE36B",
            WebkitTextStroke: `${3 * k}px #111`,
            textShadow: `0 ${6 * k}px ${14 * k}px rgba(0,0,0,0.5)`,
          }}
        >
          <div style={{ fontSize: 160 * k, lineHeight: 1 }}>
            {formatCount(e.cifra.texto, interpolate(t, [e.cifra.en ?? 0, (e.cifra.en ?? 0) + 0.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), e.cifra.coma)}
          </div>
          {e.cifra.sub && <div style={{ fontSize: 46 * k, color: "#fff", textTransform: "uppercase", WebkitTextStroke: `${2 * k}px #111` }}>{e.cifra.sub}</div>}
        </div>
      )}
      {/* Anio con icono de rebobinar. */}
      {e.anio && (
        <div
          style={{
            position: "absolute",
            top: 60 * k,
            left: "50%",
            transform: `translateX(-50%) scale(${0.7 + 0.3 * at(e.anio.en)})`,
            opacity: at(e.anio.en) * fadeOut(e.anio.hasta),
            background: "#fff",
            borderRadius: 18 * k,
            padding: `${10 * k}px ${28 * k}px`,
            fontFamily: font,
            fontWeight: 900,
            fontSize: 64 * k,
            color: "#111",
            display: "flex",
            alignItems: "center",
            gap: 14 * k,
          }}
        >
          {e.anio.rebobinar && <span style={{ fontSize: 46 * k, color: "#E8312A" }}>◀◀</span>}
          {e.anio.texto}
        </div>
      )}
      {/* Bocadillo con la pregunta del video. */}
      {e.bocadillo && (
        <div
          style={{
            position: "absolute",
            top: 70 * k,
            left: "50%",
            maxWidth: width * 0.7,
            transform: `translateX(-50%) scale(${0.6 + 0.4 * at(e.bocadillo.en)})`,
            opacity: at(e.bocadillo.en),
            background: "#fff",
            borderRadius: 26 * k,
            padding: `${18 * k}px ${34 * k}px`,
            fontFamily: font,
            fontWeight: 900,
            fontSize: 46 * k,
            color: "#111",
            textAlign: "center",
            boxShadow: `0 ${8 * k}px ${20 * k}px rgba(0,0,0,0.45)`,
          }}
        >
          {e.bocadillo.texto}
          <div style={{ position: "absolute", bottom: -18 * k, left: "50%", marginLeft: -18 * k, width: 0, height: 0, borderLeft: `${18 * k}px solid transparent`, borderRight: `${18 * k}px solid transparent`, borderTop: `${20 * k}px solid #fff` }} />
        </div>
      )}
    </AbsoluteFill>
  );
}
