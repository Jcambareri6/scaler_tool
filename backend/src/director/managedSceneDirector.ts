import Anthropic from "@anthropic-ai/sdk";
import { getActiveProvider } from "../lib/providers.js";
import { normalize } from "../tools/generateOverlay.tool.js";
import { plannableTypes } from "../tools/planOverlays.tool.js";
import { asList, clock } from "./director.js";
import { MANAGED_AGENTS } from "./managedAgents.config.js";
import type { Phrase } from "./phrases.js";
import {
  assemblePlan,
  designerSystem,
  designerTool,
  directAnimatedScenes,
  directorSystem,
  directorTool,
  readStructure,
  sceneGroups,
  verifyScene,
  type AnimatedPlan,
  type PlannedScene,
  type SceneStructure,
} from "./sceneDirector.js";

// Director de escenas en Managed Agents (Claude Platform): el mismo
// hub-and-spoke de sceneDirector.ts, con Anthropic corriendo a los agentes.
// - DIRECTOR (coordinador): arma la estructura y reparte un tramo por capitulo.
// - DISENADORES (roster, en paralelo): disenan las escenas de su tramo.
// - VERIFICADOR: sigue siendo nuestro codigo, expuesto como herramientas. Lo
//   rechazado vuelve al disenador con el motivo, hasta MAX_DESIGN_ATTEMPTS.
// Los agentes se crean una sola vez (scripts/setup-managed-agents.ts); aca
// solo se abre una sesion por video. Si la sesion falla, sigue el esquema
// paso a paso: este modulo nunca tira el video.

export const DIRECTOR_AGENT_NAME = "Director de escenas";
export const DESIGNER_AGENT_NAME = "Disenador de escenas";
export const DIRECTOR_MODEL = "claude-sonnet-5";
export const DESIGNER_MODEL = "claude-haiku-5-5";

const MAX_DESIGN_ATTEMPTS = 3;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
// Tope de gasto por video: un dolar fijo mas 30 centavos por minuto (dos
// minutos de video gastaron 14 centavos).
const sessionBudgetCents = (seconds: number) => String(100 + Math.ceil((seconds / 60) * 30));

type CustomTool = Anthropic.Beta.Agents.BetaManagedAgentsCustomToolParams;

function customTool(tool: Anthropic.Tool, name: string, description: string): CustomTool {
  return { type: "custom", name, description, input_schema: tool.input_schema as CustomTool["input_schema"] };
}

// ---------- Configuracion de los agentes ----------

export function directorAgentConfig() {
  return {
    name: DIRECTOR_AGENT_NAME,
    description: "Decide capitulos y escenas de un video todo animado y reparte el diseno.",
    model: DIRECTOR_MODEL,
    system: `${directorSystem()}

TU PROCESO:
1. Llama a submit_structure con los capitulos y las escenas. Si responde con un error, corregi y volve a llamarla.
2. La respuesta lista los tramos numerados. Manda a "${DESIGNER_AGENT_NAME}" un pedido por tramo, todos a la vez, con este texto y nada mas: "Disena el tramo N". El disenador busca solo su material.
3. Espera todos los reportes. Si un tramo quedo sin entregar, pedilo de nuevo una sola vez.
4. Con todos los reportes, termina con una linea. No disenes vos ni repitas el trabajo de un disenador.`,
    tools: [customTool(directorTool(), "submit_structure", "Entrega los capitulos y las escenas del video.")],
  };
}

export function designerAgentConfig() {
  const types = plannableTypes();
  return {
    name: DESIGNER_AGENT_NAME,
    description: 'Disena las escenas de un tramo del video. Pedile "Disena el tramo N"; busca solo su material y reporta cuando termina.',
    model: DESIGNER_MODEL,
    system: `${designerSystem(types)}

TU PROCESO:
1. Te piden un tramo: llama a get_brief con ese numero y recibis sus escenas y frases.
2. Disena todas las escenas y entregalas con submit_scenes.
3. Si responde con RECHAZOS, corregi esas escenas segun cada motivo y volve a entregarlas con submit_scenes. Si un dato no esta en el guion, cambialo por uno que si este: no lo reemplaces por una frase vacia.
4. Cuando responda LISTO, reporta en una linea que terminaste. No hagas nada mas.`,
    tools: [
      customTool(
        {
          name: "get_brief",
          input_schema: { type: "object", properties: { tramo: { type: "number" } }, required: ["tramo"] },
        },
        "get_brief",
        "Devuelve las escenas y frases de un tramo."
      ),
      customTool(designerTool(types), "submit_scenes", "Entrega escenas disenadas para que las revise el verificador. Lleva tambien el numero de tramo."),
    ].map((tool) =>
      tool.name === "submit_scenes"
        ? { ...tool, input_schema: { ...tool.input_schema, properties: { ...tool.input_schema.properties, tramo: { type: "number" } }, required: ["tramo", "scenes"] } }
        : tool
    ),
  };
}

// ---------- Herramientas (el verificador) ----------

class SceneTools {
  structure: SceneStructure | null = null;
  readonly designed = new Map<number, Record<string, unknown>>();
  private groups: ReturnType<typeof sceneGroups> = [];
  private readonly attempts = new Map<number, number>();
  // Descartes de la mejor version de cada escena.
  private readonly best = new Map<number, number>();
  private readonly fullText: string;
  private readonly fullNorm: string;
  private readonly types = plannableTypes();

  constructor(private readonly phrases: Phrase[]) {
    this.fullText = phrases.map((p) => p.text).join(" ");
    this.fullNorm = normalize(this.fullText);
  }

  async run(name: string, input: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
    if (name === "submit_structure") return this.submitStructure(input);
    if (name === "get_brief") return this.getBrief(input);
    if (name === "submit_scenes") return this.submitScenes(input);
    return { text: `Herramienta desconocida: ${name}`, isError: true };
  }

  private submitStructure(input: Record<string, unknown>) {
    const structure = readStructure(input, this.phrases);
    const titles = asList(input.chapters, "chapters").map((c) => (c as { title?: unknown }).title);
    const kept = new Set(structure.chapters.map((c) => c.title));
    const bad = titles.filter((t) => typeof t !== "string" || !kept.has(t.trim()));
    if (bad.length > 0) {
      return { text: `Estos titulos no estan copiados del guion: ${bad.join(" | ")}. Copialos literal y volve a entregar.`, isError: true };
    }
    this.structure = structure;
    this.groups = sceneGroups(structure, this.phrases);
    return { text: `Estructura aceptada. Tramos:\n${this.groups.map((g, i) => `Tramo ${i + 1}: ${g.title} (${g.scenes.length} escenas)`).join("\n")}` };
  }

  private getBrief(input: Record<string, unknown>) {
    const group = this.groups[Number(input.tramo) - 1];
    if (!group) return { text: `No existe el tramo ${String(input.tramo)}.`, isError: true };
    return { text: group.brief };
  }

  private async submitScenes(input: Record<string, unknown>) {
    const tramo = Number(input.tramo);
    const group = this.groups[tramo - 1];
    if (!group) return { text: `No existe el tramo ${String(input.tramo)}.`, isError: true };
    const attempt = (this.attempts.get(tramo) ?? 0) + 1;
    this.attempts.set(tramo, attempt);

    const byIndex = new Map(group.scenes.map((s) => [s.index, s] as [number, PlannedScene]));
    const seen = new Set<number>();
    const rejected: string[] = [];
    for (const raw of asList(input.scenes, "scenes").map((s) => s as Record<string, unknown>)) {
      const planned = byIndex.get(raw.scene_index as number);
      if (!planned) continue;
      seen.add(planned.index);
      const { elements, dropped } = await verifyScene(raw, planned, this.phrases, this.fullNorm, this.fullText, this.types);
      const problems = elements[0]?.id === "fallback" ? [...dropped, "la escena quedo vacia: necesita elementos validos"] : dropped;
      // Se guarda la mejor version: un reintento peor no pisa a la anterior.
      if (problems.length <= (this.best.get(planned.index) ?? Infinity)) {
        this.best.set(planned.index, problems.length);
        this.designed.set(planned.index, raw);
      }
      if (problems.length > 0) rejected.push(`ESCENA ${planned.index}: ${problems.join("; ")}`);
    }
    for (const scene of group.scenes) {
      if (!seen.has(scene.index) && !this.designed.has(scene.index)) rejected.push(`ESCENA ${scene.index}: falta entregarla`);
    }

    if (rejected.length === 0) return { text: "LISTO: todas las escenas pasaron." };
    if (attempt >= MAX_DESIGN_ATTEMPTS) return { text: "LISTO: sin mas intentos, queda la mejor version de cada escena." };
    return { text: `RECHAZOS (intento ${attempt} de ${MAX_DESIGN_ATTEMPTS}):\n${rejected.join("\n")}` };
  }
}

// ---------- Sesion ----------

async function runSession(client: Anthropic, sessionId: string, firstMessage: string, tools: SceneTools): Promise<void> {
  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text: firstMessage }] }],
  });
  const answered = new Set<string>();
  const deadline = setTimeout(() => stream.controller.abort(), SESSION_TIMEOUT_MS);
  try {
    for await (const event of stream) {
      if (event.type === "agent.custom_tool_use") {
        if (answered.has(event.id)) continue;
        answered.add(event.id);
        const result = await tools.run(event.name, event.input as Record<string, unknown>).catch((err: Error) => ({ text: err.message, isError: true }));
        await client.beta.sessions.events.send(sessionId, {
          events: [
            {
              type: "user.custom_tool_result",
              custom_tool_use_id: event.id,
              content: [{ type: "text", text: result.text }],
              ...("isError" in result && result.isError ? { is_error: true } : {}),
            },
          ],
        });
      } else if (event.type === "session.status_idle") {
        const reason = event.stop_reason.type;
        if (reason === "end_turn") return;
        if (reason !== "requires_action") throw new Error(`sesion frenada: ${reason}`);
      } else if (event.type === "session.status_terminated") {
        throw new Error("sesion terminada");
      } else if (event.type === "session.error") {
        console.warn("[managed_director] error de sesion:", JSON.stringify(event.error));
      }
    }
    throw new Error("la conexion con la sesion se corto");
  } finally {
    clearTimeout(deadline);
  }
}

export async function directAnimatedScenesManaged(input: {
  phrases: Phrase[];
  videoTopic?: string;
  nav: { channel: string | null; topic: string | null; locale: string | null };
}): Promise<AnimatedPlan | null> {
  const { phrases } = input;
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key || phrases.length === 0) return null;
  const client = new Anthropic({ apiKey: provider.api_key });

  const session = await client.beta.sessions.create({
    agent: MANAGED_AGENTS.directorAgentId,
    environment_id: MANAGED_AGENTS.environmentId,
    title: input.videoTopic ?? "Video todo animado",
    budget: { type: "limit", max_list_cost: { amount: sessionBudgetCents(phrases[phrases.length - 1]!.end), currency: "USD" } },
  });
  console.log(`[managed_director] sesion ${session.id}`);

  const tools = new SceneTools(phrases);
  const script = phrases.map((p) => `[${p.id} · ${clock(p.start)}] ${p.text}`).join("\n");
  await runSession(
    client,
    session.id,
    `${input.videoTopic ? `Tema del video: ${input.videoTopic}\n` : ""}Duracion: ${clock(phrases[phrases.length - 1]!.end)}\n\nGUION EN FRASES:\n${script}`,
    tools
  );
  if (!tools.structure) throw new Error("el director no entrego la estructura");

  const { usage } = await client.beta.sessions.retrieve(session.id);
  return assemblePlan({
    phrases,
    structure: tools.structure,
    designed: tools.designed,
    types: plannableTypes(),
    nav: input.nav,
    models: { director: DIRECTOR_MODEL, designer: DESIGNER_MODEL },
    usage: {},
    managed: { session_id: session.id, usage },
  });
}

// Punto de entrada del formato animado: Managed Agents si esta configurado,
// y si no (o si falla) el esquema paso a paso.
export async function directScenes(input: {
  phrases: Phrase[];
  videoTopic?: string;
  nav: { channel: string | null; topic: string | null; locale: string | null };
}): Promise<AnimatedPlan | null> {
  if (MANAGED_AGENTS.directorAgentId && MANAGED_AGENTS.environmentId) {
    try {
      const plan = await directAnimatedScenesManaged(input);
      if (plan) return plan;
    } catch (err) {
      console.warn("[managed_director] fallo, sigo paso a paso:", (err as Error).message);
    }
  }
  return directAnimatedScenes(input);
}
