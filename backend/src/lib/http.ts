// El fetch nativo de Node no tiene timeout por default -- si una API externa
// (OpenAI, Pexels, ai33, SnapGen, etc.) se cuelga sin devolver ni error ni
// response, la promesa queda pendiente para siempre. Encontrado repetidas
// veces en esta sesion (generate_video contra SnapGen, y de nuevo en
// generate_video_prompt contra OpenAI) -- en vez de agregar el fix tool por
// tool cada vez que aparece, todos los fetch a APIs externas pasan por aca.
const DEFAULT_FETCH_TIMEOUT_MS = 30 * 1000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
