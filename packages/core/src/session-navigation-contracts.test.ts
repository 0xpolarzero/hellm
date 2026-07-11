import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownSessionNavigationReadModelExit,
  encodeSessionNavigationReadModelExit,
} from "./session-navigation-contracts";

const at = "2026-07-11T10:00:00.000Z";

const commandRollup = {
  commandId: "command_navigation",
  threadId: "thread_navigation",
  workflowRunId: "workflow_navigation",
  workflowTaskAttemptId: null,
  toolName: "exec_command",
  visibility: "surface",
  status: "running",
  title: "Run workflow",
  summary: "Workflow is running.",
  arguments: { cmd: "bunx smithers-orchestrator run workflow.tsx" },
  facts: { commandFamily: "smithers" },
  error: null,
  artifacts: [],
  outputEvents: [],
  stdin: { mode: "none", canAttemptWrite: false, acceptedWrites: [] },
  argumentSnapshots: [],
  patchSnapshots: [],
  diagnostics: [],
  childCount: 0,
  summaryChildCount: 0,
  traceChildCount: 0,
  summaryChildren: [],
  startedAt: at,
  updatedAt: at,
  finishedAt: null,
} as const;

const detailedReadModel = {
  pinnedSessions: [],
  activeSessions: [
    {
      id: "session_navigation",
      parentSessionId: "session_parent",
      title: "Inspect navigation",
      preview: "Workflow is running.",
      createdAt: at,
      updatedAt: at,
      messageCount: 2,
      status: "running",
      isPinned: false,
      pinnedAt: null,
      isArchived: false,
      archivedAt: null,
      isUnread: true,
      unreadAt: at,
      unreadReason: "manual",
      lastReadAt: null,
      provider: "openai",
      modelId: "gpt-5",
      thinkingLevel: "high",
      wait: null,
      counts: {
        turns: 2,
        threads: 1,
        commands: 1,
        episodes: 0,
        workflows: 1,
        artifacts: 0,
        events: 1,
      },
      threadIdsByStatus: {
        runningHandler: [],
        runningWorkflow: ["thread_navigation"],
        waiting: [],
        troubleshooting: [],
      },
      threadIds: ["thread_navigation"],
      sidebarThreads: [
        {
          threadId: "thread_navigation",
          surfacePiSessionId: "surface_navigation",
          title: "Run workflow",
          objective: "Run the workflow.",
          status: "running-workflow",
          subtitle: { badge: "workflow", text: "Workflow is running.", tone: "muted" },
          latestCommandRollup: commandRollup,
          updatedAt: at,
          workflows: [
            {
              workflowRunId: "workflow_navigation",
              workflowName: "navigation_fixture",
              status: "running",
              subtitle: { badge: "workflow", text: "Workflow is running.", tone: "muted" },
              updatedAt: at,
            },
          ],
        },
      ],
      commandRollups: [commandRollup],
      productEvents: [
        {
          eventId: "event_navigation",
          at,
          title: "Extension change reverted",
          summary: "The extension change was reverted.",
          subject: { kind: "session", id: "session_navigation" },
          details: { extensionId: "shell" },
        },
      ],
      titleGeneration: {
        status: "pending",
        renameLocked: true,
        autoFrozen: false,
        manualOverride: false,
        triggeredAt: at,
        finishedAt: null,
        error: null,
      },
    },
  ],
  sections: {
    pinned: { collapsed: false, sizePx: 150 },
    active: { collapsed: false, sizePx: 260 },
    archived: { collapsed: true, sizePx: 190 },
  },
  archived: { collapsed: true, sessions: [] },
} as const;

describe("session navigation renderer contract", () => {
  it("round-trips every durable renderer-consumed session navigation field", () => {
    const decoded = decodeUnknownSessionNavigationReadModelExit(detailedReadModel);

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeSessionNavigationReadModelExit(decoded.value)).toEqual(decoded);
    }
  });

  it("rejects non-contract lifecycle values and pi session-file lineage fields", () => {
    const invalidWorkflowStatus = {
      ...detailedReadModel,
      activeSessions: detailedReadModel.activeSessions.map((session) => ({
        ...session,
        sidebarThreads: session.sidebarThreads.map((thread) => ({
          ...thread,
          workflows: thread.workflows.map((workflow) => ({ ...workflow, status: "paused" })),
        })),
      })),
    };
    const sessionFileLeak = {
      ...detailedReadModel,
      activeSessions: detailedReadModel.activeSessions.map((session) => ({
        ...session,
        sessionFile: "/tmp/session.jsonl",
      })),
    };

    expect(Exit.isFailure(decodeUnknownSessionNavigationReadModelExit(invalidWorkflowStatus))).toBe(
      true,
    );
    expect(Exit.isFailure(decodeUnknownSessionNavigationReadModelExit(sessionFileLeak))).toBe(true);
  });

  it("carries renderer-safe fork lineage without exposing pi session paths", () => {
    const decoded = decodeUnknownSessionNavigationReadModelExit(detailedReadModel);

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(String(decoded.value.activeSessions[0]?.parentSessionId)).toBe("session_parent");
      expect("parentSessionFile" in decoded.value.activeSessions[0]!).toBe(false);
    }
  });
});
