import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getActiveProvider } from "../lib/providers.js";
import { callTool, type Usage } from "./director.js";
import type { Phrase } from "./phrases.js";
import { plannableTypes, TYPE_GUIDE } from "../tools/planOverlays.tool.js";
import { SHOT_CLASSES, type DocumentalStyle, type MusicMood, type ShotClass } from "../lib/documentalStyles.js";

// MONTAJISTA del formato documental (hub and spoke, como documentalDirector):
// - El DIRECTOR (Opus, 1 llamada) lee el guion partido en frases con su tiempo
//   y entrega el plan de planos: que se ve en cada momento (clase + sujeto +
//   busqueda), los graficos con texto literal y los capitulos.
// - El VERIFICADOR es codigo: cobertura sin huecos, duracion por clase,
//   presupuesto de graficos y rotulos coherentes. No vuelve al LLM: repara
//   (mas barato y sin rondas que oscilen, ver INFORME-agentes-e-iteracion.md).
// Los spokes (buscadores por clase) y el juez visual corren despues, desde el
// orquestador. Modelo configurable en provider "anthropic":
// configuration.montaje_model.

const DEFAULT_MODEL = "claude-opus-5-5";
// ~120 planos en un video de 10 min: el plan es largo (streaming).
const MAX_TOKENS = 48000;
const ROTULO_TYPES = ["lower_third", "person_card", "milestone", "badge"];
// Grafico que no entra en el presupuesto -> rotulo con el mismo dato.
const ROTULO_FROM_GRAPHIC: Record<string, string> = { big_number: "milestone", number_phrase: "milestone", timeline: "milestone" };
const MAP_TYPES = ["map_marker", "map_globe", "map_route"];
const MAP_MIN_GAP = 35;
const MUSIC_MOODS: MusicMood[] = ["documental", "tension", "triste", "epico", "misterio", "esperanza"];

export interface ShotGraphic {
  type: string;
  text: string;
  label?: string;
  items?: { label: string; text: string }[];
  icon?: string;
  geo?: { lat: number; lon: number };
}

export interface PlannedShot {
  // Indices de frase (0-based, inclusivos).
  from: number;
  to: number;
  clase: ShotClass;
  sujeto: string;
  query: string;
  entidad?: string;
  anio?: number;
  lugar?: { nombre: string; lat: number; lon: number };
  grafico?: ShotGraphic;
  rotulo?: ShotGraphic;
  // Numero de capitulo (1..n) si el plano abre un capitulo.
  capitulo?: number;
  // Parte de un plano largo que se partio (para no repetir el mismo visual).
  parte?: number;
}

export interface MontajeChapter {
  titulo: string;
  desde: number;
  animo: MusicMood;
}

export interface MontajePlan {
  shots: PlannedShot[];
  chapters: MontajeChapter[];
  issues: string[];
  source: "montajista" | "heuristic";
  usage: Usage;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function skillText(): string {
  // dist/director -> ../../skills ; src/director -> ../../skills
  for (const candidate of [path.join(here, "../../skills/montaje-documental/SKILL.md"), path.join(process.cwd(), "skills/montaje-documental/SKILL.md")]) {
    try {
      return readFileSync(candidate, "utf-8").replace(/^---[\s\S]*?---\s*/, "");
    } catch {
      // siguiente
    }
  }
  return "";
}

function allowedGraphicTypes(style: DocumentalStyle): string[] {
  return plannableTypes().filter((t) => !style.graphics.forbid.includes(t) && t !== "nav_header" && t !== "title_card");
}

function systemPrompt(style: DocumentalStyle): string {
  const types = allowedGraphicTypes(style);
  const guide = types.map((t) => `- ${t}: ${TYPE_GUIDE[t as keyof typeof TYPE_GUIDE] ?? ""}`).join("\n");
  const d = style.plan.durations;
  return `${skillText()}

## Estilo de este video: ${style.name}
${style.description}
- Duraciones (segundos): persona ${d.persona.join("-")}, lugar ${d.lugar.join("-")}, cosa ${d.cosa.join("-")}, metraje ${d.metraje.join("-")}, ambiente ${d.ambiente.join("-")}, mapa ${d.mapa.join("-")}, grafico ${d.grafico.join("-")}.
- Clases preferidas, en orden: ${style.plan.prefer.join(", ")}.
- "ambiente" como mucho en el ${Math.round(MAX_AMBIENT_SHARE * 100)}% de los planos: es el ultimo recurso (va a stock generico). Si la frase habla de algo que se puede mostrar, es persona, cosa, lugar o metraje.
- Graficos: como mucho ${style.plan.graphicsPerMinute} por minuto (${style.plan.graphicsPerMinuteHook} en el primer minuto), nunca mas del ${Math.round(style.plan.maxGraphicShare * 100)}% del tiempo, separados al menos ${style.plan.minGraphicGapSeconds} s. Apunta a acercarte a ese limite: cada cifra, fecha, nombre propio, lugar o comparacion del guion es candidata a grafico (big_number, milestone, map_marker, person_card, versus...).
- Graficos favoritos de este estilo: ${style.graphics.favor.join(", ")}.
${style.sources.archiveFirst ? `- Prioriza material de archivo${style.sources.epochHint ? ` (${style.sources.epochHint})` : ""}: pon siempre \`anio\` cuando sea historico.\n` : ""}
## Graficos disponibles (campo grafico.type)
${guide}

Entrega UNA sola vez con submit_shot_plan. Los planos van en orden, sin huecos, y cubren de la primera a la ultima frase.`;
}

const graphicSchema = {
  type: "object",
  properties: {
    type: { type: "string" },
    text: { type: "string", description: "Texto principal, copiado LITERAL de la frase" },
    label: { type: "string" },
    items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, text: { type: "string" } }, required: ["label", "text"] } },
    icon: { type: "string" },
    geo: { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] },
  },
  required: ["type", "text"],
};

const PLAN_TOOL: Anthropic.Tool = {
  name: "submit_shot_plan",
  description: "Entrega el plan de planos del documental.",
  input_schema: {
    type: "object",
    properties: {
      chapters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            desde: { type: "string", description: "Id de la frase donde arranca (p1, p2...)" },
            animo: { type: "string", enum: MUSIC_MOODS },
          },
          required: ["titulo", "desde", "animo"],
        },
      },
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            desde: { type: "string", description: "Id de la primera frase (p1...)" },
            hasta: { type: "string", description: "Id de la ultima frase (inclusive)" },
            clase: { type: "string", enum: SHOT_CLASSES },
            sujeto: { type: "string", description: "Que se ve, en castellano" },
            query_en: { type: "string", description: "Busqueda en ingles, 2-6 palabras" },
            entidad: { type: "string", description: "Nombre propio exacto (persona/cosa/lugar) como en Wikipedia" },
            anio: { type: "number" },
            lugar: { type: "object", properties: { nombre: { type: "string" }, lat: { type: "number" }, lon: { type: "number" } }, required: ["nombre", "lat", "lon"] },
            grafico: graphicSchema,
            rotulo: graphicSchema,
          },
          required: ["desde", "hasta", "clase", "sujeto", "query_en"],
        },
      },
    },
    required: ["chapters", "shots"],
  } as Anthropic.Tool.InputSchema,
};

function phraseIndex(id: unknown, total: number): number | null {
  const n = typeof id === "string" ? Number(id.replace(/^p/i, "")) : typeof id === "number" ? id : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(total - 1, Math.max(0, Math.round(n) - 1));
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function graphicOf(raw: unknown): ShotGraphic | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const type = str(r.type);
  const text = str(r.text);
  if (!type || !text) return undefined;
  const items = Array.isArray(r.items)
    ? (r.items as Record<string, unknown>[]).map((i) => ({ label: str(i.label), text: str(i.text) })).filter((i) => i.text)
    : undefined;
  const geo = r.geo as { lat?: unknown; lon?: unknown } | undefined;
  return {
    type,
    text,
    ...(str(r.label) ? { label: str(r.label) } : {}),
    ...(items?.length ? { items } : {}),
    ...(str(r.icon) ? { icon: str(r.icon) } : {}),
    ...(geo && typeof geo.lat === "number" && typeof geo.lon === "number" ? { geo: { lat: geo.lat, lon: geo.lon } } : {}),
  };
}

export function parsePlan(raw: Record<string, unknown> | undefined, phrases: Phrase[]): { shots: PlannedShot[]; chapters: MontajeChapter[] } {
  const total = phrases.length;
  const shots: PlannedShot[] = [];
  for (const item of (raw?.shots as Record<string, unknown>[] | undefined) ?? []) {
    const from = phraseIndex(item.desde, total);
    const to = phraseIndex(item.hasta ?? item.desde, total);
    if (from === null || to === null) continue;
    const clase = (SHOT_CLASSES as string[]).includes(str(item.clase)) ? (str(item.clase) as ShotClass) : "ambiente";
    const lugarRaw = item.lugar as { nombre?: unknown; lat?: unknown; lon?: unknown } | undefined;
    const anio = typeof item.anio === "number" && item.anio > 0 && item.anio < 3000 ? Math.round(item.anio) : undefined;
    let grafico = graphicOf(item.grafico);
    let rotulo = graphicOf(item.rotulo);
    // Fechas de esquina y nombres son rotulos: no gastan el presupuesto de graficos.
    if (grafico && ROTULO_TYPES.includes(grafico.type)) {
      rotulo ??= grafico;
      grafico = undefined;
    }
    shots.push({
      from: Math.min(from, to),
      to: Math.max(from, to),
      clase,
      sujeto: str(item.sujeto),
      query: str(item.query_en) || str(item.sujeto),
      ...(str(item.entidad) ? { entidad: str(item.entidad) } : {}),
      ...(anio ? { anio } : {}),
      ...(lugarRaw && typeof lugarRaw.lat === "number" && typeof lugarRaw.lon === "number"
        ? { lugar: { nombre: str(lugarRaw.nombre), lat: lugarRaw.lat, lon: lugarRaw.lon } }
        : {}),
      ...(grafico ? { grafico } : {}),
      ...(rotulo ? { rotulo } : {}),
    });
  }
  const chapters: MontajeChapter[] = [];
  for (const item of (raw?.chapters as Record<string, unknown>[] | undefined) ?? []) {
    const desde = phraseIndex(item.desde, total);
    const titulo = str(item.titulo);
    if (desde === null || !titulo) continue;
    const animo = (MUSIC_MOODS as string[]).includes(str(item.animo)) ? (str(item.animo) as MusicMood) : "documental";
    chapters.push({ titulo, desde, animo });
  }
  return { shots, chapters };
}

// ---------- Verificador (codigo) ----------

function norm(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

export function textOf(phrases: Phrase[], shot: Pick<PlannedShot, "from" | "to">): string {
  return norm(phrases.slice(shot.from, shot.to + 1).map((p) => p.text).join(" "));
}

function shotStart(shot: PlannedShot, phrases: Phrase[]): number {
  return phrases[shot.from]!.start;
}

// Un plano dura hasta que arranca el siguiente (asi lo arma build_timeline).
function shotEnd(shots: PlannedShot[], i: number, phrases: Phrase[]): number {
  const next = shots[i + 1];
  return next ? phrases[next.from]!.start : phrases[shots[i]!.to]!.end;
}

function durationOf(shots: PlannedShot[], i: number, phrases: Phrase[]): number {
  return Math.max(0, shotEnd(shots, i, phrases) - shotStart(shots[i]!, phrases));
}

function rangeFor(style: DocumentalStyle, clase: ShotClass): [number, number] {
  return style.plan.durations[clase] ?? style.plan.durations.normal;
}

export function verifyPlan(
  input: { shots: PlannedShot[]; chapters: MontajeChapter[] },
  phrases: Phrase[],
  style: DocumentalStyle
): { shots: PlannedShot[]; chapters: MontajeChapter[]; issues: string[] } {
  const issues: string[] = [];
  const total = phrases.length;
  if (total === 0) return { shots: [], chapters: [], issues: ["sin frases"] };

  // 1. Orden y cobertura: sin huecos ni solapes, de la primera a la ultima frase.
  let shots = [...input.shots].sort((a, b) => a.from - b.from || a.to - b.to);
  const covered: PlannedShot[] = [];
  for (const shot of shots) {
    const prev = covered[covered.length - 1];
    const from = prev ? prev.to + 1 : 0;
    if (shot.to < from) {
      issues.push(`plano p${shot.from + 1}-p${shot.to + 1} solapado: descartado`);
      continue;
    }
    if (shot.from > from) {
      if (prev) prev.to = shot.from - 1;
      else issues.push(`el plan arrancaba en p${shot.from + 1}: se extiende al inicio`);
    }
    covered.push({ ...shot, from: prev ? prev.to + 1 : 0 });
  }
  if (covered.length === 0) {
    covered.push({ from: 0, to: total - 1, clase: "ambiente", sujeto: "", query: "" });
    issues.push("plan vacio");
  }
  const last = covered[covered.length - 1]!;
  if (last.to < total - 1) {
    issues.push(`el plan terminaba en p${last.to + 1}: se extiende al final`);
    last.to = total - 1;
  }
  shots = covered;

  // 2. Planos demasiado largos: se parten en limites de frase.
  const split: PlannedShot[] = [];
  shots.forEach((shot, i) => {
    const [, max] = rangeFor(style, shot.clase);
    if (durationOf(shots, i, phrases) <= max * 1.15 || shot.from === shot.to) {
      split.push(shot);
      return;
    }
    let part = 0;
    let start = shot.from;
    for (let p = shot.from; p <= shot.to; p++) {
      const endTime = p === shot.to ? shotEnd(shots, i, phrases) : phrases[p + 1]!.start;
      const long = endTime - phrases[start]!.start;
      if (long >= max * 0.8 || p === shot.to) {
        const piece: PlannedShot = { ...shot, from: start, to: p, parte: part };
        if (part > 0) delete piece.capitulo;
        split.push(piece);
        part += 1;
        start = p + 1;
      }
    }
    // El grafico y el rotulo quedan solo en el tramo donde se dice su texto.
    const pieces = split.slice(split.length - part);
    for (const key of ["grafico", "rotulo"] as const) {
      const spec = shot[key];
      if (!spec) continue;
      const holder = pieces.find((piece) => textOf(phrases, piece).includes(norm(spec.text))) ?? pieces[0]!;
      for (const piece of pieces) if (piece !== holder) delete piece[key];
    }
    issues.push(`plano largo p${shot.from + 1}-p${shot.to + 1} partido en ${part}`);
  });
  shots = split;

  // 3. Planos demasiado cortos: se unen al vecino (nunca dos graficos juntos).
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    const [min] = rangeFor(style, shot.clase);
    if (shots.length === 1 || durationOf(shots, i, phrases) >= min * 0.7) continue;
    const prev = shots[i - 1];
    const next = shots[i + 1];
    const target = prev && !(prev.grafico && shot.grafico) ? prev : next;
    if (!target) continue;
    if (target === prev) prev!.to = shot.to;
    else {
      next!.from = shot.from;
      if (!next!.grafico && shot.grafico) next!.grafico = shot.grafico;
    }
    if (!target.rotulo && shot.rotulo) target.rotulo = shot.rotulo;
    if (!target.grafico && shot.grafico) target.grafico = shot.grafico;
    if (shot.capitulo !== undefined && target.capitulo === undefined) target.capitulo = shot.capitulo;
    shots.splice(i, 1);
    i -= 1;
  }

  // 4. Graficos: tipos validos, nunca dos seguidos, presupuesto por minuto,
  // porcentaje del tiempo y separacion. Lo que no entra se saca.
  const allowed = new Set(allowedGraphicTypes(style));
  const totalTime = phrases[total - 1]!.end - phrases[0]!.start || 1;
  const accepted: { start: number; end: number }[] = [];
  let graphicTime = 0;
  let lastMapAt = -Infinity;
  shots.forEach((shot, i) => {
    if (!shot.grafico) {
      if (shot.clase === "grafico") shot.clase = "ambiente";
      return;
    }
    const start = shotStart(shot, phrases);
    const end = shotEnd(shots, i, phrases);
    const prevGraphic = i > 0 && shots[i - 1]!.grafico;
    const lastAccepted = accepted[accepted.length - 1];
    const limit = start < 60 ? style.plan.graphicsPerMinuteHook : style.plan.graphicsPerMinute;
    const inWindow = accepted.filter((g) => g.start > start - 60).length;
    const reason = !allowed.has(shot.grafico.type)
      ? `tipo ${shot.grafico.type} no permitido`
      : prevGraphic
        ? "dos graficos seguidos"
        : lastAccepted && start - lastAccepted.end < style.plan.minGraphicGapSeconds
          ? "muy cerca del anterior"
          : inWindow >= limit
            ? "supera el presupuesto por minuto"
            : (graphicTime + (end - start)) / totalTime > style.plan.maxGraphicShare
              ? "supera el % de graficos"
              : null;
    if (reason) {
      // MaV (rotuloDeGrafico): el dato que no entra en el presupuesto no se
      // pierde, pasa a rotulo sobre el plano si el plano no tiene uno.
      const asRotulo = !shot.rotulo && ROTULO_FROM_GRAPHIC[shot.grafico.type];
      if (asRotulo && reason !== `tipo ${shot.grafico.type} no permitido`) {
        shot.rotulo = { ...shot.grafico, type: asRotulo } as typeof shot.grafico;
        issues.push(`grafico ${shot.grafico.type} en p${shot.from + 1} pasa a rotulo ${asRotulo}: ${reason}`);
      } else {
        issues.push(`grafico ${shot.grafico.type} en p${shot.from + 1} descartado: ${reason}`);
      }
      delete shot.grafico;
      if (shot.clase === "grafico") shot.clase = "ambiente";
      return;
    }
    // Mapas: como mucho uno cada 35 s (MaV).
    if (MAP_TYPES.includes(shot.grafico.type)) {
      if (start - lastMapAt < MAP_MIN_GAP) {
        issues.push(`grafico ${shot.grafico.type} en p${shot.from + 1} descartado: otro mapa hace menos de ${MAP_MIN_GAP} s`);
        delete shot.grafico;
        if (shot.clase === "grafico") shot.clase = "ambiente";
        return;
      }
      lastMapAt = start;
    }
    // El grafico va ENCIMA del plano: el plano conserva su clase (que se busca
    // debajo). Solo si el montajista no dio ninguna, va sobre un ambiente.
    if (shot.clase === "grafico") shot.clase = "ambiente";
    accepted.push({ start, end });
    graphicTime += end - start;
  });

  // 5. Rotulos: el nombre solo sobre la foto de esa persona; fechas en cualquier plano.
  for (const shot of shots) {
    if (!shot.rotulo) continue;
    const t = shot.rotulo.type;
    if ((t === "lower_third" || t === "person_card") && shot.clase !== "persona") {
      issues.push(`rotulo ${t} fuera de un plano de persona (p${shot.from + 1}): descartado`);
      delete shot.rotulo;
    } else if (!ROTULO_TYPES.includes(t)) {
      delete shot.rotulo;
    }
  }

  // 6. Capitulos: ordenados, sin repetir y anclados al plano que los contiene.
  const chapters = [...input.chapters]
    .sort((a, b) => a.desde - b.desde)
    .filter((c, i, arr) => i === 0 || c.desde !== arr[i - 1]!.desde);
  chapters.forEach((chapter, index) => {
    const shot = shots.find((s) => s.from <= chapter.desde && chapter.desde <= s.to);
    if (shot && shot.capitulo === undefined) shot.capitulo = index + 1;
  });

  return { shots, chapters, issues };
}

// Respaldo sin LLM: planos de ~5 s de ambiente. Solo para no perder el video.
export function heuristicPlan(phrases: Phrase[], topic: string): { shots: PlannedShot[]; chapters: MontajeChapter[] } {
  const shots: PlannedShot[] = [];
  let start = 0;
  phrases.forEach((phrase, i) => {
    const long = phrase.end - phrases[start]!.start;
    if (long >= 5 || i === phrases.length - 1) {
      shots.push({ from: start, to: i, clase: "ambiente", sujeto: topic, query: topic });
      start = i + 1;
    }
  });
  return { shots, chapters: phrases.length ? [{ titulo: topic, desde: 0, animo: "documental" }] : [] };
}

// Tope de planos "ambiente" (stock generico). En la prueba del Titanic el
// montajista llego a 49% y casi todo el video salio de Pexels.
const MAX_AMBIENT_SHARE = 0.2;

function ambientShare(shots: { clase: string }[]): number {
  return shots.length ? shots.filter((s) => s.clase === "ambiente").length / shots.length : 0;
}

export async function directMontaje(input: {
  phrases: Phrase[];
  style: DocumentalStyle;
  videoTopic?: string;
}): Promise<MontajePlan> {
  const { phrases, style } = input;
  const topic = input.videoTopic ?? "";
  const usage: Usage = {};
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key) {
    const verified = verifyPlan(heuristicPlan(phrases, topic), phrases, style);
    return { ...verified, source: "heuristic", usage, issues: ["sin provider anthropic: plan heuristico", ...verified.issues] };
  }
  const model = (provider.configuration?.montaje_model as string | undefined) ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: provider.api_key });
  const user = `Tema del video: ${topic || "(sin titulo)"}

Guion en frases numeradas con su tiempo (segundos):
${phrases.map((p) => `${p.id} [${p.start.toFixed(1)}-${p.end.toFixed(1)}] ${p.text}`).join("\n")}`;
  try {
    const raw = await callTool(client, model, MAX_TOKENS, systemPrompt(style), PLAN_TOOL, user, usage);
    const parsed = parsePlan(raw, phrases);
    if (parsed.shots.length === 0) throw new Error("el montajista no devolvio planos");
    let verified = verifyPlan(parsed, phrases, style);
    // Demasiado "ambiente" = demasiado stock generico: UNA correccion.
    const share = ambientShare(verified.shots);
    if (share > MAX_AMBIENT_SHARE) {
      const fix = `${user}\n\nTu plan anterior puso el ${Math.round(share * 100)}% de los planos como "ambiente" (maximo ${Math.round(MAX_AMBIENT_SHARE * 100)}%). Rehacelo: todo lo que nombra o describe algo mostrable (el barco, la gente, un lugar, un hecho filmado) va como persona, cosa, lugar o metraje. Ambiente solo para transiciones e ideas abstractas.`;
      try {
        const retry = parsePlan(await callTool(client, model, MAX_TOKENS, systemPrompt(style), PLAN_TOOL, fix, usage), phrases);
        if (retry.shots.length > 0) {
          const second = verifyPlan(retry, phrases, style);
          if (ambientShare(second.shots) < share) verified = second;
        }
      } catch (err) {
        console.warn("[montajista] la correccion de ambiente fallo, sigo con el primer plan:", err);
      }
      verified.issues.push(`ambiente ${Math.round(share * 100)}% en el primer plan -> ${Math.round(ambientShare(verified.shots) * 100)}% tras la correccion`);
    }
    return { ...verified, source: "montajista", usage };
  } catch (err) {
    console.warn("[montajista] fallo, sigo con el plan heuristico:", err);
    const verified = verifyPlan(heuristicPlan(phrases, topic), phrases, style);
    return { ...verified, source: "heuristic", usage, issues: [`montajista fallo: ${(err as Error).message}`, ...verified.issues] };
  }
}
