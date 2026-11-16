import { useMemo, type ReactElement } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { geoMercator, geoPath, type GeoProjection } from "d3-geo";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { countries, type Country } from "../lib/geo";
import { SatelliteTiles } from "./SatelliteTiles";
import { Anchor, Ban, Banknote, Building2, Calendar, Car, CloudLightning, Coins, Construction, Droplets, Factory, FileText, Fish, Flame, Fuel, Hospital, Hotel, House, Landmark, Lightbulb, MapPin, Mountain, Plane, Shield, Ship, ShoppingBag, Skull, Sun, Thermometer, Tornado, TreePalm, TreePine, TrendingDown, TrendingUp, TriangleAlert, Truck, Users, Waves, Wheat, Zap, type LucideIcon } from "lucide-react";

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

// ANTI-SOLAPE (como apartar/encajar de MaV: "Hamburgo y Amberes salian una
// encima de otra"): cada etiqueta y pegatina es una caja en pantalla; si dos
// se pisan, la de menor prioridad (la que entro despues) se corre en vertical
// lo que haga falta, hacia el lado mas libre, y todo queda dentro del cuadro.
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  dy: number;
  fixed?: boolean;
}

export function separate(boxes: Box[], width: number, height: number, gap: number): void {
  // Ubicacion de a una en orden de prioridad: cada caja prueba corrimientos
  // verticales cada vez mas grandes (abajo, arriba, abajo...) y se queda con el
  // primero que no pisa nada de lo ya ubicado y entra en el cuadro.
  const placed: Box[] = [];
  const hits = (b: Box, dy: number) =>
    placed.some((a) => {
      const ay = a.y + a.dy;
      const by = b.y + dy;
      return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > -gap && Math.min(ay + a.h, by + b.h) - Math.max(ay, by) > -gap;
    });
  const inside = (b: Box, dy: number) => b.y + dy >= gap && b.y + dy + b.h <= height - gap;
  for (const b of boxes) {
    if (!b.fixed) {
      const step = Math.max(8, b.h / 3);
      let chosen: number | null = null;
      for (let n = 0; n <= 24 && chosen === null; n++) {
        for (const dy of n === 0 ? [0] : [n * step, -n * step]) {
          if (inside(b, dy) && !hits(b, dy)) {
            chosen = dy;
            break;
          }
        }
      }
      b.dy = chosen ?? 0;
    }
    placed.push(b);
  }
  void width;
}

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

// PEGATINAS: circulo de color con borde blanco grueso, el icono (lucide) en
// blanco, un brillo arriba y sombra. Cada tipo con su color. La lista sirve
// para cualquier tema (la de MaV era de petroleo y en un video de playas se
// usaba "alerta" para todo).
const STICKERS: Record<string, { icon: LucideIcon; color: string }> = {
  // energia e industria
  pozo: { icon: Fuel, color: "#2B2B2B" },
  barril: { icon: Fuel, color: "#3A3A3A" },
  barriles: { icon: Fuel, color: "#3A3A3A" },
  fabrica: { icon: Factory, color: "#6B7280" },
  refineria: { icon: Factory, color: "#4B5563" },
  energia: { icon: Zap, color: "#F2A541" },
  luz: { icon: Lightbulb, color: "#E9C443" },
  fuego: { icon: Flame, color: "#E8590C" },
  // transporte
  barco: { icon: Ship, color: "#2F7FE0" },
  puerto: { icon: Anchor, color: "#1D4E89" },
  camion: { icon: Truck, color: "#7C5CFC" },
  avion: { icon: Plane, color: "#0EA5E9" },
  coche: { icon: Car, color: "#6366F1" },
  carretera: { icon: Construction, color: "#F59E0B" },
  // lugares y gente
  playa: { icon: TreePalm, color: "#06B6D4" },
  hotel: { icon: Hotel, color: "#8B5CF6" },
  turistas: { icon: Users, color: "#EC4899" },
  personas: { icon: Users, color: "#EC4899" },
  pueblo: { icon: House, color: "#A16207" },
  ciudad: { icon: Building2, color: "#475569" },
  ruinas: { icon: Landmark, color: "#B45309" },
  hospital: { icon: Hospital, color: "#DC2626" },
  lugar: { icon: MapPin, color: "#E8312A" },
  // naturaleza y clima
  selva: { icon: TreePine, color: "#15803D" },
  agua: { icon: Droplets, color: "#0284C7" },
  mar: { icon: Waves, color: "#0369A1" },
  huracan: { icon: CloudLightning, color: "#334155" },
  tornado: { icon: Tornado, color: "#334155" },
  calor: { icon: Thermometer, color: "#EA580C" },
  sol: { icon: Sun, color: "#F59E0B" },
  montana: { icon: Mountain, color: "#57534E" },
  pesca: { icon: Fish, color: "#0891B2" },
  campo: { icon: Wheat, color: "#CA8A04" },
  // economia y datos
  dinero: { icon: Banknote, color: "#16A34A" },
  monedas: { icon: Coins, color: "#CA8A04" },
  comercio: { icon: ShoppingBag, color: "#DB2777" },
  documento: { icon: FileText, color: "#64748B" },
  calendario: { icon: Calendar, color: "#E8312A" },
  "flecha-arriba": { icon: TrendingUp, color: "#16A34A" },
  "flecha-abajo": { icon: TrendingDown, color: "#DC2626" },
  // avisos
  alerta: { icon: TriangleAlert, color: "#E9A23B" },
  prohibido: { icon: Ban, color: "#DC2626" },
  peligro: { icon: Skull, color: "#1F2937" },
  proteccion: { icon: Shield, color: "#2563EB" },
};

export const STICKER_TYPES = Object.keys(STICKERS);

function Icon({ tipo, k }: { tipo: string; k: number }) {
  const s = 92 * k;
  const st = STICKERS[tipo] ?? STICKERS.lugar!;
  const Glyph = st.icon;
  return (
    <div
      style={{
        width: s,
        height: s,
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0) 55%), ${st.color}`,
        border: `${6 * k}px solid #fff`,
        boxShadow: `0 ${6 * k}px ${14 * k}px rgba(0,0,0,0.55), inset 0 ${-4 * k}px ${8 * k}px rgba(0,0,0,0.25)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      <Glyph size={s * 0.52} color="#fff" strokeWidth={2.6} style={{ filter: `drop-shadow(0 ${2 * k}px ${2 * k}px rgba(0,0,0,0.35))` }} />
    </div>
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

  // Cajas en pantalla de etiquetas y pegatinas, y su corrimiento anti-solape.
  // El tercio de arriba queda para cifra/anio/bocadillo si el plano los tiene.
  // Se calcula con el encuadre propio del plano (no el de cada cuadro): asi el
  // corrimiento es fijo durante el plano y nada salta mientras la camara deriva.
  const layoutProj = projectionFor(e.centro, e.km, width, height);
  const labelBoxes = (e.etiquetas ?? []).map((l) => {
    const pt = layoutProj([l.lon, l.lat]);
    if (!pt) return null;
    const sea = SEA_NAME.test(l.texto);
    const fs = (l.tam ?? 34) * (sea ? 1.3 : 1.15) * k;
    const w = l.texto.length * fs * 0.68 + 10 * k;
    const h = fs * 1.3 + (sea ? 0 : 12 * k);
    if (sea) return { x: pt[0] - w / 2, y: pt[1] - h / 2, w, h, dy: 0 };
    const leftSide = pt[0] > width * 0.72;
    const dx = (leftSide ? -1 : 1) * 46 * k;
    return { x: leftSide ? pt[0] + dx - 8 * k - w : pt[0] + dx + 8 * k, y: pt[1] - 34 * k - h / 2, w, h, dy: 0 };
  });
  const iconPoints = (e.iconos ?? []).slice(0, 4).map((ic): [number, number] | null =>
    ic.lat !== undefined && ic.lon !== undefined ? layoutProj([ic.lon, ic.lat]) : ic.x !== undefined && ic.y !== undefined ? [ic.x * width, ic.y * height] : null
  );
  const iconBoxes = (e.iconos ?? []).slice(0, 4).map((ic, i) => {
    const pt = iconPoints[i];
    if (!pt) return null;
    const size = 92 * k * (ic.escala ?? 0.8);
    return { x: pt[0] - size / 2, y: pt[1] - size / 2, w: size, h: size + (ic.texto ? 46 * k : 0), dy: 0 };
  });
  const topZone = e.cifra || e.anio || e.bocadillo ? [{ x: width * 0.2, y: 0, w: width * 0.6, h: height * 0.3, dy: 0, fixed: true }] : [];
  separate([...topZone, ...labelBoxes.filter((b): b is Box => !!b), ...iconBoxes.filter((b): b is Box => !!b)], width, height, 10 * k);

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
                top: pt[1] + (labelBoxes[i]?.dy ?? 0),
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
              <path d={`M0,0 L${dx * 0.55 * line},${(-34 * k + (labelBoxes[i]?.dy ?? 0)) * line} L${dx * line},${(-34 * k + (labelBoxes[i]?.dy ?? 0)) * line}`} stroke="#fff" strokeWidth={3.5 * k} fill="none" style={{ filter: `drop-shadow(0 0 ${3 * k}px #000)` }} />
            </svg>
            <div
              style={{
                position: "absolute",
                top: -34 * k + (labelBoxes[i]?.dy ?? 0),
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
              top: pt[1] + (iconBoxes[i]?.dy ?? 0) + Math.sin(t * 2.2 + i * 1.7) * 5 * k * s,
              transform: `translate(-50%,-50%) scale(${sc}) rotate(${Math.sin(t * 1.6 + i) * 3 * s}deg)`,
              opacity: s,
            }}
          >
            <Icon tipo={ic.tipo} k={k} />
            {ic.texto && (
              <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translate(-50%, " + 6 * k + "px)", background: "#111", color: "#fff", border: 3 * k + "px solid #fff", borderRadius: 999, padding: 4 * k + "px " + 14 * k + "px", fontFamily: font, fontWeight: 900, fontSize: 26 * k, whiteSpace: "nowrap", boxShadow: "0 " + 4 * k + "px " + 10 * k + "px rgba(0,0,0,0.5)" }}>{ic.texto}</div>
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
