export type ProjectStatus = "DRAFT" | "IN_PROGRESS" | "GENERATING" | "DONE" | "ERROR";

export type VisualSource = "stock" | "ai" | "mixed";

export type SceneVisualStatus = "PENDING" | "GENERATING" | "DONE" | "ERROR";

export type JobStatus = "QUEUED" | "RUNNING" | "AWAITING_STOCK_REVIEW" | "DONE" | "FAILED";

export interface VideoProject {
  id: string;
  title: string;
  status: ProjectStatus;
  description?: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
  scriptStyleId?: string;
  voiceId?: string;
  visualSource: VisualSource;
  transitionsEnabled: boolean;
  subtitlesEnabled: boolean;
  workspaceId?: string;
  // Solo viene en GET /projects/:id y /details (rol del usuario actual).
  myRole?: WorkspaceRole;
}

export interface Script {
  id: string;
  projectId: string;
  title: string;
  content: string;
  status: "DRAFT" | "FINAL";
  updatedAt: string;
}

export interface Scene {
  id: string;
  projectId: string;
  order: number;
  title: string;
  timeStart: string;
  timeEnd: string;
  narrativeContent: string;
  visualPrompt?: string;
  visualStatus: SceneVisualStatus;
  duration: string;
}

export interface Job {
  id: string;
  projectId: string;
  type: "SCRIPT_GENERATION" | "SCENE_GENERATION" | "VIDEO_RENDER";
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export type AssetType = "AUDIO" | "VIDEO" | "IMAGE";

export interface Asset {
  id: string;
  projectId: string;
  sceneId: string | null;
  type: AssetType;
  storageKey: string;
  metadata: Record<string, unknown>;
}

export type ScriptStyleStatus = "PENDING" | "READY" | "FAILED";

export interface ScriptStyle {
  id: string;
  name: string;
  referenceScripts: string[];
  masterPrompt: string | null;
  status: ScriptStyleStatus;
  error: string | null;
  createdAt: string;
}

// --- workspaces -------------------------------------------------------------

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  isPersonal: boolean;
  myRole: WorkspaceRole;
  memberCount: number;
  createdAt: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string | null;
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceInvite {
  id: string;
  email: string;
  role: WorkspaceRole;
  inviteUrl: string;
  expiresAt: string;
}

export interface MyInvite {
  id: string;
  token: string;
  role: WorkspaceRole;
  workspaceName: string;
  expiresAt: string;
}
