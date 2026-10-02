import type { ToolDefinition } from "./tool.types.js";
import { getActiveProvider } from "../lib/providers.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";
import { providerApiError } from "../lib/errors.js";
import type { ContentPolicy } from "../types/shared/typeShared.js";

// Continuidad visual entre escenas. Armar cada prompt por separado (como
// generate_video_prompt) hacia que cada imagen saliera distinta: el
// protagonista cambiaba de cara, de ropa y de epoca escena a escena, porque
// ni el LLM ni Flow saben nada de las otras escenas. Se resuelve armando los
// prompts de varias escenas CONSECUTIVAS en una sola llamada, con el guion
// completo con timestamps y el diseño visual del canal (el prompt del
// equipo, "PROMPT IMAGENES CON TIMESTAMPS"). Los personajes no se describen:
// los aporta el usuario como ingredientes en Flow.

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
// Con el guion entero en el prompt la respuesta tarda bastante mas que un
// prompt suelto.
const LLM_TIMEOUT_MS = 120 * 1000;
// Tope del guion completo que se manda en cada tramo (~1h de narracion).
const MAX_SCRIPT_CHARS = 60000;

export interface SequenceScene {
  order: number;
  text: string;
  // "00:12 - 00:20" -- el guion se le pasa al LLM con sus timestamps, como
  // lo trabaja el equipo que arma los prompts a mano.
  time?: string;
}

interface ChannelContext {
  video_topic?: string;
  visual_style?: string;
  content_policy?: ContentPolicy;
}

function policyLines(policy?: ContentPolicy): string {
  const lines: string[] = [];
  if (policy?.prefer?.length) lines.push(`Preferencias visuales del proyecto: ${policy.prefer.join(", ")}`);
  if (policy?.block?.length) lines.push(`Temas a evitar (nunca los muestres): ${policy.block.join(", ")}`);
  if (policy?.notes) lines.push(`Notas del proyecto: ${policy.notes}`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function sceneLabel(s: SequenceScene): string {
  return s.time ? `[${s.time}]` : `[Escena ${s.order}]`;
}

function scenesBlock(scenes: SequenceScene[]): string {
  return scenes.map((s) => `${sceneLabel(s)} ${s.text.trim()}`).join("\n");
}

async function chatJson(system: string, user: string): Promise<Record<string, unknown> | null> {
  const provider = await getActiveProvider("openai");
  if (!provider?.api_key) return null;
  const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_MODEL;

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
            { role: "system", content: system },
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
  if (!raw) throw new Error("OpenAI no devolvio contenido");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI devolvio un JSON invalido");
  }
}

// --- prompts en secuencia ---------------------------------------------

// Instrucciones del equipo que arma los prompts de imagen a mano ("PROMPT
// IMAGENES CON TIMESTAMPS"), casi textuales. Adaptaciones: (1) se trabaja
// por tramos de timestamps -- el guion completo va SIEMPRE, pero en cada
// llamada se piden solo los prompts de un tramo, porque un video de 100+
// escenas no entra en una sola respuesta; (2) la salida es JSON en vez de
// parrafos sueltos, para poder asignar cada prompt a su escena; (3) los
// personajes NO se describen fisicamente: el usuario los pone como
// ingrediente (imagen de referencia) en Flow, y una descripcion inventada
// los contradecia. Se nombran y se describe solo que hacen.
const SEQUENCE_SYSTEM_PROMPT = `Quiero que actúes como un generador profesional de prompts para imágenes destinadas a ilustrar un video de YouTube. Vas a recibir: un bloque llamado ESTILO VISUAL, donde se describe detalladamente la apariencia que deberán tener todas las imágenes; el GUION COMPLETO CON TIMESTAMPS, donde cada marca de tiempo está acompañada por el fragmento de narración correspondiente; y un TRAMO A ILUSTRAR con los timestamps para los que tenés que escribir prompts en esta respuesta. Tu tarea es leer primero el guion completo para comprender la historia, el contexto general, los personajes, los lugares, la época, la progresión narrativa y la relación entre todas las escenas. Después, analiza individualmente lo que se dice en cada timestamp del tramo y crea exactamente un prompt de imagen diferente para cada uno de ellos.

Cada prompt debe representar visualmente la idea, acción, situación o concepto principal narrado dentro de ese timestamp. No debes limitarte a repetir literalmente el texto del guion: debes transformarlo en una escena visual clara, concreta y fácil de representar en una sola imagen. Cuando una frase sea abstracta, emocional, explicativa o no describa directamente una acción visible, conviértela en la representación visual más clara y coherente posible, utilizando personajes, objetos, escenarios, expresiones, comparaciones visuales, diagramas o composiciones simbólicas únicamente cuando sean necesarias para comunicar esa idea. No generes escenas aleatorias, genéricas o desconectadas de la narración.

Cada prompt debe ser autosuficiente, completo y estar listo para copiar y pegar directamente en un generador de imágenes. No debes depender de información incluida en prompts anteriores.

PERSONAJES: la apariencia de los personajes NO la definís vos. El usuario la aporta aparte, como imagen de referencia (ingrediente) en el generador. Por eso, cuando aparezca un personaje, nombralo con el nombre o rol que tiene en el guion ("María", "el pescador") y describí solo lo que hace en esa escena: acción, pose, expresión, gesto, ubicación en el encuadre y relación con los demás. NO inventes ni describas rasgos físicos (cara, edad, cuerpo, pelo, color de piel, ropa, accesorios), salvo que el ESTILO VISUAL indique una descripción concreta de ese personaje: en ese caso usala tal cual.

Mantén continuidad visual entre todas las imágenes del mismo video. Los personajes se nombran siempre igual en todos los prompts donde aparecen. Los escenarios recurrentes deben conservar una apariencia coherente. Si la historia avanza en el tiempo, representa correctamente la edad, el contexto histórico, la ropa, los objetos, los edificios y cualquier elemento correspondiente a ese momento. No mezcles épocas ni agregues elementos modernos en escenas históricas.

Aplica a todos los prompts la totalidad del ESTILO VISUAL proporcionado. No menciones frases como "utiliza el estilo anterior", "mismo estilo", "mismo personaje" o "igual que la escena previa", porque cada prompt debe funcionar por separado. Debes incorporar directamente dentro de cada prompt las características necesarias del estilo artístico, el tipo de personajes, los colores, la iluminación, el tipo de fondo, el nivel de realismo, el encuadre, la cámara, la composición, la atmósfera y el formato indicados en el bloque de estilo. Si alguna regla del estilo no resulta relevante para una escena concreta, prioriza la coherencia visual general sin forzar elementos innecesarios.

Representa únicamente el contenido correspondiente a cada timestamp, pero utiliza el contexto del guion completo para interpretar correctamente nombres, pronombres, referencias, lugares y situaciones. No adelantes sucesos que todavía no hayan ocurrido en la narración y no agregues acontecimientos posteriores dentro de una escena anterior. Tampoco repitas exactamente la misma composición en timestamps consecutivos (tené en cuenta también los prompts ya usados en los timestamps vecinos, si te los paso). Si varios fragmentos hablan del mismo acontecimiento, busca encuadres, acciones, expresiones, puntos de vista o momentos diferentes que permitan que cada imagen aporte información visual nueva sin contradecir el guion.

Cuando el timestamp contenga varias ideas, selecciona la idea visual más importante o intégralas dentro de una única composición clara y ordenada. No intentes representar demasiadas acciones separadas dentro de una sola imagen. Cada prompt debe describir un único frame, no una secuencia, animación, collage, tira de viñetas o conjunto de escenas, salvo que el ESTILO VISUAL o el propio guion soliciten explícitamente una composición dividida. Evita expresiones ambiguas como "se lo ve haciendo varias cosas", "antes y después" o "en diferentes momentos". Describe un instante visual concreto.

Incluye solamente texto dentro de la imagen cuando sea imprescindible para comprender la escena o cuando el ESTILO VISUAL lo indique. En caso de utilizarlo, debe ser breve, estar correctamente escrito y aparecer entre comillas dentro del prompt. No inventes carteles, subtítulos, nombres, estadísticas o frases que no sean necesarios. No agregues marcas de agua, logotipos, interfaces de inteligencia artificial ni elementos que revelen que la imagen fue generada.

Todos los prompts deben respetar el formato y la relación de aspecto establecidos en el ESTILO VISUAL. Si el estilo no indica una relación de aspecto, utiliza formato horizontal 16:9, adecuado para videos de YouTube. Cuida que los personajes y objetos importantes aparezcan completos, correctamente ubicados, sin quedar cortados por los bordes, con una composición limpia, legible y sin elementos superpuestos de manera confusa.

La cantidad de prompts debe coincidir exactamente con la cantidad de timestamps del TRAMO A ILUSTRAR. No omitas ningún timestamp, aunque su fragmento sea corto. No combines dos timestamps diferentes dentro de un mismo prompt. No dividas un timestamp en varios prompts. Usa el orden cronológico exacto del guion. No escribas prompts para timestamps que no estén en el tramo.

Escribí cada prompt en el mismo idioma en que está escrito el ESTILO VISUAL (si no hay estilo, en inglés), como un único párrafo continuo, sin el timestamp, títulos, numeración, etiquetas ni explicaciones dentro del texto del prompt.

Formato de respuesta: EXCLUSIVAMENTE un objeto JSON { "prompts": [ { "order": number, "prompt": string } ] }, con una entrada por timestamp del tramo, en orden, donde "order" es el número de escena que figura entre paréntesis al lado de cada timestamp del tramo.`;

export interface GenerateImagePromptSequenceInput extends ChannelContext {
  scenes: SequenceScene[];
  // Guion completo con timestamps -- se lee entero antes de ilustrar el tramo.
  full_script?: SequenceScene[];
  // Escenas vecinas al tramo (anterior y siguiente) -- solo contexto. Si ya
  // tienen prompt, se pasa para que el tramo arranque/termine encadenado.
  context_before?: (SequenceScene & { prompt?: string })[];
  context_after?: (SequenceScene & { prompt?: string })[];
}

export interface GenerateImagePromptSequenceOutput {
  prompts: { order: number; prompt: string }[];
}

function contextBlock(label: string, scenes?: (SequenceScene & { prompt?: string })[]): string {
  if (!scenes?.length) return "";
  const lines = scenes.map(
    (s) => `${sceneLabel(s)} ${s.text.trim().slice(0, 500)}${s.prompt ? `\n  (prompt ya usado: ${s.prompt.slice(0, 400)})` : ""}`
  );
  return `\n${label}:\n${lines.join("\n")}\n`;
}

export const generateImagePromptSequenceTool: ToolDefinition<
  GenerateImagePromptSequenceInput,
  GenerateImagePromptSequenceOutput
> = {
  name: "generate_image_prompt_sequence",
  description:
    "Genera los prompts de imagen de un tramo de escenas consecutivas con el guion completo con timestamps y el diseño visual del canal, para que las imagenes sigan la historia y el estilo.",
  parameters: {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        description: "Escenas consecutivas a ilustrar: { order, text }",
        items: { type: "object", properties: { order: { type: "number" }, text: { type: "string" } } },
      },
      full_script: { type: "array", description: "Guion completo con timestamps: { order, text, time }", items: { type: "object" } },
      context_before: { type: "array", description: "Escenas anteriores al tramo (contexto)", items: { type: "object" } },
      context_after: { type: "array", description: "Escenas posteriores al tramo (contexto)", items: { type: "object" } },
      video_topic: { type: "string", description: "Titulo del video (opcional)" },
      visual_style: { type: "string", description: "Diseño visual del canal (opcional)" },
      content_policy: { type: "object", description: "Preferencias/restricciones visuales del proyecto (opcional)" },
    },
    required: ["scenes"],
  },
  async execute(input) {
    const fullScript = input.full_script?.length ? scenesBlock(input.full_script).slice(0, MAX_SCRIPT_CHARS) : null;
    const user =
      `${input.video_topic ? `Titulo del video: ${input.video_topic}\n` : ""}${policyLines(input.content_policy)}` +
      `ESTILO VISUAL:\n${input.visual_style?.trim() || "(no definido: elegi uno coherente con el tema y mantenelo)"}\n` +
      (fullScript ? `\nGUION COMPLETO CON TIMESTAMPS:\n${fullScript}\n` : "") +
      contextBlock("Prompts ya usados en los timestamps anteriores al tramo (para no repetir composicion)", input.context_before?.filter((c) => c.prompt)) +
      `\nTRAMO A ILUSTRAR (un prompt por timestamp, "order" entre parentesis):\n${input.scenes
        .map((sc) => `${sceneLabel(sc)} (${sc.order}) ${sc.text.trim()}`)
        .join("\n")}\n` +
      contextBlock("Prompts ya usados en los timestamps posteriores al tramo", input.context_after?.filter((c) => c.prompt));

    const parsed = await chatJson(SEQUENCE_SYSTEM_PROMPT, user);
    if (!parsed) {
      const style = input.visual_style?.trim();
      return {
        prompts: input.scenes.map((s) => ({
          order: s.order,
          prompt: `Illustration of: ${s.text.trim().slice(0, 400)}${style ? `\n\nStyle: ${style}` : ""}`,
        })),
      };
    }

    const raw = Array.isArray(parsed.prompts) ? parsed.prompts : [];
    const wanted = new Set(input.scenes.map((s) => s.order));
    const prompts = raw
      .map((p) => p as { order?: unknown; prompt?: unknown })
      .filter((p): p is { order: number; prompt: string } =>
        typeof p.order === "number" && wanted.has(p.order) && typeof p.prompt === "string" && !!p.prompt.trim()
      )
      .map((p) => ({ order: p.order, prompt: p.prompt.trim() }));
    // Algunos modelos no devuelven el order, pero si la lista completa en
    // orden: en ese caso se asigna por posicion.
    if (prompts.length === 0 && raw.length === input.scenes.length) {
      return {
        prompts: raw
          .map((p, i) => ({ order: input.scenes[i]!.order, prompt: String((p as { prompt?: unknown }).prompt ?? "").trim() }))
          .filter((p) => p.prompt),
      };
    }
    return { prompts };
  },
};
