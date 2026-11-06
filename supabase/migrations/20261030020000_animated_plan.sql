-- Formato todo animado: el plan del director de escenas (escenas, capa fija y
-- duracion) que despues dibuja el render con Remotion.
alter table public.video_projects
  add column if not exists animated_plan jsonb;
