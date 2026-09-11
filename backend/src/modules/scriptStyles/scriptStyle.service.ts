import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedScriptStyle } from "../../lib/ownership.js";
import { runTool } from "../../tools/index.js";

export async function createScriptStyle(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const { name, reference_scripts, master_prompt } = req.body as {
      name?: string;
      reference_scripts?: string[];
      master_prompt?: string;
    };

    if (typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name is required" });
    }

    const hasMasterPrompt = typeof master_prompt === "string" && master_prompt.trim() !== "";
    const scripts = Array.isArray(reference_scripts) ? reference_scripts : [];

    if (!hasMasterPrompt && scripts.length === 0) {
      return res
        .status(400)
        .json({ error: "reference_scripts must be a non-empty array, or provide master_prompt directly" });
    }

    // Si el usuario carga el prompt maestro a mano no hace falta pasar por
    // generate_script_style (analisis por IA de guiones de referencia): el
    // estilo queda READY de una.
    const { data, error } = await supabase
      .from("script_styles")
      .insert({
        user_id: userId,
        name,
        reference_scripts: scripts,
        master_prompt: hasMasterPrompt ? master_prompt.trim() : null,
        status: hasMasterPrompt ? "READY" : "PENDING",
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

export async function listScriptStyles(req: Request, res: Response) {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from("script_styles")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data ?? []);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getScriptStyle(req: Request, res: Response) {
  try {
    const { script_style_id } = req.params;
    const userId = req.user!.id;

    const style = await getOwnedScriptStyle(script_style_id, userId);
    if (!style) {
      return res.status(404).json({ error: "Script style not found" });
    }

    return res.status(200).json(style);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateScriptStyle(req: Request, res: Response) {
  try {
    const { script_style_id } = req.params;
    const userId = req.user!.id;
    const { name, master_prompt } = req.body as { name?: string; master_prompt?: string };

    const style = await getOwnedScriptStyle(script_style_id, userId);
    if (!style) {
      return res.status(404).json({ error: "Script style not found" });
    }

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (master_prompt !== undefined) update.master_prompt = master_prompt;

    const { data, error } = await supabase
      .from("script_styles")
      .update(update)
      .eq("id", script_style_id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteScriptStyle(req: Request, res: Response) {
  try {
    const { script_style_id } = req.params;
    const userId = req.user!.id;

    const style = await getOwnedScriptStyle(script_style_id, userId);
    if (!style) {
      return res.status(404).json({ error: "Script style not found" });
    }

    const { error } = await supabase.from("script_styles").delete().eq("id", script_style_id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Corre generate_script_style (analiza reference_scripts, guarda
// master_prompt/status directo en la fila) y devuelve el row actualizado.
export async function generateScriptStyle(req: Request, res: Response) {
  try {
    const { script_style_id } = req.params;
    const userId = req.user!.id;

    const style = await getOwnedScriptStyle(script_style_id, userId);
    if (!style) {
      return res.status(404).json({ error: "Script style not found" });
    }

    try {
      await runTool("generate_script_style", { script_style_id }, { userId });
    } catch (toolError) {
      const message = toolError instanceof Error ? toolError.message : "generate_script_style failed";
      return res.status(400).json({ error: message });
    }

    const updated = await getOwnedScriptStyle(script_style_id, userId);
    return res.status(200).json(updated ?? style);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
