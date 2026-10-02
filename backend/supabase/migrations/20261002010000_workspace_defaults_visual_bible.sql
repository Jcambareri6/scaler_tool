-- El workspace como "plantilla del canal": estilo de narracion (Prompt
-- Maestro) y voz por defecto. Todo proyecto nuevo del workspace los trae
-- precargados, y el estilo lo pueden usar todos los miembros aunque lo haya
-- creado uno solo.
--
-- (Esta migracion tambien agregaba scripts.visual_bible -- la "biblia
-- visual" armada por la IA. Se saco antes de aplicarla: los personajes los
-- aporta el usuario como ingredientes en Flow y los prompts se arman solo
-- con el diseño visual del canal + el guion con timestamps.)
alter table public.workspaces
  add column if not exists script_style_id uuid references public.script_styles(id) on delete set null,
  add column if not exists voice_id text;
