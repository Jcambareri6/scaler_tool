import type { ProjectStatus, VideoProject, Script, Scene, SceneVisualStatus, Job, JobStatus, Asset, AssetType, ScriptStyle, ScriptStyleStatus, VisualSource } from "@/types";

// --- video_projects -------------------------------------------------------

interface ProjectRow {
  id: string;
  title: string;
  status: string;
  description: string | null;
  script_style_id: string | null;
  visual_source?: string | null;
  created_at: string;
  updated_at: string;
}

const VISUAL_SOURCES: VisualSource[] = ["stock", "ai", "mixed"];

function toVisualSource(value: string | null | undefined): VisualSource {
  return (VISUAL_SOURCES as string[]).includes(value ?? "") ? (value as VisualSource) : "stock";
}

const PROJECT_STATUSES: ProjectStatus[] = ["DRAFT", "IN_PROGRESS", "GENERATING", "DONE", "ERROR"];

function toProjectStatus(status: string): ProjectStatus {
  const upper = status.toUpperCase();
  return (PROJECT_STATUSES as string[]).includes(upper) ? (upper as ProjectStatus) : "DRAFT";
}

export function mapProject(row: ProjectRow): VideoProject {
  return {
    id: row.id,
    title: row.title,
    status: toProjectStatus(row.status),
    description: row.description ?? undefined,
    scriptStyleId: row.script_style_id ?? undefined,
    visualSource: toVisualSource(row.visual_source),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- script_styles ---------------------------------------------------------

interface ScriptStyleRow {
  id: string;
  name: string;
  reference_scripts: string[];
  master_prompt: string | null;
  status: ScriptStyleStatus;
  error: string | null;
  created_at: string;
}

export function mapScriptStyle(row: ScriptStyleRow): ScriptStyle {
  return {
    id: row.id,
    name: row.name,
    referenceScripts: row.reference_scripts ?? [],
    masterPrompt: row.master_prompt,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  };
}

// --- scripts ---------------------------------------------------------------
// El backend guarda `content` como jsonb generico; la convencion que usamos
// desde el frontend es { text: string }. `status` no existe todavia en la
// tabla — el backend no distingue borrador/final, asi que siempre es DRAFT.

interface ScriptRow {
  id: string;
  video_project_id: string;
  content: { text?: string } | null;
  updated_at: string;
}

export function mapScript(row: ScriptRow): Script {
  return {
    id: row.id,
    projectId: row.video_project_id,
    title: "Guion del proyecto",
    content: row.content?.text ?? "",
    status: "DRAFT",
    updatedAt: row.updated_at,
  };
}

// --- scenes ------------------------------------------------------------
// Igual que scripts: el backend solo tiene `order` + `content` jsonb
// generico. Los campos ricos del Scene del frontend (title, timeStart,
// timeEnd, narrativeContent, visualPrompt, visualStatus, duration) viven
// empaquetados dentro de `content`. El texto narrativo se guarda bajo la
// clave `text` (asi lo escriben generate_script y build_timeline en el
// backend — ver tools/generateScript.tool.ts y tools/buildTimeline.tool.ts),
// no `narrativeContent`; solo el nombre expuesto en el tipo Scene del
// frontend es distinto.

interface SceneContent {
  title?: string;
  timeStart?: string;
  timeEnd?: string;
  text?: string;
  visualPrompt?: string;
  visualStatus?: SceneVisualStatus;
  duration?: string;
}

interface SceneRow {
  id: string;
  order: number;
  content: SceneContent | null;
}

export function mapScene(row: SceneRow, projectId: string): Scene {
  const c = row.content ?? {};
  return {
    id: row.id,
    projectId,
    order: row.order,
    title: c.title ?? `Escena ${row.order}`,
    timeStart: c.timeStart ?? "00:00",
    timeEnd: c.timeEnd ?? "00:00",
    narrativeContent: c.text ?? "",
    visualPrompt: c.visualPrompt,
    visualStatus: c.visualStatus ?? "PENDING",
    duration: c.duration ?? "0s",
  };
}

export function sceneToContent(scene: Partial<Scene>): SceneContent {
  const content: SceneContent = {};
  if (scene.title !== undefined) content.title = scene.title;
  if (scene.timeStart !== undefined) content.timeStart = scene.timeStart;
  if (scene.timeEnd !== undefined) content.timeEnd = scene.timeEnd;
  if (scene.narrativeContent !== undefined) content.text = scene.narrativeContent;
  if (scene.visualPrompt !== undefined) content.visualPrompt = scene.visualPrompt;
  if (scene.visualStatus !== undefined) content.visualStatus = scene.visualStatus;
  if (scene.duration !== undefined) content.duration = scene.duration;
  return content;
}

// --- jobs --------------------------------------------------------------
// El backend tiene un pipeline detallado de 9 estados. El frontend colapsa
// los intermedios (SCRIPT_DONE/AUDIO_DONE/VISUALS_DONE/RENDERING) en
// RUNNING, pero preserva AWAITING_STOCK_REVIEW tal cual — es el gate de
// aprobacion humana y PreviewPanel necesita distinguirlo para mostrar
// StockReviewPanel en vez de la barra de progreso generica.

type BackendJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "SCRIPT_DONE"
  | "AUDIO_DONE"
  | "VISUALS_DONE"
  | "AWAITING_STOCK_REVIEW"
  | "RENDERING"
  | "COMPLETED"
  | "FAILED";

interface JobRow {
  id: string;
  video_project_id: string;
  status: BackendJobStatus;
  progress: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
}

function toJobStatus(status: BackendJobStatus): JobStatus {
  if (status === "QUEUED") return "QUEUED";
  if (status === "COMPLETED") return "DONE";
  if (status === "FAILED") return "FAILED";
  if (status === "AWAITING_STOCK_REVIEW") return "AWAITING_STOCK_REVIEW";
  return "RUNNING";
}

export function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    projectId: row.video_project_id,
    type: "VIDEO_RENDER",
    status: toJobStatus(row.status),
    progress: row.progress,
    message: row.error ?? row.status,
    createdAt: row.created_at,
    updatedAt: row.started_at ?? row.created_at,
  };
}

// --- assets --------------------------------------------------------------

interface AssetRow {
  id: string;
  video_project_id: string;
  scene_id: string | null;
  type: string;
  storage_key: string;
  metadata: Record<string, unknown> | null;
}

export function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    projectId: row.video_project_id,
    sceneId: row.scene_id,
    type: row.type as AssetType,
    storageKey: row.storage_key,
    metadata: row.metadata ?? {},
  };
}
