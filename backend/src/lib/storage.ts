import { getActiveProvider } from "./providers.js";
import { r2ConfigFromEnv, resolveR2Config, uploadFileToR2, type R2Config } from "./r2.js";

// Destino de todo archivo publico que genera o recibe la app (audio, visuales
// de escenas, renders, imagenes de IA): Cloudflare R2, siempre. No cobra
// egreso y no tiene la cuota de 1GB de Supabase Storage.

export interface R2Target {
  config: R2Config;
  secretAccessKey: string;
}

// Provider "r2" de la base (Settings > Providers) o, si no hay, variables de
// entorno (ver r2ConfigFromEnv).
export async function resolveR2Target(): Promise<R2Target | null> {
  const provider = await getActiveProvider("r2");
  const config = resolveR2Config(provider);
  if (config && provider?.api_key) return { config, secretAccessKey: provider.api_key };
  return r2ConfigFromEnv();
}

// `body`: un Buffer o la ruta de un archivo local (en R2 se sube en
// streaming). En R2 la clave es `${r2Prefix ?? bucket}/${path}`. Devuelve la
// URL publica.
export async function uploadPublicFile(params: {
  bucket: string;
  path: string;
  contentType: string;
  body: Buffer | string;
  r2Prefix?: string;
}): Promise<string> {
  const { bucket, path, contentType, body } = params;
  const r2 = await resolveR2Target();
  if (!r2) {
    // Sin fallback a Supabase Storage: su cuota (1GB en Free) se lleno con
    // visuales de escenas y audio y restringio el proyecto entero (DB
    // incluida). Mejor fallar claro que volver a llenarlo en silencio.
    throw new Error(
      "R2 no esta configurado (Settings > Providers 'r2' o variables R2_*): no se puede subir el archivo"
    );
  }
  return uploadFileToR2(body, `${params.r2Prefix ?? bucket}/${path}`, contentType, r2.config, r2.secretAccessKey);
}
