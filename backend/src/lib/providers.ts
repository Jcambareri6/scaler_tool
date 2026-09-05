import { supabase } from "./supabase.js";
import type { Provider } from "../types/shared/typeShared.js";

// Las Tools resuelven su Provider por slug sin saber como esta guardado
// (Etapa 9: "las Tools deben poder utilizar Providers sin conocer detalles
// innecesarios de su configuracion").
export async function getActiveProvider(slug: string): Promise<Provider | null> {
  const { data, error } = await supabase
    .from("providers")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data;
}

// Para Tools que quieren pegarle a "todos los proveedores disponibles de
// tal categoria" (ej: search_stock contra todos los de stock de video) sin
// tener slugs hardcodeados -- agregar un proveedor nuevo de ese type es
// solo una fila en la tabla + su cliente en el codigo de la Tool, no un
// cambio en como se resuelven los proveedores.
export async function getActiveProvidersByType(type: string): Promise<Provider[]> {
  const { data, error } = await supabase
    .from("providers")
    .select("*")
    .eq("type", type)
    .eq("is_active", true);

  if (error || !data) return [];
  return data;
}
