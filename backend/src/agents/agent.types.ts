export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AgentContext {
  userId: string;
  projectId?: string;
}

export interface AgentToolCall {
  tool_name: string;
  input: unknown;
  output?: unknown;
  error?: string;
}

export interface AgentRunResult {
  reply: string;
  toolCalls: AgentToolCall[];
}
