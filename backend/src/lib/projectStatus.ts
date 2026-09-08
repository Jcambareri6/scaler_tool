import { supabase } from "./supabase.js";
import type { JobStatus, ProjectStatus } from "../types/shared/typeShared.js";

// AWAITING_STOCK_REVIEW es el unico estado "en curso" donde el pipeline no
// esta trabajando activamente -- esta pausado esperando al usuario, por eso
// mapea a IN_PROGRESS en vez de GENERATING (todos los demas estados no
// terminales SI son trabajo activo del pipeline).
function mapJobStatusToProjectStatus(jobStatus: JobStatus): ProjectStatus {
  if (jobStatus === "COMPLETED") return "DONE";
  if (jobStatus === "FAILED") return "ERROR";
  if (jobStatus === "AWAITING_STOCK_REVIEW") return "IN_PROGRESS";
  return "GENERATING";
}

// video_projects.status quedaba congelado en DRAFT para siempre porque
// ningun codigo lo actualizaba despues de crear el proyecto (ver LEEME /
// conversacion: el Dashboard lee este campo para el badge y los contadores
// de "en progreso"/"terminados", pero nada lo escribia nunca). Se llama
// cada vez que cambia jobs.status, en el mismo lugar donde se escribe ese
// cambio -- ver orchestrator.ts::setJobStatus, job.service.ts y
// pipeline.service.ts.
export async function syncProjectStatus(videoProjectId: string, jobStatus: JobStatus): Promise<void> {
  const status = mapJobStatusToProjectStatus(jobStatus);
  const { error } = await supabase.from("video_projects").update({ status }).eq("id", videoProjectId);
  if (error) throw new Error(error.message);
}
