import { api, ApiError } from "@/lib/api";
import { mapProject, mapScript, mapScene, mapJob, mapAsset } from "@/lib/mappers";
import type { VideoProject, Script, Scene, Job, Asset } from "@/types";

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

export const projectsService = {
  async getProjects(): Promise<VideoProject[]> {
    const rows = await api.get<Parameters<typeof mapProject>[0][]>("/projects");
    return rows.map(mapProject);
  },

  async getProjectById(id: string): Promise<VideoProject | null> {
    try {
      const row = await api.get<Parameters<typeof mapProject>[0]>(`/projects/${id}`);
      return mapProject(row);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  async createProject(title: string, description?: string, scriptStyleId?: string): Promise<VideoProject> {
    const row = await api.post<Parameters<typeof mapProject>[0]>("/projects", {
      title,
      description,
      ...(scriptStyleId ? { script_style_id: scriptStyleId } : {}),
    });
    return mapProject(row);
  },

  async updateProject(id: string, updates: Partial<VideoProject>): Promise<VideoProject | null> {
    const body: Record<string, unknown> = {};
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.description !== undefined) body.description = updates.description;
    if (updates.status !== undefined) body.status = updates.status.toLowerCase();
    // "" (Sin estilo) tiene que desenlazar el proyecto -- se manda null
    // explicito, no se omite el campo (a diferencia del resto, donde
    // undefined = "no tocar este campo").
    if (updates.scriptStyleId !== undefined) body.script_style_id = updates.scriptStyleId || null;

    try {
      const row = await api.patch<Parameters<typeof mapProject>[0]>(`/projects/${id}`, body);
      return mapProject(row);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  // El backend no tiene status en scripts todavia — mapScript siempre
  // devuelve "DRAFT" (ver lib/mappers.ts).
  async getScript(projectId: string): Promise<Script | null> {
    try {
      const row = await api.get<Parameters<typeof mapScript>[0]>(`/projects/${projectId}/script`);
      return mapScript(row);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  async saveScript(projectId: string, content: string): Promise<Script> {
    try {
      const row = await api.patch<Parameters<typeof mapScript>[0]>(`/projects/${projectId}/script`, {
        content: { text: content },
      });
      return mapScript(row);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      const row = await api.post<Parameters<typeof mapScript>[0]>(`/projects/${projectId}/script`, {
        content: { text: content },
      });
      return mapScript(row);
    }
  },

  // Las scenes cuelgan de un script (no directo del proyecto) en el
  // backend, asi que primero resolvemos el script_id.
  async getScenes(projectId: string): Promise<Scene[]> {
    const script = await this.getScript(projectId);
    if (!script) return [];
    const rows = await api.get<Parameters<typeof mapScene>[0][]>(`/scripts/${script.id}/scenes`);
    return rows.map((row) => mapScene(row, projectId));
  },

  // El mas reciente es el primero (el backend ya ordena por created_at desc).
  async getJob(projectId: string): Promise<Job | null> {
    const rows = await api.get<Parameters<typeof mapJob>[0][]>(`/projects/${projectId}/jobs`);
    return rows.length > 0 ? mapJob(rows[0]!) : null;
  },

  // Crea el Job y corre runPreRenderPipeline de punta a punta (motor
  // deterministico, no el Agent — ver pipeline/orchestrator.ts). La
  // request queda bloqueada hasta que el pipeline llega a
  // AWAITING_STOCK_REVIEW o falla; no hay ejecucion en background todavia.
  async runPipeline(projectId: string): Promise<Job> {
    const row = await api.post<Parameters<typeof mapJob>[0]>(`/projects/${projectId}/pipeline/run`);
    return mapJob(row);
  },

  async approveStockReview(jobId: string): Promise<Job> {
    const row = await api.post<Parameters<typeof mapJob>[0]>(`/jobs/${jobId}/approve-stock-review`);
    return mapJob(row);
  },

  // Assets de stock elegidos por escena (metadata.kind === "stock_preview",
  // ver pipeline/orchestrator.ts::selectStockForScene). Se usan tanto para
  // la revision del gate humano (AWAITING_STOCK_REVIEW) como para mostrar
  // el clip real ya elegido en la pestana Scenes.
  async getStockPreviewAssets(projectId: string): Promise<Asset[]> {
    const rows = await api.get<Parameters<typeof mapAsset>[0][]>(`/projects/${projectId}/assets`);
    return rows.map(mapAsset).filter((asset) => asset.metadata?.kind === "stock_preview");
  },

  // Repromptea el stock de UNA escena (scene.service.ts::regenerateSceneVisual):
  // vuelve a buscar en Pexels/Pixabay con `prompt` (o el texto de la escena
  // si no se manda) y reemplaza el Asset ya elegido, evitando repetirlo.
  async regenerateSceneVisual(sceneId: string, prompt?: string): Promise<Asset> {
    const row = await api.post<Parameters<typeof mapAsset>[0]>(`/scenes/${sceneId}/regenerate-visual`, {
      ...(prompt ? { prompt } : {}),
    });
    return mapAsset(row);
  },

  // Ejecuta la Tool generate_script (mismo path que usaria el Agent via
  // /tools) y despues relee el Script persistido — executeTool devuelve
  // { output } de la Tool, no la fila de scripts. Los campos de `options`
  // solo importan cuando se manda `scriptStyleId` (Fase 1 — Prompt Maestro
  // por canal, ver generateScript.tool.ts::buildStyledUserPrompt).
  async generateScript(
    projectId: string,
    idea: string,
    options?: {
      targetDuration?: number;
      provider?: "openai" | "anthropic";
      scriptStyleId?: string;
      title?: string;
      thumbnailDescription?: string;
      approxChars?: number;
      referenceScript?: string;
      keyPoints?: string;
    }
  ): Promise<Script> {
    await api.post(`/tools/generate_script/execute`, {
      input: {
        video_project_id: projectId,
        idea,
        ...(options?.targetDuration ? { target_duration: options.targetDuration } : {}),
        ...(options?.provider ? { provider: options.provider } : {}),
        ...(options?.scriptStyleId ? { script_style_id: options.scriptStyleId } : {}),
        ...(options?.title ? { title: options.title } : {}),
        ...(options?.thumbnailDescription
          ? { thumbnail_description: options.thumbnailDescription }
          : {}),
        ...(options?.approxChars ? { approx_chars: options.approxChars } : {}),
        ...(options?.referenceScript ? { reference_script: options.referenceScript } : {}),
        ...(options?.keyPoints ? { key_points: options.keyPoints } : {}),
      },
    });
    const script = await this.getScript(projectId);
    if (!script) throw new Error("generate_script no devolvio un guion");
    return script;
  },
};
