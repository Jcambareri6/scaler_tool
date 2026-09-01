import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";
import { getActiveProvider } from "../lib/providers.js";
import { getOwnedProject, getOwnedScriptStyle } from "../lib/ownership.js";
import { supabase } from "../lib/supabase.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
// El guion (full_text) mas su desglose en scenes (mismo texto repartido)
// duplica el contenido narrado dentro del JSON de salida -- para un guion
// de 20-25k caracteres eso ronda los 20k tokens de salida. Se pide en
// streaming para no pegar contra el timeout HTTP de una respuesta no-stream.
const MAX_OUTPUT_TOKENS = 32000;

const RETURN_SCRIPT_TOOL_NAME = "return_script";

export type ScriptProvider = "openai" | "anthropic";
const DEFAULT_PROVIDER: ScriptProvider = "anthropic";

export interface GenerateScriptInput {
  video_project_id: string;
  idea: string;
  target_duration?: number;
  // GPT tiende a acortar guiones narrativos largos aunque se le pida mas
  // extension; Claude sostiene mejor un texto largo en una sola respuesta.
  // Default "anthropic" -- el caller puede forzar "openai" si quiere.
  provider?: ScriptProvider;
  // Fase 1 (Script Styles): si viene script_style_id, se usa el
  // master_prompt de ese canal en vez del SYSTEM_PROMPT generico -- ver
  // buildStyledMessages. Los campos de abajo son las "variables" que pide
  // el Prompt Maestro (docx_extract/26955be7-PROMPT_GUIONES.utf8.txt),
  // todos opcionales.
  script_style_id?: string;
  title?: string;
  thumbnail_description?: string;
  approx_chars?: number;
  reference_script?: string;
  key_points?: string;
}

export interface GeneratedScene {
  order: number;
  text: string;
}

export interface GenerateScriptOutput {
  content: Record<string, unknown>;
  scenes: GeneratedScene[];
}

interface GeneratedScriptPayload {
  title: string;
  full_text: string;
  scenes: GeneratedScene[];
}

const BASE_RULES = `Sos el guionista de una plataforma de generacion de videos faceless para YouTube.
Con la idea que te da el usuario, escribis un guion narrado completo, listo para locucion.

Reglas:
- "full_text" es el guion completo narrado, de principio a fin.
- "scenes" divide "full_text" en unidades narrativas ordenadas (order arranca en 1); cada fragmento de "text" concatenado en orden debe reconstruir "full_text".
- Escribi en el mismo idioma que la idea del usuario.
- No inventes datos puntuales (numeros, nombres, fuentes) que el usuario no haya dado; si falta informacion especifica, mantene el guion generico pero completo.`;

const OPENAI_FORMAT_INSTRUCTIONS = `Ademas de todas las reglas anteriores, responde EXCLUSIVAMENTE con un objeto JSON, sin texto adicional.
El JSON debe tener esta forma exacta:
{ "title": string, "full_text": string, "scenes": [ { "order": number, "text": string } ] }`;

const ANTHROPIC_FORMAT_INSTRUCTIONS = `Ademas de todas las reglas anteriores, entrega el resultado exclusivamente a traves de la tool "${RETURN_SCRIPT_TOOL_NAME}".`;

function buildUserPrompt(idea: string, targetDuration?: number): string {
  if (!targetDuration) return `Idea del video: ${idea}`;

  // ~2.5 palabras/seg es un ritmo de narracion tipico; sirve como guia, no
  // como limite estricto.
  const approxWords = Math.round(targetDuration * 2.5);
  return `Idea del video: ${idea}\nDuracion objetivo: ${targetDuration} segundos (aproximadamente ${approxWords} palabras narradas).`;
}

// El Prompt Maestro (texto libre generado por generate_script_style) exige
// devolver SOLO texto narrado limpio -- pero el resto del pipeline necesita
// el mismo contrato {title, full_text, scenes} de siempre para poder
// guardar en scripts/scenes. Se agrega esta instruccion de formato aparte,
// sin tocar el contenido/tono que ya define el Prompt Maestro.
function buildStyledFormatInstructions(provider: ScriptProvider): string {
  const base = `"full_text" es el guion narrado completo, cumpliendo TODAS las reglas de arriba (sin timestamps, sin markdown, sin encabezados, sin referencias a la estructura del propio guion).
"scenes" divide "full_text" en unidades narrativas ordenadas (order arranca en 1); cada fragmento de "text" concatenado en orden debe reconstruir "full_text" exactamente.`;

  if (provider === "openai") {
    return `Ademas de todas las reglas anteriores, tenes que devolver tu respuesta EXCLUSIVAMENTE como un objeto JSON, sin texto adicional, con esta forma exacta:
{ "title": string, "full_text": string, "scenes": [ { "order": number, "text": string } ] }
${base}`;
  }

  return `Ademas de todas las reglas anteriores, entrega el resultado exclusivamente a traves de la tool "${RETURN_SCRIPT_TOOL_NAME}".
${base}`;
}

// Si el caller no pasa approx_chars, el modelo no tiene ningun objetivo de
// extension y por default tira guiones mucho mas cortos que los guiones de
// referencia analizados. Se usa el largo promedio de esos guiones (los que
// definieron el estilo, no el reference_script puntual de este request)
// como piso razonable.
function computeDefaultApproxChars(referenceScripts: string[]): number | undefined {
  if (referenceScripts.length === 0) return undefined;
  const total = referenceScripts.reduce((sum, script) => sum + script.length, 0);
  return Math.round(total / referenceScripts.length);
}

function buildStyledUserPrompt(
  input: GenerateScriptInput,
  defaultApproxChars: number | undefined
): string {
  const {
    idea,
    title,
    thumbnail_description,
    approx_chars,
    reference_script,
    key_points,
  } = input;
  const resolvedApproxChars = approx_chars ?? defaultApproxChars;
  return `TÍTULO DEL NUEVO VIDEO: ${title ?? idea}
MINIATURA O DESCRIPCIÓN DE LA MINIATURA: ${thumbnail_description ?? "(no especificada)"}
CANTIDAD APROXIMADA DE CARACTERES DEL GUION: ${resolvedApproxChars ?? "(sin especificar)"}${resolvedApproxChars ? " -- ESTO ES UN PISO, NO UN TECHO: el guion tiene que tener una extension similar a la de los guiones de referencia analizados. No entregues un resumen ni un guion acortado." : ""}
GUION DE REFERENCIA A ADAPTAR: ${reference_script ?? "(ninguno -- usá solo el título/idea como concepto)"}
PUNTO CLAVE A MANTENER: ${key_points ?? "(ninguno)"}`;
}

const returnScriptTool: Anthropic.Tool = {
  name: RETURN_SCRIPT_TOOL_NAME,
  description: "Devuelve el guion generado en formato estructurado.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      full_text: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            order: { type: "integer" },
            text: { type: "string" },
          },
          required: ["order", "text"],
        },
      },
    },
    required: ["title", "full_text", "scenes"],
  },
  strict: true,
};

function parseGeneratedScript(raw: unknown): GeneratedScriptPayload {
  const payload = raw as Partial<GeneratedScriptPayload> | null;
  if (!payload || typeof payload.full_text !== "string" || !payload.full_text.trim()) {
    throw new Error("El guion generado no tiene full_text");
  }
  if (!Array.isArray(payload.scenes) || payload.scenes.length === 0) {
    throw new Error("El guion generado no tiene scenes");
  }

  const scenes = payload.scenes.map((scene, index) => ({
    order: typeof scene?.order === "number" ? scene.order : index + 1,
    text: typeof scene?.text === "string" ? scene.text : "",
  }));

  return {
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title : "Sin titulo",
    full_text: payload.full_text,
    scenes,
  };
}

async function generateWithAnthropic(
  systemPrompt: string,
  userPrompt: string
): Promise<GeneratedScriptPayload> {
  const provider = await getActiveProvider("anthropic");
  if (!provider || !provider.api_key) {
    throw new ProviderNotConfiguredError("generate_script:anthropic");
  }
  const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_ANTHROPIC_MODEL;

  const client = new Anthropic({ apiKey: provider.api_key });
  const stream = client.messages.stream({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    tools: [returnScriptTool],
    tool_choice: { type: "tool", name: RETURN_SCRIPT_TOOL_NAME },
    messages: [{ role: "user", content: userPrompt }],
  });

  const response = await stream.finalMessage();
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("Claude no devolvio el guion generado");
  }

  return parseGeneratedScript(toolUse.input);
}

async function generateWithOpenAI(
  systemPrompt: string,
  userPrompt: string
): Promise<GeneratedScriptPayload> {
  const provider = await getActiveProvider("openai");
  if (!provider || !provider.api_key) {
    throw new ProviderNotConfiguredError("generate_script:openai");
  }
  const model = (provider.configuration?.model as string | undefined) ?? DEFAULT_OPENAI_MODEL;

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
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string | null } }[];
  };

  const raw = data.choices[0]?.message.content;
  if (!raw) {
    throw new Error("OpenAI no devolvio contenido para el guion");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OpenAI devolvio un JSON invalido para el guion generado");
  }

  return parseGeneratedScript(parsed);
}

export const generateScriptTool: ToolDefinition<
  GenerateScriptInput,
  GenerateScriptOutput
> = {
  name: "generate_script",
  description:
    "Genera el contenido de un Script a partir de una idea, via un Provider de LLM.",
  parameters: {
    type: "object",
    properties: {
      video_project_id: { type: "string", description: "UUID del proyecto" },
      idea: { type: "string", description: "Idea o brief del video" },
      target_duration: { type: "number", description: "Duracion objetivo en segundos" },
      provider: {
        type: "string",
        enum: ["openai", "anthropic"],
        description: "Proveedor de LLM a usar (default: anthropic)",
      },
      script_style_id: {
        type: "string",
        description: "UUID de un script_style (Prompt Maestro de canal) a usar en vez del prompt generico",
      },
      title: { type: "string", description: "Titulo del nuevo video (solo aplica con script_style_id)" },
      thumbnail_description: { type: "string", description: "Descripcion de la miniatura (solo aplica con script_style_id)" },
      approx_chars: { type: "number", description: "Cantidad aproximada de caracteres del guion (solo aplica con script_style_id)" },
      reference_script: { type: "string", description: "Guion de referencia a adaptar (solo aplica con script_style_id)" },
      key_points: { type: "string", description: "Puntos clave a mantener (solo aplica con script_style_id)" },
    },
    required: ["video_project_id", "idea"],
  },
  async execute(input, ctx) {
    const { video_project_id, idea, target_duration, script_style_id } = input;
    const provider = input.provider ?? DEFAULT_PROVIDER;

    const project = await getOwnedProject(video_project_id, ctx.userId);
    if (!project) {
      throw new Error("Project not found");
    }

    let systemPrompt = `${BASE_RULES}\n\n${provider === "openai" ? OPENAI_FORMAT_INSTRUCTIONS : ANTHROPIC_FORMAT_INSTRUCTIONS}`;
    let userPrompt = buildUserPrompt(idea, target_duration);

    if (script_style_id) {
      const style = await getOwnedScriptStyle(script_style_id, ctx.userId);
      if (!style) {
        throw new Error("Script style not found");
      }
      if (style.status !== "READY" || !style.master_prompt) {
        throw new Error(
          `El script style "${style.name}" todavia no tiene un Prompt Maestro listo (status: ${style.status})`
        );
      }
      systemPrompt = `${style.master_prompt}\n\n---\n\n${buildStyledFormatInstructions(provider)}`;
      const defaultApproxChars = computeDefaultApproxChars(
        (style.reference_scripts as string[] | null) ?? []
      );
      userPrompt = buildStyledUserPrompt(input, defaultApproxChars);
    }

    const generated =
      provider === "openai"
        ? await generateWithOpenAI(systemPrompt, userPrompt)
        : await generateWithAnthropic(systemPrompt, userPrompt);

    const content: Record<string, unknown> = {
      title: generated.title,
      text: generated.full_text,
      idea,
      ...(target_duration ? { target_duration } : {}),
    };

    const { data: existingScript, error: existingError } = await supabase
      .from("scripts")
      .select("id")
      .eq("video_project_id", video_project_id)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    let scriptId: string;
    if (existingScript) {
      scriptId = existingScript.id;

      const { error: updateError } = await supabase
        .from("scripts")
        .update({ content })
        .eq("id", scriptId);
      if (updateError) throw new Error(updateError.message);

      // Regenerar el guion reemplaza las escenas anteriores: son un
      // desglose derivado de full_text, no ediciones manuales a preservar.
      const { error: deleteError } = await supabase
        .from("scenes")
        .delete()
        .eq("script_id", scriptId);
      if (deleteError) throw new Error(deleteError.message);
    } else {
      const { data: insertedScript, error: insertError } = await supabase
        .from("scripts")
        .insert({ video_project_id, content })
        .select("id")
        .single();
      if (insertError || !insertedScript) {
        throw new Error(insertError?.message ?? "Failed to create script");
      }
      scriptId = insertedScript.id;
    }

    const { data: insertedScenes, error: scenesError } = await supabase
      .from("scenes")
      .insert(
        generated.scenes.map((scene) => ({
          script_id: scriptId,
          order: scene.order,
          content: { text: scene.text },
        }))
      )
      .select("order, content");

    if (scenesError) {
      throw new Error(scenesError.message);
    }

    return {
      content,
      scenes: (insertedScenes ?? [])
        .map((scene) => ({
          order: scene.order as number,
          text: ((scene.content as { text?: string } | null)?.text) ?? "",
        }))
        .sort((a, b) => a.order - b.order),
    };
  },
};
