import { api } from "@/lib/api";
import type { ChatMessage } from "@/types";

// Sin persistencia todavia (Etapa 11 — Chat, no implementada): el
// historial vive solo en memoria de esta pestana del navegador y se pierde
// al recargar. Conecta con /agents/run (Etapa 10), que si habla con un LLM
// real y ejecuta Tools — solo falta que exista un Provider "openai" activo
// (ver /providers).
const conversations: Record<string, ChatMessage[]> = {};

interface AgentRunResponse {
  reply: string;
  toolCalls: { tool_name: string; input: unknown; output?: unknown; error?: string }[];
}

export const chatService = {
  async getMessages(projectId: string): Promise<ChatMessage[]> {
    return conversations[projectId] ?? [];
  },

  async sendMessage(
    projectId: string,
    content: string
  ): Promise<{ userMessage: ChatMessage; agentMessage: ChatMessage }> {
    const history = conversations[projectId] ?? [];

    const userMessage: ChatMessage = {
      id: `m${Date.now()}`,
      projectId,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    const agentHistory = [...history, userMessage].map((m) => ({
      role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

    const result = await api.post<AgentRunResponse>("/agents/run", {
      provider_slug: "openai",
      messages: agentHistory,
      project_id: projectId,
    });

    const agentMessage: ChatMessage = {
      id: `m${Date.now() + 1}`,
      projectId,
      role: "agent",
      content: result.reply,
      timestamp: new Date().toISOString(),
    };

    conversations[projectId] = [...history, userMessage, agentMessage];

    return { userMessage, agentMessage };
  },
};
