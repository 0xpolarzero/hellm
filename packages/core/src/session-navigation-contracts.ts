export type WorkspaceSessionNavigationSectionId = "pinned" | "active" | "archived";

export interface WorkspaceSessionNavigationSectionState {
  collapsed: boolean;
  sizePx: number;
}

export interface WorkspaceSessionNavigationSummary {
  isPinned: boolean;
  pinnedAt: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  updatedAt: string;
}

export interface WorkspaceSessionNavigationReadModel<
  Session extends WorkspaceSessionNavigationSummary = WorkspaceSessionNavigationSummary,
> {
  pinnedSessions: Session[];
  activeSessions: Session[];
  sections: Record<WorkspaceSessionNavigationSectionId, WorkspaceSessionNavigationSectionState>;
  archived: {
    collapsed: boolean;
    sessions: Session[];
  };
}
