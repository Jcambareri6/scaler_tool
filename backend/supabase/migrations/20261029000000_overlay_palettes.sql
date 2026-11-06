-- Estilo de los graficos animados: la paleta es del CANAL (identidad que se
-- mantiene video a video) y el nicho es de cada VIDEO (decide componentes y
-- ritmo). Paletas en backend/motion/niches.json, clave "<nicho>:<paleta>".
-- Ver lib/niches.ts.

-- Paleta elegida para el canal (normalmente en la revision del primer video).
alter table public.workspaces
  add column if not exists overlay_palette text;

-- Nicho detectado por plan_overlays para este video.
alter table public.video_projects
  add column if not exists niche text;

-- Excepcion de un video puntual (especial, colaboracion): pisa la del canal.
alter table public.video_projects
  add column if not exists overlay_palette text;
