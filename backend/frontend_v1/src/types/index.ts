export type ProjectStatus = "DRAFT" | "IN_PROGRESS" | "GENERATING" | "DONE" | "ERROR";

export type VisualSource = "stock" | "ai" | "mixed" | "flow";

// Paleta de las metricas animadas segun el genero del video (ver
// backend motion/src/theme.ts).
export type OverlayTheme = "documental" | "ciencia" | "finanzas" | "historia" | "crimen" | "minimal";

// Grafico animado ubicado en el tiempo del video (segundos absolutos), tal
// como lo va a superponer el render (backend placeOverlays).
export interface PlacedOverlay {
  spec: {
    type: string;
    text: string;
    label?: string;
    items?: { label: string; text: string }[];
    chapter?: number;
    progress?: number;
    icon?: string;
  };
  start: number;
  end: number;
}

// Paleta de un nicho (backend/motion/niches.json), tal como la reciben los
// componentes de motion/ como `theme`.
export interface PaletteTheme {
  accent: string;
  text: string;
  textMuted: string;
  scrim: string;
  titleFont: "serif" | "sans";
}

export interface OverlayStyle {
  niche: string;
  nicheName: string;
  paletteKey: string;
  paletteName: string;
  // video: excepcion de este video; channel: la elegida para el canal;
  // default: el canal todavia no eligio (se ofrece elegir en la revision).
  source: "video" | "channel" | "default";
  canSaveChannel: boolean;
  options: { key: string; name: string; theme: PaletteTheme }[];
}

export interface ProjectOverlays {
  enabled: boolean;
  theme: OverlayTheme | PaletteTheme;
  locale: string;
  overlays: PlacedOverlay[];
  // Capa fija de arriba (canal · tema | capitulo), convive con los demas.
  nav?: PlacedOverlay[];
  style: OverlayStyle | null;
}

export type RenderQuality = "720p" | "1080p";

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
  // Metricas animadas (contadores, barras, versus...) quemadas en el render.
  overlaysEnabled: boolean;
  overlayTheme: OverlayTheme;
  renderQuality: RenderQuality;
  // true si el proyecto ya desconto su video (re-renderizarlo no descuenta).
  renderCharged: boolean;
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
  // Precisos (timeStart/timeEnd redondean al segundo, son para mostrar).
  // Ausentes en escenas armadas antes de que el backend los guardara.
  startSeconds?: number;
  endSeconds?: number;
  narrativeContent: string;
  visualPrompt?: string;
  imagePrompt?: string;
  imagePromptStyleKey?: string;
  imagePromptEdited?: boolean;
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

// Prompt de imagen de una escena para generar afuera (ej: Google Flow).
export interface SceneImagePrompt {
  sceneId: string;
  order: number;
  text: string;
  imagePrompt: string | null;
  imagePromptStyleKey: string | null;
  imagePromptEdited: boolean;
  hasVisual: boolean;
  error?: string;
}

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
