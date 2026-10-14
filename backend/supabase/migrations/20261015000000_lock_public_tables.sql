-- Cierra el acceso directo a la base con la key publica de Supabase.
--
-- RLS esta apagado en public (decision del 2026-08-30) y la anon key viaja
-- en el bundle del frontend, asi que hasta ahora cualquiera podia leer y
-- ESCRIBIR todas las tablas pegandole directo a PostgREST, sin pasar por el
-- backend: leer guiones ajenos, meter un job en la cola de render, etc.
-- Con el contador de videos eso ademas permitiria cargarse saldo a mano.
--
-- El backend usa la service_role key (no la afectan estos grants). Lo unico
-- que el frontend lee directo de Supabase es `jobs`, por Realtime
-- (PreviewPanel.tsx, progreso del render) -- por eso conserva SELECT.
--
-- Vuelta atras (si algo del frontend dejara de andar):
--   grant select, insert, update, delete on all tables in schema public to anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;

revoke select on all tables in schema public from anon, authenticated;

grant select on public.jobs to anon, authenticated;

-- Secuencias y funciones existentes: solo el backend.
revoke all on all sequences in schema public from anon, authenticated;

-- Tablas y secuencias que se creen en el futuro arrancan sin acceso desde
-- la key publica (hay que darselo explicitamente si alguna vez hace falta).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
-- Las funciones nuevas se cierran una por una (revoke ... from public, anon,
-- authenticated + grant a service_role), como claim_next_job.
