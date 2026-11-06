-- Director de graficos animados (backend/src/director): el storyboard de
-- cada video -- estructura (gancho, capitulos, climax, cierre) y momentos
-- elegidos o descartados con su motivo -- para revisar por que eligio cada
-- grafico. Null cuando lo planifico el planificador de una sola llamada.
alter table public.video_projects
  add column if not exists overlay_storyboard jsonb;
