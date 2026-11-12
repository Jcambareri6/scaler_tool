import Anthropic from "@anthropic-ai/sdk";
import { rm } from "node:fs/promises";
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
  searchArchiveVideos,
  searchCommonsImages,
  searchOpenverseImages,
  searchWikidataImage,
  sourceChain,
  type SourceName,
  type VisualCandidate,
} from "../lib/documentalSources.js";
import { getDocumentalStyle, type DocumentalStyle } from "../lib/documentalStyles.js";
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
const MAX_JUDGE_ROUNDS = envInt("DOCUMENTAL_JUDGE_ROUNDS", 3);

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
  fullText: string,
  chapterTitle: string | undefined,
  toolCtx: { userId: string; jobId: string }
): Promise<OverlaySpec[]> {
  const wanted: OverlaySpec[] = [];
  if (chapterTitle) wanted.push({ type: "title_card", text: chapterTitle, source: "script" });
  if (shot.grafico) wanted.push(toSpec(shot.grafico));
  if (shot.clase === "mapa" && shot.lugar && !shot.grafico) {
    wanted.push({ type: "map_marker", text: shot.lugar.nombre, source: "script", geo: { lat: shot.lugar.lat, lon: shot.lugar.lon } });
  }
  if (shot.rotulo) wanted.push(toSpec(shot.rotulo));
  const valid: OverlaySpec[] = [];
  for (const planned of wanted) {
    try {
      const { overlay } = await runTool<GenerateOverlayInput, GenerateOverlayOutput>(
        "generate_overlay",
        { scene_id: sceneId, script_text: sceneText, full_text: fullText, overlay: planned },
        toolCtx
      );
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
  return result.candidates.slice(0, 4).map((c) => ({
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
    case "commons":
      return searchCommonsImages(shot.entidad ?? shot.query);
    case "openverse":
      return searchOpenverseImages(shot.query);
    case "archive":
      return searchArchiveVideos(shot.query, shot.anio);
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
      qa: { code: qa.code, ...(qa.reason ? { reason: qa.reason } : {}), source: qa.source, rejected: qa.rejected.slice(0, 8) },
    },
  });
  if (error) throw new Error(error.message);
}

// Llena UN plano: recorre la cadena de fuentes de su clase; en cada fuente
// el juez elige entre candidatos nuevos. Sin juez (sin provider), el primero.
async function fillShot(
  ctx: DocumentalContext,
  row: ShotRow,
  style: DocumentalStyle,
  judge: { client: Anthropic; model: string; workDir: string; usage: Record<string, number> } | null,
  used: Set<string>
): Promise<ShotOutcome> {
  const shot = row.shot;
  const minDuration = Math.max(1, row.end - row.start);
  const chain = sourceChain({ clase: shot.clase, query: shot.query, ...(shot.entidad ? { entidad: shot.entidad } : {}), ...(shot.anio ? { anio: shot.anio } : {}) }, style.sources.archiveFirst);
  const rejected: CandidateVerdict[] = [];
  let rounds = 0;
  let fallback: { candidate: VisualCandidate; source: SourceName } | null = null;
  const key = (c: VisualCandidate) => `${c.provider}:${c.external_id}`;

  for (const source of chain) {
    if (rounds >= MAX_JUDGE_ROUNDS) break;
    let found: VisualCandidate[] = [];
    try {
      found = (await sourceCandidates(source, shot, minDuration, [...used], style, ctx)).filter((c) => !used.has(key(c)) && !used.has(c.url));
    } catch (err) {
      console.warn(`[documental] plano ${row.order}: fuente ${source} fallo: ${(err as Error).message}`);
      continue;
    }
    if (found.length === 0) continue;
    // Los videos de stock son el plano seguro si nada pasa el juez.
    if (!fallback && source === "stock") fallback = { candidate: found[0]!, source };
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
      { frase: row.text, clase: shot.clase, sujeto: shot.sujeto, ...(shot.anio ? { anio: shot.anio } : {}) },
      found,
      judge.workDir,
      judge.usage
    ).catch((err) => {
      console.warn(`[documental] plano ${row.order}: el juez fallo: ${(err as Error).message}`);
      return null;
    });
    if (verdict && verdict.chosen !== null) {
      const pick = found[verdict.chosen]!;
      // Doble chequeo sincronico (planos en paralelo): si otro plano ya lo tomo, sigue.
      if (!used.has(key(pick)) && !used.has(pick.url)) {
        used.add(key(pick));
        used.add(pick.url);
        const reason = verdict.verdicts.find((v) => v.index === verdict.chosen)?.reason;
        await persistShotVisual(ctx, row, pick, { code: "ok", ...(reason ? { reason } : {}), rejected, source });
        return { sceneId: row.id, order: row.order, source, qa: "ok", provider: pick.provider, rejected: rejected.length };
      }
    }
    for (const v of verdict?.verdicts ?? []) rejected.push({ ...v, reason: `${source}/${found[v.index]?.provider}: ${v.reason}` });
  }

  // Plano seguro: stock de ambiente acorde, o imagen IA si no hay stock.
  try {
    if (!fallback) {
      const ambient = await stockCandidates(`${shot.query}`.split(" ").slice(0, 2).join(" ") || (ctx.videoTopic ?? "documentary"), minDuration, [...used], ctx).catch(() => []);
      const free = ambient.find((c) => !used.has(key(c)));
      if (free) fallback = { candidate: free, source: "stock" };
    }
    if (!fallback) {
      const ai = await aiImageCandidate(shot, style, ctx).catch(() => null);
      if (ai) fallback = { candidate: ai, source: "ai_image" };
    }
  } catch {
    // sin respaldo
  }
  if (fallback) {
    used.add(key(fallback.candidate));
    used.add(fallback.candidate.url);
    await persistShotVisual(ctx, row, fallback.candidate, { code: "seguro", reason: "ningun candidato paso el juez", rejected, source: fallback.source });
    return { sceneId: row.id, order: row.order, source: "fallback", qa: "seguro", provider: fallback.candidate.provider, rejected: rejected.length };
  }
  console.warn(`[documental] plano ${row.order}: sin ningun visual`);
  return { sceneId: row.id, order: row.order, source: "none", qa: "seguro", rejected: rejected.length };
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
  const chapterTitle = new Map(plan.chapters.map((c, i) => [i + 1, c.titulo]));
  await mapWithConcurrency(rows, 6, async (row) => {
    const overlays = await validatedOverlays(row.shot, row.id, row.text, ctx.scriptText, row.shot.capitulo ? chapterTitle.get(row.shot.capitulo) : undefined, toolCtx);
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
  try {
    await mapWithConcurrency(rows, SHOT_CONCURRENCY, async (row) => {
      outcomes.push(await fillShot(ctx, row, style, judge, used));
      done += 1;
      await reportJobProgress(
        ctx.jobId,
        30 + Math.round((done / rows.length) * 58),
        `Buscando material de archivo y eligiendo con el juez (plano ${done}/${rows.length})...`,
        { force: done === rows.length }
      );
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
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("video_projects").update({ documental_plan: summary, video_style: style.id }).eq("id", ctx.projectId);
  if (error) console.warn(`[documental] no se pudo guardar el plan (¿se corrio la migracion 20261112000000?): ${error.message}`);
}
