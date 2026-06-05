import { useProjectStore } from "./projectStore";
import type { Project } from "./Project";

export type ProjectsView = {
  projects: Project[];
  current: Project;
  setCurrent: (id: string) => void;
};

/** Convenience selector over the project store: list + resolved current. */
export function useProjects(): ProjectsView {
  const projects = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const setCurrent = useProjectStore((s) => s.setCurrentProject);
  const current = projects.find((p) => p.id === currentProjectId) ?? projects[0];
  return { projects, current, setCurrent };
}
