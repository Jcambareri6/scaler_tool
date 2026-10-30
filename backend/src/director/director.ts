import Anthropic from "@anthropic-ai/sdk";
import { getActiveProvider } from "../lib/providers.js";
import { withRetry } from "../lib/retry.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { getNiche, nicheIds } from "../lib/niches.js";
import { supportedOverlayIcons } from "../lib/motion.js";
import { generateOverlayTool } from "../tools/generateOverlay.tool.js";
import type { OverlaySpec, OverlayType } from "../types/shared/typeShared.js";
import { INTENTS, MANUAL, manualSummary } from "./manual.js";

// Director de graficos (DISENO-director-graficos.md, hub-and-spoke):
// 1. El DIRECTOR lee el guion entero y devuelve un storyboard: estructura
//    (gancho, capitulos, climax, cierre) y momentos (escena, intencion,
//    intensidad, recurso elegido y por que). Sin textos todavia.
// 2. Un VERIFICADOR de codigo ordena el ritmo con el manual: fatiga por
//    recurso, topes, nada tres veces seguido, presupuesto, y una tarjeta de
//    capitulo en cada capitulo detectado.
// 3. DISENADORES, uno por capitulo y en paralelo, completan los datos de
//    cada momento copiando del guion.
// 4. El verificador valida cada grafico en modo estricto (generate_overlay);
//    los rechazados vuelven UNA vez a su disenador con el motivo, y si
//    fallan de nuevo se descartan (el grafico, nunca el video).
// Si algo del director falla, plan_overlays sigue con el planificador de
// siempre: este modulo devuelve null y nunca tira el video.

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_DESIGNER_MODEL = "claude-haiku-5-5";
const LLM_TIMEOUT_MS = 180 * 1000;
const DIRECTOR_MAX_TOKENS = 10000;
const DESIGNER_MAX_TOKENS = 8000;
const MAX_SCRIPT_CHARS = 60000;
const DESIGNER_CONCURRENCY = 4;
const MAX_PER_SCENE = 3;
// Presupuesto: un grafico cada ~15 s como maximo (el director apunta a ~25);
// las tarjetas de capitulo no cuentan, son estructura.
const MAX_SECONDS_PER_OVERLAY = 15;
const TARGET_SECONDS_PER_OVERLAY = 25;

export interface DirectorScene {
  order: number;
  text: string;
  duration_seconds?: number;
}

export interface DirectorDeps {
  types: OverlayType[];
  // Que hace cada tipo y que campos lleva (TYPE_GUIDE de plan_overlays).
  typeGuide: Partial<Record<OverlayType, string>>;
  // Respuesta cruda del LLM -> OverlaySpec (toOverlaySpec de plan_overlays).
  toSpec: (raw: unknown, types: OverlayType[]) => OverlaySpec | null;
}

export interface StoryMoment {
  id: number;
  scene: number;
  intent: string;
  intensity: number;
  type: OverlayType;
  why: string;
  status: "ok" | "dropped";
  reason?: string;
}

export interface Storyboard {
  structure: {
    hook_scenes: number[];
    chapters: { start_scene: number; title: string }[];
    climax_scene: number | null;
    closing_scene: number | null;
  };
  moments: StoryMoment[];
  models: { director: string; designer: string };
  // Tokens por modelo (entrada / salida) de este video.
  usage: Record<string, { input: number; output: number }>;
}

export interface DirectorResult {
  overlays: Record<number, OverlaySpec[]>;
  niche: string | null;
  storyboard: Storyboard;
}

function asList(value: unknown, key: string): unknown[] {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) v = (v as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------- 1. Director ----------

function directorSystem(types: OverlayType[]): string {
  const niches = nicheIds()
    .map((id) => {
      const n = getNiche(id)!;
      return `- ${id}: ${n.name}${Array.isArray(n.favor) && n.favor.length ? ` (favorece: ${n.favor.join(", ")})` : ""}`;
    })
    .join("\n");
  return `Sos el DIRECTOR de graficos animados de un canal de YouTube faceless. Sobre el video de stock se superponen graficos que refuerzan la narracion. No escribis los graficos: decidis QUE mostrar, DONDE y POR QUE, como un editor humano que entiende el video entero. Otros disenadores completan los textos despues.

Trabaja en este orden:
1. ESTRUCTURA: marca las escenas del gancho (el arranque que engancha), los capitulos o partes reales del video (donde de verdad cambia de tema o de acto, aunque no diga "capitulo"; un video corto puede no tener), el climax (el momento mas fuerte) y el cierre. Para cada capitulo, un titulo corto COPIADO del guion.
2. INTENCIONES: para cada momento importante, que tiene que pasar en la cabeza del espectador: ${INTENTS.join(", ")}.
3. CURVA DE INTENSIDAD: el gancho y el climax llevan los recursos mas fuertes (intensidad 3); deja tramos sin graficos a proposito para que el video respire; no pongas dos de intensidad 3 seguidos sin un respiro.
4. ASIGNACION: para cada momento elegi el recurso del manual que mejor resuelve esa intencion, respetando fatiga y topes, y variando: el mismo dato puede ir como cifra, comparacion o mapa segun lo que se quiere provocar. Solo pone un momento si el guion tiene el material literal para ese recurso (cifras, nombres, lugares, pasos).
5. Para cada momento, en "why", una frase corta: que dice la voz y por que ese recurso.

RITMO: apunta a un grafico cada ~${TARGET_SECONDS_PER_OVERLAY} segundos en total, maximo ${MAX_PER_SCENE} por escena. Al inicio de cada capitulo va un title_card (ponelo en los momentos).

MANUAL (recurso: intenciones · intensidad · fatiga · cuando no):
${manualSummary(types)}

NICHO: clasifica el video entero en UNO de estos (campo "niche"), y usa sus recursos favoritos cuando encajen:
${niches}`;
}

function directorTool(types: OverlayType[]): Anthropic.Tool {
  return {
    name: "return_storyboard",
    description: "Devuelve la estructura del video y los momentos con grafico.",
    input_schema: {
      type: "object",
      properties: {
        niche: { type: "string", enum: nicheIds() },
        structure: {
          type: "object",
          properties: {
            hook_scenes: { type: "array", items: { type: "number" } },
            chapters: {
              type: "array",
              items: {
                type: "object",
                properties: { start_scene: { type: "number" }, title: { type: "string" } },
                required: ["start_scene", "title"],
              },
            },
            climax_scene: { type: "number" },
            closing_scene: { type: "number" },
          },
          required: ["hook_scenes", "chapters"],
        },
        moments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene: { type: "number" },
              intent: { type: "string", enum: INTENTS },
              intensity: { type: "number", enum: [1, 2, 3] },
              type: { type: "string", enum: types },
              why: { type: "string" },
            },
            required: ["scene", "intent", "intensity", "type", "why"],
          },
        },
      },
      required: ["niche", "structure", "moments"],
    },
  };
}

function scriptBlock(scenes: DirectorScene[], starts: Map<number, number>): string {
  let budget = MAX_SCRIPT_CHARS;
  const lines: string[] = [];
  for (const scene of scenes) {
    const line = `[Escena ${scene.order} · ${clock(starts.get(scene.order) ?? 0)}${scene.duration_seconds ? ` · ${Math.round(scene.duration_seconds)}s` : ""}]\n${scene.text.trim()}`;
    if (line.length > budget) break;
    budget -= line.length;
    lines.push(line);
  }
  return lines.join("\n\n");
}

// ---------- 2. Verificador de ritmo (codigo) ----------

function applyRhythm(
  moments: StoryMoment[],
  chapters: Storyboard["structure"]["chapters"],
  starts: Map<number, number>,
  totalSeconds: number,
  protectedScenes: Set<number>,
  types: OverlayType[]
): void {
  const drop = (m: StoryMoment, reason: string) => {
    m.status = "dropped";
    m.reason = reason;
  };
  // Tarjeta de capitulo al inicio de cada capitulo (con 2 o mas): la capa
  // fija de navegacion sale de ahi.
  if (chapters.length >= 2 && types.includes("title_card")) {
    for (const ch of chapters) {
      if (!moments.some((m) => m.scene === ch.start_scene && m.type === "title_card")) {
        moments.push({ id: moments.length + 1, scene: ch.start_scene, intent: "estructura", intensity: 3, type: "title_card", why: `inicio del capitulo "${ch.title}"`, status: "ok" });
      }
    }
  }
  moments.sort((a, b) => a.scene - b.scene || (a.type === "title_card" ? -1 : b.type === "title_card" ? 1 : a.id - b.id));

  const lastAt = new Map<OverlayType, number>();
  const count = new Map<OverlayType, number>();
  const perScene = new Map<number, number>();
  let run: OverlayType | null = null;
  let runLength = 0;
  for (const m of moments) {
    const t = starts.get(m.scene) ?? 0;
    const ficha = MANUAL[m.type];
    const last = lastAt.get(m.type);
    if (ficha && last !== undefined && t - last < ficha.minGapSeconds && m.type !== "title_card") {
      drop(m, `fatiga: ${m.type} repetido a ${Math.round(t - last)}s (minimo ${ficha.minGapSeconds}s)`);
      continue;
    }
    if (ficha?.maxPerVideo && (count.get(m.type) ?? 0) >= ficha.maxPerVideo) {
      drop(m, `tope: ${m.type} max ${ficha.maxPerVideo} por video`);
      continue;
    }
    if ((perScene.get(m.scene) ?? 0) >= MAX_PER_SCENE) {
      drop(m, `escena ${m.scene} ya tiene ${MAX_PER_SCENE}`);
      continue;
    }
    if (run === m.type && runLength >= 2) {
      drop(m, `${m.type} tres veces seguidas`);
      continue;
    }
    lastAt.set(m.type, t);
    count.set(m.type, (count.get(m.type) ?? 0) + 1);
    perScene.set(m.scene, (perScene.get(m.scene) ?? 0) + 1);
    runLength = run === m.type ? runLength + 1 : 1;
    run = m.type;
  }

  // Presupuesto (sin contar capitulos): si se pasa, se sacan primero los de
  // menor intensidad fuera del gancho y el climax.
  const max = Math.max(3, Math.ceil(totalSeconds / MAX_SECONDS_PER_OVERLAY));
  const kept = () => moments.filter((m) => m.status === "ok" && m.type !== "title_card");
  const candidates = kept()
    // El pedido de suscripcion tampoco: si el guion lo pide, va.
    .filter((m) => m.type !== "title_card" && m.intent !== "pedir" && !protectedScenes.has(m.scene))
    .sort((a, b) => a.intensity - b.intensity || b.scene - a.scene);
  while (kept().length > max && candidates.length > 0) {
    drop(candidates.shift()!, `presupuesto: mas de ${max} graficos para ${Math.round(totalSeconds)}s`);
  }
}

// ---------- 3. Disenadores ----------

function designerSystem(types: OverlayType[], typeGuide: DirectorDeps["typeGuide"]): string {
  const icons = types.includes("scale_compare") && supportedOverlayIcons().length
    ? `\nICONOS (campo "icon", solo scale_compare): ${supportedOverlayIcons().join(", ")}.\n`
    : "";
  return `Sos DISENADOR de graficos animados. El director ya decidio que grafico va en cada momento de tu capitulo; vos completas sus datos copiando del guion.

RECURSOS (que lleva cada uno):
${types.map((t) => `- ${t}: ${typeGuide[t] ?? ""}`).join("\n")}
${icons}
REGLAS ESTRICTAS:
1. "text", "label", items[].text e items[].label son fragmentos COPIADOS LITERALMENTE del guion de la escena del momento (mismas palabras, mismos numeros, misma escritura). Nunca inventes, redondees, traduzcas ni reformules. Un verificador de codigo rechaza todo lo que no este literal.
2. Textos cortos: text <= 6 palabras (salvo title_card, kinetic_quote y pivot_question <= 8), label <= 5 palabras, items[].label <= 3 palabras.
3. Mapas: "lat" y "lon" son las coordenadas reales del lugar (no se muestran).
4. Si un momento no tiene material literal suficiente para su recurso, no lo devuelvas: es mejor un grafico menos que uno forzado.
5. Devolve cada grafico con el "moment_id" del momento que resuelve.`;
}

function designerTool(): Anthropic.Tool {
  return {
    name: "return_graphics",
    description: "Devuelve los graficos completos de los momentos del capitulo.",
    input_schema: {
      type: "object",
      properties: {
        graphics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              moment_id: { type: "number" },
              text: { type: "string" },
              label: { type: "string" },
              items: {
                type: "array",
                items: { type: "object", properties: { label: { type: "string" }, text: { type: "string" } }, required: ["text"] },
              },
              icon: { type: "string" },
              lat: { type: "number" },
              lon: { type: "number" },
              ref: {
                type: "object",
                properties: { name: { type: "string" }, lat: { type: "number" }, lon: { type: "number" } },
                required: ["name", "lat", "lon"],
              },
            },
            required: ["moment_id", "text"],
          },
        },
      },
      required: ["graphics"],
    },
  };
}

// Tokens gastados por modelo en un video (se guardan en el storyboard para
// saber el costo real del director).
type Usage = Record<string, { input: number; output: number }>;

async function callTool(
  client: Anthropic,
  model: string,
  maxTokens: number,
  system: string,
  tool: Anthropic.Tool,
  user: string,
  usage: Usage
): Promise<Record<string, unknown> | undefined> {
  const response = await withRetry(() =>
    client.messages
      .stream({
        model,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: user }],
      })
      .finalMessage()
  );
  const spent = (usage[model] ??= { input: 0, output: 0 });
  spent.input += response.usage.input_tokens;
  spent.output += response.usage.output_tokens;
  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return block?.input as Record<string, unknown> | undefined;
}

// ---------- Todo junto ----------

export async function directOverlays(scenes: DirectorScene[], videoTopic: string | undefined, deps: DirectorDeps): Promise<DirectorResult | null> {
  if (process.env.OVERLAY_DIRECTOR === "off") return null;
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key) return null;
  const config = provider.configuration ?? {};
  const directorModel = (config.director_model as string | undefined) ?? (config.model as string | undefined) ?? DEFAULT_MODEL;
  // Disenadores en Haiku: copian datos del guion con instrucciones cerradas,
  // no necesitan el modelo del director y salen ~20 veces mas baratos.
  const designerModel = (config.designer_model as string | undefined) ?? DEFAULT_DESIGNER_MODEL;
  const client = new Anthropic({ apiKey: provider.api_key, timeout: LLM_TIMEOUT_MS });
  const usage: Usage = {};

  const starts = new Map<number, number>();
  let at = 0;
  for (const s of scenes) {
    starts.set(s.order, at);
    // Sin duracion (escenas todavia sin timing): ~2,5 palabras por segundo,
    // para que fatiga y presupuesto sigan teniendo sentido.
    at += s.duration_seconds ?? s.text.trim().split(/\s+/).length / 2.5;
  }
  const totalSeconds = at;
  const byOrder = new Map(scenes.map((s) => [s.order, s]));
  const fullText = scenes.map((s) => s.text).join("\n");

  // 1. Director.
  const header = [
    videoTopic ? `Tema del video: ${videoTopic}` : null,
    totalSeconds > 0 ? `Duracion total: ${clock(totalSeconds)} -> unos ${Math.max(1, Math.round(totalSeconds / TARGET_SECONDS_PER_OVERLAY))} graficos en total.` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await callTool(
    client,
    directorModel,
    DIRECTOR_MAX_TOKENS,
    directorSystem(deps.types),
    directorTool(deps.types),
    `${header}\n\nGUION POR ESCENAS (numero · minuto · duracion):\n\n${scriptBlock(scenes, starts)}`,
    usage
  );
  if (!raw) return null;

  const structureRaw = (raw.structure ?? {}) as Record<string, unknown>;
  const chapters = asList(structureRaw.chapters, "chapters")
    .map((c) => c as { start_scene?: unknown; title?: unknown })
    .filter((c): c is { start_scene: number; title: string } => typeof c.start_scene === "number" && byOrder.has(c.start_scene) && typeof c.title === "string")
    .sort((a, b) => a.start_scene - b.start_scene);
  const structure: Storyboard["structure"] = {
    hook_scenes: asList(structureRaw.hook_scenes, "hook_scenes").filter((n): n is number => typeof n === "number"),
    chapters,
    climax_scene: typeof structureRaw.climax_scene === "number" ? structureRaw.climax_scene : null,
    closing_scene: typeof structureRaw.closing_scene === "number" ? structureRaw.closing_scene : null,
  };
  const moments: StoryMoment[] = asList(raw.moments, "moments")
    .map((m) => m as Record<string, unknown>)
    .filter((m) => typeof m.scene === "number" && byOrder.has(m.scene) && deps.types.includes(m.type as OverlayType))
    .map((m, i) => ({
      id: i + 1,
      scene: m.scene as number,
      intent: typeof m.intent === "string" ? m.intent : "",
      intensity: typeof m.intensity === "number" ? m.intensity : 2,
      type: m.type as OverlayType,
      why: typeof m.why === "string" ? m.why : "",
      status: "ok" as const,
    }));
  if (moments.length === 0) return null;

  // 2. Ritmo.
  const protectedScenes = new Set([...structure.hook_scenes, ...(structure.climax_scene !== null ? [structure.climax_scene] : [])]);
  applyRhythm(moments, structure.chapters, starts, totalSeconds, protectedScenes, deps.types);

  // 3 y 4. Disenadores por capitulo + verificacion estricta con un reintento.
  const bounds = structure.chapters.map((c) => c.start_scene);
  const groupOf = (scene: number) => bounds.filter((b) => b <= scene).length;
  const groups = new Map<number, StoryMoment[]>();
  for (const m of moments.filter((m) => m.status === "ok")) {
    const g = groupOf(m.scene);
    groups.set(g, [...(groups.get(g) ?? []), m]);
  }
  const specs = new Map<number, OverlaySpec>();

  const verify = async (moment: StoryMoment, rawGraphic: Record<string, unknown>): Promise<string | null> => {
    const spec = deps.toSpec({ ...rawGraphic, type: moment.type }, deps.types);
    if (!spec) return "faltan datos o el formato no es valido";
    try {
      const { overlay } = await generateOverlayTool.execute(
        { scene_id: "", script_text: byOrder.get(moment.scene)!.text, full_text: fullText, overlay: spec },
        { userId: "" }
      );
      specs.set(moment.id, overlay);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  };

  const designerSys = designerSystem(deps.types, deps.typeGuide);
  await mapWithConcurrency([...groups.entries()], DESIGNER_CONCURRENCY, async ([group, groupMoments]) => {
    const sceneNumbers = [...new Set(groupMoments.map((m) => m.scene))];
    const sceneTexts = sceneNumbers.map((n) => `[Escena ${n}]\n${byOrder.get(n)!.text.trim()}`).join("\n\n");
    const title = group === 0 ? "Antes del primer capitulo" : `Capitulo: ${structure.chapters[group - 1]?.title ?? group}`;
    const momentLines = (list: StoryMoment[]) =>
      list.map((m) => `- moment_id ${m.id} · escena ${m.scene} · ${m.type} · intencion ${m.intent} · ${m.why}`).join("\n");

    let pending = groupMoments;
    let feedback = "";
    const lastReason = new Map<number, string>();
    for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
      let out: Record<string, unknown> | undefined;
      try {
        out = await callTool(
          client,
          designerModel,
          DESIGNER_MAX_TOKENS,
          designerSys,
          designerTool(),
          `${title}\n\nGUION DE TUS ESCENAS:\n\n${sceneTexts}\n\nMOMENTOS A COMPLETAR:\n${momentLines(pending)}${feedback}`,
          usage
        );
      } catch (err) {
        console.warn(`[director] disenador "${title}" fallo:`, (err as Error).message);
        break;
      }
      const graphics = asList(out?.graphics, "graphics").map((g) => g as Record<string, unknown>);
      const failed: { moment: StoryMoment; reason: string }[] = [];
      for (const moment of pending) {
        const graphic = graphics.find((g) => g.moment_id === moment.id);
        const reason = graphic ? await verify(moment, graphic) : "el disenador no lo completo";
        if (reason) failed.push({ moment, reason });
      }
      for (const f of failed) lastReason.set(f.moment.id, f.reason);
      pending = failed.map((f) => f.moment);
      feedback = `\n\nEN EL INTENTO ANTERIOR ESTOS FALLARON LA VERIFICACION (corregilos copiando literal del guion, o no los devuelvas):\n${failed
        .map((f) => `- moment_id ${f.moment.id}: ${f.reason}`)
        .join("\n")}`;
    }
    // Lo que no paso en ningun intento (o quedo sin disenar) se descarta.
    for (const m of groupMoments) {
      if (specs.has(m.id)) continue;
      m.status = "dropped";
      m.reason = `verificacion: ${lastReason.get(m.id) ?? "sin disenar"}`;
    }
  });

  const overlays: Record<number, OverlaySpec[]> = {};
  for (const m of moments) {
    const spec = specs.get(m.id);
    if (m.status !== "ok" || !spec) continue;
    overlays[m.scene] = [...(overlays[m.scene] ?? []), spec].slice(0, MAX_PER_SCENE);
  }
  const kept = moments.filter((m) => m.status === "ok" && specs.has(m.id)).length;
  console.log(
    `[director] ${structure.chapters.length} capitulos, ${moments.length} momentos, ${kept} graficos aprobados (${groups.size} disenadores, ${directorModel}/${designerModel})`
  );
  if (kept === 0) return null;
  return {
    overlays,
    niche: typeof raw.niche === "string" && getNiche(raw.niche) ? raw.niche : null,
    storyboard: { structure, moments, models: { director: directorModel, designer: designerModel }, usage },
  };
}
