import React, { useMemo } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import mundo from 'world-atlas/countries-50m.json';
import { C, FUENTE, MONO } from './tema';
import { entra, lerp } from './util';

// Tiempos de palabra (de guion-30s-palabras.json)
const T = { d26: 0, abril: 1.22, a1986: 1.78, h1: 4.1, madrugada: 5.34, central: 6.58, chernobyl: 7.5, ucrania: 8.64 };
const UCRANIA = '804';
const PUNTO: [number, number] = [30.099, 51.389]; // solo para ubicar el pin; no se muestra

export const EscenaMapa: React.FC<{ t: number }> = ({ t }) => {
  const { paths, ucr, pin } = useMemo(() => {
    const geo: any = feature(mundo as any, (mundo as any).objects.countries);
    const caja = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-10, 36], [-10, 62], [52, 62], [52, 36], [-10, 36]]] },
    } as any;
    const proj = geoMercator().fitSize([1920, 1080], caja);
    const p = geoPath(proj);
    const paths = geo.features.map((f: any) => ({ id: f.id, d: p(f) || '' }));
    return { paths, ucr: paths.find((x: any) => x.id === UCRANIA)?.d, pin: proj(PUNTO) as [number, number] };
  }, []);

  // Cámara: acercamiento lento y continuo hacia Chernobyl durante toda la escena.
  const k = Math.min(t / 10, 1);
  const zoom = lerp(1, 1.55, k);
  const cx = lerp(960, pin[0], k * 0.85);
  const cy = lerp(540, pin[1], k * 0.85);

  const kUcr = entra(t, T.central, 0.6);
  const kPin = entra(t, T.chernobyl, 0.35);
  const kNombre = entra(t, T.ucrania);
  const pulso = ((t - T.chernobyl) % 1.6) / 1.6;

  return (
    <>
      <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(960 540) scale(${zoom}) translate(${-cx} ${-cy})`}>
          {paths.map((p: any, i: number) => (
            <path key={i} d={p.d} fill="#15253D" stroke="#2C4466" strokeWidth={1 / zoom} />
          ))}
          <path
            d={ucr}
            fill={`rgba(0,104,176,${0.32 * kUcr})`}
            stroke={`rgba(77,163,224,${kUcr})`}
            strokeWidth={2 / zoom}
          />
          {t >= T.chernobyl && (
            <g transform={`translate(${pin[0]} ${pin[1]})`}>
              <circle r={(6 + pulso * 26) / zoom} fill="none" stroke={C.resaltadoOscuro} strokeWidth={2 / zoom} opacity={(1 - pulso) * kPin} />
              <circle r={(6 / zoom) * kPin} fill="#FFFFFF" />
            </g>
          )}
        </g>
      </svg>

      {/* Etiqueta pegada al pin (en coordenadas de pantalla) */}
      {(() => {
        const sx = 960 + (pin[0] - cx) * zoom;
        const sy = 540 + (pin[1] - cy) * zoom;
        return (
          <>
            <div
              style={{
                position: 'absolute',
                left: sx + 22,
                top: sy - 30,
                opacity: kPin,
                transform: `translateX(${(1 - kPin) * -10}px)`,
                fontFamily: FUENTE,
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 700, color: '#FFFFFF', letterSpacing: 1 }}>CHERNOBYL</div>
              <div style={{ fontSize: 18, color: C.textoOscuro, marginTop: 2 }}>central nuclear</div>
            </div>
            <div
              style={{
                position: 'absolute',
                left: sx - 170,
                top: sy + 110,
                opacity: kNombre * 0.85,
                fontFamily: MONO,
                fontSize: 17,
                letterSpacing: 4,
                color: C.resaltadoOscuro,
              }}
            >
              UCRANIA SOVIÉTICA
            </div>
          </>
        );
      })()}

      {/* Fecha y hora que se escriben con la voz (arriba a la izquierda) */}
      <div style={{ position: 'absolute', left: 110, top: 190, fontFamily: MONO, color: '#E6ECF2' }}>
        <div style={{ fontSize: 46, letterSpacing: 4 }}>
          <span style={{ opacity: entra(t, T.d26) }}>26</span>
          <span style={{ opacity: entra(t, T.abril) }}>/04</span>
          <span style={{ opacity: entra(t, T.a1986) }}>/1986</span>
        </div>
        <div style={{ fontSize: 120, fontWeight: 300, marginTop: 10, opacity: entra(t, T.h1), letterSpacing: 6 }}>01:23</div>
        <div style={{ fontFamily: FUENTE, fontSize: 22, color: C.textoOscuro, opacity: entra(t, T.madrugada), marginTop: 4 }}>
          de la madrugada
        </div>
      </div>
    </>
  );
};
