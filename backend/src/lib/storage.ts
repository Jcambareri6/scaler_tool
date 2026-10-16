import { readFile } from "node:fs/promises";
import { supabase } from "./supabase.js";
import { getActiveProvider } from "./providers.js";
import { r2ConfigFromEnv, resolveR2Config, uploadFileToR2, type R2Config } from "./r2.js";

// Destino de todo archivo publico que genera o recibe la app (audio, visuales
// de escenas, renders, imagenes de IA): Cloudflare R2 si esta configurado --
// no cobra egreso, y el egreso de Supabase Storage (cada reproduccion en el
// navegador y cada descarga del render) es lo que agota su plan --, y si no,
// Supabase Storage como siempre.

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

const ensuredBuckets = new Set<string>();

async function ensureSupabaseBucket(bucket: string): Promise<void> {
  if (ensuredBuckets.has(bucket)) return;
  const { error } = await supabase.storage.createBucket(bucket, { public: true });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
  ensuredBuckets.add(bucket);
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
  if (r2) {
    return uploadFileToR2(body, `${params.r2Prefix ?? bucket}/${path}`, contentType, r2.config, r2.secretAccessKey);
  }

  await ensureSupabaseBucket(bucket);
  const buffer = typeof body === "string" ? await readFile(body) : body;
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
