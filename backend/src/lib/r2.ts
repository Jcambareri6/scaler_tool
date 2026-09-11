import { createReadStream } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Provider } from "../types/shared/typeShared.js";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  bucket: string;
  // R2 no expone URL publica por default -- hay que habilitar el dominio
  // r2.dev del bucket o atarle un dominio propio, y guardar esa base ac aca
  // (ej: "https://pub-xxxxxxxx.r2.dev" o "https://cdn.tudominio.com").
  publicBaseUrl: string;
}

// provider.api_key = R2 Secret Access Key (mismo criterio que cloudinary:
// el secreto va en la columna api_key, el resto de credenciales/config no
// sensibles en `configuration`).
export function resolveR2Config(provider: Provider | null): R2Config | null {
  if (!provider?.api_key) return null;
  const accountId = provider.configuration?.account_id as string | undefined;
  const accessKeyId = provider.configuration?.access_key_id as string | undefined;
  const bucket = provider.configuration?.bucket as string | undefined;
  const publicBaseUrl = provider.configuration?.public_base_url as string | undefined;
  if (!accountId || !accessKeyId || !bucket || !publicBaseUrl) return null;
  return { accountId, accessKeyId, bucket, publicBaseUrl };
}

function buildClient(config: R2Config, secretAccessKey: string): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey },
  });
}

// Sube un archivo local a R2 en streaming (Upload de lib-storage arma
// multipart solo si hace falta) en vez de cargarlo entero en memoria como
// el fallback de Supabase Storage -- justamente lo que se busca al sacar
// el render final del limite de 100MB de Cloudinary, no tiene sentido
// reintroducir un techo practico por memoria del proceso.
export async function uploadFileToR2(
  filePath: string,
  key: string,
  contentType: string,
  config: R2Config,
  secretAccessKey: string
): Promise<string> {
  const upload = new Upload({
    client: buildClient(config, secretAccessKey),
    params: {
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    },
  });
  await upload.done();
  return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
}
