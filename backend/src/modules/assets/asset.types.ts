import type { Asset } from "../../types/shared/typeShared.js";

export type { Asset };

export interface CreateAssetInput {
  type: string;
  storage_key: string;
  scene_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateAssetInput {
  type?: string;
  storage_key?: string;
  scene_id?: string | null;
  metadata?: Record<string, unknown>;
}
