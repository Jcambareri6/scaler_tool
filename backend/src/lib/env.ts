// Lectura de numeros desde env vars con default y piso -- el worker y el
// render exponen varios knobs de capacidad (concurrencia, tamano de tanda,
// intervalos) que se ajustan por servidor sin tocar codigo. Un valor vacio,
// no numerico o por debajo de `min` cae al default en vez de romper el boot.
export function envInt(name: string, defaultValue: number, min = 1): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    console.warn(`[env] ${name}="${raw}" invalido, usando ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}
