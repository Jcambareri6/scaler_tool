// Subtitulos palabra por palabra del preview: copia de la parte de tramos de
// backend/src/lib/captions.ts (el render quema lo mismo como .ass), mantener
// los dos iguales.
export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

// Cue de timelines.content.segments (build_timeline). `words` existe desde
// los subtitulos palabra por palabra; los timelines viejos no lo tienen.
export interface CaptionCue {
  text: string;
  start: number;
  end: number;
  words?: { start: number; end: number }[];
}

export interface CaptionChunk {
  start: number;
  end: number;
  words: CaptionWord[];
}

// Las referencias muestran 3 a 5 palabras por vez: con 8 (lo que agrupa
// build_timeline) la palabra resaltada se pierde en la linea.
export const WORDS_PER_CHUNK = 4;

// Timing de cada palabra del cue: el de Whisper si esta, si no se reparte
// la duracion del cue segun el largo de cada palabra.
export function cueWords(cue: CaptionCue): CaptionWord[] {
  const texts = cue.text.trim().split(/\s+/).filter(Boolean);
  if (cue.words && cue.words.length === texts.length) {
    return texts.map((text, i) => ({ text, start: cue.words![i]!.start, end: cue.words![i]!.end }));
  }
  const totalChars = texts.reduce((sum, t) => sum + t.length, 0) || 1;
  let at = cue.start;
  return texts.map((text) => {
    const duration = ((cue.end - cue.start) * text.length) / totalChars;
    const word = { text, start: at, end: at + duration };
    at += duration;
    return word;
  });
}

// Pausa de la voz a partir de la cual se corta el tramo aunque no haya
// puntuacion.
const PAUSE_SECONDS = 0.6;

// Tramos de hasta WORDS_PER_CHUNK palabras sobre todas las palabras seguidas
// (los cues de build_timeline cortan cada 8 palabras, a mitad de frase).
// Primero frases: se corta al terminar una oracion, en una coma si ya hay 2
// palabras, o en una pausa de la voz. Despues cada frase se reparte en
// tramos parejos (9 -> 3+3+3, 5 -> 3+2), para no dejar una palabra sola.
export function captionChunks(cues: CaptionCue[], maxWords = WORDS_PER_CHUNK): CaptionChunk[] {
  const words = cues.flatMap(cueWords);
  const phrases: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  words.forEach((word, i) => {
    current.push(word);
    const next = words[i + 1];
    const cut =
      !next ||
      /[.!?…]["»”)]*$/.test(word.text) ||
      (current.length >= 2 && /[,;:]["»”)]*$/.test(word.text)) ||
      next.start - word.end > PAUSE_SECONDS;
    if (cut) {
      phrases.push(current);
      current = [];
    }
  });
  const chunks: CaptionChunk[] = [];
  for (const phrase of phrases) {
    const size = Math.ceil(phrase.length / Math.ceil(phrase.length / maxWords));
    for (let i = 0; i < phrase.length; i += size) {
      const slice = phrase.slice(i, i + size);
      chunks.push({ start: slice[0]!.start, end: slice[slice.length - 1]!.end, words: slice });
    }
  }
  return chunks;
}

