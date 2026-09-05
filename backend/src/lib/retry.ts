// Reintentos con backoff exponencial para llamadas a APIs externas
// (OpenAI, Pexels, Pixabay, ai33.pro, etc.) -- un pipeline real hace
// decenas de estas llamadas seguidas; sin esto, un solo 429/5xx transitorio
// tira abajo todo el job.
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

// Nuestros clientes (searchStock, generateStockKeywords, etc.) arman los
// mensajes de error como `... (${response.status}): ...` -- se parsea ese
// numero para decidir si vale la pena reintentar. 429 y 5xx son
// transitorios; el resto de los 4xx (401, 400, 404...) no se arreglan
// reintentando.
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true; // error no-HTTP (red, etc.) -- reintentar
  const match = error.message.match(/\((\d{3})\)/);
  if (!match) return true; // sin status HTTP identificable (timeout, DNS, etc.) -- reintentar
  const status = Number(match[1]);
  return status === 429 || status >= 500;
}

export interface WithRetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

export async function withRetry<T>(fn: () => Promise<T>, options: WithRetryOptions = {}): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryableError(error)) throw error;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
