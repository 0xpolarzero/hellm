import { describe, expect, it } from "bun:test";
import { buildWorkspaceSessionNavigation, sortVisibleSessionsByRecency } from "./session-state";
import type { WorkspaceSessionSummary } from "./chat-rpc";

function session(
  overrides: Partial<WorkspaceSessionSummary> & Pick<WorkspaceSessionSummary, "id" | "title">,
): WorkspaceSessionSummary {
  return {
    id: overrides.id,
    title: overrides.title,
    preview: overrides.preview ?? "",
    createdAt: overrides.createdAt ?? "2026-04-10T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-10T10:00:00.000Z",
    messageCount: overrides.messageCount ?? 0,
    status: overrides.status ?? "idle",
    isPinned: overrides.isPinned ?? false,
    pinnedAt: overrides.pinnedAt ?? null,
    isArchived: overrides.isArchived ?? false,
    archivedAt: overrides.archivedAt ?? null,
    sessionFile: overrides.sessionFile,
    parentSessionId: overrides.parentSessionId,
    parentSessionFile: overrides.parentSessionFile,
    modelId: overrides.modelId,
    provider: overrides.provider,
    thinkingLevel: overrides.thinkingLevel,
  };
}

describe("sortVisibleSessionsByRecency", () => {
  it("returns sessions sorted by most recent update", () => {
    const sessions = sortVisibleSessionsByRecency([
      session({ id: "oldest", title: "Oldest", updatedAt: "2026-04-10T10:02:00.000Z" }),
      session({ id: "newest", title: "Newest", updatedAt: "2026-04-10T10:05:00.000Z" }),
      session({ id: "middle", title: "Middle", updatedAt: "2026-04-10T10:03:00.000Z" }),
    ]);

    expect(sessions.map((item) => item.id)).toEqual(["newest", "middle", "oldest"]);
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
    expect(navigation.archived.collapsed).toBe(false);
    expect(navigation.archived.sessions.map((item) => item.id)).toEqual([
      "archived-new",
      "archived-old",
    ]);
  });
});
