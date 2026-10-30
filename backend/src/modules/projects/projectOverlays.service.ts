import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedProject, getWorkspaceRole, roleAtLeast } from "../../lib/ownership.js";
import { getChannelSettingsForProject } from "../../lib/channelSettings.js";
import { placeOverlays, type OverlaySceneTiming } from "../../lib/overlayTiming.js";
import { numberLocale } from "../../lib/motion.js";
import { isAdmin } from "../../lib/accounts.js";
import { channelWorkspaceId, findPalette, getNiche, resolveProjectStyle } from "../../lib/niches.js";

// GET /projects/:project_id/overlays
// Graficos animados ya ubicados en el tiempo, para dibujarlos en vivo en la
// revision de stock (frontend, @remotion/player) ANTES de renderizar. Usa
// el mismo placeOverlays que render_video sobre el mismo timeline, asi lo
// que se ve en el preview es lo que despues queda en el video. No filtra
// por catalogo (la API en Render no tiene motion/ instalado): el front
// ignora los tipos que todavia no tienen componente.
// `style`: el estilo efectivo y, si el canal todavia no eligio paleta, las
// 3 del nicho del video para elegir viendolas sobre este mismo video.
export async function getProjectOverlays(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;
    const access = await getOwnedProject(project_id, userId, "viewer");
    if (!access) return res.status(404).json({ error: "Project not found" });

    const { data: project, error: projectError } = await supabase
      .from("video_projects")
      .select("overlays_enabled, overlay_theme, workspace_id, user_id")
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
    // Graficos animados: solo para admins mientras estan en prueba.
    const enabled = Boolean(project?.overlays_enabled) && isAdmin(userId);
    const overlays = enabled ? placeOverlays(scenes) : [];
    const locale = numberLocale((await getChannelSettingsForProject(access.id)).channel_language);

    const style = await resolveProjectStyle(access.id);
    const channelId = await channelWorkspaceId(project.workspace_id as string | null, project.user_id as string);
    const canSaveChannel = roleAtLeast(await getWorkspaceRole(channelId, userId), "admin");
    const niche = style ? getNiche(style.niche) : null;

    return res.status(200).json({
      enabled,
      // La paleta resuelta; sin niches.json, el tema viejo del proyecto.
      theme: style?.theme ?? project?.overlay_theme ?? "documental",
      locale,
      overlays,
      style: style
        ? {
            niche: style.niche,
            nicheName: style.nicheName,
            paletteKey: style.paletteKey,
            paletteName: style.paletteName,
            source: style.source,
            canSaveChannel,
            options: (niche?.palettes ?? []).map((p) => ({
              key: `${style.niche}:${p.id}`,
              name: p.name,
              theme: { accent: p.accent, text: p.text, textMuted: p.textMuted, scrim: p.scrim, titleFont: niche!.titleFont },
            })),
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
}

// POST /projects/:project_id/overlay-palette  { palette: "<nicho>:<paleta>", scope: "channel" | "video" }
// "channel": la paleta pasa a ser la del canal (admin del workspace, misma
// regla que la configuracion del canal) y la usan los videos siguientes.
// "video": excepcion solo para este proyecto (editor alcanza).
export async function setProjectOverlayPalette(req: Request, res: Response) {
  try {
    const { project_id } = req.params;
    const userId = req.user!.id;
    const { palette, scope } = (req.body ?? {}) as { palette?: unknown; scope?: unknown };
    if (typeof palette !== "string" || !findPalette(palette)) {
      return res.status(400).json({ error: "Paleta desconocida" });
    }
    if (scope !== "channel" && scope !== "video") {
      return res.status(400).json({ error: 'scope tiene que ser "channel" o "video"' });
    }

    const access = await getOwnedProject(project_id, userId, "editor");
    if (!access) return res.status(404).json({ error: "Project not found" });

    if (scope === "video") {
      const { error } = await supabase.from("video_projects").update({ overlay_palette: palette }).eq("id", access.id);
      if (error) throw error;
    } else {
      const { data: project } = await supabase
        .from("video_projects")
        .select("workspace_id, user_id")
        .eq("id", access.id)
        .single();
      const channelId = await channelWorkspaceId((project?.workspace_id as string | null) ?? null, project?.user_id as string);
      if (!channelId || !roleAtLeast(await getWorkspaceRole(channelId, userId), "admin")) {
        return res.status(403).json({ error: "Solo un admin del canal puede cambiar su estilo" });
      }
      const { error } = await supabase.from("workspaces").update({ overlay_palette: palette }).eq("id", channelId);
      if (error) throw error;
      // Si este video tenia una excepcion, deja de tenerla: ahora sigue al canal.
      await supabase.from("video_projects").update({ overlay_palette: null }).eq("id", access.id);
    }

    const style = await resolveProjectStyle(access.id);
    return res.status(200).json({ theme: style?.theme ?? null, paletteKey: style?.paletteKey ?? null, source: style?.source ?? null });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
}
