import { supabase } from "./supabase.js";
import type { Script, Job } from "../types/shared/typeShared.js";

// scripts/scenes no tienen user_id propio (ver regla de seguridad en
// CLAUDE.md) — todo ownership se resuelve subiendo hasta video_projects.

export async function getOwnedProject(
  projectId: string | string[] | undefined,
  userId: string
) {
  if (typeof projectId !== "string") return null;

  const { data, error } = await supabase
    .from("video_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data;
}

export async function getOwnedScript(
  scriptId: string | string[] | undefined,
  userId: string
): Promise<Script | null> {
  if (typeof scriptId !== "string") return null;

  const { data: script, error } = await supabase
    .from("scripts")
    .select("*")
    .eq("id", scriptId)
    .single();

  if (error || !script) return null;

  const project = await getOwnedProject(script.video_project_id, userId);
  if (!project) return null;

  return script;
}

export async function getOwnedJob(
  jobId: string | string[] | undefined,
  userId: string
): Promise<Job | null> {
  if (typeof jobId !== "string") return null;

  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !job) return null;

  const project = await getOwnedProject(job.video_project_id, userId);
  if (!project) return null;

  return job;
}
