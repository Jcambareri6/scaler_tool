import React from 'react';
import { C, FUENTE, MONO } from './tema';
import { entra, golpe, mecanismo, lerp, mezcla } from './util';
import { TituloEscena } from './Capas';

// Tiempos de palabra (de guion-30s-palabras.json)
const T = {
  inicio: 9.92,
  sala: 10.3,
  reactor: 11.06,
  numero: 11.4,
  ingeniero: 12.94,
  edad: 13.48,
  pulsa: 14.42,
  boton: 16.0,
  existe: 16.3,
  apagar: 18.58,
  reactor2: 19.08,
  emergencia: 20.28,
  ultimo: 21.62,
  freno: 22.96,
  abastecer: 24.74,
  electricidad: 25.38,
  ciudad: 26.32,
  explota: 29.1,
};

const SUELO = 780;

// ---------- Personaje: pictograma negro, sin cara ----------
const Personaje: React.FC<{ t: number }> = ({ t }) => {
  const k = entra(t, T.ingeniero);
  const kBrazo = golpe(t, T.pulsa, 0.3);
  const kRetro = entra(t, T.explota, 0.3);
  const ang = lerp(lerp(80, 29, kBrazo), 95, kRetro) * (Math.PI / 180);
  const largo = lerp(140, 150, kBrazo);
  const hombro = [330, 535];
  const mano = [hombro[0] + Math.cos(ang) * largo, hombro[1] + Math.sin(ang) * largo];
  const incl = -kRetro * 10; // retrocede con el golpe
  return (
    <g opacity={k} transform={`translate(${(1 - k) * -20} 0) rotate(${incl} 330 ${SUELO})`} stroke={C.tinta} strokeLinecap="round" strokeWidth={18} fill="none">
      <line x1={330} y1={640} x2={308} y2={SUELO} />
      <line x1={330} y1={640} x2={352} y2={SUELO} />
      <line x1={330} y1={520} x2={330} y2={640} />
      <line x1={330} y1={535} x2={302} y2={640} />
      <line x1={hombro[0]} y1={hombro[1]} x2={mano[0]} y2={mano[1]} />
      <circle cx={330} cy={478} r={26} fill={C.tinta} stroke="none" />
    </g>
  );
};

// ---------- Consola de la sala de control ----------
const Consola: React.FC<{ t: number }> = ({ t }) => {
  const k = entra(t, T.sala);
  const baja = golpe(t, T.pulsa + 0.2, 0.15) * 6;
  const destello = entra(t, T.pulsa + 0.2, 0.2) * (1 - entra(t, T.pulsa + 0.5, 0.6));
  return (
    <g opacity={k} transform={`translate(0 ${(1 - k) * 12})`}>
      <rect x={560} y={430} width={240} height={190} fill={C.rellenoSuave} stroke={C.linea} strokeWidth={3} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={580 + i * 70} y={450} width={60} height={40} fill={C.linea} />
      ))}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={580} y={510 + i * 22} width={200 - i * 40} height={8} fill={C.gris} opacity={0.6} />
      ))}
      <rect x={400} y={620} width={400} height={160} fill={C.relleno} stroke={C.linea} strokeWidth={3} />
      <rect x={440} y={606} width={50} height={14} fill={C.linea} />
      <rect x={448} y={590 + baja} width={34} height={16} rx={4} fill={C.tinta} />
      <circle cx={465} cy={598} r={34} fill="none" stroke={C.resaltado} strokeWidth={3} opacity={destello} />
    </g>
  );
};

// ---------- Lupa sobre el botón ----------
const Lupa: React.FC<{ t: number }> = ({ t }) => {
  const k = entra(t, T.boton, 0.4);
  const tapa = mecanismo(t, T.existe, 0.6) * -75;
  const kApagar = golpe(t, T.apagar);
  const kEmer = entra(t, T.emergencia);
  const dim = 1 - 0.5 * entra(t, T.explota, 0.3);
  if (k === 0) return null;
  return (
    <g opacity={k * dim}>
      <line x1={480} y1={590} x2={668} y2={395} stroke={C.linea} strokeWidth={2} strokeDasharray="6 6" />
      <g transform={`translate(760 300) scale(${lerp(0.85, 1, k)})`}>
        <circle r={135} fill="#FFFFFF" stroke={C.linea} strokeWidth={3} />
        {/* botón visto de frente */}
        <rect x={-62} y={-18} width={124} height={36} rx={6} fill={C.linea} />
        <rect x={-42} y={-48} width={84} height={34} rx={8} fill={C.tinta} />
        {/* tapa protectora que se levanta */}
        <g transform={`rotate(${tapa} -60 -50)`}>
          <rect x={-60} y={-56} width={120} height={44} rx={6} fill="rgba(140,160,180,0.25)" stroke={C.linea} strokeWidth={2.5} />
        </g>
        <text y={56} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={28} letterSpacing={4} fill={C.seguro} opacity={kApagar}>
          APAGAR
        </text>
        <text y={84} textAnchor="middle" fontFamily={FUENTE} fontSize={17} fill={C.textoClaro} opacity={kEmer}>
          en caso de emergencia
        </text>
      </g>
    </g>
  );
};

// ---------- Reactor en corte ----------
const Reactor: React.FC<{ t: number }> = ({ t }) => {
  const k = entra(t, T.reactor);
  const baja = mecanismo(t, T.apagar, 1.6) * 260;
  const kVerde = entra(t, T.reactor2, 0.8);
  const kE = golpe(t, T.explota);
  const kTapa = entra(t, T.explota, 0.7);
  const nucleo = kE > 0 ? mezcla(C.seguro, C.peligro, kE) : C.seguro;
  return (
    <g opacity={k} transform={`translate(0 ${(1 - k) * 12})`}>
      {/* halo del evento */}
      {kE > 0 && (
        <>
          <defs>
            <radialGradient id="halo">
              <stop offset="0%" stopColor={C.peligro} stopOpacity={0.55} />
              <stop offset="100%" stopColor={C.peligro} stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={1260} cy={560} r={440 * kE} fill="url(#halo)" />
        </>
      )}
      <rect x={1080} y={400} width={360} height={380} fill={C.rellenoSuave} stroke={C.linea} strokeWidth={3} />
      <rect x={1160} y={560} width={200} height={200} fill={C.relleno} stroke={C.linea} strokeWidth={2} />
      <rect x={1160} y={560} width={200} height={200} fill={nucleo} opacity={kE > 0 ? 0.6 : 0.28 * kVerde} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line key={i} x1={1180 + i * 32} y1={580} x2={1180 + i * 32} y2={745} stroke={C.gris} strokeWidth={8} strokeLinecap="round" />
      ))}
      {/* barras de control: bajan al núcleo en "apagar" */}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={1191 + i * 32} y={230 + baja} width={10} height={240} fill={C.tinta} rx={2} />
      ))}
      {/* grieta del evento */}
      <polyline
        points="1150,402 1185,470 1165,520 1210,585 1190,640"
        fill="none"
        stroke={C.peligro}
        strokeWidth={5}
        strokeLinejoin="round"
        opacity={kE}
      />
      <polyline points="1400,402 1372,455 1395,505 1360,560" fill="none" stroke={C.peligro} strokeWidth={5} strokeLinejoin="round" opacity={kE} />
      {/* tapa en dos mitades: se levantan con el golpe */}
      <rect x={1060} y={372} width={200} height={30} fill={C.linea} transform={`translate(${-70 * kTapa} ${-160 * kTapa}) rotate(${-28 * kTapa} 1160 387)`} />
      <rect x={1260} y={372} width={200} height={30} fill={C.linea} transform={`translate(${80 * kTapa} ${-180 * kTapa}) rotate(${34 * kTapa} 1360 387)`} />
    </g>
  );
};

// ---------- Escudo "último recurso" ----------
const ESCUDO = 'M1030,235 L1490,235 L1490,560 Q1490,720 1260,795 Q1030,720 1030,560 Z';
const Escudo: React.FC<{ t: number }> = ({ t }) => {
  const k = entra(t, T.ultimo, 0.5);
  const kE = golpe(t, T.explota, 0.15);
  if (k === 0) return null;
  const tf = Math.max(0, t - T.explota);
  const frag = [
    [1040, 300, -1, -1],
    [1480, 300, 1, -1],
    [1035, 560, -1, 0.2],
    [1485, 560, 1, 0.2],
    [1150, 790, -0.6, 1],
    [1370, 790, 0.6, 1],
  ];
  return (
    <>
      <g opacity={k * (1 - kE)} transform={`translate(1260 540) scale(${lerp(0.94, 1, k)}) translate(-1260 -540)`}>
        <path d={ESCUDO} fill="rgba(46,184,114,0.07)" stroke={C.seguro} strokeWidth={4} />
      </g>
      {t >= T.explota &&
        frag.map(([x, y, dx, dy], i) => {
          const d = 160 * Math.min(tf / 0.7, 1);
          return (
            <polygon
              key={i}
              points="-16,-10 18,-6 2,16"
              fill="none"
              stroke={C.seguro}
              strokeWidth={4}
              opacity={Math.max(0, 1 - tf / 0.8)}
              transform={`translate(${x + dx * d} ${y + dy * d}) rotate(${tf * 240 * (i % 2 ? 1 : -1)})`}
            />
          );
        })}
    </>
  );
};

// ---------- Ciudad y cable ----------
const EDIFICIOS = [
  [1620, 640, 50, 140],
  [1680, 600, 60, 180],
  [1750, 660, 45, 120],
  [1805, 620, 55, 160],
];
const curva = (u: number) => {
  const p0 = [1440, 600], p1 = [1530, 720], p2 = [1620, 690];
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
};
const Ciudad: React.FC<{ t: number }> = ({ t }) => {
  const k = entra(t, T.abastecer);
  const kCable = mecanismo(t, T.abastecer, 0.7);
  const flujo = t >= T.electricidad && t < T.explota;
  let n = 0;
  return (
    <g opacity={k}>
      <path d="M1440,600 Q1530,720 1620,690" fill="none" stroke={C.linea} strokeWidth={3} strokeDasharray="400" strokeDashoffset={400 * (1 - kCable)} />
      {flujo &&
        [0, 0.33, 0.66].map((o, i) => {
          const u = ((t - T.electricidad) * 0.7 + o) % 1;
          const [x, y] = curva(u);
          return <circle key={i} cx={x} cy={y} r={6} fill={C.dato2} />;
        })}
      {EDIFICIOS.map(([x, y, w, h], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} fill={C.rellenoSuave} stroke={C.linea} strokeWidth={2.5} />
          {Array.from({ length: Math.floor((h - 20) / 22) }).map((_, r) =>
            Array.from({ length: Math.floor((w - 10) / 18) }).map((__, c) => {
              const idx = n++;
              const luz = entra(t, T.ciudad + idx * 0.025, 0.25);
              return <rect key={`${r}-${c}`} x={x + 9 + c * 18} y={y + 12 + r * 22} width={9} height={10} fill={mezcla('#C3CBD3', C.dato2, luz)} />;
            })
          )}
        </g>
      ))}
    </g>
  );
};

// ---------- Escombros del evento (determinísticos) ----------
const Escombros: React.FC<{ t: number }> = ({ t }) => {
  if (t < T.explota) return null;
  const tf = t - T.explota;
  const piezas = Array.from({ length: 12 }).map((_, i) => {
    const vx = Math.sin(i * 12.9898) * 420;
    const vy = -380 - (Math.abs(Math.cos(i * 78.233)) * 320);
    return { vx, vy, rot: (i % 2 ? 1 : -1) * (200 + i * 30), w: 10 + (i % 3) * 6 };
  });
  return (
    <g>
      {piezas.map((p, i) => {
        const x = 1260 + p.vx * tf;
        const y = 390 + p.vy * tf + 0.5 * 1100 * tf * tf;
        if (y > SUELO) return null;
        return <rect key={i} x={x} y={y} width={p.w} height={p.w * 0.6} fill={C.tinta} transform={`rotate(${p.rot * tf} ${x} ${y})`} />;
      })}
    </g>
  );
};

// ---------- Etiquetas pegadas a los objetos ----------
const Etiqueta: React.FC<{ x: number; y: number; texto: string; color: string; k: number; anchor?: 'start' | 'middle' | 'end'; size?: number; peso?: number; linea?: [number, number, number, number] }> = ({
  x, y, texto, color, k, anchor = 'start', size = 30, peso = 600, linea,
}) => (
  <g opacity={k}>
    {linea && <line x1={linea[0]} y1={linea[1]} x2={linea[2]} y2={linea[3]} stroke={color} strokeWidth={2} />}
    <text x={x} y={y + (1 - k) * 8} textAnchor={anchor} fontFamily={FUENTE} fontWeight={peso} fontSize={size} fill={color}>
      {texto}
    </text>
  </g>
);

// ---------- Escena completa ----------
export const EscenaReactor: React.FC<{ t: number }> = ({ t }) => {
  const avance = Math.min(Math.max((t - T.inicio) / 20.8, 0), 1);
  const dx = lerp(-14, 14, avance); // deriva lenta constante
  const s = lerp(1, 1.025, avance);
  const kE = golpe(t, T.explota);
  const verdes = mezcla(C.seguro, C.gris, kE);
  const kVerdes = 1 - 0.6 * kE;
  return (
    <>
      <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(960 540) scale(${s}) translate(${-960 + dx} -540)`}>
          <line x1={60} y1={SUELO} x2={1860} y2={SUELO} stroke={C.linea} strokeWidth={3} />
          <Escudo t={t} />
          <Reactor t={t} />
          <Ciudad t={t} />
          <Consola t={t} />
          <Personaje t={t} />
          <Lupa t={t} />
          <Escombros t={t} />

          {/* tarjeta del ingeniero */}
          <g opacity={entra(t, T.edad)}>
            <line x1={250} y1={392} x2={318} y2={452} stroke={C.linea} strokeWidth={2} />
            <rect x={140} y={300} width={220} height={92} fill="#FFFFFF" stroke="#C5CDD5" strokeWidth={2} />
            <text x={160} y={346} fontFamily={FUENTE} fontWeight={700} fontSize={36} fill={C.tinta}>25 años</text>
            <text x={160} y={374} fontFamily={FUENTE} fontSize={18} fill={C.textoClaro}>el ingeniero</text>
          </g>

          <Etiqueta x={1260} y={205} anchor="middle" texto="Reactor 4" color={C.tinta} k={entra(t, T.numero) * (1 - golpe(t, T.explota, 0.15))} />
          <Etiqueta x={1515} y={430} texto="último recurso" color={verdes} k={entra(t, T.ultimo) * kVerdes} linea={[1490, 438, 1508, 438]} />
          <Etiqueta x={1060} y={700} anchor="end" texto="freno de mano" color={verdes} k={entra(t, T.freno) * kVerdes} linea={[1070, 692, 1188, 692]} />
          <Etiqueta x={1260} y={130} anchor="middle" texto="explota" color={C.peligro} k={golpe(t, T.explota)} size={46} peso={700} />
        </g>
      </svg>
      <TituloEscena
        t={t}
        oscuro={false}
        partes={[
          { text: 'Sala de control', at: T.sala },
          { text: '\u00a0·\u00a0Chernobyl', at: T.reactor },
        ]}
      />
    </>
  );
};
