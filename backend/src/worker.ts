import "dotenv/config";
import os from "node:os";
import { supabase } from "./lib/supabase.js";
import { runPreRenderPipeline, runRenderPipeline } from "./pipeline/orchestrator.js";
import { syncProjectStatus } from "./lib/projectStatus.js";
import { errorMessage } from "./lib/errors.js";
import { envInt } from "./lib/env.js";
import type { JobQueueName } from "./lib/jobQueue.js";
import type { Job } from "./types/shared/typeShared.js";

// Worker de la cola de trabajos pesados (ver migracion-worker-render.md).
// Corre en el servidor de render (Docker, ver docker-compose.worker.yml),
// NO en Render: toma de la tabla `jobs` los pipelines que la API dejo
// pendientes (EXECUTION_MODE=queue) y los ejecuta con EXACTAMENTE las mismas
// funciones que antes corrian inline en la API (orchestrator.ts). El
// frontend no se entera de la diferencia: sigue escuchando la fila del Job
// por Supabase Realtime, y aca se actualiza igual que antes.
//
// Sumar capacidad = levantar este mismo contenedor en otro servidor con otro
// WORKER_ID: claim_next_job() usa FOR UPDATE SKIP LOCKED, dos workers nunca
// toman el mismo job.

// Fijo por servidor (docker-compose lo setea): si el contenedor se reinicia
// con el mismo id, al arrancar recupera en el acto los jobs que habia
// dejado a medias (ver recoverOwnJobs) en vez de esperar al timeout.
const WORKER_ID = process.env.WORKER_ID?.trim() || `${os.hostname()}-${process.pid}`;

// ffmpeg satura la CPU: mas de 2 renders a la vez en un servidor de 8
// nucleos no termina mas videos por hora, solo reparte los mismos nucleos.
const RENDER_CONCURRENCY = envInt("RENDER_CONCURRENCY", 2);
// El pre-render es casi todo espera de APIs externas (TTS, Whisper, stock,
// LLM) -- el limite real son sus rate limits, no la CPU.
const PRE_RENDER_CONCURRENCY = envInt("PRE_RENDER_CONCURRENCY", 3);
const POLL_INTERVAL_MS = envInt("WORKER_POLL_INTERVAL_MS", 3000);
const HEARTBEAT_INTERVAL_MS = envInt("WORKER_HEARTBEAT_INTERVAL_MS", 30_000);
// Sin heartbeat durante este tiempo, el job se considera huerfano (worker
// muerto). Tiene que ser bastante mayor que HEARTBEAT_INTERVAL_MS.
const STALE_JOB_SECONDS = envInt("WORKER_STALE_JOB_SECONDS", 180);
const STALE_CHECK_INTERVAL_MS = envInt("WORKER_STALE_CHECK_INTERVAL_MS", 60_000);
// Espera antes de reintentar un job fallido: attempts * este valor.
const RETRY_DELAY_SECONDS = envInt("WORKER_RETRY_DELAY_SECONDS", 30);
// Al apagarse (deploy, `docker compose down`), cuanto espera a que terminen
// los jobs en curso antes de salir. Debe ser menor que stop_grace_period
// del docker-compose; lo que quede a medias lo recupera recoverOwnJobs al
// volver a arrancar.
const SHUTDOWN_GRACE_MS = envInt("WORKER_SHUTDOWN_GRACE_MS", 14 * 60 * 1000);

const QUEUE_LIMITS: Record<JobQueueName, number> = {
  render: RENDER_CONCURRENCY,
  pre_render: PRE_RENDER_CONCURRENCY,
};

const activeJobs = new Map<string, Promise<void>>();
const activeCount: Record<JobQueueName, number> = { render: 0, pre_render: 0 };
let shuttingDown = false;

function log(message: string, ...rest: unknown[]) {
  console.log(`[worker ${WORKER_ID}] ${message}`, ...rest);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimNextJob(queue: JobQueueName): Promise<Job | null> {
  const { data, error } = await supabase.rpc("claim_next_job", { p_worker_id: WORKER_ID, p_queue: queue });
  if (error) throw new Error(`claim_next_job: ${error.message}`);
  const rows = (data ?? []) as Job[];
  return rows[0] ?? null;
}

// Jobs encolados antes de que existiera jobs.user_id no deberian existir
// (la columna nace con la misma migracion que la cola), pero por las dudas
// se resuelve el dueño subiendo al proyecto, igual que ownership.ts.
async function resolveUserId(job: Job): Promise<string> {
  if (job.user_id) return job.user_id;
  const { data, error } = await supabase
    .from("video_projects")
    .select("user_id")
    .eq("id", job.video_project_id)
    .single();
  if (error || !data?.user_id) throw new Error("Project not found");
  return data.user_id as string;
}

// Todas las escrituras de cola filtran por claimed_by: si este worker perdio
// el job (quedo sin heartbeat y otro lo re-tomo), no pisa el estado nuevo.
async function markDone(job: Job) {
  const { error } = await supabase
    .from("jobs")
    .update({ queue_state: "done" })
    .eq("id", job.id)
    .eq("claimed_by", WORKER_ID);
  if (error) log(`no se pudo marcar done ${job.id}: ${error.message}`);
}

async function handleFailure(job: Job, failure: unknown) {
  const fallback = job.queue === "render" ? "Render failed" : "Pipeline failed";
  const message = errorMessage(failure, fallback);
  const attempts = job.attempts ?? 1;
  const maxAttempts = job.max_attempts ?? 1;

  if (attempts < maxAttempts) {
    const delaySeconds = RETRY_DELAY_SECONDS * attempts;
    log(`job ${job.id} (${job.queue}) fallo en el intento ${attempts}/${maxAttempts}, reintento en ${delaySeconds}s: ${message}`);
    const { error } = await supabase
      .from("jobs")
      .update({
        queue_state: "pending",
        claimed_by: null,
        run_after: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      })
      .eq("id", job.id)
      .eq("claimed_by", WORKER_ID);
    if (error) log(`no se pudo re-encolar ${job.id}: ${error.message}`);
    return;
  }

  log(`job ${job.id} (${job.queue}) FALLO definitivamente: ${message}`);
  // Mismo update que hacian los .catch() de pipeline.service.ts /
  // job.service.ts cuando el pipeline corria inline en la API.
  const { error } = await supabase
    .from("jobs")
    .update({ status: "FAILED", queue_state: "failed", error: message, finished_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("claimed_by", WORKER_ID);
  if (error) {
    log(`no se pudo marcar FAILED ${job.id}: ${error.message}`);
    return;
  }
  await syncProjectStatus(job.video_project_id, "FAILED").catch((syncError) =>
    log(`no se pudo sincronizar el proyecto ${job.video_project_id}:`, syncError)
  );
}

async function runJob(job: Job, queue: JobQueueName) {
  const startedAt = Date.now();
  log(`tomo job ${job.id} (${queue}, intento ${job.attempts}/${job.max_attempts}, proyecto ${job.video_project_id})`);

  const heartbeat = setInterval(() => {
    void supabase
      .from("jobs")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("claimed_by", WORKER_ID)
      .then(({ error }) => {
        if (error) log(`heartbeat fallo para ${job.id}: ${error.message}`);
      });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const userId = await resolveUserId(job);
    const ctx = { userId, jobId: job.id };
    if (queue === "pre_render") {
      // claim_next_job ya lo paso de QUEUED a RUNNING; se sincroniza el
      // proyecto igual que hacia la API al lanzar el pipeline inline.
      await syncProjectStatus(job.video_project_id, "RUNNING");
      await runPreRenderPipeline(job.video_project_id, ctx);
    } else {
      await runRenderPipeline(job.video_project_id, ctx);
    }
    await markDone(job);
    log(`job ${job.id} (${queue}) listo en ${Math.round((Date.now() - startedAt) / 1000)}s`);
  } catch (failure) {
    await handleFailure(job, failure);
  } finally {
    clearInterval(heartbeat);
  }
}

// Un loop por cola, cada uno con su propio cupo: un render largo no bloquea
// los pre-render (y viceversa).
async function pollQueue(queue: JobQueueName) {
  const limit = QUEUE_LIMITS[queue];
  while (!shuttingDown) {
    if (activeCount[queue] >= limit) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    let job: Job | null = null;
    try {
      job = await claimNextJob(queue);
    } catch (claimError) {
      log(`error pidiendo trabajo de ${queue}:`, claimError);
    }
    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    activeCount[queue] += 1;
    const running = runJob(job, queue).finally(() => {
      activeCount[queue] -= 1;
      activeJobs.delete(job!.id);
    });
    activeJobs.set(job.id, running);
    // Sin sleep: si queda cupo, intenta tomar otro job enseguida.
  }
}

// Jobs que ESTE worker (mismo WORKER_ID) tenia tomados cuando se apago o se
// cayo el contenedor: nadie los esta procesando, se liberan ya mismo en vez
// de esperar STALE_JOB_SECONDS.
async function recoverOwnJobs() {
  const { data, error } = await supabase
    .from("jobs")
    .update({ heartbeat_at: new Date(0).toISOString() })
    .eq("claimed_by", WORKER_ID)
    .eq("queue_state", "claimed")
    .select("id");
  if (error) {
    log(`no se pudieron revisar jobs propios previos: ${error.message}`);
    return;
  }
  if (data && data.length > 0) {
    log(`recuperando ${data.length} job(s) que quedaron a medias en el arranque anterior`);
    await recoverStaleJobs();
  }
}

// Jobs huerfanos de CUALQUIER worker (murio, se reinicio el servidor, se
// corto la red): vuelven a pending si les quedan intentos, si no FAILED.
async function recoverStaleJobs() {
  const { data, error } = await supabase.rpc("requeue_stale_jobs", {
    p_stale_seconds: STALE_JOB_SECONDS,
    p_retry_delay_seconds: RETRY_DELAY_SECONDS,
  });
  if (error) {
    log(`requeue_stale_jobs fallo: ${error.message}`);
    return;
  }
  const rows = (data ?? []) as { job_id: string; video_project_id: string; outcome: string }[];
  for (const row of rows) {
    log(`job huerfano ${row.job_id}: ${row.outcome === "requeued" ? "re-encolado" : "marcado FAILED"}`);
    if (row.outcome === "failed") {
      await syncProjectStatus(row.video_project_id, "FAILED").catch((syncError) =>
        log(`no se pudo sincronizar el proyecto ${row.video_project_id}:`, syncError)
      );
    }
  }
}

async function staleLoop() {
  while (!shuttingDown) {
    await recoverStaleJobs();
    await sleep(STALE_CHECK_INTERVAL_MS);
  }
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} recibido: no tomo trabajos nuevos, espero ${activeJobs.size} job(s) en curso (max ${Math.round(SHUTDOWN_GRACE_MS / 1000)}s)`);
  const timeout = sleep(SHUTDOWN_GRACE_MS).then(() => "timeout" as const);
  const result = await Promise.race([Promise.allSettled([...activeJobs.values()]).then(() => "done" as const), timeout]);
  if (result === "timeout") {
    log(`quedaron ${activeJobs.size} job(s) sin terminar; se recuperan al volver a arrancar`);
  }
  process.exit(0);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  log(
    `arrancando (render=${RENDER_CONCURRENCY}, pre_render=${PRE_RENDER_CONCURRENCY}, ` +
      `WORK_DIR=${process.env.WORK_DIR || os.tmpdir()})`
  );

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  // Algun paso del pipeline puede dejar una promesa rechazada sin manejar
  // (fire-and-forget interno) -- en la API eso no tiraba el proceso, aca
  // tampoco: tirar el worker cortaria todos los renders en curso.
  process.on("unhandledRejection", (reason) => log("unhandledRejection:", reason));

  await recoverOwnJobs();
  await Promise.all([pollQueue("render"), pollQueue("pre_render"), staleLoop()]);
}

main().catch((fatal) => {
  console.error(`[worker ${WORKER_ID}] error fatal:`, fatal);
  process.exit(1);
});
