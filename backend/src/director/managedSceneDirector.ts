import Anthropic from "@anthropic-ai/sdk";
import { rm } from "node:fs/promises";
import { getActiveProvider } from "../lib/providers.js";
import { motionCatalog, renderAnimatedStills } from "../lib/motion.js";
import { makeWorkDir } from "../lib/workDir.js";
import type { PaletteTheme } from "../lib/niches.js";
import { auditVideo, reviewScenes, stillRequests } from "./sceneReview.js";
import { directDocumental } from "./documentalDirector.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { normalize } from "../tools/generateOverlay.tool.js";
import { plannableTypes } from "../tools/planOverlays.tool.js";
import { asList, clock } from "./director.js";
import { INTENTS } from "./manual.js";
import { TYPE_GUIDE } from "../tools/planOverlays.tool.js";
import { validateComponent, type DrawingComponent } from "./drawings.js";
import { MANAGED_AGENTS } from "./managedAgents.config.js";
import type { Phrase } from "./phrases.js";
import {
  wordTime,
  assemblePlan,
  designerSystem,
  designerTool,
  directAnimatedScenes,
  directorSystem,
  directorTool,
  readStructure,
  sceneGroups,
  str,
  verifyScene,
  type AnimatedPlan,
  type PlannedScene,
  type SceneElement,
  type SceneStructure,
} from "./sceneDirector.js";

// Director de escenas en Managed Agents (Claude Platform): hub-and-spoke.
// - DIRECTOR: interpreta el guion y define escenas y biblioteca visual de ESTE
//   video. Entrega y termina: como coordinador se despertaba con cada paso de
//   los demas y releia todo el contexto (se llevaba 3/4 del costo).
// - DIBUJANTES: dibujan los componentes, una vez cada uno, para reutilizarlos.
// - DISENADORES: arman cada tramo combinando y animando componentes.
// - VERIFICADOR y reparto: nuestro codigo. Abre una sesion por lote y por tramo
//   (hasta WORKERS a la vez), repite lo que falte y devuelve lo rechazado con
//   el motivo, hasta MAX_ATTEMPTS.
// La biblioteca es de cada guion: nada se comparte entre videos. Los agentes se
// crean una sola vez (scripts/setup-managed-agents.ts); aca solo se abre una
// sesion por video. Si la sesion falla, sigue el esquema paso a paso: este
// modulo nunca tira el video.

export const DIRECTOR_AGENT_NAME = "Multimedia";
export const ARTIST_AGENT_NAME = "Dibujante";
export const DESIGNER_AGENT_NAME = "Escenas";
export const DIRECTOR_MODEL = "claude-opus-5-5";
export const ARTIST_MODEL = "claude-sonnet-5-5";
export const DESIGNER_MODEL = "claude-sonnet-5-5";

const MAX_ATTEMPTS = 3;
const SESSION_TIMEOUT_MS = 20 * 60 * 1000;
const WORKERS = 10;
// Vueltas de reparto: la segunda repite lo que haya quedado pendiente.
const WORK_ROUNDS = 2;
// Correcciones por pedido del Revisor y el Auditor, despues del primer control.
const REVIEW_ROUNDS = 2;
// Encabezado fijo: largo maximo en palabras.
const MAX_SHORT_TITLE_WORDS = 5;
const MAX_CHAPTER_LABEL_WORDS = 4;
const MAX_RECONNECTS = 30;
// Componentes por lote de dibujo y tope de tramos.
const COMPONENTS_PER_BATCH = 6;
// Texto en escenas con dibujo: etiquetas cortas que no toquen ningun dibujo. Alto de una, en % del cuadro.
const MAX_LABELS = 3;
const LABEL_HEIGHT = 4;
// Cuanto se tolera fuera del cuadro y encimado (fraccion del dibujo menor).
const FRAME_MARGIN = 1;
const MAX_OVERLAP = 0.15;
// Ritmo y ocupacion de un escenario.
const MAX_QUIET_SECONDS = 6;
const MIN_FRAME_SPAN = 60;
// Movimiento decorativo por escena: lo que no cuenta nada, sobra.
const MAX_LOOPS = 3;
// Encabezado fijo arriba, en % del cuadro.
const HEADER_MARGIN = 10;
// Un movimiento de camara cada tantos segundos, como mucho.
const SECONDS_PER_CAMERA = 7;
// Las escenas de grafico o metrica resaltan: no son la mayoria.
const MAX_GRAPHIC_SHARE = 0.35;
const MIN_TIMELINE_ITEMS = 3;
// Lo grande es decorado: no se traslada ni va apilado sobre otra cosa.
const MAX_MOVING_WIDTH = 24;
const MAX_OVER_WIDTH = 20;
// Pasos que no son aparecer u ocultar, por frase de la escena.
const MIN_MOTION_PER_PHRASE = 0.25;
// Una accion de personaje cada tantas frases.
const PHRASES_PER_ACT = 10;
// Graficos del catalogo que muestran datos, metricas o ubican. Mito y realidad,
// indices y listas quedan afuera: son texto que la voz ya dice.
const VISUAL_GRAPHICS = [
  "big_number", "versus", "badge", "rank_reveal", "data_viz_single", "scale_compare", "line_chart", "timeline",
  "map_marker", "map_globe", "cycle_diagram", "layers_diagram", "pivot_question",
];
const visualTypes = () => plannableTypes().filter((t) => VISUAL_GRAPHICS.includes(t));
const SKELETON = ["cabeza", "torso", "brazo_izq", "brazo_der", "pierna_izq", "pierna_der"];
const MAX_TRAMOS = 40;
const MIN_SCENES_PER_TRAMO = 1;
// Tope de gasto por sesion, en centavos: el director lee el guion entero.
const WORKER_BUDGET_CENTS = "120";
const directorBudgetCents = (seconds: number) => String(100 + Math.ceil((seconds / 60) * 10));

type CustomTool = Anthropic.Beta.Agents.BetaManagedAgentsCustomToolParams;
type Schema = CustomTool["input_schema"];

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): CustomTool {
  return { type: "custom", name, description, input_schema: { type: "object", properties, required } as Schema };
}

// ---------- Configuracion de los agentes ----------

// Solo lectura, para que cada agente pueda abrir su skill (backend/skills).
const READ_SKILLS = {
  type: "agent_toolset_20260401" as const,
  default_config: { enabled: false, permission_policy: { type: "always_allow" as const } },
  configs: [{ name: "read" as const, enabled: true }],
};

export function directorAgentConfig() {
  const base = directorTool().input_schema as { properties: Record<string, unknown>; required: string[] };
  const scene = (base.properties.scenes as { items: { properties: Record<string, unknown> } }).items.properties;
  const chapter = (base.properties.chapters as { items: { properties: Record<string, unknown>; required: string[] } }).items;
  return {
    name: DIRECTOR_AGENT_NAME,
    description: "Interpreta el guion y define escenarios y biblioteca visual.",
    model: DIRECTOR_MODEL,
    system: `Sos el agente MULTIMEDIA de un video todo animado. Antes de empezar lee tu skill direccion-visual.

Te paso el guion partido en frases numeradas con su tiempo. Devolves con submit_structure:
0. short_title: el tema en hasta 5 palabras, para el encabezado fijo.
1. chapters: las partes reales del video, con titulo copiado del guion, la frase donde arranca y short: un nombre de hasta 4 palabras para el encabezado.
2. scenes: escenas seguidas que cubren todo el video, con su intencion e idea (${INTENTS.join(", ")}). Cada una es un escenario dibujado o un grafico del catalogo, con el criterio de tu skill. Un escenario se escribe asi: "DEMUESTRA: que entiende el espectador. PASOS: lo que cambia cada pocos segundos. REMATE: el cambio fuerte y su palabra exacta. Componentes: ids". Un grafico empieza con "GRAFICO: tipo", dice que datos del guion muestra y en que palabra entra.
Graficos disponibles: ${visualTypes().join(", ")}.
3. components: la biblioteca visual de este guion, con id corto en minusculas, nombre y descripcion. Cada objeto existe UNA sola vez: el mismo boton y el mismo reactor en todo el video. Si un objeto cambia de estado, se anima el mismo dibujo; nunca pidas una variante.

Si responde con un error, corregi y volve a llamarla. Cuando la acepte, termina con una linea.`,
    tools: [
      READ_SKILLS,
      tool(
        "submit_structure",
        "Entrega capitulos, escenarios y la biblioteca visual del video.",
        {
          ...base.properties,
          short_title: { type: "string", description: "Tema del video para el encabezado, hasta 5 palabras." },
          chapters: { type: "array", items: { type: "object", properties: { ...chapter.properties, short: { type: "string", description: "Nombre del capitulo para el encabezado, hasta 4 palabras." } }, required: [...chapter.required, "short"] } },
          scenes: { type: "array", items: { type: "object", properties: scene, required: ["from_phrase", "to_phrase", "intent", "idea"] } },
          components: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" } },
              required: ["id", "name", "description"],
            },
          },
        },
        [...base.required, "short_title", "components"]
      ),
    ],
  };
}

export function artistAgentConfig() {
  return {
    name: ARTIST_AGENT_NAME,
    description: 'Dibuja componentes en SVG. Pedile "Dibuja el lote N".',
    model: ARTIST_MODEL,
    system: `Sos el DIBUJANTE de un video animado. Antes de empezar lee tu skill dibujo.

TU PROCESO:
1. Te piden un lote: llama a get_cast con ese numero.
2. Dibuja todos sus componentes y entregalos con submit_components.
3. Si responde con RECHAZOS, corregi esos y volve a entregar.
4. Cuando responda LISTO, termina con una linea.`,
    tools: [
      READ_SKILLS,
      tool("get_cast", "Devuelve los componentes de un lote.", { lote: { type: "number" } }, ["lote"]),
      tool(
        "submit_components",
        "Entrega componentes dibujados para que los revise el verificador.",
        {
          lote: { type: "number" },
          components: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" }, width: { type: "number" }, height: { type: "number" }, svg: { type: "string" } },
              required: ["id", "name", "width", "height", "svg"],
            },
          },
        },
        ["lote", "components"]
      ),
    ],
  };
}

export function designerAgentConfig() {
  const types = visualTypes();
  const base = designerTool(types).input_schema as { properties: Record<string, unknown>; required: string[] };
  return {
    name: DESIGNER_AGENT_NAME,
    description: 'Arma y anima un escenario completo. Pedile "Disena el tramo N".',
    model: DESIGNER_MODEL,
    system: `Sos el agente de ESCENAS de un video animado. Antes de empezar lee tu skill animacion.

Si la idea de la escena empieza con "GRAFICO: tipo", arma ese grafico del catalogo (kind graphic), solo y a pantalla completa, con datos copiados del guion. Si no, arma el escenario con dibujos (kind drawing). Graficos:
${types.map((t) => `- ${t}: ${TYPE_GUIDE[t] ?? ""}`).join("\n")}

"phrase" dice en que frase pasa cada paso. Los textos y cifras solo pueden salir del guion.

TU PROCESO:
1. Te piden un tramo: llama a get_brief con ese numero y recibis la escena, sus frases y la biblioteca.
2. Disena y entrega con submit_scenes, con el numero de tramo.
3. Si responde con RECHAZOS, corregi cada motivo y volve a entregar.
4. Cuando responda LISTO, termina con una linea.

Usa solo los componentes de la biblioteca, y siempre el mismo para el mismo objeto: nunca reemplaces un boton por una palanca ni un reactor por otro dibujo. Si el pedido es corregir, get_brief trae las CORRECCIONES que tenes que resolver sin romper lo demas.`,
    tools: [
      READ_SKILLS,
      tool("get_brief", "Devuelve la escena, sus frases y la biblioteca visual de un tramo.", { tramo: { type: "number" } }, ["tramo"]),
      tool("submit_scenes", "Entrega escenas disenadas para que las revise el verificador.", { ...base.properties, tramo: { type: "number" } }, ["tramo", ...base.required]),
    ],
  };
}

// ---------- Herramientas (el verificador) ----------

class SceneTools {
  structure: SceneStructure | null = null;
  shortTitle: string | null = null;
  private readonly corrections = new Map<number, string[]>();
  readonly designed = new Map<number, Record<string, unknown>>();
  readonly library = new Map<string, DrawingComponent>();
  private cast: { id: string; name: string; description: string }[] = [];
  private batches: (typeof this.cast)[] = [];
  private groups: ReturnType<typeof sceneGroups> = [];
  private readonly doneTramos = new Set<number>();
  private readonly attempts = new Map<string, number>();
  // Problemas de la mejor version de cada escena.
  private readonly best = new Map<number, number>();
  private readonly fullText: string;
  private readonly fullNorm: string;
  private readonly types = visualTypes();

  constructor(private readonly phrases: Phrase[]) {
    this.fullText = phrases.map((p) => p.text).join(" ");
    this.fullNorm = normalize(this.fullText);
  }

  async run(name: string, input: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
    if (name === "submit_structure") return this.submitStructure(input);
    if (name === "get_cast") return this.getCast(input);
    if (name === "submit_components") return this.submitComponents(input);
    if (name === "get_brief") return this.getBrief(input);
    if (name === "submit_scenes") return this.submitScenes(input);
    return { text: `Herramienta desconocida: ${name}`, isError: true };
  }

  private nextAttempt(key: string): number {
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    return attempt;
  }

  private submitStructure(input: Record<string, unknown>) {
    const structure = readStructure(input, this.phrases);
    const titles = asList(input.chapters, "chapters").map((c) => (c as { title?: unknown }).title);
    const kept = new Set(structure.chapters.map((c) => c.title));
    const bad = titles.filter((t) => typeof t !== "string" || !kept.has(t.trim()));
    if (bad.length > 0) {
      return { text: `Estos titulos no estan copiados del guion: ${bad.join(" | ")}. Copialos literal y volve a entregar.`, isError: true };
    }
    this.cast = asList(input.components, "components")
      .map((c) => c as Record<string, unknown>)
      .map((c) => ({ id: (str(c.id) ?? "").toLowerCase(), name: str(c.name) ?? "", description: str(c.description) ?? "" }))
      .filter((c) => c.id && c.description);
    if (this.cast.length === 0) return { text: "Falta la biblioteca visual en components.", isError: true };
    const names = this.cast.map((c) => c.name.toLowerCase());
    const repeated = names.filter((n, i) => names.indexOf(n) !== i);
    if (repeated.length > 0) return { text: `Objetos repetidos en la biblioteca: ${repeated.join(", ")}. Cada objeto existe una sola vez.`, isError: true };
    const shortTitle = str(input.short_title) ?? "";
    const words = (v: string) => v.split(/\s+/).filter(Boolean).length;
    const longChapter = structure.chapters.find((c) => !c.label || words(c.label) > MAX_CHAPTER_LABEL_WORDS);
    if (!shortTitle || words(shortTitle) > MAX_SHORT_TITLE_WORDS) return { text: `short_title necesita de 1 a ${MAX_SHORT_TITLE_WORDS} palabras.`, isError: true };
    if (longChapter) return { text: `El capitulo "${longChapter.title}" necesita short de hasta ${MAX_CHAPTER_LABEL_WORDS} palabras.`, isError: true };
    this.shortTitle = shortTitle;
    const graphics = asList(input.scenes, "scenes").map((s) => /^\s*GRAFICO/i.test(String((s as { idea?: unknown }).idea)));
    if (graphics.filter(Boolean).length > Math.ceil(graphics.length * MAX_GRAPHIC_SHARE)) {
      return { text: "Demasiados graficos: como mucho un tercio de las escenas. Los dibujos cuentan el video y las metricas lo resaltan.", isError: true };
    }
    if (graphics.some((g, i) => g && graphics[i + 1])) return { text: "Dos graficos seguidos: intercala un escenario dibujado.", isError: true };
    this.structure = structure;
    this.batches = [];
    for (let i = 0; i < this.cast.length; i += COMPONENTS_PER_BATCH) this.batches.push(this.cast.slice(i, i + COMPONENTS_PER_BATCH));
    this.groups = sceneGroups(structure, this.phrases, Math.max(MIN_SCENES_PER_TRAMO, Math.ceil(structure.planned.length / MAX_TRAMOS)));
    return {
      text: `Estructura aceptada. ${this.batches.length} lotes de dibujo (1 a ${this.batches.length}) y ${this.groups.length} tramos:\n${this.groups
        .map((g, i) => `Tramo ${i + 1}: ${g.title} (${g.scenes.length} escenas)`)
        .join("\n")}`,
    };
  }

  get lotsPending(): number[] {
    return this.batches.flatMap((b, i) => (b.some((c) => !this.library.has(c.id)) ? [i + 1] : []));
  }

  get tramosPending(): number[] {
    return this.groups.flatMap((_, i) => (this.doneTramos.has(i + 1) ? [] : [i + 1]));
  }

  // Vuelve a abrir el tramo de una escena rechazada, con los motivos.
  reopen(sceneId: string, problems: string[]) {
    const index = Number(sceneId.slice(1)) - 1;
    const tramo = this.groups.findIndex((g) => g.scenes.some((s) => s.index === index)) + 1;
    if (tramo === 0) return;
    this.corrections.set(tramo, [...(this.corrections.get(tramo) ?? []), ...problems.map((p) => `${sceneId}: ${p}`)]);
    this.doneTramos.delete(tramo);
    this.attempts.delete(`tramo${tramo}`);
    this.best.delete(index);
  }

  private getCast(input: Record<string, unknown>) {
    const batch = this.batches[Number(input.lote) - 1];
    if (!batch) return { text: `No existe el lote ${String(input.lote)}.`, isError: true };
    return { text: batch.map((c) => `${c.id} · ${c.name}: ${c.description}`).join("\n") };
  }

  private submitComponents(input: Record<string, unknown>) {
    const lote = Number(input.lote);
    const batch = this.batches[lote - 1];
    if (!batch) return { text: `No existe el lote ${String(input.lote)}.`, isError: true };
    const attempt = this.nextAttempt(`lote${lote}`);
    const rejected: string[] = [];
    for (const raw of asList(input.components, "components").map((c) => c as Record<string, unknown>)) {
      const result = validateComponent(raw);
      if (typeof result === "string") rejected.push(result);
      else this.library.set(result.id, result);
    }
    for (const c of batch) if (!this.library.has(c.id)) rejected.push(`${c.id}: falta entregarlo`);
    if (rejected.length === 0) return { text: "LISTO: todos los componentes pasaron." };
    if (attempt >= MAX_ATTEMPTS) return { text: "LISTO: sin mas intentos, quedan los que pasaron." };
    return { text: `RECHAZOS (intento ${attempt} de ${MAX_ATTEMPTS}):\n${[...new Set(rejected)].join("\n")}` };
  }

  private getBrief(input: Record<string, unknown>) {
    const group = this.groups[Number(input.tramo) - 1];
    if (!group) return { text: `No existe el tramo ${String(input.tramo)}.`, isError: true };
    if (this.library.size === 0) return { text: "Todavia no hay dibujos en la biblioteca.", isError: true };
    const library = [...this.library.values()].map((c) => {
      const parts = Object.entries(c.parts).map(([part, pivot]) => (pivot ? `${part} (gira en ${pivot})` : part));
      return `- ${c.id} · ${c.name} · proporcion ${c.width}x${c.height} · partes: ${parts.join(", ") || "ninguna"}`;
    });
    const fixes = this.corrections.get(Number(input.tramo));
    const previous = group.scenes.flatMap((s) => (this.designed.has(s.index) ? [JSON.stringify(this.designed.get(s.index))] : []));
    const review = fixes ? `\n\nCORRECCIONES DEL REVISOR:\n${fixes.join("\n")}\n\nVERSION ACTUAL:\n${previous.join("\n")}` : "";
    return { text: `${group.brief}\n\nBIBLIOTECA VISUAL DE ESTE VIDEO:\n${library.join("\n")}${review}` };
  }

  // Caja de un dibujo en % del cuadro.
  private box(e: SceneElement) {
    const component = this.library.get(e.component ?? "");
    if (!component) return null;
    const w = e.w ?? 40;
    const rows = e.repeat ? Math.ceil(e.repeat.count / e.repeat.columns) : 1;
    const cell = e.repeat ? w / e.repeat.columns : w;
    const h = ((cell * component.height) / component.width) * (16 / 9) * rows;
    return { id: e.id, x: e.x ?? 50, y: e.y ?? 50, w, h };
  }

  // Dibujos que se salen del cuadro o que se pisan estando en pantalla a la vez.
  private layoutProblems(elements: SceneElement[], raw: Record<string, unknown>, steps: { phrase: number; step: { action: string; target: string; part?: string } }[]): string[] {
    const over = new Set(asList(raw.elements, "elements").map((e) => e as { id?: string; w?: unknown; over?: unknown }).filter((e) => e.over === true && Number(e.w) <= MAX_OVER_WIDTH).map((e) => e.id));
    const shown = (id: string) => {
      const own = steps.filter((s) => s.step.target === id && !s.step.part);
      return {
        from: own.find((s) => s.step.action === "show")?.phrase ?? -1,
        to: own.find((s) => s.step.action === "hide")?.phrase ?? Infinity,
      };
    };
    // Se revisa tambien donde terminan los dibujos despues de moverse.
    const moved = (b: NonNullable<ReturnType<SceneTools["box"]>>) => {
      const own = steps.filter((s) => s.step.target === b.id && s.step.action === "move" && !s.step.part);
      return {
        ...b,
        x: b.x + own.reduce((sum, s) => sum + (((s.step as { dx?: number }).dx ?? 0) / 100) * b.w, 0),
        y: b.y + own.reduce((sum, s) => sum + (((s.step as { dy?: number }).dy ?? 0) / 100) * b.h, 0),
      };
    };
    const start = elements.filter((e) => e.kind === "drawing").flatMap((e) => this.box(e) ?? []);
    const boxes = [...start, ...start.map(moved)];
    const problems: string[] = [];
    for (const [i, a] of boxes.entries()) {
      if (a.x - a.w / 2 < -FRAME_MARGIN || a.x + a.w / 2 > 100 + FRAME_MARGIN || a.y - a.h / 2 < HEADER_MARGIN || a.y + a.h / 2 > 100 + FRAME_MARGIN) {
        problems.push(`${a.id}: se sale del cuadro, achicalo o movelo`);
      }
      for (const b of boxes.slice(i + 1)) {
        if (a.id === b.id || over.has(a.id) || over.has(b.id)) continue;
        const [ta, tb] = [shown(a.id), shown(b.id)];
        if (ta.to <= tb.from || tb.to <= ta.from) continue;
        const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
        const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
        if (dx > 0 && dy > 0 && dx * dy > MAX_OVERLAP * Math.min(a.w * a.h, b.w * b.h)) problems.push(`${a.id} y ${b.id} se pisan: separalos o usa over si es a proposito`);
      }
    }
    return [...new Set(problems)];
  }

  // Una escena viva: arranca moviendose, sin tramos quietos, usando el cuadro y
  // con personajes que puedan actuar.
  private motionProblems(planned: PlannedScene, elements: SceneElement[], steps: { phrase: number; step: { action: string; target: string; act?: string } }[]): string[] {
    const problems: string[] = [];
    // Texto y metricas entran en la palabra exacta, nunca al empezar la escena.
    for (const e of elements.filter((x) => x.kind === "label" || x.kind === "graphic")) {
      const show = steps.find((s) => s.step.target === e.id && s.step.action === "show");
      if (!show || !(show.step as { word?: string }).word) problems.push(`${e.id}: necesita un show con la palabra exacta (word)`);
    }
    const boxes = elements.filter((e) => e.kind === "drawing").flatMap((e) => this.box(e) ?? []);
    if (boxes.length === 0) return problems;
    // Quietud medida en segundos: una frase larga no puede esconder una pausa.
    const times = steps
      .filter((s) => s.step.action !== "loop")
      .map((s) => wordTime(this.phrases[s.phrase]!, (s.step as { word?: string }).word))
      .sort((x, y) => x - y);
    const end = this.phrases[planned.to]!.end;
    let last = this.phrases[planned.from]!.start;
    for (const at of [...times, end]) {
      if (at - last > MAX_QUIET_SECONDS) {
        problems.push(`${(at - last).toFixed(0)} segundos seguidos sin cambios cerca del segundo ${Math.round(last)}: hace falta algo nuevo cada ${MAX_QUIET_SECONDS} segundos`);
        break;
      }
      last = at;
    }
    // Nunca pantalla vacia: en cada frase hay al menos un dibujo a la vista.
    const span = (id: string) => {
      const own = steps.filter((s) => s.step.target === id);
      return {
        from: own.find((s) => s.step.action === "show")?.phrase ?? planned.from,
        to: own.find((s) => s.step.action === "hide")?.phrase ?? Infinity,
      };
    };
    for (let phrase = planned.from; phrase <= planned.to; phrase++) {
      if (!boxes.some((b) => span(b.id).from <= phrase && phrase < span(b.id).to)) {
        problems.push(`en p${phrase + 1} la pantalla queda vacia: no ocultes todo antes de que termine la escena`);
        break;
      }
    }
    const left = Math.min(...boxes.map((b) => b.x - b.w / 2));
    const right = Math.max(...boxes.map((b) => b.x + b.w / 2));
    if (right - left < MIN_FRAME_SPAN) problems.push(`usa poco el cuadro (${Math.round(right - left)}% del ancho): distribui mejor la escena`);
    const phrases = planned.to - planned.from + 1;
    const seconds = end - this.phrases[planned.from]!.start;
    const cameras = steps.filter((s) => s.step.action === "camera").length;
    if (cameras > Math.ceil(seconds / SECONDS_PER_CAMERA)) problems.push(`demasiada camara: ${cameras} movimientos en ${Math.round(seconds)} segundos`);
    const active = steps.filter((s) => s.step.action !== "show" && s.step.action !== "hide").length;
    const loops = steps.filter((s) => s.step.action === "loop").length;
    if (loops > MAX_LOOPS) problems.push(`demasiado movimiento decorativo: ${loops} loop, como mucho ${MAX_LOOPS}`);
    if (active < phrases * MIN_MOTION_PER_PHRASE) problems.push(`poco movimiento: ${active} pasos para ${phrases} frases, hacen falta al menos ${Math.ceil(phrases * MIN_MOTION_PER_PHRASE)}`);
    for (const st of steps.filter((s) => s.step.action === "move" && !(s.step as { part?: string }).part)) {
      const box = boxes.find((b) => b.id === st.step.target);
      if (box && box.w > MAX_MOVING_WIDTH) problems.push(`${box.id}: es grande y no se traslada; move solo para objetos chicos, a lo grande movele partes`);
    }
    const characters = boxes.filter((b) => {
      const parts = this.library.get(elements.find((e) => e.id === b.id)?.component ?? "")?.parts ?? {};
      return SKELETON.every((p) => p in parts);
    });
    const acts = steps.filter((s) => s.step.action === "act").length;
    if (characters.length > 0 && acts < Math.ceil(phrases / PHRASES_PER_ACT)) problems.push(`el personaje casi no actua: ${acts} acciones para ${phrases} frases`);
    for (const st of steps.filter((s) => s.step.action === "act")) {
      const owner = elements.find((e) => e.id === st.step.target);
      const parts = this.library.get(owner?.component ?? "")?.parts ?? {};
      if (!SKELETON.every((p) => p in parts)) problems.push(`${st.step.target}: no tiene el esqueleto de personaje, no puede usar act`);
    }
    return [...new Set(problems)];
  }

  // Ids del texto que sobra en una escena con dibujos: todo menos hasta
  // MAX_LABELS etiquetas que no toquen ningun dibujo.
  private extraText(elements: SceneElement[]): Set<string> {
    const boxes = elements.filter((e) => e.kind === "drawing").flatMap((e) => this.box(e) ?? []);
    if (boxes.length === 0) return new Set();
    const extra = new Set<string>();
    let labels = 0;
    for (const e of elements) {
      if (e.kind === "drawing" || e.kind === "graphic") continue;
      const lw = (e.text?.length ?? 0) * 1;
      const touches = boxes.some((b) => Math.abs((e.x ?? 50) - b.x) < (lw + b.w) / 2 && Math.abs((e.y ?? 50) - b.y) < (LABEL_HEIGHT + b.h) / 2);
      if (e.kind === "label" && !touches && labels < MAX_LABELS) labels += 1;
      else extra.add(e.id);
    }
    return extra;
  }

  private async submitScenes(input: Record<string, unknown>) {
    const tramo = Number(input.tramo);
    const group = this.groups[tramo - 1];
    if (!group) return { text: `No existe el tramo ${String(input.tramo)}.`, isError: true };
    const attempt = this.nextAttempt(`tramo${tramo}`);

    const byIndex = new Map(group.scenes.map((s) => [s.index, s] as [number, PlannedScene]));
    const seen = new Set<number>();
    const rejected: string[] = [];
    for (const raw of asList(input.scenes, "scenes").map((s) => s as Record<string, unknown>)) {
      const planned = byIndex.get(raw.scene_index as number);
      if (!planned) continue;
      seen.add(planned.index);
      const { elements, steps, dropped } = await verifyScene(raw, planned, this.phrases, this.fullNorm, this.fullText, this.types, this.library);
      const problems = [...dropped];
      if (!elements.some((e) => e.kind === "drawing" || e.kind === "graphic")) problems.push("no tiene dibujo: la imagen tiene que contar la idea");
      problems.push(...this.layoutProblems(elements, raw, steps), ...this.motionProblems(planned, elements, steps));
      for (const e of elements) {
        if (e.spec?.type === "timeline" && (e.spec.items?.length ?? 0) < MIN_TIMELINE_ITEMS) problems.push(`${e.id}: una linea de tiempo necesita al menos ${MIN_TIMELINE_ITEMS} hitos historicos con fecha; si no, usa otro recurso`);
      }
      const extra = this.extraText(elements);
      if (extra.size > 0) problems.push(`texto de mas (${[...extra].join(", ")}): sacalo, la voz ya lo dice; un label no puede tocar un dibujo`);
      // Se guarda la mejor version: un reintento peor no pisa a la anterior.
      // El texto de mas se quita igual: nunca llega a pantalla.
      if (problems.length <= (this.best.get(planned.index) ?? Infinity)) {
        this.best.set(planned.index, problems.length);
        const clean = asList(raw.elements, "elements").filter((e) => !extra.has((e as { id?: string }).id ?? ""));
        // Si queda una pantalla vacia, lo oculto se mantiene hasta el final.
        const empty = problems.some((p) => p.includes("pantalla queda vacia"));
        const kept = asList(raw.steps, "steps").filter((st) => !empty || (st as { action?: unknown }).action !== "hide");
        this.designed.set(planned.index, { ...raw, elements: clean, steps: kept });
      }
      if (problems.length > 0) rejected.push(`ESCENA ${planned.index}: ${problems.join("; ")}`);
    }
    for (const scene of group.scenes) {
      if (!seen.has(scene.index) && !this.designed.has(scene.index)) rejected.push(`ESCENA ${scene.index}: falta entregarla`);
    }

    if (rejected.length === 0 || attempt >= MAX_ATTEMPTS) {
      this.doneTramos.add(tramo);
      return { text: rejected.length === 0 ? "LISTO: todas las escenas pasaron." : "LISTO: sin mas intentos, queda la mejor version de cada escena." };
    }
    return { text: `RECHAZOS (intento ${attempt} de ${MAX_ATTEMPTS}):\n${rejected.join("\n")}` };
  }
}

// ---------- Sesion ----------

class SessionStopped extends Error {}

// El stream se corta en sesiones largas y no reenvia lo que se perdio: al
// reconectar se lee el historial para responder las herramientas pendientes y
// saber si la sesion ya termino.
async function runSession(client: Anthropic, sessionId: string, firstMessage: string, tools: SceneTools): Promise<void> {
  const answered = new Set<string>();
  const answer = async (id: string, name: string, input: unknown) => {
    if (answered.has(id)) return;
    answered.add(id);
    const result = await tools.run(name, input as Record<string, unknown>).catch((err: Error) => ({ text: err.message, isError: true }));
    await client.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: "user.custom_tool_result",
          custom_tool_use_id: id,
          content: [{ type: "text", text: result.text }],
          ...("isError" in result && result.isError ? { is_error: true } : {}),
        },
      ],
    });
  };
  // true cuando la sesion termino bien.
  const onStatus = (type: string, stopReason?: string): boolean => {
    if (type === "session.status_terminated") throw new SessionStopped("sesion terminada");
    if (type !== "session.status_idle") return false;
    if (stopReason === "end_turn") return true;
    if (stopReason !== "requires_action") throw new SessionStopped(`sesion frenada: ${stopReason}`);
    return false;
  };

  const deadlineAt = Date.now() + SESSION_TIMEOUT_MS;
  for (let attempt = 0; attempt <= MAX_RECONNECTS && Date.now() < deadlineAt; attempt++) {
    try {
      const stream = await client.beta.sessions.events.stream(sessionId);
      const deadline = setTimeout(() => stream.controller.abort(), deadlineAt - Date.now());
      try {
        if (attempt === 0) {
          await client.beta.sessions.events.send(sessionId, {
            events: [{ type: "user.message", content: [{ type: "text", text: firstMessage }] }],
          });
        } else {
          const history = [];
          for await (const event of client.beta.sessions.events.list(sessionId)) history.push(event);
          for (const event of history) if (event.type === "user.custom_tool_result") answered.add(event.custom_tool_use_id);
          for (const event of history) if (event.type === "agent.custom_tool_use") await answer(event.id, event.name, event.input);
          const last = history.filter((e) => e.type === "session.status_idle" || e.type === "session.status_running" || e.type === "session.status_terminated").at(-1);
          if (last && onStatus(last.type, last.type === "session.status_idle" ? last.stop_reason.type : undefined)) return;
        }
        for await (const event of stream) {
          if (event.type === "agent.custom_tool_use") await answer(event.id, event.name, event.input);
          else if (event.type === "session.error") console.warn("[managed_director] error de sesion:", JSON.stringify(event.error));
          else if (event.type === "session.status_idle" || event.type === "session.status_terminated") {
            if (onStatus(event.type, event.type === "session.status_idle" ? event.stop_reason.type : undefined)) return;
          }
        }
      } finally {
        clearTimeout(deadline);
      }
    } catch (err) {
      if (err instanceof SessionStopped) throw err;
      console.warn("[managed_director] se corto el stream:", (err as Error).message);
    }
  }
  throw new Error("la sesion no termino a tiempo");
}

export async function directAnimatedScenesManaged(input: {
  phrases: Phrase[];
  videoTopic?: string;
  theme?: PaletteTheme;
  nav: { channel: string | null; topic: string | null; locale: string | null };
}): Promise<AnimatedPlan | null> {
  const { phrases } = input;
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key || phrases.length === 0) return null;
  const client = new Anthropic({ apiKey: provider.api_key });
  const title = input.videoTopic ?? "Video todo animado";
  const tools = new SceneTools(phrases);
  const spent: string[] = [];

  const work = async (agent: string, label: string, budgetCents: string, message: string) => {
    const session = await client.beta.sessions.create({
      agent,
      environment_id: MANAGED_AGENTS.environmentId,
      title: `${label} · ${title}`.slice(0, 200),
      budget: { type: "limit", max_list_cost: { amount: budgetCents, currency: "USD" } },
    });
    spent.push(session.id);
    await runSession(client, session.id, message, tools);
  };
  // Un fallo de un lote o tramo no corta el resto: queda pendiente para la
  // vuelta siguiente, y si sigue faltando la escena cae en su primera frase.
  const spread = async (agent: string, label: string, verb: string, pending: () => number[]) => {
    for (let round = 0; round < WORK_ROUNDS && pending().length > 0; round++) {
      await mapWithConcurrency(pending(), WORKERS, async (n) => {
        await work(agent, `${label} ${n}`, WORKER_BUDGET_CENTS, `${verb} ${n}`).catch((err: Error) => console.warn(`[managed_director] ${label} ${n}:`, err.message));
      });
    }
  };

  const script = phrases.map((p) => `[${p.id} · ${clock(p.start)}] ${p.text}`).join("\n");
  await work(
    MANAGED_AGENTS.directorAgentId,
    "Director",
    directorBudgetCents(phrases[phrases.length - 1]!.end),
    `${input.videoTopic ? `Tema del video: ${input.videoTopic}\n` : ""}Duracion: ${clock(phrases[phrases.length - 1]!.end)}\n\nGUION EN FRASES:\n${script}`
  );
  if (!tools.structure) throw new Error("el director no entrego la estructura");
  await spread(MANAGED_AGENTS.artistAgentId, "Dibujante", "Dibuja el lote", () => tools.lotsPending);
  await spread(MANAGED_AGENTS.designerAgentId, "Disenador", "Disena el tramo", () => tools.tramosPending);
  console.log(`[managed_director] ${spent.length} sesiones · dibujos ${tools.library.size} · lotes pendientes ${tools.lotsPending.length} · tramos pendientes ${tools.tramosPending.length}`);

  const nav = { ...input.nav, topic: tools.shortTitle ?? input.nav.topic };
  const buildPlan = (managed: { session_id: string; usage: unknown }) =>
    assemblePlan({
      phrases,
      structure: tools.structure!,
      designed: tools.designed,
      types: visualTypes(),
      nav,
      models: { director: DIRECTOR_MODEL, designer: DESIGNER_MODEL },
      usage: {},
      managed,
      components: tools.library,
    });

  // Revisor y Auditor miran capturas reales; lo rechazado vuelve a Escenas con
  // los motivos. Si el control falla, el video sigue con lo que hay. Sin motion
  // instalado (la API en Render) no hay capturas: lo hace el worker.
  const reviewUsage: Record<string, number> = {};
  const pendingScenes: string[] = [];
  if (motionCatalog()) {
    const dir = await makeWorkDir("skaler-review-");
    try {
      for (let round = 0; round <= REVIEW_ROUNDS; round++) {
        const plan = await buildPlan({ session_id: spent[0]!, usage: {} });
        await renderAnimatedStills(
          { scenes: plan.scenes, components: plan.components, nav: plan.nav, durationSeconds: plan.durationSeconds, ...(input.theme ? { theme: input.theme } : {}), locale: input.nav.locale ?? "es-AR" },
          stillRequests(plan.scenes),
          dir
        );
        const verdicts = await reviewScenes(client, plan, phrases, dir, reviewUsage);
        const audit = await auditVideo(client, plan, phrases, dir, verdicts, reviewUsage);
        const rejected = new Map<string, string[]>();
        for (const v of verdicts) if (!v.approved && !audit.wrong_rejections.includes(v.scene)) rejected.set(v.scene, v.problems);
        for (const v of audit.missed) rejected.set(v.scene, [...(rejected.get(v.scene) ?? []), ...v.problems]);
        console.log(`[managed_director] control ${round + 1}: ${rejected.size} de ${plan.scenes.length} escenas rechazadas`);
        pendingScenes.splice(0, pendingScenes.length, ...rejected.keys());
        if (rejected.size === 0 || round === REVIEW_ROUNDS) break;
        for (const [scene, problems] of rejected) tools.reopen(scene, problems);
        await spread(MANAGED_AGENTS.designerAgentId, "Correccion", "Corrige el tramo", () => tools.tramosPending);
      }
    } catch (err) {
      console.warn("[managed_director] el control de calidad fallo:", (err as Error).message);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const sessions = await Promise.all(spent.map((id) => client.beta.sessions.retrieve(id)));
  const costCents = sessions.reduce((sum, s) => sum + Number(s.usage.list_cost?.amount ?? 0), 0);
  return buildPlan({ session_id: spent[0]!, usage: { sessions: spent.length, cost_cents: costCents, review_tokens: reviewUsage, pending_scenes: pendingScenes } });
}

// Punto de entrada del formato animado: Managed Agents si esta configurado,
// y si no (o si falla) el esquema paso a paso.
export async function directScenes(input: {
  phrases: Phrase[];
  videoTopic?: string;
  theme?: PaletteTheme;
  nav: { channel: string | null; topic: string | null; locale: string | null };
}): Promise<AnimatedPlan | null> {
  // Formato documental (recursos): primero; si esta apagado o falla, el anterior.
  try {
    const plan = await directDocumental(input);
    if (plan) return plan;
  } catch (err) {
    console.warn("[documental] fallo, sigo con el formato anterior:", (err as Error).message);
  }
  if (MANAGED_AGENTS.directorAgentId && MANAGED_AGENTS.environmentId) {
    try {
      const plan = await directAnimatedScenesManaged(input);
      if (plan) return plan;
    } catch (err) {
      console.warn("[managed_director] fallo, sigo paso a paso:", (err as Error).message);
    }
  }
  return directAnimatedScenes(input);
}
