-- 1) El workspace como "plantilla del canal": estilo de narracion (Prompt
--    Maestro) y voz por defecto. Todo proyecto nuevo del workspace los trae
--    precargados, y el estilo lo pueden usar todos los miembros aunque lo
--    haya creado uno solo.
alter table public.workspaces
  add column if not exists script_style_id uuid references public.script_styles(id) on delete set null,
  add column if not exists voice_id text;

-- 2) Biblia visual del video: ficha fija de personajes, lugares, epoca y
--    paleta que arma la IA leyendo el guion completo + el diseño visual del
--    canal. Todos los prompts de imagen del video se arman a partir de ella
--    para que las imagenes sigan una secuencia. Columna propia (no dentro de
--    scripts.content) porque guardar el guion reemplaza content entero.
--    Forma: { text: string, key: string, edited: boolean, updated_at: string }
alter table public.scripts
  add column if not exists visual_bible jsonb;
