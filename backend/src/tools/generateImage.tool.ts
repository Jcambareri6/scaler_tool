import type { ToolDefinition } from "./tool.types.js";
import { ProviderNotConfiguredError } from "./tool.errors.js";

export interface GenerateImageInput {
  prompt: string;
  scene_id?: string;
}

export interface GenerateImageOutput {
  storage_key: string;
}

export const generateImageTool: ToolDefinition<
  GenerateImageInput,
  GenerateImageOutput
> = {
  name: "generate_image",
  description:
    "Genera una imagen a partir de un prompt cuando no hay stock adecuado, y la sube a Storage.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Prompt de generacion de imagen" },
      scene_id: { type: "string", description: "UUID de la escena (opcional)" },
    },
    required: ["prompt"],
  },
  async execute() {
    throw new ProviderNotConfiguredError("generate_image");
  },
};
