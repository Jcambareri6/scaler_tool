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
  // Caja de cada parte [x0, y0, x1, y1] (dibujos del Dibujante): la lupa la usa para ampliar.
  cajas?: Record<string, [number, number, number, number]>;
  // Partes con suficiente detalle para ampliarlas con la lupa.
  conDetalle?: string[];
  // Fraccion del alto bajo el agua cuando flota (si no, la del escenario).
  calado?: number;
  // Rellenos mayormente oscuros: en escenas de noche se invierten (si son
  // claros solo se oscurecen un poco: el hielo tiene que seguir blanco).
  oscuro?: boolean;
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
    // El nucleo se tiñe segun el significado; "neutro" (o sin significado) no se tiñe.
    const sig = n?.significado;
    const colorN = sig === "peligro" ? DOC.peligro : sig === "seguro" ? DOC.seguro : sig === "foco" ? DOC.foco : null;
    const nucleo = kE > 0 ? mezcla(colorN ?? T.relleno, DOC.peligro, kE) : (colorN ?? T.relleno);
    return (
      <g>
        <rect x={20} y={170} width={360} height={380} fill={T.rellenoSuave} stroke={T.linea} strokeWidth={3} />
        <rect x={100} y={330} width={200} height={200} fill={T.relleno} stroke={T.linea} strokeWidth={2} />
        <rect x={100} y={330} width={200} height={200} fill={nucleo} opacity={kE > 0 ? 0.6 : colorN ? 0.28 * kN : 0} />
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

// ---------- Dibujos del video (Dibujante) como objeto del esquema ----------
// Un componente SVG con partes con nombre (data-part) que no esta en la base.
// "parte" con significado pinta esa parte (seguro, peligro, foco); sin
// significado la parte se resalta en foco. El evento la tiñe de rojo con grietas.
export interface ComponenteSvg {
  id: string;
  name: string;
  width: number;
  height: number;
  svg: string;
  parts: Record<string, string | null>;
  // Fraccion del alto bajo el agua cuando flota (iceberg ~0.85, barco ~0.25).
  calado?: number;
}

const COLOR_SIG: Record<string, string> = { seguro: DOC.seguro, peligro: DOC.peligro, foco: DOC.foco };

// Caja aproximada de cada parte, leyendo las coordenadas absolutas de sus
// formas (sin aplicar transforms): alcanza para anclar etiquetas y la lupa en
// la parte y no en el centro del dibujo.
// Cuantas formas tiene cada parte (para saber si vale la pena ampliarla).
const CONTEOS = new WeakMap<object, Record<string, number>>();

export function cajasDePartes(svg: string): Record<string, [number, number, number, number]> {
  const cajas: Record<string, [number, number, number, number]> = {};
  const formas: Record<string, number> = {};
  CONTEOS.set(cajas, formas);
  for (const inicio of svg.matchAll(/<g\b[^>]*\b(?:data-part|id)="([a-z][a-z0-9_]*)"[^>]*>/g)) {
    // Contenido hasta el </g> que cierra este grupo.
    let prof = 1;
    let fin = inicio.index! + inicio[0].length;
    const etiquetas = /<(\/?)g\b[^>]*?(\/?)>/g;
    etiquetas.lastIndex = fin;
    for (let m = etiquetas.exec(svg); m && prof > 0; m = etiquetas.exec(svg)) {
      if (m[1]) prof--;
      else if (!m[2]) prof++;
      fin = m.index;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    const num = (s: string) => (s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    for (const f of svg.slice(inicio.index, fin).matchAll(/<(rect|circle|ellipse|line|polyline|polygon|path)\b([^>]*)>/g)) {
      const a: Record<string, number[]> = {};
      for (const [, k, v] of f[2]!.matchAll(/([a-z0-9-]+)="([^"]*)"/g)) a[k!] = num(v!);
      const v1 = (k: string) => a[k]?.[0] ?? 0;
      if (f[1] === "rect") xs.push(v1("x"), v1("x") + v1("width")), ys.push(v1("y"), v1("y") + v1("height"));
      else if (f[1] === "circle") xs.push(v1("cx") - v1("r"), v1("cx") + v1("r")), ys.push(v1("cy") - v1("r"), v1("cy") + v1("r"));
      else if (f[1] === "ellipse") xs.push(v1("cx") - v1("rx"), v1("cx") + v1("rx")), ys.push(v1("cy") - v1("ry"), v1("cy") + v1("ry"));
      else if (f[1] === "line") xs.push(v1("x1"), v1("x2")), ys.push(v1("y1"), v1("y2"));
      else {
        // points o d: pares x,y (los comandos relativos quedan aproximados).
        const n = a.points ?? (/[a-z]/.test(f[2]!.match(/\bd="([^"]*)"/)?.[1] ?? "") ? [] : a.d) ?? [];
        for (let i = 0; i + 1 < n.length; i += 2) xs.push(n[i]!), ys.push(n[i + 1]!);
      }
    }
    if (xs.length) cajas[inicio[1]!] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    formas[inicio[1]!] = (svg.slice(inicio.index, fin).match(/<(rect|circle|ellipse|line|polyline|polygon|path)/g) ?? []).length;
  }
  return cajas;
}

// Brillo medio de los rellenos del dibujo (#rgb / #rrggbb): mayormente oscuro?
function rellenoOscuro(svg: string): boolean {
  const lums = [...svg.matchAll(/fill="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})"/g)].map((m) => {
    const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  });
  return lums.length > 0 && lums.reduce((a, b) => a + b, 0) / lums.length < 0.45;
}

// Vida del objeto: balanceo leve y continuo (nunca queda una figura muerta).
const VAIVEN_S = 3.4;
// Fraccion del dibujo a partir de la cual una "parte" es el objeto entero.
const PARTE_GRANDE = 0.35;
// Formas minimas para que ampliar una parte con la lupa muestre algo.
const LUPA_FORMAS = 4;

export function objetoDesdeSvg(comp: ComponenteSvg): ObjetoBase {
  const cajas = cajasDePartes(comp.svg);
  const anclas: Record<string, [number, number]> = {};
  for (const parte of Object.keys(comp.parts)) {
    const c = cajas[parte];
    anclas[parte] = c
      ? [Math.min(Math.max((c[0] + c[2]) / 2, 0), comp.width), Math.min(Math.max((c[1] + c[3]) / 2, 0), comp.height)]
      : [comp.width / 2, comp.height / 2];
  }
  return {
    nombre: comp.name,
    ancho: comp.width,
    alto: comp.height,
    anclas,
    cajas,
    conDetalle: Object.keys(cajas).filter((p) => (CONTEOS.get(cajas)?.[p] ?? 0) >= LUPA_FORMAS),
    ...(typeof comp.calado === "number" && comp.calado >= 0 && comp.calado <= 0.95 ? { calado: comp.calado } : {}),
    oscuro: rellenoOscuro(comp.svg),
    Dibujo: ({ t, partes, evento }) => {
      const sel = `[data-obj="${comp.id}"]`;
      // Parte marcada por la voz: se pinta con un fundido, da un golpe de
      // escala y brilla un momento; despues queda pintada.
      const reglas = Object.entries(partes)
        .filter(([, e]) => e && t >= e.at)
        .map(([parte, e]) => {
          const color = COLOR_SIG[e!.significado ?? "foco"] ?? DOC.foco;
          const kColor = entra(t, e!.at, 0.4);
          const pop = golpe(t, e!.at, 0.18) * (1 - entra(t, e!.at + 0.18, 0.5));
          const brillo = 1 - entra(t, e!.at + 0.3, 1.2);
          const p = `${sel} [data-part="${parte}"]`;
          // Parte que es casi todo el objeto (el iceberg, el casco entero): no se
          // pinta (quedaba un objeto naranja), se marca con contorno y brillo.
          const c = cajas[parte];
          const grande = c ? ((c[2] - c[0]) * (c[3] - c[1])) / Math.max(1, comp.width * comp.height) > PARTE_GRANDE : false;
          if (grande) return `${p},${p} *{stroke:${mezcla(T.linea, color, kColor)}}${p}{filter:drop-shadow(0 0 ${4 + 10 * brillo}px ${color})}`;
          return `${p}{transform-box:fill-box;transform-origin:center;transform:scale(${1 + 0.14 * pop});filter:drop-shadow(0 0 ${10 * brillo}px ${color})}${p},${p} *:not([fill="none"]){fill:${mezcla(T.relleno, color, kColor)}}`;
        })
        .join("");
      const kE = golpe(t, evento);
      // Evento: sacudida corta y seca sobre el objeto.
      const tE = evento === undefined ? -1 : t - evento;
      const sacude = tE >= 0 && tE < 0.5 ? Math.sin(tE * 70) * 9 * (1 - tE / 0.5) : 0;
      const fase = (t / VAIVEN_S) * Math.PI * 2;
      const vaiven = `translate(${sacude} ${Math.sin(fase) * 3}) rotate(${Math.sin(fase + 1) * 0.5} ${comp.width / 2} ${comp.height})`;
      return (
        <g data-obj={comp.id} transform={vaiven}>
          <style dangerouslySetInnerHTML={{ __html: reglas }} />
          <svg x={0} y={0} width={comp.width} height={comp.height} viewBox={`0 0 ${comp.width} ${comp.height}`} overflow="visible" style={{ color: T.linea, ["--accent" as string]: DOC.foco }} dangerouslySetInnerHTML={{ __html: comp.svg }} />
          {kE > 0 && (
            <>
              <polyline points={`${comp.width * 0.3},0 ${comp.width * 0.4},${comp.height * 0.2} ${comp.width * 0.33},${comp.height * 0.35} ${comp.width * 0.45},${comp.height * 0.55}`} fill="none" stroke={DOC.peligro} strokeWidth={5} opacity={kE} />
            </>
          )}
        </g>
      );
    },
  };
}
