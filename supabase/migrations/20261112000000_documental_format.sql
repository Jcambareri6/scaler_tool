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
