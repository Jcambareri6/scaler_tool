import Anthropic from "@anthropic-ai/sdk";
import { getActiveProvider } from "../lib/providers.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { captionChunks, type CaptionChunk } from "../lib/captions.js";
import { placeNavHeaders, type PlacedOverlay } from "../lib/overlayTiming.js";
import { appearsIn, generateOverlayTool, normalize } from "../tools/generateOverlay.tool.js";
import { TYPE_GUIDE, plannableTypes, toOverlaySpec } from "../tools/planOverlays.tool.js";
import type { OverlaySpec, OverlayType } from "../types/shared/typeShared.js";
import { asList, callTool, clock, type Usage } from "./director.js";
import { INTENTS } from "./manual.js";
import type { Phrase } from "./phrases.js";

// Director de ESCENAS del formato todo animado (fase 3). Mismo esquema
// hub-and-spoke que el director de graficos (director.ts):
// 1. El DIRECTOR (modelo grande) lee las frases con su tiempo y arma la
//    estructura: capitulos y escenas (que frases cubre cada una, intencion e
//    idea visual).
// 2. DISENADORES de escenas (Haiku), uno por capitulo y en paralelo, arman
//    los elementos de cada escena y los pasos atados a frases.
// 3. El VERIFICADOR (codigo): todo texto en pantalla sale del guion, cada
//    grafico pasa por generate_overlay, los pasos caen dentro de su escena.
//    Lo que falla se descarta; una escena que queda vacia muestra su primera
//    frase, asi nunca hay pantalla en blanco.
// El resultado son las props de la composicion AnimatedVideo
// (motion/src/scenes): escenas + capa fija + subtitulos.

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_DESIGNER_MODEL = "claude-haiku-5-5";
const LLM_TIMEOUT_MS = 180 * 1000;
const DIRECTOR_MAX_TOKENS = 12000;
const DESIGNER_MAX_TOKENS = 12000;
const DESIGNER_CONCURRENCY = 4;
const MAX_ELEMENTS = 6;
const MAX_FALLBACK_WORDS = 14;
// Largo maximo de un texto propio (no literal) en pantalla.
const MAX_OWN_WORDS = 8;
// Aire despues de la ultima palabra.
const TAIL_SECONDS = 0.8;

const KINDS = ["title", "text", "number", "chip", "card", "graphic"] as const;
const SLOTS = ["top", "center", "left", "right", "bottom", "full"] as const;
const ACTIONS = ["show", "set", "highlight", "strike", "hide"] as const;
const TONES = ["neutral", "accent", "ok", "alert"] as const;

// Mismo contrato que motion/src/scenes/types.ts.
export interface SceneElement {
  id: string;
  kind: (typeof KINDS)[number];
  slot: (typeof SLOTS)[number];
  text?: string;
  value?: string;
  label?: string;
  tone?: (typeof TONES)[number];
  spec?: OverlaySpec;
}

export interface SceneStep {
  at: number;
  action: (typeof ACTIONS)[number];
  target: string;
  text?: string;
  value?: string;
  tone?: (typeof TONES)[number];
}

export interface AnimatedScene {
  id: string;
  start: number;
  end: number;
  elements: SceneElement[];
  steps: SceneStep[];
}

export interface AnimatedPlan {
  scenes: AnimatedScene[];
  nav: PlacedOverlay[];
  captions: CaptionChunk[];
  durationSeconds: number;
  storyboard: {
    chapters: { title: string; start: number }[];
    scenes: { from: string; to: string; intent: string; idea: string; dropped: string[] }[];
    models: { director: string; designer: string };
    usage: Usage;
  };
}

interface PlannedScene {
  index: number;
  from: number;
  to: number;
  intent: string;
  idea: string;
}

// ---------- 1. Director ----------

function directorSystem(): string {
  return `Sos el DIRECTOR de un video TODO ANIMADO de YouTube (sin stock, sin fotos): todo lo que se ve son graficos animados sobre un lienzo oscuro, que cambian con cada frase de la voz, como en los canales de explicacion animada. No disenas los elementos: decidis la estructura y que se ve en cada tramo.

Te paso el guion partido en frases numeradas (p1, p2...) con el minuto en que se dicen.

1. CAPITULOS: las partes reales del video (aunque no digan "capitulo"; un video corto puede tener 0 o 1). Titulo corto COPIADO del guion y la frase donde arranca.
2. ESCENAS: cubri el video entero con escenas seguidas. Cada escena abarca de 2 a 5 frases (unos 8 a 20 segundos) y tiene UNA idea visual. Cambia de escena cuando cambia lo que hay que mostrar. El gancho y el climax llevan las escenas mas fuertes.
3. Para cada escena: la intencion (${INTENTS.join(", ")}) y la idea visual en una frase, usando estas piezas:
   - titulo grande o frase destacada (una pregunta, una idea clave);
   - cifra grande que cuenta y puede cambiar de valor ("4.300 m" que baja a "2.800 m");
   - cartel de estado que cambia ("DORMIDO" -> "RUGIENDO");
   - tarjeta con un dato y su etiqueta (protagonista, lugar, fecha);
   - tachar o resaltar algo cuando la voz lo desmiente o lo remarca;
   - cualquier grafico del catalogo: ${plannableTypes().join(", ")}.
   La idea de cada escena COMBINA varias piezas que se van sumando con las frases (ej: "tarjeta del protagonista, despues su cifra que cuenta, despues un cartel de estado que cambia"), no una pieza sola. Los graficos del catalogo a pantalla completa, como mucho en una de cada tres escenas (los mapas cuando la voz lleva a un lugar).
   Varia: no repitas la misma idea visual dos escenas seguidas.`;
}

function directorTool(): Anthropic.Tool {
  return {
    name: "return_scene_plan",
    description: "Devuelve los capitulos y las escenas del video.",
    input_schema: {
      type: "object",
      properties: {
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: { start_phrase: { type: "string" }, title: { type: "string" } },
            required: ["start_phrase", "title"],
          },
        },
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from_phrase: { type: "string" },
              to_phrase: { type: "string" },
              intent: { type: "string", enum: INTENTS },
              idea: { type: "string" },
            },
            required: ["from_phrase", "to_phrase", "intent", "idea"],
          },
        },
      },
      required: ["chapters", "scenes"],
    },
  };
}

// ---------- 2. Disenadores ----------

function designerSystem(types: OverlayType[]): string {
  return `Sos DISENADOR de escenas de un video TODO ANIMADO (sin stock). El director ya decidio que frases cubre cada escena y su idea visual; vos armas los ELEMENTOS de cada escena y los PASOS que los animan, atados a las frases de la voz.

ELEMENTOS ("id" unico dentro de la escena, "slot" = zona: top, center, left, right, bottom; los graficos van en "full"):
- title: titulo grande ("text").
- text: frase destacada ("text").
- number: cifra grande que cuenta ("value" con la cifra y su unidad, "label" = que es).
- chip: cartel de estado corto ("text", 1 a 3 palabras; "tone": neutral, accent, ok, alert).
- card: tarjeta ("label" = etiqueta chica, "text" = el dato principal, "value" opcional = una cifra).
- graphic: un grafico del catalogo en "graphic" ({type, text, label, items, icon, lat, lon, ref}). Tipos y campos:
${types.map((t) => `  - ${t}: ${TYPE_GUIDE[t] ?? ""}`).join("\n")}

PASOS (en orden; "phrase" = la frase en que pasa, dentro de las frases de la escena):
- show: aparece el elemento (sin show, esta desde el inicio de la escena).
- set: cambia "value" (la cifra cuenta hasta el nuevo valor), "text" o "tone".
- highlight: se ilumina en el color del canal.
- strike: se tacha en rojo (cuando la voz lo desmiente).
- hide: se va (para dejar lugar a otro en la misma zona).

REGLAS:
1. DATOS DEL GUION: toda cifra, fecha y nombre propio en pantalla sale del guion tal cual; "value" (las cifras) y los campos de los graficos del catalogo son fragmentos COPIADOS LITERALMENTE. En cambio title, text, label y los carteles (chip) pueden ser TEXTOS PROPIOS cortos (hasta 8 palabras) que resumen o rotulan lo que dice la voz ("EN MARCHA", "PASAJEROS", "Una trampa publicitaria"), siempre sin cifras ni nombres que no esten en el guion. Un verificador de codigo rechaza los datos inventados.
2. RITMO: CADA frase de la escena dispara al menos un paso (aparece una pieza, cambia un valor o un cartel, se resalta, se tacha o se va), como en los canales de explicacion animada donde la pantalla cambia cada 2 o 3 segundos. Cada elemento aparece en la frase donde la voz lo dice, no antes.
3. Cada escena se CONSTRUYE: entre 2 y ${MAX_ELEMENTS} elementos que aparecen de a uno en distintas frases, combinando piezas (tarjeta + cifra + cartel, titulo + cifra, etc.), con 3 o 4 a la vez en pantalla como mucho; usa hide para hacer lugar. Una escena con un solo elemento solo si es un grafico del catalogo.
4. Textos cortos: title <= 8 palabras, text <= 8 (la parte clave de la frase, no la frase entera: los subtitulos ya la muestran), chip <= 3, label <= 4.
5. Respeta la idea visual del director; si una escena no tiene material literal para esa idea, usa una frase destacada de la escena.
6. Devolve TODAS las escenas que te pasan, con su "scene_index".`;
}

function designerTool(types: OverlayType[]): Anthropic.Tool {
  return {
    name: "return_scenes",
    description: "Devuelve los elementos y pasos de cada escena.",
    input_schema: {
      type: "object",
      properties: {
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene_index: { type: "number" },
              elements: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    kind: { type: "string", enum: [...KINDS] },
                    slot: { type: "string", enum: [...SLOTS] },
                    text: { type: "string" },
                    value: { type: "string" },
                    label: { type: "string" },
                    tone: { type: "string", enum: [...TONES] },
                    graphic: {
                      type: "object",
                      description: "Solo kind graphic: el grafico del catalogo.",
                      properties: {
                        type: { type: "string", enum: types },
                        text: { type: "string" },
                        label: { type: "string" },
                        items: {
                          type: "array",
                          items: { type: "object", properties: { label: { type: "string" }, text: { type: "string" } }, required: ["text"] },
                        },
                        icon: { type: "string" },
                        lat: { type: "number", description: "Mapas: latitud del lugar" },
                        lon: { type: "number", description: "Mapas: longitud del lugar" },
                        ref: {
                          type: "object",
                          properties: { name: { type: "string" }, lat: { type: "number" }, lon: { type: "number" } },
                          required: ["name", "lat", "lon"],
                        },
                      },
                      required: ["type", "text"],
                    },
                  },
                  required: ["id", "kind", "slot"],
                },
              },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    phrase: { type: "string" },
                    action: { type: "string", enum: [...ACTIONS] },
                    target: { type: "string" },
                    text: { type: "string" },
                    value: { type: "string" },
                    tone: { type: "string", enum: [...TONES] },
                  },
                  required: ["phrase", "action", "target"],
                },
              },
            },
            required: ["scene_index", "elements", "steps"],
          },
        },
      },
      required: ["scenes"],
    },
  };
}

// ---------- 3. Verificador ----------

// Indice de la frase que nombra el modelo. Pide "p12", pero a veces manda
// "p12 · Capitulo uno:" o directamente el texto de la frase: se toma el
// numero si esta, y si no se busca la frase por su texto.
function phraseIndex(phrases: Phrase[], ref: unknown): number {
  if (typeof ref !== "string") return -1;
  const byId = /\bp(\d+)\b/i.exec(ref);
  if (byId) {
    const i = Number(byId[1]) - 1;
    return i >= 0 && i < phrases.length ? i : -1;
  }
  const wanted = plain(normalize(ref));
  if (!wanted) return -1;
  return phrases.findIndex((p) => {
    const text = plain(normalize(p.text));
    return text.startsWith(wanted) || wanted.startsWith(text);
  });
}

function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function verifyScene(
  raw: Record<string, unknown> | undefined,
  planned: PlannedScene,
  phrases: Phrase[],
  fullNorm: string,
  fullText: string,
  types: OverlayType[]
): Promise<{ elements: SceneElement[]; steps: { phrase: number; step: Omit<SceneStep, "at"> }[]; dropped: string[] }> {
  const dropped: string[] = [];
  const sceneText = phrases.slice(planned.from, planned.to + 1).map((p) => p.text).join(" ");
  // Sin tildes: "PARECIA" en un cartel es la misma palabra que "Parecía".
  const literal = (v: string | undefined) => v === undefined || appearsIn(fullNorm, v) || appearsIn(plain(fullNorm), plain(v));
  // Textos propios (DISENO-director-graficos.md, "Textos propios y datos del
  // guion"): titulos, frases cortas, carteles y etiquetas pueden no ser
  // literales, pero nunca traen datos nuevos -- toda cifra y todo nombre
  // propio tiene que estar en el guion. Las cifras de "value" siguen siendo
  // literales.
  const plainScript = plain(fullNorm);
  const ownText = (v: string | undefined) => {
    if (v === undefined || literal(v)) return true;
    const words = v.split(/\s+/).filter(Boolean);
    if (words.length > MAX_OWN_WORDS) return false;
    const numbers = v.match(/\d[\d.,]*\d|\d/g) ?? [];
    if (numbers.some((n) => !plainScript.includes(n))) return false;
    // Nombre propio: con mayuscula inicial, no la primera palabra y no todo
    // en mayusculas (un cartel "EN MARCHA" no es un nombre).
    return words.every((w, i) => {
      const clean = w.replace(/[^\p{L}]/gu, "");
      const isName = i > 0 && clean.length > 2 && /^\p{Lu}/u.test(clean) && clean !== clean.toUpperCase();
      return !isName || new RegExp(`\\b${plain(clean.toLowerCase())}\\b`).test(plainScript);
    });
  };
  const elements: SceneElement[] = [];

  for (const e of asList(raw?.elements, "elements").map((x) => x as Record<string, unknown>)) {
    const id = str(e.id);
    const kind = KINDS.find((k) => k === e.kind);
    if (!id || !kind || elements.some((x) => x.id === id) || elements.length >= MAX_ELEMENTS) continue;
    if (kind === "graphic") {
      const spec = toOverlaySpec(e.graphic, types);
      if (!spec) {
        dropped.push(`${id}: grafico invalido`);
        continue;
      }
      try {
        const { overlay } = await generateOverlayTool.execute({ scene_id: "", script_text: sceneText, full_text: fullText, overlay: spec }, { userId: "" });
        elements.push({ id, kind, slot: "full", spec: overlay });
      } catch (err) {
        dropped.push(`${id}: ${(err as Error).message}`);
      }
      continue;
    }
    const text = str(e.text);
    const value = str(e.value);
    const label = str(e.label);
    const bad = !literal(value) ? value : [text, label].find((v) => !ownText(v));
    if (bad !== undefined) {
      dropped.push(`${id}: "${bad}" trae datos que no estan en el guion`);
      continue;
    }
    if ((kind === "number" && !value) || (kind !== "number" && !text)) {
      dropped.push(`${id}: le falta el dato`);
      continue;
    }
    const slot = SLOTS.find((x) => x === e.slot && x !== "full") ?? "center";
    const tone = TONES.find((x) => x === e.tone);
    elements.push({ id, kind, slot, ...(text ? { text } : {}), ...(value ? { value } : {}), ...(label ? { label } : {}), ...(tone ? { tone } : {}) });
  }

  // Un grafico del catalogo ocupa toda la pantalla: va solo, sin otras
  // piezas ni otro grafico (se pisarian).
  const graphics = elements.filter((e) => e.kind === "graphic");
  if (graphics.length > 0 && elements.length > 1) {
    for (const e of elements.filter((x) => x !== graphics[0])) dropped.push(`${e.id}: la escena ya tiene un grafico a pantalla completa`);
    elements.splice(0, elements.length, graphics[0]!);
  }

  // Ninguna escena vacia: su primera frase como frase destacada.
  if (elements.length === 0) {
    const words = phrases[planned.from]!.text.split(/\s+/);
    elements.push({ id: "fallback", kind: "text", slot: "center", text: words.slice(0, MAX_FALLBACK_WORDS).join(" ") });
  }

  const steps: { phrase: number; step: Omit<SceneStep, "at"> }[] = [];
  for (const st of asList(raw?.steps, "steps").map((x) => x as Record<string, unknown>)) {
    const action = ACTIONS.find((a) => a === st.action);
    const target = str(st.target);
    const index = phraseIndex(phrases, st.phrase);
    if (!action || !target || !elements.some((e) => e.id === target)) continue;
    // Fuera de la escena: al borde mas cercano.
    const phrase = index < 0 ? planned.from : Math.min(planned.to, Math.max(planned.from, index));
    const text = str(st.text);
    const value = str(st.value);
    if (action === "set" && ((text && !ownText(text)) || (value && !literal(value)))) {
      dropped.push(`paso set de ${target}: texto fuera del guion`);
      continue;
    }
    const tone = TONES.find((x) => x === st.tone);
    steps.push({ phrase, step: { action, target, ...(text ? { text } : {}), ...(value ? { value } : {}), ...(tone ? { tone } : {}) } });
  }

  // Nada de pantalla vacia al arrancar la escena: si todo aparece en frases
  // posteriores, la primera pieza que entra se adelanta al inicio.
  const shownLater = (id: string) => steps.some((s) => s.step.target === id && s.step.action === "show" && s.phrase > planned.from);
  const visibleAtStart = elements.some((e) => !steps.some((s) => s.step.target === e.id && s.step.action === "show") || steps.some((s) => s.step.target === e.id && s.step.action === "show" && s.phrase === planned.from));
  if (!visibleAtStart) {
    const first = steps.filter((s) => s.step.action === "show" && shownLater(s.step.target)).sort((a, b) => a.phrase - b.phrase)[0];
    if (first) first.phrase = planned.from;
  }
  return { elements, steps, dropped };
}

// ---------- Todo junto ----------

export async function directAnimatedScenes(input: {
  phrases: Phrase[];
  videoTopic?: string;
  nav: { channel: string | null; topic: string | null; locale: string | null };
  // Pisa el modelo de los disenadores (pruebas).
  designerModel?: string;
}): Promise<AnimatedPlan | null> {
  const { phrases } = input;
  if (phrases.length === 0) return null;
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key) return null;
  const config = provider.configuration ?? {};
  const directorModel = (config.director_model as string | undefined) ?? (config.model as string | undefined) ?? DEFAULT_MODEL;
  const designerModel = input.designerModel ?? (config.scene_designer_model as string | undefined) ?? DEFAULT_DESIGNER_MODEL;
  const client = new Anthropic({ apiKey: provider.api_key, timeout: LLM_TIMEOUT_MS });
  const usage: Usage = {};
  const types = plannableTypes();
  const fullText = phrases.map((p) => p.text).join(" ");
  const fullNorm = normalize(fullText);
  const indexOf = (ref: unknown) => phraseIndex(phrases, ref);

  // 1. Director.
  const script = phrases.map((p) => `[${p.id} · ${clock(p.start)}] ${p.text}`).join("\n");
  const raw = await callTool(
    client,
    directorModel,
    DIRECTOR_MAX_TOKENS,
    directorSystem(),
    directorTool(),
    `${input.videoTopic ? `Tema del video: ${input.videoTopic}\n` : ""}Duracion: ${clock(phrases[phrases.length - 1]!.end)}\n\nGUION EN FRASES:\n${script}`,
    usage
  );
  if (!raw) return null;

  const chapters = asList(raw.chapters, "chapters")
    .map((c) => c as { start_phrase?: unknown; title?: unknown })
    .map((c) => ({ index: indexOf(c.start_phrase), title: str(c.title) ?? "" }))
    .filter((c) => c.index >= 0 && c.title && (appearsIn(fullNorm, c.title) || appearsIn(plain(fullNorm), plain(c.title))))
    .sort((a, b) => a.index - b.index);

  // Escenas seguidas que cubren todas las frases: cada una va desde su
  // primera frase hasta la anterior a la siguiente (se ignora "to_phrase"
  // del director para que no queden huecos ni pisadas).
  const starts = [
    ...new Set(
      asList(raw.scenes, "scenes")
        .map((s) => s as Record<string, unknown>)
        .map((s) => ({ from: indexOf(s.from_phrase), intent: str(s.intent) ?? "", idea: str(s.idea) ?? "" }))
        .filter((s) => s.from >= 0)
        .sort((a, b) => a.from - b.from)
        .map((s) => JSON.stringify(s))
    ),
  ].map((s) => JSON.parse(s) as { from: number; intent: string; idea: string });
  if (starts.length === 0 || starts[0]!.from !== 0) starts.unshift({ from: 0, intent: "intriga", idea: "frase destacada del arranque" });
  const planned: PlannedScene[] = starts
    .filter((s, i) => i === 0 || s.from !== starts[i - 1]!.from)
    .map((s, i, all) => ({ index: i, from: s.from, to: (all[i + 1]?.from ?? phrases.length) - 1, intent: s.intent, idea: s.idea }));

  // 2. Disenadores por capitulo, en paralelo.
  const chapterOf = (scene: PlannedScene) => chapters.filter((c) => c.index <= scene.from).length;
  const groups = new Map<number, PlannedScene[]>();
  for (const scene of planned) groups.set(chapterOf(scene), [...(groups.get(chapterOf(scene)) ?? []), scene]);
  const designed = new Map<number, Record<string, unknown>>();
  const designerSys = designerSystem(types);
  await mapWithConcurrency([...groups.entries()], DESIGNER_CONCURRENCY, async ([group, scenes]) => {
    const title = group === 0 ? "Antes del primer capitulo" : `Capitulo: ${chapters[group - 1]!.title}`;
    const body = scenes
      .map(
        (s) =>
          `ESCENA ${s.index} (${s.intent}) · idea: ${s.idea}\n` +
          phrases
            .slice(s.from, s.to + 1)
            .map((p) => `  [${p.id}] ${p.text}`)
            .join("\n")
      )
      .join("\n\n");
    try {
      const out = await callTool(client, designerModel, DESIGNER_MAX_TOKENS, designerSys, designerTool(types), `${title}\n\n${body}`, usage);
      for (const s of asList(out?.scenes, "scenes").map((x) => x as Record<string, unknown>)) {
        if (typeof s.scene_index === "number") designed.set(s.scene_index, s);
      }
    } catch (err) {
      console.warn(`[scene_director] disenador "${title}" fallo:`, (err as Error).message);
    }
  });

  // 3. Verificacion y tiempos.
  const videoEnd = phrases[phrases.length - 1]!.end + TAIL_SECONDS;
  const sceneStart = (scene: PlannedScene) => (scene.index === 0 ? 0 : Math.max(0, phrases[scene.from]!.start - 0.15));
  const scenes: AnimatedScene[] = [];
  const storyScenes: AnimatedPlan["storyboard"]["scenes"] = [];
  for (const scene of planned) {
    const { elements, steps, dropped } = await verifyScene(designed.get(scene.index), scene, phrases, fullNorm, fullText, types);
    const next = planned[scene.index + 1];
    scenes.push({
      id: `s${scene.index + 1}`,
      start: sceneStart(scene),
      end: next ? sceneStart(next) : videoEnd,
      elements,
      steps: steps.map(({ phrase, step }) => ({ ...step, at: phrases[phrase]!.start })).sort((a, b) => a.at - b.at),
    });
    storyScenes.push({ from: phrases[scene.from]!.id, to: phrases[scene.to]!.id, intent: scene.intent, idea: scene.idea, dropped });
  }

  // Capa fija y subtitulos (mismo calculo que el formato stock).
  const chapterMarks: PlacedOverlay[] = chapters.map((c) => ({
    spec: { type: "title_card", text: c.title, source: "script" },
    start: phrases[c.index]!.start,
    end: phrases[c.index]!.start + 1,
  }));
  const nav = placeNavHeaders(chapterMarks, videoEnd, input.nav);
  const captions = captionChunks(phrases.map((p) => ({ text: p.text, start: p.start, end: p.end, words: p.words })));

  const droppedCount = storyScenes.reduce((n, s) => n + s.dropped.length, 0);
  console.log(
    `[scene_director] ${chapters.length} capitulos, ${scenes.length} escenas, ${scenes.reduce((n, s) => n + s.elements.length, 0)} elementos (${droppedCount} descartados) · ${directorModel}/${designerModel}`
  );
  return {
    scenes,
    nav,
    captions,
    durationSeconds: videoEnd,
    storyboard: {
      chapters: chapters.map((c) => ({ title: c.title, start: phrases[c.index]!.start })),
      scenes: storyScenes,
      models: { director: directorModel, designer: designerModel },
      usage,
    },
  };
}
