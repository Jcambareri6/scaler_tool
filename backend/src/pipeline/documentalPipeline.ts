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
import { directMontaje, type MontajePlan, type PlannedShot, type ShotGraphic } from "../director/montajista.js";
import { JUDGE_MODEL, judgeCandidates, type CandidateVerdict, type QaCode } from "../director/visualJudge.js";
import {
  NOT_A_PORTRAIT,
  searchArchiveVideos,
  searchCommonsImages,
  searchOpenverseImages,
  searchWikidataImage,
  sourceChain,
  type SourceName,
  type VisualCandidate,
} from "../lib/documentalSources.js";
import { getDocumentalStyle, type DocumentalStyle } from "../lib/documentalStyles.js";
import { downloadYouTubeSegment, searchYouTubeVideos, uploadYouTubeSegment, youtubeEnabled } from "../lib/youtubeSource.js";
import type { TranscribedWord } from "../tools/transcribeAudio.tool.js";
import type { SearchStockInput, SearchStockOutput } from "../tools/searchStock.tool.js";
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

const SHOT_CONCURRENCY = envInt("DOCUMENTAL_SHOT_CONCURRENCY", 4);
// Rondas de juez por plano (cada una = una fuente con candidatos nuevos).
const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

const MAX_JUDGE_ROUNDS = envInt("DOCUMENTAL_JUDGE_ROUNDS", 3);
// Rondas extra del juez para las busquedas amplias (sujeto simplificado y
// busquedas de los planos vecinos) antes de reusar el plano vecino.
const BROAD_JUDGE_ROUNDS = envInt("DOCUMENTAL_BROAD_ROUNDS", 2);

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
}

function phraseText(phrases: Phrase[], shot: PlannedShot): string {
  return phrases.slice(shot.from, shot.to + 1).map((p) => p.text).join(" ");
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function toSpec(g: ShotGraphic): OverlaySpec {
  return {
    type: g.type as OverlayType,
    text: g.text,
    source: "script",
    ...(g.label ? { label: g.label } : {}),
    ...(g.items ? { items: g.items } : {}),
    ...(g.icon ? { icon: g.icon } : {}),
    ...(g.geo ? { geo: g.geo } : {}),
  };
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
  startSeconds: number
): Promise<OverlaySpec[]> {
  const wanted: OverlaySpec[] = [];
  // Tarjeta de capitulo: nunca en el gancho (primeros 20 s) y, si va, es lo
  // unico del plano (en la prueba se pisaba con hitos y numeros).
  const chapterCard = chapterTitle && startSeconds >= CHAPTER_MIN_START ? chapterTitle : undefined;
  if (chapterCard) {
    wanted.push({ type: "title_card", text: chapterCard, source: "script" });
  } else {
    if (shot.grafico) wanted.push(toSpec(shot.grafico));
    if (shot.clase === "mapa" && shot.lugar && !shot.grafico) {
      wanted.push({ type: "map_marker", text: shot.lugar.nombre, source: "script", geo: { lat: shot.lugar.lat, lon: shot.lugar.lon } });
    }
    if (shot.rotulo) wanted.push(toSpec(shot.rotulo));
  }
  const valid: OverlaySpec[] = [];
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
      valid.push({ ...overlay, anchor: at >= 0 && sceneText.length > 0 ? at / sceneText.length : 0 });
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
        shot: {
          clase: shot.clase,
          sujeto: shot.sujeto,
          query: shot.query,
          ...(shot.entidad ? { entidad: shot.entidad } : {}),
          ...(shot.anio ? { anio: shot.anio } : {}),
          ...(shot.lugar ? { lugar: shot.lugar } : {}),
          ...(shot.capitulo ? { capitulo: shot.capitulo } : {}),
          ...(shot.parte !== undefined ? { parte: shot.parte } : {}),
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

const STOCK_LICENSES: Record<string, string> = {
  pexels: "Licencia Pexels",
  pixabay: "Licencia Pixabay",
  coverr: "Licencia Coverr",
  wikimedia: "Dominio público / CC0",
  mock: "Muestra",
};

async function stockCandidates(query: string, minDuration: number, exclude: string[], ctx: DocumentalContext): Promise<VisualCandidate[]> {
  const result = await runTool<SearchStockInput, SearchStockOutput>(
    "search_stock",
    {
      keywords: [query, query.split(" ").slice(0, 3).join(" ")].filter((k, i, a) => k && a.indexOf(k) === i),
      min_duration_seconds: minDuration,
      exclude_keys: exclude,
      ...(ctx.contentPolicy ? { content_policy: ctx.contentPolicy } : {}),
    },
    { userId: ctx.userId, jobId: ctx.jobId }
  );
  // Solo Pexels: Pixabay no se usa en el documental (clips sin contexto y su
  // CDN trabo una corrida). Como MaV, que en este modo solo usa Pexels.
  return result.candidates.filter((c) => c.provider === "pexels").slice(0, 4).map((c) => ({
    provider: c.provider,
    external_id: c.external_id,
    type: "VIDEO" as const,
    url: c.preview_url,
    ...(c.duration_seconds ? { duration_seconds: c.duration_seconds } : {}),
    license: STOCK_LICENSES[c.provider] ?? "Licencia del proveedor",
    source_page: c.url,
    query,
  }));
}

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
    case "openverse":
      return searchOpenverseImages(shot.query);
    case "archive":
      return searchArchiveVideos(shot.query, shot.anio, shot.entidad);
    case "youtube":
      return searchYouTubeVideos(shot.query);
    case "stock":
      return stockCandidates(shot.query, minDuration, exclude, ctx);
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
  qa: { code: QaCode | "seguro"; reason?: string; rejected: CandidateVerdict[]; source: string }
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
      qa: { code: qa.code, ...(qa.reason ? { reason: qa.reason } : {}), source: qa.source, rejected: qa.rejected.slice(0, 8) },
    },
  });
  if (error) throw new Error(error.message);
}

// Baja el tramo de YouTube elegido por miniatura, lo revisa con 3 cuadros
// reales (el juez otra vez, con un solo candidato) y lo sube a R2. Devuelve
// el candidato con la URL propia, o null si el tramo no sirve.
async function materializeYouTube(
  ctx: DocumentalContext,
  row: ShotRow,
  pick: VisualCandidate,
  judge: { client: Anthropic; model: string; workDir: string; usage: Record<string, number> },
  prevText: string | undefined,
  opts: { startFraction?: number; tema?: string; anio?: number } = {}
): Promise<VisualCandidate | null> {
  try {
    const local = await downloadYouTubeSegment(pick, row.end - row.start, judge.workDir, opts.startFraction);
    const clip: VisualCandidate = {
      ...pick,
      url: local,
      duration_seconds: Math.min(Math.max(row.end - row.start + 1, 4), 14),
      video_seconds: pick.video_seconds ?? pick.duration_seconds ?? 0,
    };
    delete clip.thumb_url;
    const check = await judgeCandidates(
      judge.client,
      judge.model,
      {
        frase: row.text,
        clase: row.shot.clase,
        sujeto: row.shot.sujeto,
        ...((row.shot.anio ?? opts.anio) ? { anio: (row.shot.anio ?? opts.anio)! } : {}),
        ...(prevText ? { fraseAnterior: prevText } : {}),
        ...(opts.tema !== undefined ? { modo: "tema" as const, tema: opts.tema } : {}),
      },
      [clip],
      judge.workDir,
      judge.usage
    );
    if (check.chosen !== 0) {
      await rm(local, { force: true }).catch(() => undefined);
      return null;
    }
    const url = await uploadYouTubeSegment(local, pick, ctx.projectId);
    await rm(local, { force: true }).catch(() => undefined);
    return { ...clip, url };
  } catch (err) {
    console.warn(`[documental] plano ${row.order}: youtube ${pick.external_id} fallo: ${(err as Error).message}`);
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
  neighbours: { prevText?: string; queries: string[]; epoch?: number }
): Promise<ShotOutcome> {
  const shot = row.shot;
  const minDuration = Math.max(1, row.end - row.start);
  const chain = sourceChain({ clase: shot.clase, query: shot.query, ...(shot.entidad ? { entidad: shot.entidad } : {}), ...(shot.anio ? { anio: shot.anio } : {}) }, style.sources.archiveFirst, youtubeEnabled());
  const rejected: CandidateVerdict[] = [];
  let rounds = 0;
  const key = (c: VisualCandidate) => `${c.provider}:${c.external_id}`;

  // Una ronda: buscar en una fuente y que el juez elija. Devuelve el
  // resultado si alguno paso; null para seguir con la siguiente.
  const tryRound = async (source: SourceName, search: PlannedShot, maxRounds: number): Promise<ShotOutcome | null> => {
    if (rounds >= maxRounds) return null;
    let found: VisualCandidate[] = [];
    try {
      found = (await sourceCandidates(source, search, minDuration, [...used], style, ctx)).filter((c) => !used.has(key(c)) && !used.has(c.url));
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
    const verdict = await judgeCandidates(
      judge.client,
      judge.model,
      {
        frase: row.text,
        clase: shot.clase,
        sujeto: shot.sujeto,
        // Sin anio propio, el del capitulo: asi el juez rechaza lo moderno
        // (un display digital) en una escena de 1912.
        ...((shot.anio ?? neighbours.epoch) ? { anio: (shot.anio ?? neighbours.epoch)! } : {}),
        ...(neighbours.prevText ? { fraseAnterior: neighbours.prevText } : {}),
      },
      found,
      judge.workDir,
      judge.usage
    ).catch((err) => {
      console.warn(`[documental] plano ${row.order}: el juez fallo: ${(err as Error).message}`);
      return null;
    });
    if (verdict && verdict.chosen !== null) {
      let pick = found[verdict.chosen]!;
      // YouTube: el juez eligio por miniatura y titulo. Recien ahora se baja
      // el tramo y se revisa con cuadros reales (2da revision, como MaV).
      if (pick.provider === "youtube") {
        used.add(key(pick));
        const clip = await materializeYouTube(ctx, row, pick, judge, neighbours.prevText);
        if (!clip) {
          rejected.push({ index: verdict.chosen, code: "equivocado", reason: `youtube: el tramo bajado no muestra el sujeto (${pick.title ?? pick.external_id})` });
          return null;
        }
        pick = clip;
      }
      // Doble chequeo sincronico (planos en paralelo): si otro plano ya lo tomo, sigue.
      if (pick.provider === "youtube" || (!used.has(key(pick)) && !used.has(pick.url))) {
        used.add(key(pick));
        used.add(pick.url);
        const reason = verdict.verdicts.find((v) => v.index === verdict.chosen)?.reason;
        await persistShotVisual(ctx, row, pick, { code: "ok", ...(reason ? { reason } : {}), rejected, source });
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

  // 2. Busquedas amplias (como MaV): el sujeto simplificado y las busquedas
  // de los planos vecinos, en stock y archive.org.
  const broad =[...new Set([shot.entidad, shot.sujeto?.split(/[,;(]/)[0]?.split(/\s+/).slice(0, 3).join(" "), ...neighbours.queries].map((q) => q?.trim()).filter((q): q is string => !!q && q.toLowerCase() !== shot.query.toLowerCase()))].slice(0, 3);
  for (const query of broad) {
    // Sin stock: el stock queda para el final del rescate.
    for (const source of ["archive", "commons"] as SourceName[]) {
      const out = await tryRound(source, { ...shot, query }, MAX_JUDGE_ROUNDS + BROAD_JUDGE_ROUNDS);
      if (out) return out;
    }
  }

  // 3. Nada paso el juez: NO se pone un clip rechazado. El plano queda sin
  // visual y reuseNeighbourVisuals le pone el material de un plano vecino
  // (con sus graficos y rotulos encima), como hace MaV.
  return { sceneId: row.id, order: row.order, source: "none", qa: "seguro", rejected: rejected.length };
}

type Judge = { client: Anthropic; model: string; workDir: string; usage: Record<string, number> };

// Visual (url + tipo) de cada plano, desde assets.
async function shotVisuals(ctx: DocumentalContext): Promise<Map<string, { url: string; type: "VIDEO" | "IMAGE"; provider: string; via: string }>> {
  const { data } = await supabase
    .from("assets")
    .select("scene_id, type, storage_key, metadata")
    .eq("video_project_id", ctx.projectId)
    .in("type", ["VIDEO", "IMAGE"])
    .contains("metadata", { kind: "documental" });
  const map = new Map<string, { url: string; type: "VIDEO" | "IMAGE"; provider: string; via: string }>();
  for (const r of data ?? []) {
    const m = r.metadata as { provider?: string; qa?: { source?: string } };
    map.set(r.scene_id as string, { url: r.storage_key as string, type: r.type as "VIDEO" | "IMAGE", provider: m.provider ?? "", via: m.qa?.source ?? m.provider ?? "" });
  }
  return map;
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

// Momentos del video de YouTube que prueba el rescate (el 0.3 ya lo uso el plano original).
const RESCUE_FRACTIONS = [0.15, 0.45, 0.6, 0.75, 0.9, 0.05];
const RESCUE_YT_TOPIC_MAX = envInt("DOCUMENTAL_RESCUE_YT_TOPIC", 3);
// Usos maximos de un mismo video de YouTube en todo el documental (en la
// prueba del Titanic uno aparecia 7 veces).
const YT_MAX_USES = envInt("DOCUMENTAL_YT_MAX_USES", 3);
// La tarjeta de capitulo no va en el gancho.
const CHAPTER_MIN_START = 20;
// Ultima pasada contra los rotulos: cuantos reemplazos y en que puntos del video.
const LAST_PASS_MAX = 4;
const LAST_PASS_FRACTIONS = [0.25, 0.4, 0.55, 0.7, 0.85, 0.95, 0.1];

// Una llamada al modelo (una vez por video): 5 busquedas "seguras" del tema
// para Commons, como temaDelVideo de MaV.
async function topicQueries(judge: Judge, ctx: DocumentalContext): Promise<string[]> {
  const fallback = [ctx.videoTopic ?? ""].filter(Boolean);
  try {
    const message = await judge.client.messages.create({
      model: judge.model,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `Tema del video: ${ctx.videoTopic ?? "(sin titulo)"}\nComienzo del guion: ${ctx.scriptText.slice(0, 1500)}\n\nEscribi 5 busquedas en INGLES de 2 a 4 palabras para encontrar en Wikimedia Commons fotos seguras del tema central (el sujeto principal, su epoca, sus lugares, su gente). Concretas, con nombre propio y con la EPOCA de la historia (anio o decada) para no traer fotos actuales ("RMS Titanic 1912", "White Star Line 1912", "Titanic lifeboats 1912"). Responde SOLO JSON: {"queries": ["...", "..."]}`,
        },
      ],
    });
    judge.usage.input = (judge.usage.input ?? 0) + message.usage.input_tokens;
    judge.usage.output = (judge.usage.output ?? 0) + message.usage.output_tokens;
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { queries?: unknown };
    const queries = Array.isArray(parsed.queries) ? parsed.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 5) : [];
    return queries.length ? queries : fallback;
  } catch (err) {
    console.warn(`[documental] temaDelVideo fallo: ${(err as Error).message}`);
    return fallback;
  }
}

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

async function addKeyPhraseOverlays(rows: ShotRow[], ctx: DocumentalContext, judge: Judge | null, toolCtx: { userId: string; jobId: string }): Promise<number> {
  if (!judge || rows.length === 0) return 0;
  let phrases: Record<string, string> = {};
  try {
    const list = rows.map((r) => ({ id: String(r.order), frase: r.text.slice(0, 260) }));
    const message = await judge.client.messages.create({
      model: judge.model,
      max_tokens: 1200,
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
    console.warn(`[documental] frases clave de los rotulos fallaron: ${(err as Error).message}`);
    return 0;
  }
  const seen = new Set<string>();
  let added = 0;
  for (const row of rows) {
    const phrase = (phrases[String(row.order)] ?? "").replace(/["«»“”]/g, "").replace(/[.,;:]+$/, "").trim();
    const words = phrase.split(/\s+/).filter(Boolean);
    const key = phrase.toLowerCase();
    if (words.length < 3 || words.length > 6 || EDGE_WORDS.test(words[0]!) || EDGE_WORDS.test(words[words.length - 1]!) || seen.has(key)) continue;
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

// RESCATE (como MaV, rellenarPlan.js::sinMaterial/rescatar). Para los planos
// que nada paso el juez, en orden: otro momento de un YouTube ya usado ->
// fotos del tema en Commons (modo tema) -> YouTube con una busqueda del tema
// (tope por video) -> rotulo sobre la textura del estilo (o el mapa encima).
// Nunca se reusa un plano ya usado.
async function rescueGaps(
  ctx: DocumentalContext,
  byOrder: ShotRow[],
  outcomes: ShotOutcome[],
  style: DocumentalStyle,
  used: Set<string>,
  judge: Judge | null,
  toolCtx: { userId: string; jobId: string }
): Promise<void> {
  const outcomeOf = new Map(outcomes.map((o) => [o.sceneId, o]));
  const gaps = byOrder.filter((r) => outcomeOf.get(r.id)?.qa !== "ok");
  if (gaps.length === 0) return;
  const key = (c: VisualCandidate) => `${c.provider}:${c.external_id}`;
  const tema = ctx.videoTopic ?? "";

  // Videos de YouTube que ya dieron un plano bueno y que momentos ya se usaron.
  const { data: ytRows } = await supabase
    .from("assets")
    .select("metadata")
    .eq("video_project_id", ctx.projectId)
    .eq("type", "VIDEO")
    .contains("metadata", { kind: "documental", provider: "youtube" });
  const ytSources: VisualCandidate[] = [];
  for (const r of ytRows ?? []) {
    const m = r.metadata as { external_id?: string; video_seconds?: number; title?: string; author?: string; url?: string };
    if (!m.external_id || ytSources.some((s) => s.external_id === m.external_id)) continue;
    ytSources.push({
      provider: "youtube",
      external_id: m.external_id,
      type: "VIDEO",
      url: `https://www.youtube.com/watch?v=${m.external_id}`,
      ...(m.video_seconds ? { video_seconds: m.video_seconds, duration_seconds: m.video_seconds } : {}),
      ...(m.title ? { title: m.title } : {}),
      ...(m.author ? { author: m.author } : {}),
      license: "YouTube (sin licencia verificada)",
      source_page: m.url ?? `https://www.youtube.com/watch?v=${m.external_id}`,
      query: "rescate",
    });
  }
  const momentsUsed = new Map(ytSources.map((s) => [s.external_id, new Set<number>([0.3])]));

  // Video de origen de cada plano (para no repetir en planos seguidos) y
  // usos por video (tope YT_MAX_USES en todo el video, como MaV).
  const { data: placed } = await supabase
    .from("assets")
    .select("scene_id, metadata")
    .eq("video_project_id", ctx.projectId)
    .in("type", ["VIDEO", "IMAGE"])
    .contains("metadata", { kind: "documental" });
  const originOf = new Map<string, string>();
  const usesOf = new Map<string, number>();
  for (const r of placed ?? []) {
    const m = r.metadata as { provider?: string; external_id?: string };
    const base = `${m.provider}:${String(m.external_id ?? "").split("@")[0]}`;
    originOf.set(r.scene_id as string, base);
    usesOf.set(base, (usesOf.get(base) ?? 0) + 1);
  }
  const neighbourOrigins = (i: number) => [byOrder[i - 1], byOrder[i + 1]].map((r) => (r ? originOf.get(r.id) : undefined));
  // Epoca de cada plano: su anio o el ultimo anio dicho en su capitulo.
  const epochOf = new Map<string, number>();
  let lastYear: number | undefined;
  for (const r of byOrder) {
    if (r.shot.capitulo !== undefined) lastYear = undefined;
    if (r.shot.anio) lastYear = r.shot.anio;
    if (lastYear) epochOf.set(r.id, lastYear);
  }
  const queries = judge ? await topicQueries(judge, ctx) : [];
  const commonsPool: VisualCandidate[] = [];
  let commonsLoaded = 0;
  let ytTopicLeft = youtubeEnabled() ? RESCUE_YT_TOPIC_MAX : 0;
  let texture: string | null = null;
  const counts = { youtube_momento: 0, commons_tema: 0, youtube_tema: 0, stock_ultimo: 0, rotulo: 0 };

  const save = async (row: ShotRow, pick: VisualCandidate, via: string) => {
    used.add(key(pick));
    used.add(pick.url);
    const base = `${pick.provider}:${pick.external_id.split("@")[0]}`;
    originOf.set(row.id, base);
    usesOf.set(base, (usesOf.get(base) ?? 0) + 1);
    await persistShotVisual(ctx, row, pick, { code: "ok", reason: `rescate: ${via}`, rejected: [], source: via });
    const o = outcomeOf.get(row.id)!;
    o.source = "fallback";
    o.qa = "ok";
    o.provider = pick.provider;
  };

  await mapWithConcurrency(gaps, 3, async (row) => {
    const i = byOrder.indexOf(row);
    const prevText = byOrder[i - 1]?.text;
    const anio = row.shot.anio ?? epochOf.get(row.id);
    const judgeShot = {
      frase: row.text,
      clase: row.shot.clase,
      sujeto: row.shot.sujeto,
      ...(anio ? { anio } : {}),
      ...(prevText ? { fraseAnterior: prevText } : {}),
    };
    if (judge && row.shot.clase !== "mapa") {
      // 1. Otro momento de un YouTube ya usado (rota entre los videos), sin
      // pasar el tope de usos por video ni repetir el video del plano vecino.
      const near = neighbourOrigins(i);
      const candidatesYt = ytSources.filter((s) => (usesOf.get(`youtube:${s.external_id}`) ?? 0) < YT_MAX_USES && !near.includes(`youtube:${s.external_id}`));
      for (let attempt = 0; attempt < Math.min(2, candidatesYt.length); attempt++) {
        const src = candidatesYt[(i + attempt) % candidatesYt.length]!;
        const seen = momentsUsed.get(src.external_id)!;
        const fraction = RESCUE_FRACTIONS.find((f) => !seen.has(f));
        if (fraction === undefined) continue;
        seen.add(fraction);
        const clip = await materializeYouTube(ctx, row, src, judge, prevText, { startFraction: fraction, tema, ...(anio ? { anio } : {}) });
        if (clip) {
          counts.youtube_momento += 1;
          return save(row, { ...clip, external_id: `${src.external_id}@${fraction}` }, "youtube_momento");
        }
      }
      // 2. Fotos del tema en Commons (hasta 4 por plano, juez en modo tema).
      while (commonsPool.filter((c) => !used.has(key(c))).length < 4 && commonsLoaded < queries.length) {
        const q = queries[commonsLoaded++]!;
        const found = await searchCommonsImages(q).catch(() => [] as VisualCandidate[]);
        for (const c of found) if (!commonsPool.some((p) => key(p) === key(c))) commonsPool.push(c);
      }
      const photos = commonsPool.filter((c) => !used.has(key(c)) && !used.has(c.url)).slice(0, 4);
      if (photos.length) {
        const verdict = await judgeCandidates(
          judge.client,
          judge.model,
          { ...judgeShot, modo: "tema", tema },
          photos,
          judge.workDir,
          judge.usage
        ).catch(() => null);
        const pick = verdict && verdict.chosen !== null ? photos[verdict.chosen] : undefined;
        if (pick && !used.has(key(pick))) {
          counts.commons_tema += 1;
          return save(row, pick, "commons_tema");
        }
      }
      // 3. YouTube con una busqueda del tema (tope por video).
      if (ytTopicLeft > 0 && queries.length) {
        ytTopicLeft -= 1;
        const q = queries[ytTopicLeft % queries.length]!;
        const found = (await searchYouTubeVideos(q).catch(() => [] as VisualCandidate[])).filter((c) => !used.has(key(c)));
        if (found[0]) {
          used.add(key(found[0]));
          const clip = await materializeYouTube(ctx, row, found[0], judge, prevText, { tema, ...(anio ? { anio } : {}) });
          if (clip) {
            counts.youtube_tema += 1;
            ytSources.push(found[0]);
            momentsUsed.set(found[0].external_id, new Set([0.3]));
            return save(row, clip, "youtube_tema");
          }
        }
      }
    }
    // 3b. ULTIMO RECURSO antes del rotulo: stock (solo Pexels), con juez.
    if (judge && row.shot.clase !== "mapa") {
      const stock = await stockCandidates(row.shot.query, Math.max(1, row.end - row.start), [...used], ctx).catch(() => [] as VisualCandidate[]);
      const fresh = stock.filter((c) => !used.has(key(c)) && !used.has(c.url)).slice(0, 3);
      if (fresh.length) {
        const verdict = await judgeCandidates(
          judge.client,
          judge.model,
          judgeShot,
          fresh,
          judge.workDir,
          judge.usage
        ).catch(() => null);
        const pick = verdict && verdict.chosen !== null ? fresh[verdict.chosen] : undefined;
        if (pick && !used.has(key(pick))) {
          counts.stock_ultimo += 1;
          return save(row, pick, "stock_ultimo");
        }
      }
    }
    // 4. Rotulo sobre la textura del estilo (el mapa, si es un plano de mapa,
    // ya va encima como map_marker). Nunca negro ni un plano repetido.
    texture ??= await textureUrl(style, ctx, judge?.workDir ?? (await makeWorkDir("skaler-textura-")));
    await persistShotVisual(
      ctx,
      row,
      { provider: "textura", external_id: `textura-${row.order}`, type: "IMAGE", url: texture, license: "Propia", source_page: "", query: "rotulo" },
      { code: "seguro", reason: "ningun candidato paso el juez: rotulo sobre textura", rejected: [], source: "rotulo" }
    );
    counts.rotulo += 1;
    const o = outcomeOf.get(row.id)!;
    o.source = "fallback";
    o.provider = "textura";
  });
  // Ultima pasada contra los rotulos (MaV, nuncaNiebla): hasta 4 momentos mas
  // de los YouTube ya usados, en puntos lejanos a lo ya usado, siempre con
  // juez y sin pasar el tope de usos ni repetir el video del plano vecino.
  let recovered = 0;
  if (judge) {
    const leftovers = byOrder.filter((r) => outcomeOf.get(r.id)?.provider === "textura" && r.shot.clase !== "mapa");
    for (const row of leftovers) {
      if (recovered >= LAST_PASS_MAX) break;
      const i = byOrder.indexOf(row);
      const near = neighbourOrigins(i);
      const anio = row.shot.anio ?? epochOf.get(row.id);
      const src = ytSources.find((s) => (usesOf.get(`youtube:${s.external_id}`) ?? 0) < YT_MAX_USES && !near.includes(`youtube:${s.external_id}`));
      if (!src) break;
      const seen = momentsUsed.get(src.external_id) ?? new Set<number>();
      momentsUsed.set(src.external_id, seen);
      const fraction = LAST_PASS_FRACTIONS.find((f) => ![...seen].some((u) => Math.abs(u - f) < 0.08));
      if (fraction === undefined) continue;
      seen.add(fraction);
      const clip = await materializeYouTube(ctx, row, src, judge, byOrder[i - 1]?.text, { startFraction: fraction, tema, ...(anio ? { anio } : {}) });
      if (!clip) continue;
      await save(row, { ...clip, external_id: `${src.external_id}@${fraction}` }, "youtube_ultima");
      counts.rotulo -= 1;
      recovered += 1;
    }
  }
  // Frase clave de los rotulos que quedaron (una sola llamada al modelo).
  const textured = byOrder.filter((r) => outcomeOf.get(r.id)?.provider === "textura" && r.shot.clase !== "mapa");
  const withText = await addKeyPhraseOverlays(textured, ctx, judge, toolCtx);
  console.log(`[documental] ${ctx.projectId}: rescate de ${gaps.length} planos -> ${JSON.stringify({ ...counts, ultima_pasada: recovered, rotulos_con_texto: withText })}`);
}

export async function runDocumentalMontaje(ctx: DocumentalContext): Promise<void> {
  const style = getDocumentalStyle(ctx.styleId);
  const toolCtx = { userId: ctx.userId, jobId: ctx.jobId };
  const phrases = buildPhrases([ctx.scriptText], ctx.words);
  if (phrases.length === 0) throw new Error("El guion no tiene frases para armar el documental");

  // 1. Montajista + verificador.
  await reportJobProgress(ctx.jobId, 25, `El montajista está armando los planos (${style.name})...`, { force: true });
  const plan = await directMontaje({ phrases, style, ...(ctx.videoTopic ? { videoTopic: ctx.videoTopic } : {}) });
  console.log(`[documental] ${ctx.projectId}: ${plan.shots.length} planos (${plan.source}), ${plan.issues.length} avisos del verificador`);

  // 2. Planos -> escenas, con sus graficos validados.
  const rows = await writeShotScenes(ctx, phrases, plan);
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
    const overlays = await validatedOverlays(row.shot, row.id, row.text, windowText.get(row.id) ?? row.text, ctx.scriptText, row.shot.capitulo ? chapterTitle.get(row.shot.capitulo) : undefined, toolCtx, row.start);
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
          workDir,
          usage: judgeUsage,
        }
      : null;
  const used = new Set<string>();
  let done = 0;
  const outcomes: ShotOutcome[] = [];
  // QA final: cuadro de cada plano (cache por URL) para medir y para la hoja.
  const frames = new Map<string, string | null>();
  const qaCounts = { oscuros: 0, vacios: 0 };
  let hoja: string | null = null;
  try {
    const idx = new Map(byOrder.map((r, i) => [r.id, i]));
    // Epoca de cada plano: su anio o el ultimo anio dicho en su capitulo.
    const epochOf = new Map<string, number>();
    let lastYear: number | undefined;
    for (const r of byOrder) {
      if (r.shot.capitulo !== undefined) lastYear = undefined;
      if (r.shot.anio) lastYear = r.shot.anio;
      if (lastYear) epochOf.set(r.id, lastYear);
    }
    await mapWithConcurrency(rows, SHOT_CONCURRENCY, async (row) => {
      const i = idx.get(row.id) ?? 0;
      const neighbours = {
        ...(byOrder[i - 1]?.text ? { prevText: byOrder[i - 1]!.text } : {}),
        queries: [byOrder[i - 1]?.shot.query, byOrder[i + 1]?.shot.query].filter((q): q is string => !!q),
        ...(epochOf.has(row.id) ? { epoch: epochOf.get(row.id)! } : {}),
      };
      outcomes.push(await fillShot(ctx, row, style, judge, used, neighbours));
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
    const flagged = await brightnessQa(ctx, byOrder, outcomes, workDir, frames);
    qaCounts.oscuros = flagged.oscuros;
    qaCounts.vacios = flagged.vacios;
    await reportJobProgress(ctx.jobId, 88, "Rescatando los planos sin material (otros momentos, fotos del tema)...", { force: true });
    await rescueGaps(ctx, byOrder, outcomes, style, used, judge, toolCtx);
    await reportJobProgress(ctx.jobId, 89, "Armando la hoja de contactos...", { force: true });
    hoja = await buildContactSheet(ctx, byOrder, outcomes, workDir, frames).catch((err) => {
      console.warn(`[documental] no se pudo armar la hoja de contactos: ${(err as Error).message}`);
      return null;
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  // 5. Plan guardado para la revision y la auditoria.
  const summary = {
    style: style.id,
    source: plan.source,
    chapters: plan.chapters,
    issues: plan.issues,
    usage: { montaje: plan.usage, juez: judgeUsage },
    shots: outcomes.sort((a, b) => a.order - b.order),
    qa: { hoja, ...qaCounts },
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("video_projects").update({ documental_plan: summary, video_style: style.id }).eq("id", ctx.projectId);
  if (error) console.warn(`[documental] no se pudo guardar el plan (¿se corrio la migracion 20261112000000?): ${error.message}`);
}
