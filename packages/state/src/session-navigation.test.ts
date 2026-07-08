import { describe, expect, it } from "bun:test";

import {
  DEFAULT_SESSION_SECTION_SIZES,
  buildWorkspaceSessionNavigation,
  flattenWorkspaceSessionNavigation,
  getDefaultSessionNavigationSectionState,
  sortVisibleSessionsByRecency,
} from "./session-navigation";

interface TestWorkspaceSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  isPinned: boolean;
  pinnedAt: string | null;
  isArchived: boolean;
  archivedAt: string | null;
}

function session(
  overrides: Partial<TestWorkspaceSessionSummary> &
    Pick<TestWorkspaceSessionSummary, "id" | "title">,
): TestWorkspaceSessionSummary {
  return {
    id: overrides.id,
    title: overrides.title,
    updatedAt: overrides.updatedAt ?? "2026-04-10T10:00:00.000Z",
    isPinned: overrides.isPinned ?? false,
    pinnedAt: overrides.pinnedAt ?? null,
    isArchived: overrides.isArchived ?? false,
    archivedAt: overrides.archivedAt ?? null,
  };
}

describe("sortVisibleSessionsByRecency", () => {
  it("returns sessions sorted by most recent update", () => {
    const input = [
      session({ id: "oldest", title: "Oldest", updatedAt: "2026-04-10T10:02:00.000Z" }),
      session({ id: "newest", title: "Newest", updatedAt: "2026-04-10T10:05:00.000Z" }),
      session({ id: "middle", title: "Middle", updatedAt: "2026-04-10T10:03:00.000Z" }),
    ];

    const sessions = sortVisibleSessionsByRecency(input);

    expect(sessions.map((item) => item.id)).toEqual(["newest", "middle", "oldest"]);
    expect(input.map((item) => item.id)).toEqual(["oldest", "newest", "middle"]);
  });
});

describe("session navigation section defaults", () => {
  it("returns stable default section state", () => {
    expect(DEFAULT_SESSION_SECTION_SIZES).toEqual({
      pinned: 150,
      active: 260,
      archived: 190,
    });
    expect(getDefaultSessionNavigationSectionState("pinned")).toEqual({
      collapsed: false,
      sizePx: 150,
    });
    expect(getDefaultSessionNavigationSectionState("active")).toEqual({
      collapsed: false,
      sizePx: 260,
    });
    expect(getDefaultSessionNavigationSectionState("archived")).toEqual({
      collapsed: true,
      sizePx: 190,
    });
  });
});

describe("buildWorkspaceSessionNavigation", () => {
  it("groups pinned, active, and archived sessions with stable sort order", () => {
    const navigation = buildWorkspaceSessionNavigation(
      [
        session({
          id: "active-old",
          title: "Active Old",
          updatedAt: "2026-04-10T10:01:00.000Z",
        }),
        session({
          id: "pinned-old",
          title: "Pinned Old",
          isPinned: true,
          pinnedAt: "2026-04-10T10:02:00.000Z",
          updatedAt: "2026-04-10T10:09:00.000Z",
        }),
        session({
          id: "archived-new",
          title: "Archived New",
          isArchived: true,
          archivedAt: "2026-04-10T10:08:00.000Z",
        }),
        session({
          id: "active-new",
          title: "Active New",
          updatedAt: "2026-04-10T10:07:00.000Z",
        }),
        session({
          id: "pinned-new",
          title: "Pinned New",
          isPinned: true,
          pinnedAt: "2026-04-10T10:06:00.000Z",
        }),
        session({
          id: "archived-old",
          title: "Archived Old",
          isArchived: true,
          archivedAt: "2026-04-10T10:03:00.000Z",
        }),
      ],
      false,
    );

    expect(navigation.pinnedSessions.map((item) => item.id)).toEqual(["pinned-new", "pinned-old"]);
    expect(navigation.activeSessions.map((item) => item.id)).toEqual(["active-new", "active-old"]);
    expect(navigation.sections).toEqual({
      pinned: { collapsed: false, sizePx: 150 },
      active: { collapsed: false, sizePx: 260 },
      archived: { collapsed: false, sizePx: 190 },
    });
    expect(navigation.archived.collapsed).toBe(false);
    expect(navigation.archived.sessions.map((item) => item.id)).toEqual([
      "archived-new",
      "archived-old",
    ]);
  });

  it("uses the archived section state as the archived collapsed value", () => {
    const navigation = buildWorkspaceSessionNavigation(
      [session({ id: "archived", title: "Archived", isArchived: true })],
      true,
      {
        archived: {
          collapsed: false,
          sizePx: 144,
        },
      },
    );

    expect(navigation.sections.archived).toEqual({
      collapsed: false,
      sizePx: 144,
    });
    expect(navigation.archived.collapsed).toBe(false);
  });

  it("flattens grouped sessions without mutating the source order", () => {
    const input = [
      session({ id: "active", title: "Active", updatedAt: "2026-04-10T10:05:00.000Z" }),
      session({
        id: "pinned",
        title: "Pinned",
        isPinned: true,
        pinnedAt: "2026-04-10T10:06:00.000Z",
      }),
      session({
        id: "archived",
        title: "Archived",
        isArchived: true,
        archivedAt: "2026-04-10T10:07:00.000Z",
      }),
    ];

    const navigation = buildWorkspaceSessionNavigation(input);

    expect(flattenWorkspaceSessionNavigation(navigation).map((item) => item.id)).toEqual([
      "pinned",
      "active",
      "archived",
    ]);
    expect(input.map((item) => item.id)).toEqual(["active", "pinned", "archived"]);
  });
});
