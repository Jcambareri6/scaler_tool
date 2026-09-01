import type { AgentMessage } from "./agent.types.js";

export interface LLMToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type LLMDecision =
  | { type: "message"; content: string }
  | { type: "tool_call"; tool_name: string; input: unknown };

// Abstraccion que cualquier proveedor de LLM (OpenAI, Anthropic, etc.)
// implementa. El loop del Agent (agent.service.ts) no conoce el proveedor
// concreto, solo esta interfaz — igual que las Tools no conocen el detalle
// de su Provider.
export interface LLMClient {
  decide(messages: AgentMessage[], tools: LLMToolSpec[]): Promise<LLMDecision>;
}
