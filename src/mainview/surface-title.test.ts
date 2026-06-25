import { describe, expect, it } from "bun:test";
import type { WorkspaceSessionSummary } from "../shared/workspace-contract";
import { getSurfaceDisplayTitle } from "./surface-title";

function session(input: Partial<WorkspaceSessionSummary> = {}): WorkspaceSessionSummary {
  return {
    id: "session-1",
    title: "New orchestrator",
    preview: "",
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    messageCount: 0,
    status: "idle",
    isPinned: false,
    pinnedAt: null,
    isArchived: false,
    archivedAt: null,
    isUnread: false,
    unreadAt: null,
    unreadReason: null,
    lastReadAt: null,
    wait: null,
    counts: {
      turns: 0,
      threads: 0,
      commands: 0,
      episodes: 0,
      workflows: 0,
      artifacts: 0,
      events: 0,
    },
    threadIdsByStatus: {
      runningHandler: [],
      runningWorkflow: [],
      waiting: [],
      troubleshooting: [],
    },
    threadIds: [],
    ...input,
  };
}

describe("surface display titles", () => {
  it("uses handler thread titles instead of the parent session title", () => {
    const sessions = [
      session({
        title: "New orchestrator",
        sidebarThreads: [
          {
            threadId: "thread-1",
            surfacePiSessionId: "pi-thread-1",
            title: "Investigate handler pane state",
            objective: "Investigate handler pane state",
            status: "idle",
            subtitle: null,
            latestCommandRollup: null,
            updatedAt: "2026-05-14T00:00:00.000Z",
            workflows: [],
          },
        ],
      }),
    ];

    expect(
      getSurfaceDisplayTitle(
        {
          workspaceSessionId: "session-1",
          surface: "handler",
          surfacePiSessionId: "pi-thread-1",
          threadId: "thread-1",
        },
        sessions,
        "New orchestrator",
      ),
    ).toBe("Investigate handler pane state");
  });

  it("uses orchestrator session titles for orchestrator surfaces", () => {
    expect(
      getSurfaceDisplayTitle(
        {
          workspaceSessionId: "session-1",
          surface: "orchestrator",
          surfacePiSessionId: "session-1",
        },
        [session({ title: "Parser Fix" })],
        "Surface",
      ),
    ).toBe("Parser Fix");
  });
});
