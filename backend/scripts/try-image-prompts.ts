// Prueba manual de generate_image_prompt_sequence con un guion real, sin
// tocar la base: arma el tramo 1 (o el que se pida) y muestra los prompts.
// Uso: npx tsx --env-file=.env scripts/try-image-prompts.ts <script_id> [tramo]
import { supabase } from "../src/lib/supabase.js";
import { getChannelSettingsForProject } from "../src/lib/channelSettings.js";
import { generateImagePromptSequenceTool, type SequenceScene } from "../src/tools/generateImagePromptSequence.tool.js";

const [scriptId, chunkArg] = process.argv.slice(2);
if (!scriptId) throw new Error("Falta script_id");
const chunkIndex = Number(chunkArg ?? 1) - 1;

const { data: script } = await supabase.from("scripts").select("id, video_project_id").eq("id", scriptId).single();
if (!script) throw new Error("Script no encontrado");
const { data: project } = await supabase.from("video_projects").select("title").eq("id", script.video_project_id).single();
const channel = await getChannelSettingsForProject(script.video_project_id);
const { data: rows } = await supabase.from("scenes").select("order, content").eq("script_id", scriptId).order("order");

const scenes: SequenceScene[] = (rows ?? [])
  .map((r) => {
    const c = (r.content ?? {}) as { text?: string; timeStart?: string; timeEnd?: string };
    const time = c.timeStart ? (c.timeEnd ? `${c.timeStart} - ${c.timeEnd}` : c.timeStart) : undefined;
    return { order: r.order as number, text: c.text ?? "", ...(time ? { time } : {}) };
  })
  .filter((s) => s.text.trim());

const chunk = scenes.slice(chunkIndex * 8, chunkIndex * 8 + 8);
const started = Date.now();
const { prompts } = await generateImagePromptSequenceTool.execute(
  {
    scenes: chunk,
    full_script: scenes,
    ...(project?.title ? { video_topic: project.title } : {}),
    ...(channel.visual_style_prompt ? { visual_style: channel.visual_style_prompt } : {}),
  },
  {} as never
);
for (const p of prompts) console.log(`--- Escena ${p.order} ---\n${p.prompt}\n`);
console.log(`${prompts.length}/${chunk.length} prompts en ${((Date.now() - started) / 1000).toFixed(1)}s`);
