// No todo lo que se tira es una instancia real de Error -- encontrado en
// produccion con el SDK de Cloudinary, que rechaza sus promesas con un
// objeto plano ({ message, name, http_code }) que falla `instanceof Error`.
// El patron `error instanceof Error ? error.message : "<generico>"`,
// repetido en mas de diez lugares del proyecto, ocultaba el mensaje real en
// esos casos (asi paso con "Invalid api_key ..." de Cloudinary, que quedo
// enmascarado como el string generico "Render failed"). Esta funcion
// tambien mira `.message` en objetos no-Error antes de caer al fallback.
const MAX_PROVIDER_BODY_CHARS = 300;

// Tokens con pinta de credencial (sk-..., keys largas alfanumericas, Bearer
// ...) -- red de seguridad para cuando el proveedor devuelve en el error una
// key que no es exactamente la que mandamos (ej: recortada o de otra cuenta).
const SECRET_LIKE_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+/=-]+|\b[A-Za-z0-9_-]{32,}\b/g;

function redactSecrets(text: string, secrets: (string | null | undefined)[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(SECRET_LIKE_RE, "[REDACTED]");
}

// Error de la API de un proveedor externo. El mensaje termina en la UI (y en
// jobs.message), asi que el cuerpo de la respuesta se sanea: algunos
// proveedores (visto con ai33.pro) devuelven la api key en el error. El
// cuerpo completo -- tambien saneado -- queda solo en el log del servidor.
export function providerApiError(
  label: string,
  status: number,
  body: string,
  secrets: (string | null | undefined)[] = []
): Error {
  const safeBody = redactSecrets(body, secrets);
  console.error(`[${label}] API error (${status}): ${safeBody}`);
  const shortBody =
    safeBody.length > MAX_PROVIDER_BODY_CHARS ? `${safeBody.slice(0, MAX_PROVIDER_BODY_CHARS)}...` : safeBody;
  return new Error(`${label} API error (${status}): ${shortBody}`);
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
