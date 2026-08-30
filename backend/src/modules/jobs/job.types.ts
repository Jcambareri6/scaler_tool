import type { Job, JobStatus } from "../../types/shared/typeShared.js";

export type { Job, JobStatus };

export interface CreateJobInput {
  type: string;
}

export interface UpdateJobInput {
  status?: JobStatus;
  progress?: number;
  error?: string | null;
}
