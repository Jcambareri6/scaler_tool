import { supabase } from "./supabase.js";
import type { Script, Job, Asset } from "../types/shared/typeShared.js";

// scripts/scenes no tienen user_id propio (ver regla de seguridad en
// CLAUDE.md) — todo ownership se resuelve subiendo hasta video_projects.
//
// Con workspaces el acceso a un proyecto es: el creador (user_id) siempre
// es owner; si el proyecto vive en un workspace, cada miembro accede con su
// rol de workspace_members. Los endpoints de lectura piden "viewer"; todo
// lo que modifica pide "editor" (el default, para que un call site olvidado
// quede del lado seguro).

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function roleAtLeast(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function getWorkspaceRole(
  workspaceId: string | string[] | undefined | null,
  userId: string
): Promise<WorkspaceRole | null> {
  if (typeof workspaceId !== "string") return null;

  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data.role as WorkspaceRole;
}

// IDs de todos los workspaces donde el usuario es miembro (cualquier rol).
export async function getMemberWorkspaceIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId);

  if (error || !data) return [];
  return data.map((row) => row.workspace_id as string);
}

export interface ProjectAccess {
  id: string;
  user_id: string;
  workspace_id: string | null;
  role: WorkspaceRole;
}

export async function getOwnedProject(
  projectId: string | string[] | undefined,
  userId: string,
  minRole: WorkspaceRole = "editor"
): Promise<ProjectAccess | null> {
  if (typeof projectId !== "string") return null;

  const { data, error } = await supabase
    .from("video_projects")
    .select("id, user_id, workspace_id")
    .eq("id", projectId)
    .single();

  if (error || !data) return null;

  const role: WorkspaceRole | null =
    data.user_id === userId ? "owner" : await getWorkspaceRole(data.workspace_id, userId);

  if (!roleAtLeast(role, minRole)) return null;
  return { ...data, role: role! };
}

export async function getOwnedScript(
  scriptId: string | string[] | undefined,
  userId: string,
  minRole: WorkspaceRole = "editor"
): Promise<Script | null> {
  if (typeof scriptId !== "string") return null;

  const { data: script, error } = await supabase
    .from("scripts")
    .select("*")
    .eq("id", scriptId)
    .single();

  if (error || !script) return null;

  const project = await getOwnedProject(script.video_project_id, userId, minRole);
  if (!project) return null;

  return script;
}

export async function getOwnedJob(
  jobId: string | string[] | undefined,
  userId: string,
  minRole: WorkspaceRole = "editor"
): Promise<Job | null> {
  if (typeof jobId !== "string") return null;

  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !job) return null;

  const project = await getOwnedProject(job.video_project_id, userId, minRole);
  if (!project) return null;

  return job;
}

export async function getOwnedAsset(
  assetId: string | string[] | undefined,
  userId: string,
  minRole: WorkspaceRole = "editor"
): Promise<Asset | null> {
  if (typeof assetId !== "string") return null;

  const { data: asset, error } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .single();

  if (error || !asset) return null;

  const project = await getOwnedProject(asset.video_project_id, userId, minRole);
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
