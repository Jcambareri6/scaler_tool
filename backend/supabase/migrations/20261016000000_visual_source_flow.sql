-- visual_source "flow": el pipeline deja las escenas vacias (sin stock) con
-- el prompt de imagen ya armado, para cargarlas desde Google Flow con la
-- extension (ver orchestrator.ts). La columna viene del schema inicial, que
-- no esta en este repo: si tiene un check (o es un enum) con los valores
-- viejos, se amplia; si es texto libre no cambia nada.
do $$
declare
  con record;
  col_type text;
begin
  select udt_name into col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'video_projects' and column_name = 'visual_source';

  if col_type is null then
    return;
  end if;

  if col_type not in ('text', 'varchar', 'bpchar') then
    execute format('alter type public.%I add value if not exists %L', col_type, 'flow');
    return;
  end if;

  for con in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.video_projects'::regclass
      and c.contype = 'c'
      and a.attname = 'visual_source'
  loop
    execute format('alter table public.video_projects drop constraint %I', con.conname);
  end loop;

  alter table public.video_projects
    add constraint video_projects_visual_source_check
    check (visual_source in ('stock', 'ai', 'mixed', 'flow'));
end $$;
