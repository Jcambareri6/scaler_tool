import { envInt } from "./env.js";

// Cola de trabajos pesados (ver supabase/migrations/20260925000000_job_queue.sql
// y src/worker.ts). La API decide aca si un pipeline se ejecuta en su propio
// proceso (como siempre) o si se deja pendiente para que lo tome el worker
// que corre en el servidor de render.

export type JobQueueName = "pre_render" | "render";

export type ExecutionMode = "inline" | "queue";

// "inline" (default): la API corre los pipelines en su propio proceso, igual
// que antes de la migracion. "queue": la API solo encola y el worker los
// corre. Sirve tambien de plan de vuelta atras -- volver a "inline" en el
// dashboard de Render restituye el comportamiento anterior sin redeploy.
export function getExecutionMode(): ExecutionMode {
  return process.env.EXECUTION_MODE?.trim().toLowerCase() === "queue" ? "queue" : "inline";
}

// El render es idempotente (vuelve a bajar los clips y sobreescribe el mp4
// final), asi que se reintenta solo. El pre-render NO por default: paga TTS
// (ai33), Whisper y video IA, y build_scenes borra/recrea las escenas -- un
// reintento automatico cobraria todo de nuevo. Si falla queda FAILED y el
// usuario lo vuelve a lanzar desde la UI.
export const RENDER_MAX_ATTEMPTS = envInt("RENDER_MAX_ATTEMPTS", 3);
export const PRE_RENDER_MAX_ATTEMPTS = envInt("PRE_RENDER_MAX_ATTEMPTS", 1);

// Campos de cola para un job recien encolado (o re-encolado para otra
// etapa: el mismo Job pasa por pre_render y despues por render, ver
// job.service.ts::approveStockReview).
export function pendingQueueFields(queue: JobQueueName, userId: string): Record<string, unknown> {
  return {
    queue,
    queue_state: "pending",
    user_id: userId,
    claimed_by: null,
    claimed_at: null,
    heartbeat_at: null,
    attempts: 0,
    max_attempts: queue === "render" ? RENDER_MAX_ATTEMPTS : PRE_RENDER_MAX_ATTEMPTS,
    run_after: new Date().toISOString(),
  };
}
