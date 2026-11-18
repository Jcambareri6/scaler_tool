-- Caches del documental (como las de Redis de MaV), para no pagar todo de
-- nuevo al regenerar un video o relanzarlo despues de un fallo.
--
-- yt_search_cache: resultados de una busqueda de YouTube (6 h). Solo se
--   guardan resultados no vacios.
-- shot_cache: el material que paso el juez para una frase (14 dias), con
--   clave sha1(version :: tema :: lugar :: clase :: busqueda :: frase :: duracion).
--   Nunca se guardan fallos de descarga.

create table if not exists public.yt_search_cache (
  query text primary key,
  results jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shot_cache (
  key text primary key,
  candidate jsonb not null,
  reason text,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists shot_cache_created_at_idx on public.shot_cache (created_at);
create index if not exists yt_search_cache_created_at_idx on public.yt_search_cache (created_at);
