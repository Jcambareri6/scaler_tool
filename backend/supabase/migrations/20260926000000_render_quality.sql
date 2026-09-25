-- Calidad (resolucion) del render final por proyecto -- ver
-- render_video.tool.ts (RENDER_SIZES). Default '720p': no cambia el
-- comportamiento de proyectos existentes. '1080p' tarda ~2x en renderizar
-- (2.25x pixeles), viable en el servidor del worker. Mismo patron que
-- transitions_enabled / subtitles_enabled.
alter table public.video_projects
  add column if not exists render_quality text not null default '720p'
  check (render_quality in ('720p', '1080p'));
