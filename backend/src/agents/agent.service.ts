import { runTool, listTools } from "../tools/index.js";
import { resolveLLMClient } from "./llmClient.js";
import { errorMessage } from "../lib/errors.js";
import type {
  AgentContext,
  AgentMessage,
  AgentRunResult,
  AgentToolCall,
} from "./agent.types.js";

const MAX_TOOL_ITERATIONS = 5;

// El Agent no contiene logica de negocio (Etapa 10): solo le pasa el
// historial + las Tools disponibles al LLM, ejecuta lo que el LLM pida via
// el toolRegistry, y le devuelve el resultado hasta que el LLM da una
// respuesta final. Toda la logica real vive en las Tools.
export async function runAgent(
  llmProviderSlug: string,
  messages: AgentMessage[],
  ctx: AgentContext
): Promise<AgentRunResult> {
  const llm = await resolveLLMClient(llmProviderSlug);
  const tools = listTools();
  const toolCalls: AgentToolCall[] = [];

  // Sin este mensaje el LLM no tiene forma de saber el video_project_id
  // real: tools como generate_script/render_video lo piden como argumento,
  // y si el modelo lo inventa, getOwnedProject siempre falla ("Project not
  // found").
  let conversation = ctx.projectId
    ? [
        {
          role: "system" as const,
          content: `video_project_id del proyecto actual: ${ctx.projectId}. Usalo como valor de video_project_id al llamar tools que lo requieran.`,
        },
        ...messages,
      ]
    : [...messages];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const decision = await llm.decide(conversation, tools);

    if (decision.type === "message") {
      return { reply: decision.content, toolCalls };
    }

    const call: AgentToolCall = {
      tool_name: decision.tool_name,
      input: decision.input,
    };

    try {
      call.output = await runTool(decision.tool_name, decision.input, {
        userId: ctx.userId,
      });
    } catch (error) {
      call.error = errorMessage(error, "Tool execution failed");
    }

    toolCalls.push(call);

    conversation = [
      ...conversation,
      {
        role: "assistant",
        content: JSON.stringify({ tool_call: decision.tool_name, input: decision.input }),
      },
      {
        role: "tool",
        content: JSON.stringify(call.error ? { error: call.error } : call.output),
      },
    ];
  }

  throw new Error("Agent exceeded max tool-call iterations without a final response");
}
