import { createClient } from "@supabase/supabase-js";

// Cliente con la key publishable (segura para el navegador, no es la
// service-role del backend) -- se usa solo para Realtime (escuchar cambios
// en `jobs` sin polling), el resto de la app sigue hablando por la API
// propia (ver lib/api.ts).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
