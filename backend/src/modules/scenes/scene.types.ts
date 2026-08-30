import type { Asset } from "../../types/shared/typeShared.js";

export interface Scene {
  id: string;
  script_id: string;
  order: number;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SceneWithAssets extends Scene {
  assets: Asset[];
}

export interface CreateSceneInput {
  order: number;
  content?: Record<string, unknown>;
}

export interface UpdateSceneInput {
  order?: number;
  content?: Record<string, unknown>;
}

export interface ReorderScenesInput {
  scenes: { id: string; order: number }[];
}
