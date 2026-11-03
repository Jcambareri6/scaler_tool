import type { FC } from "react";
import { entra, golpe, mecanismo, mezcla, T } from "../recursos/comun";
import { DOC } from "../scenes/palette";
import type { Significado } from "../recursos/tipos";

// Biblioteca BASE compartida entre videos: dibujos hechos en codigo con el
// estilo de la referencia (perfil, relleno plano, linea fina, sin texturas).
// Cada objeto se dibuja en sus coordenadas locales (0..ancho, 0..alto) y el
// esquema lo escala a su lugar. Las partes con nombre reciben el segundo en
// que les pasa algo; el objeto sabe como moverlas (la IA solo dice cuando).

export interface EstadoParte {
  at: number;
  significado?: Significado | undefined;
}

export interface PropsObjeto {
  t: number;
  partes: Record<string, EstadoParte | undefined>;
  // Segundo del evento (remate) sobre este objeto, si hay.
  evento?: number | undefined;
}

export interface ObjetoBase {
  nombre: string;
  ancho: number;
  alto: number;
  // Puntos de las partes en coordenadas locales (lupa, etiquetas, personaje).
  anclas: Record<string, [number, number]>;
  Dibujo: FC<PropsObjeto>;
  // Vista ampliada de una parte para la lupa (centro 0,0, radio 135).
  Detalle?: FC<{ t: number; parte: string; accion?: number | undefined }>;
}

// ---------- Consola de control (sala de control, tablero, panel) ----------
const Consola: ObjetoBase = {
  nombre: "Consola de control",
  ancho: 400,
  alto: 350,
  anclas: { boton: [65, 168], pantallas: [280, 40] },
  Dibujo: ({ t, partes }) => {
    const p = partes.boton?.at;
    const baja = golpe(t, p === undefined ? undefined : p + 0.2, 0.15) * 6;
    const destello = entra(t, p === undefined ? undefined : p + 0.2, 0.2) * (1 - entra(t, p === undefined ? undefined : p + 0.5, 0.6));
    return (
      <g>
        <rect x={160} y={0} width={240} height={190} fill={T.rellenoSuave} stroke={T.linea} strokeWidth={3} />
        {[0, 1, 2].map((i) => (
          <rect key={i} x={180 + i * 70} y={20} width={60} height={40} fill={T.linea} />
        ))}
        {[0, 1, 2].map((i) => (
          <rect key={i} x={180} y={80 + i * 22} width={200 - i * 40} height={8} fill={T.gris} opacity={0.6} />
        ))}
        <rect x={0} y={190} width={400} height={160} fill={T.relleno} stroke={T.linea} strokeWidth={3} />
        <rect x={40} y={176} width={50} height={14} fill={T.linea} />
        <rect x={48} y={160 + baja} width={34} height={16} rx={4} fill={T.tinta} />
        <circle cx={65} cy={168} r={34} fill="none" stroke={DOC.resaltadoClaro} strokeWidth={3} opacity={destello} />
      </g>
    );
  },
  Detalle: ({ accion = 0 }) => (
    <g>
      <rect x={-62} y={-18} width={124} height={36} rx={6} fill={T.linea} />
      <rect x={-42} y={-48} width={84} height={34} rx={8} fill={T.tinta} />
      {/* tapa protectora que se levanta con la accion */}
      <g transform={`rotate(${accion * -75} -60 -50)`}>
        <rect x={-60} y={-56} width={120} height={44} rx={6} fill="rgba(140,160,180,0.25)" stroke={T.linea} strokeWidth={2.5} />
      </g>
    </g>
  ),
};

// ---------- Reactor en corte (deposito, horno, caldera, nucleo) ----------
const Reactor: ObjetoBase = {
  nombre: "Reactor en corte",
  ancho: 400,
  alto: 550,
  anclas: { barras: [128, 462], nucleo: [200, 430], tapa: [200, 157] },
  Dibujo: ({ t, partes, evento }) => {
    const baja = mecanismo(t, partes.barras?.at, 1.6) * 260;
    const n = partes.nucleo;
    const kN = entra(t, n?.at, 0.8);
    const kE = golpe(t, evento);
    const kTapa = entra(t, evento, 0.7);
    const colorN = n?.significado === "peligro" ? DOC.peligro : DOC.seguro;
    const nucleo = kE > 0 ? mezcla(colorN === DOC.peligro ? DOC.peligro : DOC.seguro, DOC.peligro, kE) : colorN;
    return (
      <g>
        <rect x={20} y={170} width={360} height={380} fill={T.rellenoSuave} stroke={T.linea} strokeWidth={3} />
        <rect x={100} y={330} width={200} height={200} fill={T.relleno} stroke={T.linea} strokeWidth={2} />
        <rect x={100} y={330} width={200} height={200} fill={nucleo} opacity={kE > 0 ? 0.6 : 0.28 * kN} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line key={i} x1={120 + i * 32} y1={350} x2={120 + i * 32} y2={515} stroke={T.gris} strokeWidth={8} strokeLinecap="round" />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={131 + i * 32} y={baja} width={10} height={240} fill={T.tinta} rx={2} />
        ))}
        <polyline points="90,172 125,240 105,290 150,355 130,410" fill="none" stroke={DOC.peligro} strokeWidth={5} strokeLinejoin="round" opacity={kE} />
        <polyline points="340,172 312,225 335,275 300,330" fill="none" stroke={DOC.peligro} strokeWidth={5} strokeLinejoin="round" opacity={kE} />
        <rect x={0} y={142} width={200} height={30} fill={T.linea} transform={`translate(${-70 * kTapa} ${-160 * kTapa}) rotate(${-28 * kTapa} 100 157)`} />
        <rect x={200} y={142} width={200} height={30} fill={T.linea} transform={`translate(${80 * kTapa} ${-180 * kTapa}) rotate(${34 * kTapa} 300 157)`} />
      </g>
    );
  },
};

// ---------- Ciudad (destino de la energia, poblacion) ----------
const EDIFICIOS = [
  [0, 40, 50, 140],
  [60, 0, 60, 180],
  [130, 60, 45, 120],
  [185, 20, 55, 160],
] as const;
const Ciudad: ObjetoBase = {
  nombre: "Ciudad",
  ancho: 240,
  alto: 180,
  anclas: { ventanas: [90, 60] },
  Dibujo: ({ t, partes }) => {
    let n = 0;
    const luces = partes.ventanas?.at;
    return (
      <g>
        {EDIFICIOS.map(([x, y, w, h], i) => (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} fill={T.rellenoSuave} stroke={T.linea} strokeWidth={2.5} />
            {Array.from({ length: Math.floor((h - 20) / 22) }).map((_, r) =>
              Array.from({ length: Math.floor((w - 10) / 18) }).map((__, c) => {
                const idx = n++;
                const luz = entra(t, luces === undefined ? undefined : luces + idx * 0.025, 0.25);
                return <rect key={`${r}-${c}`} x={x + 9 + c * 18} y={y + 12 + r * 22} width={9} height={10} fill={mezcla("#C3CBD3", T.dato2, luz)} />;
              })
            )}
          </g>
        ))}
      </g>
    );
  },
};

export const BIBLIOTECA: Record<string, ObjetoBase> = {
  consola: Consola,
  reactor_corte: Reactor,
  ciudad: Ciudad,
};
