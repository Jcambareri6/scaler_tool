import { getActiveProvider } from "../lib/providers.js";
import { ProviderNotConfiguredError } from "../tools/tool.errors.js";
import { OpenAIClient } from "./providers/openai.client.js";
import type { LLMClient } from "./llmClient.types.js";

// El Agent resuelve su LLM por slug de Provider (Etapa 9), igual que las
// Tools. Agregar un proveedor nuevo = un client mas en este switch, el loop
// de agent.service.ts no se entera.
export async function resolveLLMClient(slug: string): Promise<LLMClient> {
  const provider = await getActiveProvider(slug);
  if (!provider) {
    throw new ProviderNotConfiguredError(`agent:${slug}`);
  }

  switch (slug) {
    case "openai":
      return new OpenAIClient(provider);
    default:
      throw new Error(`LLM client for provider "${slug}" is not implemented yet`);
  }
}
