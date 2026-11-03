import { BIBLIOTECA, type EstadoParte, type ObjetoBase } from "../biblioteca";
import { DOC } from "../scenes/palette";
import { colorDe, entra, golpe, lerp, mecanismo, mezcla, momento, momentos, remateAt, SUELO, T } from "./comun";
import type { ContenidoEsquema, Lugar, Momento, Recurso } from "./tipos";

// ESQUEMA POR CAPAS (catalogo #1): un escenario de perfil sobre el suelo al que
// se le suman capas con la voz. Aparece en la referencia como el corte del
// vagon, la rueda y el carril, el cerebro o la cremallera del ADN.
// Lugares FIJOS (de izquierda a derecha): personaje, secundario, principal y
// destino. Cada objeto de la biblioteca se escala a su lugar y se apoya en el
// suelo; las etiquetas se pegan al objeto o a su parte. Incluye:
//   - CONTRASTE (catalogo #3): "escudo" y etiquetas "seguro" prometen algo en
//     verde; en el remate se apagan.
//   - EVENTO CONTENIDO (catalogo #12): en vez de explosion, golpe seco de
//     0,25 s con grietas, halo rojo, piezas y etiqueta, y despues quietud.
//
// Momentos (hace): aparece, tarjeta, aprieta, parte, lupa, lupa_accion,
// lupa_texto, lupa_nota, etiqueta, escudo, conectar, flujo, evento.

const LUGARES: Record<Exclude<Lugar, "personaje">, { cx: number; maxW: number; maxH: number }> = {
  secundario: { cx: 600, maxW: 420, maxH: 380 },
  principal: { cx: 1260, maxW: 420, maxH: 560 },
  destino: { cx: 1740, maxW: 260, maxH: 220 },
};
const PERSONAJE_X = 330;

interface Ubicado {
  obj: ObjetoBase;
  x0: number;
  y0: number;
  w: number;
  h: number;
  esc: number;
}

function ubicar(id: string | undefined, lugar: keyof typeof LUGARES): Ubicado | null {
  const obj = id ? BIBLIOTECA[id] : undefined;
  if (!obj) return null;
  const l = LUGARES[lugar];
  const esc = Math.min(l.maxW / obj.ancho, l.maxH / obj.alto, 1);
  const w = obj.ancho * esc;
  const h = obj.alto * esc;
  return { obj, x0: l.cx - w / 2, y0: SUELO - h, w, h, esc };
}

const ancla = (u: Ubicado, parte: string): [number, number] => {
  const a = u.obj.anclas[parte] ?? [u.obj.ancho / 2, u.obj.alto / 2];
  return [u.x0 + a[0] * u.esc, u.y0 + a[1] * u.esc];
};

// ---------- Personaje: pictograma negro, sin cara ----------
function Personaje({ t, rec, objetivo }: { t: number; rec: Recurso; objetivo: [number, number] | null }) {
  const k = entra(t, momento(rec, "aparece", (m) => m.objeto === "personaje")?.at ?? rec.momentos[0]?.at);
  const aprieta = momento(rec, "aprieta")?.at;
  const kBrazo = golpe(t, aprieta, 0.3);
  const kRetro = entra(t, momento(rec, "evento")?.at, 0.3);
  const hombro: [number, number] = [PERSONAJE_X, 535];
  const destino = objetivo ?? [hombro[0] + 150, hombro[1] + 70];
  const angObj = (Math.atan2(destino[1] - hombro[1], destino[0] - hombro[0]) * 180) / Math.PI;
  const largoObj = Math.min(170, Math.hypot(destino[0] - hombro[0], destino[1] - hombro[1]) - 6);
  const ang = (lerp(lerp(80, angObj, kBrazo), 95, kRetro) * Math.PI) / 180;
  const largo = lerp(140, largoObj, kBrazo);
  const mano = [hombro[0] + Math.cos(ang) * largo, hombro[1] + Math.sin(ang) * largo];
  return (
    <g opacity={k} transform={`translate(${(1 - k) * -20} 0) rotate(${-kRetro * 10} ${PERSONAJE_X} ${SUELO})`} stroke={T.tinta} strokeLinecap="round" strokeWidth={18} fill="none">
      <line x1={PERSONAJE_X} y1={640} x2={PERSONAJE_X - 22} y2={SUELO} />
      <line x1={PERSONAJE_X} y1={640} x2={PERSONAJE_X + 22} y2={SUELO} />
      <line x1={PERSONAJE_X} y1={520} x2={PERSONAJE_X} y2={640} />
      <line x1={PERSONAJE_X} y1={535} x2={PERSONAJE_X - 28} y2={640} />
      <line x1={hombro[0]} y1={hombro[1]} x2={mano[0]} y2={mano[1]} />
      <circle cx={PERSONAJE_X} cy={478} r={26} fill={T.tinta} stroke="none" />
    </g>
  );
}

function Tarjeta({ t, m, c }: { t: number; m: Momento | undefined; c: ContenidoEsquema }) {
  const k = entra(t, m?.at);
  if (!m || !c.personaje?.tarjeta) return null;
  const x = PERSONAJE_X - 190;
  return (
    <g opacity={k}>
      <line x1={x + 110} y1={392} x2={PERSONAJE_X - 12} y2={452} stroke={T.linea} strokeWidth={2} />
      <rect x={x} y={300} width={220} height={92} fill="#FFFFFF" stroke="#C5CDD5" strokeWidth={2} />
      <text x={x + 20} y={346} fontFamily="Inter, sans-serif" fontWeight={800} fontSize={36} fill={T.tinta}>
        {c.personaje.tarjeta}
      </text>
      {c.personaje.rol && (
        <text x={x + 20} y={374} fontFamily="Inter, sans-serif" fontSize={18} fill={T.texto}>
          {c.personaje.rol}
        </text>
      )}
    </g>
  );
}

// ---------- Lupa: detalle ampliado de una parte ----------
function Lupa({ t, rec, u, c, apagado }: { t: number; rec: Recurso; u: Ubicado | null; c: ContenidoEsquema; apagado: number }) {
  const abre = momento(rec, "lupa")?.at;
  const k = entra(t, abre, 0.4);
  if (!u || !c.lupa || k === 0) return null;
  const [ax, ay] = ancla(u, c.lupa.parte);
  const cx = Math.min(1920 - 160, ax + 295);
  const cy = Math.max(165, ay - 298);
  const accion = mecanismo(t, momento(rec, "lupa_accion")?.at, 0.6);
  const mTexto = momento(rec, "lupa_texto");
  const kTexto = golpe(t, mTexto?.at);
  const kNota = entra(t, momento(rec, "lupa_nota")?.at);
  const Detalle = u.obj.Detalle;
  return (
    <g opacity={k * (1 - 0.5 * apagado)}>
      <line x1={ax + 15} y1={ay - 8} x2={cx - 92} y2={cy + 95} stroke={T.linea} strokeWidth={2} strokeDasharray="6 6" />
      <g transform={`translate(${cx} ${cy}) scale(${lerp(0.85, 1, k)})`}>
        <circle r={135} fill="#FFFFFF" stroke={T.linea} strokeWidth={3} />
        {Detalle && <Detalle t={t} parte={c.lupa.parte} accion={accion} />}
        {c.lupa.texto && (
          <text y={56} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={800} fontSize={28} letterSpacing={4} fill={colorDe(mTexto?.significado, true)} opacity={kTexto}>
            {c.lupa.texto}
          </text>
        )}
        {c.lupa.nota && (
          <text y={84} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={17} fill={T.texto} opacity={kNota}>
            {c.lupa.nota}
          </text>
        )}
      </g>
    </g>
  );
}

// ---------- Contraste: escudo que promete y se rompe en el remate ----------
function Escudo({ t, m, u, remate }: { t: number; m: Momento | undefined; u: Ubicado | null; remate: number | undefined }) {
  const k = entra(t, m?.at, 0.5);
  if (!m || !u || k === 0) return null;
  const kE = golpe(t, remate, 0.15);
  const x0 = u.x0 - 30;
  const x1 = u.x0 + u.w + 30;
  const y0 = u.y0 + 5;
  const ym = u.y0 + u.h * 0.6;
  const cx = (x0 + x1) / 2;
  const fondo = SUELO + 15;
  const d = `M${x0},${y0} L${x1},${y0} L${x1},${ym} Q${x1},${fondo - 75} ${cx},${fondo} Q${x0},${fondo - 75} ${x0},${ym} Z`;
  const tf = remate === undefined ? 0 : Math.max(0, t - remate);
  const frag: [number, number, number, number][] = [
    [x0 + 10, y0 + 65, -1, -1],
    [x1 - 10, y0 + 65, 1, -1],
    [x0 + 5, ym, -1, 0.2],
    [x1 - 5, ym, 1, 0.2],
    [cx - 110, fondo - 5, -0.6, 1],
    [cx + 110, fondo - 5, 0.6, 1],
  ];
  return (
    <>
      <g opacity={k * (1 - kE)} transform={`translate(${cx} ${ym}) scale(${lerp(0.94, 1, k)}) translate(${-cx} ${-ym})`}>
        <path d={d} fill="rgba(46,184,114,0.07)" stroke={DOC.seguro} strokeWidth={4} />
      </g>
      {remate !== undefined &&
        t >= remate &&
        frag.map(([x, y, dx, dy], i) => {
          const dd = 160 * Math.min(tf / 0.7, 1);
          return (
            <polygon
              key={i}
              points="-16,-10 18,-6 2,16"
              fill="none"
              stroke={DOC.seguro}
              strokeWidth={4}
              opacity={Math.max(0, 1 - tf / 0.8)}
              transform={`translate(${x + dx * dd} ${y + dy * dd}) rotate(${tf * 240 * (i % 2 ? 1 : -1)})`}
            />
          );
        })}
    </>
  );
}

// ---------- Conexion entre principal y destino (cable, flujo) ----------
function Conexion({ t, rec, de, a, remate }: { t: number; rec: Recurso; de: Ubicado | null; a: Ubicado | null; remate: number | undefined }) {
  const m = momento(rec, "conectar");
  if (!m || !de || !a) return null;
  const p0 = [de.x0 + de.w, de.y0 + de.h * 0.67];
  const p2 = [a.x0, a.y0 + a.h * 0.5];
  const p1 = [(p0[0]! + p2[0]!) / 2, Math.max(p0[1]!, p2[1]!) + 60];
  const k = mecanismo(t, m.at, 0.7);
  const flujo = momento(rec, "flujo")?.at;
  const largo = Math.hypot(p2[0]! - p0[0]!, p2[1]! - p0[1]!) * 1.25;
  const punto = (u: number) => {
    const a2 = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c2 = u * u;
    return [a2 * p0[0]! + b * p1[0]! + c2 * p2[0]!, a2 * p0[1]! + b * p1[1]! + c2 * p2[1]!];
  };
  const activo = flujo !== undefined && t >= flujo && (remate === undefined || t < remate);
  return (
    <g opacity={entra(t, m.at)}>
      <path d={`M${p0[0]},${p0[1]} Q${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill="none" stroke={T.linea} strokeWidth={3} strokeDasharray={largo} strokeDashoffset={largo * (1 - k)} />
      {activo &&
        [0, 0.33, 0.66].map((o, i) => {
          const [x, y] = punto(((t - flujo) * 0.7 + o) % 1);
          return <circle key={i} cx={x} cy={y} r={6} fill={T.dato2} />;
        })}
    </g>
  );
}

// ---------- Evento contenido ----------
function Evento({ t, m, u }: { t: number; m: Momento | undefined; u: Ubicado | null }) {
  if (!m || !u || t < m.at) return null;
  const k = golpe(t, m.at);
  const cx = u.x0 + u.w / 2;
  const cy = u.y0 + u.h * 0.6;
  const tf = t - m.at;
  const piezas = Array.from({ length: 12 }).map((_, i) => ({
    vx: Math.sin(i * 12.9898) * 420,
    vy: -380 - Math.abs(Math.cos(i * 78.233)) * 320,
    rot: (i % 2 ? 1 : -1) * (200 + i * 30),
    w: 10 + (i % 3) * 6,
  }));
  return (
    <g>
      <defs>
        <radialGradient id="halo-evento">
          <stop offset="0%" stopColor={DOC.peligro} stopOpacity={0.55} />
          <stop offset="100%" stopColor={DOC.peligro} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={u.w * 1.1 * k} fill="url(#halo-evento)" />
      {piezas.map((p, i) => {
        const x = cx + p.vx * tf;
        const y = u.y0 + 160 * u.esc + p.vy * tf + 0.5 * 1100 * tf * tf;
        if (y > SUELO) return null;
        return <rect key={i} x={x} y={y} width={p.w} height={p.w * 0.6} fill={T.tinta} transform={`rotate(${p.rot * tf} ${x} ${y})`} />;
      })}
    </g>
  );
}

// Las capas que van por detras del objeto (halo) y por delante (etiqueta).
function EventoEtiqueta({ t, m, u }: { t: number; m: Momento | undefined; u: Ubicado | null }) {
  if (!m || !u || !m.texto) return null;
  const k = golpe(t, m.at);
  return (
    <text x={u.x0 + u.w / 2} y={u.y0 - 100 + (1 - k) * 8} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={800} fontSize={46} fill={DOC.peligro} opacity={k}>
      {m.texto}
    </text>
  );
}

// ---------- Etiquetas pegadas al objeto ----------
function Etiquetas({ t, rec, lugares, remate }: { t: number; rec: Recurso; lugares: Record<string, Ubicado | null>; remate: number | undefined }) {
  const kR = golpe(t, remate);
  const lista = momentos(rec, "etiqueta");
  return (
    <>
      {lista.map((m, i) => {
        const u = lugares[m.objeto ?? "principal"];
        if (!u || !m.texto) return null;
        const k = entra(t, m.at) * (m.posicion === "arriba" && remate !== undefined ? 1 - golpe(t, remate, 0.15) : 1);
        const seguro = m.significado === "seguro";
        const color = seguro ? mezcla(DOC.seguro, T.gris, kR) : colorDe(m.significado, true);
        const op = k * (seguro ? 1 - 0.6 * kR : 1);
        if (m.posicion === "arriba" || !m.parte) {
          return (
            <text key={i} x={u.x0 + u.w / 2} y={u.y0 - 25 + (1 - k) * 8} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={600} fontSize={30} fill={color} opacity={op}>
              {m.texto}
            </text>
          );
        }
        const [ax, ay] = ancla(u, m.parte);
        return (
          <g key={i} opacity={op}>
            <line x1={u.x0 + 10} y1={ay} x2={ax} y2={ay} stroke={color} strokeWidth={2} />
            <text x={u.x0} y={ay + 8 + (1 - k) * 8} textAnchor="end" fontFamily="Inter, sans-serif" fontWeight={600} fontSize={30} fill={color}>
              {m.texto}
            </text>
          </g>
        );
      })}
    </>
  );
}

function EscudoEtiqueta({ t, m, u, remate }: { t: number; m: Momento | undefined; u: Ubicado | null; remate: number | undefined }) {
  if (!m || !u || !m.texto) return null;
  const kR = golpe(t, remate);
  const k = entra(t, m.at) * (1 - 0.6 * kR);
  const x = u.x0 + u.w + 30;
  const y = u.y0 + 200;
  const color = mezcla(DOC.seguro, T.gris, kR);
  return (
    <g opacity={k}>
      <line x1={x} y1={y + 8} x2={x + 18} y2={y + 8} stroke={color} strokeWidth={2} />
      <text x={x + 25} y={y + (1 - k) * 8} fontFamily="Inter, sans-serif" fontWeight={600} fontSize={30} fill={color}>
        {m.texto}
      </text>
    </g>
  );
}

// ---------- Escena completa ----------
export function EsquemaCapas({ t, rec, inicio, fin }: { t: number; rec: Recurso; inicio: number; fin: number }) {
  const c = rec.contenido as ContenidoEsquema;
  const lugares: Record<string, Ubicado | null> = {
    secundario: ubicar(c.secundario, "secundario"),
    principal: ubicar(c.principal, "principal"),
    destino: ubicar(c.destino, "destino"),
  };
  const remate = remateAt(rec);
  const evento = momento(rec, "evento");
  const aprieta = momento(rec, "aprieta");

  // Estado de las partes de cada objeto: "parte" y "aprieta" les marcan el segundo.
  const partesDe = (lugar: string): Record<string, EstadoParte | undefined> => {
    const p: Record<string, EstadoParte | undefined> = {};
    for (const m of rec.momentos) {
      if ((m.hace === "parte" || m.hace === "aprieta") && m.objeto === lugar && m.parte) p[m.parte] = { at: m.at, significado: m.significado };
    }
    return p;
  };
  const objetivo = aprieta?.objeto && aprieta.parte && lugares[aprieta.objeto] ? ancla(lugares[aprieta.objeto]!, aprieta.parte) : null;

  // Deriva lenta constante: nunca hay un cuadro congelado.
  const avance = Math.min(Math.max((t - inicio) / Math.max(1, fin - inicio), 0), 1);
  const dx = lerp(-24, 24, avance);
  const s = lerp(1, 1.04, avance);

  const objetos = (["principal", "destino", "secundario"] as const).map((lugar) => {
    const u = lugares[lugar];
    if (!u) return null;
    const ap = momento(rec, "aparece", (m) => m.objeto === lugar)?.at;
    const k = ap === undefined ? 1 : entra(t, ap);
    const Dibujo = u.obj.Dibujo;
    return (
      <g key={lugar} opacity={k} transform={`translate(${u.x0} ${u.y0 + (1 - k) * 12}) scale(${u.esc})`}>
        <Dibujo t={t} partes={partesDe(lugar)} evento={evento?.objeto === lugar ? evento.at : undefined} />
      </g>
    );
  });

  return (
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <g transform={`translate(960 540) scale(${s}) translate(${-960 + dx} -540)`}>
        <line x1={60} y1={SUELO} x2={1860} y2={SUELO} stroke={T.linea} strokeWidth={3} />
        <Escudo t={t} m={momento(rec, "escudo")} u={lugares[momento(rec, "escudo")?.objeto ?? "principal"] ?? null} remate={remate} />
        <Evento t={t} m={evento} u={evento ? (lugares[evento.objeto ?? "principal"] ?? null) : null} />
        <Conexion t={t} rec={rec} de={lugares.principal ?? null} a={lugares.destino ?? null} remate={remate} />
        {objetos}
        {c.personaje && <Personaje t={t} rec={rec} objetivo={objetivo} />}
        <Tarjeta t={t} m={momento(rec, "tarjeta")} c={c} />
        <Lupa t={t} rec={rec} u={c.lupa ? (lugares[c.lupa.objeto] ?? null) : null} c={c} apagado={golpe(t, remate, 0.3)} />
        <Etiquetas t={t} rec={rec} lugares={lugares} remate={remate} />
        <EscudoEtiqueta t={t} m={momento(rec, "escudo")} u={lugares[momento(rec, "escudo")?.objeto ?? "principal"] ?? null} remate={remate} />
        <EventoEtiqueta t={t} m={evento} u={evento ? (lugares[evento.objeto ?? "principal"] ?? null) : null} />
      </g>
    </svg>
  );
}
