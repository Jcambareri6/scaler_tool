import type { ToolDefinition } from "./tool.types.js";
import type { OverlaySpec, OverlayType } from "../types/shared/typeShared.js";
import { supportedOverlayIcons } from "../lib/motion.js";

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
  "kinetic_quote",
  "list",
  "profile_card",
  "myth_fact",
  "scale_compare",
  "line_chart",
  "pivot_question",
  "card_grid",
  "scoreboard",
  "strike_word",
  "phrase_swap",
  "chapter_index",
  "number_phrase",
  "person_card",
  "milestone",
  "subscribe_cta",
  "map_globe",
  "map_marker",
  "layers_diagram",
  "cycle_diagram",
  "ninguno",
];

// Tipos que se arman con varios valores (items) en vez de un solo texto.
const MULTI_ITEM_TYPES: OverlayType[] = [
  "data_viz_single",
  "versus",
  "timeline",
  "list",
  "profile_card",
  "line_chart",
  "card_grid",
  "scoreboard",
  "chapter_index",
  "layers_diagram",
  "cycle_diagram",
];
// En una lista cada entrada es solo su texto: el label es opcional.
const OPTIONAL_ITEM_LABEL_TYPES: OverlayType[] = ["list", "card_grid", "chapter_index", "layers_diagram", "cycle_diagram"];
// Graficos que dibujan el valor de cada item: sin cifra no hay que dibujar.
const NUMERIC_ITEM_TYPES: OverlayType[] = ["line_chart"];

// "1. 600" == "1.600": las escenas armadas antes del arreglo de
// build_scenes (que cortaba en el punto de miles) quedaron con ese espacio,
// y se conservan tal cual al regenerar con imagenes cargadas.
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/(\d[.,]) (?=\d)/g, "$1").trim();
}

function isLatLon(value: unknown): value is { lat: number; lon: number } {
  const v = value as { lat?: unknown; lon?: unknown } | null | undefined;
  return (
    !!v &&
    typeof v.lat === "number" &&
    typeof v.lon === "number" &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lon) &&
    Math.abs(v.lat) <= 90 &&
    Math.abs(v.lon) <= 180
  );
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
          icon: { type: "string" },
          geo: { type: "object" },
          ref: { type: "object" },
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
          .filter(
            (item) =>
              appearsIn(normalizedScript, item.text) &&
              (!NUMERIC_ITEM_TYPES.includes(overlay.type) || /d/.test(item.text)) &&
              (appearsIn(normalizedFull, item.label) ||
                (OPTIONAL_ITEM_LABEL_TYPES.includes(overlay.type) && !item.label?.trim()))
          )
          .map((item) => ({ label: (item.label ?? "").trim(), text: item.text.trim() }))
      : undefined;
    // Mito vs realidad sin la realidad seria solo afirmar el mito.
    if (overlay.type === "myth_fact" && !label) {
      throw new Error("myth_fact sin label (la realidad) literal del guion — se descarta");
    }
    // Mapas: la coordenada no es texto del guion (no se muestra), solo tiene
    // que ser valida. El nombre del lugar de referencia si se ve: literal.
    const isMap = overlay.type === "map_globe" || overlay.type === "map_marker";
    const geo = isMap && isLatLon(overlay.geo) ? { lat: overlay.geo.lat, lon: overlay.geo.lon } : undefined;
    if (isMap && !geo) {
      throw new Error(`${overlay.type} sin coordenada valida — se descarta`);
    }
    const ref =
      overlay.type === "map_marker" && isLatLon(overlay.ref) && appearsIn(normalizedFull, overlay.ref?.name)
        ? { name: overlay.ref!.name.trim(), lat: overlay.ref!.lat, lon: overlay.ref!.lon }
        : undefined;
    // El icono no es texto del guion: solo se valida que exista.
    const icon = overlay.icon && supportedOverlayIcons().includes(overlay.icon) ? overlay.icon : undefined;
    // Barras, versus o linea de tiempo con menos de 2 valores validos no
    // comparan nada: se descarta el grafico entero.
    if (items && items.length < 2) {
      throw new Error(`overlay ${overlay.type} con menos de 2 items validos (modo estricto)`);
    }
    // Sin la segunda frase no hay reemplazo; sin cifra no hay cifra en frase.
    if (overlay.type === "phrase_swap" && !label) {
      throw new Error("phrase_swap sin label (la segunda frase) literal del guion — se descarta");
    }
    if (overlay.type === "number_phrase" && !/\d/.test(text)) {
      throw new Error("number_phrase sin cifra en el texto — se descarta");
    }
    if (overlay.type === "cycle_diagram" && items!.length < 3) {
      throw new Error("cycle_diagram necesita al menos 3 pasos");
    }
    if (overlay.type === "scoreboard" && items!.length !== 2) {
      throw new Error("scoreboard necesita exactamente 2 lados");
    }

    return {
      overlay: {
        type: overlay.type,
        text,
        source: "script",
        ...(label ? { label } : {}),
        ...(items?.length ? { items } : {}),
        ...(icon ? { icon } : {}),
        ...(geo ? { geo } : {}),
        ...(ref ? { ref } : {}),
        ...(typeof overlay.anchor === "number" ? { anchor: Math.min(1, Math.max(0, overlay.anchor)) } : {}),
        ...(typeof overlay.duration === "number" && overlay.duration > 0 ? { duration: Math.min(12, overlay.duration) } : {}),
      },
    };
  },
};
