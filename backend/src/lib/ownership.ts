import { supabase } from "./supabase.js";
import type { Script, Job, Asset } from "../types/shared/typeShared.js";

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

export async function getOwnedAsset(
  assetId: string | string[] | undefined,
  userId: string
): Promise<Asset | null> {
  if (typeof assetId !== "string") return null;

  const { data: asset, error } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .single();

  if (error || !asset) return null;

  const project = await getOwnedProject(asset.video_project_id, userId);
  if (!project) return null;

  return asset;
}

// script_styles es directo por user_id (como video_projects), no indirecto
// como scripts/scenes -- no cuelga de ningun proyecto.
export async function getOwnedScriptStyle(
  scriptStyleId: string | string[] | undefined,
  userId: string
) {
  if (typeof scriptStyleId !== "string") return null;

  const { data, error } = await supabase
    .from("script_styles")
    .select("*")
    .eq("id", scriptStyleId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data;
}

// Resuelve a que video_project_id pertenece una scene, subiendo por su
// script. Se usa para validar que un asset no se asocie a una scene de
// OTRO proyecto del mismo usuario (getOwnedScene por si solo no alcanza).
export async function getSceneVideoProjectId(
  sceneId: string
): Promise<string | null> {
  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .select("script_id")
    .eq("id", sceneId)
    .single();

  if (sceneError || !scene) return null;

  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("video_project_id")
    .eq("id", scene.script_id)
    .single();

  if (scriptError || !script) return null;

  return script.video_project_id;
}
