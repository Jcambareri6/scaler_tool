-- Fase 1 (Script Styles / "Prompt Maestro" por canal): permite analizar 3
-- guiones de referencia de un cliente/canal una sola vez y reusar el prompt
-- resultante en cualquier video futuro del mismo usuario. Ver plan en
-- backend/claude/CLAUDE.md (sección Etapa 4 — Gestión del Script).

-- script_styles: scoped por user_id (no por proyecto), igual criterio que
-- stock_library_entries -- un "Prompt Maestro" de canal se reusa en muchos
-- proyectos del mismo usuario, no pertenece a uno solo.
create table if not exists public.script_styles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  reference_scripts jsonb not null,       -- string[] (los guiones pegados)
  master_prompt text,                      -- null hasta que corre generate_script_style
  status text not null default 'PENDING' check (status in ('PENDING','READY','FAILED')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists script_styles_user_id_idx
  on public.script_styles (user_id);

-- Cada proyecto puede opcionalmente enlazar el estilo de canal a usar al
-- generar su guion. on delete set null: si se borra el estilo, el proyecto
-- no se rompe, vuelve al prompt generico.
alter table public.video_projects
  add column if not exists script_style_id uuid references public.script_styles(id) on delete set null;

-- Nota: sin RLS, mismo criterio que el resto del schema (ver CLAUDE.md) --
-- el backend usa el service-role client y filtra por user_id a mano.
