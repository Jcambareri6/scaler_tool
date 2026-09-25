-- Cola de trabajos para el worker de render (ver backend/src/worker.ts y
-- migracion-worker-render.md en la raiz del repo).
--
-- Antes, los pipelines (pre-render y render) corrian "sueltos" dentro del
-- proceso de la API (pipeline.service.ts / job.service.ts): un deploy, un
-- pico de RAM o el /tmp de 2GB de Render mataban el trabajo y el Job
-- quedaba colgado. Con EXECUTION_MODE=queue la API solo inserta/marca el Job
-- como pendiente y un worker aparte (otro servidor) lo toma de aca.
--
-- Columnas NUEVAS y tecnicas: `status`/`progress` siguen siendo lo que ve la
-- UI (y lo que valida JOB_TRANSITIONS en job.service.ts) -- `queue_state` es
-- solo la plomeria de la cola, no se mezcla con el estado de negocio.
-- Todas nullable o con default: no cambia nada para las filas existentes ni
-- para la API en EXECUTION_MODE=inline.

alter table public.jobs
  -- runPreRenderPipeline/runRenderPipeline necesitan el userId del dueño
  -- (ctx.userId) y jobs no lo tenia -- se guarda al encolar.
  add column if not exists user_id uuid,
  -- 'pre_render' | 'render' -- que pipeline tiene que correr el worker.
  add column if not exists queue text check (queue in ('pre_render', 'render')),
  -- 'pending' -> 'claimed' -> 'done' | 'failed'. NULL = job que no paso por
  -- la cola (creado con EXECUTION_MODE=inline).
  add column if not exists queue_state text check (queue_state in ('pending', 'claimed', 'done', 'failed')),
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  -- El worker lo actualiza cada ~30s mientras trabaja; si deja de moverse,
  -- requeue_stale_jobs() asume que el worker murio.
  add column if not exists heartbeat_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 1,
  -- Reintentos con espera (backoff): el job no se puede tomar antes de esto.
  add column if not exists run_after timestamptz not null default now();

create index if not exists jobs_queue_pending_idx
  on public.jobs (queue, created_at)
  where queue_state = 'pending';

create index if not exists jobs_queue_claimed_idx
  on public.jobs (heartbeat_at)
  where queue_state = 'claimed';

-- Toma el job pendiente mas viejo de `p_queue`, de forma atomica.
-- FOR UPDATE SKIP LOCKED: si dos workers (o dos slots del mismo worker)
-- piden trabajo al mismo tiempo, nunca agarran el mismo job -- es lo que
-- permite sumar servidores sin cambiar codigo.
-- Un job de pre_render recien encolado pasa de QUEUED a RUNNING aca mismo
-- (mismo estado que ponia la API antes de lanzar el pipeline inline); uno de
-- render ya viene en RENDERING desde approveStockReview y no se toca.
create or replace function public.claim_next_job(p_worker_id text, p_queue text)
returns setof public.jobs
language plpgsql
set search_path = public
as $$
begin
  return query
  update public.jobs j
  set queue_state = 'claimed',
      claimed_by = p_worker_id,
      claimed_at = now(),
      heartbeat_at = now(),
      attempts = j.attempts + 1,
      started_at = coalesce(j.started_at, now()),
      status = case when j.queue = 'pre_render' and j.status = 'QUEUED' then 'RUNNING' else j.status end
  where j.id = (
    select c.id
    from public.jobs c
    where c.queue = p_queue
      and c.queue_state = 'pending'
      and c.run_after <= now()
    order by c.created_at
    for update skip locked
    limit 1
  )
  returning j.*;
end;
$$;

-- Recupera jobs "huerfanos": tomados por un worker que dejo de mandar
-- heartbeat (se murio, se reinicio el servidor, se corto la red). Si le
-- quedan intentos vuelve a 'pending'; si no, queda FAILED con un mensaje
-- visible en la UI. Devuelve que hizo con cada uno para que el worker
-- sincronice video_projects.status (ver lib/projectStatus.ts).
create or replace function public.requeue_stale_jobs(p_stale_seconds integer, p_retry_delay_seconds integer)
returns table (job_id uuid, video_project_id uuid, outcome text)
language plpgsql
set search_path = public
as $$
begin
  return query
  with stale as (
    select s.id, s.attempts < s.max_attempts as can_retry
    from public.jobs s
    where s.queue_state = 'claimed'
      and s.heartbeat_at < now() - make_interval(secs => p_stale_seconds)
    for update skip locked
  ),
  requeued as (
    update public.jobs j
    set queue_state = 'pending',
        claimed_by = null,
        run_after = now() + make_interval(secs => p_retry_delay_seconds)
    from stale
    where j.id = stale.id and stale.can_retry
    returning j.id, j.video_project_id, 'requeued'::text
  ),
  failed as (
    update public.jobs j
    set queue_state = 'failed',
        status = 'FAILED',
        finished_at = now(),
        error = 'El servidor de render se detuvo mientras procesaba este trabajo. Volvé a intentarlo.'
    from stale
    where j.id = stale.id and not stale.can_retry
    returning j.id, j.video_project_id, 'failed'::text
  )
  select * from requeued
  union all
  select * from failed;
end;
$$;

-- RLS esta deshabilitado en public y la anon key es publica (ver
-- 20260917010000_revoke_providers_grants.sql): sin esto cualquiera podria
-- llamar estas funciones via PostgREST (/rest/v1/rpc/...) y robarse o
-- tirar jobs. El worker usa el service-role key, que no depende de estos
-- grants.
revoke all on function public.claim_next_job(text, text) from public, anon, authenticated;
revoke all on function public.requeue_stale_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_next_job(text, text) to service_role;
grant execute on function public.requeue_stale_jobs(integer, integer) to service_role;
