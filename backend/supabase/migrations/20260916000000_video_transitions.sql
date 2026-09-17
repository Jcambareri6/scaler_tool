-- Toggle simple para activar transiciones (fundido) entre las escenas del
-- render automatico -- ver render_video.tool.ts. Default false: no cambia
-- el comportamiento de proyectos existentes.
alter table public.video_projects
  add column if not exists transitions_enabled boolean not null default false;
