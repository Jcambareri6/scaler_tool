import Anthropic from "@anthropic-ai/sdk";
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
// completo con timestamps (los de Whisper, ver build_scenes) y el diseño
// visual del canal (el prompt del equipo, "PROMPT IMAGENES CON TIMESTAMPS").

// Claude primero: el estilo del canal tiene que quedar INTEGRADO en cada
// prompt (paleta y luz segun la escena, rotulos con contenido real,
// personajes descritos igual en todas), y gpt-4o-mini no lo hacia -- escribia
// la escena y salteaba el estilo. OpenAI queda de respaldo si no hay
// Provider de Anthropic.
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
// Con el guion entero en el prompt la respuesta tarda bastante mas que un
// prompt suelto.
const LLM_TIMEOUT_MS = 180 * 1000;
// Cada prompt con el estilo integrado ronda los 500-700 tokens; un tramo de
// 8 escenas entra holgado.
const MAX_OUTPUT_TOKENS = 16000;
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

interface PromptRow {
  order: number;
  prompt: string;
}

function policyLines(policy?: ContentPolicy): string {
  const lines: string[] = [];
  if (policy?.prefer?.length) lines.push(`Preferencias visuales del proyecto: ${policy.prefer.join(", ")}`);
  if (policy?.block?.length) lines.push(`Temas a evitar (nunca los muestres): ${policy.block.join(", ")}`);
  if (policy?.notes) lines.push(`Notas del proyecto: ${policy.notes}`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

// Un prompt es UN solo bloque: Flow (y la extension) toman cada parrafo
// como un prompt aparte, asi que un salto de linea adentro partia la
// escena en dos imagenes.
export function singleBlock(prompt: string): string {
  return prompt.replace(/\s*\n+\s*/g, " ").trim();
}

function sceneLabel(s: SequenceScene): string {
  return s.time ? `[${s.time}]` : `[Escena ${s.order}]`;
}

function scenesBlock(scenes: SequenceScene[]): string {
  return scenes.map((s) => `${sceneLabel(s)} ${s.text.trim()}`).join("\n");
}

const RETURN_PROMPTS_TOOL: Anthropic.Tool = {
  name: "return_prompts",
  description: "Devuelve un prompt de imagen por cada timestamp del TRAMO A ILUSTRAR, en orden.",
  input_schema: {
    type: "object",
    properties: {
      prompts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            order: { type: "number", description: "Numero de escena que figura entre parentesis en el tramo" },
            prompt: { type: "string", description: "El prompt completo, un unico parrafo" },
          },
          required: ["order", "prompt"],
        },
      },
    },
    required: ["prompts"],
  },
};

async function promptsWithAnthropic(system: string, user: string): Promise<unknown[] | null> {
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key) return null;
  const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_ANTHROPIC_MODEL;
  const client = new Anthropic({ apiKey: provider.api_key, timeout: LLM_TIMEOUT_MS });

  const response = await withRetry(() =>
    client.messages
      .stream({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools: [RETURN_PROMPTS_TOOL],
        tool_choice: { type: "tool", name: RETURN_PROMPTS_TOOL.name },
        messages: [{ role: "user", content: user }],
      })
      .finalMessage()
  );
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude no devolvio los prompts");
  const prompts = (toolUse.input as { prompts?: unknown }).prompts;
  return Array.isArray(prompts) ? prompts : [];
}

async function promptsWithOpenAI(system: string, user: string): Promise<unknown[] | null> {
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
              content: `${system}\n\nRespondé EXCLUSIVAMENTE con un objeto JSON { "prompts": [ { "order": number, "prompt": string } ] }.`,
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
  if (!raw) throw new Error("OpenAI no devolvio contenido");
  let parsed: { prompts?: unknown };
  try {
    parsed = JSON.parse(raw) as { prompts?: unknown };
  } catch {
    throw new Error("OpenAI devolvio un JSON invalido");
  }
  return Array.isArray(parsed.prompts) ? parsed.prompts : [];
}

// --- prompts en secuencia ---------------------------------------------

// Instrucciones del equipo que arma los prompts de imagen a mano ("PROMPT
// IMAGENES CON TIMESTAMPS"), textuales. Unicas adaptaciones: (1) se trabaja
// por tramos de timestamps -- el guion completo va SIEMPRE, pero en cada
// llamada se piden solo los prompts de un tramo, porque un video de 100+
// escenas no entra en una sola respuesta; (2) los tramos se escriben en
// paralelo, asi que se le pasan prompts de referencia del mismo video para
// que personajes y rotulos salgan iguales en todos; (3) la salida va por la
// tool return_prompts para poder asignar cada prompt a su escena.
const SEQUENCE_SYSTEM_PROMPT = `Quiero que actúes como un generador profesional de prompts para imágenes destinadas a ilustrar un video de YouTube. Vas a recibir: un bloque llamado ESTILO VISUAL, donde se describe detalladamente la apariencia que deberán tener todas las imágenes; el GUION COMPLETO CON TIMESTAMPS, donde cada marca de tiempo está acompañada por el fragmento de narración correspondiente; y un TRAMO A ILUSTRAR con los timestamps para los que tenés que escribir prompts en esta respuesta. Tu tarea es leer primero el guion completo para comprender la historia, el contexto general, los personajes, los lugares, la época, la progresión narrativa y la relación entre todas las escenas. Después, analiza individualmente lo que se dice en cada timestamp del tramo y crea exactamente un prompt de imagen diferente para cada uno de ellos.

Cada prompt debe representar visualmente la idea, acción, situación o concepto principal narrado dentro de ese timestamp. No debes limitarte a repetir literalmente el texto del guion: debes transformarlo en una escena visual clara, concreta y fácil de representar en una sola imagen. Cuando una frase sea abstracta, emocional, explicativa o no describa directamente una acción visible, conviértela en la representación visual más clara y coherente posible, utilizando personajes, objetos, escenarios, expresiones, comparaciones visuales, diagramas o composiciones simbólicas únicamente cuando sean necesarias para comunicar esa idea. No generes escenas aleatorias, genéricas o desconectadas de la narración.

Cada prompt debe ser autosuficiente, completo y estar listo para copiar y pegar directamente en un generador de imágenes. No debes depender de información incluida en prompts anteriores. Por eso, cuando aparezca un personaje importante, debes volver a describir en cada prompt sus características visuales esenciales, como edad aproximada, género, apariencia, cabello, vestimenta y cualquier rasgo necesario para mantener su identidad. Si el ESTILO VISUAL incluye una ficha o descripción específica de personajes, respétala exactamente y reutilízala de manera consistente en todos los prompts donde aparezcan.

Mantén continuidad visual entre todas las imágenes del mismo video. Los personajes recurrentes deben conservar el mismo rostro, edad, cuerpo, cabello, ropa y accesorios, salvo que el guion indique claramente un cambio de época, vestimenta, edad o situación. Los escenarios recurrentes también deben conservar una apariencia coherente. Si la historia avanza en el tiempo, representa correctamente la edad, el contexto histórico, la ropa, los objetos, los edificios y cualquier elemento correspondiente a ese momento. No mezcles épocas ni agregues elementos modernos en escenas históricas.

Aplica a todos los prompts la totalidad del ESTILO VISUAL proporcionado. No menciones frases como "utiliza el estilo anterior", "mismo estilo", "mismo personaje" o "igual que la escena previa", porque cada prompt debe funcionar por separado. Debes incorporar directamente dentro de cada prompt las características necesarias del estilo artístico, el tipo de personajes, los colores, la iluminación, el tipo de fondo, el nivel de realismo, el encuadre, la cámara, la composición, la atmósfera y el formato indicados en el bloque de estilo. Si alguna regla del estilo no resulta relevante para una escena concreta, prioriza la coherencia visual general sin forzar elementos innecesarios.

Representa únicamente el contenido correspondiente a cada timestamp, pero utiliza el contexto del guion completo para interpretar correctamente nombres, pronombres, referencias, lugares y situaciones. No adelantes sucesos que todavía no hayan ocurrido en la narración y no agregues acontecimientos posteriores dentro de una escena anterior. Tampoco repitas exactamente la misma composición en timestamps consecutivos (tené en cuenta también los prompts ya usados en los timestamps vecinos, si te los paso). Si varios fragmentos hablan del mismo acontecimiento, busca encuadres, acciones, expresiones, puntos de vista o momentos diferentes que permitan que cada imagen aporte información visual nueva sin contradecir el guion.

Cuando el timestamp contenga varias ideas, selecciona la idea visual más importante o intégralas dentro de una única composición clara y ordenada. No intentes representar demasiadas acciones separadas dentro de una sola imagen. Cada prompt debe describir un único frame, no una secuencia, animación, collage, tira de viñetas o conjunto de escenas, salvo que el ESTILO VISUAL o el propio guion soliciten explícitamente una composición dividida. Evita expresiones ambiguas como "se lo ve haciendo varias cosas", "antes y después" o "en diferentes momentos". Describe un instante visual concreto.

Incluye solamente texto dentro de la imagen cuando sea imprescindible para comprender la escena o cuando el ESTILO VISUAL lo indique. En caso de utilizarlo, debe ser breve, estar correctamente escrito y aparecer entre comillas dentro del prompt. No inventes carteles, subtítulos, nombres, estadísticas o frases que no sean necesarios. No agregues marcas de agua, logotipos, interfaces de inteligencia artificial ni elementos que revelen que la imagen fue generada.

Todos los prompts deben respetar el formato y la relación de aspecto establecidos en el ESTILO VISUAL. Si el estilo no indica una relación de aspecto, utiliza formato horizontal 16:9, adecuado para videos de YouTube. Cuida que los personajes y objetos importantes aparezcan completos, correctamente ubicados, sin quedar cortados por los bordes, con una composición limpia, legible y sin elementos superpuestos de manera confusa.

La cantidad de prompts debe coincidir exactamente con la cantidad de timestamps del TRAMO A ILUSTRAR. No omitas ningún timestamp, aunque su fragmento sea corto. No combines dos timestamps diferentes dentro de un mismo prompt. No dividas un timestamp en varios prompts. Usa el orden cronológico exacto del guion. No escribas prompts para timestamps que no estén en el tramo.

Si te paso PROMPTS DE REFERENCIA de otras partes de este mismo video, son la fuente de verdad para la continuidad: describí a los personajes recurrentes con exactamente las mismas palabras (edad, complexión, cabello, ropa) y mantené el mismo formato y criterio en rótulos, grafismos y textos en pantalla (por ejemplo, la numeración de capítulos según en qué parte del guion cae cada timestamp). No copies sus escenas.

Escribí cada prompt SIEMPRE en español, aunque el ESTILO VISUAL o el guion estén en otro idioma, como un único párrafo continuo, sin el timestamp, títulos, numeración, etiquetas, explicaciones ni comillas alrededor de todo el prompt. Devolvé los prompts con la herramienta return_prompts: una entrada por timestamp del tramo, en orden, donde "order" es el número de escena que figura entre paréntesis al lado de cada timestamp del tramo.`;

export interface GenerateImagePromptSequenceInput extends ChannelContext {
  scenes: SequenceScene[];
  // Guion completo con timestamps -- se lee entero antes de ilustrar el tramo.
  full_script?: SequenceScene[];
  // Escenas vecinas al tramo (anterior y siguiente) -- solo contexto. Si ya
  // tienen prompt, se pasa para que el tramo arranque/termine encadenado.
  context_before?: (SequenceScene & { prompt?: string })[];
  context_after?: (SequenceScene & { prompt?: string })[];
  // Prompts ya escritos de otras partes del video (ver sceneBatch.service.ts):
  // personajes y rotulos tienen que salir iguales en todos los tramos.
  reference_prompts?: string[];
}

export interface GenerateImagePromptSequenceOutput {
  prompts: PromptRow[];
}

function contextBlock(label: string, scenes?: (SequenceScene & { prompt?: string })[]): string {
  if (!scenes?.length) return "";
  const lines = scenes.map(
    (s) => `${sceneLabel(s)} ${s.text.trim().slice(0, 500)}${s.prompt ? `\n  (prompt ya usado: ${s.prompt.slice(0, 1500)})` : ""}`
  );
  return `\n${label}:\n${lines.join("\n")}\n`;
}

function referenceBlock(prompts?: string[]): string {
  if (!prompts?.length) return "";
  return `\nPROMPTS DE REFERENCIA de otras partes de este video (misma descripción de personajes y mismo formato de rótulos; no copies sus escenas):\n${prompts
    .map((p) => p.trim())
    .join("\n\n")}\n`;
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
      reference_prompts: { type: "array", description: "Prompts ya escritos del mismo video (continuidad)", items: { type: "string" } },
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
      referenceBlock(input.reference_prompts) +
      contextBlock("Prompts ya usados en los timestamps anteriores al tramo (para no repetir composicion)", input.context_before?.filter((c) => c.prompt)) +
      `\nTRAMO A ILUSTRAR (un prompt por timestamp, "order" entre parentesis):\n${input.scenes
        .map((sc) => `${sceneLabel(sc)} (${sc.order}) ${sc.text.trim()}`)
        .join("\n")}\n` +
      contextBlock("Prompts ya usados en los timestamps posteriores al tramo", input.context_after?.filter((c) => c.prompt));

    const raw =
      (await promptsWithAnthropic(SEQUENCE_SYSTEM_PROMPT, user)) ?? (await promptsWithOpenAI(SEQUENCE_SYSTEM_PROMPT, user));
    if (!raw) {
      const style = input.visual_style?.trim();
      return {
        prompts: input.scenes.map((s) => ({
          order: s.order,
          prompt: singleBlock(`Ilustración de: ${s.text.trim().slice(0, 400)}${style ? ` Estilo: ${style}` : ""}`),
        })),
      };
    }

    const wanted = new Set(input.scenes.map((s) => s.order));
    const prompts = raw
      .map((p) => p as { order?: unknown; prompt?: unknown })
      .filter((p): p is PromptRow =>
        typeof p.order === "number" && wanted.has(p.order) && typeof p.prompt === "string" && !!p.prompt.trim()
      )
      .map((p) => ({ order: p.order, prompt: singleBlock(p.prompt) }));
    // Algunos modelos no devuelven el order, pero si la lista completa en
    // orden: en ese caso se asigna por posicion.
    if (prompts.length === 0 && raw.length === input.scenes.length) {
      return {
        prompts: raw
          .map((p, i) => ({ order: input.scenes[i]!.order, prompt: singleBlock(String((p as { prompt?: unknown }).prompt ?? "")) }))
          .filter((p) => p.prompt),
      };
    }
    return { prompts };
  },
};
