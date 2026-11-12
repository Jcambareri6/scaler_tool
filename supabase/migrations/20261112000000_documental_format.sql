-- Formato documental con material real (estilo Make a Videos, ver
-- PLAN-stock-con-graficos-estilo-mav.md). Solo admins mientras se prueba
-- (backend/src/lib/formats.ts::effectiveFormat).
-- video_style: preset de backend/src/lib/documentalStyles.ts.
-- documental_plan: plan de planos del montajista (capitulos, planos, avisos
-- del verificador y del juez), para la revision y para auditar.
alter table public.video_projects
  drop constraint if exists video_projects_video_format_check;
alter table public.video_projects
  add constraint video_projects_video_format_check check (video_format in ('stock', 'animated', 'documental'));

alter table public.video_projects
  add column if not exists video_style text;

alter table public.video_projects
  add column if not exists documental_plan jsonb;

-- Biblioteca de musica del formato documental (pistas con licencia de uso
-- comercial, una o mas por animo). La carga scripts/seed-music.ts; el render
-- elige una al azar del animo del estilo y la baja bajo la voz (ducking).
create table if not exists public.music_library (
  id uuid primary key default gen_random_uuid(),
  mood text not null check (mood in ('documental', 'tension', 'triste', 'epico', 'misterio', 'esperanza')),
  title text not null,
  author text,
  license text not null,
  source_page text,
  url text not null,
  created_at timestamptz not null default now()
);
-- Solo el backend (service role) la lee y escribe.
alter table public.music_library enable row level security;
revoke all on public.music_library from anon, authenticated;
