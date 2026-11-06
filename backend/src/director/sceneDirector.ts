import Anthropic from "@anthropic-ai/sdk";
import { getActiveProvider } from "../lib/providers.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { placeNavHeaders, type PlacedOverlay } from "../lib/overlayTiming.js";
import { appearsIn, generateOverlayTool, normalize } from "../tools/generateOverlay.tool.js";
import { TYPE_GUIDE, plannableTypes, toOverlaySpec } from "../tools/planOverlays.tool.js";
import type { OverlaySpec, OverlayType } from "../types/shared/typeShared.js";
import { asList, callTool, clock, type Usage } from "./director.js";
import type { DrawingComponent } from "./drawings.js";
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
// (motion/src/scenes): escenas + capa fija. Este archivo corre el esquema
// llamando a la API paso a paso; la version en Managed Agents esta en
// managedSceneDirector.ts y reutiliza prompts, verificador y armado.

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_DESIGNER_MODEL = "claude-haiku-5-5";
const LLM_TIMEOUT_MS = 180 * 1000;
const DIRECTOR_MAX_TOKENS = 12000;
const DESIGNER_MAX_TOKENS = 12000;
const DESIGNER_CONCURRENCY = 4;
const MAX_ELEMENTS = 12;
const MAX_FALLBACK_WORDS = 14;
// Largo maximo de un texto propio (no literal) en pantalla.
const MAX_OWN_WORDS = 8;
// Aire despues de la ultima palabra.
const TAIL_SECONDS = 0.8;

const KINDS = ["title", "text", "number", "chip", "card", "graphic", "drawing", "label"] as const;
const SLOTS = ["top", "center", "left", "right", "bottom", "full"] as const;
const ACTIONS = ["show", "set", "highlight", "strike", "hide", "move", "rotate", "scale", "paint", "loop", "act", "camera"] as const;
const ACTS = ["walk", "run", "press", "push", "point", "look", "recoil", "fall"] as const;
const LOOPS = ["spin", "float", "shake", "pulse"] as const;
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
  component?: string;
  x?: number;
  y?: number;
  w?: number;
  repeat?: { count: number; columns: number };
}

export interface SceneStep {
  at: number;
  action: (typeof ACTIONS)[number];
  target: string;
  text?: string;
  value?: string;
  tone?: (typeof TONES)[number];
  part?: string;
  from_index?: number;
  to_index?: number;
  stagger?: number;
  duration?: number;
  dx?: number;
  dy?: number;
  deg?: number;
  factor?: number;
  loop?: (typeof LOOPS)[number];
  act?: (typeof ACTS)[number];
  // camera: acercamiento hacia el elemento (1 = plano general).
  zoom?: number;
  // Palabra de la frase en la que pasa (se resuelve a su segundo al armar).
  word?: string;
}

export interface AnimatedScene {
  id: string;
  start: number;
  end: number;
  background?: "light" | "dark";
  // Formato documental: escena armada con un recurso (backend/motion/src/recursos).
  recurso?: Record<string, unknown>;
  elements: SceneElement[];
  steps: SceneStep[];
}

export interface AnimatedPlan {
  scenes: AnimatedScene[];
  // Biblioteca visual de este video: se dibuja una vez y se reutiliza.
  components: Record<string, DrawingComponent>;
  nav: PlacedOverlay[];
  // Subtitulos palabra por palabra (formato documental).
  captions?: { start: number; end: number; words: { text: string; start: number; end: number }[] }[];
  durationSeconds: number;
  storyboard: {
    chapters: { title: string; start: number }[];
    scenes: { from: string; to: string; intent: string; idea: string; dropped: string[] }[];
    models: { director: string; designer: string };
    usage: Usage;
    // Formato documental: escenas que rechazo el Revisor y por que.
    revisor?: { escena: string; motivo: string }[];
    // Solo con Managed Agents: la sesion y su consumo.
    managed?: { session_id: string; usage: unknown };
  };
}

export interface PlannedScene {
  index: number;
  from: number;
  to: number;
  intent: string;
  idea: string;
}

// ---------- 1. Director ----------

export function directorSystem(): string {
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

export function directorTool(): Anthropic.Tool {
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

export function designerSystem(types: OverlayType[]): string {
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
4. Textos cortos: title <= 8 palabras, text <= 8 (la parte clave de la frase, no la frase entera: la voz ya la dice), chip <= 3, label <= 4.
5. Respeta la idea visual del director; si una escena no tiene material literal para esa idea, usa una frase destacada de la escena.
6. Devolve TODAS las escenas que te pasan, con su "scene_index".`;
}

export function designerTool(types: OverlayType[]): Anthropic.Tool {
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
              background: { type: "string", enum: ["light", "dark"] },
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
                    component: { type: "string", description: "Solo kind drawing: id del componente." },
                    x: { type: "number", description: "drawing y label: centro horizontal, 0 a 100." },
                    y: { type: "number", description: "drawing y label: centro vertical, 0 a 100." },
                    w: { type: "number", description: "drawing: ancho, 2 a 100." },
                    repeat_count: { type: "number", description: "drawing: cuantos ejemplares en grilla." },
                    repeat_columns: { type: "number", description: "drawing: columnas de la grilla." },
                    over: { type: "boolean", description: "drawing: va encima de otro dibujo a proposito." },
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
                    word: { type: "string", description: "Palabra exacta de la frase donde ocurre." },
                    action: { type: "string", enum: [...ACTIONS] },
                    target: { type: "string" },
                    text: { type: "string" },
                    value: { type: "string" },
                    tone: { type: "string", enum: [...TONES] },
                    part: { type: "string", description: "Dibujos: parte del componente." },
                    from_index: { type: "number", description: "Dibujos: primer ejemplar." },
                    to_index: { type: "number", description: "Dibujos: ultimo ejemplar." },
                    stagger: { type: "number", description: "Dibujos: segundos entre ejemplares." },
                    duration: { type: "number", description: "Segundos que tarda (0.2 a 4)." },
                    dx: { type: "number", description: "move: % del ancho del componente." },
                    dy: { type: "number", description: "move: % del alto del componente." },
                    deg: { type: "number", description: "rotate: grados." },
                    factor: { type: "number", description: "scale: factor." },
                    zoom: { type: "number", description: "camera: 1 es plano general, hasta 1.4." },
                    loop: { type: "string", enum: [...LOOPS] },
                    act: { type: "string", enum: [...ACTS], description: "Accion de un personaje." },
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

// Segundo en que se dice una palabra de la frase; sin palabra, el inicio.
export function wordTime(phrase: Phrase, word: string | undefined): number {
  if (!word) return phrase.start;
  const clean = (v: string) => plain(normalize(v)).replace(/[^\p{L}\p{N}]/gu, "");
  const wanted = clean(word.split(/\s+/)[0] ?? "");
  return phrase.words.find((w) => clean(w.text) === wanted)?.start ?? phrase.start;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampTo(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function verifyScene(
  raw: Record<string, unknown> | undefined,
  planned: PlannedScene,
  phrases: Phrase[],
  fullNorm: string,
  fullText: string,
  types: OverlayType[],
  components?: Map<string, DrawingComponent>
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
    if (kind === "drawing") {
      const component = components?.get(str(e.component) ?? "");
      if (!component) {
        dropped.push(`${id}: el componente "${String(e.component)}" no existe`);
        continue;
      }
      const count = Math.max(1, Math.min(120, Math.round(num(e.repeat_count) ?? 1)));
      elements.push({
        id,
        kind,
        slot: "full",
        component: component.id,
        x: clampTo(num(e.x) ?? 50, 0, 100),
        y: clampTo(num(e.y) ?? 50, 0, 100),
        w: clampTo(num(e.w) ?? 40, 2, 100),
        ...(count > 1 ? { repeat: { count, columns: Math.max(1, Math.min(count, Math.round(num(e.repeat_columns) ?? count))) } } : {}),
      });
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
    const place = kind === "label" ? { x: clampTo(num(e.x) ?? 50, 0, 100), y: clampTo(num(e.y) ?? 50, 0, 100) } : {};
    elements.push({ id, kind, slot, ...place, ...(text ? { text } : {}), ...(value ? { value } : {}), ...(label ? { label } : {}), ...(tone ? { tone } : {}) });
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
    const motion: Partial<SceneStep> = {};
    const part = str(st.part);
    if (part) {
      const owner = elements.find((e) => e.id === target)!;
      const component = components?.get(owner.component ?? "");
      if (!component || !(part in component.parts)) {
        dropped.push(`paso de ${target}: la parte "${part}" no existe`);
        continue;
      }
      motion.part = part;
    }
    for (const key of ["from_index", "to_index", "stagger", "duration", "dx", "dy", "deg", "factor", "zoom"] as const) {
      const n = num(st[key]);
      if (n !== undefined) motion[key] = n;
    }
    const loop = LOOPS.find((l) => l === st.loop);
    if (loop) motion.loop = loop;
    const act = ACTS.find((a) => a === st.act);
    if (act) motion.act = act;
    const word = str(st.word);
    if (word) motion.word = word;
    if (motion.zoom !== undefined) motion.zoom = clampTo(motion.zoom, 1, 1.4);
    if (motion.duration !== undefined) motion.duration = clampTo(motion.duration, 0.2, 4);
    steps.push({ phrase, step: { action, target, ...motion, ...(text ? { text } : {}), ...(value ? { value } : {}), ...(tone ? { tone } : {}) } });
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

// ---------- Armado (compartido con Managed Agents) ----------

export interface SceneStructure {
  // label: nombre corto para el encabezado fijo.
  chapters: { index: number; title: string; label?: string }[];
  planned: PlannedScene[];
}

// Capitulos y escenas que devolvio el director, ya validados.
export function readStructure(raw: Record<string, unknown>, phrases: Phrase[]): SceneStructure {
  const fullNorm = normalize(phrases.map((p) => p.text).join(" "));
  const indexOf = (ref: unknown) => phraseIndex(phrases, ref);
  const chapters = asList(raw.chapters, "chapters")
    .map((c) => c as { start_phrase?: unknown; title?: unknown; short?: unknown })
    .map((c) => {
      const label = str(c.short);
      return { index: indexOf(c.start_phrase), title: str(c.title) ?? "", ...(label ? { label } : {}) };
    })
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
  return { chapters, planned };
}

// Las escenas repartidas por capitulo: un tramo por disenador.
export function sceneGroups({ chapters, planned }: SceneStructure, phrases: Phrase[], maxScenes = Infinity): { group: number; title: string; scenes: PlannedScene[]; brief: string }[] {
  const chapterOf = (scene: PlannedScene) => chapters.filter((c) => c.index <= scene.from).length;
  const groups = new Map<number, PlannedScene[]>();
  for (const scene of planned) groups.set(chapterOf(scene), [...(groups.get(chapterOf(scene)) ?? []), scene]);
  const tramos = [...groups.entries()].flatMap(([group, scenes]) => {
    const parts: [number, PlannedScene[]][] = [];
    for (let i = 0; i < scenes.length; i += maxScenes) parts.push([group, scenes.slice(i, i + maxScenes)]);
    return parts;
  });
  return tramos.map(([group, scenes]) => {
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
    return { group, title, scenes, brief: `${title}\n\n${body}` };
  });
}

// Verificacion y tiempos: de las escenas disenadas a las props del video.
export async function assemblePlan(input: {
  phrases: Phrase[];
  structure: SceneStructure;
  designed: Map<number, Record<string, unknown>>;
  types: OverlayType[];
  nav: { channel: string | null; topic: string | null; locale: string | null };
  models: { director: string; designer: string };
  usage: Usage;
  managed?: { session_id: string; usage: unknown };
  components?: Map<string, DrawingComponent>;
}): Promise<AnimatedPlan> {
  const { phrases, designed, types, usage } = input;
  const { chapters, planned } = input.structure;
  const fullText = phrases.map((p) => p.text).join(" ");
  const fullNorm = normalize(fullText);
  const videoEnd = phrases[phrases.length - 1]!.end + TAIL_SECONDS;
  const sceneStart = (scene: PlannedScene) => (scene.index === 0 ? 0 : Math.max(0, phrases[scene.from]!.start - 0.15));
  const scenes: AnimatedScene[] = [];
  const storyScenes: AnimatedPlan["storyboard"]["scenes"] = [];
  for (const scene of planned) {
    const raw = designed.get(scene.index);
    const { elements, steps, dropped } = await verifyScene(raw, scene, phrases, fullNorm, fullText, types, input.components);
    const next = planned[scene.index + 1];
    scenes.push({
      id: `s${scene.index + 1}`,
      start: sceneStart(scene),
      end: next ? sceneStart(next) : videoEnd,
      // Los graficos del catalogo estan pensados sobre oscuro.
      ...(raw?.background === "light" && !elements.some((e) => e.kind === "graphic") ? { background: "light" as const } : {}),
      elements,
      steps: steps.map(({ phrase, step }) => {
        const { word, ...rest } = step;
        return { ...rest, at: wordTime(phrases[phrase]!, word) };
      }).sort((a, b) => a.at - b.at),
    });
    storyScenes.push({ from: phrases[scene.from]!.id, to: phrases[scene.to]!.id, intent: scene.intent, idea: scene.idea, dropped });
  }

  // Capa fija (mismo calculo que el formato stock). Sin subtitulos: la voz
  // explica y la imagen muestra, el texto encima sobra.
  const chapterMarks: PlacedOverlay[] = chapters.map((c) => ({
    spec: { type: "title_card", text: c.label ?? c.title, source: "script" },
    start: phrases[c.index]!.start,
    end: phrases[c.index]!.start + 1,
  }));
  const nav = placeNavHeaders(chapterMarks, videoEnd, input.nav);

  const droppedCount = storyScenes.reduce((n, s) => n + s.dropped.length, 0);
  console.log(
    `[scene_director] ${chapters.length} capitulos, ${scenes.length} escenas, ${scenes.reduce((n, s) => n + s.elements.length, 0)} elementos (${droppedCount} descartados) · ${input.models.director}/${input.models.designer}`
  );
  const used = new Set(scenes.flatMap((s) => s.elements.flatMap((e) => (e.component ? [e.component] : []))));
  return {
    scenes,
    components: Object.fromEntries([...(input.components ?? new Map<string, DrawingComponent>())].filter(([id]) => used.has(id))),
    nav,
    durationSeconds: videoEnd,
    storyboard: {
      chapters: chapters.map((c) => ({ title: c.title, start: phrases[c.index]!.start })),
      scenes: storyScenes,
      models: input.models,
      usage,
      ...(input.managed ? { managed: input.managed } : {}),
    },
  };
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

  const structure = readStructure(raw, phrases);
  const { chapters, planned } = structure;

  // 2. Disenadores por capitulo, en paralelo.
  const designed = new Map<number, Record<string, unknown>>();
  const designerSys = designerSystem(types);
  await mapWithConcurrency(sceneGroups(structure, phrases), DESIGNER_CONCURRENCY, async ({ title, brief }) => {
    try {
      const out = await callTool(client, designerModel, DESIGNER_MAX_TOKENS, designerSys, designerTool(types), brief, usage);
      for (const s of asList(out?.scenes, "scenes").map((x) => x as Record<string, unknown>)) {
        if (typeof s.scene_index === "number") designed.set(s.scene_index, s);
      }
    } catch (err) {
      console.warn(`[scene_director] disenador "${title}" fallo:`, (err as Error).message);
    }
  });

  return assemblePlan({ phrases, structure, designed, types, nav: input.nav, models: { director: directorModel, designer: designerModel }, usage });
}
