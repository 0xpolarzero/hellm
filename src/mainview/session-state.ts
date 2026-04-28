import type { WorkspaceSessionNavigationReadModel, WorkspaceSessionSummary } from "../shared/workspace-contract";

function descendingTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return new Date(right ?? 0).getTime() - new Date(left ?? 0).getTime();
}

export function sortVisibleSessionsByRecency(
  sessions: WorkspaceSessionSummary[],
): WorkspaceSessionSummary[] {
  return sessions.toSorted(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function buildWorkspaceSessionNavigation(
  sessions: WorkspaceSessionSummary[],
  collapsed = true,
): WorkspaceSessionNavigationReadModel {
  return {
    pinnedSessions: sessions
      .filter((session) => session.isPinned && !session.isArchived)
      .toSorted((left, right) => descendingTimestamp(left.pinnedAt, right.pinnedAt)),
    activeSessions: sessions
      .filter((session) => !session.isPinned && !session.isArchived)
      .toSorted((left, right) => descendingTimestamp(left.updatedAt, right.updatedAt)),
    archived: {
      collapsed,
      sessions: sessions
        .filter((session) => session.isArchived)
        .toSorted((left, right) => descendingTimestamp(left.archivedAt, right.archivedAt)),
    },
  };
}

export function flattenWorkspaceSessionNavigation(
  navigation: WorkspaceSessionNavigationReadModel,
): WorkspaceSessionSummary[] {
  return [
    ...navigation.pinnedSessions,
    ...navigation.activeSessions,
    ...navigation.archived.sessions,
  ];
}
