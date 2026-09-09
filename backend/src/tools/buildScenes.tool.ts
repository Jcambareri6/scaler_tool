import type { ToolDefinition } from "./tool.types.js";
import { getOwnedProject } from "../lib/ownership.js";
import { supabase } from "../lib/supabase.js";
import type { TranscribedWord } from "./transcribeAudio.tool.js";

export interface BuildScenesInput {
  video_project_id: string;
}

export interface BuiltScene {
  order: number;
  text: string;
  timeStart: string;
  timeEnd: string;
}

export interface BuildScenesOutput {
  scenes: BuiltScene[];
}

// LEEME (seccion 5): las escenas se arman DESPUES de tener audio real y
// transcripcion (Whisper), no adivinadas por el guionista al mismo tiempo
// que escribe el texto -- asi el limite de cada escena cae exactamente
// donde se dice esa parte en la voz real, en vez de una aproximacion.
//
// Umbrales pedidos por el cliente (ver backend/claude/PROMPT PARA AGRUPAR
// TIMESTAMPS EN BLOQUES DE ESCENA CORTOS_.docx / PLAN_escenas_cortas_y_
// stock_contexto_global.md): escenas mucho mas cortas que antes (35-60s)
// para video dinamico con cambios visuales frecuentes.
const TARGET_MIN_SECONDS = 5;
const MAX_SCENE_SECONDS = 12;
const MIN_SCENE_SECONDS = 4;

// Umbral de palabras a cada lado de una coma para tratarla como punto de
// corte valido (aproxima "dos frases largas e independientes" del prompt
// del cliente -- no hay forma deterministica de "entender" la frase, asi
// que se usa longitud como proxy: una coma de enumeracion tipica tiene
// fragmentos cortos de un lado o del otro).
const MIN_COMMA_CLAUSE_WORDS = 6;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

interface RawFragment {
  text: string;
  term: string;
  kind: "strong" | "colon" | "comma" | "none";
}

// Tokeniza el guion en fragmentos atomicos, cada uno terminado en como
// maximo un signo de puntuacion (una corrida de ".","!","?" cuenta como uno
// solo, asi "..." no se parte en tres). El texto se preserva tal cual
// (incluye espacios) para poder reconstruir el original sin tocar una sola
// palabra.
function tokenizeFragments(fullText: string): RawFragment[] {
  const fragments: RawFragment[] = [];
  const regex = /([^.!?;:,]+)([.!?]+|[;:,])?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fullText)) !== null) {
    const text = match[1] ?? "";
    if (!text) continue;
    const term = match[2] ?? "";
    let kind: RawFragment["kind"] = "none";
    if (term === ":") kind = "colon";
    else if (term === ",") kind = "comma";
    else if (term) kind = "strong";
    fragments.push({ text, term, kind });
  }
  return fragments;
}

// Agrupa los fragmentos atomicos en "clausulas": unidades de texto que
// SIEMPRE terminan en un punto de corte valido segun las reglas del
// cliente -- "." "!" "?" "..." ";" y ":" son siempre validos: "," solo si
// separa dos fragmentos "largos" (ver MIN_COMMA_CLAUSE_WORDS). Nunca
// modifica, agrega ni reordena texto -- solo decide donde es valido cortar.
function splitIntoClauses(fullText: string): string[] {
  const fragments = tokenizeFragments(fullText);
  const clauses: string[] = [];
  let pendingParts: string[] = [];

  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]!;
    pendingParts.push(fragment.text + fragment.term);

    let isValidCut: boolean;
    if (fragment.kind === "comma") {
      const before = wordCount(pendingParts.join(""));
      const after = wordCount(fragments[i + 1]?.text ?? "");
      isValidCut = before >= MIN_COMMA_CLAUSE_WORDS && after >= MIN_COMMA_CLAUSE_WORDS;
    } else {
      isValidCut = true;
    }

    if (isValidCut) {
      const clauseText = pendingParts.join("").trim();
      if (clauseText) clauses.push(clauseText);
      pendingParts = [];
    }
  }

  if (pendingParts.length > 0) {
    const clauseText = pendingParts.join("").trim();
    if (clauseText) clauses.push(clauseText);
  }

  return clauses;
}

interface AlignedClause {
  text: string;
  start: number;
  end: number;
}

// Las clausulas concatenadas reconstruyen full_text en orden, igual que las
// escenas lo hacian antes -- alcanza con consumir la lista de palabras
// transcriptas de forma secuencial (mismo criterio que
// buildTimeline.tool.ts::alignScenesToWords, pero a nivel clausula).
function alignClausesToWords(clauses: string[], words: TranscribedWord[]): AlignedClause[] {
  const aligned: AlignedClause[] = [];
  let wordIndex = 0;

  for (const clause of clauses) {
    const count = wordCount(clause);
    if (count === 0) continue;

    const slice = words.slice(wordIndex, wordIndex + count);
    if (slice.length === 0) break;

    aligned.push({ text: clause, start: slice[0]!.start, end: slice[slice.length - 1]!.end });
    wordIndex += slice.length;
  }

  return aligned;
}

// Agrupa clausulas consecutivas en escenas: cierra el bloque apenas la
// duracion acumulada llega a TARGET_MIN_SECONDS en un punto de corte valido
// (las clausulas ya garantizan eso). Si una sola clausula ya supera
// MAX_SCENE_SECONDS por si sola (oracion larga sin comas/`;`/`:` internos
// validos), queda como bloque individual sin cortarla -- la regla de "nunca
// cortar a mitad de idea" tiene prioridad sobre el tope de duracion.
function groupIntoScenes(clauses: AlignedClause[]): { text: string; start: number; end: number }[] {
  const scenes: { text: string; start: number; end: number }[] = [];
  let current: AlignedClause[] = [];

  for (const clause of clauses) {
    current.push(clause);
    const duration = clause.end - current[0]!.start;
    if (duration >= TARGET_MIN_SECONDS) {
      scenes.push(commitScene(current));
      current = [];
    }
  }

  if (current.length > 0) {
    const leftoverDuration = current[current.length - 1]!.end - current[0]!.start;
    // El ultimo resto del guion no tiene "siguiente punto de corte" al cual
    // seguir acumulando (regla 3) -- si queda por debajo del piso, se
    // fusiona con la escena anterior en vez de dejar un bloque invalido.
    if (leftoverDuration < MIN_SCENE_SECONDS && scenes.length > 0) {
      const last = scenes[scenes.length - 1]!;
      last.text = `${last.text} ${current.map((c) => c.text).join(" ")}`;
      last.end = current[current.length - 1]!.end;
    } else {
      scenes.push(commitScene(current));
    }
  }

  return scenes;
}

function commitScene(clauses: AlignedClause[]): { text: string; start: number; end: number } {
  return {
    text: clauses.map((c) => c.text).join(" "),
    start: clauses[0]!.start,
    end: clauses[clauses.length - 1]!.end,
  };
}

function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export const buildScenesTool: ToolDefinition<BuildScenesInput, BuildScenesOutput> = {
  name: "build_scenes",
  description:
    "Arma las escenas del proyecto a partir del guion y el timing real de la voz ya transcripta (Whisper). Reemplaza cualquier escena previa.",
  parameters: {
    type: "object",
    properties: {
      video_project_id: { type: "string", description: "UUID del proyecto" },
    },
    required: ["video_project_id"],
  },
  async execute({ video_project_id }, ctx) {
    const project = await getOwnedProject(video_project_id, ctx.userId);
    if (!project) {
      throw new Error("Project not found");
    }

    const { data: script, error: scriptError } = await supabase
      .from("scripts")
      .select("id, content")
      .eq("video_project_id", video_project_id)
      .single();
    if (scriptError || !script) {
      throw new Error("El proyecto no tiene guion todavia");
    }

    const fullText = ((script.content as { text?: string } | null)?.text) ?? "";
    if (!fullText.trim()) {
      throw new Error("El guion del proyecto esta vacio");
    }

    const { data: timeline } = await supabase
      .from("timelines")
      .select("content")
      .eq("video_project_id", video_project_id)
      .maybeSingle();
    const timelineContent = timeline?.content as { words?: TranscribedWord[]; duration_seconds?: number } | null;
    const words = timelineContent?.words ?? [];
    const audioDurationSeconds = timelineContent?.duration_seconds;
    if (words.length === 0) {
      throw new Error(
        "Todavia no hay transcripcion (Whisper) para este proyecto -- corre generate_voice + transcribe_audio primero"
      );
    }

    const clauses = splitIntoClauses(fullText);
    const alignedClauses = alignClausesToWords(clauses, words);
    const grouped = groupIntoScenes(alignedClauses);

    if (grouped.length === 0) {
      throw new Error("No se pudieron armar escenas a partir de la transcripcion");
    }

    // El end de la ultima palabra transcripta casi siempre queda unos
    // segundos antes del final REAL del audio (silencio/fade de cola) --
    // sin esto, la ultima escena "termina" antes de que el audio termine
    // de verdad, y el preview se queda mostrando el ultimo clip en loop
    // durante ese resto sin ningun corte, dando la sensacion de que el
    // video sigue sin fin despues de que el usuario deja de prestarle
    // atencion al audio.
    const lastScene = grouped[grouped.length - 1]!;
    if (audioDurationSeconds && audioDurationSeconds > lastScene.end) {
      lastScene.end = audioDurationSeconds;
    }

    // Regenerar las escenas reemplaza las anteriores por completo -- son un
    // desglose derivado del guion + audio real, no ediciones manuales a
    // preservar (mismo criterio que generate_script usaba antes).
    const { error: deleteError } = await supabase.from("scenes").delete().eq("script_id", script.id);
    if (deleteError) throw new Error(deleteError.message);

    const rows = grouped.map((scene, index) => ({
      script_id: script.id,
      order: index + 1,
      content: {
        text: scene.text,
        timeStart: formatTime(scene.start),
        timeEnd: formatTime(scene.end),
        duration: `${Math.round(scene.end - scene.start)}s`,
      },
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("scenes")
      .insert(rows)
      .select("order, content");
    if (insertError) throw new Error(insertError.message);

    return {
      scenes: (inserted ?? [])
        .map((row) => ({
          order: row.order as number,
          text: ((row.content as { text?: string } | null)?.text) ?? "",
          timeStart: ((row.content as { timeStart?: string } | null)?.timeStart) ?? "00:00",
          timeEnd: ((row.content as { timeEnd?: string } | null)?.timeEnd) ?? "00:00",
        }))
        .sort((a, b) => a.order - b.order),
    };
  },
};
