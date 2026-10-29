import type { ToolDefinition } from "./tool.types.js";
import type { OverlaySpec, OverlayType } from "../types/shared/typeShared.js";

export interface GenerateOverlayInput {
  scene_id: string;
  script_text: string;
  overlay: OverlaySpec;
  // Guion completo (opcional): el `label` puede salir de cualquier parte
  // del guion, no solo de la escena (ej. el titulo de un capitulo).
  full_text?: string;
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
  "versus",
  "timeline",
  "location",
  "ninguno",
];

// Tipos que se arman con varios valores (items) en vez de un solo texto.
const MULTI_ITEM_TYPES: OverlayType[] = ["data_viz_single", "versus", "timeline"];

// "1. 600" == "1.600": las escenas armadas antes del arreglo de
// build_scenes (que cortaba en el punto de miles) quedaron con ese espacio,
// y se conservan tal cual al regenerar con imagenes cargadas.
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/(\d[.,]) (?=\d)/g, "$1").trim();
}

function appearsIn(haystack: string, needle: string | undefined): boolean {
  const n = needle ? normalize(needle) : "";
  return n.length > 0 && haystack.includes(n);
}

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
      full_text: { type: "string", description: "Guion completo, para validar el label (opcional)" },
      overlay: {
        type: "object",
        properties: {
          type: { type: "string", enum: VALID_TYPES },
          text: { type: "string" },
          source: { type: "string", enum: ["script"] },
          label: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, text: { type: "string" } },
              required: ["label", "text"],
            },
          },
          anchor: { type: "number" },
          duration: { type: "number" },
        },
        required: ["type", "text", "source"],
      },
    },
    required: ["scene_id", "script_text", "overlay"],
  },
  async execute({ script_text, overlay, full_text }) {
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

    const normalizedScript = normalize(script_text);
    const normalizedFull = full_text ? normalize(full_text) : normalizedScript;

    if (!appearsIn(normalizedScript, text)) {
      throw new Error(
        `overlay.text ("${text}") no aparece literalmente en el guion — modo estricto lo prohibe`
      );
    }

    // Label e items tambien tienen que salir del guion; los que no, se
    // descartan (el overlay sigue siendo valido sin ellos) en vez de
    // tirar el overlay entero.
    const label = appearsIn(normalizedFull, overlay.label) ? overlay.label!.trim() : undefined;
    const items = MULTI_ITEM_TYPES.includes(overlay.type)
      ? (overlay.items ?? [])
          .filter((item) => appearsIn(normalizedScript, item.text) && appearsIn(normalizedFull, item.label))
          .map((item) => ({ label: item.label.trim(), text: item.text.trim() }))
      : undefined;

    return {
      overlay: {
        type: overlay.type,
        text,
        source: "script",
        ...(label ? { label } : {}),
        ...(items?.length ? { items } : {}),
        ...(typeof overlay.anchor === "number" ? { anchor: Math.min(1, Math.max(0, overlay.anchor)) } : {}),
        ...(typeof overlay.duration === "number" && overlay.duration > 0 ? { duration: Math.min(12, overlay.duration) } : {}),
      },
    };
  },
};
