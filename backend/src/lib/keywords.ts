const STOP_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "de", "del", "y", "en", "que",
  "a", "con", "por", "para", "es", "su", "al", "se", "lo", "como", "the",
  "an", "of", "and", "in", "to", "is", "on", "for",
]);

// Keywords simples derivadas de un texto libre -- no hay Provider de IA
// dedicado a esto todavia (ver search_stock). Se puede reemplazar sin tocar
// a quien la llama (pipeline/orchestrator.ts y
// modules/scenes/scene.service.ts::regenerateSceneVisual).
export function deriveKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9á-úñ\s]/gi, "")
    .split(/\s+/)
    .filter(Boolean);
  const significant = words.filter((w) => !STOP_WORDS.has(w) && w.length > 3);
  const pool = significant.length > 0 ? significant : words;
  return pool.slice(0, 5);
}
