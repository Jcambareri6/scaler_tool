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
  // Estilo de narracion (Prompt Maestro de script_styles) y voz por defecto
  // del canal: los proyectos nuevos del workspace los traen precargados.
  script_style_id: string | null;
  voice_id: string | null;
  // Resumen del estilo para mostrarlo a miembros que no son sus dueños
  // (script_styles es por usuario, ver CLAUDE.md).
  script_style: { id: string; name: string; status: string } | null;
}

const EMPTY: ChannelSettings = {
  workspace_id: null,
  channel_language: null,
  narration_style: null,
  visual_style_prompt: null,
  script_style_id: null,
  voice_id: null,
  script_style: null,
};

const COLUMNS = "id, channel_language, narration_style, visual_style_prompt, script_style_id, voice_id";

// Topes para no mandarle al LLM un texto gigante en cada escena.
export const CHANNEL_TEXT_MAX = 6000;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, CHANNEL_TEXT_MAX) : null;
}

async function toSettings(row: Record<string, unknown> | null): Promise<ChannelSettings> {
  if (!row) return EMPTY;
  const scriptStyleId = typeof row.script_style_id === "string" ? row.script_style_id : null;
  let scriptStyle: ChannelSettings["script_style"] = null;
  if (scriptStyleId) {
    const { data } = await supabase.from("script_styles").select("id, name, status").eq("id", scriptStyleId).maybeSingle();
    if (data) scriptStyle = { id: data.id as string, name: data.name as string, status: data.status as string };
  }
  return {
    workspace_id: (row.id as string) ?? null,
    channel_language: clean(row.channel_language),
    narration_style: clean(row.narration_style),
    visual_style_prompt: clean(row.visual_style_prompt),
    script_style_id: scriptStyle ? scriptStyleId : null,
    voice_id: typeof row.voice_id === "string" && row.voice_id ? row.voice_id : null,
    script_style: scriptStyle,
  };
}

export async function getChannelSettingsForWorkspace(workspaceId: string): Promise<ChannelSettings> {
  const { data } = await supabase.from("workspaces").select(COLUMNS).eq("id", workspaceId).maybeSingle();
  return toSettings(data);
}

// No valida acceso: el caller ya resolvio el proyecto con getOwnedProject.
export async function getChannelSettingsForProject(projectId: string): Promise<ChannelSettings> {
  const { data: project } = await supabase
    .from("video_projects")
    .select("user_id, workspace_id")
    .eq("id", projectId)
    .single();
  if (!project) return EMPTY;

  if (project.workspace_id) return getChannelSettingsForWorkspace(project.workspace_id);

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
