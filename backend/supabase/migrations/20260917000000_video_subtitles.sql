-- Toggle simple para quemar subtitulos (generados con el transcript de
-- Whisper, ver transcribe_audio.tool.ts) en el render automatico -- ver
-- render_video.tool.ts. Default false: no cambia el comportamiento de
-- proyectos existentes. Mismo patron que transitions_enabled (ver
-- 20260916000000_video_transitions.sql).
alter table public.video_projects
  add column if not exists subtitles_enabled boolean not null default false;
