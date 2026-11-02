import React from 'react';
import { Composition } from 'remotion';
import { Clip, FPS, DURACION } from './Clip';

export const Root: React.FC = () => (
  <Composition
    id="Clip"
    component={Clip}
    durationInFrames={Math.ceil(DURACION * FPS)}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
