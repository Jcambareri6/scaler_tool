import { supabase } from "../lib/supabase.js";
import type { AnyToolDefinition, ToolContext } from "./tool.types.js";

const tools = new Map<string, AnyToolDefinition>();

export function registerTool(tool: AnyToolDefinition): void {
  if (tools.has(tool.name)) {
    throw new Error(`Tool "${tool.name}" is already registered`);
  }
  tools.set(tool.name, tool);
}

export function getTool(name: string): AnyToolDefinition | undefined {
  return tools.get(name);
}

export function listTools(): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}[] {
  return Array.from(tools.values()).map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

// Cada invocacion queda trazada en tool_executions (job_id/provider_id
// nullable a proposito: todavia no hay Agent que dispare tools dentro de un
// Job real, ni Providers que resolver — ver Etapa 9/10 del roadmap).
export async function runTool<TInput, TOutput>(
  name: string,
  input: TInput,
  ctx: ToolContext
): Promise<TOutput> {
  const tool = tools.get(name);
  if (!tool) {
    throw new Error(`Tool "${name}" is not registered`);
  }

  const { data: execution, error: insertError } = await supabase
    .from("tool_executions")
    .insert({
      job_id: ctx.jobId ?? null,
      provider_id: null,
      tool_name: name,
      status: "RUNNING",
      input: (input ?? {}) as Record<string, unknown>,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError || !execution) {
    throw new Error(`Failed to record tool execution: ${insertError?.message}`);
  }

  try {
    const output = await tool.execute(input, ctx);

    await supabase
      .from("tool_executions")
      .update({
        status: "SUCCEEDED",
        output: output as Record<string, unknown>,
        finished_at: new Date().toISOString(),
      })
      .eq("id", execution.id);

    return output as TOutput;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";

    await supabase
      .from("tool_executions")
      .update({
        status: "FAILED",
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", execution.id);

    throw error;
  }
}
