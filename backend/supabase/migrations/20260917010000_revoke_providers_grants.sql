-- La tabla `providers` guarda api_key en texto plano. El backend la sanea
-- antes de responder (provider.service.ts sanitizeProvider), pero esa
-- proteccion no aplica si alguien pega directo a PostgREST con la anon key
-- (publica por diseño, esta en el bundle del frontend). El backend siempre
-- usa el service-role key (bypassa grants), asi que revocar acceso de
-- anon/authenticated sobre esta tabla puntual no rompe nada existente.
revoke all on public.providers from anon, authenticated;
