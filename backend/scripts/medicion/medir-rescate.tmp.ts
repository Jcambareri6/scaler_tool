// Rehace SOLO los planos de un documental (montaje + busqueda + rescate) con
// la voz y las palabras que ya tiene: sin TTS ni Whisper. Para medir el
// rescate (rama feat/medir-rescate). No commitear.
//   npx tsx scripts/medicion/medir-rescate.tmp.ts <project_id> <user_id>
import "dotenv/config";
import { supabase } from "../../src/lib/supabase.js";
import { runTool } from "../../src/tools/index.js";
import { runDocumentalMontaje } from "../../src/pipeline/documentalPipeline.js";
import { syncProjectStatus } from "../../src/lib/projectStatus.js";
import { getChannelSettingsForProject } from "../../src/lib/channelSettings.js";
import { buildPreviewMix } from "../../src/tools/renderVideo.tool.js";
import type { ContentPolicy } from "../../src/types/shared/typeShared.js";
import type { TranscribedWord } from "../../src/tools/transcribeAudio.tool.js";

const [projectId, userId] = process.argv.slice(2);
if (!projectId || !userId) throw new Error("uso: medir-rescate.tmp.ts <project_id> <user_id>");

const { data: project, error: pErr } = await supabase.from("video_projects").select("*").eq("id", projectId).single();
if (pErr || !project) throw new Error(pErr?.message ?? "sin proyecto");
const { data: script } = await supabase.from("scripts").select("id, content").eq("video_project_id", projectId).single();
const scriptText = ((script?.content as { text?: string } | null)?.text) ?? "";
const { data: timeline } = await supabase.from("timelines").select("content").eq("video_project_id", projectId).single();
const words = ((timeline?.content as { words?: TranscribedWord[] } | null)?.words) ?? [];
if (!script || !scriptText.trim() || words.length === 0) throw new Error("falta guion o palabras de la transcripcion");
console.log(`[medir] ${project.title}: ${words.length} palabras`);

const { data: job, error: jobError } = await supabase
  .from("jobs")
  .insert({ video_project_id: projectId, type: "FULL_PIPELINE", status: "RUNNING", progress: 15, progress_message: "Rehaciendo los planos (medicion del rescate)...", started_at: new Date().toISOString() })
  .select("id")
  .single();
if (jobError || !job) throw new Error(jobError?.message ?? "sin job");
await syncProjectStatus(projectId, "RUNNING");
console.log(`[medir] job ${job.id}`);

const t0 = Date.now();
try {
  await runDocumentalMontaje({
    projectId,
    userId,
    jobId: job.id,
    scriptId: script.id,
    scriptText,
    words,
    ...(project.title ? { videoTopic: project.title as string } : {}),
    styleId: (project.video_style as string | null) ?? null,
    ...(project.content_policy ? { contentPolicy: project.content_policy as ContentPolicy } : {}),
    channelLanguage: (await getChannelSettingsForProject(projectId)).channel_language,
  });
  await runTool("build_timeline", { video_project_id: projectId }, { userId, jobId: job.id });
  await buildPreviewMix(projectId).catch((err) => console.warn(`[medir] sin mezcla de preview: ${(err as Error).message}`));
  await supabase.from("jobs").update({ status: "AWAITING_STOCK_REVIEW", progress: 100, progress_message: "Planos listos para revisar" }).eq("id", job.id);
  await syncProjectStatus(projectId, "AWAITING_STOCK_REVIEW");
  console.log(`[medir] LISTO en ${Math.round((Date.now() - t0) / 60_000)} min`);
} catch (err) {
  console.error(`[medir] FALLO: ${(err as Error).message}`);
  await supabase.from("jobs").update({ status: "FAILED", error: (err as Error).message, finished_at: new Date().toISOString() }).eq("id", job.id);
  await syncProjectStatus(projectId, "FAILED");
}
process.exit(0);
