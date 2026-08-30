-- Resuelve los gaps #2 y #3 detectados al verificar el diseño contra
-- LEEME_SISTEMA_COMPLETO_ACTUALIZADO.txt (ver backend/CLAUDE.md).
--
-- Gap #1 (gate de revisión de stock, AWAITING_STOCK_REVIEW) y gap #4 (modo
-- estricto de overlays) son resoluciones a nivel de código/tipos
-- (JobStatus, OverlaySpec en typeShared.ts) y no requieren cambios de
-- schema: video_projects.status y jobs.status ya son texto libre, no enum.

-- Gap #3: reglas de contenido por proyecto (bloqueo/preferencia de stock).
alter table public.video_projects
  add column if not exists content_policy jsonb;

-- Gap #2: lista negra / curada de stock persistente ENTRE videos.
-- Reemplaza bad_stock_ids.json / stock_overrides.json del sistema local.
-- Vive por user_id (no por video_project_id) a propósito: tiene que
-- sobrevivir más allá de un proyecto puntual.
create table if not exists public.stock_library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  external_id text not null,
  decision text not null check (decision in ('BLOCKED', 'PREFERRED')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_id)
);

create index if not exists stock_library_entries_user_id_idx
  on public.stock_library_entries (user_id);

-- Nota: el backend usa el service-role client y filtra por user_id a mano
-- en cada query (ver convención en CLAUDE.md) — igual que el resto de las
-- tablas, no se habilita RLS acá para no introducir un patrón distinto al
-- que ya tiene el resto del schema.
