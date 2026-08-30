import type { Script, Asset } from "../../types/shared/typeShared.js";

export interface SceneWithAssets {
  id: string;
  script_id: string;
  order: number;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  assets: Asset[];
}

export interface ScriptDetail extends Script {
  scenes: SceneWithAssets[];
}

export interface CreateScriptInput {
  content?: Record<string, unknown>;
}

export interface UpdateScriptInput {
  content: Record<string, unknown>;
}
