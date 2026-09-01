import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { isMockMode } from "../lib/mock.js";
import { supabase } from "../lib/supabase.js";

export interface RenderVideoInput {
  video_project_id: string;
  timeline_id: string;
}

export interface RenderVideoOutput {
  storage_key: string;
  duration_seconds: number;
}

function parseTime(value: string): number {
  const [mm, ss] = value.split(":").map(Number);
  return (mm ?? 0) * 60 + (ss ?? 0);
}

async function mockRender(videoProjectId: string, timelineId: string): Promise<RenderVideoOutput> {
  const { data: timeline, error } = await supabase
    .from("timelines")
    .select("content")
    .eq("id", timelineId)
    .single();
  if (error || !timeline) {
    throw new Error("Timeline not found");
  }

  const scenes = ((timeline.content as { scenes?: { end: string }[] } | null)?.scenes) ?? [];
  const durationSeconds = scenes.length > 0 ? parseTime(scenes[scenes.length - 1]!.end) : 0;

  return {
    storage_key: `mock://render/${videoProjectId}.mp4`,
    duration_seconds: durationSeconds,
  };
}

// Composicion final (FFmpeg): une clips + audio + overlays ya renderizados
// segun el Timeline. Es el ultimo paso del pipeline (Etapa 12).
export const renderVideoTool: ToolDefinition<RenderVideoInput, RenderVideoOutput> = {
  name: "render_video",
  description:
    "Compone el video final (clips + audio + overlays) a partir del Timeline resuelto.",
  parameters: {
    type: "object",
    properties: {
      video_project_id: { type: "string", description: "UUID del proyecto" },
      timeline_id: { type: "string", description: "UUID del timeline resuelto" },
    },
    required: ["video_project_id", "timeline_id"],
  },
  async execute({ video_project_id, timeline_id }) {
    const provider = await getActiveProvider("ffmpeg");
    if (!provider?.api_key) {
      if (isMockMode()) {
        return mockRender(video_project_id, timeline_id);
      }
      throw new ProviderNotConfiguredError("render_video");
    }
    throw new Error(`Provider "ffmpeg" is active but its client is not implemented yet`);
  },
};
