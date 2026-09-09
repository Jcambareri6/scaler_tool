import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { deriveKeywords } from "../lib/keywords.js";
import { withRetry } from "../lib/retry.js";
import { fetchWithTimeout } from "../lib/http.js";
import type { ContentPolicy } from "../types/shared/typeShared.js";
import type { VisualContext } from "./generateVisualContext.tool.js";

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
  // Fase 1 del prompt del cliente (generate_visual_context, corre UNA vez
  // por video) -- da coherencia de epoca/ubicacion/tono entre todas las
  // escenas en vez de que cada una decida por su cuenta.
  visual_context?: VisualContext;
  // Las queries que devolvio la escena INMEDIATAMENTE anterior -- evita que
  // dos bloques consecutivos terminen buscando lo mismo (regla 9 del
  // prompt del cliente).
  previous_scene_queries?: string[];
}

export interface GenerateStockKeywordsOutput {
  // Siempre 4, ordenadas de mas especifica a mas amplia (ver SYSTEM_PROMPT)
  // -- search_stock las prueba en ese orden y se queda con la primera que
  // traiga resultados (cascada, Fase 2 del prompt del cliente).
  keywords: string[];
}

// Fase 2 del prompt del cliente (PROMPT PARA BUSQUEDA DE VIDEO STOCK CON
// ANALISIS DE CONTEXTO GLOBAL_.docx): 4 queries en cascada por escena, en
// vez de una bolsa de 2-4 keywords sueltas sin orden de fallback explicito.
const SYSTEM_PROMPT = `Sos el director visual de una plataforma de videos faceless para YouTube.
Te doy un fragmento narrado del guion (un "bloque de escena") y tenes que devolver EXACTAMENTE 4 queries de busqueda en ingles para clips de video de stock (Pexels/Pixabay), ordenadas de mas especifica a mas amplia -- un sistema automatico prueba la primera, y si no encuentra resultados va bajando a la siguiente.

Reglas:
- Siempre EN INGLES, sin importar el idioma del fragmento.
- Las 4 queries describen la MISMA escena, solo con distinto nivel de precision -- no escenas distintas:
  1. MUY ESPECIFICA (4-6 palabras): detalle visual concreto, epoca y contexto.
  2. ESPECIFICA (3-5 palabras): la accion o situacion principal, con menos contexto.
  3. INTERMEDIA (2-4 palabras): sujeto y accion generica.
  4. AMPLIA (1-3 palabras): concepto, sujeto o ambiente general.
- Cada query tiene que ser algo VISUAL Y FILMABLE. Si el fragmento es abstracto (ej. "todo cambio para siempre"), traducilo primero a la escena literal mas probable segun el contexto; si no hay traduccion literal razonable, usa una metafora visual concreta y muy indexada (reloj para "el tiempo pasa", puertas abriendose para "nuevas oportunidades"). Priorizá siempre lo literal sobre lo simbolico.
- NUNCA nombres propios de personas reales (Napoleon, Einstein, Messi) -- reemplazalos por descripcion generica coherente con epoca/rol (ej. "elderly scientist writing notebook 1920s").
- Nombres de lugares: solo si son mundialmente reconocidos e indexados (ej. "New York skyline", "Paris Eiffel Tower"); en cualquier otro caso, generaliza el tipo de paisaje/ciudad (ej. "european old town", "small coastal village").
- Si se te da un contexto visual global del video (epoca, ubicacion, tono, paleta), TODAS las queries tienen que respetarlo -- no mezcles epocas ni estilos entre escenas salvo que el fragmento lo pida explicitamente.
- Si se te dan las queries de la escena anterior, no repitas ninguna igual -- busca un angulo distinto (otro plano, otra accion, otro momento, otro punto de vista) si el contenido es similar.
- Si el fragmento narra un evento o epoca historica, incluila en la query mas especifica (ej. "1920s", "medieval", "ancient Rome", "victorian era", "cold war").
- Evita queries vacias o demasiado genericas sin modificador ("nature", "people", "life", "world", "moment") -- siempre acompañadas de un modificador visual concreto.
- Si el mensaje incluye preferencias visuales del proyecto, usalas para inclinar el estilo/tematica hacia eso cuando tenga sentido con el fragmento (sin forzarlo si no encaja).
- Si el mensaje incluye temas a evitar, nunca generes queries relacionadas a esos temas.
- Responde EXCLUSIVAMENTE con un objeto JSON: { "keywords": [muy_especifica, especifica, intermedia, amplia] } -- un array de EXACTAMENTE 4 strings, en ese orden.`;

function buildUserPrompt(
  sceneText: string,
  videoTopic?: string,
  contentPolicy?: ContentPolicy,
  visualContext?: VisualContext,
  previousSceneQueries?: string[]
): string {
  const topicLine = videoTopic ? `Tema general del video: ${videoTopic}\n` : "";
  const contextLine = visualContext
    ? `Contexto visual global del video -- tema: ${visualContext.theme} | genero: ${visualContext.genre} | epoca: ${visualContext.era} | ubicacion: ${visualContext.location} | tono: ${visualContext.visual_tone} | paleta: ${visualContext.palette_keywords.join(", ")}${visualContext.recurring_characters.length > 0 ? ` | personajes recurrentes: ${visualContext.recurring_characters.join("; ")}` : ""}\n`
    : "";
  const previousLine =
    previousSceneQueries && previousSceneQueries.length > 0
      ? `Queries ya usadas en la escena anterior (no las repitas): ${previousSceneQueries.join(" | ")}\n`
      : "";
  const preferLine =
    contentPolicy?.prefer && contentPolicy.prefer.length > 0
      ? `Preferencias visuales del proyecto (priorizalas si encajan con el fragmento): ${contentPolicy.prefer.join(", ")}\n`
      : "";
  const blockLine =
    contentPolicy?.block && contentPolicy.block.length > 0
      ? `Temas/terminos a evitar en las keywords para este proyecto: ${contentPolicy.block.join(", ")}\n`
      : "";
  const notesLine = contentPolicy?.notes ? `Notas adicionales del proyecto: ${contentPolicy.notes}\n` : "";
  return `${topicLine}${contextLine}${previousLine}${preferLine}${blockLine}${notesLine}Fragmento del guion:\n${sceneText}`;
}

export const generateStockKeywordsTool: ToolDefinition<
  GenerateStockKeywordsInput,
  GenerateStockKeywordsOutput
> = {
  name: "generate_stock_keywords",
  description:
    "Genera 4 queries de busqueda de stock en ingles (via LLM), de mas especifica a mas amplia, coherentes con el contexto visual global del video (generate_visual_context) y sin repetir la escena anterior.",
  parameters: {
    type: "object",
    properties: {
      scene_text: { type: "string", description: "Texto narrado de la escena" },
      video_topic: { type: "string", description: "Titulo o tema general del video (opcional, da contexto)" },
      content_policy: {
        type: "object",
        description: "Preferencias/restricciones visuales del proyecto (prefer/block/notes), opcional",
      },
      visual_context: {
        type: "object",
        description: "Contexto visual global del video (tema, epoca, ubicacion, tono, paleta) de generate_visual_context, opcional",
      },
      previous_scene_queries: {
        type: "array",
        items: { type: "string" },
        description: "Las 4 queries devueltas para la escena inmediatamente anterior, para no repetirlas",
      },
    },
    required: ["scene_text"],
  },
  async execute({ scene_text, video_topic, content_policy, visual_context, previous_scene_queries }) {
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
            {
              role: "user",
              content: buildUserPrompt(scene_text, video_topic, content_policy, visual_context, previous_scene_queries),
            },
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
