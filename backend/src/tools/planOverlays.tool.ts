import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition } from "./tool.types.js";
import { getActiveProvider } from "../lib/providers.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";
import { providerApiError } from "../lib/errors.js";
import type { OverlaySpec, OverlayType } from "../types/shared/typeShared.js";
import { supportedOverlayTypes } from "../lib/motion.js";

// Decide QUE metrica animada va en cada escena (contador, barras, versus,
// linea de tiempo, ubicacion, capitulo, CTA), leyendo el guion completo de
// una sola vez -- asi el ritmo se reparte en todo el video y no se repite
// el mismo tipo escena tras escena. El render (motion/, Remotion) los
// dibuja; generate_overlay valida despues que cada texto salga del guion.
//
// Patrones sacados de canales documentales tipo "¿Que pasaria si...?"
// (ej. MAGNITUD): gancho con una cifra en los primeros segundos, cifras
// con unidad como numero gigante con contador, comparaciones entre lugares
// como barras, "X vs Y" como pantalla dividida, progresiones ("24 h... 30
// h... 100 h", "hace 4.600 millones de años") como linea de tiempo,
// capitulos ("Escenario 1") como title card, lugares como pin, y los
// pedidos de like/suscripcion/comentario como CTA. Una metrica cada 20-40s.

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const LLM_TIMEOUT_MS = 180 * 1000;
const MAX_OUTPUT_TOKENS = 12000;
const MAX_SCRIPT_CHARS = 60000;
// Segundos promedio entre overlays que se le pide al LLM.
const TARGET_SECONDS_PER_OVERLAY = 25;
const MAX_OVERLAYS_PER_SCENE = 3;

// Que hace cada tipo (para el prompt). Solo se le ofrecen al LLM los que
// tienen componente en motion/ (ver supportedOverlayTypes): el catalogo
// crece por fases sin tocar este archivo.
const TYPE_GUIDE: Partial<Record<OverlayType, string>> = {
  big_number: 'una cifra con unidad que impacta ("1.500 km por hora", "el 70% de las personas", "40.000 millones"). Se anima como contador. "label" = de que es la cifra.',
  data_viz_single: 'comparacion de 2 a 5 valores de la misma magnitud (velocidad en distintas ciudades, poblacion de paises). Barras que crecen. "items" = [{label, text}] con el valor literal de cada uno. "label" = titulo del grafico.',
  versus: 'exactamente 2 cosas enfrentadas ("huracanes de 300 km por hora" vs "más de 1,000 km por hora"). "items" = los 2 lados.',
  timeline: 'progresion o hitos en orden (fechas, eras, etapas de un proceso). "items" = hitos en orden, 2 a 6.',
  location: 'cuando la narracion nos lleva a un lugar concreto ("Quito", "el Serengueti"). "text" = el lugar, "label" opcional = el dato del lugar.',
  title_card: 'inicio de un capitulo/parte ("Escenario 1", "Pero hay algo peor") o la pregunta central del video al arrancar. Pocos: 2 a 5 en todo el video, solo donde de verdad cambia de parte. "text" = el titulo, "label" opcional = subtitulo. El numero de capitulo y la barra de progreso se agregan solos.',
  rank_reveal: 'posicion en un top/ranking ("número 3", "el puesto 1"). "text" incluye el numero.',
  lower_third: 'concepto, termino o nombre propio que conviene fijar en pantalla ("sesgo de confirmación", "fuerza de Coriolis").',
  badge: 'etiqueta corta de contexto arriba ("Dato real", una fecha).',
  cta: 'cuando la narracion pide suscribirse, dar like o comentar ("suscríbete y activa la campana").',
};

function plannableTypes(): OverlayType[] {
  const supported = new Set(supportedOverlayTypes());
  return (Object.keys(TYPE_GUIDE) as OverlayType[]).filter((t) => supported.has(t));
}

export interface PlanOverlaysScene {
  order: number;
  text: string;
  duration_seconds?: number;
}

export interface PlanOverlaysInput {
  scenes: PlanOverlaysScene[];
  video_topic?: string;
  // Genero del video (de generate_visual_context si se corrio): ajusta que
  // tipo de overlay conviene (finanzas: cifras/barras, historia: lineas de
  // tiempo/lugares, top N: rank_reveal...).
  genre?: string;
}

export interface PlanOverlaysOutput {
  // order de la escena -> overlays (todavia sin validar contra el guion).
  overlays: Record<number, OverlaySpec[]>;
  source: "anthropic" | "openai" | "heuristic";
}

function buildSystemPrompt(types: OverlayType[]): string {
  return `Sos el motion designer de un canal de YouTube faceless de cualquier nicho (ciencia, animales, psicologia, finanzas, historia, curiosidades...). Sobre el video de stock/IA se superponen GRAFICOS ANIMADOS que refuerzan lo que dice la narracion. Te paso el guion dividido en escenas numeradas con su duracion. Elegi que graficos van en cada escena.

TIPOS DISPONIBLES (usa el que mejor encaje con lo que se narra; no hay otros):
${types.map((t) => `- ${t}: ${TYPE_GUIDE[t]}`).join("\n")}

REGLAS ESTRICTAS:
1. "text", "label" y cada items[].text / items[].label tienen que ser fragmentos COPIADOS LITERALMENTE del guion (mismas palabras, mismos numeros, misma forma de escribirlos). Nunca inventes, redondees, traduzcas ni reformules. Si no podes copiarlo literal, no lo pongas. items[].text tiene que estar en el texto de ESA escena.
2. Textos cortos: text <= 6 palabras (salvo title_card <= 8), label <= 5 palabras, items[].label <= 3 palabras.
3. Ritmo: aproximadamente un overlay cada ${TARGET_SECONDS_PER_OVERLAY} segundos de video en total, maximo ${MAX_OVERLAYS_PER_SCENE} por escena. Muchas escenas pueden no tener ninguno. Prioriza las cifras y comparaciones mas impactantes; la primera cifra fuerte del gancho siempre va.
4. Si hay mas de un tipo disponible, varia: no repitas el mismo tipo tres veces seguidas si otro muestra mejor lo que se narra.
5. Si un tramo no tiene nada que encaje con los tipos disponibles, no pongas nada: es mejor un grafico menos que uno forzado.
6. Dentro de cada escena, lista los overlays en el orden en que se narran.`;
}

function buildUserPrompt(input: PlanOverlaysInput): string {
  const totalSeconds = input.scenes.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0);
  const header = [
    input.video_topic ? `Tema del video: ${input.video_topic}` : null,
    input.genre ? `Genero: ${input.genre}` : null,
    totalSeconds > 0
      ? `Duracion total: ${Math.round(totalSeconds)}s -> apunta a unos ${Math.max(1, Math.round(totalSeconds / TARGET_SECONDS_PER_OVERLAY))} overlays en total.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  let budget = MAX_SCRIPT_CHARS;
  const body: string[] = [];
  for (const scene of input.scenes) {
    const line = `[Escena ${scene.order}${scene.duration_seconds ? ` · ${Math.round(scene.duration_seconds)}s` : ""}]\n${scene.text.trim()}`;
    if (line.length > budget) break;
    budget -= line.length;
    body.push(line);
  }
  return `${header}\n\nGUION POR ESCENAS:\n\n${body.join("\n\n")}`;
}

function returnOverlaysTool(types: OverlayType[]): Anthropic.Tool {
  return {
  name: "return_overlays",
  description: "Devuelve los overlays elegidos, agrupados por numero de escena.",
  input_schema: {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            order: { type: "number", description: "Numero de escena" },
            overlays: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: types },
                  text: { type: "string" },
                  label: { type: "string" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { label: { type: "string" }, text: { type: "string" } },
                      required: ["label", "text"],
                    },
                  },
                },
                required: ["type", "text"],
              },
            },
          },
          required: ["order", "overlays"],
        },
      },
    },
    required: ["scenes"],
  },
  };
}

async function planWithAnthropic(user: string, types: OverlayType[]): Promise<unknown[] | null> {
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key) return null;
  const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_ANTHROPIC_MODEL;
  const client = new Anthropic({ apiKey: provider.api_key, timeout: LLM_TIMEOUT_MS });

  const response = await withRetry(() =>
    client.messages
      .stream({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: buildSystemPrompt(types),
        tools: [returnOverlaysTool(types)],
        tool_choice: { type: "tool", name: "return_overlays" },
        messages: [{ role: "user", content: user }],
      })
      .finalMessage()
  );
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return sceneList((toolUse?.input as { scenes?: unknown } | undefined)?.scenes);
}

// Claude a veces devuelve el array anidado como texto JSON (visto con
// claude-sonnet-5: `scenes: "{\"scenes\":[...]}"`) en vez de un array --
// sin esto el plan entero se perdia en silencio y el video salia sin
// graficos. Acepta el array, el texto JSON y el objeto envuelto.
function sceneList(value: unknown): unknown[] {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) v = (v as { scenes?: unknown }).scenes;
  return Array.isArray(v) ? v : [];
}

async function planWithOpenAI(user: string, types: OverlayType[]): Promise<unknown[] | null> {
  const provider = await getActiveProvider("openai");
  if (!provider?.api_key) return null;
  const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_OPENAI_MODEL;

  const data = await withRetry(async () => {
    const response = await fetchWithTimeout(
      OPENAI_CHAT_COMPLETIONS_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.api_key}` },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `${buildSystemPrompt(types)}\n\nRespondé EXCLUSIVAMENTE con un objeto JSON { "scenes": [ { "order": number, "overlays": [ { "type": string, "text": string, "label"?: string, "items"?: [ { "label": string, "text": string } ] } ] } ] }.`,
            },
            { role: "user", content: user },
          ],
        }),
      },
      LLM_TIMEOUT_MS
    );
    if (!response.ok) {
      throw providerApiError("OpenAI", response.status, await response.text(), [provider.api_key]);
    }
    return (await response.json()) as { choices: { message: { content: string | null } }[] };
  });

  const raw = data.choices[0]?.message.content;
  if (!raw) return [];
  try {
    return sceneList((JSON.parse(raw) as { scenes?: unknown }).scenes);
  } catch {
    return [];
  }
}

function toOverlaySpec(raw: unknown, types: OverlayType[]): OverlaySpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: unknown; text?: unknown; label?: unknown; items?: unknown };
  if (typeof r.type !== "string" || !(types as string[]).includes(r.type)) return null;
  if (typeof r.text !== "string" || !r.text.trim()) return null;
  const items = Array.isArray(r.items)
    ? r.items
        .filter(
          (i): i is { label: string; text: string } =>
            Boolean(i) && typeof (i as { label?: unknown }).label === "string" && typeof (i as { text?: unknown }).text === "string"
        )
        .map((i) => ({ label: i.label, text: i.text }))
    : undefined;
  return {
    type: r.type as OverlayType,
    text: r.text.trim(),
    source: "script",
    ...(typeof r.label === "string" && r.label.trim() ? { label: r.label.trim() } : {}),
    ...(items?.length ? { items } : {}),
  };
}

// Sin LLM: toma las cifras con unidad de cada escena (las que el lector
// "siente": km/h, %, años, millones...) como big_number, respetando el
// ritmo de un overlay cada ~TARGET_SECONDS_PER_OVERLAY segundos.
const NUMBER_WITH_UNIT =
  /(?:US\$|\$|€)?\s?\d[\d.,]*\s?(?:%|por ciento|km\/h|km por hora|kil[oó]metros?|km|metros|m|cm|kg|toneladas|grados|°C?|horas|d[ií]as|años|meses|segundos|minutos|mil millones(?: de \p{L}+)?|millones(?: de \p{L}+)?|mil(?: \p{L}+)?|d[oó]lares|personas|veces)(?!\p{L})/giu;

export function heuristicOverlays(scenes: PlanOverlaysScene[]): Record<number, OverlaySpec[]> {
  const result: Record<number, OverlaySpec[]> = {};
  let secondsSinceLast = TARGET_SECONDS_PER_OVERLAY;
  for (const scene of scenes) {
    const duration = scene.duration_seconds ?? 20;
    const matches = [...scene.text.matchAll(NUMBER_WITH_UNIT)].map((m) => m[0].trim());
    const perScene = Math.min(MAX_OVERLAYS_PER_SCENE, Math.floor((secondsSinceLast + duration) / TARGET_SECONDS_PER_OVERLAY));
    const picked = [...new Set(matches)].slice(0, Math.max(0, perScene));
    if (picked.length > 0) {
      result[scene.order] = picked.map((text) => ({ type: "big_number", text, source: "script" }));
      secondsSinceLast = 0;
    } else {
      secondsSinceLast += duration;
    }
  }
  return result;
}

export const planOverlaysTool: ToolDefinition<PlanOverlaysInput, PlanOverlaysOutput> = {
  name: "plan_overlays",
  description:
    "Lee el guion completo por escenas y elige las metricas animadas de cada una (contadores, barras, versus, linea de tiempo, ubicacion, capitulos, CTA). Claude primero, OpenAI de respaldo, heuristica sin LLM.",
  parameters: {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            order: { type: "number" },
            text: { type: "string" },
            duration_seconds: { type: "number" },
          },
          required: ["order", "text"],
        },
      },
      video_topic: { type: "string" },
      genre: { type: "string" },
    },
    required: ["scenes"],
  },
  async execute(input) {
    const scenes = input.scenes.filter((s) => s.text?.trim());
    const types = plannableTypes();
    // Sin componentes instalados (motion/ ausente) no tiene sentido pedir nada.
    if (scenes.length === 0 || types.length === 0) return { overlays: {}, source: "heuristic" };

    const user = buildUserPrompt({ ...input, scenes });
    let raw: unknown[] | null = null;
    let source: PlanOverlaysOutput["source"] = "heuristic";
    try {
      raw = await planWithAnthropic(user, types);
      if (raw) source = "anthropic";
    } catch (err) {
      console.warn("[plan_overlays] Claude fallo, probando OpenAI:", err);
    }
    if (!raw) {
      try {
        raw = await planWithOpenAI(user, types);
        if (raw) source = "openai";
      } catch (err) {
        console.warn("[plan_overlays] OpenAI fallo, uso la heuristica:", err);
      }
    }
    if (!raw) {
      return { overlays: types.includes("big_number") ? heuristicOverlays(scenes) : {}, source: "heuristic" };
    }

    const overlays: Record<number, OverlaySpec[]> = {};
    for (const entry of raw) {
      const e = entry as { order?: unknown; overlays?: unknown };
      if (typeof e.order !== "number" || !Array.isArray(e.overlays)) continue;
      const specs = e.overlays.map((o) => toOverlaySpec(o, types)).filter((o): o is OverlaySpec => o !== null);
      if (specs.length) overlays[e.order] = specs.slice(0, MAX_OVERLAYS_PER_SCENE);
    }
    return { overlays, source };
  },
};
