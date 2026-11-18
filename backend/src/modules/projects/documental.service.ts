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

interface CreditWork {
  title: string | null;
  author: string | null;
  license: string | null;
  source: string | null;
  provider: string | null;
  external_id: string | null;
  start_seconds: number | null;
}
interface CreditMusic {
  title: string;
  author: string | null;
  license: string;
  source_page: string | null;
}

// La descripcion de YouTube admite 5000 caracteres; se deja margen (MaV: 4500).
const CREDITS_MAX = 4500;

// Creditos listos para pegar en la descripcion de YouTube (como
// creditosProyecto.js de MaV): metraje (YouTube con su segundo, archivo,
// stock), fotos con su licencia, mapas y musica. Si no entra, se recorta el
// grupo mas largo con "y N mas", nunca los mapas ni la musica: son las
// atribuciones OBLIGATORIAS (OpenStreetMap ODbL, Esri, musica CC BY).
export function buildCreditsText(works: CreditWork[], music: CreditMusic[], usesMaps: boolean): string {
  const clean = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
  const footage: string[] = [];
  const photos: string[] = [];
  const ytSeen = new Set<string>();
  for (const w of works) {
    const title = clean(w.title);
    const author = clean(w.author);
    if (w.provider === "youtube") {
      // Un video, una linea (aunque aporte varios tramos): el primer segundo usado.
      const id = String(w.external_id ?? "").split("@")[0]!;
      if (ytSeen.has(id)) continue;
      ytSeen.add(id);
      const t = w.start_seconds != null ? `?t=${Math.round(w.start_seconds)}` : "";
      footage.push(`• "${title || id}"${author ? ` — ${author}` : ""} (YouTube): https://youtu.be/${id}${t}`);
    } else if (w.provider?.startsWith("archive")) {
      footage.push(`• "${title}" — Internet Archive, ${clean(w.license) || "dominio público"}${w.source ? `: ${w.source}` : ""}`);
    } else if (w.provider === "pexels" || w.provider === "pixabay") {
      footage.push(`• Video de ${author || "autor desconocido"} (licencia de ${w.provider === "pexels" ? "Pexels" : "Pixabay"})${w.source ? `: ${w.source}` : ""}`);
    } else {
      photos.push(`• "${title}"${author ? `, ${author}` : ""} — ${clean(w.license) || "licencia libre"}${w.provider === "openverse" ? " (Openverse)" : " (Wikimedia Commons)"}${w.source ? `: ${w.source}` : ""}`);
    }
  }
  const fixed: string[][] = [];
  if (usesMaps) {
    fixed.push([
      "Mapas:",
      "• Imágenes de satélite: Esri, Maxar, Earthstar Geographics y la comunidad de usuarios SIG (Esri World Imagery).",
      "• Datos de mapa: © colaboradores de OpenStreetMap (ODbL).",
    ]);
  }
  if (music.length) {
    fixed.push(["Música:", ...music.map((m) => `• "${m.title}"${m.author ? ` — ${m.author}` : ""} (${m.license})${m.source_page ? `: ${m.source_page}` : ""}`)]);
  }
  const groups: { name: string; lines: string[] }[] = [
    { name: "Metraje:", lines: [...new Set(footage)] },
    { name: "Fotos e imágenes:", lines: [...new Set(photos)] },
  ];
  const render = () =>
    [
      "CRÉDITOS",
      ...groups.filter((g) => g.lines.length).map((g) => ["", g.name, ...g.lines].join("\n")),
      ...fixed.map((f) => ["", ...f].join("\n")),
    ].join("\n");
  let text = render();
  // Recorta el grupo mas largo hasta que entre; nunca mapas ni musica.
  const cut = new Map<string, number>();
  while (text.length > CREDITS_MAX) {
    const longest = [...groups].sort((a, b) => b.lines.length - a.lines.length)[0]!;
    if (longest.lines.length <= 1) break;
    const removed = (cut.get(longest.name) ?? 0) + 1;
    cut.set(longest.name, removed);
    longest.lines = longest.lines.filter((l) => !l.startsWith("… y ")).slice(0, -1);
    longest.lines.push(`… y ${removed} fuente(s) más.`);
    text = render();
  }
  return works.length || music.length || usesMaps ? text : "";
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
        return [
          {
            title: m.title ?? null,
            author: m.author ?? null,
            license: m.license ?? null,
            license_url: m.license_url ?? null,
            source: m.url ?? null,
            provider: m.provider ?? null,
            external_id: m.external_id ?? null,
            start_seconds: (a.metadata as { start_seconds?: number }).start_seconds ?? null,
          },
        ];
      });
    // Los rotulos (textura propia) y las imagenes generadas no se acreditan.
    const works = credits.filter((c) => c.provider && c.provider !== "textura" && c.provider !== "mapa" && c.provider !== "snapgen");
    // Mapas: Esri y OpenStreetMap obligan a acreditar (ODbL) si hay algun mapa.
    const usesMaps = projectScenes.some((s) => {
      const c = s.content as { overlays?: { type?: string }[]; shot?: { clase?: string } } | null;
      return c?.shot?.clase === "mapa" || (Array.isArray(c?.overlays) && c!.overlays!.some((o) => /^map_/.test(o.type ?? "")));
    });
    const finalRenderMeta = (assets ?? [])
      .filter((a) => !a.scene_id && (a.metadata as { kind?: string } | null)?.kind === "final_render")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]?.metadata as
      | {
          qc?: unknown;
          music?: { title: string; author: string | null; license: string; source_page: string | null };
          music_tracks?: { title: string; author: string | null; license: string; source_page: string | null }[];
        }
      | undefined;
    const music = finalRenderMeta?.music;
    // Musica por capitulo: una pista por animo, todas acreditadas. Sin render
    // todavia, la de la mezcla de la revision.
    const previewMusic = (assets ?? []).find((a) => !a.scene_id && (a.metadata as { kind?: string } | null)?.kind === "preview_mix")?.metadata as
      | { music?: { title: string; author: string | null; license: string; source_page: string | null }[] }
      | undefined;
    const musicTracks = finalRenderMeta?.music_tracks ?? (music ? [music] : previewMusic?.music ?? []);
    const creditsText = buildCreditsText(works, musicTracks, usesMaps);

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

    res.json({
      style: project?.video_style ?? null,
      plan: project?.documental_plan ?? null,
      credits,
      credits_text: creditsText,
      chapters: chapterRows,
      chapters_text: chaptersText,
      qc: finalRenderMeta?.qc ?? null,
      music: music ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
