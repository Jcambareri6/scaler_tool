import type { ScriptStyle } from "../../types/shared/typeShared.js";

export type { ScriptStyle };

export interface CreateScriptStyleInput {
  name: string;
  reference_scripts: string[];
}

export interface UpdateScriptStyleInput {
  name?: string;
  master_prompt?: string;
}
