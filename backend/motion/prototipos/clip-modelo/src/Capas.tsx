import React from 'react';
import { C, FUENTE, MONO } from './tema';
import { entra } from './util';
import palabras from './palabras.json';

type Palabra = { text: string; start: number; end: number };
type Frase = { id: string; text: string; start: number; end: number; words: Palabra[] };

// Cortamos cada frase en grupos de hasta 7 palabras, como la referencia.
const grupos: { start: number; end: number; words: Palabra[] }[] = [];
(palabras as Frase[]).forEach((f) => {
  for (let i = 0; i < f.words.length; i += 7) {
    const ws = f.words.slice(i, i + 7);
    grupos.push({ start: ws[0].start, end: f.end, words: ws });
  }
});

// Subtítulo abajo al centro: crece palabra por palabra y resalta la actual.
export const Subtitulo: React.FC<{ t: number; oscuro: boolean }> = ({ t, oscuro }) => {
  const idx = grupos.findIndex((g, i) => t >= g.start && (i === grupos.length - 1 || t < grupos[i + 1].start));
  if (idx < 0) return null;
  const g = grupos[idx];
  if (t > g.end + 0.6) return null;
  const visibles = g.words.filter((w) => w.start <= t);
  const actual = visibles.length - 1;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 64,
        width: '100%',
        textAlign: 'center',
        fontFamily: FUENTE,
        fontSize: 38,
        fontWeight: 500,
        color: oscuro ? C.textoOscuro : C.textoClaro,
        letterSpacing: 0.2,
      }}
    >
      {visibles.map((w, i) => (
        <span
          key={i}
          style={
            i === actual
              ? {
                  color: oscuro ? C.resaltadoOscuro : C.resaltado,
                  textDecoration: 'underline',
                  textUnderlineOffset: 6,
                  textDecorationThickness: 2,
                }
              : undefined
          }
        >
          {w.text}{' '}
        </span>
      ))}
    </div>
  );
};

// Encabezado fijo: capítulo arriba a la derecha.
export const Encabezado: React.FC<{ oscuro: boolean }> = ({ oscuro }) => (
  <div
    style={{
      position: 'absolute',
      top: 34,
      right: 48,
      fontFamily: MONO,
      fontSize: 15,
      letterSpacing: 2,
      color: oscuro ? 'rgba(201,211,222,0.55)' : 'rgba(58,69,82,0.55)',
    }}
  >
    <span style={{ color: oscuro ? C.resaltadoOscuro : C.resaltado }}>● </span>CAP. 1 · EL BOTÓN FINAL
  </div>
);

// Título de escena arriba a la izquierda, con partes que entran en su palabra.
export const TituloEscena: React.FC<{ t: number; partes: { text: string; at: number }[]; oscuro: boolean }> = ({
  t,
  partes,
  oscuro,
}) => (
  <div
    style={{
      position: 'absolute',
      top: 30,
      left: 48,
      fontFamily: FUENTE,
      fontWeight: 600,
      fontSize: 30,
      color: oscuro ? '#E6ECF2' : C.tinta,
    }}
  >
    {partes.map((p, i) => {
      const k = entra(t, p.at);
      return (
        <span key={i} style={{ opacity: k, display: 'inline-block', transform: `translateY(${(1 - k) * 8}px)` }}>
          {p.text}
        </span>
      );
    })}
  </div>
);

// Fondo con viñeta suave.
export const Fondo: React.FC<{ oscuro: boolean }> = ({ oscuro }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: oscuro
        ? `radial-gradient(ellipse at 50% 45%, #0B1424 0%, ${C.fondoOscuro} 75%)`
        : `radial-gradient(ellipse at 50% 45%, #F3F5F7 0%, ${C.fondoClaro} 60%, #D3D9DF 100%)`,
    }}
  />
);
