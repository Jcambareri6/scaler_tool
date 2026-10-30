import { alignScriptTokens, tokenizeScript, type TokenTiming } from "../lib/wordAlignment.js";
import type { TranscribedWord } from "../tools/transcribeAudio.tool.js";

// Frases con su tiempo para el formato todo animado: el director de escenas
// ata cada paso a una frase ("p12"), y aca se sabe en que segundo la dice la
// voz. Las frases se cortan al terminar una oracion, en ; o : y en comas si
// la frase ya es larga, para que los pasos puedan caer a mitad de oracion.

export interface Phrase {
  id: string;
  text: string;
  start: number;
  end: number;
  // Palabras con su tiempo (subtitulos y pasos finos).
  words: { text: string; start: number; end: number }[];
}

// Una coma corta la frase recien con estas palabras acumuladas.
const COMMA_MIN_WORDS = 6;

export function buildPhrases(sceneTexts: string[], transcribed: TranscribedWord[]): Phrase[] {
  const tokens = sceneTexts.flatMap((t) => tokenizeScript(t));
  if (tokens.length === 0) return [];
  const timings: TokenTiming[] = transcribed.length > 0 ? alignScriptTokens(tokens, transcribed) : estimate(tokens);

  const phrases: Phrase[] = [];
  let current: Phrase["words"] = [];
  tokens.forEach((token, i) => {
    const timing = timings[i] ?? { start: 0, end: 0 };
    current.push({ text: token, start: timing.start, end: timing.end });
    const last = i === tokens.length - 1;
    const cut =
      last ||
      /[.!?…]["»”)]*$/.test(token) ||
      /[;:]["»”)]*$/.test(token) ||
      (current.length >= COMMA_MIN_WORDS && /,["»”)]*$/.test(token));
    if (cut) {
      phrases.push({
        id: `p${phrases.length + 1}`,
        text: current.map((w) => w.text).join(" "),
        start: current[0]!.start,
        end: current[current.length - 1]!.end,
        words: current,
      });
      current = [];
    }
  });
  return phrases;
}

// Sin transcripcion: ~2,5 palabras por segundo.
function estimate(tokens: string[]): TokenTiming[] {
  return tokens.map((_, i) => ({ start: i / 2.5, end: (i + 1) / 2.5 }));
}
