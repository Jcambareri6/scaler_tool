-- Metricas animadas (contadores, barras, versus, linea de tiempo,
-- ubicacion, capitulos, CTA) quemadas en el render -- ver
-- tools/planOverlays.tool.ts (que va en cada escena) y lib/overlayAss.ts
-- (como se dibuja). Default false: no cambia el comportamiento de
-- proyectos existentes. Mismo patron que subtitles_enabled.
alter table public.video_projects
  add column if not exists overlays_enabled boolean not null default false;

-- Paleta de los overlays segun el genero del video.
alter table public.video_projects
  add column if not exists overlay_theme text not null default 'documental';

alter table public.video_projects
  drop constraint if exists video_projects_overlay_theme_check;
alter table public.video_projects
  add constraint video_projects_overlay_theme_check
  check (overlay_theme in ('documental', 'ciencia', 'finanzas', 'historia', 'crimen', 'minimal'));
