import type { Request, Response } from "express";
import { supabase } from "../../lib/supabase.js";
import { getOwnedProject } from "../../lib/ownership.js";
import { DOCUMENTAL_STYLES } from "../../lib/documentalStyles.js";

// GET /documental/styles -- galeria de estilos del formato documental.
export async function listDocumentalStyles(_req: Request, res: Response) {
  res.json(
    DOCUMENTAL_STYLES.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      ideal_for: s.idealFor,
      examples: s.examples,
      category: s.category,
      graphics_per_minute: s.plan.graphicsPerMinute,
      mood: s.sound.mood,
    }))
  );
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// GET /projects/:project_id/documental -- resumen del documental para la
// revision: plan (capitulos, avisos), creditos de cada obra con licencia y
// capitulos con su tiempo, listos para pegar en la descripcion de YouTube,
// y el QC del ultimo render.
export async function getProjectDocumental(req: Request, res: Response) {
  try {
    const access = await getOwnedProject(req.params.project_id!, req.user!.id, "viewer");
    if (!access) return res.status(404).json({ error: "Project not found" });

    const { data: script } = await supabase.from("scripts").select("id").eq("video_project_id", access.id).maybeSingle();
    const [{ data: project }, { data: assets }, { data: scenes }] = await Promise.all([
      supabase.from("video_projects").select("video_style, documental_plan").eq("id", access.id).maybeSingle(),
      supabase.from("assets").select("scene_id, type, metadata, created_at").eq("video_project_id", access.id),
      script
        ? supabase.from("scenes").select("id, order, content").eq("script_id", script.id).order("order", { ascending: true })
        : Promise.resolve({ data: [] as { id: string; order: number; content: unknown }[] }),
    ]);

    // Creditos: una linea por obra (sin repetir), en orden de aparicion.
    const sceneOrder = new Map<string, number>();
    const projectScenes = scenes ?? [];
    for (const s of projectScenes) sceneOrder.set(s.id as string, s.order as number);
    const seen = new Set<string>();
    const credits = (assets ?? [])
      .filter((a) => a.scene_id && (a.metadata as { kind?: string } | null)?.kind === "documental")
      .sort((a, b) => (sceneOrder.get(a.scene_id as string) ?? 0) - (sceneOrder.get(b.scene_id as string) ?? 0))
      .flatMap((a) => {
        const m = a.metadata as Record<string, string | undefined>;
        const key = `${m.provider}:${m.external_id}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ title: m.title ?? null, author: m.author ?? null, license: m.license ?? null, license_url: m.license_url ?? null, source: m.url ?? null, provider: m.provider ?? null }];
      });
    const needsAttribution = credits.filter((c) => c.license && /CC BY|Dominio|CC0|Licencia/.test(c.license) && c.provider !== "snapgen");
    const creditsText = needsAttribution.length
      ? ["Material de archivo:", ...needsAttribution.map((c) => `- ${[c.title, c.author].filter(Boolean).join(" — ")} (${c.license})${c.source ? ` ${c.source}` : ""}`)].join("\n")
      : "";

    // Capitulos con su tiempo (el plano que abre cada capitulo).
    const chapterRows = projectScenes
      .map((s) => s.content as { shot?: { capitulo?: number }; startSeconds?: number; overlays?: { type: string; text: string }[] })
      .filter((c) => c.shot?.capitulo)
      .map((c) => ({
        chapter: c.shot!.capitulo!,
        start: c.startSeconds ?? 0,
        title:
          c.overlays?.find((o) => o.type === "title_card")?.text ??
          ((project?.documental_plan as { chapters?: { titulo: string }[] } | null)?.chapters?.[c.shot!.capitulo! - 1]?.titulo ?? `Capítulo ${c.shot!.capitulo}`),
      }));
    if (chapterRows[0]) chapterRows[0].start = 0;
    const chaptersText = chapterRows.map((c) => `${clock(c.start)} ${c.title}`).join("\n");

    const finalRender = (assets ?? [])
      .filter((a) => !a.scene_id && (a.metadata as { kind?: string } | null)?.kind === "final_render")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];

    res.json({
      style: project?.video_style ?? null,
      plan: project?.documental_plan ?? null,
      credits,
      credits_text: creditsText,
      chapters: chapterRows,
      chapters_text: chaptersText,
      qc: (finalRender?.metadata as { qc?: unknown } | null)?.qc ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
