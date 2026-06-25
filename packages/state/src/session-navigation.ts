import type {
  WorkspaceSessionNavigationReadModel,
  WorkspaceSessionNavigationSectionId,
  WorkspaceSessionNavigationSectionState,
  WorkspaceSessionNavigationSummary,
} from "@svvy/core";

type WorkspaceSessionNavigationSectionOverrides = Partial<
  Record<WorkspaceSessionNavigationSectionId, WorkspaceSessionNavigationSectionState>
>;

function descendingTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return new Date(right ?? 0).getTime() - new Date(left ?? 0).getTime();
}

export function sortVisibleSessionsByRecency<Session extends { updatedAt: string }>(
  sessions: Session[],
): Session[] {
  return sessions.toSorted(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function buildWorkspaceSessionNavigation<Session extends WorkspaceSessionNavigationSummary>(
  sessions: Session[],
  collapsed = true,
  sectionOverrides: WorkspaceSessionNavigationSectionOverrides = {},
): WorkspaceSessionNavigationReadModel<Session> {
  const sections: WorkspaceSessionNavigationReadModel<Session>["sections"] = {
    pinned: sectionOverrides.pinned ?? {
      collapsed: false,
      sizePx: DEFAULT_SESSION_SECTION_SIZES.pinned,
    },
    active: sectionOverrides.active ?? {
      collapsed: false,
      sizePx: DEFAULT_SESSION_SECTION_SIZES.active,
    },
    archived: sectionOverrides.archived ?? {
      collapsed,
      sizePx: DEFAULT_SESSION_SECTION_SIZES.archived,
    },
  };

  return {
    pinnedSessions: sessions
      .filter((session) => session.isPinned && !session.isArchived)
      .toSorted((left, right) => descendingTimestamp(left.pinnedAt, right.pinnedAt)),
    activeSessions: sessions
      .filter((session) => !session.isPinned && !session.isArchived)
      .toSorted((left, right) => descendingTimestamp(left.updatedAt, right.updatedAt)),
    sections,
    archived: {
      collapsed,
      sessions: sessions
        .filter((session) => session.isArchived)
        .toSorted((left, right) => descendingTimestamp(left.archivedAt, right.archivedAt)),
    },
  };
}

export function flattenWorkspaceSessionNavigation<
  Session extends WorkspaceSessionNavigationSummary,
>(navigation: WorkspaceSessionNavigationReadModel<Session>): Session[] {
  return [
    ...navigation.pinnedSessions,
    ...navigation.activeSessions,
    ...navigation.archived.sessions,
  ];
}

export const DEFAULT_SESSION_SECTION_SIZES = {
  pinned: 150,
  active: 260,
  archived: 190,
} satisfies Record<WorkspaceSessionNavigationSectionId, number>;

export function getDefaultSessionNavigationSectionState(
  section: WorkspaceSessionNavigationSectionId,
): WorkspaceSessionNavigationSectionState {
  return {
    collapsed: section === "archived",
    sizePx: DEFAULT_SESSION_SECTION_SIZES[section],
  };
}
