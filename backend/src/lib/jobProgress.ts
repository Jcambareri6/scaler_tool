import { supabase } from "./supabase.js";

// Feedback de avance de un Job (jobs.progress + jobs.progress_message, ver
// migracion 20260925000000_job_queue.sql) para quien consulta el Job mientras
// corre -- sin esto un render largo quedaba clavado en "RENDERING 10%" hasta
// terminar. Best-effort: un fallo al reportar progreso nunca tira el
// trabajo, solo se loguea.

// Tope de escrituras por Job: el progreso de ffmpeg llega varias veces por
// segundo, no hace falta pegarle a la DB con cada una.
const MIN_INTERVAL_MS = 3000;
const lastReport = new Map<string, number>();

export async function reportJobProgress(
  jobId: string | undefined,
  progress: number,
  message: string,
  { force = false }: { force?: boolean } = {}
): Promise<void> {
  if (!jobId) return;
  const now = Date.now();
  if (!force && now - (lastReport.get(jobId) ?? 0) < MIN_INTERVAL_MS) return;
  lastReport.set(jobId, now);

  const { error } = await supabase
    .from("jobs")
    .update({ progress: Math.max(0, Math.min(100, Math.round(progress))), progress_message: message })
    .eq("id", jobId);
  if (error) console.warn(`[jobProgress] no se pudo reportar progreso de ${jobId}: ${error.message}`);
}

// Se llama al terminar el Job (bien o mal) para no dejar entradas colgadas.
export function forgetJobProgress(jobId: string | undefined) {
  if (jobId) lastReport.delete(jobId);
}
