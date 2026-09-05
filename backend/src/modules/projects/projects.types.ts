import type {

  Script,
  Scene,
  Asset,
  Timeline,
  Job,
  ContentPolicy,
  VisualSource
} from "../../types/shared/typeShared.ts";

export interface SceneDetail extends Scene {
  assets: Asset[];
}

export interface ScriptDetail extends Script {
  scenes: SceneDetail[];
}

export interface ProjectDetail extends Project {
  script: ScriptDetail | null;
  assets: Asset[];
  timeline: Timeline | null;
  jobs: Job[];
}


export interface CreateProjectInput {
  name: string;
  description?: string;
}
export interface Project {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  target_duration: number | null;
  status: string;
  content_policy: ContentPolicy | null;
  script_style_id: string | null;
  visual_source: VisualSource;
  created_at: string;
  updated_at: string;
}