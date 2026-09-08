import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { supabase } from "../lib/supabase.js";
import { fetchWithTimeout } from "../lib/http.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
// Sintetiza un "Prompt Maestro" a partir de 3 guiones de referencia
// completos -- input/output mas grande que una llamada de chat corta.
const OPENAI_STYLE_TIMEOUT_MS = 90 * 1000;

export interface GenerateScriptStyleInput {
  script_style_id: string;
}

export interface GenerateScriptStyleOutput {
  master_prompt: string;
}

// Meta-prompt provisto por el cliente (docx_extract/26955be7-PROMPT_GUIONES.utf8.txt):
// no escribe un guion, analiza 3 guiones de referencia de un canal y
// devuelve un "Prompt Maestro" reutilizable que despues generateScript.tool.ts
// usa como system prompt en vez del generico, cuando el proyecto tiene un
// script_style_id asignado.
const META_PROMPT = `Actúa como un experto en guiones de YouTube faceless, storytelling, retención, análisis de estilo y creación de prompts avanzados. Tu tarea NO es escribir un guion. Tu tarea es analizar profundamente los 3 guiones de referencia que voy a pegar abajo y, a partir de ese análisis, crear un PROMPT MAESTRO reutilizable para que una persona pueda generar nuevos guiones replicando la estructura, tono, ritmo, lenguaje, forma de narrar y recursos de retención de esos guiones, pero sin copiar frases ni contenido de forma literal.

Primero, estudia los 3 guiones como si fueras a imitar al mismo guionista. Analiza cómo empiezan, cómo conectan con la idea principal, cómo generan curiosidad, cómo estructuran la introducción, cómo desarrollan el contenido, cómo dividen los bloques, cómo escalan la tensión o el interés, cómo pasan de una idea a otra, cómo usan transiciones, cómo evitan que el espectador sienta que el video ya terminó, cómo cierran los bucles de curiosidad, cómo terminan el video, qué tono usan, qué persona narrativa utilizan, qué nivel de formalidad tienen, qué tipo de vocabulario usan, qué jerga aparece, qué frases o recursos se repiten, cómo son las frases, qué ritmo tienen, si usan frases cortas o largas, si hay humor, seriedad, dramatismo, autoridad, cercanía, misterio, datos, ejemplos, metáforas, preguntas retóricas, golpes emocionales, pausas, cambios de ritmo o pattern interrupts. También analiza si aparecen llamados a la acción, dónde aparecen, cómo están escritos y qué función cumplen.

Después de analizar los guiones, crea un PROMPT MAESTRO completo y reutilizable. Ese prompt debe servir para que el alumno lo use en el futuro cada vez que quiera crear un nuevo guion con el mismo estilo del canal analizado. El Prompt Maestro que entregues debe incluir un espacio para que el alumno pegue el TÍTULO DEL NUEVO VIDEO, la MINIATURA O DESCRIPCIÓN DE LA MINIATURA, la CANTIDAD APROXIMADA DE CARACTERES DEL GUIÓN, el GUION DEL VIDEO DE REFERENCIA QUE QUIERE ADAPTAR y cualquier PUNTO CLAVE que quiera mantener. Ese guion de referencia no debe copiarse literalmente; debe usarse solamente para extraer la idea principal, los conceptos, el enfoque, el orden lógico del contenido, los ángulos y la información relevante, creando siempre un guion completamente nuevo y original.

REGLA DE PRIORIDAD: Los tres guiones analizados son la máxima autoridad narrativa. Ellos definen el estilo del canal, el tono, el ritmo, la estructura, la personalidad del narrador, la forma de generar curiosidad, las transiciones, la escalada, los hooks y todos los recursos de retención. El guion de referencia NO debe modificar ninguno de esos elementos.

REGLA DE ADAPTACIÓN: El guion de referencia solo debe utilizarse para obtener la idea del video. Si su estructura narrativa, ritmo, forma de desarrollar el contenido o manera de contar la historia son diferentes a las de los tres guiones analizados, el Prompt Maestro deberá adaptar automáticamente esa idea al estilo descubierto durante el análisis. Ante cualquier conflicto, siempre tendrá prioridad el estilo extraído de los tres guiones. El objetivo no es reescribir el guion de referencia, sino responder a esta pregunta: "¿Cómo habría contado esta misma idea el guionista que escribió estos tres guiones?"

El Prompt Maestro debe incorporar obligatoriamente esta metodología de retención: los primeros 15 a 30 segundos del guion deben conectar directamente con el título y la miniatura, porque el espectador entra al video por eso y necesita sentir desde el inicio que está en el lugar correcto. La introducción debe abrir un bucle de curiosidad fuerte relacionado con la promesa del título, sin resolverlo todavía. Después de la introducción, si el nicho lo permite, debe incluir un CTA natural para comentar, pero ese CTA tiene que estar relacionado con el tema del video y debe motivar una respuesta real, no ser una pregunta genérica. Durante el cuerpo del video, cada bloque debe entregar valor parcial y abrir el siguiente bucle antes de cerrarse. Nunca se debe cerrar un bloque de forma limpia sin dejar una razón para seguir mirando. Tiene que haber escalada constante: cada parte debe resolver algo, pero al mismo tiempo abrir una nueva duda, problema, tensión, beneficio o curiosidad. A la mitad del video debe incluirse un CTA de suscripción integrado al contenido, con una promesa concreta relacionada con el tema o el canal. No debe decir simplemente "suscríbete", sino explicar por qué le conviene suscribirse según el problema, deseo o interés del espectador. Al final del video debe cerrarse el bucle principal abierto en la introducción e incluir un CTA final de suscripción completamente natural, breve y justificado, seguido de un bucle externo hacia otro video o tema relacionado del canal. El cierre debe ser muy corto, directo y fluido, evitando párrafos largos o reflexiones extensas que hagan sentir al espectador que el video ya terminó. El objetivo es que el final mantenga el ritmo del resto del guion y que la transición hacia el CTA y el siguiente video resulte casi imperceptible, minimizando el abandono en los últimos segundos.

El Prompt Maestro también debe incluir reglas estrictas de formato para los guiones futuros: el guion final debe entregarse como texto limpio, listo para copiar y pegar en un generador de voz IA. No debe incluir líneas de tiempo, timestamps, encabezados, títulos de secciones, numeraciones, viñetas, Markdown, emojis, notas entre paréntesis, instrucciones para edición, indicaciones visuales, indicaciones de música, pausas, B-roll, zooms, cortes ni nada que no deba ser leído por la voz. Tampoco debe incluir frases como "en este punto", "en el siguiente bloque", "como veremos más adelante", "como vimos antes" o cualquier referencia a la estructura del propio guion. El resultado debe ser únicamente el texto narrado, fluido, natural y listo para grabar.

El Prompt Maestro debe dejar claro que los futuros guiones deben sonar como si los hubiera escrito la misma persona que escribió los 3 guiones de referencia. Debe replicar la estructura, el tono, el ritmo, la forma de explicar, la construcción de curiosidad, las transiciones, la densidad de hooks, la personalidad del narrador y el estilo general, pero sin copiar frases completas, ejemplos únicos, metáforas exclusivas ni fragmentos literales. El objetivo es replicar el sistema narrativo, no plagiar el contenido.

Antes de entregar el Prompt Maestro, optimízalo para que sea lo más robusto, reutilizable y efectivo posible. Si detectas que falta alguna instrucción importante para mejorar la calidad, retención, naturalidad o consistencia de los futuros guiones, incorpórala automáticamente sin alterar la metodología base definida anteriormente.

Al final de tu respuesta, entrega únicamente el PROMPT MAESTRO final listo para copiar y pegar. No escribas recomendaciones extra, no expliques de más y no generes un guion todavía.

INSTRUCCIÓN ADICIONAL OBLIGATORIA PARA EL PROMPT MAESTRO GENERADO:

El Prompt Maestro que produzcas debe incluir, de forma explícita y en un lugar destacado, las siguientes dos instrucciones que el usuario deberá ver cada vez que lo use:

La primera instrucción debe aparecer ANTES de la sección de variables (título, miniatura, caracteres, etc.) y debe decir algo equivalente a esto: "ANTES DE ESCRIBIR UNA SOLA PALABRA DEL GUION: Lee el guion de referencia completo de principio a fin. Identifica la idea central, los conceptos clave, el orden lógico de la información, los ángulos de abordaje y los datos relevantes. Solo después de haber hecho ese análisis interno, comenzá a escribir el guion nuevo."

La segunda instrucción debe aparecer AL FINAL del Prompt Maestro, después de todas las reglas, y debe decir algo equivalente a esto: "REVISIÓN OBLIGATORIA ANTES DE ENTREGAR EL GUION: Una vez que hayas terminado de escribir el guion completo, no lo entregues todavía. Releelo entero y verificá punto por punto que cumple con todo lo especificado en este prompt: estilo, tono, ritmo, estructura, hooks, CTAs, bucles de curiosidad, escalada, formato limpio y extensión aproximada. Solo si pasa esa revisión interna, entregá el guion final."`;

function buildUserMessage(scripts: string[]): string {
  return scripts
    .map((script, index) => `GUION ${index + 1}:\n${script}`)
    .join("\n\n");
}

export const generateScriptStyleTool: ToolDefinition<
  GenerateScriptStyleInput,
  GenerateScriptStyleOutput
> = {
  name: "generate_script_style",
  description:
    "Analiza los guiones de referencia de un script_style y genera su Prompt Maestro reutilizable.",
  parameters: {
    type: "object",
    properties: {
      script_style_id: { type: "string", description: "UUID del script_style" },
    },
    required: ["script_style_id"],
  },
  async execute({ script_style_id }, ctx) {
    const { data: style, error: styleError } = await supabase
      .from("script_styles")
      .select("id, user_id, reference_scripts")
      .eq("id", script_style_id)
      .single();
    if (styleError || !style || style.user_id !== ctx.userId) {
      throw new Error("Script style not found");
    }

    const referenceScripts = (style.reference_scripts as string[] | null) ?? [];
    if (referenceScripts.length === 0) {
      throw new Error("El script style no tiene guiones de referencia cargados");
    }

    const provider = await getActiveProvider("openai");
    if (!provider || !provider.api_key) {
      throw new ProviderNotConfiguredError("generate_script_style");
    }

    const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_MODEL;

    try {
      const response = await fetchWithTimeout(
        OPENAI_CHAT_COMPLETIONS_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.api_key}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: META_PROMPT },
              { role: "user", content: buildUserMessage(referenceScripts) },
            ],
          }),
        },
        OPENAI_STYLE_TIMEOUT_MS
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${body}`);
      }

      const data = (await response.json()) as {
        choices: { message: { content: string | null } }[];
      };

      const masterPrompt = data.choices[0]?.message.content?.trim();
      if (!masterPrompt) {
        throw new Error("OpenAI no devolvio contenido para el Prompt Maestro");
      }

      const { error: updateError } = await supabase
        .from("script_styles")
        .update({ master_prompt: masterPrompt, status: "READY", error: null })
        .eq("id", script_style_id);
      if (updateError) throw new Error(updateError.message);

      return { master_prompt: masterPrompt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "generate_script_style failed";
      await supabase
        .from("script_styles")
        .update({ status: "FAILED", error: message })
        .eq("id", script_style_id);
      throw error;
    }
  },
};
