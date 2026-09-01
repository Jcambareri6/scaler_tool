import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";

export interface GenerateVideoInput {
  prompt: string;
  scene_id?: string;
  duration_seconds?: number;
}

export interface GenerateVideoOutput {
  storage_key: string;
}

// Alternativa a search_stock cuando no hay clip de stock que sirva: generar
// el clip directamente en vez de buscarlo.
export const generateVideoTool: ToolDefinition<
  GenerateVideoInput,
  GenerateVideoOutput
> = {
  name: "generate_video",
  description:
    "Genera un clip de video a partir de un prompt cuando no hay stock adecuado, y lo sube a Storage.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Prompt de generacion de video" },
      scene_id: { type: "string", description: "UUID de la escena (opcional)" },
      duration_seconds: { type: "number", description: "Duracion objetivo del clip" },
    },
    required: ["prompt"],
  },
  async execute() {
    throw new ProviderNotConfiguredError("generate_video");
  },
};
