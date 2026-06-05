import { create } from "zustand";
import type { Project } from "./Project";
import { mockProjects } from "./mockProjects";

type ProjectState = {
  projects: Project[];
  currentProjectId: string;
  setCurrentProject: (id: string) => void;
};

/**
 * Holds the project list and the current selection. SEAM: seeded from
 * `mockProjects`; swap the initializer for the control-plane projects RPC and
 * every consumer keeps working.
 */
export const useProjectStore = create<ProjectState>((set) => ({
  projects: mockProjects,
  currentProjectId: mockProjects[0].id,
  setCurrentProject: (id) => set({ currentProjectId: id }),
}));
