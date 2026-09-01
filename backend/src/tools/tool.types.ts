export interface ToolContext {
  userId: string;
  jobId?: string;
}

export interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  // JSON Schema de TInput. Lo necesita cualquier LLM con function-calling
  // (ver src/agents/) para saber que argumentos pasarle a la tool.
  parameters: Record<string, unknown>;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

export type AnyToolDefinition = ToolDefinition<any, any>;
