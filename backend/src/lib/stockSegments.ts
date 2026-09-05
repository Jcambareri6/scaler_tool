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
): Promise<void> {
  await clearSceneVisualAssets(sceneId);

  let remaining = sceneDurationSeconds;
  let sequence = 0;

  for (const candidate of candidates) {
    if (remaining <= 0.5) break;

    const key = `${candidate.provider}:${candidate.external_id}`;
    if (usedKeysAcrossVideo.has(key)) continue;
    usedKeysAcrossVideo.add(key);

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
        sequence,
        duration_seconds: allocatedSeconds,
      },
    });
    if (insertError) throw new Error(insertError.message);

    remaining -= allocatedSeconds;
    sequence += 1;
  }
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
