import type { ToolDefinition } from "./tool.types.js";
import type { OverlaySpec, OverlayType } from "../types/shared/typeShared.js";

export interface GenerateOverlayInput {
  scene_id: string;
  script_text: string;
  overlay: OverlaySpec;
}

export interface GenerateOverlayOutput {
  overlay: OverlaySpec;
}

const VALID_TYPES: OverlayType[] = [
  "title_card",
  "rank_reveal",
  "big_number",
  "lower_third",
  "badge",
  "data_viz_single",
  "cta",
  "ninguno",
];

// Gap #4 del LEEME (modo estricto): el overlay NUNCA inventa texto. Es la
// unica Tool que no necesita Provider — valida contra el guion real, que ya
// existe en la DB. La logica vive aca en vez de en OpenAI porque es una
// regla de negocio no negociable, no una decision creativa.
export const generateOverlayTool: ToolDefinition<
  GenerateOverlayInput,
  GenerateOverlayOutput
> = {
  name: "generate_overlay",
  description:
    "Valida un OverlaySpec en modo estricto: el texto tiene que existir literalmente en el guion.",
  parameters: {
    type: "object",
    properties: {
      scene_id: { type: "string", description: "UUID de la escena" },
      script_text: { type: "string", description: "Texto del guion contra el que se valida" },
      overlay: {
        type: "object",
        properties: {
          type: { type: "string", enum: VALID_TYPES },
          text: { type: "string" },
          source: { type: "string", enum: ["script"] },
        },
        required: ["type", "text", "source"],
      },
    },
    required: ["scene_id", "script_text", "overlay"],
  },
  async execute({ script_text, overlay }) {
    if (!VALID_TYPES.includes(overlay.type)) {
      throw new Error(`Invalid overlay type: ${overlay.type}`);
    }

    if (overlay.type === "ninguno") {
      return { overlay: { ...overlay, text: "" } };
    }

    if (overlay.source !== "script") {
      throw new Error(
        'overlay.source must be "script" — modo estricto no permite textos inventados'
      );
    }

    const text = overlay.text?.trim();
    if (!text) {
      throw new Error('overlay.text is required when type is not "ninguno"');
    }

    const normalizedScript = script_text.toLowerCase();
    const normalizedText = text.toLowerCase();

    if (!normalizedScript.includes(normalizedText)) {
      throw new Error(
        `overlay.text ("${text}") no aparece literalmente en el guion — modo estricto lo prohibe`
      );
    }

    return { overlay: { ...overlay, text } };
  },
};
