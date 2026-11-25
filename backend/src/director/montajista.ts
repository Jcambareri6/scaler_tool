import { INDICATORS } from "../lib/datosAbiertos.js";
import { yearOf } from "../lib/epoca.js";
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

// Sonnet 5.5 (antes Opus): la mitad del costo del plan; el plan lo validan
// el verificador y las reglas en codigo (cobertura, anio, busquedas abstractas).
const DEFAULT_MODEL = "claude-sonnet-5-5";
// ~120 planos en un video de 10 min: el plan es largo (streaming).
const MAX_TOKENS = 48000;
const ROTULO_TYPES = ["lower_third", "person_card", "milestone", "badge"];
// Grafico que no entra en el presupuesto -> rotulo con el mismo dato.
const ROTULO_FROM_GRAPHIC: Record<string, string> = { big_number: "milestone", number_phrase: "milestone", timeline: "milestone" };
const MAP_TYPES = ["map_marker", "map_globe", "map_route"];
const MAP_MIN_GAP = 35;
// Planos de clase mapa: uno cada 45 s como mucho y nunca dos seguidos (ver 4b).
const MAP_SHOT_MIN_GAP = 45;
const MUSIC_MOODS: MusicMood[] = ["documental", "tension", "triste", "epico", "misterio", "esperanza"];

export interface ShotGraphic {
  type: string;
  text: string;
  label?: string;
  items?: { label: string; text: string }[];
  icon?: string;
  geo?: { lat: number; lon: number; km?: number };
}

export interface PlannedShot {
  // Indices de frase (0-based, inclusivos).
  from: number;
  to: number;
  clase: ShotClass;
  sujeto: string;
  query: string;
  entidad?: string;
  // Lo que la frase nombra y TIENE que verse (MaV: obligatorio). Va al juez.
  obligatorio?: string[];
  anio?: number;
  lugar?: { nombre: string; lat: number; lon: number; km?: number };
  grafico?: ShotGraphic;
  rotulo?: ShotGraphic;
  // Numero de capitulo (1..n) si el plano abre un capitulo.
  capitulo?: number;
  // Parte de un plano largo que se partio (para no repetir el mismo visual).
  parte?: number;
  // Grafico con datos reales del Banco Mundial (lib/datosAbiertos.ts).
  datos?: ShotData;
  // 1-2 busquedas de RESPALDO (MaV: fuente + respaldo[]): otro angulo filmable
  // de la misma frase. Se prueban antes del rescate.
  respaldo?: string[];
  // Busqueda para YouTube en el idioma del LUGAR de la historia (un tema de
  // Mexico tiene mucho mas metraje en castellano: "bajada La Rumorosa").
  queryLocal?: string;
  // De que habla ESE tramo del guion (las 4-5 frases de alrededor), en pocas
  // palabras ("Mesosaurus", "formacion del Rio de la Plata"). Lo usa el rescate
  // para buscar de nuevo y para el juez (en vez del tema general del video).
  temaBloque?: string;
  // Titulo del articulo de Wikipedia (es o en) que mejor ilustra ese tramo: el
  // rescate saca de ahi ilustraciones, diagramas, fosiles, retratos...
  articulo?: string;
}

export interface ShotData {
  tipo: "serie" | "piramide";
  // Alias de la tabla (fertilidad, pib...) o codigo del Banco Mundial.
  indicador?: string;
  // ISO3 del pais.
  pais: string;
  desde?: number;
  hasta?: number;
  anios?: number[];
  titulo?: string;
}

export interface MontajeChapter {
  titulo: string;
  desde: number;
  animo: MusicMood;
}

export interface MontajePlan {
  shots: PlannedShot[];
  chapters: MontajeChapter[];
  // Unidades del plan (palabras): from/to de los planos son indices aca.
  units: Phrase[];
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

// Datos reales (como directorV2 de MaV): el modelo elige indicador y pais; el
// codigo trae las cifras. Sin datos, el grafico se quita.
const DATA_GUIDE = `
## Datos reales (campo datos, opcional)
Cuando el guion habla de la evolucion de un PAIS (poblacion, economia, natalidad...) y una cifra real lo cuenta mejor que un rotulo, pone "datos" en ese plano en vez de "grafico". Las cifras las trae el sistema del Banco Mundial: vos solo elegis que mostrar.
- tipo "serie": una linea en el tiempo. indicador = uno de estos alias: ${Object.keys(INDICATORS).join(", ")}. desde/hasta = anios (1960-2050).
- tipo "piramide": piramide de poblacion por edad y sexo. anios = 2-4 anios (ej. 1960, 2024, 2050). El plano dura 8-10 s.
- pais = codigo ISO3. Solo paises: una ciudad, un estado o una costa no tienen datos (no pongas datos).
- Como mucho 2 por video y nunca dos seguidos.
`;

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
- MINIMO 2 graficos por minuto en todo el video (no solo al principio): un documental sin animaciones aburre. Ademas de cifras y fechas, usa los que leen IDEAS: highlight_phrase para cada remate o revelacion, checklist o side_panel cuando el guion enumera, process_wave para causa y efecto, photo_tree para de que esta hecho algo, dossier para presentar a quien investigo o conto la historia. Varia los tipos: no repitas el mismo tipo dos veces seguidas.
- Graficos favoritos de este estilo: ${style.graphics.favor.join(", ")}.
${style.sources.archiveFirst ? `- Prioriza material de archivo${style.sources.epochHint ? ` (${style.sources.epochHint})` : ""}: pon siempre \`anio\` cuando sea historico.\n` : ""}
## Graficos disponibles (campo grafico.type)
${guide}
${style.graphics.favor.includes("line_chart") ? DATA_GUIDE : ""}

- query_en y respaldo_en describen algo que se puede FOTOGRAFIAR o FILMAR: un lugar, una persona, un objeto, una accion, gente de la epoca. NUNCA una estadistica ("accidents per year"), una linea de tiempo ("history timeline"), un concepto, un llamado a comentar ("comment call to action") ni una leyenda como tal ("woman in white legend"). Si la frase da una cifra o una fecha, la cifra va en el grafico y la imagen muestra el lugar u objeto del que habla (170 accidentes en la cuesta -> "Rumorosa highway trucks"). Una leyenda: el lugar real donde se cuenta. El cierre o el llamado a comentar: el lugar o el objeto principal del video.
- query_local: la busqueda para YouTube en el idioma del LUGAR de la historia (castellano para Mexico: "bajada de La Rumorosa camiones"); la gente que filma un lugar lo titula en su idioma. Vacio si el lugar habla ingles.
- respaldo_en: 1 o 2 busquedas en ingles de RESPALDO con otro angulo de la misma frase que tambien se pueda mostrar (persona -> "Esteban Cantu Baja California governor", el lugar donde actuo; edificio -> el pueblo o el paisaje donde esta). Se usan si la busqueda principal no trae nada que sirva.
- anio: SOLO si la imagen TIENE que ser de esa epoca (una persona de 1915, un edificio recien construido en 1923, un hecho historico). Si la frase habla de un nombre, un origen, un paisaje o es una transicion ("por eso los primeros viajeros bautizaron este tramo como..."), muestra el lugar o la cosa de la que se habla y NO pongas anio: unas rocas o una sierra se ven igual hoy, y con anio el juez rechaza las tomas actuales que si sirven.
- clase mapa: SOLO si la frase nombra lugares, una ruta, una distancia o una frontera ("conecta Tecate con Mexicali"). Si la frase habla de para que servia algo, de personas o de hechos ("pensado para albergar tropas"), no es mapa: es la cosa, el lugar o la persona.
- obligatorio: las cosas concretas que nombra la frase y TIENEN que verse (en persona, la persona; en cosa, la cosa; en lugar, el lugar). Vacio en ambiente o si la frase no nombra nada. El juez rechaza la imagen que no lo muestra.
- tema_bloque (en TODOS los planos): de que habla ese tramo del guion, mirando las 4-5 frases de alrededor, en 1-5 palabras ("Mesosaurus", "formacion del Rio de la Plata", "deriva continental"). Es el tema del TRAMO, no el del video entero.
- articulo (en TODOS los planos): el titulo exacto del articulo de Wikipedia, en castellano o en ingles, que mejor ilustra ese tramo ("Mesosaurus", "Río de la Plata", "Alfred Wegener"). Tiene que existir tal cual.

Entrega UNA sola vez con submit_shot_plan. Los planos van en orden, sin huecos, y cubren de la primera a la ultima palabra del tramo. desde/hasta son numeros de palabra.`;
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
            desde: { type: "string", description: "Numero de la palabra donde arranca" },
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
            desde: { type: "string", description: "Numero de la primera palabra del plano (la que nombra lo que se ve)" },
            hasta: { type: "string", description: "Numero de la ultima palabra (inclusive)" },
            clase: { type: "string", enum: SHOT_CLASSES },
            sujeto: { type: "string", description: "Que se ve, en castellano" },
            query_en: { type: "string", description: "Busqueda en ingles, 2-6 palabras, de algo que se puede fotografiar o filmar" },
            respaldo_en: { type: "array", items: { type: "string" }, description: "1-2 busquedas de respaldo en ingles, otro angulo filmable de la misma frase" },
            query_local: { type: "string", description: "La misma busqueda en el idioma del LUGAR de la historia, para YouTube (castellano si pasa en Mexico o Argentina). Vacio si es el ingles" },
            entidad: { type: "string", description: "Nombre propio exacto (persona/cosa/lugar) como en Wikipedia" },
            tema_bloque: { type: "string", description: "De que habla este tramo del guion (las 4-5 frases de alrededor), en 1-5 palabras: \"Mesosaurus\", \"formacion del Rio de la Plata\"" },
            articulo: { type: "string", description: "Titulo exacto del articulo de Wikipedia (es o en) que mejor ilustra este tramo" },
            obligatorio: {
              type: "array",
              items: { type: "string" },
              description: "Las cosas concretas que nombra la frase y TIENEN que verse, en el idioma de la narracion. Vacio si no nombra nada concreto.",
            },
            anio: { type: "number" },
            lugar: { type: "object", properties: { nombre: { type: "string" }, lat: { type: "number" }, lon: { type: "number" } }, required: ["nombre", "lat", "lon"] },
            grafico: graphicSchema,
            rotulo: graphicSchema,
            datos: {
              type: "object",
              description: "Grafico con datos REALES del Banco Mundial (solo un pais que el guion trata). Reemplaza al grafico.",
              properties: {
                tipo: { type: "string", enum: ["serie", "piramide"] },
                indicador: { type: "string", description: "Alias de la tabla de indicadores" },
                pais: { type: "string", description: "Codigo ISO3 del pais (MEX, ARG, JPN...)" },
                desde: { type: "number" },
                hasta: { type: "number" },
                anios: { type: "array", items: { type: "number" }, description: "Piramide: 2-4 anios entre 1960 y 2050" },
                titulo: { type: "string", description: "Indicador · Pais, en el idioma de la narracion" },
              },
              required: ["tipo", "pais"],
            },
          },
          required: ["desde", "hasta", "clase", "sujeto", "query_en"],
        },
      },
    },
    required: ["chapters", "shots"],
  } as Anthropic.Tool.InputSchema,
};

function dataOf(raw: unknown): ShotData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const tipo = r.tipo === "piramide" ? "piramide" : r.tipo === "serie" ? "serie" : null;
  const pais = str(r.pais).toUpperCase();
  if (!tipo || !/^[A-Z]{2,3}$/.test(pais)) return undefined;
  if (tipo === "serie" && !str(r.indicador)) return undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
  const anios = Array.isArray(r.anios) ? (r.anios as unknown[]).map(num).filter((n): n is number => n !== undefined) : undefined;
  return {
    tipo,
    pais,
    ...(str(r.indicador) ? { indicador: str(r.indicador) } : {}),
    ...(num(r.desde) ? { desde: num(r.desde)! } : {}),
    ...(num(r.hasta) ? { hasta: num(r.hasta)! } : {}),
    ...(anios?.length ? { anios } : {}),
    ...(str(r.titulo) ? { titulo: str(r.titulo) } : {}),
  };
}

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

// Busquedas que no traen imagenes (una estadistica, una linea de tiempo, el
// llamado a comentar): en La Rumorosa terminaron todas en niebla. Si el plan
// igual las escribe, se usa el respaldo como busqueda principal.
export const ABSTRACT_QUERY = /\b(per (year|day|month)|statistics?|stats|timeline|chart|graph|infographic|call to action|comment|subscribe|like button|concept|abstract|data|percentage|rate of|number of)\b/i;
export function queriesOf(main: string, respaldoRaw: unknown): { query: string; respaldo?: string[] } {
  const respaldo = (Array.isArray(respaldoRaw) ? respaldoRaw : []).map(str).filter((q) => q && q.toLowerCase() !== main.toLowerCase()).slice(0, 2);
  const concrete = respaldo.filter((q) => !ABSTRACT_QUERY.test(q));
  if (ABSTRACT_QUERY.test(main) && concrete.length) {
    const [first, ...rest] = concrete;
    return { query: first!, respaldo: rest };
  }
  return { query: main, ...(concrete.length ? { respaldo: concrete } : {}) };
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
      ...queriesOf(str(item.query_en) || str(item.sujeto), item.respaldo_en),
      ...(str(item.query_local) && !ABSTRACT_QUERY.test(str(item.query_local)) ? { queryLocal: str(item.query_local) } : {}),
      ...(str(item.entidad) ? { entidad: str(item.entidad) } : {}),
      ...(str(item.tema_bloque) ? { temaBloque: str(item.tema_bloque).slice(0, 80) } : {}),
      ...(str(item.articulo) ? { articulo: str(item.articulo).slice(0, 120) } : {}),
      ...(Array.isArray(item.obligatorio) && item.obligatorio.some((o) => str(o))
        ? { obligatorio: (item.obligatorio as unknown[]).map(str).filter(Boolean).slice(0, 5) }
        : {}),
      ...(anio ? { anio } : {}),
      ...(lugarRaw && typeof lugarRaw.lat === "number" && typeof lugarRaw.lon === "number"
        ? { lugar: { nombre: str(lugarRaw.nombre), lat: lugarRaw.lat, lon: lugarRaw.lon } }
        : {}),
      ...(grafico ? { grafico } : {}),
      ...(rotulo ? { rotulo } : {}),
      ...(dataOf(item.datos) ? { datos: dataOf(item.datos)! } : {}),
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
  dropUnsaidYears(shots, phrases);
  return { shots, chapters };
}

// El anio del plan vale solo si la voz dice un anio cerca (este plano o los 2
// de cada lado) o si es una persona (su retrato es de su epoca). En codigo, no
// solo en el prompt: el montajista le puso 1900 a "los primeros viajeros
// bautizaron este tramo" y el juez rechazo las tomas actuales que servian.
export function dropUnsaidYears(shots: PlannedShot[], phrases: Phrase[]): void {
  const said = shots.map((s) => yearOf(phrases.slice(s.from, s.to + 1).map((p) => p.text).join(" ")) !== undefined);
  shots.forEach((s, i) => {
    if (!s.anio || s.clase === "persona") return;
    if (!said.slice(Math.max(0, i - 2), i + 3).some(Boolean)) delete s.anio;
  });
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
    // Gancho (1er minuto) y vitrina (hasta el minuto 5) con mas graficos.
    const limit = start < 60 ? style.plan.graphicsPerMinuteHook : start < SHOWCASE_SECONDS ? showcaseLimit(style) : style.plan.graphicsPerMinute;
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

  // 4b. Planos de MAPA: nunca dos seguidos y como mucho uno cada
  // MAP_SHOT_MIN_GAP s (DocuMEX 29 min, 20/11/2026: 34 planos de mapa, hasta
  // 4 seguidos). El que sobra pasa a "lugar": se busca metraje real del sitio
  // (YouTube primero) y se le saca el mapa de encima.
  let lastMapShotAt = -Infinity;
  let prevWasMap = false;
  for (const shot of shots) {
    const start = shotStart(shot, phrases);
    const mapGraphic = !!shot.grafico && MAP_TYPES.includes(shot.grafico.type);
    if (shot.clase !== "mapa") {
      prevWasMap = mapGraphic;
      if (mapGraphic) lastMapShotAt = start;
      continue;
    }
    if (prevWasMap || start - lastMapShotAt < MAP_SHOT_MIN_GAP) {
      const place = shot.lugar?.nombre ?? (mapGraphic ? shot.grafico!.text : undefined);
      issues.push(`plano de mapa en p${shot.from + 1} pasa a lugar: ${prevWasMap ? "otro mapa justo antes" : `otro mapa hace menos de ${MAP_SHOT_MIN_GAP} s`}`);
      shot.clase = "lugar";
      if (place) shot.query = place;
      if (mapGraphic) delete shot.grafico;
      prevWasMap = false;
      continue;
    }
    lastMapShotAt = start;
    prevWasMap = true;
  }

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
// Con `units` (palabras) corta en final de oracion despues de 5 s, o a los 7 s.
export function heuristicPlan(phrases: Phrase[], topic: string, units: Phrase[] = phrases): { shots: PlannedShot[]; chapters: MontajeChapter[] } {
  const shots: PlannedShot[] = [];
  let start = 0;
  const byWord = units !== phrases;
  units.forEach((unit, i) => {
    const long = unit.end - units[start]!.start;
    const cut = byWord ? (long >= 5 && SENTENCE_END.test(unit.text)) || long >= 7 : long >= 5;
    if (cut || i === units.length - 1) {
      shots.push({ from: start, to: i, clase: "ambiente", sujeto: topic, query: topic });
      start = i + 1;
    }
  });
  return { shots, chapters: units.length ? [{ titulo: topic, desde: 0, animo: "documental" }] : [] };
}

// ---------- Plan anclado a palabras y por tramos (como planDePlanos de MaV) ----------

// Cada palabra es una unidad (id = su numero, 1-based): los planos arrancan
// en la palabra que nombra lo que se ve, no al principio de la frase. El
// verificador y build_timeline trabajan igual sobre estas unidades.
export function wordUnits(phrases: Phrase[]): Phrase[] {
  const units: Phrase[] = [];
  for (const phrase of phrases) {
    for (const w of phrase.words) {
      units.push({ id: String(units.length + 1), text: w.text, start: w.start, end: w.end, words: [w] });
    }
  }
  return units;
}

const SENTENCE_END = /[.!?…]["»”)]*$/;
export const HOOK_SECONDS = 60;
export const TRAMO_SECONDS = 150;
const TRAMO_MIN_TAIL = 20;

// Tramos de unidades: el gancho (60 s) y despues de 150 s, cortados en el
// final de oracion mas cercano por detras si deja mas del 60 % del limite.
// Un resto de menos de 20 s se une al tramo anterior.
export function splitTramos(units: Phrase[], hook = HOOK_SECONDS, body = TRAMO_SECONDS): { desde: number; hasta: number }[] {
  const tramos: { desde: number; hasta: number }[] = [];
  let from = 0;
  while (from < units.length) {
    const limit = tramos.length === 0 ? hook : body;
    const t0 = units[from]!.start;
    let to = from;
    while (to + 1 < units.length && units[to + 1]!.end - t0 <= limit) to++;
    if (to + 1 < units.length) {
      for (let k = to; k > from; k--) {
        if (SENTENCE_END.test(units[k]!.text) && units[k]!.end - t0 >= limit * 0.6) {
          to = k;
          break;
        }
      }
    }
    tramos.push({ desde: from, hasta: to });
    from = to + 1;
  }
  const last = tramos[tramos.length - 1];
  if (tramos.length > 1 && last && units[last.hasta]!.end - units[last.desde]!.start < TRAMO_MIN_TAIL) {
    tramos.pop();
    tramos[tramos.length - 1]!.hasta = last.hasta;
  }
  return tramos;
}

// ---------- Vitrina: la biblioteca de graficos en los primeros 5 minutos ----------

// En los primeros 5 minutos el espectador tiene que ver la variedad de
// animaciones (cifras, mapas, lineas de tiempo, comparaciones...): es lo que
// lo engancha. Mas presupuesto de graficos y los tipos repartidos entre los
// tramos de esa ventana (los tramos se planifican en paralelo y sin esto
// todos usaban los mismos 3-4 tipos).
export const SHOWCASE_SECONDS = 300;

// Orden de impacto: lo que mas se luce primero.
const IMPACT_ORDER = [
  "big_number",
  "map_marker",
  "timeline",
  "versus",
  "person_card",
  "line_chart",
  "data_viz_single",
  "number_phrase",
  "map_globe",
  "scale_compare",
  "kinetic_quote",
  "rank_reveal",
  "myth_fact",
  "card_grid",
  "list",
  "layers_diagram",
  "cycle_diagram",
  "profile_card",
  "pivot_question",
  "highlight_phrase",
  "checklist",
  "side_panel",
  "process_wave",
  "photo_tree",
  "dossier",
  "concept_circles",
  "scoreboard",
  "phrase_swap",
  "strike_word",
];

export function showcaseLimit(style: DocumentalStyle): number {
  return Math.max(style.plan.graphicsPerMinute, Math.round(style.plan.graphicsPerMinuteHook * 0.8));
}

// Tipos de grafico de la vitrina: los del estilo (sin rotulos), favoritos
// primero y despues por impacto.
export function showcaseTypes(style: DocumentalStyle): string[] {
  // Fuera rotulos y piezas de navegacion o llamados (no son "animaciones con datos").
  const notShowcase = new Set(["chapter_index", "cta", "subscribe_cta", "location", "nav_header", "title_card"]);
  const allowed = allowedGraphicTypes(style).filter((t) => !ROTULO_TYPES.includes(t) && !notShowcase.has(t));
  const rank = (t: string) => {
    const fav = style.graphics.favor.indexOf(t);
    const imp = IMPACT_ORDER.indexOf(t);
    return (fav >= 0 ? fav : 100) * 1000 + (imp >= 0 ? imp : 500);
  };
  return [...allowed].sort((a, b) => rank(a) - rank(b));
}

// Reparte los tipos de la vitrina entre los tramos que arrancan antes del
// minuto 5 (round robin, el gancho primero). Los demas tramos: nada.
export function showcaseAssignment(style: DocumentalStyle, tramoStarts: number[]): string[][] {
  const inShowcase = tramoStarts.map((s, i) => (s < SHOWCASE_SECONDS ? i : -1)).filter((i) => i >= 0);
  const out: string[][] = tramoStarts.map(() => []);
  if (inShowcase.length === 0) return out;
  showcaseTypes(style).forEach((type, k) => out[inShowcase[k % inShowcase.length]!]!.push(type));
  return out;
}

function showcaseNotes(featured: string[]): string {
  return `VITRINA (primeros 5 minutos del video): el espectador tiene que ver que hay variedad de animaciones. Para ESTE tramo, priorizá estos tipos de grafico: ${featured.join(", ")}.
Es un MENU, no una obligacion. CRITERIO, que es lo principal:
- Cada grafico tiene que nacer de un dato que la frase DICE y que tiene la forma de ese grafico: big_number = una cifra que impacta; versus = dos cosas que se comparan; timeline = varias fechas en orden; line_chart = una evolucion en el tiempo con varios valores; map_marker/map_globe = un lugar que importa; scale_compare = una escala o equivalencia; rank_reveal/list = un ranking o una enumeracion real. Si el dato no tiene esa forma, ese tipo no va.
- Mejor un tramo con 3 graficos bien elegidos que 7 forzados. Nunca un grafico de relleno, nunca uno que repita lo que ya dice la imagen.
- Entre dos tipos que sirven para el mismo dato, elegi el que todavia no aparecio en el video.
- Cada cifra, fecha, lugar o comparacion llamativa que de verdad aporte va como grafico animado (no como rotulo).`;
}

// Notas del gancho y del cuerpo (literales de MaV, pp:424-429).
const HOOK_NOTES =
  "GANCHO: algo en cada frase. Planos de 2,5-4 s. Una fecha en su fecha, un mapa del primer sitio, la foto de la primera persona que se nombra, rotulos para cada nombre y cifra.";
const BODY_NOTES =
  "CUERPO: el video respira; el metraje real lo lleva (planos de 4-6 s). Mas o menos un grafico por minuto, fotos a menudo, mapas cuando importa un sitio nuevo, 2-4 rotulos por minuto.";

// Palabras numeradas, 25 por linea, con el tiempo al principio de cada linea.
export function numberedWords(units: Phrase[], desde: number, hasta: number): string {
  const lines: string[] = [];
  for (let i = desde; i <= hasta; i += 25) {
    const chunk = units.slice(i, Math.min(hasta + 1, i + 25));
    lines.push(`[${chunk[0]!.start.toFixed(1)}s] ${chunk.map((u) => `${u.id}:${u.text}`).join(" ")}`);
  }
  return lines.join("\n");
}

function tramoPrompt(units: Phrase[], tramo: { desde: number; hasta: number }, index: number, total: number, topic: string, featured: string[] = []): string {
  const before = units.slice(Math.max(0, tramo.desde - 30), tramo.desde).map((u) => u.text).join(" ");
  return `Tema del video: ${topic || "(sin titulo)"}
Tramo ${index + 1} de ${total} (palabras ${units[tramo.desde]!.id}-${units[tramo.hasta]!.id}, ${units[tramo.desde]!.start.toFixed(1)}-${units[tramo.hasta]!.end.toFixed(1)} s).
${before ? `Lo que se dijo justo antes: «${before}»\n` : ""}
${index === 0 ? HOOK_NOTES : BODY_NOTES}${featured.length ? `
${showcaseNotes(featured)}` : ""}

Guion en palabras numeradas (numero:palabra). "desde" y "hasta" de cada plano son NUMEROS DE PALABRA de este tramo: el plano arranca en la palabra que nombra lo que se ve. Los planos cubren TODO el tramo, de la palabra ${units[tramo.desde]!.id} a la ${units[tramo.hasta]!.id}, sin huecos. Los capitulos tambien usan numero de palabra.
${numberedWords(units, tramo.desde, tramo.hasta)}`;
}

// Un plano no termina en "el", "de", "y"...: esa palabra va con la que sigue
// ("A las 23:40 el | vigia" -> "A las 23:40 | el vigia"). Solo mueve palabras
// de enlace al plano siguiente, nunca deja un plano vacio.
const LINK_WORD = /^(el|la|los|las|lo|un|una|unos|unas|de|del|a|al|en|con|por|para|sin|sobre|y|e|o|u|que|su|sus|the|a|an|of|to|in|and|or)$/i;

export function tidyBoundaries(shots: PlannedShot[], units: Phrase[]): number {
  let moved = 0;
  for (let i = 0; i < shots.length - 1; i++) {
    const shot = shots[i]!;
    const next = shots[i + 1]!;
    while (shot.to > shot.from && next.from === shot.to + 1 && LINK_WORD.test(units[shot.to]!.text.replace(/[^\p{L}]/gu, ""))) {
      shot.to -= 1;
      next.from -= 1;
      moved += 1;
    }
  }
  return moved;
}

// Adelanto de la imagen respecto de su primera palabra, por clase (MaV
// ponerTiempos): el ojo llega antes que la palabra.
export const LEAD_BY_CLASS: Partial<Record<ShotClass, number>> = { mapa: 1.6, persona: 0.9, cosa: 0.5, lugar: 0.5 };
export const GRAPHIC_LEAD = 0.15;

export function leadOf(shot: Pick<PlannedShot, "clase" | "grafico">): number {
  if (shot.grafico) return GRAPHIC_LEAD;
  return LEAD_BY_CLASS[shot.clase] ?? 0;
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
  const { style } = input;
  // Unidades = palabras (plan anclado a palabras, como MaV).
  const units = wordUnits(input.phrases);
  const topic = input.videoTopic ?? "";
  const usage: Usage = {};
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key) {
    const verified = verifyPlan(heuristicPlan(input.phrases, topic, units), units, style);
    return { ...verified, units, source: "heuristic", usage, issues: ["sin provider anthropic: plan heuristico", ...verified.issues] };
  }
  const model = (provider.configuration?.montaje_model as string | undefined) ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: provider.api_key });
  const tramos = splitTramos(units);
  // Vitrina: los tipos de grafico del estilo repartidos entre los tramos de
  // los primeros 5 minutos, para que entre todos aparezcan casi todos.
  const featured = showcaseAssignment(style, tramos.map((t) => units[t.desde]!.start));
  const issues: string[] = [];

  // Un tramo: su plan con UNA correccion si sale con demasiado "ambiente".
  // Si falla, ese tramo va con el plan de reserva (los demas siguen).
  const planTramo = async (tramo: { desde: number; hasta: number }, index: number): Promise<{ shots: PlannedShot[]; chapters: MontajeChapter[] }> => {
    const user = tramoPrompt(units, tramo, index, tramos.length, topic, featured[index] ?? []);
    const inTramo = (p: { shots: PlannedShot[]; chapters: MontajeChapter[] }) => ({
      shots: p.shots
        .filter((s) => s.to >= tramo.desde && s.from <= tramo.hasta)
        .map((s) => ({ ...s, from: Math.max(tramo.desde, s.from), to: Math.min(tramo.hasta, s.to) })),
      chapters: p.chapters.filter((c) => c.desde >= tramo.desde && c.desde <= tramo.hasta),
    });
    try {
      let parsed = inTramo(parsePlan(await callTool(client, model, MAX_TOKENS, systemPrompt(style), PLAN_TOOL, user, usage), units));
      if (parsed.shots.length === 0) throw new Error("sin planos");
      const share = ambientShare(parsed.shots);
      if (share > MAX_AMBIENT_SHARE) {
        const fix = `${user}\n\nTu plan anterior puso el ${Math.round(share * 100)}% de los planos como "ambiente" (maximo ${Math.round(MAX_AMBIENT_SHARE * 100)}%). Rehacelo: todo lo que nombra o describe algo mostrable (el barco, la gente, un lugar, un hecho filmado) va como persona, cosa, lugar o metraje. Ambiente solo para transiciones e ideas abstractas.`;
        try {
          const retry = inTramo(parsePlan(await callTool(client, model, MAX_TOKENS, systemPrompt(style), PLAN_TOOL, fix, usage), units));
          if (retry.shots.length > 0 && ambientShare(retry.shots) < share) parsed = retry;
        } catch (err) {
          console.warn(`[montajista] tramo ${index + 1}: la correccion de ambiente fallo:`, err);
        }
        issues.push(`tramo ${index + 1}: ambiente ${Math.round(share * 100)}% -> ${Math.round(ambientShare(parsed.shots) * 100)}%`);
      }
      return parsed;
    } catch (err) {
      console.warn(`[montajista] tramo ${index + 1} fallo, va con el plan de reserva:`, err);
      issues.push(`tramo ${index + 1}: reserva (${(err as Error).message})`);
      const sub = units.slice(tramo.desde, tramo.hasta + 1);
      const reserve = heuristicPlan([{ id: "r", text: sub.map((u) => u.text).join(" "), start: sub[0]!.start, end: sub[sub.length - 1]!.end, words: sub.flatMap((u) => u.words) }], topic, sub);
      return {
        shots: reserve.shots.map((s) => ({ ...s, from: s.from + tramo.desde, to: s.to + tramo.desde })),
        chapters: index === 0 ? reserve.chapters : [],
      };
    }
  };

  const results = await Promise.all(tramos.map((t, i) => planTramo(t, i)));
  if (results.every((r) => r.shots.length === 0)) {
    const verified = verifyPlan(heuristicPlan(input.phrases, topic, units), units, style);
    return { ...verified, units, source: "heuristic", usage, issues: ["montajista sin planos", ...verified.issues] };
  }
  const verified = verifyPlan({ shots: results.flatMap((r) => r.shots), chapters: results.flatMap((r) => r.chapters) }, units, style);
  tidyBoundaries(verified.shots, units);
  const allReserve = issues.filter((i) => i.includes("reserva")).length === tramos.length;
  return { ...verified, units, source: allReserve ? "heuristic" : "montajista", usage, issues: [`${tramos.length} tramos`, ...issues, ...verified.issues] };
}
