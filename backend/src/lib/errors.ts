// No todo lo que se tira es una instancia real de Error -- encontrado en
// produccion con el SDK de Cloudinary, que rechaza sus promesas con un
// objeto plano ({ message, name, http_code }) que falla `instanceof Error`.
// El patron `error instanceof Error ? error.message : "<generico>"`,
// repetido en mas de diez lugares del proyecto, ocultaba el mensaje real en
// esos casos (asi paso con "Invalid api_key ..." de Cloudinary, que quedo
// enmascarado como el string generico "Render failed"). Esta funcion
// tambien mira `.message` en objetos no-Error antes de caer al fallback.
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
