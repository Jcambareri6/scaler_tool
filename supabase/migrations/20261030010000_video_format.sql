-- Formatos de video. "stock": el de siempre (stock o IA de base, con
-- graficos animados opcionales encima). "animated": todo animado, sin
-- stock -- Remotion dibuja el video entero (backend/src/lib/formats.ts).
-- Se van a sumar mas formatos: por eso texto con check y no un booleano.
alter table public.video_projects
  add column if not exists video_format text not null default 'stock';

alter table public.video_projects
  drop constraint if exists video_projects_video_format_check;
alter table public.video_projects
  add constraint video_projects_video_format_check check (video_format in ('stock', 'animated'));
