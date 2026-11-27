import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { uploadPublicFile } from "../lib/storage.js";
import { contactSheet, frameStats, grabFrame, qaCode, type SheetTile } from "./documentalQa.js";
import { supabase } from "../lib/supabase.js";
import { runTool } from "../tools/index.js";
import { getActiveProvider } from "../lib/providers.js";
import { isAdmin } from "../lib/accounts.js";
import { isMockMode } from "../lib/mock.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { reportJobProgress } from "../lib/jobProgress.js";
import { makeWorkDir } from "../lib/workDir.js";
import { envInt } from "../lib/env.js";
import { buildPhrases, type Phrase } from "../director/phrases.js";
import { directMontaje, leadOf, type MontajePlan, type PlannedShot, type ShotGraphic } from "../director/montajista.js";
import { JUDGE_MODEL, QA_MODEL, judgeCandidates, type CandidateVerdict, type JudgeResult, type JudgeShot, type QaCode } from "../director/visualJudge.js";
import { shotEpochs } from "../lib/epoca.js";
import { HuellaRegistry, fingerprint } from "../lib/huella.js";
import { correctPlace, haversineKm } from "../lib/geocode.js";
import { MAPA_MODEL, directMapa } from "../director/directorMapa.js";
import { formatValue, poblacion, samplePoints, serie } from "../lib/datosAbiertos.js";
import { runQaFinal, type QaDecision, type QaItem } from "./qaFinal.js";
import { TOPE_MARGIN, capFor, cutPoint, neighbourMax, planExtension } from "./topes.js";
import {
  NOT_A_PORTRAIT,
  searchArchiveVideos,
  searchCommonsImages,
  searchOpenverseImages,
  searchWikidataImage,
  searchWikipediaByTopic,
  searchWikipediaImages,
  sourceChain,
  type SourceName,
  type VisualCandidate,
} from "../lib/documentalSources.js";
import { getDocumentalStyle, type DocumentalStyle } from "../lib/documentalStyles.js";
import { downloadYouTubeSegment, prewarmYouTubeSearches, searchYouTubeVideos, subtitleKeywords, subtitleMoments, uploadYouTubeSegment, youtubeEnabled } from "../lib/youtubeSource.js";
import { clasificar, esperaSlots, frenoYoutube, type EsperaSlots } from "../lib/youtubeGuard.js";
import { cachedShot, forgetShot, shotCacheKey, storeShot } from "../lib/documentalCache.js";
import { buildLibrary, libraryCandidates, terms, type LibraryVideo } from "../lib/documentalLibrary.js";
import { motionCatalog } from "../lib/motion.js";
import { TYPE_GUIDE, plannableTypes } from "../tools/planOverlays.tool.js";
import {
  cropCandidates,
  cropFilter,
  cropSpecFor,
  isProperName,
  pickOption,
  type CropSource,
  type CropSpec,
  type CropState,
  type RescueOption,
} from "./rescueAssign.js";
import type { TranscribedWord } from "../tools/transcribeAudio.tool.js";
import type { GenerateImageInput, GenerateImageOutput } from "../tools/generateImage.tool.js";
import type { GenerateOverlayInput, GenerateOverlayOutput } from "../tools/generateOverlay.tool.js";
import type { ContentPolicy, OverlaySpec, OverlayType } from "../types/shared/typeShared.js";

// HUB del formato documental (estilo Make a Videos sobre la arquitectura hub
// and spoke de Scaler):
//   1. Montajista (director/montajista.ts): plan de planos + verificador.
//   2. Los planos se guardan como filas de `scenes` (la revision, el
//      reemplazo por escena, build_timeline y el render siguen igual).
//   3. Spokes en paralelo: por plano, la cadena de fuentes de su clase
//      (lib/documentalSources.ts).
//   4. Juez visual (director/visualJudge.ts) sobre los candidatos de cada
//      fuente; si rechaza todo, siguiente fuente; si no hay nada, un plano
//      seguro (ambiente de stock o imagen IA).
//   5. Graficos y rotulos: los del plan, validados en modo estricto
//      (generate_overlay, texto literal del guion), como siempre.

// 6 planos a la vez (antes 4): YouTube tiene su propio semaforo (youtubeGuard).
// 16 planos a la vez (antes 6): con 6, un documental de 29 min (279 planos)
// iba a ~1,7 planos por minuto (~3 h). El juez es Haiku y la hoja de YouTube
// por plano ya no baja el video entero (youtubeQuickSheet), asi que el
// limite real son los rate limits de las fuentes, no la CPU.
const SHOT_CONCURRENCY = envInt("DOCUMENTAL_SHOT_CONCURRENCY", 16);
const RESCUE_CONCURRENCY = envInt("DOCUMENTAL_RESCUE_CONCURRENCY", 10);
// Presupuestos: busqueda max(14 min, 35 s por plano); rescate max(6 min, 25 s por plano rescatado).
const SEARCH_BUDGET_MS = envInt("DOCUMENTAL_SEARCH_BUDGET_MS", 14 * 60_000);
const SEARCH_MS_PER_SHOT = 35_000;
const RESCUE_BUDGET_MS = envInt("DOCUMENTAL_RESCUE_BUDGET_MS", 6 * 60_000);
// 25 s por plano (antes 12): la medicion del 25/11/2026 (Rio de la Plata, 54
// planos al rescate) dio ~2 min por plano con 10 a la vez, ~12 s de reloj.
const RESCUE_MS_PER_SHOT = 25_000;
// Dos momentos del mismo video, como minimo esta separacion.
const MOMENT_GAP_SECONDS = 20;

// El tema del video y el lugar de la historia: el QA no los cuenta como obra repetida.
function mainSubjectsOf(ctx: DocumentalContext): string[] {
  return [ctx.videoTopic, ctx.storyPlace, ...(ctx.storyPlace?.split(",") ?? [])].map((s) => s?.trim() ?? "").filter(Boolean);
}

function shotKeyOf(ctx: DocumentalContext, row: ShotRow): string {
  return shotCacheKey([ctx.videoTopic, ctx.storyPlace, row.shot.clase, row.shot.query, row.text, Math.round(row.end - row.start)]);
}

// `tema`: el tema_bloque del plano para el que el juez aprobo esos cuadros (el
// rescate solo reusa una toma aprobada para el MISMO tema).
function rememberGoodMoments(ctx: DocumentalContext, source: VisualCandidate, times: number[], tema?: string): void {
  ctx.goodMoments ??= new Map();
  const e = ctx.goodMoments.get(source.external_id) ?? { times: [], used: [] };
  if (!e.source) {
    const { sheet_times: _times, ...rest } = source;
    e.source = rest;
  }
  for (const t of times) if (!e.times.some((x) => Math.abs(x - t) < 3)) e.times.push(t);
  if (tema) (e.temas ??= new Set()).add(normTema(tema));
  ctx.goodMoments.set(source.external_id, e);
}

export function normTema(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function markMomentUsed(ctx: DocumentalContext, videoId: string, at: number | undefined): void {
  if (at === undefined) return;
  ctx.goodMoments ??= new Map();
  const e = ctx.goodMoments.get(videoId) ?? { times: [], used: [] };
  e.used.push(at);
  ctx.goodMoments.set(videoId, e);
}

// Rondas de juez por plano (cada una = una fuente con candidatos nuevos).
const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

const MAX_JUDGE_ROUNDS = envInt("DOCUMENTAL_JUDGE_ROUNDS", 3);
// Rondas extra del juez para las busquedas amplias (sujeto simplificado y
// busquedas de los planos vecinos) antes de reusar el plano vecino.
const BROAD_JUDGE_ROUNDS = envInt("DOCUMENTAL_BROAD_ROUNDS", 2);
// Rondas extra del juez para las busquedas de respaldo del plan.
const RESPALDO_JUDGE_ROUNDS = envInt("DOCUMENTAL_RESPALDO_ROUNDS", 2);

export interface DocumentalContext {
  projectId: string;
  userId: string;
  jobId: string;
  scriptId: string;
  scriptText: string;
  words: TranscribedWord[];
  videoTopic?: string;
  styleId?: string | null;
  contentPolicy?: ContentPolicy;
  channelLanguage?: string | null;
  // Donde pasa la historia (storyPlace, una vez por video): va al juez.
  storyPlace?: string;
  // Presupuestos de tiempo (MaV): pasado el de la busqueda, lo que falta va
  // al rescate; pasado el del rescate, directo al rotulo.
  searchDeadline?: number;
  rescueDeadline?: number;
  // Medicion (solo mide): segundos esperando un lugar de bajada de YouTube
  // (semaforos de yt-dlp y Apify) vs. bajando, en todo el video y por plano.
  bajadas?: {
    esperaMs: number;
    bajandoMs: number;
    // Tramos por via (pedazos, entero, archivo, yt-dlp): cantidad y ms.
    porVia: Record<string, { n: number; ms: number }>;
    porPlano: Map<string, { esperaMs: number; bajandoMs: number; n: number; vias: Record<string, number> }>;
  };
  // Momentos buenos de cada video de YouTube (cuadros que el juez aprobo en
  // la hoja) y los ya usados: "otro momento" sale de aca, no a ciegas.
  goodMoments?: Map<string, { source?: VisualCandidate; times: number[]; used: number[]; temas?: Set<string> }>;
  // Planos que el rescate resolvio con una animacion o un mapa (paso 4 o 5):
  // la base es textura pero no son rotulos (sin tope de 3 s).
  overlayScenes?: Set<string>;
  // Biblioteca del video (YouTube escaneado y descrito una sola vez).
  library?: LibraryVideo[];
}

interface ShotRow {
  id: string;
  order: number;
  text: string;
  shot: PlannedShot;
  start: number;
  end: number;
}

interface ShotOutcome {
  sceneId: string;
  order: number;
  source: SourceName | "fallback" | "none";
  qa: QaCode | "seguro";
  provider?: string;
  rejected: number;
  // Cada candidato rechazado en la busqueda (fuente, codigo y motivo): el
  // rescate los guarda en el asset final para saber POR QUE quedo niebla.
  rejections?: CandidateVerdict[];
  // Justificacion del juez en cada ronda de la busqueda.
  juicios?: string[];
}

function phraseText(phrases: Phrase[], shot: PlannedShot): string {
  return phrases.slice(shot.from, shot.to + 1).map((p) => p.text).join(" ");
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const MAP_OVERLAYS = new Set(["map_marker", "map_globe"]);

function toSpec(g: ShotGraphic, basemap?: "satellite" | "dark"): OverlaySpec {
  return {
    type: g.type as OverlayType,
    text: g.text,
    source: "script",
    ...(g.label ? { label: g.label } : {}),
    ...(g.items ? { items: g.items } : {}),
    ...(g.icon ? { icon: g.icon } : {}),
    ...(g.geo ? { geo: g.geo } : {}),
    ...(basemap && MAP_OVERLAYS.has(g.type) ? { basemap } : {}),
  };
}

// Graficos con datos reales por plano (attachData).
const dataSpecs = new WeakMap<PlannedShot, OverlaySpec>();

// Trae las cifras del Banco Mundial de los planos con `datos`. Sin datos (pais
// sin codigo, region, serie vacia) el plano sigue con su grafico o su visual:
// "un grafico con una linea inventada es peor que ningun grafico".
async function attachData(shots: PlannedShot[]): Promise<{ con: number; sin: number }> {
  const counts = { con: 0, sin: 0 };
  let last = -Infinity;
  for (const [i, shot] of shots.entries()) {
    const d = shot.datos;
    if (!d) continue;
    // Como mucho 2 por video y nunca seguidos.
    if (counts.con >= 2 || i - last < 2) {
      delete shot.datos;
      continue;
    }
    let spec: OverlaySpec | null = null;
    if (d.tipo === "serie" && d.indicador) {
      const s = await serie(d.pais, d.indicador, d.desde ?? 1960, d.hasta ?? new Date().getFullYear()).catch(() => null);
      if (s) {
        spec = {
          type: "line_chart",
          text: d.titulo || `${s.nombre} · ${s.pais}`,
          label: s.fuente,
          source: "data",
          items: samplePoints(s.puntos, 8).map((p) => ({ label: String(p.anio), text: formatValue(p.valor) })),
        };
      }
    } else if (d.tipo === "piramide") {
      const years = d.anios?.length ? d.anios : [1960, new Date().getFullYear() - 2, 2050];
      const p = await poblacion(d.pais, years).catch(() => null);
      if (p && p.anios.length) {
        spec = {
          type: "population_pyramid",
          text: d.titulo || `Población · ${p.pais}`,
          label: p.fuente,
          source: "data",
          pyramid: { years: p.anios.map((a) => ({ year: a.anio, men: a.hombres, women: a.mujeres })) },
        };
      }
    }
    if (spec) {
      dataSpecs.set(shot, spec);
      counts.con += 1;
      last = i;
    } else {
      delete shot.datos;
      counts.sin += 1;
    }
  }
  return counts;
}

// Coordenadas reales (geocode.ts, como MaV): el lugar de cada plano y la
// coordenada de cada mapa se corrigen si el modelo se equivoco por mas de
// 25 km o no la dio, y llevan el tamano del sitio (elige el zoom).
async function correctPlaces(shots: PlannedShot[]): Promise<number> {
  let corrected = 0;
  // Primer lugar ya ubicado del video: pista para los que vienen sin coordenada.
  let anchor: { lat: number; lon: number } | undefined;
  const fix = async (name: string, model: { lat: number; lon: number } | undefined) => {
    const fixed = await correctPlace(name, model, anchor);
    if (fixed) anchor ??= { lat: fixed.lat, lon: fixed.lon };
    return fixed;
  };
  for (const shot of shots) {
    if (shot.lugar?.nombre) {
      const fixed = await fix(shot.lugar.nombre, shot.lugar);
      if (fixed) {
        if (fixed.corrected) corrected += 1;
        shot.lugar = { ...shot.lugar, lat: fixed.lat, lon: fixed.lon, ...(fixed.km ? { km: fixed.km } : {}) };
      }
    }
    for (const key of ["grafico", "rotulo"] as const) {
      const g = shot[key];
      if (!g || !MAP_OVERLAYS.has(g.type)) continue;
      const fixed = await fix(g.text, g.geo);
      if (!fixed) continue;
      if (fixed.corrected) corrected += 1;
      g.geo = { lat: fixed.lat, lon: fixed.lon, ...(fixed.km ? { km: fixed.km } : {}) };
    }
  }
  return corrected;
}

// Graficos, rotulos, mapa y tarjeta de capitulo del plano, validados en modo
// estricto. El que no pasa se descarta solo (nunca tira el plano).
async function validatedOverlays(
  shot: PlannedShot,
  sceneId: string,
  sceneText: string,
  windowText: string,
  fullText: string,
  chapterTitle: string | undefined,
  toolCtx: { userId: string; jobId: string },
  startSeconds: number,
  basemap?: "satellite" | "dark"
): Promise<OverlaySpec[]> {
  const wanted: OverlaySpec[] = [];
  // Tarjeta de capitulo: nunca en el gancho (primeros 20 s) y, si va, es lo
  // unico del plano (en la prueba se pisaba con hitos y numeros).
  const chapterCard = chapterTitle && startSeconds >= CHAPTER_MIN_START ? chapterTitle : undefined;
  if (chapterCard) {
    wanted.push({ type: "title_card", text: chapterCard, source: "script" });
  } else {
    if (shot.grafico) wanted.push(toSpec(shot.grafico, basemap));
    if (shot.clase === "mapa" && shot.lugar && !shot.grafico) {
      wanted.push({
        type: "map_marker",
        text: shot.lugar.nombre,
        source: "script",
        geo: { lat: shot.lugar.lat, lon: shot.lugar.lon, ...(shot.lugar.km ? { km: shot.lugar.km } : {}) },
        ...(basemap ? { basemap } : {}),
      });
    }
    if (shot.rotulo) wanted.push(toSpec(shot.rotulo, basemap));
  }
  const valid: OverlaySpec[] = [];
  // Datos reales (Banco Mundial): no pasan por el modo estricto (la cifra no
  // sale del guion, sale de la fuente, que va en pantalla). Reemplazan al grafico.
  const dataSpec = chapterCard ? undefined : dataSpecs.get(shot);
  if (dataSpec) {
    valid.push({ ...dataSpec, anchor: 0 });
    const i = wanted.findIndex((w) => w.type !== "title_card" && shot.grafico && w.type === shot.grafico.type);
    if (i >= 0) wanted.splice(i, 1);
  }
  for (const planned of wanted) {
    try {
      const { overlay } = await runTool<GenerateOverlayInput, GenerateOverlayOutput>(
        "generate_overlay",
        { scene_id: sceneId, script_text: windowText, full_text: fullText, overlay: planned },
        toolCtx
      );
      // Nunca dos graficos que digan lo mismo en el plano ("14 de abril" dos veces).
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
      const mine = norm(overlay.text);
      if (valid.some((v) => { const other = norm(v.text); return other.includes(mine) || mine.includes(other); })) {
        console.warn(`[documental] ${planned.type} descartado: repite el texto de otro grafico del plano ("${overlay.text}")`);
        continue;
      }
      const at = sceneText.toLowerCase().indexOf(overlay.text.toLowerCase());
      // Plano de mapa: el mapa tapa el plano entero (la base es textura).
      const full = shot.clase === "mapa" && MAP_OVERLAYS.has(overlay.type);
      valid.push({ ...overlay, anchor: at >= 0 && sceneText.length > 0 ? at / sceneText.length : 0, ...(full ? { full: true } : {}) });
    } catch (err) {
      console.warn(`[documental] ${planned.type} descartado: ${(err as Error).message}`);
    }
  }
  return valid;
}

async function writeShotScenes(ctx: DocumentalContext, phrases: Phrase[], plan: MontajePlan): Promise<ShotRow[]> {
  const { error: deleteError } = await supabase.from("scenes").delete().eq("script_id", ctx.scriptId);
  if (deleteError) throw new Error(deleteError.message);
  const rows = plan.shots.map((shot, i) => {
    const start = phrases[shot.from]!.start;
    const end = plan.shots[i + 1] ? phrases[plan.shots[i + 1]!.from]!.start : phrases[shot.to]!.end;
    const text = phraseText(phrases, shot);
    return {
      script_id: ctx.scriptId,
      order: i + 1,
      content: {
        text,
        timeStart: formatTime(start),
        timeEnd: formatTime(end),
        startSeconds: start,
        endSeconds: end,
        duration: `${Math.round(end - start)}s`,
        // La imagen entra antes que su palabra (MaV): build_timeline lo aplica.
        ...(i > 0 && leadOf(shot) > 0 ? { leadSeconds: leadOf(shot) } : {}),
        shot: {
          clase: shot.clase,
          sujeto: shot.sujeto,
          query: shot.query,
          ...(shot.entidad ? { entidad: shot.entidad } : {}),
          ...(shot.obligatorio?.length ? { obligatorio: shot.obligatorio } : {}),
          ...(shot.anio ? { anio: shot.anio } : {}),
          ...(shot.lugar ? { lugar: shot.lugar } : {}),
          ...(shot.capitulo ? { capitulo: shot.capitulo } : {}),
          ...(shot.parte !== undefined ? { parte: shot.parte } : {}),
          ...(shot.respaldo?.length ? { respaldo: shot.respaldo } : {}),
          ...(shot.queryLocal ? { queryLocal: shot.queryLocal } : {}),
          ...(shot.temaBloque ? { temaBloque: shot.temaBloque } : {}),
          ...(shot.articulo ? { articulo: shot.articulo } : {}),
        },
      },
    };
  });
  const { data, error } = await supabase.from("scenes").insert(rows).select("id, order");
  if (error) throw new Error(error.message);
  const ids = new Map((data ?? []).map((r) => [r.order as number, r.id as string]));
  return rows.map((row, i) => ({
    id: ids.get(row.order)!,
    order: row.order,
    text: row.content.text,
    shot: plan.shots[i]!,
    start: row.content.startSeconds,
    end: row.content.endSeconds,
  }));
}

// SIN STOCK en el documental (pedido del cliente, 25/11/2026): ni Pexels ni
// fotos genericas tipo Unsplash, ni en la busqueda ni en el rescate.

async function aiImageCandidate(shot: PlannedShot, style: DocumentalStyle, ctx: DocumentalContext): Promise<VisualCandidate | null> {
  if (!isAdmin(ctx.userId)) return null;
  const provider = await getActiveProvider("snapgen");
  if (!provider?.api_key && !isMockMode()) return null;
  const prompt = `Documentary still, photorealistic, ${style.sources.epochHint ?? "realistic lighting"}: ${shot.sujeto || shot.query}${shot.anio ? `, year ${shot.anio}` : ""}. No text, no watermark.`;
  const image = await runTool<GenerateImageInput, GenerateImageOutput>("generate_image", { prompt }, { userId: ctx.userId, jobId: ctx.jobId });
  return {
    provider: "snapgen",
    external_id: image.storage_key,
    type: "IMAGE",
    url: image.storage_key,
    license: "Generada con IA",
    source_page: image.storage_key,
    query: prompt,
  };
}

// YouTube con la busqueda LOCAL (idioma del lugar: "bajada La Rumorosa") y
// la de ingles; primero la local. Solo dos busquedas de yt-dlp, sin modelo.
async function youtubeCandidatesFor(shot: PlannedShot): Promise<VisualCandidate[]> {
  const local = shot.queryLocal && shot.queryLocal.toLowerCase() !== shot.query.toLowerCase() ? shot.queryLocal : null;
  if (!local) return searchYouTubeVideos(shot.query);
  const [a, b] = await Promise.all([searchYouTubeVideos(local).catch(() => [] as VisualCandidate[]), searchYouTubeVideos(shot.query).catch(() => [] as VisualCandidate[])]);
  const seen = new Set<string>();
  return [...a, ...b].filter((c) => !seen.has(c.external_id) && !!seen.add(c.external_id));
}

async function sourceCandidates(
  source: SourceName,
  shot: PlannedShot,
  minDuration: number,
  exclude: string[],
  style: DocumentalStyle,
  ctx: DocumentalContext
): Promise<VisualCandidate[]> {
  const lang = /ingl|english|^en\b/i.test(ctx.channelLanguage ?? "") ? "en" : "es";
  switch (source) {
    case "wikidata":
      return shot.entidad ? searchWikidataImage(shot.entidad, lang) : [];
    case "commons": {
      const found = await searchCommonsImages(shot.entidad ?? shot.query);
      // Persona: fuera placas, tumbas, monumentos y fotos de grupo (en la
      // prueba el rotulo "William Murdoch" cayo sobre una placa).
      return shot.clase === "persona" ? found.filter((c) => !NOT_A_PORTRAIT.test(`${c.title ?? ""} ${c.source_page}`)) : found;
    }
    case "wikipedia":
      return shot.articulo ? searchWikipediaImages(shot.articulo, lang === "en" ? ["en", "es"] : ["es", "en"]) : [];
    case "openverse":
      return searchOpenverseImages(shot.query);
    case "archive":
      return searchArchiveVideos(shot.query, shot.anio, shot.entidad);
    case "youtube":
      {
        // Biblioteca del video (ya escaneada) Y busqueda en vivo, en la misma
        // ronda. Antes, con algo en la biblioteca no se buscaba en vivo: si el
        // juez rechazaba esos videos el plano nunca probaba YouTube (DocuMEX
        // 29 min: 21 videos para 283 planos, 56 tramos de YouTube y 73 mapas).
        // Con la hoja rapida la busqueda en vivo cuesta casi nada.
        const excluded = new Set(exclude);
        const text = [shot.sujeto, shot.entidad, ...(shot.obligatorio ?? []), shot.queryLocal, shot.query].filter(Boolean).join(" ");
        const lib = ctx.library?.length ? libraryCandidates(ctx.library, text, (c) => excluded.has(`youtube:${c.external_id}`) || excluded.has(c.url)).slice(0, 2) : [];
        const live = await youtubeCandidatesFor(shot).catch(() => [] as VisualCandidate[]);
        const seen = new Set(lib.map((c) => c.external_id));
        return [...lib, ...live.filter((c) => !seen.has(c.external_id))];
      }
    case "ai_image": {
      const c = await aiImageCandidate(shot, style, ctx);
      return c ? [c] : [];
    }
  }
}

async function persistShotVisual(
  ctx: DocumentalContext,
  row: ShotRow,
  candidate: VisualCandidate,
  qa: { code: QaCode | "seguro"; reason?: string; rejected: CandidateVerdict[]; source: string; rescate?: string[]; juicios?: string[] }
): Promise<void> {
  const { error: deleteError } = await supabase.from("assets").delete().eq("scene_id", row.id).in("type", ["VIDEO", "IMAGE"]);
  if (deleteError) throw new Error(deleteError.message);
  const { error } = await supabase.from("assets").insert({
    video_project_id: ctx.projectId,
    scene_id: row.id,
    type: candidate.type,
    storage_key: candidate.url,
    metadata: {
      kind: "documental",
      provider: candidate.provider,
      external_id: candidate.external_id,
      url: candidate.source_page,
      license: candidate.license,
      ...(candidate.license_url ? { license_url: candidate.license_url } : {}),
      ...(candidate.author ? { author: candidate.author } : {}),
      ...(candidate.title ? { title: candidate.title } : {}),
      keyword: candidate.query,
      shot_class: row.shot.clase,
      sequence: 0,
      duration_seconds: row.end - row.start,
      ...(candidate.duration_seconds ? { source_duration_seconds: candidate.duration_seconds } : {}),
      ...(candidate.video_seconds ? { video_seconds: candidate.video_seconds } : {}),
      // Recorte (rescate): el render y la preview muestran esta parte de la imagen.
      ...(candidate.crop ? { crop: candidate.crop } : {}),
      ...(candidate.crop_of !== undefined ? { crop_of: candidate.crop_of } : {}),
      // YouTube: desde que segundo del original (credito con &t=).
      ...(candidate.yt_start !== undefined ? { start_seconds: Math.round(candidate.yt_start), source_url_t: `${candidate.source_page}&t=${Math.round(candidate.yt_start)}s` } : {}),
      // Hasta 30 rechazos y el recorrido del rescate: con 8 (y el rescate
      // guardando []) no se podia saber por que un plano quedo en niebla.
      qa: {
        code: qa.code,
        ...(qa.reason ? { reason: qa.reason } : {}),
        source: qa.source,
        rejected: qa.rejected.slice(0, 30),
        ...(qa.rescate?.length ? { rescate: qa.rescate.slice(0, 20) } : {}),
        // Justificacion del juez en cada ronda ("archive: ninguno muestra...").
        ...(qa.juicios?.length ? { juicios: qa.juicios.slice(0, 20) } : {}),
      },
    },
  });
  if (error) throw new Error(error.message);
}

// Contexto del juez para cada plano (como textoPlano de MaV): frases de
// alrededor, titulo del video, lo que tiene que verse, el rotulo de lugar y
// la epoca (lib/epoca.ts, por reglas). Lo arma el codigo, sin otra llamada.
export type JudgeContext = Omit<JudgeShot, "frase" | "clase" | "sujeto" | "modo" | "tema">;

export function shotContexts(byOrder: ShotRow[], videoTopic: string | null | undefined, storyPlace?: string): Map<string, JudgeContext> {
  const epochs = shotEpochs(
    byOrder.map((r) => r.text),
    byOrder.map((r) => r.shot.anio)
  );
  return new Map(
    byOrder.map((r, i) => {
      const e = epochs[i]!;
      const context: JudgeContext = {
        epoca: e,
        ...(e.historico && e.anio !== undefined ? { anio: e.anio } : {}),
        ...(byOrder[i - 1]?.text ? { fraseAnterior: byOrder[i - 1]!.text } : {}),
        ...(byOrder[i + 1]?.text ? { fraseSiguiente: byOrder[i + 1]!.text } : {}),
        ...(videoTopic ? { titulo: videoTopic } : {}),
        ...(storyPlace ? { lugarHistoria: storyPlace } : {}),
        ...(r.shot.obligatorio?.length ? { obligatorio: r.shot.obligatorio } : {}),
        ...(r.shot.lugar?.nombre ? { lugarRotulo: r.shot.lugar.nombre } : {}),
      };
      return [r.id, context];
    })
  );
}

function judgeShotOf(row: ShotRow, context: JudgeContext | undefined, rescue?: { tema: string }): JudgeShot {
  // En el rescate (MaV deTema) el juez no recibe el "tiene que verse" ni el
  // rotulo de lugar: la pregunta es si es de esta historia, no si es la cosa.
  let ctx = context;
  if (rescue && context) {
    const { obligatorio: _o, lugarRotulo: _l, ...rest } = context;
    ctx = rest;
  }
  return {
    frase: row.text,
    clase: row.shot.clase,
    sujeto: row.shot.sujeto,
    ...(ctx ?? {}),
    ...(rescue ? { modo: "tema" as const, tema: rescue.tema } : {}),
  };
}

const seg = (ms: number) => Math.round(ms / 1000);

// Medicion de una bajada de YouTube (solo mide): "bajo" incluye bajar, cortar
// y limpiar el tramo; "espero lugar" es lo que espero en los semaforos.
function noteDownload(ctx: DocumentalContext, row: ShotRow, where: string, medida: EsperaSlots, totalMs: number, log?: string[]): void {
  const bajandoMs = Math.max(0, totalMs - medida.ms);
  const acc = (ctx.bajadas ??= { esperaMs: 0, bajandoMs: 0, porVia: {}, porPlano: new Map() });
  acc.esperaMs += medida.ms;
  acc.bajandoMs += bajandoMs;
  const p = acc.porPlano.get(row.id) ?? { esperaMs: 0, bajandoMs: 0, n: 0, vias: {} };
  p.esperaMs += medida.ms;
  p.bajandoMs += bajandoMs;
  p.n += 1;
  for (const t of medida.tramos ?? []) {
    const v = (acc.porVia[t.via] ??= { n: 0, ms: 0 });
    v.n += 1;
    v.ms += t.ms;
    p.vias[t.via] = (p.vias[t.via] ?? 0) + 1;
  }
  acc.porPlano.set(row.id, p);
  const detalle = Object.entries(medida.por)
    .filter(([, ms]) => ms >= 500)
    .map(([k, ms]) => `${k} ${seg(ms)} s`)
    .join(", ");
  const tramos = (medida.tramos ?? []).map((t) => `${t.via} ${seg(t.ms)} s`).join(", ");
  log?.push(`${where}: bajada esperó lugar ${seg(medida.ms)} s${detalle ? ` (${detalle})` : ""}, bajó ${seg(bajandoMs)} s${tramos ? `, tramo por ${tramos}` : ""}`);
}

// Baja el tramo de YouTube elegido por miniatura, lo revisa con 3 cuadros
// reales (el juez otra vez, con un solo candidato) y lo sube a R2. Devuelve
// el candidato con la URL propia, o null si el tramo no sirve.
async function materializeYouTube(
  ctx: DocumentalContext,
  row: ShotRow,
  pick: VisualCandidate,
  judge: { client: Anthropic; model: string; workDir: string; usage: Record<string, number> },
  context: JudgeContext | undefined,
  opts: { startFraction?: number; atSeconds?: number; alternatives?: number[]; tema?: string; log?: string[] } = {}
): Promise<VisualCandidate | null> {
  const where = `youtube ${pick.external_id}${opts.startFraction !== undefined ? `@${opts.startFraction}` : opts.atSeconds !== undefined ? `@${Math.round(opts.atSeconds)}s` : ""}`;
  try {
    // Primer uso del video: el momento sale de los subtitulos (MaV). Un video
    // con subtitulos que nunca nombran el sujeto se descarta sin bajarlo.
    let startSeconds: number | undefined = opts.atSeconds;
    if (opts.startFraction === undefined && opts.atSeconds === undefined) {
      // En castellano (obligatorio, sujeto) Y en ingles (la busqueda del plano):
      // muchos videos tienen los subtitulos en ingles y con solo castellano se
      // descartaban videos que servian.
      const keywords = subtitleKeywords([row.shot.query, row.shot.entidad, ...(row.shot.obligatorio ?? []), row.shot.sujeto]);
      const subs = await subtitleMoments(pick, keywords, judge.workDir);
      if (subs.hasSubs && keywords.length > 0 && subs.moments.length === 0) {
        console.log(`[documental] plano ${row.order}: youtube ${pick.external_id} descartado, los subtitulos nunca nombran ${keywords.join("/")}`);
        opts.log?.push(`${where}: subtitulos sin ${keywords.slice(0, 6).join("/")}`);
        return null;
      }
      startSeconds = subs.moments[0];
    }
    // Con margen: el plano se puede alargar despues (topes, union con el
    // vecino) y un tramo justo terminaba en loop o en cuadro congelado.
    const planned = row.end - row.start;
    const wanted = Math.min(Math.max(planned * 1.5, planned + 3), 20);
    // Hasta 3 instantes buenos de la hoja (MaV: tramoLimpio prueba varios): si
    // el primero no tiene un tramo limpio (cortes, imagen fija), el siguiente,
    // sin gastar otra llamada al juez.
    const instants = startSeconds !== undefined ? [startSeconds, ...(opts.alternatives ?? [])].slice(0, 3) : [undefined];
    let local: string | null = null;
    let lastError: Error | null = null;
    let usedAt: number | undefined;
    // Medicion: cuanto espero por un lugar de bajada y cuanto bajo (va al
    // recorrido del plano y a los totales del video).
    const medida: EsperaSlots = { ms: 0, por: {} };
    const bajadaDesde = Date.now();
    try {
      for (const at of instants) {
        try {
          local = await esperaSlots.run(medida, () => downloadYouTubeSegment(pick, wanted, judge.workDir, opts.startFraction, at));
          usedAt = at;
          break;
        } catch (err) {
          lastError = err as Error;
          // Bloqueo o red: no insistir con otro instante del mismo video.
          if (clasificar(err) !== "roto" || frenoYoutube.abierto()) break;
        }
      }
    } finally {
      noteDownload(ctx, row, where, medida, Date.now() - bajadaDesde, opts.log);
    }
    if (!local) throw lastError ?? new Error("sin tramo");
    const clip: VisualCandidate = {
      ...pick,
      url: local,
      duration_seconds: Math.min(Math.max(row.end - row.start + 1, 4), 14),
      video_seconds: pick.video_seconds ?? pick.duration_seconds ?? 0,
    };
    delete clip.thumb_url;
    delete clip.sheet_times;
    delete clip.sheet_path;
    const check = await judgeCandidates(
      judge.client,
      judge.model,
      judgeShotOf(row, context, opts.tema !== undefined ? { tema: opts.tema } : undefined),
      [clip],
      judge.workDir,
      judge.usage
    );
    if (check.chosen !== 0) {
      const v = check.verdicts[0];
      opts.log?.push(`${where}: tramo rechazado (${v ? `${v.code}: ${v.reason}` : "sin veredicto"})${check.justification ? `. Juez: ${check.justification}` : ""}`);
      await rm(local, { force: true }).catch(() => undefined);
      return null;
    }
    const url = await uploadYouTubeSegment(local, pick, ctx.projectId);
    await rm(local, { force: true }).catch(() => undefined);
    return { ...clip, url, ...(usedAt !== undefined ? { yt_start: usedAt } : {}) };
  } catch (err) {
    console.warn(`[documental] plano ${row.order}: youtube ${pick.external_id} fallo: ${(err as Error).message}`);
    opts.log?.push(`${where}: fallo (${(err as Error).message.slice(0, 120)})`);
    return null;
  }
}

// Llena UN plano: recorre la cadena de fuentes de su clase; en cada fuente
// el juez elige entre candidatos nuevos. Sin juez (sin provider), el primero.
async function fillShot(
  ctx: DocumentalContext,
  row: ShotRow,
  style: DocumentalStyle,
  judge: { client: Anthropic; model: string; workDir: string; usage: Record<string, number> } | null,
  used: Set<string>,
  neighbours: { queries: string[]; context?: JudgeContext },
  huellas: HuellaRegistry
): Promise<ShotOutcome> {
  const shot = row.shot;
  const minDuration = Math.max(1, row.end - row.start);
  const chain = sourceChain(
    { clase: shot.clase, query: shot.query, ...(shot.entidad ? { entidad: shot.entidad } : {}), ...(shot.anio ? { anio: shot.anio } : {}), ...(shot.articulo ? { articulo: shot.articulo } : {}) },
    style.sources.archiveFirst,
    youtubeEnabled()
  );
  const rejected: CandidateVerdict[] = [];
  // La justificacion del juez en cada ronda (se guarda con el plano).
  const juicios: string[] = [];
  let rounds = 0;
  const key = (c: VisualCandidate) => `${c.provider}:${c.external_id}`;

  // Cache por frase (MaV, 14 dias): la misma frase del mismo tema ya tuvo
  // material aprobado (regenerar, relanzar tras un fallo): se reusa sin
  // buscar ni juzgar. El QA final lo revisa igual.
  const cacheKey = shotKeyOf(ctx, row);
  if (judge && shot.clase !== "mapa") {
    const hit = await cachedShot(cacheKey);
    const c = hit?.candidate;
    if (c && !used.has(key(c)) && !used.has(c.url)) {
      used.add(key(c));
      used.add(c.url);
      const dup = huellas.claim(key(c), await fingerprint(c.url, c.type, c.duration_seconds));
      if (!dup) {
        juicios.push(`cache: material ya aprobado para esta frase (${hit!.source ?? "?"})`);
        await persistShotVisual(ctx, row, c, { code: "ok", reason: `cache: ${hit!.reason ?? "aprobado antes"}`, rejected, source: "cache", juicios });
        console.log(`[documental] plano ${row.order}: material de la cache (${c.provider})`);
        return { sceneId: row.id, order: row.order, source: (hit!.source ?? "commons") as SourceName, qa: "ok", provider: c.provider, rejected: 0 };
      }
    }
  }

  // Una ronda: buscar en una fuente y que el juez elija. Devuelve el
  // resultado si alguno paso; null para seguir con la siguiente.
  const tryRound = async (source: SourceName, search: PlannedShot, maxRounds: number): Promise<ShotOutcome | null> => {
    if (rounds >= maxRounds) return null;
    // Freno de YouTube abierto (bloqueo): ni se intenta, pasa a otra fuente.
    if (source === "youtube" && frenoYoutube.abierto()) return null;
    // Presupuesto de la busqueda (MaV): pasado el tope, lo que falta va al
    // rescate en vez de seguir esperando fuentes.
    if (ctx.searchDeadline && Date.now() > ctx.searchDeadline) return null;
    let found: VisualCandidate[] = [];
    try {
      found = (await sourceCandidates(source, search, minDuration, [...used], style, ctx)).filter((c) => !used.has(key(c)) && !used.has(c.url));
      // YouTube: como mucho YT_PER_ROUND videos por ronda (la biblioteca primero).
      if (source === "youtube") found = found.slice(0, YT_PER_ROUND);
    } catch (err) {
      console.warn(`[documental] plano ${row.order}: fuente ${source} fallo: ${(err as Error).message}`);
      return null;
    }
    if (found.length === 0) return null;
    if (!judge) {
      const pick = found[0]!;
      used.add(key(pick));
      used.add(pick.url);
      await persistShotVisual(ctx, row, pick, { code: "ok", reason: "sin juez", rejected, source });
      return { sceneId: row.id, order: row.order, source, qa: "ok", provider: pick.provider, rejected: 0 };
    }
    rounds += 1;
    const judgeOnce = () =>
      judgeCandidates(judge.client, judge.model, judgeShotOf(row, neighbours.context), found, judge.workDir, judge.usage).catch((err) => {
        console.warn(`[documental] plano ${row.order}: el juez fallo: ${(err as Error).message}`);
        return null;
      });
    // Un error tecnico del juez (red, JSON cortado) se reintenta una vez.
    const verdict = (await judgeOnce()) ?? (await judgeOnce());
    if (!verdict) {
      // Falla abierto (MaV): si el juez no pudo contestar dos veces, el plano
      // no termina en niebla por un error tecnico. Va el primer candidato que
      // no es YouTube (YouTube necesita el juez para elegir el tramo); el QA
      // final lo revisa igual.
      const pick = found.find((c) => c.provider !== "youtube" && !used.has(key(c)) && !used.has(c.url));
      if (pick) {
        used.add(key(pick));
        used.add(pick.url);
        juicios.push(`${source} "${search.query}": el juez fallo 2 veces, se acepto sin juzgar (lo revisa el QA final)`);
        await persistShotVisual(ctx, row, pick, { code: "ok", reason: "juez caido: aceptado sin juzgar", rejected, source, juicios });
        return { sceneId: row.id, order: row.order, source, qa: "ok", provider: pick.provider, rejected: rejected.length };
      }
      return null;
    }
    if (verdict?.justification) juicios.push(`${source} "${search.query}" (${found.length} candidatos): ${verdict.justification}`);
    // Cuadros buenos de cada hoja de YouTube (aunque no se elija ese video): el
    // rescate saca de aca "otro momento" en vez de probar a ciegas.
    for (const v of verdict.verdicts) {
      const c = found[v.index];
      const times = c?.sheet_times;
      if (!c || c.provider !== "youtube" || !times || v.code !== "ok") continue;
      const good = [...new Set([v.frame, ...(v.goodFrames ?? [])].filter((n): n is number => n !== undefined))].map((n) => times[n - 1]).filter((t): t is number => t !== undefined);
      if (good.length) rememberGoodMoments(ctx, v.logoCorner ? { ...c, logo_corner: v.logoCorner } : c, good, shot.temaBloque);
    }
    if (verdict && verdict.chosen !== null) {
      let pick = found[verdict.chosen]!;
      // YouTube: el juez eligio por miniatura y titulo. Recien ahora se baja
      // el tramo y se revisa con cuadros reales (2da revision, como MaV).
      if (pick.provider === "youtube") {
        // Candado por video (sincronico): si otro plano en paralelo ya tomo
        // este video mientras el juez pensaba, no se usa dos veces.
        if (used.has(key(pick))) {
          rejected.push({ index: verdict.chosen, code: "equivocado", reason: `youtube: otro plano ya tomo este video (${pick.external_id})` });
          return null;
        }
        used.add(key(pick));
        // El cuadro de la hoja que eligio el juez: el tramo arranca ahi (sin
        // filtro de subtitulos: el juez ya vio el contenido real). Si no da un
        // tramo limpio, los otros cuadros buenos.
        const chosenVerdict = verdict.verdicts.find((v) => v.index === verdict.chosen);
        // Logo chico de canal en una esquina: el tramo se baja recortado.
        if (chosenVerdict?.logoCorner) {
          pick = { ...pick, logo_corner: chosenVerdict.logoCorner };
          juicios.push(`youtube ${pick.external_id}: logo de canal en la esquina ${chosenVerdict.logoCorner}, se recorta`);
        }
        const frames = [...new Set([chosenVerdict?.frame, ...(chosenVerdict?.goodFrames ?? [])].filter((n): n is number => n !== undefined))];
        const times = frames.map((n) => pick.sheet_times?.[n - 1]).filter((t): t is number => t !== undefined);
        const clip = await materializeYouTube(ctx, row, pick, judge, neighbours.context, {
          log: juicios,
          ...(times.length ? { atSeconds: times[0]!, alternatives: times.slice(1) } : {}),
        });
        if (clip) markMomentUsed(ctx, pick.external_id, clip.yt_start);
        if (!clip) {
          rejected.push({ index: verdict.chosen, code: "equivocado", reason: `youtube: el tramo bajado no muestra el sujeto (${pick.title ?? pick.external_id})` });
          return null;
        }
        pick = clip;
      }
      // Misma imagen desde otra fuente (dHash, como MaV): se rechaza.
      const huella = await fingerprint(pick.url, pick.type, pick.duration_seconds);
      // Doble chequeo sincronico (planos en paralelo): si otro plano ya lo tomo, sigue.
      if (pick.provider === "youtube" || (!used.has(key(pick)) && !used.has(pick.url))) {
        const dup = huellas.claim(key(pick), huella);
        if (dup) {
          used.add(key(pick));
          rejected.push({ index: verdict.chosen, code: "equivocado", reason: `repetido: la misma imagen ya esta en el video (${dup})` });
          return null;
        }
        used.add(key(pick));
        used.add(pick.url);
        const reason = verdict.verdicts.find((v) => v.index === verdict.chosen)?.reason;
        await persistShotVisual(ctx, row, pick, { code: "ok", ...(reason ? { reason } : {}), rejected, source, juicios });
        await storeShot(cacheKey, pick, reason, source);
        return { sceneId: row.id, order: row.order, source, qa: "ok", provider: pick.provider, rejected: rejected.length };
      }
    }
    for (const v of verdict?.verdicts ?? []) rejected.push({ ...v, reason: `${source}/${found[v.index]?.provider}: ${v.reason}` });
    return null;
  };

  // 1. Cadena de fuentes de la clase.
  for (const source of chain) {
    const out = await tryRound(source, shot, MAX_JUDGE_ROUNDS);
    if (out) return out;
  }

  // Mapa: sin busqueda; reuseNeighbourVisuals le pone el material vecino.
  if (shot.clase === "mapa") return { sceneId: row.id, order: row.order, source: "none", qa: "seguro", rejected: 0 };

  // 1b. Respaldos del plan (MaV: fuente + respaldo[]): otro angulo filmable de
  // la misma frase que escribio el montajista, por la misma cadena de fuentes.
  for (const query of shot.respaldo ?? []) {
    for (const source of chain) {
      const { queryLocal: _ql, ...plain } = shot;
      const out = await tryRound(source, { ...plain, query }, MAX_JUDGE_ROUNDS + RESPALDO_JUDGE_ROUNDS);
      if (out) return out;
    }
  }
  const afterRespaldo = MAX_JUDGE_ROUNDS + (shot.respaldo?.length ? RESPALDO_JUDGE_ROUNDS : 0);

  // 2. Busquedas amplias (como MaV): el sujeto simplificado y las busquedas
  // de los planos vecinos, en stock y archive.org.
  const broad =[...new Set([shot.entidad, shot.sujeto?.split(/[,;(]/)[0]?.split(/\s+/).slice(0, 3).join(" "), ...neighbours.queries].map((q) => q?.trim()).filter((q): q is string => !!q && q.toLowerCase() !== shot.query.toLowerCase()))].slice(0, 3);
  for (const query of broad) {
    // Sin stock: el stock queda para el final del rescate.
    for (const source of ["archive", "commons"] as SourceName[]) {
      const out = await tryRound(source, { ...shot, query }, afterRespaldo + BROAD_JUDGE_ROUNDS);
      if (out) return out;
    }
  }

  // 3. Nada paso el juez: NO se pone un clip rechazado. El plano queda sin
  // visual y reuseNeighbourVisuals le pone el material de un plano vecino
  // (con sus graficos y rotulos encima), como hace MaV.
  console.log(
    `[documental] plano ${row.order}: sin imagen tras ${rejected.length} rechazos (${summarizeRejections(rejected)}) -> rescate`
  );
  return { sceneId: row.id, order: row.order, source: "none", qa: "seguro", rejected: rejected.length, rejections: rejected, juicios };
}

// "stock: 3 candidatos, rechazados: equivocado (nubes en el cielo); ...": una
// linea del recorrido del rescate.
function verdictNote(label: string, candidates: VisualCandidate[], verdict: JudgeResult | null): string {
  if (!verdict) return `${label}: ${candidates.length} candidatos, el juez fallo`;
  const parts = verdict.verdicts.slice(0, 4).map((v) => `${v.code} (${v.reason.slice(0, 90)})`);
  return `${label}: ${candidates.length} candidatos${verdict.justification ? `. Juez: ${verdict.justification}` : ""}. Rechazados: ${parts.join("; ") || "sin veredictos"}`;
}

// Donde pasa la historia, UNA llamada corta por video (Haiku): el juez la
// usa para rechazar material de otro pais o region. null si la historia no
// tiene un lugar (un tema global) o si falla: el juez sigue como antes.
export const STORY_PLACE_MODEL = "claude-haiku-5-5";
// Haiku primero; si contesta cortado o falla, el modelo del juez. Con 200
// tokens la respuesta salia cortada ("Unexpected end of JSON input") y el
// video quedaba sin lugar: sin control de pais y sin mapa de reserva.
async function storyPlace(judge: Judge, ctx: DocumentalContext): Promise<string | undefined> {
  const prompt = `Titulo: ${ctx.videoTopic ?? "(sin titulo)"}\nGuion: ${ctx.scriptText.slice(0, 3000)}\n\n¿En que lugar del mundo pasa esta historia? Responde la region y el pais, de lo mas chico a lo mas grande ("Baja California, Mexico"; "Cataratas del Iguazu, Misiones, Argentina y Parana, Brasil"). Si pasa en varios paises, nombralos. Si no tiene un lugar (un tema global o abstracto), responde "". Responde SOLO JSON: {"lugar": "..."}`;
  for (const model of [STORY_PLACE_MODEL, judge.model]) {
    try {
      const message = await judge.client.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: prompt }] });
      judge.usage.place_input = (judge.usage.place_input ?? 0) + message.usage.input_tokens;
      judge.usage.place_output = (judge.usage.place_output ?? 0) + message.usage.output_tokens;
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      if (a < 0 || b <= a) throw new Error(`sin JSON (${message.stop_reason})`);
      const parsed = JSON.parse(text.slice(a, b + 1)) as { lugar?: unknown };
      const lugar = typeof parsed.lugar === "string" ? parsed.lugar.trim().slice(0, 160) : "";
      return lugar || undefined;
    } catch (err) {
      console.warn(`[documental] lugar de la historia fallo con ${model}: ${(err as Error).message}`);
    }
  }
  return undefined;
}

// "epoca x5, texto x3, equivocado x2": para el log de cada plano sin imagen.
export function summarizeRejections(rejected: CandidateVerdict[]): string {
  const counts = new Map<string, number>();
  for (const r of rejected) counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${code} x${n}`).join(", ") || "ningun candidato";
}

type Judge = { client: Anthropic; model: string; qaModel?: string; workDir: string; usage: Record<string, number> };

// Precio por millon de tokens (entrada, salida), USD. Para estimar el costo
// de cada video y verlo en documental_plan.usage.costo_usd.
const PRICE_PER_M: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
};
function priced(model: string, input = 0, output = 0): number {
  const [i, o] = PRICE_PER_M[model] ?? [2, 10];
  return (input * i + output * o) / 1_000_000;
}
export function estimateCostUsd(
  judge: Record<string, number>,
  montaje: Record<string, { input?: number; output?: number }> | undefined,
  judgeModel: string,
  qaModel: string
): { total: number; partes: Record<string, number> } {
  const partes: Record<string, number> = {
    juez: priced(judgeModel, judge.input, judge.output),
    biblioteca: priced(judgeModel, judge.biblioteca_input, judge.biblioteca_output),
    qa: priced(qaModel, judge.qa_input, judge.qa_output),
    lugar: priced("claude-haiku-5-5", judge.place_input, judge.place_output),
    montaje: Object.entries(montaje ?? {}).reduce((s, [m, u]) => s + priced(m, u?.input, u?.output), 0),
  };
  for (const k of Object.keys(partes)) partes[k] = Math.round(partes[k]! * 1000) / 1000;
  return { total: Object.values(partes).reduce((a, b) => a + b, 0), partes };
}

// Visual (url + tipo) de cada plano, desde assets.
type ShotVisual = { url: string; type: "VIDEO" | "IMAGE"; provider: string; via: string; title?: string; duration?: number };

async function shotVisuals(ctx: DocumentalContext): Promise<Map<string, ShotVisual>> {
  const { data } = await supabase
    .from("assets")
    .select("scene_id, type, storage_key, metadata")
    .eq("video_project_id", ctx.projectId)
    .in("type", ["VIDEO", "IMAGE"])
    .contains("metadata", { kind: "documental" });
  const map = new Map<string, ShotVisual>();
  for (const r of data ?? []) {
    const m = r.metadata as { provider?: string; qa?: { source?: string }; title?: string; duration_seconds?: number; source_duration_seconds?: number };
    map.set(r.scene_id as string, {
      url: r.storage_key as string,
      type: r.type as "VIDEO" | "IMAGE",
      provider: m.provider ?? "",
      via: m.qa?.source ?? m.provider ?? "",
      ...(m.title ? { title: m.title } : {}),
      ...((m.source_duration_seconds ?? m.duration_seconds) ? { duration: (m.source_duration_seconds ?? m.duration_seconds)! } : {}),
    });
  }
  return map;
}

// Tiempo maximo para partir planos por los topes (MaV: PLAN_TOPES_MS, 3 min).
const TOPES_MS = envInt("DOCUMENTAL_TOPES_MS", 180_000);

// Parte un plano en dos: la segunda parte (desde `cut`) busca otro visual con
// la cadena de fuentes y el juez; los dos quedan en la misma escena
// (metadata.sequence 0 y 1, build_timeline reparte por duration_seconds).
async function splitShot(
  ctx: DocumentalContext,
  row: ShotRow,
  cut: number,
  words: Phrase[],
  style: DocumentalStyle,
  judge: Judge,
  used: Set<string>,
  context: JudgeContext | undefined,
  huellas: HuellaRegistry
): Promise<boolean> {
  const { data: current } = await supabase
    .from("assets")
    .select("video_project_id, scene_id, type, storage_key, metadata")
    .eq("scene_id", row.id)
    .in("type", ["VIDEO", "IMAGE"]);
  const original = current?.length === 1 ? current[0]! : null;
  if (!original) return false;
  const second = words.filter((w) => w.start - 0.12 >= cut);
  if (second.length === 0) return false;
  const part: ShotRow = { ...row, text: second.map((w) => w.text).join(" "), start: cut };
  // fillShot solo persiste si encontro algo: si falla, el original queda.
  const out = await fillShot(ctx, part, style, judge, used, { queries: [], ...(context ? { context } : {}) }, huellas);
  if (out.qa !== "ok") return false;
  const { data: added } = await supabase.from("assets").select("id, metadata").eq("scene_id", row.id).in("type", ["VIDEO", "IMAGE"]);
  const fresh = added?.[0];
  if (!fresh) return false;
  await supabase
    .from("assets")
    .update({ metadata: { ...(fresh.metadata as Record<string, unknown>), sequence: 1, duration_seconds: row.end - cut, parte: 1 } })
    .eq("id", fresh.id as string);
  const { error } = await supabase
    .from("assets")
    .insert({ ...original, metadata: { ...(original.metadata as Record<string, unknown>), sequence: 0, duration_seconds: cut - row.start } });
  if (error) throw new Error(error.message);
  return true;
}

// Topes de pantalla (topes.ts): rotulo 3 s, foto de tema 4 s. Primero se
// parte (si queda tiempo), si no se alargan los vecinos con leadSeconds.
async function applyScreenCaps(
  ctx: DocumentalContext,
  byOrder: ShotRow[],
  units: Phrase[],
  style: DocumentalStyle,
  judge: Judge | null,
  used: Set<string>,
  contexts: Map<string, JudgeContext>,
  huellas: HuellaRegistry,
  qaDecisions: QaDecision[]
): Promise<{ partidos: number; alargados: number }> {
  const visuals = await shotVisuals(ctx);
  const stockIds = new Set(qaDecisions.filter((d) => d.stock && !d.malo).map((d) => d.sceneId));
  const capOf = (r: ShotRow) => {
    // Un plano de mapa (de clase mapa o el mapa satelital que reemplaza a la
    // niebla) no es un rotulo: no se acorta ni se estira al vecino.
    if (r.shot.clase === "mapa" || ctx.overlayScenes?.has(r.id)) return null;
    const v = visuals.get(r.id);
    return v ? capFor({ ...v, stock: stockIds.has(r.id) }) : null;
  };
  const deadline = Date.now() + TOPES_MS;
  const counts = { partidos: 0, alargados: 0 };
  const leadDelta = new Map<string, number>();
  for (const [i, row] of byOrder.entries()) {
    const v = visuals.get(row.id);
    const cap = capOf(row);
    if (!v || cap === null) continue;
    const dur = row.end - row.start;
    if (dur <= cap + TOPE_MARGIN) continue;
    // 1. Partir con otra imagen (el rotulo ya agoto las fuentes: no se parte).
    if (judge && v.provider !== "textura" && v.via !== "rotulo" && Date.now() < deadline) {
      const words = units.slice(row.shot.from, row.shot.to + 1);
      const cut = cutPoint(words, row.start, row.end, cap);
      const ok = cut !== null && (await splitShot(ctx, row, cut, words, style, judge, used, contexts.get(row.id), huellas).catch(() => false));
      if (ok) {
        counts.partidos += 1;
        continue;
      }
    }
    // 2. Alargar los vecinos: el siguiente entra antes, el anterior sale despues.
    const room = (r: ShotRow | undefined) => {
      if (!r) return 0;
      const nv = visuals.get(r.id);
      const max = neighbourMax({ ...(nv ? { type: nv.type } : {}), graphic: !!r.shot.grafico || r.shot.clase === "mapa", cap: capOf(r), ...(nv?.duration ? { clipSeconds: nv.duration } : {}) });
      return Math.max(0, max - (r.end - r.start));
    };
    const next = byOrder[i + 1];
    const ext = planExtension(dur - cap, i > 0 ? room(byOrder[i - 1]) : 0, room(next));
    if (!ext) continue;
    if (ext.next && next) leadDelta.set(next.id, (leadDelta.get(next.id) ?? 0) + ext.next);
    if (ext.prev) leadDelta.set(row.id, (leadDelta.get(row.id) ?? 0) - ext.prev);
    counts.alargados += 1;
  }
  for (const [id, delta] of leadDelta) {
    const { data } = await supabase.from("scenes").select("content").eq("id", id).single();
    const content = (data?.content as Record<string, unknown>) ?? {};
    const lead = Number(content.leadSeconds ?? 0) + delta;
    await supabase.from("scenes").update({ content: { ...content, leadSeconds: Math.round(lead * 100) / 100 } }).eq("id", id);
  }
  return counts;
}

// Vias del rescate (persistShotVisual guarda la via en qa.source).
const RESCUE_VIAS = new Set(["toma_aprobada", "busqueda_tema", "wikipedia_articulo", "recorte"]);
// Reintentos del QA final por plano (MaV: PLAN_QA_REINTENTOS = 2).
const QA_RETRIES = envInt("DOCUMENTAL_QA_RETRIES", 2);

// QA final con vision (qaFinal.ts): juzga el video entero en tandas; un plano
// rechazado vuelve a llenarse con la cadena de fuentes (lo ya probado queda en
// `used`), hasta QA_RETRIES veces. Si sigue mal, queda para el rescate.
async function finalQa(
  ctx: DocumentalContext,
  byOrder: ShotRow[],
  outcomes: ShotOutcome[],
  style: DocumentalStyle,
  judge: Judge,
  used: Set<string>,
  contexts: Map<string, JudgeContext>,
  huellas: HuellaRegistry
): Promise<QaDecision[]> {
  const outcomeOf = new Map(outcomes.map((o) => [o.sceneId, o]));
  const all: QaDecision[] = [];
  let obras: { order: number; obra: string | null; sitio: boolean; text: string }[] = [];
  let pending = byOrder.filter((r) => outcomeOf.get(r.id)?.qa === "ok" && r.shot.clase !== "mapa");
  for (let ronda = 0; ronda <= QA_RETRIES && pending.length > 0; ronda++) {
    const visuals = await shotVisuals(ctx);
    const items: QaItem[] = pending.flatMap((r) => {
      const v = visuals.get(r.id);
      if (!v || v.provider === "textura") return [];
      return [
        {
          sceneId: r.id,
          order: r.order,
          shot: judgeShotOf(r, contexts.get(r.id)),
          url: v.url,
          type: v.type,
          ...(v.duration ? { durationSeconds: v.duration } : {}),
          ...(v.title ? { sourceTitle: v.title } : {}),
          rescue: RESCUE_VIAS.has(v.via),
        },
      ];
    });
    const { decisions, obras: kept } = await runQaFinal(judge.client, judge.qaModel ?? QA_MODEL, items, judge.workDir, judge.usage, ronda, obras, mainSubjectsOf(ctx));
    obras = kept;
    all.push(...decisions);
    const badRows = decisions.filter((d) => d.malo).flatMap((d) => byOrder.filter((r) => r.id === d.sceneId));
    console.log(`[documental] ${ctx.projectId}: QA final ronda ${ronda}: ${items.length} planos, ${badRows.length} rechazados`);
    if (badRows.length === 0) break;
    await mapWithConcurrency(badRows, SHOT_CONCURRENCY, async (row) => {
      await supabase.from("assets").delete().eq("scene_id", row.id).in("type", ["VIDEO", "IMAGE"]);
      await forgetShot(shotKeyOf(ctx, row));
      const o = outcomeOf.get(row.id)!;
      if (ronda === QA_RETRIES) {
        // Sin mas reintentos: queda para el rescate.
        Object.assign(o, { source: "none", qa: "seguro", provider: undefined });
        return;
      }
      const i = byOrder.indexOf(row);
      const context = contexts.get(row.id);
      const out = await fillShot(
        ctx,
        row,
        style,
        judge,
        used,
        { queries: [byOrder[i - 1]?.shot.query, byOrder[i + 1]?.shot.query].filter((q): q is string => !!q), ...(context ? { context } : {}) },
        huellas
      );
      Object.assign(o, out, { rejected: o.rejected + out.rejected + 1 });
    });
    pending = badRows.filter((r) => outcomeOf.get(r.id)?.qa === "ok");
  }
  return all;
}

async function frameFor(url: string, type: "VIDEO" | "IMAGE", workDir: string, frames: Map<string, string | null>): Promise<string | null> {
  if (frames.has(url)) return frames.get(url)!;
  const out = path.join(workDir, `qa-${frames.size}.jpg`);
  const frame = await grabFrame(url, type, out).catch(() => null);
  frames.set(url, frame);
  return frame;
}

// QA sin modelo (MaV): brillo medio < 22 = oscuro, variacion < 5 = vacio.
// Esos planos pasan a "sin material" y el rescate les busca otro.
async function brightnessQa(
  ctx: DocumentalContext,
  byOrder: ShotRow[],
  outcomes: ShotOutcome[],
  workDir: string,
  frames: Map<string, string | null>
): Promise<{ oscuros: number; vacios: number }> {
  const visuals = await shotVisuals(ctx);
  const outcomeOf = new Map(outcomes.map((o) => [o.sceneId, o]));
  const counts = { oscuros: 0, vacios: 0 };
  await mapWithConcurrency(byOrder, 6, async (row) => {
    const o = outcomeOf.get(row.id);
    const v = visuals.get(row.id);
    if (!o || o.qa !== "ok" || !v) return;
    const frame = await frameFor(v.url, v.type, workDir, frames);
    const code = frame ? qaCode(await frameStats(frame)) : null;
    if (!code) return;
    counts[code === "oscuro" ? "oscuros" : "vacios"] += 1;
    console.warn(`[documental] plano ${row.order}: ${code} (QA de brillo) -> se rescata`);
    o.qa = "seguro";
    o.source = "none";
  });
  return counts;
}

// Hoja de contactos de todo el documental (MaV, hojaDeContacto).
async function buildContactSheet(
  ctx: DocumentalContext,
  byOrder: ShotRow[],
  outcomes: ShotOutcome[],
  workDir: string,
  frames: Map<string, string | null>
): Promise<string | null> {
  const visuals = await shotVisuals(ctx);
  const outcomeOf = new Map(outcomes.map((o) => [o.sceneId, o]));
  const tiles: SheetTile[] = [];
  await mapWithConcurrency(byOrder, 6, async (row) => {
    const v = visuals.get(row.id);
    if (v) await frameFor(v.url, v.type, workDir, frames);
  });
  for (const row of byOrder) {
    const v = visuals.get(row.id);
    const o = outcomeOf.get(row.id);
    const frame = v ? frames.get(v.url) ?? null : null;
    tiles.push({
      frame,
      label: `${row.order} ${row.shot.clase} ${v?.via ?? "sin visual"}`,
      flagged: !v || v.provider === "textura" || o?.qa !== "ok" || !frame,
    });
  }
  return contactSheet(tiles, workDir, ctx.projectId);
}

// Usos maximos de un mismo video de YouTube en todo el documental (en la
// prueba del Titanic uno aparecia 7 veces).
// Ronda con la que se guarda el QA de lo rescatado (despues de las del QA final).
const QA_RESCUE_RONDA = 9;
// 5 videos por ronda (antes 3): con la hoja rapida de 3 cuadros cada uno
// pesa poco para el juez y no hay que bajar el video para mirarlo.
const YT_PER_ROUND = 5;
const YT_MAX_USES = envInt("DOCUMENTAL_YT_MAX_USES", 3);
// Un video corto (un vuelo de drone de 29 s) da como mucho 2 planos: en La
// Rumorosa 10 de 41 planos salieron de 2 videos y se veian iguales.
const YT_SHORT_SECONDS = 90;
const YT_SHORT_MAX_USES = 2;
// El mismo video no vuelve hasta YT_NEAR planos despues (antes: solo el vecino).
const YT_NEAR = 3;
export function ytMaxUses(videoSeconds: number | undefined): number {
  return (videoSeconds ?? Infinity) < YT_SHORT_SECONDS ? YT_SHORT_MAX_USES : YT_MAX_USES;
}
// La tarjeta de capitulo no va en el gancho.
const CHAPTER_MIN_START = 20;
// Textura del estilo para el rotulo (como MaV: papel, hormigon o niebla;
// nunca negro). Se genera con ffmpeg y se sube una vez por video.
function textureKind(style: DocumentalStyle): "papel" | "hormigon" | "niebla" {
  if (style.look.layer === "paper") return "papel";
  if (style.id === "expediente" || style.id === "noticiero") return "hormigon";
  return "niebla";
}

async function textureUrl(style: DocumentalStyle, ctx: DocumentalContext, workDir: string): Promise<string> {
  const kind = textureKind(style);
  const graph = {
    papel: "color=c=0xd8cbad:s=1920x1080,noise=alls=22:allf=u,gblur=sigma=1.4,vignette=PI/5",
    hormigon: "color=c=0x6a6a66:s=1920x1080,noise=alls=34:allf=u,gblur=sigma=0.9,vignette=PI/5",
    // Ruido de baja resolucion agrandado = manchas suaves (un blur fuerte
    // sobre ruido fino promedia todo y queda casi negro).
    niebla:
      "color=c=0x3a4049:s=64x36,noise=alls=70:allf=u,hue=s=0,scale=1920:1080:flags=bicubic,gblur=sigma=18,colorbalance=bs=0.06:bm=0.04,noise=alls=5:allf=u,hue=s=0.3,vignette=PI/4",
  }[kind];
  const out = path.join(workDir, `textura-${kind}.jpg`);
  await runFfmpeg(["-y", "-f", "lavfi", "-i", graph, "-frames:v", "1", "-q:v", "3", out]);
  return uploadPublicFile({ bucket: "scene-uploads", r2Prefix: "skaler-media", path: `${ctx.projectId}/textura-${kind}-${Date.now()}.jpg`, contentType: "image/jpeg", body: out });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static no resolvio el binario"));
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-300)}`))));
  });
}

// Frase clave de los rotulos sobre textura (como rotulosDeFrase de MaV): UNA
// llamada al modelo para todos los rotulos del video. A diferencia de MaV, la
// frase tiene que ser literal y entenderse sola; si no pasa la validacion, la
// textura queda sin texto (solo subtitulos), nunca con una frase cortada.
const EDGE_WORDS = /^(el|la|los|las|un|una|de|del|a|al|en|con|por|para|y|o|que|se|su|sus|lo|pero|como|mas|más|muy|ni)$/i;

// Frase clave sin modelo: de 3 a 5 palabras SEGUIDAS de la frase, sin empezar
// ni terminar en palabra de enlace, con mas nombres propios y cifras (a
// igualdad, la mas larga). "" si la frase no da ninguna.
export function reserveKeyPhrase(text: string, seen: Set<string> = new Set()): string {
  const words = text
    .replace(/["«»“”]/g, "")
    .split(/\s+/)
    .map((w) => w.replace(/^[¿¡(]+/, "").replace(/[.,;:!?)]+$/, ""))
    .filter(Boolean);
  let best = "";
  let bestScore = -1;
  for (let size = 5; size >= 3; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const win = words.slice(i, i + size);
      if (EDGE_WORDS.test(win[0]!) || EDGE_WORDS.test(win[size - 1]!)) continue;
      const phrase = win.join(" ");
      if (seen.has(phrase.toLowerCase())) continue;
      const score = win.filter((w, k) => /\d/.test(w) || (i + k > 0 && /^[A-ZÁÉÍÓÚÑ]/.test(w))).length * 10 + size;
      if (score > bestScore) {
        best = phrase;
        bestScore = score;
      }
    }
  }
  return best;
}

async function addKeyPhraseOverlays(rows: ShotRow[], ctx: DocumentalContext, judge: Judge | null, toolCtx: { userId: string; jobId: string }): Promise<number> {
  if (!judge || rows.length === 0) return 0;
  let phrases: Record<string, string> = {};
  try {
    const list = rows.map((r) => ({ id: String(r.order), frase: r.text.slice(0, 260) }));
    const message = await judge.client.messages.create({
      model: judge.model,
      // Con 1200 el pensamiento se comia el limite ("Unexpected end of JSON input").
      max_tokens: 10000,
      messages: [
        {
          role: "user",
          content: `Documental "${ctx.videoTopic ?? ""}". Algunos planos no tienen imagen y muestran un rotulo tipografico sobre una textura. Para cada uno escribi la FRASE CLAVE de su narracion: de 3 a 6 palabras SEGUIDAS y COPIADAS TAL CUAL de la frase (mismas palabras, mismo orden), las que llevan el sentido (un nombre, un lugar, una cifra con su unidad, el hecho llamativo). Tiene que entenderse sola: que no empiece ni termine a mitad de idea, ni con un articulo, preposicion o conjuncion ("el", "de", "que", "y", "se"). Nunca una cifra sola. Cada rotulo con una frase DISTINTA. Si una frase no tiene nada que valga como rotulo, devolve "".
${JSON.stringify(list)}
Responde SOLO JSON: {"rotulos": {"<id>": "<frase clave>"}}`,
        },
      ],
    });
    judge.usage.input = (judge.usage.input ?? 0) + message.usage.input_tokens;
    judge.usage.output = (judge.usage.output ?? 0) + message.usage.output_tokens;
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    phrases = (JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { rotulos?: Record<string, string> }).rotulos ?? {};
  } catch (err) {
    // Sin la llamada, cada rotulo usa la frase de reserva: nunca queda vacio.
    console.warn(`[documental] frases clave de los rotulos fallaron, uso la reserva: ${(err as Error).message}`);
  }
  const seen = new Set<string>();
  let added = 0;
  const valid = (p: string) => {
    const w = p.split(/\s+/).filter(Boolean);
    return w.length >= 3 && w.length <= 6 && !EDGE_WORDS.test(w[0]!) && !EDGE_WORDS.test(w[w.length - 1]!) && !seen.has(p.toLowerCase());
  };
  for (const row of rows) {
    let phrase = (phrases[String(row.order)] ?? "").replace(/["«»“”]/g, "").replace(/[.,;:]+$/, "").trim();
    // Reserva (MaV claveDeReserva): el tramo con mas nombres y cifras.
    if (!valid(phrase)) phrase = reserveKeyPhrase(row.text, seen);
    if (!valid(phrase)) continue;
    const key = phrase.toLowerCase();
    const { data: current } = await supabase.from("scenes").select("content").eq("id", row.id).single();
    const content = (current?.content as Record<string, unknown>) ?? {};
    if (Array.isArray(content.overlays) && content.overlays.length > 0) continue; // ya tiene grafico o mapa encima
    try {
      const { overlay } = await runTool<GenerateOverlayInput, GenerateOverlayOutput>(
        "generate_overlay",
        { scene_id: row.id, script_text: row.text, full_text: ctx.scriptText, overlay: { type: "kinetic_quote", text: phrase, source: "script" } },
        toolCtx
      );
      const at = row.text.toLowerCase().indexOf(overlay.text.toLowerCase());
      const spec = { ...overlay, anchor: at >= 0 && row.text.length > 0 ? at / row.text.length : 0 };
      await supabase.from("scenes").update({ content: { ...content, overlays: [spec], overlay: spec } }).eq("id", row.id);
      seen.add(key);
      added += 1;
    } catch {
      // no es literal o no se lee sola: la textura queda sin texto
    }
  }
  return added;
}

// RESCATE EN DOS FASES (pedido del cliente, 27/11/2026). Regla: todo plano
// tiene una imagen real de fondo; una animacion nunca la reemplaza, va ENCIMA.
//   Fase 1, en paralelo: para cada plano sin material se juntan y se juzgan
//   candidatos (no se asigna nada):
//     1. otra toma YA APROBADA del mismo tema (YouTube, otro momento);
//     2. busqueda nueva con el tema_bloque en YouTube, Commons y articulos de
//        Wikipedia buscados por el tema (hasta 8 candidatos, un juicio);
//     3. imagenes del articulo de Wikipedia del plano (o de la entidad).
//   Fase 2, de a un plano y en orden: el primer candidato que no repite video
//   ni imagen con los planos ya decididos (3 o menos de distancia) y no pasa
//   su tope de usos. Si no hay, un RECORTE de material ya aprobado del tramo
//   (otra zona, zoom 1,5x-2x, otro movimiento y, en un clip, otro momento),
//   revisado por el juez. Si tampoco, el MAPA (la frase nombra un lugar como
//   nombre propio y no hay otro mapa al lado). Si no, FALLA: rotulo sobre el
//   recorte mas cercano desenfocado (o la textura, si no hay ninguno).
//   Despues, en la misma pasada, la animacion del paso 4 ENCIMA de los
//   recortes, si ni el plano anterior ni el siguiente tienen animacion.
// Como la fase 2 decide en orden, no hay carreras entre planos vecinos.
export const RESCUE_STEPS = ["toma_aprobada", "busqueda_tema", "wikipedia_articulo", "recorte", "mapa"] as const;
export type RescueStep = (typeof RESCUE_STEPS)[number];
export type RescueResult = RescueStep | "falla";
export type RescueCounts = Record<RescueResult | "animacion_encima", number>;

// Animaciones que el paso 4 puede elegir: las que leen una frase sin foto ni
// dato externo. Fuera los mapas (paso 5), capitulos, CTA, la foto sobre papel,
// el rotulo (kinetic_quote sobre textura ES la falla) y las de datos reales.
const RESCUE_ANIMATION_EXCLUDED = new Set([
  "title_card",
  "nav_header",
  "cta",
  "subscribe_cta",
  "map_marker",
  "map_globe",
  "map_cartoon",
  "location",
  "photo_frame",
  "photo_tree",
  "kinetic_quote",
  "chapter_index",
  "rank_reveal",
  "line_chart",
  "population_pyramid",
]);

export function rescueAnimationTypes(forbid: string[]): string[] {
  return plannableTypes().filter((t) => !RESCUE_ANIMATION_EXCLUDED.has(t) && !forbid.includes(t));
}

export type OverlayKind = "anim" | "mapa";

// ¿El plano anterior o el siguiente tienen una animacion (o un mapa)? Cuenta lo
// que ya reservaron otros planos del rescate (corren en paralelo).
export function neighbourHas(kinds: Map<string, Set<OverlayKind>>, byOrder: { id: string }[], i: number, kind: OverlayKind): boolean {
  return [byOrder[i - 1], byOrder[i + 1]].some((r) => !!r && !!kinds.get(r.id)?.has(kind));
}

// Que tiene encima un plano: un mapa cuenta como mapa Y como animacion (nunca
// una animacion pegada a un mapa); cualquier otro grafico, como animacion.
export function overlayKinds(types: string[]): Set<OverlayKind> {
  const kinds = new Set<OverlayKind>();
  for (const t of types) {
    kinds.add("anim");
    if (/^map_/.test(t)) kinds.add("mapa");
  }
  return kinds;
}

// El tramo del guion, tal cual, que coincide con `name` (sin tildes ni
// mayusculas): "Rio de la Plata" -> "Río de la Plata". null si no esta.
export function literalSpan(text: string, name: string): string | null {
  const words = text.split(/\s+/).filter(Boolean);
  const norm = words.map((w) => normTema(w));
  const want = normTema(name).split(" ").filter(Boolean);
  if (want.length === 0) return null;
  for (let i = 0; i + want.length <= norm.length; i++) {
    if (want.every((w, k) => norm[i + k] === w)) {
      return words
        .slice(i, i + want.length)
        .join(" ")
        .replace(/^[¿¡("«“]+/, "")
        .replace(/[.,;:!?)"»”]+$/, "");
    }
  }
  return null;
}

// El lugar que la frase NOMBRA (literal): el del plano, la entidad de un plano
// de lugar o una parte del lugar de la historia. null si no nombra ninguno.
// Solo como NOMBRE PROPIO (con mayuscula en la frase): "historia argentina"
// no es un lugar (Malvinas, 26/11: mapa de "argentina" en el plano 96).
export function placeInPhrase(text: string, candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    const name = (c ?? "").trim();
    if (normTema(name).length < 3) continue;
    const span = literalSpan(text, name);
    if (span && isProperName(span)) return span;
  }
  return null;
}

// Material aprobado para un plano en la fase 1 (listo para guardar).
interface ApprovedMaterial {
  cand: VisualCandidate;
  // El uso del video ya se cuenta al guardar (no antes).
}

// Duracion de un archivo de video (para el "otro momento" del recorte).
function probeSeconds(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null);
    const proc = spawn(ffmpegPath, ["-hide_banner", ...(/^https?:/.test(url) ? ["-user_agent", WIKIMEDIA_UA_PIPE, "-rw_timeout", "15000000"] : []), "-i", url], { windowsHide: true });
    let err = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("close", () => {
      clearTimeout(timer);
      const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null);
    });
    proc.on("error", () => resolve(null));
  });
}
const WIKIMEDIA_UA_PIPE = "ScalerTool/1.0 (https://github.com/jcambareri6/scaler_tool)";

// El cuadro recortado (lo que va a ver el espectador) para que el juez lo mire.
async function cropFrame(url: string, type: "VIDEO" | "IMAGE", crop: CropSpec, out: string): Promise<string> {
  await runFfmpeg([
    "-y",
    "-loglevel",
    "error",
    ...(/^https?:/.test(url) ? ["-user_agent", WIKIMEDIA_UA_PIPE, "-rw_timeout", "15000000"] : []),
    ...(type === "VIDEO" ? ["-ss", String((crop.t ?? 0) + 1)] : []),
    "-i",
    url,
    "-frames:v",
    "1",
    "-vf",
    `${cropFilter(crop)},scale=480:-2`,
    "-q:v",
    "4",
    out,
  ]);
  return out;
}

async function rescueGaps(
  ctx: DocumentalContext,
  byOrder: ShotRow[],
  outcomes: ShotOutcome[],
  style: DocumentalStyle,
  used: Set<string>,
  judge: Judge | null,
  toolCtx: { userId: string; jobId: string },
  huellas: HuellaRegistry
): Promise<RescueCounts & { planos: number; cortados_por_tiempo: number; mapas_del_plan: number; fase1_min: number; fase2_min: number }> {
  const counts: RescueCounts = { toma_aprobada: 0, busqueda_tema: 0, wikipedia_articulo: 0, recorte: 0, mapa: 0, falla: 0, animacion_encima: 0 };
  const outcomeOf = new Map(outcomes.map((o) => [o.sceneId, o]));
  const key = (c: VisualCandidate) => `${c.provider}:${c.external_id}`;
  const baseOf = (c: VisualCandidate) => `${c.provider}:${c.external_id.split("@")[0]!.split("#")[0]}`;

  // Lo que cada plano ya tiene encima (graficos del plan, mapas, capitulos).
  const { data: sceneRows } = await supabase.from("scenes").select("id, content").eq("script_id", ctx.scriptId);
  const contentOf = new Map((sceneRows ?? []).map((s) => [s.id as string, (s.content as Record<string, unknown>) ?? {}]));
  const overlayTypes = (id: string): string[] => {
    const o = contentOf.get(id)?.overlays;
    return Array.isArray(o) ? (o as { type?: string }[]).map((x) => x.type ?? "").filter(Boolean) : [];
  };
  const kinds = new Map(byOrder.map((r) => [r.id, overlayKinds(overlayTypes(r.id))]));

  // Planos de clase mapa CON su mapa: no son rescate, el mapa tapa la textura.
  const plannedMaps = byOrder.filter((r) => outcomeOf.get(r.id)?.qa !== "ok" && r.shot.clase === "mapa" && kinds.get(r.id)?.has("mapa"));
  const gaps = byOrder.filter((r) => outcomeOf.get(r.id)?.qa !== "ok" && !plannedMaps.includes(r));
  let texture: string | null = null;
  const textureFor = async () => (texture ??= await textureUrl(style, ctx, judge?.workDir ?? (await makeWorkDir("skaler-textura-"))));
  for (const row of plannedMaps) {
    await persistShotVisual(
      ctx,
      row,
      { provider: "textura", external_id: `textura-${row.order}`, type: "IMAGE", url: await textureFor(), license: "Propia", source_page: "", query: "mapa" },
      { code: "seguro", reason: "plano de mapa del plan: el mapa tapa la textura", rejected: [], source: "mapa_plan" }
    );
  }
  const empty = { ...counts, planos: 0, cortados_por_tiempo: 0, mapas_del_plan: plannedMaps.length, fase1_min: 0, fase2_min: 0 };
  if (gaps.length === 0) return empty;

  const rescueBudgetMs = Math.max(RESCUE_BUDGET_MS, gaps.length * RESCUE_MS_PER_SHOT);
  ctx.rescueDeadline = Date.now() + rescueBudgetMs;

  // Material ya puesto: origen de cada plano (no repetir cerca), usos por
  // video (tope en todo el documental) y la fila completa (fuente de recortes).
  const { data: placed } = await supabase
    .from("assets")
    .select("scene_id, type, storage_key, metadata")
    .eq("video_project_id", ctx.projectId)
    .in("type", ["VIDEO", "IMAGE"])
    .contains("metadata", { kind: "documental" });
  const originOf = new Map<string, string>();
  const usesOf = new Map<string, number>();
  type PlacedAsset = { type: "VIDEO" | "IMAGE"; url: string; meta: Record<string, unknown> };
  const assetOf = new Map<string, PlacedAsset>();
  for (const r of placed ?? []) {
    const m = r.metadata as { provider?: string; external_id?: string; sequence?: number };
    const base = `${m.provider}:${String(m.external_id ?? "").split("@")[0]!.split("#")[0]}`;
    originOf.set(r.scene_id as string, base);
    usesOf.set(base, (usesOf.get(base) ?? 0) + 1);
    if (m.provider !== "textura" && (m.sequence ?? 0) === 0) assetOf.set(r.scene_id as string, { type: r.type as "VIDEO" | "IMAGE", url: r.storage_key as string, meta: r.metadata as Record<string, unknown> });
  }
  const ytRoom = (s: VisualCandidate) => (usesOf.get(`youtube:${s.external_id}`) ?? 0) < ytMaxUses(s.video_seconds ?? s.duration_seconds);
  const contexts = shotContexts(byOrder, ctx.videoTopic, ctx.storyPlace);
  const animationTypes = rescueAnimationTypes(style.graphics.forbid);
  const placeHints = (ctx.storyPlace ?? "").split(/,|\s+y\s+|\s+and\s+|\//).map((s) => s.trim());
  const searches = new Map<string, Promise<VisualCandidate[]>>();
  const cached = (k: string, run: () => Promise<VisualCandidate[]>) => {
    let p = searches.get(k);
    if (!p) searches.set(k, (p = run().catch(() => [] as VisualCandidate[])));
    return p;
  };
  const lang = /ingl|english|^en\b/i.test(ctx.channelLanguage ?? "") ? "en" : "es";
  const wikiLangs = lang === "en" ? ["en", "es"] : ["es", "en"];
  const trails = new Map<string, string[]>();
  const trailOf = (row: ShotRow): string[] => {
    let t = trails.get(row.id);
    if (!t) trails.set(row.id, (t = []));
    return t;
  };
  const rejectionsOf = (row: ShotRow): CandidateVerdict[] => outcomeOf.get(row.id)?.rejections ?? [];
  const stepOf = new Map<string, RescueResult>();
  const resolved = (row: ShotRow, step: RescueResult, detail = "") => {
    stepOf.set(row.id, step);
    counts[step] += 1;
    trailOf(row).push(`resuelto por: ${step}${detail ? ` (${detail})` : ""}`);
  };
  let cutByTime = 0;

  // ---------- FASE 1 (en paralelo): juntar y juzgar candidatos, sin asignar ----------
  const t1 = Date.now();
  const options = new Map<string, RescueOption<ApprovedMaterial>[]>();
  const optionOf = (cand: VisualCandidate, step: RescueOption["step"]): RescueOption<ApprovedMaterial> => ({
    base: baseOf(cand),
    key: key(cand),
    step,
    maxUses: cand.provider === "youtube" ? ytMaxUses(cand.video_seconds ?? cand.duration_seconds) : 1,
    payload: { cand },
  });
  // Con 2 candidatos aprobados alcanza: la fase 2 elige entre ellos.
  const ENOUGH = 2;
  await mapWithConcurrency(gaps, RESCUE_CONCURRENCY, async (row) => {
    const list: RescueOption<ApprovedMaterial>[] = [];
    options.set(row.id, list);
    if (!judge) return trailOf(row).push("rescate: sin juez, pasos 1-3 sin probar");
    if (ctx.rescueDeadline && Date.now() > ctx.rescueDeadline) {
      cutByTime += 1;
      return trailOf(row).push("rescate: se paso el presupuesto de tiempo, pasos 1-3 sin probar");
    }
    const context = contexts.get(row.id);
    const temaBloque = row.shot.temaBloque ?? "";
    const tema = temaBloque || ctx.videoTopic || "";
    const judgeShot = judgeShotOf(row, context, { tema });
    const fresh = (c: VisualCandidate) => !used.has(key(c)) && !used.has(c.url);

    // 1. OTRA TOMA YA APROBADA DEL MISMO TEMA (YouTube): hasta 2 videos.
    const want = terms([temaBloque, row.shot.sujeto, row.shot.entidad, ...(row.shot.obligatorio ?? [])].filter(Boolean).join(" "));
    const temaN = normTema(temaBloque);
    const free = (id: string, t: number) => !(ctx.goodMoments?.get(id)?.used ?? []).some((u) => Math.abs(u - t) < MOMENT_GAP_SECONDS);
    const moments: { src: VisualCandidate; t: number; score: number }[] = [];
    for (const v of ctx.library ?? []) {
      const src = v.logoCorner ? { ...v.candidate, logo_corner: v.logoCorner } : v.candidate;
      for (const f of v.frames) {
        if (!f.ok) continue;
        const score = terms(f.desc).filter((w) => want.includes(w)).length;
        if (score > 0) moments.push({ src, t: f.t, score });
      }
    }
    for (const [, e] of ctx.goodMoments ?? []) {
      if (e.source && temaN && e.temas?.has(temaN)) for (const t of e.times) moments.push({ src: e.source, t, score: 1 });
    }
    const tried = new Set<string>();
    for (const m of moments.sort((a, b) => b.score - a.score)) {
      if (tried.size >= 2 || list.length >= ENOUGH) break;
      if (tried.has(m.src.external_id) || !ytRoom(m.src) || !free(m.src.external_id, m.t)) continue;
      tried.add(m.src.external_id);
      markMomentUsed(ctx, m.src.external_id, m.t);
      const clip = await materializeYouTube(ctx, row, m.src, judge, context, { atSeconds: m.t, tema, log: trailOf(row) });
      if (clip) list.push(optionOf({ ...clip, external_id: `${m.src.external_id}@t${Math.round(m.t)}` }, "toma_aprobada"));
      else {
        const e = ctx.goodMoments?.get(m.src.external_id);
        if (e) e.used = e.used.filter((u) => u !== m.t);
      }
    }
    if (tried.size === 0) trailOf(row).push("paso 1: ninguna toma aprobada del mismo tema libre");
    if (list.length >= ENOUGH) return;

    // 2. BUSQUEDA NUEVA CON EL TEMA DEL TRAMO: YouTube + Commons + articulos de
    // Wikipedia buscados por el tema, hasta 8 candidatos mezclados, un juicio.
    const q = temaBloque || row.shot.sujeto || row.shot.query;
    const ytOn = youtubeEnabled() && !frenoYoutube.abierto();
    const [yt, cm, wp] = await Promise.all([
      ytOn ? cached(`yt:${q}`, () => searchYouTubeVideos(q)) : Promise.resolve([] as VisualCandidate[]),
      cached(`cm:${q}`, () => searchCommonsImages(q)),
      cached(`wq:${q}`, () => searchWikipediaByTopic(q, wikiLangs)),
    ]);
    const pools = [yt.filter((c) => fresh(c) && ytRoom(c)).slice(0, 3), cm.filter(fresh).slice(0, 3), wp.filter(fresh).slice(0, 3)];
    const found: VisualCandidate[] = [];
    for (let k = 0; found.length < 8 && pools.some((p) => p.length > k); k++) for (const p of pools) if (p[k] && found.length < 8) found.push(p[k]!);
    if (found.length) {
      const verdict = await judgeCandidates(judge.client, judge.model, judgeShot, found, judge.workDir, judge.usage).catch(() => null);
      const okIdx = verdict ? [verdict.chosen, ...verdict.verdicts.filter((v) => v.code === "ok").map((v) => v.index)].filter((n, k, a): n is number => n !== null && a.indexOf(n) === k) : [];
      if (okIdx.length === 0) trailOf(row).push(verdictNote(`paso 2 "${q}"`, found, verdict));
      let ytTries = 0;
      for (const idx of okIdx) {
        if (list.length >= ENOUGH) break;
        const pick = found[idx]!;
        if (pick.provider !== "youtube") {
          list.push(optionOf(pick, "busqueda_tema"));
          continue;
        }
        if (ytTries++ >= 1) continue;
        const v = verdict!.verdicts.find((x) => x.index === idx);
        const frames = [...new Set([v?.frame, ...(v?.goodFrames ?? [])].filter((n): n is number => n !== undefined))];
        const times = frames.map((n) => pick.sheet_times?.[n - 1]).filter((t): t is number => t !== undefined);
        const clip = await materializeYouTube(ctx, row, v?.logoCorner ? { ...pick, logo_corner: v.logoCorner } : pick, judge, context, {
          tema,
          log: trailOf(row),
          ...(times.length ? { atSeconds: times[0]!, alternatives: times.slice(1) } : {}),
        });
        if (clip) {
          markMomentUsed(ctx, pick.external_id, clip.yt_start);
          list.push(optionOf(clip, "busqueda_tema"));
        }
      }
    } else {
      trailOf(row).push(`paso 2 "${q}": sin resultados`);
    }
    if (list.length >= ENOUGH) return;

    // 3. IMAGENES DEL ARTICULO DE WIKIPEDIA del plano (y si no hay, la entidad).
    const titles = [...new Set([row.shot.articulo, row.shot.entidad].map((t) => t?.trim()).filter((t): t is string => !!t))];
    let images: VisualCandidate[] = [];
    let title = "";
    for (const t of titles) {
      images = (await cached(`wp:${t}`, () => searchWikipediaImages(t, wikiLangs))).filter(fresh);
      title = t;
      if (images.length) break;
    }
    if (images.length) {
      const pool = images.slice(0, 4);
      const verdict = await judgeCandidates(judge.client, judge.model, judgeShot, pool, judge.workDir, judge.usage).catch(() => null);
      const okIdx = verdict ? [verdict.chosen, ...verdict.verdicts.filter((v) => v.code === "ok").map((v) => v.index)].filter((n, k, a): n is number => n !== null && a.indexOf(n) === k) : [];
      if (okIdx.length === 0) trailOf(row).push(verdictNote(`paso 3 wikipedia "${title}"`, pool, verdict));
      for (const idx of okIdx) if (list.length < ENOUGH) list.push(optionOf(pool[idx]!, "wikipedia_articulo"));
    } else {
      trailOf(row).push(titles.length ? `paso 3: el articulo "${titles.join('" / "')}" no tiene imagenes libres` : "paso 3: el plano no tiene articulo ni entidad");
    }
  });
  const fase1Ms = Date.now() - t1;

  // ---------- FASE 2 (de a un plano, en orden): elegir mirando a los vecinos ya decididos ----------
  const t2 = Date.now();
  const indexOf = new Map(byOrder.map((r, i) => [r.id, i]));
  const originAt = (i: number) => (byOrder[i] ? originOf.get(byOrder[i]!.id) : undefined);
  const cropAt = new Map<number, string>();
  const cropState: CropState = { bySource: new Map() };
  const cropSources = (): CropSource[] =>
    byOrder.flatMap((r, i) => {
      const a = assetOf.get(r.id);
      return a && !cropAt.has(i) && !(a.meta as { crop?: CropSpec }).crop ? [{ index: i, key: a.url, ...(r.shot.temaBloque ? { tema: r.shot.temaBloque } : {}), type: a.type }] : [];
    });

  // Guarda material de los pasos 1-3. false si ya esta en el video (dHash).
  const save = async (row: ShotRow, pick: VisualCandidate, step: RescueOption["step"]): Promise<boolean> => {
    used.add(key(pick));
    const dup = huellas.claim(key(pick), await fingerprint(pick.url, pick.type, pick.duration_seconds));
    if (dup) {
      trailOf(row).push(`${step}: repetido de ${dup}`);
      return false;
    }
    used.add(pick.url);
    const base = baseOf(pick);
    originOf.set(row.id, base);
    usesOf.set(base, (usesOf.get(base) ?? 0) + 1);
    resolved(row, step);
    await persistShotVisual(ctx, row, pick, { code: "ok", reason: `rescate: ${step}`, rejected: rejectionsOf(row), source: step, rescate: trailOf(row), juicios: outcomeOf.get(row.id)?.juicios ?? [] });
    // Queda como fuente de recortes, con sus datos para los creditos.
    assetOf.set(row.id, {
      type: pick.type,
      url: pick.url,
      meta: { provider: pick.provider, external_id: pick.external_id, license: pick.license, license_url: pick.license_url, author: pick.author, title: pick.title, url: pick.source_page },
    });
    Object.assign(outcomeOf.get(row.id)!, { source: "fallback", qa: "ok", provider: pick.provider });
    return true;
  };

  // Material de otro plano (recorte, o fondo desenfocado de la falla).
  const reuse = async (row: ShotRow, src: CropSource, crop: CropSpec, step: "recorte" | "falla"): Promise<void> => {
    const from = byOrder[src.index]!;
    const a = assetOf.get(from.id)!;
    const m = a.meta as { provider?: string; external_id?: string; license?: string; license_url?: string; author?: string; title?: string; url?: string };
    const cand: VisualCandidate = {
      provider: m.provider ?? "recorte",
      external_id: `${m.external_id ?? from.order}#${step}-${row.order}`,
      type: a.type,
      url: a.url,
      license: m.license ?? "",
      ...(m.license_url ? { license_url: m.license_url } : {}),
      ...(m.author ? { author: m.author } : {}),
      ...(m.title ? { title: m.title } : {}),
      source_page: m.url ?? "",
      query: step,
      crop,
      crop_of: from.order,
    };
    const base = originOf.get(from.id);
    if (base) originOf.set(row.id, base);
    await persistShotVisual(
      ctx,
      row,
      cand,
      step === "recorte"
        ? { code: "ok", reason: `rescate: recorte del plano ${from.order}`, rejected: rejectionsOf(row), source: "recorte", rescate: trailOf(row), juicios: outcomeOf.get(row.id)?.juicios ?? [] }
        : { code: "seguro", reason: `fallaron los pasos del rescate: rotulo sobre el plano ${from.order} desenfocado`, rejected: rejectionsOf(row), source: "rotulo", rescate: trailOf(row), juicios: outcomeOf.get(row.id)?.juicios ?? [] }
    );
    if (step === "recorte") {
      cropAt.set(indexOf.get(row.id)!, src.key);
      const done = cropState.bySource.get(src.key) ?? [];
      done.push(indexOf.get(row.id)!);
      cropState.bySource.set(src.key, done);
      Object.assign(outcomeOf.get(row.id)!, { source: "fallback", qa: "ok", provider: cand.provider });
    } else {
      Object.assign(outcomeOf.get(row.id)!, { source: "fallback", provider: "rotulo" });
    }
  };

  // Valida un grafico en modo estricto (texto literal del guion), como los del plan.
  const validOverlay = async (row: ShotRow, i: number, planned: OverlaySpec): Promise<OverlaySpec | null> => {
    const windowText = [byOrder[i - 1]?.text, row.text, byOrder[i + 1]?.text].filter(Boolean).join(" ");
    try {
      const { overlay } = await runTool<GenerateOverlayInput, GenerateOverlayOutput>(
        "generate_overlay",
        { scene_id: row.id, script_text: windowText, full_text: ctx.scriptText, overlay: planned },
        toolCtx
      );
      const at = row.text.toLowerCase().indexOf(overlay.text.toLowerCase());
      return { ...overlay, anchor: at >= 0 && row.text.length > 0 ? at / row.text.length : 0 };
    } catch (err) {
      trailOf(row).push(`${planned.type}: descartado por el validador (${(err as Error).message.slice(0, 100)})`);
      return null;
    }
  };
  const addOverlay = async (row: ShotRow, spec: OverlaySpec, replace = false) => {
    const content = contentOf.get(row.id) ?? {};
    const current = Array.isArray(content.overlays) ? (content.overlays as OverlaySpec[]) : [];
    const overlays = replace ? [spec] : [...current, spec];
    const next = { ...content, overlays, overlay: overlays[0] ?? null };
    await supabase.from("scenes").update({ content: next }).eq("id", row.id);
    contentOf.set(row.id, next);
  };

  const fallas: ShotRow[] = [];
  for (const row of gaps) {
    const i = indexOf.get(row.id)!;
    const context = contexts.get(row.id);
    const temaBloque = row.shot.temaBloque ?? "";

    // a) Material aprobado de los pasos 1-3 (el primero que no choca con lo ya decidido).
    let done = false;
    const opts = options.get(row.id) ?? [];
    const takenKeys = new Set<string>();
    for (let k = 0; k < opts.length && !done; k++) {
      const opt = pickOption(i, opts, originAt, (b) => usesOf.get(b) ?? 0, (kk) => takenKeys.has(kk) || used.has(kk));
      if (!opt) break;
      takenKeys.add(opt.key);
      done = await save(row, opt.payload.cand, opt.step);
    }
    if (opts.length && !done) trailOf(row).push(`fase 2: ${opts.length} candidatos aprobados, todos chocan con los planos de al lado o con su tope de usos`);

    // b) RECORTE de material ya aprobado del tramo, revisado por el juez.
    if (!done && judge) {
      const cands = cropCandidates(i, temaBloque, cropSources(), cropState, (j) => cropAt.get(j)).slice(0, 3);
      const tries: { src: CropSource; crop: CropSpec; cand: VisualCandidate }[] = [];
      for (const [n, src] of cands.entries()) {
        const nth = cropState.bySource.get(src.key)?.length ?? 0;
        const clipSeconds = src.type === "VIDEO" ? await probeSeconds(src.key) : null;
        const crop = cropSpecFor(nth, src.type, clipSeconds ?? undefined, row.end - row.start);
        const out = path.join(judge.workDir, `recorte-${row.order}-${n}.jpg`);
        const frame = await cropFrame(src.key, src.type, crop, out).catch(() => null);
        if (!frame) continue;
        tries.push({ src, crop, cand: { provider: "recorte", external_id: `recorte-${row.order}-${n}`, type: "IMAGE", url: src.key, thumb_path: frame, license: "", source_page: "", query: "recorte", title: `recorte del plano ${byOrder[src.index]!.order}` } });
      }
      if (tries.length) {
        const verdict = await judgeCandidates(judge.client, judge.model, judgeShotOf(row, context, { tema: temaBloque || ctx.videoTopic || "" }), tries.map((t) => t.cand), judge.workDir, judge.usage).catch(() => null);
        const pick = verdict && verdict.chosen !== null ? tries[verdict.chosen] : undefined;
        if (pick) {
          resolved(row, "recorte", `del plano ${byOrder[pick.src.index]!.order}, zoom ${pick.crop.zoom}x${pick.crop.t !== undefined ? `, desde ${pick.crop.t} s` : ""}`);
          await reuse(row, pick.src, pick.crop, "recorte");
          done = true;
        } else {
          trailOf(row).push(verdictNote("recortes", tries.map((t) => t.cand), verdict));
        }
      } else {
        trailOf(row).push("recorte: ningun material aprobado del tramo cumple los limites");
      }
    }

    // c) MAPA, solo si la frase nombra un lugar (nombre propio) y no hay otro mapa al lado.
    if (!done) {
      const place = placeInPhrase(row.text, [row.shot.lugar?.nombre, row.shot.clase === "lugar" || row.shot.clase === "mapa" ? row.shot.entidad : undefined, ...placeHints]);
      if (place && !neighbourHas(kinds, byOrder, i, "mapa")) {
        const own = row.shot.lugar && normTema(row.shot.lugar.nombre) === normTema(place) ? row.shot.lugar : null;
        const geo = own ? { lat: own.lat, lon: own.lon, ...(own.km ? { km: own.km } : {}) } : await correctPlace(place, undefined).catch(() => null);
        const spec = geo
          ? await validOverlay(row, i, { type: "map_marker", text: place, source: "script", geo: { lat: geo.lat, lon: geo.lon, ...(geo.km ? { km: geo.km } : {}) }, ...(style.graphics.mapBase ? { basemap: style.graphics.mapBase } : {}) })
          : null;
        if (spec) {
          await addOverlay(row, { ...spec, full: true }, true);
          kinds.get(row.id)!.add("mapa");
          kinds.get(row.id)!.add("anim");
          resolved(row, "mapa", place);
          await persistShotVisual(
            ctx,
            row,
            { provider: "textura", external_id: `textura-${row.order}`, type: "IMAGE", url: await textureFor(), license: "Propia", source_page: "", query: "mapa" },
            { code: "seguro", reason: `rescate: mapa de ${place}`, rejected: rejectionsOf(row), source: "mapa", rescate: trailOf(row), juicios: outcomeOf.get(row.id)?.juicios ?? [] }
          );
          (ctx.overlayScenes ??= new Set()).add(row.id);
          Object.assign(outcomeOf.get(row.id)!, { source: "fallback", qa: "ok", provider: "mapa" });
          done = true;
        }
      } else if (place) {
        trailOf(row).push(`mapa: ${place}, pero el plano de al lado ya es un mapa`);
      }
    }

    // d) FALLA: rotulo sobre el recorte mas cercano desenfocado; si no hay, la textura.
    if (!done) {
      resolved(row, "falla");
      const nearest = cropSources().sort((a, b) => Math.abs(a.index - i) - Math.abs(b.index - i))[0];
      if (nearest) {
        await reuse(row, nearest, { x: 0.5, y: 0.5, zoom: 1.3, blur: true }, "falla");
        trailOf(row).push(`falla: rotulo sobre el plano ${byOrder[nearest.index]!.order} desenfocado`);
      } else {
        await persistShotVisual(
          ctx,
          row,
          { provider: "textura", external_id: `textura-${row.order}`, type: "IMAGE", url: await textureFor(), license: "Propia", source_page: "", query: "rotulo" },
          { code: "seguro", reason: "fallaron los pasos del rescate y no hay material para desenfocar: rotulo sobre textura", rejected: rejectionsOf(row), source: "rotulo", rescate: trailOf(row), juicios: outcomeOf.get(row.id)?.juicios ?? [] }
        );
        Object.assign(outcomeOf.get(row.id)!, { source: "fallback", provider: "textura" });
      }
      fallas.push(row);
      console.log(`[documental] plano ${row.order}: FALLA del rescate. Rescate: ${trailOf(row).join(" | ").slice(0, 600)}`);
      continue;
    }

    // e) PASO 4: animacion ENCIMA de la imagen (nunca la reemplaza), solo en los
    // recortes, sin grafico propio y sin animacion en el plano de al lado.
    if (stepOf.get(row.id) === "recorte" && judge && animationTypes.length && overlayTypes(row.id).length === 0 && !neighbourHas(kinds, byOrder, i, "anim")) {
      const planned = await rescueAnimationSpec(judge, row, animationTypes, ctx).catch(() => null);
      const spec = planned ? await validOverlay(row, i, planned) : null;
      if (spec) {
        await addOverlay(row, spec);
        kinds.get(row.id)!.add("anim");
        counts.animacion_encima += 1;
        trailOf(row).push(`animacion encima: ${spec.type}`);
      }
    }
  }
  const fase2Ms = Date.now() - t2;

  // QA DE LO RESCATADO: lo de los pasos 1-3 pasa por el mismo QA; lo que no
  // pasa NO entra y queda como falla (rotulo sobre material desenfocado).
  if (judge && process.env.DOCUMENTAL_QA_FINAL !== "off") {
    const rescued = byOrder.filter((r) => {
      const s = stepOf.get(r.id);
      return s === "toma_aprobada" || s === "busqueda_tema" || s === "wikipedia_articulo";
    });
    if (rescued.length) {
      const visuals = await shotVisuals(ctx);
      const items: QaItem[] = rescued.flatMap((r) => {
        const v = visuals.get(r.id);
        if (!v || v.provider === "textura") return [];
        return [{ sceneId: r.id, order: r.order, shot: judgeShotOf(r, contexts.get(r.id)), url: v.url, type: v.type, ...(v.duration ? { durationSeconds: v.duration } : {}), ...(v.title ? { sourceTitle: v.title } : {}), rescue: true }];
      });
      const { decisions } = await runQaFinal(judge.client, judge.qaModel ?? QA_MODEL, items, judge.workDir, judge.usage, QA_RESCUE_RONDA, [], mainSubjectsOf(ctx)).catch((err) => {
        console.warn(`[documental] QA del rescate fallo: ${(err as Error).message}`);
        return { decisions: [] as QaDecision[] };
      });
      let rejected = 0;
      for (const d of decisions.filter((x) => x.malo)) {
        const row = byOrder.find((r) => r.id === d.sceneId);
        const step = row && stepOf.get(row.id);
        if (!row || !step) continue;
        counts[step] -= 1;
        counts.falla += 1;
        stepOf.set(row.id, "falla");
        trailOf(row).push(`QA del rescate: ${d.codigo} (${d.por}) -> no entra, falla`);
        const i = indexOf.get(row.id)!;
        assetOf.delete(row.id);
        const nearest = cropSources().sort((a, b) => Math.abs(a.index - i) - Math.abs(b.index - i))[0];
        if (nearest) await reuse(row, nearest, { x: 0.5, y: 0.5, zoom: 1.3, blur: true }, "falla");
        else {
          await persistShotVisual(
            ctx,
            row,
            { provider: "textura", external_id: `textura-${row.order}`, type: "IMAGE", url: await textureFor(), license: "Propia", source_page: "", query: "rotulo" },
            { code: "seguro", reason: `QA del rescate rechazo lo rescatado: ${d.codigo}`, rejected: rejectionsOf(row), source: "rotulo", rescate: trailOf(row), juicios: outcomeOf.get(row.id)?.juicios ?? [] }
          );
          Object.assign(outcomeOf.get(row.id)!, { provider: "textura" });
        }
        Object.assign(outcomeOf.get(row.id)!, { qa: "seguro" });
        fallas.push(row);
        rejected += 1;
      }
      console.log(`[documental] ${ctx.projectId}: QA del rescate: ${items.length} planos, ${rejected} rechazados`);
    }
  }
  // Frase clave de los rotulos de las fallas.
  const withText = await addKeyPhraseOverlays(fallas, ctx, judge, toolCtx);
  const result = { ...counts, planos: gaps.length, cortados_por_tiempo: cutByTime, mapas_del_plan: plannedMaps.length, fase1_min: Math.round((fase1Ms / 60_000) * 10) / 10, fase2_min: Math.round((fase2Ms / 60_000) * 10) / 10 };
  console.log(
    `[documental] ${ctx.projectId}: RESCATE de ${gaps.length} planos -> paso 1: ${counts.toma_aprobada}, paso 2: ${counts.busqueda_tema}, paso 3: ${counts.wikipedia_articulo}, recorte: ${counts.recorte}, mapa: ${counts.mapa}, fallas: ${counts.falla} (animaciones encima: ${counts.animacion_encima}, rotulos con texto: ${withText}, cortados por tiempo: ${cutByTime}, mapas del plan: ${plannedMaps.length}, fase 1: ${result.fase1_min} min, fase 2: ${result.fase2_min} min)`
  );
  return result;
}

// Paso 4 del rescate: UNA llamada corta (el modelo del juez) que elige la
// animacion del catalogo que mejor lee la frase y la completa con texto
// literal. null si la frase no da para ninguna.
async function rescueAnimationSpec(judge: Judge, row: ShotRow, types: string[], ctx: DocumentalContext): Promise<OverlaySpec | null> {
  const guide = types.map((t) => `- ${t}: ${TYPE_GUIDE[t as OverlayType] ?? ""}`).join("\n");
  const message = await judge.client.messages.create({
    model: judge.model,
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: `Documental "${ctx.videoTopic ?? ""}". Este plano no tiene imagen: en pantalla va UNA animacion que muestre lo que dice la voz.
La voz dice: "${row.text.slice(0, 400)}"
Tema de este tramo: ${row.shot.temaBloque ?? "(sin tema)"}

Elegi de esta lista el tipo que mejor lee ESTA frase y completalo. text, label e items se copian LITERALES de la frase (mismas palabras, mismo orden). Si la frase no da para ninguno, responde {"type": null}.
${guide}

Responde SOLO JSON: {"type": "...", "text": "...", "label": "...", "items": [{"label": "...", "text": "..."}], "icon": "..."}`,
      },
    ],
  });
  judge.usage.input = (judge.usage.input ?? 0) + message.usage.input_tokens;
  judge.usage.output = (judge.usage.output ?? 0) + message.usage.output_tokens;
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const raw = JSON.parse(text.slice(a, b + 1)) as { type?: unknown; text?: unknown; label?: unknown; items?: unknown; icon?: unknown };
  const type = typeof raw.type === "string" ? raw.type : "";
  const main = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!types.includes(type) || !main) return null;
  const items = Array.isArray(raw.items)
    ? (raw.items as { label?: unknown; text?: unknown }[])
        .map((x) => ({ label: typeof x?.label === "string" ? x.label : "", text: typeof x?.text === "string" ? x.text.trim() : "" }))
        .filter((x) => x.text)
    : [];
  return {
    type: type as OverlayType,
    text: main,
    source: "script",
    ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
    ...(items.length ? { items } : {}),
    ...(typeof raw.icon === "string" && raw.icon.trim() ? { icon: raw.icon.trim() } : {}),
  };
}

// RELLENO SEGUIDO (pedido del cliente, 21/11/2026): dos planos seguidos de
// relleno (mapa del plan, mapa satelital o rotulo sobre la niebla) se notan
// mucho. Devuelve cada racha de 2 o mas para avisar y corregir a mano.
export function fillerRuns(rows: { order: number; clase: string; provider?: string | undefined }[]): { planos: number[]; tipos: string[] }[] {
  const tipo = (r: { clase: string; provider?: string | undefined }) => (r.clase === "mapa" || r.provider === "mapa" ? "mapa" : r.provider === "textura" || r.provider === "rotulo" ? "rotulo" : null);
  const runs: { planos: number[]; tipos: string[] }[] = [];
  let current: { order: number; t: string }[] = [];
  const close = () => {
    if (current.length >= 2) runs.push({ planos: current.map((c) => c.order), tipos: current.map((c) => c.t) });
    current = [];
  };
  for (const r of [...rows].sort((a, b) => a.order - b.order)) {
    const t = tipo(r);
    if (t) current.push({ order: r.order, t });
    else close();
  }
  close();
  return runs;
}

// FOTO SOBRE PAPEL (GoMotion, su recurso mas usado: ~15 en 23 min). Una foto
// fija de archivo (Commons, Wikidata, Openverse, archivo) se muestra enmarcada
// sobre papel antiguo con su leyenda, en vez de la foto sola: suma una
// animacion sin depender del montajista. Como mucho una cada
// PHOTO_FRAME_GAP s, nunca dos seguidas y solo en planos sin otro grafico.
// Tambien busca la foto de cada nodo de los photo_tree.
const PHOTO_FRAME_GAP = envInt("DOCUMENTAL_PHOTO_FRAME_GAP", 40);
const PHOTO_FRAME_SOURCES = new Set(["commons", "wikidata", "wikipedia", "openverse", "archive_org", "archive"]);
const PHOTO_FRAME_MIN_SECONDS = 3;

async function framePhotos(ctx: DocumentalContext, rows: ShotRow[]): Promise<{ marcos: number; arboles: number }> {
  if (process.env.DOCUMENTAL_FOTO_PAPEL === "off" || rows.length === 0) return { marcos: 0, arboles: 0 };
  const visuals = await shotVisuals(ctx);
  const { data } = await supabase.from("scenes").select("id, content").in("id", rows.map((r) => r.id));
  const contentOf = new Map((data ?? []).map((s) => [s.id as string, (s.content as Record<string, unknown>) ?? {}]));
  let lastAt = -Infinity;
  let prevFramed = false;
  let marcos = 0;
  let arboles = 0;
  for (const row of [...rows].sort((a, b) => a.order - b.order)) {
    const content = contentOf.get(row.id) ?? {};
    const overlays = Array.isArray(content.overlays) ? (content.overlays as OverlaySpec[]) : [];

    // Arbol de conceptos: la foto de cada nodo (Commons, la primera que haya).
    const tree = overlays.find((o) => o.type === "photo_tree" && (o.items ?? []).some((i) => !i.image));
    if (tree) {
      tree.items = await Promise.all(
        (tree.items ?? []).map(async (item) => {
          if (item.image) return item;
          const found = await searchCommonsImages(item.text).catch(() => [] as VisualCandidate[]);
          const pick = found.find((c) => c.type === "IMAGE");
          return pick ? { ...item, image: pick.thumb_url ?? pick.url } : item;
        })
      );
      await supabase.from("scenes").update({ content: { ...content, overlays } }).eq("id", row.id);
      arboles += 1;
    }

    const visual = visuals.get(row.id);
    const eligible =
      !!visual &&
      visual.type === "IMAGE" &&
      PHOTO_FRAME_SOURCES.has(visual.provider) &&
      overlays.length === 0 &&
      row.shot.clase !== "mapa" &&
      row.end - row.start >= PHOTO_FRAME_MIN_SECONDS &&
      !prevFramed &&
      row.start - lastAt >= PHOTO_FRAME_GAP;
    if (!eligible) {
      prevFramed = false;
      continue;
    }
    // Leyenda: el nombre de lo que muestra (entidad o lugar), corto y sin cifras.
    // Sin entidad ni lugar, el sujeto del plano si es corto (PILOTO 8: las 3
    // fotos salian sin leyenda).
    const shortName = (n: string | undefined) => {
      const t = (n ?? "").trim();
      return t && t.split(/\s+/).length <= 5 && !/\d/.test(t) ? t : "";
    };
    const caption = shortName(row.shot.entidad) || shortName(row.shot.lugar?.nombre) || shortName(row.shot.sujeto);
    const spec: OverlaySpec = { type: "photo_frame", text: caption, source: "script", image: visual.url, anchor: 0, full: true };
    await supabase.from("scenes").update({ content: { ...content, overlays: [spec], overlay: spec } }).eq("id", row.id);
    marcos += 1;
    lastAt = row.start;
    prevFramed = true;
  }
  return { marcos, arboles };
}

// ESTILO MAPA INTERACTIVO (como el directorMapa de MaV): el video entero es un
// mapa explicativo, un plano map_cartoon por frase, sin montajista ni juez.
// La base de cada escena es la textura del estilo (el mapa la tapa entera).
// Devuelve false si no se pudo (sin provider o sin escenas): sigue el normal.
async function runMapaDocumental(ctx: DocumentalContext, phrases: Phrase[], style: DocumentalStyle): Promise<boolean> {
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key || !style.mapaCartoon) return false;
  await reportJobProgress(ctx.jobId, 25, "El director de mapas está armando el mapa animado...", { force: true });
  const result = await directMapa({
    client: new Anthropic({ apiKey: provider.api_key }),
    model: (provider.configuration?.mapa_model as string | undefined) ?? MAPA_MODEL,
    phrases,
    scriptText: ctx.scriptText,
    language: ctx.channelLanguage ?? "",
    min: style.mapaCartoon.planoMin,
    max: style.mapaCartoon.planoMax,
  });
  if (!result) return false;
  // Etiquetas de lugares con su coordenada real: el modelo las ubica de
  // memoria y de cerca un error de 20 km deja "TULUM" en el mar. Solo si el
  // resultado cae cerca (<= 300 km) de donde la puso el modelo; mares y
  // golfos se dejan como estan (su "centro" es lo que el modelo eligio).
  await reportJobProgress(ctx.jobId, 75, "Ubicando los nombres de los lugares en el mapa...", { force: true });
  let labelsFixed = 0;
  for (const escena of result.escenas) {
    for (const l of (escena.etiquetas as { texto?: string; lat?: number; lon?: number }[] | undefined) ?? []) {
      if (!l?.texto || typeof l.lat !== "number" || typeof l.lon !== "number") continue;
      if (/\b(mar|golfo|oc[eé]ano|caribe|sea|gulf|ocean|bah[ií]a|estrecho|canal)\b/i.test(l.texto)) continue;
      const fixed = await correctPlace(l.texto, { lat: l.lat, lon: l.lon }).catch(() => null);
      if (fixed?.corrected && haversineKm({ lat: l.lat, lon: l.lon }, fixed) <= 300) {
        l.lat = fixed.lat;
        l.lon = fixed.lon;
        labelsFixed += 1;
      }
    }
  }
  if (labelsFixed) console.log(`[documental] ${ctx.projectId}: ${labelsFixed} etiquetas del mapa ubicadas en su lugar real`);
  await reportJobProgress(ctx.jobId, 80, `Mapa listo: ${result.shots.length} planos (${result.buenas} escenas de Claude). Guardando...`, { force: true });

  const { error: deleteError } = await supabase.from("scenes").delete().eq("script_id", ctx.scriptId);
  if (deleteError) throw new Error(deleteError.message);
  const rows = result.shots.map((s, i) => {
    const spec = { type: "map_cartoon", text: s.line, source: "script", escena: result.escenas[i], anchor: 0 };
    return {
      script_id: ctx.scriptId,
      order: i + 1,
      content: {
        text: s.line,
        timeStart: formatTime(s.start),
        timeEnd: formatTime(s.end),
        startSeconds: s.start,
        endSeconds: s.end,
        duration: `${Math.round(s.end - s.start)}s`,
        shot: { clase: "mapa", sujeto: "mapa explicativo", query: "" },
        overlays: [spec],
        overlay: spec,
      },
    };
  });
  const { data, error } = await supabase.from("scenes").insert(rows).select("id, order");
  if (error) throw new Error(error.message);
  const ids = new Map((data ?? []).map((r) => [r.order as number, r.id as string]));

  // Base: la textura del estilo, una sola subida para todas las escenas.
  const workDir = await makeWorkDir("skaler-mapa-");
  const outcomes: { sceneId: string; order: number; source: string; qa: string; provider: string; rejected: number }[] = [];
  try {
    const base = await textureUrl(style, ctx, workDir);
    await mapWithConcurrency(result.shots, 6, async (s, i) => {
      const id = ids.get(i + 1)!;
      const row: ShotRow = { id, order: i + 1, text: s.line, shot: { from: s.from, to: s.to, clase: "mapa", sujeto: "mapa explicativo", query: "" }, start: s.start, end: s.end };
      await persistShotVisual(
        ctx,
        row,
        { provider: "mapa", external_id: `mapa-${i + 1}`, type: "IMAGE", url: base, license: "Propia", source_page: "", query: "mapa" },
        { code: "seguro", reason: "fondo del mapa explicativo", rejected: [], source: "mapa" }
      );
      outcomes.push({ sceneId: id, order: i + 1, source: "mapa", qa: "ok", provider: "mapa", rejected: 0 });
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  const summary = {
    style: style.id,
    source: "directorMapa",
    chapters: [],
    issues: result.buenas < result.shots.length ? [`${result.shots.length - result.buenas} plano(s) repiten la escena anterior`] : [],
    usage: { mapa: result.usage },
    shots: outcomes.sort((a, b) => a.order - b.order),
    qa: { hoja: null },
    created_at: new Date().toISOString(),
  };
  const { error: saveError } = await supabase.from("video_projects").update({ documental_plan: summary, video_style: style.id }).eq("id", ctx.projectId);
  if (saveError) console.warn(`[documental] no se pudo guardar el plan del mapa: ${saveError.message}`);
  console.log(`[documental] ${ctx.projectId}: mapa explicativo, ${result.shots.length} planos, ${result.buenas} escenas de Claude`);
  return true;
}

// Un documental NUNCA sigue sin graficos (25/11/2026: dos corridas salieron
// sin una sola animacion porque motion/node_modules no estaba instalado y el
// montajista no tuvo ningun tipo para elegir). La API que no hace videos
// puede seguir sin motion: esto solo corre al armar un documental.
export function assertMotionReady(): string[] {
  const catalog = motionCatalog();
  if (!catalog) {
    const dir = process.env.MOTION_DIR ?? path.resolve(process.cwd(), "motion");
    throw new Error(`Graficos animados no disponibles: falta ${path.join(dir, "catalog.json")} o ${path.join(dir, "node_modules")} (correr npm install en motion/). El documental no se arma sin animaciones.`);
  }
  const types = plannableTypes();
  if (types.length === 0) throw new Error("Graficos animados no disponibles: plannableTypes() esta vacio (el catalogo de motion no tiene ningun tipo planificable). El documental no se arma sin animaciones.");
  return types;
}

export async function runDocumentalMontaje(ctx: DocumentalContext): Promise<void> {
  const motionTypes = assertMotionReady();
  console.log(`[documental] ${ctx.projectId}: graficos disponibles (${motionTypes.length}): ${motionTypes.join(", ")}`);
  const style = getDocumentalStyle(ctx.styleId);
  const toolCtx = { userId: ctx.userId, jobId: ctx.jobId };
  const phrases = buildPhrases([ctx.scriptText], ctx.words);
  if (phrases.length === 0) throw new Error("El guion no tiene frases para armar el documental");

  // Mapa interactivo: el video entero es un mapa explicativo.
  if (style.mapaCartoon) {
    const done = await runMapaDocumental(ctx, phrases, style).catch((err) => {
      console.warn(`[documental] el director de mapas fallo, sigue el documental normal: ${(err as Error).message}`);
      return false;
    });
    if (done) return;
  }

  // 1. Montajista + verificador.
  await reportJobProgress(ctx.jobId, 25, `El montajista está armando los planos (${style.name})...`, { force: true });
  const plan = await directMontaje({ phrases, style, ...(ctx.videoTopic ? { videoTopic: ctx.videoTopic } : {}) });
  console.log(`[documental] ${ctx.projectId}: ${plan.shots.length} planos (${plan.source}), ${plan.issues.length} avisos del verificador`);

  // 2. Planos -> escenas, con sus graficos validados.
  // Coordenadas reales antes de guardar (lugar y mapas).
  const placesFixed = await correctPlaces(plan.shots).catch((err) => {
    console.warn(`[documental] geocodificador fallo: ${(err as Error).message}`);
    return 0;
  });
  if (placesFixed) console.log(`[documental] ${ctx.projectId}: ${placesFixed} coordenadas corregidas`);
  // Datos reales del Banco Mundial para los planos que los piden.
  const data = await attachData(plan.shots);
  if (data.con || data.sin) console.log(`[documental] ${ctx.projectId}: graficos con datos ${data.con}, sin datos ${data.sin}`);
  // Los planos estan anclados a palabras: las escenas se arman sobre plan.units.
  const rows = await writeShotScenes(ctx, plan.units, plan);
  // Tarjetas de capitulo como MaV (directorV2.ponerCapitulos): solo en
  // videos de 3+ min, en capitulos de 60+ s y con 90 s entre tarjetas.
  // El capitulo sigue existiendo (musica, capitulos de YouTube); solo se
  // saltea su tarjeta en pantalla.
  const chapterTitle = new Map<number, string>();
  const videoEnd = rows.length ? Math.max(...rows.map((r) => r.end)) : 0;
  let lastCard = -Infinity;
  plan.chapters.forEach((c, i) => {
    const startRow = rows.find((r) => r.shot.capitulo === i + 1);
    if (!startRow) return;
    const nextStart = rows.find((r) => r.shot.capitulo === i + 2)?.start ?? videoEnd;
    if (videoEnd < 180 || nextStart - startRow.start < 60 || startRow.start - lastCard < 90) return;
    chapterTitle.set(i + 1, c.titulo);
    lastCard = startRow.start;
  });
  // Los planos duran 2,5-9 s y una frase suele quedar repartida en dos o
  // tres: el texto del grafico se valida contra el plano y sus vecinos (sigue
  // siendo literal del guion, solo tolera que este corrido un plano).
  const byOrder = [...rows].sort((a, b) => a.order - b.order);
  const windowText = new Map(
    byOrder.map((r, i) => [r.id, [byOrder[i - 1]?.text, r.text, byOrder[i + 1]?.text].filter(Boolean).join(" ")])
  );
  await mapWithConcurrency(rows, 6, async (row) => {
    const overlays = await validatedOverlays(row.shot, row.id, row.text, windowText.get(row.id) ?? row.text, ctx.scriptText, row.shot.capitulo ? chapterTitle.get(row.shot.capitulo) : undefined, toolCtx, row.start, style.graphics.mapBase);
    const { data: current } = await supabase.from("scenes").select("content").eq("id", row.id).single();
    const { error } = await supabase
      .from("scenes")
      .update({ content: { ...((current?.content as Record<string, unknown>) ?? {}), overlays, overlay: overlays[0] ?? null } })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
  });

  // 3-4. Spokes + juez, en paralelo.
  const provider = await getActiveProvider("anthropic");
  const workDir = await makeWorkDir("skaler-juez-");
  const judgeUsage: Record<string, number> = {};
  const judge =
    provider?.api_key && process.env.DOCUMENTAL_JUDGE !== "off"
      ? {
          client: new Anthropic({ apiKey: provider.api_key }),
          model: (provider.configuration?.juez_model as string | undefined) ?? JUDGE_MODEL,
          qaModel: (provider.configuration?.qa_model as string | undefined) ?? QA_MODEL,
          workDir,
          usage: judgeUsage,
        }
      : null;
  const used = new Set<string>();
  // Huellas dHash de todo lo aceptado (misma imagen desde otra fuente).
  const huellas = new HuellaRegistry();
  let done = 0;
  const outcomes: ShotOutcome[] = [];
  // QA final: cuadro de cada plano (cache por URL) para medir y para la hoja.
  const frames = new Map<string, string | null>();
  const qaCounts = { oscuros: 0, vacios: 0 };
  let qaDecisions: QaDecision[] = [];
  let topes = { partidos: 0, alargados: 0 };
  let rescate: Awaited<ReturnType<typeof rescueGaps>> | null = null;
  let hoja: string | null = null;
  try {
    const idx = new Map(byOrder.map((r, i) => [r.id, i]));
    // Contexto del juez por plano (frases de alrededor, titulo, epoca por reglas...).
    // Donde pasa la historia (una llamada corta): el juez rechaza otro pais.
    if (judge && !ctx.storyPlace) {
      const place = await storyPlace(judge, ctx);
      if (place) ctx.storyPlace = place;
      console.log(`[documental] ${ctx.projectId}: la historia pasa en ${place ?? "(sin lugar)"}`);
    }
    const contexts = shotContexts(byOrder, ctx.videoTopic, ctx.storyPlace);
    ctx.searchDeadline = Date.now() + Math.max(SEARCH_BUDGET_MS, rows.length * SEARCH_MS_PER_SHOT);
    // Todas las busquedas de YouTube del video, adelantadas y en cache.
    const ytQueries = rows.filter((r) => r.shot.clase !== "mapa").flatMap((r) => [r.shot.queryLocal ?? "", r.shot.query]);
    if (youtubeEnabled()) prewarmYouTubeSearches(ytQueries);
    // BIBLIOTECA DEL VIDEO: los videos de esas busquedas, escaneados y descritos
    // UNA vez. Cada plano elige de aca; el rescate usa sus cuadros aptos.
    if (youtubeEnabled() && judge && process.env.DOCUMENTAL_BIBLIOTECA !== "off") {
      await reportJobProgress(ctx.jobId, 30, "Armando la biblioteca del video (metraje de YouTube)...", { force: true });
      const t0 = Date.now();
      ctx.library = await buildLibrary({
        client: judge.client,
        model: judge.model,
        usage: judge.usage,
        workDir: judge.workDir,
        queries: ytQueries,
        topic: ctx.videoTopic ?? "",
        place: ctx.storyPlace ?? "",
        shots: rows.length,
      }).catch((err) => {
        console.warn(`[biblioteca] fallo: ${(err as Error).message.slice(0, 200)}`);
        return [];
      });
      for (const v of ctx.library) {
        const good = v.frames.filter((f) => f.ok).map((f) => f.t);
        if (good.length) rememberGoodMoments(ctx, v.logoCorner ? { ...v.candidate, logo_corner: v.logoCorner } : v.candidate, good);
      }
      const frames = ctx.library.reduce((n, v) => n + v.frames.filter((f) => f.ok).length, 0);
      console.log(`[documental] ${ctx.projectId}: biblioteca de ${ctx.library.length} videos y ${frames} cuadros aptos en ${Math.round((Date.now() - t0) / 1000)} s`);
      ctx.searchDeadline = Date.now() + Math.max(SEARCH_BUDGET_MS, rows.length * SEARCH_MS_PER_SHOT);
    }
    await mapWithConcurrency(rows, SHOT_CONCURRENCY, async (row) => {
      const i = idx.get(row.id) ?? 0;
      const context = contexts.get(row.id);
      const neighbours = {
        queries: [byOrder[i - 1]?.shot.query, byOrder[i + 1]?.shot.query].filter((q): q is string => !!q),
        ...(context ? { context } : {}),
      };
      outcomes.push(await fillShot(ctx, row, style, judge, used, neighbours, huellas));
      done += 1;
      await reportJobProgress(
        ctx.jobId,
        30 + Math.round((done / rows.length) * 58),
        `Buscando material de archivo y eligiendo con el juez (plano ${done}/${rows.length})...`,
        { force: done === rows.length }
      );
    });
    // QA sin modelo (MaV): planos oscuros o vacios pasan a rescatarse.
    await reportJobProgress(ctx.jobId, 87, "Revisando que ningún plano esté oscuro o vacío...", { force: true });
    // El presupuesto era de la busqueda: el QA final rellena sin el.
    delete ctx.searchDeadline;
    const flagged = await brightnessQa(ctx, byOrder, outcomes, workDir, frames);
    qaCounts.oscuros = flagged.oscuros;
    qaCounts.vacios = flagged.vacios;
    // QA final con vision (MaV qaPlan): el video entero, en tandas.
    if (judge && process.env.DOCUMENTAL_QA_FINAL !== "off") {
      await reportJobProgress(ctx.jobId, 87, "Revisando el video entero con el juez (QA final)...", { force: true });
      qaDecisions = await finalQa(ctx, byOrder, outcomes, style, judge, used, contexts, huellas).catch((err) => {
        console.warn(`[documental] QA final fallo (sigue sin QA): ${(err as Error).message}`);
        return [] as QaDecision[];
      });
    }
    await reportJobProgress(ctx.jobId, 88, "Rescatando los planos sin material (otros momentos, fotos del tema)...", { force: true });
    rescate = await rescueGaps(ctx, byOrder, outcomes, style, used, judge, toolCtx, huellas);
    // Topes de pantalla: rotulo 3 s, foto de tema 4 s (partir o alargar vecinos).
    topes = await applyScreenCaps(ctx, byOrder, plan.units, style, judge, used, contexts, huellas, qaDecisions).catch((err) => {
      console.warn(`[documental] topes de pantalla fallaron: ${(err as Error).message}`);
      return { partidos: 0, alargados: 0 };
    });
    // Fotos sobre papel (automatico) y fotos de los arboles de conceptos.
    const marcos = await framePhotos(ctx, byOrder).catch((err) => {
      console.warn(`[documental] fotos sobre papel fallaron: ${(err as Error).message}`);
      return { marcos: 0, arboles: 0 };
    });
    console.log(`[documental] ${ctx.projectId}: ${marcos.marcos} fotos sobre papel, ${marcos.arboles} arboles con fotos`);
    await reportJobProgress(ctx.jobId, 89, "Armando la hoja de contactos...", { force: true });
    hoja = await buildContactSheet(ctx, byOrder, outcomes, workDir, frames).catch((err) => {
      console.warn(`[documental] no se pudo armar la hoja de contactos: ${(err as Error).message}`);
      return null;
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  // Control de relleno seguido: 2 o mas planos seguidos de mapa, rotulo o
  // niebla (textura) quedan marcados para corregir en la revision.
  const rellenoSeguido = fillerRuns(
    byOrder.map((r) => ({ order: r.order, clase: r.shot.clase, provider: outcomes.find((o) => o.sceneId === r.id)?.provider }))
  );
  for (const run of rellenoSeguido) {
    const aviso = `relleno seguido: planos ${run.planos.join(", ")} (${run.tipos.join(" + ")}) -- corregir en la revision`;
    console.warn(`[documental] ${ctx.projectId}: AVISO ${aviso}`);
    plan.issues.push(aviso);
  }

  // 5. Plan guardado para la revision y la auditoria.
  const costo = estimateCostUsd(judgeUsage, plan.usage as Record<string, { input?: number; output?: number }> | undefined, judge?.model ?? JUDGE_MODEL, judge?.qaModel ?? QA_MODEL);
  console.log(`[documental] ${ctx.projectId}: costo de modelos ~${costo.total.toFixed(2)} USD (${JSON.stringify(costo.partes)})`);
  const summary = {
    style: style.id,
    source: plan.source,
    chapters: plan.chapters,
    issues: plan.issues,
    usage: { montaje: plan.usage, juez: judgeUsage, costo_usd: costo },
    rescate,
    shots: outcomes.sort((a, b) => a.order - b.order),
    qa: {
      hoja,
      ...qaCounts,
      revisados: new Set(qaDecisions.filter((d) => d.ronda === 0).map((d) => d.sceneId)).size,
      marcados: qaDecisions.filter((d) => d.malo).length,
      decisiones: qaDecisions,
      topes,
      relleno_seguido: rellenoSeguido,
    },
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("video_projects").update({ documental_plan: summary, video_style: style.id }).eq("id", ctx.projectId);
  if (error) console.warn(`[documental] no se pudo guardar el plan (¿se corrio la migracion 20261112000000?): ${error.message}`);
}
