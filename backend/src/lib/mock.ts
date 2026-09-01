// Flag explicito de desarrollo: con MOCK_PROVIDERS=true, las tools que
// todavia no tienen Provider real conectado (voz, whisper, render, y
// search_stock cuando no hay ninguna key) devuelven datos fixture en vez
// de tirar ProviderNotConfiguredError. Nunca se activa solo -- requiere el
// env var explicito.
export function isMockMode(): boolean {
  return process.env.MOCK_PROVIDERS === "true";
}
