import { api } from "@/lib/api";

// Formato documental (solo admins): galeria de estilos y resumen del
// documental de un proyecto (creditos, capitulos, QC). Ver backend
// modules/projects/documental.service.ts.

export type DocumentalCategory = "historia" | "misterio" | "biografias" | "datos" | "geografia" | "general";

export interface DocumentalStyle {
  id: string;
  name: string;
  description: string;
  idealFor: string;
  examples: string[];
  category: DocumentalCategory;
  graphicsPerMinute: number;
  mood: string;
}

export interface DocumentalShotOutcome {
  sceneId: string;
  order: number;
  source: string;
  qa: string;
  provider?: string;
  rejected: number;
}

export interface DocumentalCredit {
  title: string | null;
  author: string | null;
  license: string | null;
  license_url: string | null;
  source: string | null;
  provider: string | null;
}

export interface RenderQc {
  black_segments: { start: number; end: number }[];
  frozen_segments: { start: number; end: number }[];
  integrated_lufs: number | null;
  true_peak_db: number | null;
  warnings: string[];
}

export interface DocumentalSummary {
  style: string | null;
  plan: {
    style: string;
    source: "montajista" | "heuristic";
    chapters: { titulo: string; desde: number; animo: string }[];
    issues: string[];
    shots: DocumentalShotOutcome[];
  } | null;
  credits: DocumentalCredit[];
  creditsText: string;
  chaptersText: string;
  qc: RenderQc | null;
}

interface StyleRow {
  id: string;
  name: string;
  description: string;
  ideal_for: string;
  examples: string[];
  category: DocumentalCategory;
  graphics_per_minute: number;
  mood: string;
}

export const CATEGORY_LABELS: Record<DocumentalCategory, string> = {
  general: "General",
  historia: "Historia y guerra",
  misterio: "Misterio y sucesos",
  biografias: "Biografías",
  datos: "Datos y economía",
  geografia: "Geografía e ingeniería",
};

export const documentalService = {
  async listStyles(): Promise<DocumentalStyle[]> {
    const rows = await api.get<StyleRow[]>("/documental/styles");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      idealFor: r.ideal_for,
      examples: r.examples,
      category: r.category,
      graphicsPerMinute: r.graphics_per_minute,
      mood: r.mood,
    }));
  },

  async getSummary(projectId: string): Promise<DocumentalSummary> {
    const row = await api.get<{
      style: string | null;
      plan: DocumentalSummary["plan"];
      credits: DocumentalCredit[];
      credits_text: string;
      chapters_text: string;
      qc: RenderQc | null;
    }>(`/projects/${projectId}/documental`);
    return { style: row.style, plan: row.plan, credits: row.credits, creditsText: row.credits_text, chaptersText: row.chapters_text, qc: row.qc };
  },
};
