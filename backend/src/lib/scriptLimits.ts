import { envInt } from "./env.js";

// Tope de largo del guion: limita lo que puede costar generar la voz (ai33
// cobra por caracter) y la transcripcion de Whisper. Se puede ajustar por
// env var sin tocar codigo.
export const MAX_SCRIPT_CHARS = envInt("MAX_SCRIPT_CHARS", 35000);

export function scriptTooLongMessage(length: number): string {
  return (
    `El guion tiene ${length.toLocaleString("es-AR")} caracteres y el máximo es ` +
    `${MAX_SCRIPT_CHARS.toLocaleString("es-AR")}. Acortalo para poder seguir.`
  );
}

// scripts.content es jsonb con el texto narrado en `text`.
export function scriptTextOf(content: unknown): string {
  const text = (content as { text?: unknown } | null)?.text;
  return typeof text === "string" ? text : "";
}
