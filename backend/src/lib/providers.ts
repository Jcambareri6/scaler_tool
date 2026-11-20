import { supabase } from "./supabase.js";
import type { Provider } from "../types/shared/typeShared.js";

// OFFLINE_PROVIDERS=true (solo desarrollo y tests, ver scripts/test-cobro.ts):
// se ignoran los providers de la base, asi una API local apuntando a la base
// de produccion nunca le pega a ai33, Whisper ni a los LLMs con las keys
// reales -- junto con MOCK_PROVIDERS=true, todo cae a los mocks.
function providersOffline(): boolean {
  return process.env.OFFLINE_PROVIDERS === "true";
}

// Las Tools resuelven su Provider por slug sin saber como esta guardado
// (Etapa 9: "las Tools deben poder utilizar Providers sin conocer detalles
// innecesarios de su configuracion").
// Ultima fila leida bien de cada proveedor: si Supabase no responde (corte
// de red del 20/11/2026), se usa esa en vez de devolver "no configurado" y
// perder el plano ("R2 no esta configurado" con R2 configurado).
const lastGood = new Map<string, Provider>();

export async function getActiveProvider(slug: string): Promise<Provider | null> {
  if (providersOffline()) return null;
  const { data, error } = await supabase
    .from("providers")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) return lastGood.get(slug) ?? null;
  if (!data) {
    lastGood.delete(slug);
    return null;
  }
  lastGood.set(slug, data);
  return data;
}

// Para Tools que quieren pegarle a "todos los proveedores disponibles de
// tal categoria" (ej: search_stock contra todos los de stock de video) sin
// tener slugs hardcodeados -- agregar un proveedor nuevo de ese type es
// solo una fila en la tabla + su cliente en el codigo de la Tool, no un
// cambio en como se resuelven los proveedores.
export async function getActiveProvidersByType(type: string): Promise<Provider[]> {
  if (providersOffline()) return [];
  const { data, error } = await supabase
    .from("providers")
    .select("*")
    .eq("type", type)
    .eq("is_active", true);

  if (error || !data) return [];
  return data;
}
