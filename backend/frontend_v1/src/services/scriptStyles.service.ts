import { api } from "@/lib/api";
import { mapScriptStyle } from "@/lib/mappers";
import type { ScriptStyle } from "@/types";

export const scriptStylesService = {
  async list(): Promise<ScriptStyle[]> {
    const rows = await api.get<Parameters<typeof mapScriptStyle>[0][]>("/script-styles");
    return rows.map(mapScriptStyle);
  },

  async get(id: string): Promise<ScriptStyle> {
    const row = await api.get<Parameters<typeof mapScriptStyle>[0]>(`/script-styles/${id}`);
    return mapScriptStyle(row);
  },

  async create(name: string, referenceScripts: string[]): Promise<ScriptStyle> {
    const row = await api.post<Parameters<typeof mapScriptStyle>[0]>("/script-styles", {
      name,
      reference_scripts: referenceScripts,
    });
    return mapScriptStyle(row);
  },

  // Crea el estilo con un prompt maestro ya escrito/pegado por el usuario --
  // queda READY directo, sin pasar por el analisis por IA de guiones de
  // referencia (generate_script_style).
  async createWithMasterPrompt(name: string, masterPrompt: string): Promise<ScriptStyle> {
    const row = await api.post<Parameters<typeof mapScriptStyle>[0]>("/script-styles", {
      name,
      master_prompt: masterPrompt,
    });
    return mapScriptStyle(row);
  },

  // Corre el analisis (generate_script_style) y devuelve el estilo con
  // master_prompt/status ya actualizados -- puede tardar unos segundos
  // (llamada real a OpenAI).
  async generate(id: string): Promise<ScriptStyle> {
    const row = await api.post<Parameters<typeof mapScriptStyle>[0]>(`/script-styles/${id}/generate`);
    return mapScriptStyle(row);
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/script-styles/${id}`);
  },
};
