import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import type { Provider } from "../../types/shared/typeShared.js";

// Nunca devolvemos api_key en una respuesta HTTP (Etapa 9: "credenciales
// manejadas de forma segura"). El caller solo necesita saber si esta seteada.
function sanitizeProvider(provider: Provider) {
  const { api_key, ...rest } = provider;
  return { ...rest, has_api_key: Boolean(api_key) };
}

export async function createProvider(req: Request, res: Response) {
  try {
    const { name, slug, type, api_key, configuration, is_active } = req.body;

    if (typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name is required" });
    }
    if (typeof slug !== "string" || slug.trim() === "") {
      return res.status(400).json({ error: "slug is required" });
    }

    const { data, error } = await supabase
      .from("providers")
      .insert({
        name,
        slug,
        type: type ?? null,
        api_key: api_key ?? null,
        configuration: configuration ?? {},
        ...(is_active !== undefined ? { is_active } : {}),
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "A provider with this slug already exists" });
      }
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(sanitizeProvider(data));
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function listProviders(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json((data ?? []).map(sanitizeProvider));
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getProvider(req: Request, res: Response) {
  try {
    const { provider_id } = req.params;

    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .eq("id", provider_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Provider not found" });
    }

    return res.status(200).json(sanitizeProvider(data));
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateProvider(req: Request, res: Response) {
  try {
    const { provider_id } = req.params;
    const { name, slug, type, api_key, configuration, is_active } = req.body;

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (slug !== undefined) update.slug = slug;
    if (type !== undefined) update.type = type;
    if (api_key !== undefined) update.api_key = api_key;
    if (configuration !== undefined) update.configuration = configuration;
    if (is_active !== undefined) update.is_active = is_active;

    const { data, error } = await supabase
      .from("providers")
      .update(update)
      .eq("id", provider_id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Provider not found" });
      }
      if (error.code === "23505") {
        return res.status(409).json({ error: "A provider with this slug already exists" });
      }
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(sanitizeProvider(data));
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteProvider(req: Request, res: Response) {
  try {
    const { provider_id } = req.params;

    const { error } = await supabase.from("providers").delete().eq("id", provider_id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
