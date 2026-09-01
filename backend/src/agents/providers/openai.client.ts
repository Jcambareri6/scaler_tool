import type { AgentMessage } from "../agent.types.js";
import type { LLMClient, LLMDecision, LLMToolSpec } from "../llmClient.types.js";
import type { Provider } from "../../types/shared/typeShared.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini"; // modelo "mini" por default, en linea con el control de gasto del LEEME

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

// agent.service.ts codifica un tool_call como un mensaje "assistant" cuyo
// content es JSON.stringify({tool_call, input}); acá lo reconstruimos al
// formato real de OpenAI (tool_calls[] + tool_call_id). Los ids son
// sinteticos, solo necesitan ser consistentes dentro de un mismo request.
function toOpenAIMessages(messages: AgentMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];
  let lastToolCallId: string | null = null;
  let callIndex = 0;

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
      continue;
    }

    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }

    if (msg.role === "tool") {
      result.push({
        role: "tool",
        content: msg.content,
        tool_call_id: lastToolCallId ?? `call_${callIndex}`,
      });
      continue;
    }

    // role === "assistant"
    let parsed: { tool_call?: string; input?: unknown } | null = null;
    try {
      parsed = JSON.parse(msg.content);
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed.tool_call === "string") {
      const id = `call_${callIndex++}`;
      lastToolCallId = id;
      result.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id,
            type: "function",
            function: { name: parsed.tool_call, arguments: JSON.stringify(parsed.input ?? {}) },
          },
        ],
      });
    } else {
      result.push({ role: "assistant", content: msg.content });
    }
  }

  return result;
}

function toOpenAITools(tools: LLMToolSpec[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export class OpenAIClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(provider: Provider) {
    if (!provider.api_key) {
      throw new Error(`Provider "${provider.slug}" has no api_key configured`);
    }
    this.apiKey = provider.api_key;
    this.model = (provider.configuration?.model as string | undefined) ?? DEFAULT_MODEL;
  }

  async decide(messages: AgentMessage[], tools: LLMToolSpec[]): Promise<LLMDecision> {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAIMessages(messages),
        tools: toOpenAITools(tools),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      choices: { message: OpenAIMessage }[];
    };

    const message = data.choices[0]?.message;
    if (!message) {
      throw new Error("OpenAI API returned no choices");
    }

    const toolCall = message.tool_calls?.[0];
    if (toolCall) {
      return {
        type: "tool_call",
        tool_name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments || "{}"),
      };
    }

    return { type: "message", content: message.content ?? "" };
  }
}
