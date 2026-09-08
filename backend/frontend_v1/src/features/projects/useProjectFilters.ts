import { useMemo, useState } from "react";
import type { ProjectStatus, VideoProject } from "@/types";

// Filtro por nombre + estado hoy. Diseñado para sumar `channel` despues
// (cuando exista `VideoProject.channelId`) sin romper esto: agregar el
// campo al tipo de abajo, un input mas en el componente que arma los
// filtros, y una linea mas en el predicate de `filtered` -- nada de lo
// existente cambia de forma.
export interface ProjectFiltersState {
  search: string;
  status: ProjectStatus | "ALL";
}

const DEFAULT_FILTERS: ProjectFiltersState = { search: "", status: "ALL" };

export function useProjectFilters(projects: VideoProject[]) {
  const [filters, setFilters] = useState<ProjectFiltersState>(DEFAULT_FILTERS);

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return projects.filter((project) => {
      if (filters.status !== "ALL" && project.status !== filters.status) return false;
      if (query && !project.title.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [projects, filters]);

  return { filters, setFilters, filtered };
}
