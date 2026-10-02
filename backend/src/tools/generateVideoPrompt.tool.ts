import type { ToolDefinition } from "./tool.types.js";
import { getActiveProvider } from "../lib/providers.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";
import { providerApiError } from "../lib/errors.js";
import type { ContentPolicy } from "../types/shared/typeShared.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export interface GenerateVideoPromptInput {
  scene_text: string;
  video_topic?: string;
  content_policy?: ContentPolicy;
  // Diseño visual del canal (recursos compartidos del workspace, ver
  // lib/channelSettings.ts). Cada prompt tiene que traerlo incorporado:
  // Flow y los generadores no recuerdan nada entre un prompt y el otro.
  visual_style?: string;
  // Narrativa de las escenas vecinas, para que la imagen siga el hilo del
  // guion (mismos personajes/lugar) en vez de ilustrar el fragmento suelto.
  previous_scene_text?: string;
  next_scene_text?: string;
  // "image" cuando el prompt va a un generador de imagenes (Flow, Imagen
  // con IA): sin movimientos de camara, una sola composicion fija.
  target?: "video" | "image";
}

export interface GenerateVideoPromptOutput {
  prompt: string;
}

// Usado solo en el pipeline automatico cuando visual_source es "ai"/"mixed"
// -- no hay un humano tipeando el prompt de generacion para cada escena
// (eso es la regeneracion manual en scene.service.ts), asi que se deriva
// uno con el mismo LLM que ya arma las keywords de stock, pero pensado
// para un generador de video (sujeto, accion, camara, iluminacion) en vez
// de una busqueda por palabras clave.
const SYSTEM_PROMPT = `Sos el director visual de una plataforma de videos faceless para YouTube.
Te doy un fragmento narrado del guion (y opcionalmente el tema general del video) y tenes que devolver
UN SOLO prompt EN INGLES para un generador de video con IA (tipo Veo/Kling) que ilustre ese fragmento.

Reglas:
- El prompt es EN INGLES siempre, sin importar el idioma del fragmento.
- Describi una escena CONCRETA y filmable: sujeto, accion, ambiente, y opcionalmente movimiento de camara o iluminacion (ej: "A close-up of fresh vegetables being chopped on a wooden cutting board, warm kitchen lighting, shallow depth of field").
- No repitas el texto narrado literal -- pensa en que imagen en movimiento representa la idea.
- Si el mensaje incluye preferencias visuales del proyecto, inclinate hacia eso cuando tenga sentido con el fragmento.
- Si el mensaje incluye temas a evitar, el prompt nunca debe describir esos temas.
- Responde EXCLUSIVAMENTE con un objeto JSON: { "prompt": string }`;

const SCENE_CONTEXT_MAX = 600;

function buildUserPromptWithContext(input: GenerateVideoPromptInput): string {
  const base = buildUserPrompt(input.scene_text, input.video_topic, input.content_policy);
  const prev = input.previous_scene_text?.trim().slice(-SCENE_CONTEXT_MAX);
  const next = input.next_scene_text?.trim().slice(0, SCENE_CONTEXT_MAX);
  if (!prev && !next) return base;
  return `${base}\n\nContexto del guion (solo para continuidad, NO lo ilustres):${prev ? `\n- Escena anterior: ${prev}` : ""}${next ? `\n- Escena siguiente: ${next}` : ""}`;
}

function buildSystemPrompt(input: GenerateVideoPromptInput): string {
  let prompt = SYSTEM_PROMPT;
  if (input.target === "image") {
    prompt += `\n\nEl prompt es para un generador de IMAGENES (no de video): describi UNA sola composicion fija -- sin movimientos de camara ni acciones en secuencia.`;
  }
  if (input.visual_style?.trim()) {
    prompt += `\n\nESTILO VISUAL OBLIGATORIO DEL CANAL (lo define el dueño del canal, tiene prioridad sobre cualquier otra idea de estilo):
<<<
${input.visual_style.trim()}
>>>
Reglas del estilo:
- Cada prompt se usa SOLO, sin memoria de los anteriores: tiene que traer incorporados los rasgos clave del estilo (tecnica/medio, paleta, iluminacion, encuadre, nivel de detalle, personajes recurrentes si los define) para que todas las escenas del video se vean del mismo canal.
- Primero el contenido de la escena (sujeto, accion, lugar) y despues los rasgos del estilo, en un solo parrafo.
- Si el estilo prohibe algo (texto en pantalla, caras, colores, etc.), el prompt nunca lo pide.
- El prompt sigue siendo EN INGLES aunque el estilo este escrito en otro idioma.`;
  }
  return prompt;
}

function buildUserPrompt(sceneText: string, videoTopic?: string, contentPolicy?: ContentPolicy): string {
  const topicLine = videoTopic ? `Tema general del video: ${videoTopic}\n` : "";
  const preferLine =
    contentPolicy?.prefer && contentPolicy.prefer.length > 0
      ? `Preferencias visuales del proyecto: ${contentPolicy.prefer.join(", ")}\n`
      : "";
  const blockLine =
    contentPolicy?.block && contentPolicy.block.length > 0
      ? `Temas a evitar: ${contentPolicy.block.join(", ")}\n`
      : "";
  const notesLine = contentPolicy?.notes ? `Notas adicionales del proyecto: ${contentPolicy.notes}\n` : "";
  return `${topicLine}${preferLine}${blockLine}${notesLine}Fragmento del guion:\n${sceneText}`;
}

export const generateVideoPromptTool: ToolDefinition<
  GenerateVideoPromptInput,
  GenerateVideoPromptOutput
> = {
  name: "generate_video_prompt",
  description:
    "Genera un prompt en ingles (via LLM) para un generador de video con IA, a partir de un fragmento del guion.",
  parameters: {
    type: "object",
    properties: {
      scene_text: { type: "string", description: "Texto narrado de la escena" },
      video_topic: { type: "string", description: "Titulo o tema general del video (opcional)" },
      content_policy: {
        type: "object",
        description: "Preferencias/restricciones visuales del proyecto (prefer/block/notes), opcional",
      },
      visual_style: { type: "string", description: "Diseño visual del canal a respetar en el prompt (opcional)" },
      previous_scene_text: { type: "string", description: "Narrativa de la escena anterior, para continuidad (opcional)" },
      next_scene_text: { type: "string", description: "Narrativa de la escena siguiente, para continuidad (opcional)" },
      target: { type: "string", enum: ["video", "image"], description: "Generador destino (default: video)" },
    },
    required: ["scene_text"],
  },
  async execute(input) {
    const { scene_text } = input;
    const provider = await getActiveProvider("openai");
    if (!provider?.api_key) {
      // Sin OpenAI configurado, se cae a una descripcion generica derivada
      // del texto tal cual -- peor calidad, pero no rompe el pipeline. El
      // estilo del canal va igual (pegado al final) para no perderlo.
      const base = `${input.target === "image" ? "Illustration of" : "Cinematic B-roll footage illustrating"}: ${scene_text}`.slice(0, 500);
      return { prompt: input.visual_style?.trim() ? `${base}\n\nStyle: ${input.visual_style.trim()}` : base };
    }

    const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_MODEL;

    const data = await withRetry(async () => {
      const response = await fetchWithTimeout(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildSystemPrompt(input) },
            { role: "user", content: buildUserPromptWithContext(input) },
          ],
        }),
      });

      if (!response.ok) {
        throw providerApiError("OpenAI", response.status, await response.text(), [provider.api_key]);
      }

      return (await response.json()) as {
        choices: { message: { content: string | null } }[];
      };
    });

    const raw = data.choices[0]?.message.content;
    if (!raw) {
      throw new Error("OpenAI no devolvio contenido para el prompt de video");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("OpenAI devolvio un JSON invalido para el prompt de video");
    }

    const prompt = (parsed as { prompt?: unknown }).prompt;
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new Error("OpenAI no devolvio un prompt de video valido");
    }

    return { prompt: prompt.trim() };
  },
};
