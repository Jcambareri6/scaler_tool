import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { supabase } from "./supabase.js";
import { resolveR2Target } from "./storage.js";
import { uploadFileToR2 } from "./r2.js";
import { fetchWithTimeout } from "./http.js";
import { withRetry } from "./retry.js";
import { mapWithConcurrency } from "./concurrency.js";
import { makeWorkDir } from "./workDir.js";
import { envInt } from "./env.js";

// Copia a R2 los visuales de escena que todavia apuntan a un servidor ajeno
// (CDN del stock, URLs de SnapGen que vencen a los ~14 dias, Commons...).
// Sin esto, volver a renderizar un proyecto viejo fallaba cuando el
// proveedor borraba el archivo o la URL vencia. Se corre antes del render:
// el asset pasa a apuntar a la copia propia y la URL original queda en
// metadata.source_url (sirve para creditos y auditoria).
//
// Solo con R2: Supabase Storage tiene limite de tamano por objeto y cobra
// egreso, justo lo que se evita con R2. Una copia que falla no tira el
// render: se loguea y ese clip se sigue bajando de su URL original.

const MIRROR_CONCURRENCY = envInt("MIRROR_CONCURRENCY", 4);
const MIRROR_DOWNLOAD_TIMEOUT_MS = envInt("MIRROR_DOWNLOAD_TIMEOUT_MS", 2 * 60 * 1000);
const MIRROR_PREFIX = "skaler-media";
// upload.wikimedia.org rechaza (403) el User-Agent default de Node.
const WIKIMEDIA_USER_AGENT = "ScalerTool/1.0 (https://github.com/jcambareri6/scaler_tool)";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

interface MirrorableAsset {
  id: string;
  type: string;
  storage_key: string;
  metadata: Record<string, unknown> | null;
}

export interface MirrorResult {
  mirrored: number;
  failed: number;
  // URL vieja -> URL nueva, para reescribir el timeline.
  replacements: Map<string, string>;
}

// Extension segun la URL (sin query); si no se reconoce, la del tipo.
export function extensionFor(url: string, type: string): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // URL rara: se usa tal cual.
  }
  const ext = path.extname(pathname).slice(1).toLowerCase();
  if (ext in CONTENT_TYPES) return ext === "jpeg" ? "jpg" : ext;
  return type === "IMAGE" ? "jpg" : "mp4";
}

export function needsMirror(storageKey: string, publicBaseUrl: string): boolean {
  if (!/^https?:\/\//i.test(storageKey)) return false; // mock://, rutas locales
  return !storageKey.startsWith(publicBaseUrl.replace(/\/$/, ""));
}

async function download(url: string, destPath: string): Promise<void> {
  await withRetry(async () => {
    const init: RequestInit = url.includes("wikimedia.org") ? { headers: { "User-Agent": WIKIMEDIA_USER_AGENT } } : {};
    const response = await fetchWithTimeout(url, init, MIRROR_DOWNLOAD_TIMEOUT_MS);
    if (!response.ok || !response.body) {
      throw new Error(`No se pudo descargar ${url} (${response.status})`);
    }
    await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createWriteStream(destPath));
  });
}

export async function mirrorProjectVisuals(projectId: string): Promise<MirrorResult> {
  const result: MirrorResult = { mirrored: 0, failed: 0, replacements: new Map() };
  const r2 = await resolveR2Target();
  if (!r2) return result;

  const { data, error } = await supabase
    .from("assets")
    .select("id, type, storage_key, metadata")
    .eq("video_project_id", projectId)
    .not("scene_id", "is", null)
    .in("type", ["VIDEO", "IMAGE"]);
  if (error) throw new Error(error.message);

  const pending = ((data ?? []) as MirrorableAsset[]).filter((a) => needsMirror(a.storage_key, r2.config.publicBaseUrl));
  if (pending.length === 0) return result;

  const workDir = await makeWorkDir("skaler-mirror-");
  try {
    await mapWithConcurrency(pending, MIRROR_CONCURRENCY, async (asset) => {
      const ext = extensionFor(asset.storage_key, asset.type);
      const localPath = path.join(workDir, `${asset.id}.${ext}`);
      try {
        await download(asset.storage_key, localPath);
        const url = await uploadFileToR2(
          localPath,
          `${MIRROR_PREFIX}/${projectId}/${asset.id}.${ext}`,
          CONTENT_TYPES[ext] ?? "application/octet-stream",
          r2.config,
          r2.secretAccessKey
        );
        const { error: updateError } = await supabase
          .from("assets")
          .update({ storage_key: url, metadata: { ...(asset.metadata ?? {}), source_url: asset.storage_key } })
          .eq("id", asset.id);
        if (updateError) throw new Error(updateError.message);
        result.replacements.set(asset.storage_key, url);
        result.mirrored += 1;
      } catch (mirrorError) {
        result.failed += 1;
        console.warn(`[mirror] no se pudo copiar el asset ${asset.id} (${asset.storage_key}):`, mirrorError);
      } finally {
        await rm(localPath, { force: true }).catch(() => undefined);
      }
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return result;
}

// Reescribe las URLs del timeline (escenas, assets de cada escena y el
// `asset` singular de compatibilidad) con las copias propias.
export function replaceTimelineUrls<T>(content: T, replacements: Map<string, string>): T {
  if (replacements.size === 0) return content;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        out[key] = key === "storage_key" && typeof inner === "string" ? replacements.get(inner) ?? inner : walk(inner);
      }
      return out;
    }
    return value;
  };
  return walk(content) as T;
}

export async function mirrorTimelineVisuals(projectId: string, timelineId: string): Promise<MirrorResult> {
  const result = await mirrorProjectVisuals(projectId);
  if (result.replacements.size === 0) return result;
  const { data: timeline, error } = await supabase.from("timelines").select("content").eq("id", timelineId).single();
  if (error || !timeline) throw new Error(error?.message ?? "Timeline not found");
  const { error: updateError } = await supabase
    .from("timelines")
    .update({ content: replaceTimelineUrls(timeline.content, result.replacements) })
    .eq("id", timelineId);
  if (updateError) throw new Error(updateError.message);
  return result;
}
