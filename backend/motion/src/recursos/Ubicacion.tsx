import { useMemo } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { countries, countryAt } from "../lib/geo";
import { DOC } from "../scenes/palette";
import { entra, lerp, mecanismo, momento } from "./comun";
import type { ContenidoUbicacion, Recurso } from "./tipos";

// UBICACION (catalogo #16): mapa oscuro con capas que entran con la voz. En
// la referencia: mapa de Toledo y de Espana (AVE), globo de Amagasaki,
// Montreal y Budapest (Control mental). Lo fijo: mapa azul noche, acercamiento
// lento y continuo hacia el lugar, pin que late con su nombre, fecha y hora
// arriba a la izquierda. Lo que cambia: lugar, coordenada, fecha, hora y region.
//
// Momentos (hace): fecha (parte: dia | mes | anio), hora, hora_nota, pais,
// lugar, region. El pais a resaltar sale de la coordenada (lib/geo).

const ACERCAMIENTO_S = 4;
const PULSOS = 3;

// El director a veces manda el mes como palabra ("abril"): siempre numero.
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const numero = (n: number | string | undefined) => {
  if (typeof n === "string" && !/^\d+$/.test(n.trim())) {
    const i = MESES.indexOf(n.trim().toLowerCase().replace("setiembre", "septiembre"));
    return i >= 0 ? i + 1 : undefined;
  }
  return n === undefined ? undefined : Number(n);
};
const dos = (n: number | string | undefined) => {
  const v = numero(n);
  return v === undefined || Number.isNaN(v) ? "" : String(v).padStart(2, "0");
};

export function Ubicacion({ t, rec, inicio, fin }: { t: number; rec: Recurso; inicio: number; fin: number }) {
  const c = rec.contenido as ContenidoUbicacion;
  const punto: [number, number] = [c.geo.lon, c.geo.lat];

  const { paths, pais, pin } = useMemo(() => {
    // Recuadro alrededor del lugar (Europa entera para Chernobyl).
    const caja = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Polygon" as const,
        coordinates: [[[punto[0] - 40, punto[1] - 15], [punto[0] - 40, punto[1] + 11], [punto[0] + 22, punto[1] + 11], [punto[0] + 22, punto[1] - 15], [punto[0] - 40, punto[1] - 15]]],
      },
    };
    const proj = geoMercator().fitSize([1920, 1080], caja);
    const p = geoPath(proj);
    const paises = countries();
    const elegido = countryAt(punto[0], punto[1]);
    return {
      paths: paises.map((f) => p(f) ?? ""),
      pais: elegido ? (p(elegido) ?? "") : "",
      pin: (proj(punto) ?? [960, 540]) as [number, number],
    };
  }, [punto[0], punto[1]]);

  // Acercamiento hacia el lugar en los primeros segundos (llega y se queda),
  // despues una deriva minima: antes duraba toda la escena y se sentia en loop.
  const llegada = mecanismo(t, inicio, Math.min(ACERCAMIENTO_S, Math.max(1, fin - inicio)));
  const deriva = Math.min(Math.max((t - inicio) / Math.max(1, fin - inicio), 0), 1);
  const k = Math.min(1, llegada * 0.92 + deriva * 0.08);
  const zoom = lerp(1, 1.55, k);
  const cx = lerp(960, pin[0], k * 0.85);
  const cy = lerp(540, pin[1], k * 0.85);
  const sx = 960 + (pin[0] - cx) * zoom;
  const sy = 540 + (pin[1] - cy) * zoom;

  const at = (hace: string, parte?: string) => momento(rec, hace, (m) => !parte || m.parte === parte)?.at;
  const kPais = entra(t, at("pais"), 0.6);
  // El pin entra al terminar el acercamiento, o antes si la voz nombra el
  // lugar antes: un mapa sin pin es un mapa vacio (el "Atlantico Norte" se
  // nombraba en el segundo 23 de una escena de 24).
  const aLugar = Math.min(at("lugar") ?? Infinity, inicio + Math.min(ACERCAMIENTO_S, Math.max(1, fin - inicio) * 0.5));
  const kPin = entra(t, aLugar, 0.35);
  const kRegion = entra(t, at("region"));
  // El pin late PULSOS veces y queda fijo.
  const desdeLugar = aLugar === undefined ? -1 : t - aLugar;
  const pulso = desdeLugar < 0 || desdeLugar > PULSOS * 1.6 ? 1 : (desdeLugar % 1.6) / 1.6;
  const f = c.fecha;
  // Parte de la fecha sin palabra propia: entra con la primera que si la tiene
  // (sin esto quedaba un hueco, "14   /1912").
  const primeraFecha = momento(rec, "fecha")?.at;
  const atFecha = (parte: string) => at("fecha", parte) ?? primeraFecha;

  return (
    <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 45%, #0B1424 0%, ${DOC.fondoOscuro} 75%)` }}>
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <g transform={`translate(960 540) scale(${zoom}) translate(${-cx} ${-cy})`}>
          {paths.map((d, i) => (
            <path key={i} d={d} fill="#15253D" stroke="#2C4466" strokeWidth={1 / zoom} />
          ))}
          <path d={pais} fill={`rgba(0,104,176,${0.32 * kPais})`} stroke={`rgba(77,163,224,${kPais})`} strokeWidth={2 / zoom} />
          {aLugar !== undefined && t >= aLugar && (
            <g transform={`translate(${pin[0]} ${pin[1]})`}>
              <circle r={(6 + pulso * 26) / zoom} fill="none" stroke={DOC.resaltadoOscuro} strokeWidth={2 / zoom} opacity={(1 - pulso) * kPin} />
              <circle r={(6 / zoom) * kPin} fill="#FFFFFF" />
            </g>
          )}
        </g>
        {/* Etiqueta pegada al pin */}
        <g opacity={kPin} transform={`translate(${(1 - kPin) * -10} 0)`}>
          <text x={sx + 22} y={sy - 2} fontFamily="Inter, sans-serif" fontWeight={800} fontSize={44} letterSpacing={1} fill="#FFFFFF">
            {c.lugar.toUpperCase()}
          </text>
          {c.subtitulo && (
            <text x={sx + 22} y={sy + 30} fontFamily="Inter, sans-serif" fontSize={24} fill={DOC.apagadoOscuro}>
              {c.subtitulo}
            </text>
          )}
        </g>
        {c.region && (
          <text x={sx - 170} y={sy + 125} fontFamily="Inter, sans-serif" fontWeight={600} fontSize={22} letterSpacing={4} fill={DOC.resaltadoOscuro} opacity={kRegion * 0.85}>
            {c.region.toUpperCase()}
          </text>
        )}
      </svg>

      {/* Fecha (DD/MM/AAAA) y hora que se escriben con la voz */}
      {(f || c.hora) && (
        <div style={{ position: "absolute", left: "5.7%", top: "17.6%", fontFamily: "Inter, sans-serif", color: "#E6ECF2", fontVariantNumeric: "tabular-nums" }}>
          {f && (
            <div style={{ fontSize: "2.4vw", letterSpacing: "0.2vw" }}>
              <span style={{ opacity: entra(t, atFecha("dia")) }}>{dos(f.dia)}</span>
              <span style={{ opacity: entra(t, atFecha("mes")) }}>{f.mes !== undefined ? `${f.dia !== undefined ? "/" : ""}${dos(f.mes)}` : ""}</span>
              <span style={{ opacity: entra(t, atFecha("anio")) }}>{f.anio !== undefined ? `${f.dia !== undefined || f.mes !== undefined ? "/" : ""}${f.anio}` : ""}</span>
            </div>
          )}
          {c.hora && <div style={{ fontSize: "6.25vw", fontWeight: 400, marginTop: "0.5vw", letterSpacing: "0.3vw", opacity: entra(t, at("hora")) }}>{c.hora}</div>}
          {c.hora_nota && <div style={{ fontSize: "1.5vw", color: "#C9D3DE", opacity: entra(t, at("hora_nota")), marginTop: "0.2vw" }}>{c.hora_nota}</div>}
        </div>
      )}
    </div>
  );
}
