import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { deriveKeywords } from "../lib/keywords.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";
import type { ContentPolicy } from "../types/shared/typeShared.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
// LEEME (seccion 2): "OpenAI es el director visual del video... decide que
// buscar en stock", con modelo mini por control de costo -- esta Tool
// corre una vez POR ESCENA (pueden ser 20-30 llamadas por video), asi que
// el modelo barato/rapido importa mas aca que en generate_script.
const DEFAULT_MODEL = "gpt-4o-mini";

export interface GenerateStockKeywordsInput {
  scene_text: string;
  // Titulo/tema general del video -- ayuda a que las keywords tengan
  // contexto (ej: "ayuno intermitente" define el tono visual general,
  // aunque la escena puntual hable de otra cosa).
  video_topic?: string;
  // Gap #3 del LEEME (reglas "Plantas Sagradas") -- hasta ahora
  // content_policy.prefer/notes vivian en el schema sin usarse en ningun
  // lado (solo .block se aplicaba, y recien despues de buscar, no para
  // guiar la busqueda). Aca es donde tienen efecto real: la IA arma las
  // keywords ya sabiendo que preferir/evitar para ESTE proyecto puntual.
  content_policy?: ContentPolicy;
}

export interface GenerateStockKeywordsOutput {
  keywords: string[];
}

const SYSTEM_PROMPT = `Sos el director visual de una plataforma de videos faceless para YouTube.
Te doy un fragmento narrado del guion (y opcionalmente el tema general del video) y tenes que devolver
palabras clave EN INGLES para buscar clips de stock (Pexels/Pixabay) que representen visualmente ese fragmento.

Reglas:
- Las keywords son EN INGLES siempre, sin importar el idioma del fragmento (los bancos de stock rinden mucho mejor en ingles).
- No traduzcas el texto literal palabra por palabra -- pensa en que IMAGEN o VIDEO concreto ilustra la idea (ej: si el texto habla de "el hígado libera glucógeno", una keyword util es "liver anatomy" o "glucose molecule", no "liver releases glycogen" tal cual).
- Cada keyword tiene que ser buscable como clip real (evita conceptos abstractos que ningun banco de stock va a tener, como "silent process" o "biological wisdom").
- Devolvé entre 2 y 4 keywords, de mas especifica a mas generica (si la primera no da resultados, las siguientes son un buen respaldo).
- Si el mensaje incluye preferencias visuales del proyecto, usalas para inclinar el estilo/tematica de las keywords hacia eso cuando tenga sentido con el fragmento (sin forzarlo si no encaja).
- Si el mensaje incluye temas a evitar, nunca generes keywords relacionadas a esos temas.
- Responde EXCLUSIVAMENTE con un objeto JSON: { "keywords": string[] }`;

function buildUserPrompt(sceneText: string, videoTopic?: string, contentPolicy?: ContentPolicy): string {
  const topicLine = videoTopic ? `Tema general del video: ${videoTopic}\n` : "";
  const preferLine =
    contentPolicy?.prefer && contentPolicy.prefer.length > 0
      ? `Preferencias visuales del proyecto (priorizalas si encajan con el fragmento): ${contentPolicy.prefer.join(", ")}\n`
      : "";
  const blockLine =
    contentPolicy?.block && contentPolicy.block.length > 0
      ? `Temas/terminos a evitar en las keywords para este proyecto: ${contentPolicy.block.join(", ")}\n`
      : "";
  const notesLine = contentPolicy?.notes ? `Notas adicionales del proyecto: ${contentPolicy.notes}\n` : "";
  return `${topicLine}${preferLine}${blockLine}${notesLine}Fragmento del guion:\n${sceneText}`;
}

export const generateStockKeywordsTool: ToolDefinition<
  GenerateStockKeywordsInput,
  GenerateStockKeywordsOutput
> = {
  name: "generate_stock_keywords",
  description:
    "Genera keywords en ingles (via LLM) para buscar stock de video que represente visualmente un fragmento del guion.",
  parameters: {
    type: "object",
    properties: {
      scene_text: { type: "string", description: "Texto narrado de la escena" },
      video_topic: { type: "string", description: "Titulo o tema general del video (opcional, da contexto)" },
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
      // Sin Provider configurado, no se rompe el pipeline entero por esto
      // -- se cae al heuristico mecanico anterior (peor calidad, pero
      // sigue produciendo *algo* buscable).
      return { keywords: deriveKeywords(scene_text) };
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
      throw new ProviderNotConfiguredError("generate_stock_keywords");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("OpenAI devolvio un JSON invalido para las keywords");
    }

    const keywords = (parsed as { keywords?: unknown }).keywords;
    if (!Array.isArray(keywords) || keywords.length === 0) {
      throw new Error("OpenAI no devolvio keywords");
    }

    return { keywords: keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0) };
  },
};
