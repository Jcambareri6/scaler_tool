import type { ToolDefinition } from "./tool.types.js";
import { getActiveProvider } from "../lib/providers.js";
import { withRetry } from "../lib/retry.js";
import type { ContentPolicy } from "../types/shared/typeShared.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export interface GenerateVideoPromptInput {
  scene_text: string;
  video_topic?: string;
  content_policy?: ContentPolicy;
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
    },
    required: ["scene_text"],
  },
  async execute({ scene_text, video_topic, content_policy }) {
    const provider = await getActiveProvider("openai");
    if (!provider?.api_key) {
      // Sin OpenAI configurado, se cae a una descripcion generica derivada
      // del texto tal cual -- peor calidad, pero no rompe el pipeline.
      return { prompt: `Cinematic B-roll footage illustrating: ${scene_text}`.slice(0, 500) };
    }

    const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_MODEL;

    const data = await withRetry(async () => {
      const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(scene_text, video_topic, content_policy) },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${body}`);
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
