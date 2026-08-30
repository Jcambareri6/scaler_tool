// shared/types/script.types.ts

export interface Script {
  id: string;
  video_project_id: string;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Scene {
  id: string;
  script_id: string;
  order: number;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export interface Asset {
  id: string;
  video_project_id: string;
  scene_id: string | null;
  type: string;
  storage_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Timeline {
  id: string;
  video_project_id: string;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Gap #1 (LEEME): el LEEME exige mirar stock_preview_sin_overlays.mp4 antes
// del render final. AWAITING_STOCK_REVIEW es ese gate — el pipeline se
// pausa ahí hasta que el usuario aprueba, recién después pasa a RENDERING.
export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "SCRIPT_DONE"
  | "AUDIO_DONE"
  | "VISUALS_DONE"
  | "AWAITING_STOCK_REVIEW"
  | "RENDERING"
  | "COMPLETED"
  | "FAILED";

export interface Job {
  id: string;
  video_project_id: string;
  type: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

// Gap #2 (LEEME): reemplaza bad_stock_ids.json / stock_overrides.json.
// Persiste entre videos, por eso no cuelga de VideoProject sino de user_id.
export type StockDecision = "BLOCKED" | "PREFERRED";

export interface StockLibraryEntry {
  id: string;
  user_id: string;
  provider: string;
  external_id: string;
  decision: StockDecision;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// Gap #3 (LEEME): reglas de bloqueo/preferencia de stock por proyecto
// (equivalente a las reglas de "Plantas Sagradas" en la sección 8 del
// LEEME). Vive en VideoProject.content_policy, JSONB nullable.
export interface ContentPolicy {
  block: string[];
  prefer: string[];
  notes?: string;
}

// Gap #4 (LEEME): contrato del overlay para modo estricto — el texto SIEMPRE
// debe derivar del guion (source: "script"), nunca inventarse. La
// validación real vive en la Tool generate_overlay; esto documenta el shape
// esperado dentro de Scene.content.overlay.
export type OverlayType =
  | "title_card"
  | "rank_reveal"
  | "big_number"
  | "lower_third"
  | "badge"
  | "data_viz_single"
  | "cta"
  | "ninguno";

export interface OverlaySpec {
  type: OverlayType;
  text: string;
  source: "script";
}
export interface Provider {
  id: string;
  name: string;
  slug: string;
  api_key: string | null;
  configuration: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface ToolExecution {
  id: string;
  job_id: string | null;
  provider_id: string | null;
  tool_name: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  configuration: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}