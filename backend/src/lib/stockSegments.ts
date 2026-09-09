import { supabase } from "./supabase.js";
import type { StockCandidate } from "../tools/searchStock.tool.js";

// Una escena solo tiene una representacion visual activa a la vez (video de
// stock, video generado por IA, o imagen generada por IA) -- se borran los
// tres tipos juntos antes de asignar la nueva, para que cambiar de fuente
// (ej: de "ai video" a "ai image") no deje assets viejos mezclados.
async function clearSceneVisualAssets(sceneId: string): Promise<void> {
  const { error } = await supabase.from("assets").delete().eq("scene_id", sceneId).in("type", ["VIDEO", "IMAGE"]);
  if (error) throw new Error(error.message);
}

// Una escena puede necesitar mas de un clip de stock para cubrir toda su
// duracion (los candidatos de Pexels/Pixabay/etc. casi nunca duran
// exactamente lo mismo que la escena). Politica:
// - Si el candidato dura mas que lo que falta cubrir -> se recorta al
//   tiempo que falta (Math.min).
// - Si dura menos -> se usa entero y se sigue con el PROXIMO candidato
//   distinto para cubrir el resto -- nunca se repite el mismo clip dentro
//   de una escena.
// - Si los candidatos se agotan antes de cubrir toda la duracion, se corta
//   ahi (mejor un video un poco mas corto que repetir un clip).
export async function replaceStockSegmentsForScene(
  projectId: string,
  sceneId: string,
  candidates: StockCandidate[],
  sceneDurationSeconds: number,
  // Set compartido entre TODAS las escenas del mismo video (el caller lo
  // crea una vez por corrida y lo pasa a cada llamada) -- sin esto, dos
  // escenas que buscan keywords parecidas terminan trayendo el mismo
  // candidato top y repiten el mismo clip en distintas partes del video.
  // El check-and-add es sincronico (sin await entre medio), asi que es
  // seguro aunque las escenas se procesen en paralelo (mapWithConcurrency).
  usedKeysAcrossVideo: Set<string> = new Set()
): Promise<{ usedKeys: string[] }> {
  await clearSceneVisualAssets(sceneId);

  let remaining = sceneDurationSeconds;
  let sequence = 0;
  const usedKeys: string[] = [];

  for (const candidate of candidates) {
    if (remaining <= 0.5) break;

    const key = `${candidate.provider}:${candidate.external_id}`;
    if (usedKeysAcrossVideo.has(key)) continue;
    usedKeysAcrossVideo.add(key);
    usedKeys.push(key);

    const candidateDuration = candidate.duration_seconds ?? remaining;
    const allocatedSeconds = Math.min(candidateDuration, remaining);

    const { error: insertError } = await supabase.from("assets").insert({
      video_project_id: projectId,
      scene_id: sceneId,
      type: "VIDEO",
      // Fase actual: storage_key apunta directo al CDN del provider --
      // todavia no se descarga a Storage propio.
      storage_key: candidate.preview_url,
      metadata: {
        kind: "stock_preview",
        provider: candidate.provider,
        external_id: candidate.external_id,
        url: candidate.url,
        // Keyword de la cascada (o del fallback generico) que trajo este
        // candidato -- permite auditar despues por que se eligio tal clip.
        keyword: candidate.matched_keyword ?? null,
        sequence,
        duration_seconds: allocatedSeconds,
      },
    });
    if (insertError) throw new Error(insertError.message);

    remaining -= allocatedSeconds;
    sequence += 1;
  }

  return { usedKeys };
}

// Tope de entradas guardadas por escena -- alcanza de sobra (una escena
// normalmente usa 1-3 clips por regeneracion) y evita que scene.content
// crezca sin limite si el usuario regenera la misma escena muchas veces.
const MAX_STOCK_HISTORY = 30;

// Complementa a replaceStockSegmentsForScene: los Assets de stock se borran
// enteros en cada regeneracion (clearSceneVisualAssets), asi que sin esto no
// queda ningun registro de "este clip ya se probo en esta escena" -- y como
// la busqueda con las mismas keywords es deterministica, regenerar siempre
// volvia a traer el mismo candidato top. Guarda las keys ya usadas dentro de
// scene.content (campo JSON existente, sin necesidad de migracion) para que
// el caller pueda excluirlas la proxima vez que regenere esta escena.
export async function appendStockHistory(
  sceneId: string,
  currentContent: Record<string, unknown> | null,
  newKeys: string[]
): Promise<void> {
  if (newKeys.length === 0) return;

  const previousHistory = Array.isArray((currentContent as { stock_history?: unknown[] } | null)?.stock_history)
    ? ((currentContent as { stock_history?: unknown[] }).stock_history as unknown[]).filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
  const merged = Array.from(new Set([...previousHistory, ...newKeys])).slice(-MAX_STOCK_HISTORY);

  const { error } = await supabase
    .from("scenes")
    .update({ content: { ...(currentContent ?? {}), stock_history: merged } })
    .eq("id", sceneId);
  if (error) throw new Error(error.message);
}

// Lee el historial de clips ya usados por esta escena puntual (ver
// appendStockHistory) para excluirlos al armar el set de keys ya usadas
// antes de regenerar -- sin esto, regenerar la MISMA escena repetidas veces
// siempre vuelve a traer el mismo candidato top (search_stock es
// deterministico para las mismas keywords).
export function readStockHistory(content: Record<string, unknown> | null): string[] {
  const history = (content as { stock_history?: unknown[] } | null)?.stock_history;
  return Array.isArray(history) ? history.filter((entry): entry is string => typeof entry === "string") : [];
}

const SCENE_UPLOADS_BUCKET = "scene-uploads";

async function ensureSceneUploadsBucket(): Promise<void> {
  const { error } = await supabase.storage.createBucket(SCENE_UPLOADS_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(error.message);
  }
}

// Sube un archivo que el usuario elige a mano desde el panel de escenas
// (reemplazo puntual "subir propio") a Storage propio -- a diferencia del
// stock (URL del provider) y de la IA (URL de SnapGen), este archivo no
// existe en ningun lado hasta que el usuario lo carga, asi que si o si hay
// que persistirlo nosotros. Mismo bucket publico + upsert por nombre unico
// que ensureAiImageBucket en generateImage.tool.ts.
export async function uploadSceneAssetFile(
  buffer: Buffer,
  contentType: string,
  extension: string
): Promise<string> {
  await ensureSceneUploadsBucket();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const { error } = await supabase.storage
    .from(SCENE_UPLOADS_BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);

  const {
    data: { publicUrl },
  } = supabase.storage.from(SCENE_UPLOADS_BUCKET).getPublicUrl(path);
  return publicUrl;
}

// Contraparte de replaceStockSegmentsForScene/setAiVideoSegmentsForScene
// para un archivo subido por el usuario: siempre UN solo Asset (no hay
// forma de saber de antemano si hace falta mas de un clip para cubrir la
// escena, y no tiene sentido pedirle al usuario que suba varios), sin
// duration_seconds en metadata -- el reproductor de StockReviewPanel ya
// tolera eso mostrando el clip completo dentro de la ventana de la escena.
export async function setUploadedVisualForScene(
  projectId: string,
  sceneId: string,
  upload: { storage_key: string; type: "VIDEO" | "IMAGE" }
): Promise<void> {
  await clearSceneVisualAssets(sceneId);

  const { error } = await supabase.from("assets").insert({
    video_project_id: projectId,
    scene_id: sceneId,
    type: upload.type,
    storage_key: upload.storage_key,
    metadata: {
      kind: "user_upload",
      sequence: 0,
    },
  });
  if (error) throw new Error(error.message);
}

export interface AiVideoSegment {
  storage_key: string;
  duration_seconds: number;
  prompt: string;
}

// Contraparte de replaceStockSegmentsForScene para clips generados por IA
// (generate_video / SnapGen): a diferencia del stock, cada clip se pide con
// una duracion elegida por el caller (no un candidato preexistente), pero
// el modelo de video (Veo 3.1, Seedance 2, etc.) solo genera duraciones
// fijas cortas (8s Veo 3.1 Lite, hasta 15s Seedance 2) -- una escena de
// 30-40s necesita VARIOS clips seguidos, no uno solo. El caller ya arma la
// lista completa (loop de generate_video hasta cubrir la escena, ver
// orchestrator.ts::generateAiVisual), esta funcion solo persiste el
// resultado en orden.
export async function setAiVideoSegmentsForScene(
  projectId: string,
  sceneId: string,
  segments: AiVideoSegment[]
): Promise<void> {
  await clearSceneVisualAssets(sceneId);

  for (let sequence = 0; sequence < segments.length; sequence++) {
    const segment = segments[sequence]!;
    const { error } = await supabase.from("assets").insert({
      video_project_id: projectId,
      scene_id: sceneId,
      type: "VIDEO",
      storage_key: segment.storage_key,
      metadata: {
        kind: "ai_generated",
        provider: "snapgen",
        prompt: segment.prompt,
        sequence,
        duration_seconds: segment.duration_seconds,
      },
    });
    if (error) throw new Error(error.message);
  }
}

// Contraparte de setAiVideoSegmentsForScene para una imagen generada por IA
// (generate_image / SnapGen gpt-image-2) mostrada con efecto Ken Burns
// (zoom/pan lento, ver render_video.tool.ts) en vez de un clip de video --
// mucho mas barata que generar video ($0.01 la imagen vs $0.10+ el clip),
// pensada para escenas donde no hace falta movimiento real. Es un unico
// Asset: la imagen se estira a toda la duracion de la escena en el render,
// no hace falta cubrir con varios segmentos como el video.
export async function setAiImageForScene(
  projectId: string,
  sceneId: string,
  image: { storage_key: string; prompt: string }
): Promise<void> {
  await clearSceneVisualAssets(sceneId);

  const { error } = await supabase.from("assets").insert({
    video_project_id: projectId,
    scene_id: sceneId,
    type: "IMAGE",
    storage_key: image.storage_key,
    metadata: {
      kind: "ai_generated",
      provider: "snapgen",
      prompt: image.prompt,
      sequence: 0,
    },
  });
  if (error) throw new Error(error.message);
}
