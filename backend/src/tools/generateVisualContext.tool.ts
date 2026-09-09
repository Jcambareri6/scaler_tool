import type { ToolDefinition } from "./tool.types.js";
import { getActiveProvider } from "../lib/providers.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export interface GenerateVisualContextInput {
  full_text: string;
  video_topic?: string;
}

export interface VisualContext {
  theme: string;
  genre: string;
  era: string;
  location: string;
  recurring_characters: string[];
  visual_tone: string;
  palette_keywords: string[];
}

export interface GenerateVisualContextOutput {
  visual_context: VisualContext;
}

// Fase 1 del prompt del cliente (PROMPT PARA BUSQUEDA DE VIDEO STOCK CON
// ANALISIS DE CONTEXTO GLOBAL_.docx): se corre UNA sola vez por video (no
// por escena), para que las queries de stock de generate_stock_keywords
// sean coherentes entre si -- misma epoca, misma ubicacion, mismo tono en
// todas las escenas, salvo que el guion mismo cambie de escenario.
const SYSTEM_PROMPT = `Sos un director de contenido audiovisual especializado en analizar guiones narrativos de YouTube antes de buscar video de stock.
Te voy a dar el guion COMPLETO de un video. Analizalo de principio a fin y determina:

1. theme: tema central del video (de que trata realmente).
2. genre: genero narrativo (documental, informativo, educativo, dramatico, humoristico, inspiracional, etc).
3. era: epoca historica dominante (contemporaneo, siglo XX, siglo XIX, medieval, antiguo, futurista, atemporal). Si el guion mezcla epocas, elegi la dominante.
4. location: ubicacion geografica o tipo de paisaje dominante, EN INGLES (pais, region, urbano, rural, natural, maritimo, montañoso, desertico, etc).
5. recurring_characters: si aparecen personas especificas repetidas, describi sus rasgos visuales GENERICOS en ingles (edad aproximada, genero, rol, vestimenta acorde a la epoca) -- NUNCA nombres propios reales.
6. visual_tone: tono visual general EN INGLES (dark and somber, bright and warm, epic, intimate, mysterious, minimalist, cinematic, nostalgic, dynamic, corporate, etc).
7. palette_keywords: 3 a 6 palabras clave EN INGLES que describen el estilo visual dominante (ej: "vintage, sepia, archival, grainy" para historico, o "modern, urban, sleek, corporate" para contemporaneo).

Este analisis es interno: sirve de contexto compartido para que todas las busquedas de video de stock del mismo video sean coherentes entre si, sin mezclar epocas ni estilos entre escenas salvo que el guion lo indique explicitamente.

Responde EXCLUSIVAMENTE con un objeto JSON con esta forma exacta:
{ "theme": string, "genre": string, "era": string, "location": string, "recurring_characters": string[], "visual_tone": string, "palette_keywords": string[] }`;

function buildUserPrompt(fullText: string, videoTopic?: string): string {
  const topicLine = videoTopic ? `Titulo/tema general del video: ${videoTopic}\n\n` : "";
  return `${topicLine}GUION COMPLETO:\n${fullText}`;
}

// Sin Provider configurado (o si OpenAI falla) no se rompe el pipeline por
// esto -- se cae a un contexto neutro en vez de bloquear la generacion de
// queries por escena, que puede seguir funcionando sin contexto global
// (mismo criterio que generate_stock_keywords con deriveKeywords).
function fallbackVisualContext(videoTopic?: string): VisualContext {
  return {
    theme: videoTopic ?? "general",
    genre: "informativo",
    era: "contemporaneo",
    location: "generic urban and natural settings",
    recurring_characters: [],
    visual_tone: "neutral, cinematic",
    palette_keywords: ["modern", "clean", "documentary"],
  };
}

export const generateVisualContextTool: ToolDefinition<
  GenerateVisualContextInput,
  GenerateVisualContextOutput
> = {
  name: "generate_visual_context",
  description:
    "Analiza el guion completo UNA sola vez (tema, genero, epoca, ubicacion, personajes, tono visual, paleta) para darle contexto global coherente a las busquedas de stock de todas las escenas del video.",
  parameters: {
    type: "object",
    properties: {
      full_text: { type: "string", description: "Guion completo narrado del video" },
      video_topic: { type: "string", description: "Titulo o tema general del video (opcional, da contexto extra)" },
    },
    required: ["full_text"],
  },
  async execute({ full_text, video_topic }) {
    const provider = await getActiveProvider("openai");
    if (!provider?.api_key) {
      return { visual_context: fallbackVisualContext(video_topic) };
    }

    const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_MODEL;

    let data: { choices: { message: { content: string | null } }[] };
    try {
      data = await withRetry(async () => {
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
              { role: "user", content: buildUserPrompt(full_text, video_topic) },
            ],
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`OpenAI API error (${response.status}): ${body}`);
        }

        return (await response.json()) as { choices: { message: { content: string | null } }[] };
      });
    } catch {
      return { visual_context: fallbackVisualContext(video_topic) };
    }

    const raw = data.choices[0]?.message.content;
    if (!raw) {
      return { visual_context: fallbackVisualContext(video_topic) };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { visual_context: fallbackVisualContext(video_topic) };
    }

    const p = parsed as Partial<VisualContext>;
    const fallback = fallbackVisualContext(video_topic);
    return {
      visual_context: {
        theme: typeof p.theme === "string" && p.theme.trim() ? p.theme : fallback.theme,
        genre: typeof p.genre === "string" && p.genre.trim() ? p.genre : fallback.genre,
        era: typeof p.era === "string" && p.era.trim() ? p.era : fallback.era,
        location: typeof p.location === "string" && p.location.trim() ? p.location : fallback.location,
        recurring_characters: Array.isArray(p.recurring_characters)
          ? p.recurring_characters.filter((c): c is string => typeof c === "string")
          : fallback.recurring_characters,
        visual_tone: typeof p.visual_tone === "string" && p.visual_tone.trim() ? p.visual_tone : fallback.visual_tone,
        palette_keywords: Array.isArray(p.palette_keywords)
          ? p.palette_keywords.filter((k): k is string => typeof k === "string")
          : fallback.palette_keywords,
      },
    };
  },
};
