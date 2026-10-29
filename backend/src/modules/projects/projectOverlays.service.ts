import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedProject } from "../../lib/ownership.js";
import { getChannelSettingsForProject } from "../../lib/channelSettings.js";
import { placeOverlays, type OverlaySceneTiming } from "../../lib/overlayTiming.js";
import { numberLocale } from "../../lib/motion.js";

// GET /projects/:project_id/overlays
// Graficos animados ya ubicados en el tiempo, para dibujarlos en vivo en la
// revision de stock (frontend, @remotion/player) ANTES de renderizar. Usa
// el mismo placeOverlays que render_video sobre el mismo timeline, asi lo
// que se ve en el preview es lo que despues queda en el video. No filtra
// por catalogo (la API en Render no tiene motion/ instalado): el front
// ignora los tipos que todavia no tienen componente.
export async function getProjectOverlays(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const access = await getOwnedProject(project_id, req.user!.id, "viewer");
    if (!access) return res.status(404).json({ error: "Project not found" });

    const { data: project, error: projectError } = await supabase
      .from("video_projects")
      .select("overlays_enabled, overlay_theme")
      .eq("id", access.id)
      .single();
    if (projectError) throw projectError;

    const { data: timeline, error: timelineError } = await supabase
      .from("timelines")
      .select("content")
      .eq("video_project_id", access.id)
      .maybeSingle();
    if (timelineError) throw timelineError;

    const scenes = ((timeline?.content as { scenes?: OverlaySceneTiming[] } | null)?.scenes) ?? [];
    const overlays = project?.overlays_enabled ? placeOverlays(scenes) : [];
    const locale = numberLocale((await getChannelSettingsForProject(access.id)).channel_language);

    return res.status(200).json({
      enabled: Boolean(project?.overlays_enabled),
      theme: project?.overlay_theme ?? "documental",
      locale,
      overlays,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
}
