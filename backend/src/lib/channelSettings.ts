import { createHash } from "crypto";
import { supabase } from "./supabase.js";

// "Recursos compartidos" del canal (columnas de workspaces, ver migracion
// 20261002000000_workspace_channel_settings.sql). Un proyecto toma los de
// su workspace; si no tiene workspace (workspace_id null), los del
// workspace personal de su creador.

export interface ChannelSettings {
  workspace_id: string | null;
  channel_language: string | null;
  narration_style: string | null;
  visual_style_prompt: string | null;
}

const EMPTY: ChannelSettings = {
  workspace_id: null,
  channel_language: null,
  narration_style: null,
  visual_style_prompt: null,
};

const COLUMNS = "id, channel_language, narration_style, visual_style_prompt";

// Topes para no mandarle al LLM un texto gigante en cada escena.
export const CHANNEL_TEXT_MAX = 6000;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, CHANNEL_TEXT_MAX) : null;
}

function toSettings(row: Record<string, unknown> | null): ChannelSettings {
  if (!row) return EMPTY;
  return {
    workspace_id: (row.id as string) ?? null,
    channel_language: clean(row.channel_language),
    narration_style: clean(row.narration_style),
    visual_style_prompt: clean(row.visual_style_prompt),
  };
}

// No valida acceso: el caller ya resolvio el proyecto con getOwnedProject.
export async function getChannelSettingsForProject(projectId: string): Promise<ChannelSettings> {
  const { data: project } = await supabase
    .from("video_projects")
    .select("user_id, workspace_id")
    .eq("id", projectId)
    .single();
  if (!project) return EMPTY;

  if (project.workspace_id) {
    const { data } = await supabase.from("workspaces").select(COLUMNS).eq("id", project.workspace_id).maybeSingle();
    return toSettings(data);
  }

  const { data } = await supabase
    .from("workspaces")
    .select(COLUMNS)
    .eq("owner_id", project.user_id)
    .eq("is_personal", true)
    .maybeSingle();
  return toSettings(data);
}

// Huella del estilo visual con el que se armo un prompt de imagen -- si el
// estilo del canal cambia, los prompts guardados con otra huella se
// regeneran solos (ver sceneBatch.service.ts).
export function visualStyleKey(visualStyle: string | null): string {
  if (!visualStyle) return "none";
  return createHash("sha1").update(visualStyle).digest("hex").slice(0, 12);
}
