import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/300.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import { Encabezado, Fondo, Subtitulo } from './Capas';
import { EscenaMapa } from './EscenaMapa';
import { EscenaReactor } from './EscenaReactor';

export const FPS = 30;
export const DURACION = 30.68;
const CAMBIO = 9.92; // "En la sala de control…"

export const Clip: React.FC = () => {
  const [handle] = useState(() => delayRender('fuentes'));
  useEffect(() => {
    Promise.all([
      document.fonts.load('600 30px Inter'),
      document.fonts.load('700 30px Inter'),
      document.fonts.load('400 30px "JetBrains Mono"'),
      document.fonts.load('300 30px "JetBrains Mono"'),
    ]).then(() => continueRender(handle));
  }, [handle]);

  const t = useCurrentFrame() / FPS;
  // Fundido cruzado de 0,6 s entre escenas (la referencia casi nunca corta seco)
  const k = interpolate(t, [CAMBIO, CAMBIO + 0.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const oscuro = k < 0.5;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Audio src={staticFile('voz.mp3')} />
      <AbsoluteFill style={{ opacity: 1 - k }}>
        <Fondo oscuro />
        <EscenaMapa t={t} />
      </AbsoluteFill>
      {k > 0 && (
        <AbsoluteFill style={{ opacity: k }}>
          <Fondo oscuro={false} />
          <EscenaReactor t={t} />
        </AbsoluteFill>
      )}
      <Encabezado oscuro={oscuro} />
      <Subtitulo t={t} oscuro={oscuro} />
    </AbsoluteFill>
  );
};
