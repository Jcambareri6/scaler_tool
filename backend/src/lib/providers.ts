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
