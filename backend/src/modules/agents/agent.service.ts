import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { runAgent } from "../../agents/agent.service.js";
import type { AgentMessage } from "../../agents/agent.types.js";

// Endpoint transitorio para probar el Agent de punta a punta sin depender
// de Etapa 11 (Chat), que es quien va a persistir la conversacion de
// verdad. Este handler no guarda nada — recibe el historial completo en el
// body en cada llamada.
export async function runAgentEndpoint(req: Request, res: Response) {
  try {
    const { provider_slug, messages, project_id } = req.body as {
      provider_slug?: string;
      messages?: AgentMessage[];
      project_id?: string;
    };

    if (typeof provider_slug !== "string" || provider_slug.trim() === "") {
      return res.status(400).json({ error: "provider_slug is required" });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }

    const userId = req.user!.id;
    const result = await runAgent(provider_slug, messages, {
      userId,
      ...(project_id ? { projectId: project_id } : {}),
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed";
    return res.status(400).json({ error: message });
  }
}

export async function createAgent(req: Request, res: Response) {
  try {
    const { name, description, model, configuration } = req.body;

    if (typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name is required" });
    }
    if (typeof model !== "string" || model.trim() === "") {
      return res.status(400).json({ error: "model is required" });
    }

    const { data, error } = await supabase
      .from("agents")
      .insert({
        name,
        description: description ?? null,
        model,
        configuration: configuration ?? {},
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function listAgents(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data ?? []);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getAgent(req: Request, res: Response) {
  try {
    const { agent_id } = req.params;

    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agent_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Agent not found" });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateAgent(req: Request, res: Response) {
  try {
    const { agent_id } = req.params;
    const { name, description, model, configuration } = req.body;

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (model !== undefined) update.model = model;
    if (configuration !== undefined) update.configuration = configuration;

    const { data, error } = await supabase
      .from("agents")
      .update(update)
      .eq("id", agent_id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Agent not found" });
      }
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteAgent(req: Request, res: Response) {
  try {
    const { agent_id } = req.params;

    const { error } = await supabase.from("agents").delete().eq("id", agent_id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
