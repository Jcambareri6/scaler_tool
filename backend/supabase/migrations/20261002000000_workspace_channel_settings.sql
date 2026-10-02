-- Recursos compartidos del canal, a nivel workspace: lo que tiene que
-- respetar TODO video del canal, sin importar que miembro lo genere.
--   channel_language     -> idioma por defecto del guion ("español", "inglés", ...)
--   narration_style      -> tono/ritmo/forma de narrar (se suma al Prompt Maestro)
--   visual_style_prompt  -> diseño visual del canal para los prompts de imagen
--                           (Flow / Imagen con IA)
-- Todas nullable: sin configurar, todo se comporta como antes.
alter table public.workspaces
  add column if not exists channel_language text,
  add column if not exists narration_style text,
  add column if not exists visual_style_prompt text;
