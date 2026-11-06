// Subtitulos palabra por palabra (formato stock con graficos animados): la
// palabra que se esta diciendo va en el color de acento del canal. Se queman
// como .ass (libass, mismo filtro `subtitles` de ffmpeg); el preview del
// frontend arma lo mismo en HTML (frontend_v1/src/lib/captions.ts, mantener
// los dos iguales).

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

function assTime(seconds: number): string {
  const cs = Math.round(Math.max(0, seconds) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

// "#RRGGBB" -> "&H00BBGGRR" (ASS va en BGR, alpha 00 = opaco).
function assColor(hex: string): string {
  const clean = hex.replace("#", "").slice(0, 6).padEnd(6, "0");
  return `&H00${clean.slice(4, 6)}${clean.slice(2, 4)}${clean.slice(0, 2)}`.toUpperCase();
}

function assText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");
}

// Un evento por palabra: el tramo entero visible, con la palabra actual en
// el acento. Cada palabra dura hasta que arranca la siguiente, asi el tramo
// no parpadea entre palabras.
export function buildWordAss(
  cues: CaptionCue[],
  opts: { width: number; height: number; accent: string; text?: string }
): string {
  const fontSize = Math.round(opts.height * 0.058);
  const marginV = Math.round(opts.height * 0.085);
  const outline = Math.max(2, Math.round(opts.height / 360));
  const accent = assColor(opts.accent);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Word,Arial,${fontSize},${assColor(opts.text ?? "#FFFFFF")},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},1,2,${Math.round(opts.width * 0.08)},${Math.round(opts.width * 0.08)},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events: string[] = [];
  for (const chunk of captionChunks(cues)) {
    chunk.words.forEach((word, i) => {
      const start = i === 0 ? chunk.start : word.start;
      const end = i === chunk.words.length - 1 ? chunk.end : chunk.words[i + 1]!.start;
      if (end <= start) return;
      const line = chunk.words
        .map((w, j) => (j === i ? `{\\c${accent}}${assText(w.text)}{\\r}` : assText(w.text)))
        .join(" ");
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Word,,0,0,0,,${line}`);
    });
  }
  return [...header, ...events, ""].join("\n");
}
