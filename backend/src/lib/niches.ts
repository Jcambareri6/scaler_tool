import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { supabase } from "./supabase.js";

// Nichos y paletas de los graficos animados (motion/niches.json). La paleta
// es del CANAL: se elige una vez (en la revision del primer video) y se
// mantiene; el nicho es de cada video y solo decide componentes y ritmo.
// Solo lee el JSON (no necesita motion/ instalado): sirve tambien en la API.

export interface Palette {
  id: string;
  name: string;
  accent: string;
  text: string;
  textMuted: string;
  scrim: string;
}

export interface Niche {
  name: string;
  keywords: string[];
  nexlev: number[];
  titleFont: "serif" | "sans";
  blur: "bajo" | "medio" | "alto";
  favor: string[];
  palettes: Palette[];
}

interface NichesFile {
  default: string;
  niches: Record<string, Niche>;
}

// Lo que reciben los componentes de motion/ como `theme` (ver resolveTheme).
export interface PaletteTheme extends Omit<Palette, "id" | "name"> {
  titleFont: "serif" | "sans";
}

export interface ResolvedStyle {
  niche: string;
  nicheName: string;
  // "<nicho>:<paleta>", lo que se guarda en workspaces/video_projects.
  paletteKey: string;
  paletteName: string;
  theme: PaletteTheme;
  // De donde salio: excepcion del video, elegida para el canal, o la
  // primera del nicho porque el canal todavia no eligio.
  source: "video" | "channel" | "default";
}

const MOTION_DIR = process.env.MOTION_DIR ?? path.resolve(process.cwd(), "motion");
let cached: NichesFile | null | undefined;

function load(): NichesFile | null {
  if (cached !== undefined) return cached;
  const file = path.join(MOTION_DIR, "niches.json");
  cached = existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as NichesFile) : null;
  return cached;
}

export function nicheIds(): string[] {
  return Object.keys(load()?.niches ?? {});
}

export function getNiche(id: string | null | undefined): Niche | null {
  const data = load();
  return (id && data?.niches[id]) || null;
}

// Respaldo sin LLM: el nicho cuyas palabras clave aparecen mas en el texto.
export function guessNiche(text: string): string {
  const data = load();
  if (!data) return "curiosidades";
  const lower = text.toLowerCase();
  let best = data.default;
  let bestHits = 0;
  for (const [id, niche] of Object.entries(data.niches)) {
    const hits = niche.keywords.reduce((n, k) => n + (lower.includes(k.toLowerCase()) ? 1 : 0), 0);
    if (hits > bestHits) {
      best = id;
      bestHits = hits;
    }
  }
  return best;
}

export function findPalette(key: string | null | undefined): { niche: string; palette: Palette } | null {
  if (!key) return null;
  const [nicheId, paletteId] = key.split(":");
  const palette = getNiche(nicheId)?.palettes.find((p) => p.id === paletteId);
  return palette ? { niche: nicheId!, palette } : null;
}

function toTheme(palette: Palette, titleFont: "serif" | "sans"): PaletteTheme {
  const { id: _id, name: _name, ...colors } = palette;
  return { ...colors, titleFont };
}

// Video > canal > primera paleta del nicho del video. La tipografia de los
// titulos sigue al nicho de la paleta (una paleta "historia" lleva serif).
export function resolveStyle(opts: {
  niche: string | null | undefined;
  projectPalette: string | null | undefined;
  channelPalette: string | null | undefined;
}): ResolvedStyle | null {
  const data = load();
  if (!data) return null;
  const nicheId = getNiche(opts.niche) ? opts.niche! : data.default;
  const niche = data.niches[nicheId]!;

  const fromVideo = findPalette(opts.projectPalette);
  const fromChannel = findPalette(opts.channelPalette);
  const chosen = fromVideo ?? fromChannel;
  const source: ResolvedStyle["source"] = fromVideo ? "video" : fromChannel ? "channel" : "default";
  const paletteNiche = chosen ? data.niches[chosen.niche]! : niche;
  const palette = chosen?.palette ?? niche.palettes[0]!;
  const paletteNicheId = chosen?.niche ?? nicheId;

  return {
    niche: nicheId,
    nicheName: niche.name,
    paletteKey: `${paletteNicheId}:${palette.id}`,
    paletteName: palette.name,
    theme: toTheme(palette, paletteNiche.titleFont),
    source,
  };
}

// Estilo efectivo de un proyecto (render y preview). null si niches.json no
// esta (los componentes caen a su tema por defecto).
export async function resolveProjectStyle(projectId: string): Promise<ResolvedStyle | null> {
  const { data: project } = await supabase
    .from("video_projects")
    .select("niche, overlay_palette, workspace_id, user_id")
    .eq("id", projectId)
    .single();
  if (!project) return null;
  return resolveStyle({
    niche: project.niche as string | null,
    projectPalette: project.overlay_palette as string | null,
    channelPalette: await channelPaletteFor(project.workspace_id as string | null, project.user_id as string),
  });
}

// Mismo criterio que getChannelSettingsForProject: el workspace del proyecto
// o, si no tiene, el personal de su creador.
export async function channelWorkspaceId(workspaceId: string | null, userId: string): Promise<string | null> {
  if (workspaceId) return workspaceId;
  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .eq("is_personal", true)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// Textos de la capa fija de navegacion (placeNavHeaders): nombre del canal
// (el workspace; el personal no tiene un nombre de canal, "Mi workspace") y
// el titulo del video como tema.
export async function navHeaderContext(projectId: string): Promise<{ channel: string | null; topic: string | null }> {
  const { data: project } = await supabase
    .from("video_projects")
    .select("title, workspace_id, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { channel: null, topic: null };
  const id = await channelWorkspaceId(project.workspace_id as string | null, project.user_id as string);
  const { data: workspace } = id
    ? await supabase.from("workspaces").select("name, is_personal").eq("id", id).maybeSingle()
    : { data: null };
  return {
    channel: workspace && !workspace.is_personal ? ((workspace.name as string | null) ?? null) : null,
    topic: (project.title as string | null) ?? null,
  };
}

async function channelPaletteFor(workspaceId: string | null, userId: string): Promise<string | null> {
  const id = await channelWorkspaceId(workspaceId, userId);
  if (!id) return null;
  const { data } = await supabase.from("workspaces").select("overlay_palette").eq("id", id).maybeSingle();
  return (data?.overlay_palette as string | null | undefined) ?? null;
}
