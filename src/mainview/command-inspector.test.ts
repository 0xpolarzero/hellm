import { describe, expect, it } from "bun:test";
import type {
  WorkspaceCommandInspector,
  WorkspaceSessionSummary,
} from "../shared/workspace-contract";
import {
  getCommandArgumentSections,
  getCommandDiagnosticSections,
  getCommandInspectorSections,
  getCommandOutputSections,
  getCommandPatchSections,
  getCommandProgressSections,
  getCommandStdinOutcomeMessage,
  getCommandStdinSection,
  getVisibleCommandRollups,
  getWorkspaceCommandStatusPresentation,
  canWriteCommandStdin,
} from "./command-inspector";

function createSessionSummary(): WorkspaceSessionSummary {
  return {
    id: "session-1",
    title: "Inspector",
    preview: "Read docs and created 1 artifact.",
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    messageCount: 2,
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
    commandRollups: [
      {
        commandId: "command-parent",
        threadId: "thread-1",
        workflowRunId: null,
        toolName: "execute_typescript",
        visibility: "summary",
        status: "succeeded",
        title: "Inspect docs",
        summary: "Read docs and created 1 artifact.",
        stdin: {
          mode: "none",
          canAttemptWrite: false,
          acceptedWrites: [],
        },
        childCount: 2,
        summaryChildCount: 1,
        traceChildCount: 1,
        summaryChildren: [
          {
            commandId: "command-summary-child",
            toolName: "exec_command",
            status: "succeeded",
            title: "Create summary.md",
            summary: "Created summary.md.",
            error: null,
          },
        ],
        startedAt: "2026-04-10T10:04:00.000Z",
        updatedAt: "2026-04-10T10:05:00.000Z",
        finishedAt: "2026-04-10T10:05:00.000Z",
      },
    ],
  };
}

function createInspector(): WorkspaceCommandInspector {
  return {
    target: {
      surface: "orchestrator",
      workspaceSessionId: "session-1",
      surfacePiSessionId: "surface-1",
    } as WorkspaceCommandInspector["target"],
    acceptedArguments: null,
    commandId: "command-parent",
    threadId: "thread-1",
    workflowRunId: null,
    toolName: "execute_typescript",
    visibility: "summary",
    status: "succeeded",
    title: "Inspect docs",
    summary: "Read docs and created 1 artifact.",
    facts: {
      repoReads: 1,
      artifactsCreated: 1,
    },
    error: null,
    startedAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    finishedAt: "2026-04-10T10:05:00.000Z",
    artifacts: [],
    outputEvents: [
      {
        eventId: "event-stdout",
        at: "2026-04-10T10:04:00.000Z",
        stream: "stdout",
        source: "final-result",
        text: "ok\n",
      },
      {
        eventId: "event-stderr",
        at: "2026-04-10T10:04:01.000Z",
        stream: "stderr",
        source: "final-result",
        text: "warning\n",
      },
    ],
    stdin: {
      mode: "none",
      canAttemptWrite: false,
      acceptedWrites: [],
    },
    argumentSnapshots: [
      {
        eventId: "event-args",
        at: "2026-04-10T10:01:30.000Z",
        source: "accepted-arguments",
        arguments: {
          typescriptCode: "return 1",
        },
      },
    ],
    progressEvents: [
      {
        eventId: "event-progress",
        at: "2026-04-10T10:03:30.000Z",
        source: "svvyx-dispatch",
        phase: "succeeded",
        family: "workflows",
        command: "svvyx workflows list --json",
        facts: {
          workflowExportCount: 1,
        },
      },
    ],
    patchSnapshots: [
      {
        eventId: "event-patch",
        at: "2026-04-10T10:03:00.000Z",
        source: "accepted-arguments",
        files: [
          {
            path: "docs/summary.md",
            changeType: "created",
            additions: 8,
            deletions: 0,
          },
        ],
      },
    ],
    diagnostics: [
      {
        eventId: "event-diagnostics",
        at: "2026-04-10T10:02:30.000Z",
        source: "execute_typescript",
        stage: "typecheck",
        diagnostics: [
          {
            severity: "error",
            message: "Property missing",
            file: "execute-typescript.ts",
            line: 3,
            column: 12,
            code: "2339",
          },
        ],
      },
    ],
    childCount: 2,
    summaryChildCount: 1,
    traceChildCount: 1,
    summaryChildren: [
      {
        commandId: "command-summary-child",
        toolName: "exec_command",
        visibility: "summary",
        status: "succeeded",
        title: "Create summary.md",
        summary: "Created summary.md.",
        error: null,
        facts: {
          name: "summary.md",
        },
        startedAt: "2026-04-10T10:01:00.000Z",
        updatedAt: "2026-04-10T10:02:00.000Z",
        finishedAt: "2026-04-10T10:02:00.000Z",
        artifacts: [],
        outputEvents: [],
        stdin: {
          mode: "continuable",
          canAttemptWrite: false,
          acceptedWrites: [],
        },
        argumentSnapshots: [],
        progressEvents: [
          {
            eventId: "event-child-progress",
            at: "2026-04-10T10:01:30.000Z",
            source: "svvyx-dispatch",
            phase: "started",
            family: "artifacts",
            command: "svvyx artifacts list --json",
          },
        ],
        patchSnapshots: [],
        diagnostics: [],
      },
    ],
    traceChildren: [
      {
        commandId: "command-trace-child",
        toolName: "read",
        visibility: "trace",
        status: "succeeded",
        title: "Read docs/prd.md",
        summary: "Loaded docs/prd.md.",
        error: null,
        facts: {
          path: "docs/prd.md",
        },
        startedAt: "2026-04-10T10:00:30.000Z",
        updatedAt: "2026-04-10T10:00:40.000Z",
        finishedAt: "2026-04-10T10:00:40.000Z",
        artifacts: [],
        outputEvents: [],
        stdin: {
          mode: "none",
          canAttemptWrite: false,
          acceptedWrites: [],
        },
        argumentSnapshots: [],
        patchSnapshots: [],
        diagnostics: [],
      },
    ],
  };
}

describe("command inspector helpers", () => {
  it("keeps only parent command rollups in the top-level list", () => {
    const rollups = getVisibleCommandRollups(createSessionSummary());

    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({
      commandId: "command-parent",
      summaryChildCount: 1,
      traceChildCount: 1,
      summaryChildren: [
        expect.objectContaining({
          commandId: "command-summary-child",
        }),
      ],
    });
  });

  it("builds separate rollup and trace sections for the inspector", () => {
    const sections = getCommandInspectorSections(createInspector());

    expect(sections).toEqual([
      {
        id: "summary",
        title: "Rollup detail",
        description: "Summary-visible child commands that shape the parent rollup.",
        children: [
          expect.objectContaining({
            commandId: "command-summary-child",
            visibility: "summary",
          }),
        ],
      },
      {
        id: "trace",
        title: "Trace detail",
        description: "Nested trace commands available for deeper inspection only.",
        children: [
          expect.objectContaining({
            commandId: "command-trace-child",
            visibility: "trace",
          }),
        ],
      },
    ]);
  });

  it("preserves child command progress in inspector sections", () => {
    expect(getCommandInspectorSections(createInspector())[0]?.children[0]).toMatchObject({
      commandId: "command-summary-child",
      progressEvents: [
        {
          eventId: "event-child-progress",
          phase: "started",
          family: "artifacts",
          command: "svvyx artifacts list --json",
        },
      ],
    });
  });

  it("maps command status into stable UI copy", () => {
    expect(getWorkspaceCommandStatusPresentation("succeeded")).toEqual({
      label: "Succeeded",
      tone: "success",
    });
    expect(getWorkspaceCommandStatusPresentation("failed")).toEqual({
      label: "Failed",
      tone: "danger",
    });
    expect(getWorkspaceCommandStatusPresentation("waiting")).toEqual({
      label: "Waiting",
      tone: "info",
    });
    expect(getWorkspaceCommandStatusPresentation("streaming")).toEqual({
      label: "Streaming",
      tone: "warning",
    });
  });

  it("groups recovered command output by stream", () => {
    expect(getCommandOutputSections(createInspector())).toEqual([
      {
        id: "stdout",
        title: "Stdout",
        events: [
          {
            eventId: "event-stdout",
            at: "2026-04-10T10:04:00.000Z",
            stream: "stdout",
            source: "final-result",
            text: "ok\n",
          },
        ],
      },
      {
        id: "stderr",
        title: "Stderr",
        events: [
          {
            eventId: "event-stderr",
            at: "2026-04-10T10:04:01.000Z",
            stream: "stderr",
            source: "final-result",
            text: "warning\n",
          },
        ],
      },
    ]);
  });

  it("exposes stdin receipts and write actionability", () => {
    const inspector = {
      ...createInspector(),
      toolName: "exec_command",
      status: "running",
      stdin: {
        mode: "continuable",
        canAttemptWrite: true,
        acceptedWrites: [
          {
            eventId: "stdin-1",
            at: "2026-04-10T10:04:30.000Z",
            text: "yes\n",
            acceptedBytes: 4,
          },
        ],
      },
    } satisfies WorkspaceCommandInspector;

    expect(canWriteCommandStdin(inspector)).toBe(true);
    expect(getCommandStdinSection(inspector)).toEqual({
      id: "stdin",
      title: "Stdin",
      events: [
        {
          eventId: "stdin-1",
          at: "2026-04-10T10:04:30.000Z",
          text: "yes\n",
          acceptedBytes: 4,
        },
      ],
    });
  });

  it("explains every stdin submission outcome", () => {
    expect(
      getCommandStdinOutcomeMessage({
        commandId: "command-1",
        status: "accepted",
        acceptedBytes: 1,
      }),
    ).toBe("Accepted 1 byte of stdin.");
    expect(
      getCommandStdinOutcomeMessage({
        commandId: "command-1",
        status: "accepted",
        acceptedBytes: 4,
      }),
    ).toBe("Accepted 4 bytes of stdin.");
    expect(getCommandStdinOutcomeMessage({ commandId: "command-1", status: "stdin_closed" })).toBe(
      "Stdin is closed for this command.",
    );
    expect(getCommandStdinOutcomeMessage({ commandId: "command-1", status: "not_running" })).toBe(
      "This command is not running.",
    );
    expect(
      getCommandStdinOutcomeMessage({ commandId: "command-1", status: "already_terminal" }),
    ).toBe("This command has already finished.");
  });

  it("groups recovered command progress", () => {
    expect(getCommandProgressSections(createInspector())).toEqual([
      {
        id: "progress",
        title: "Progress",
        events: [
          {
            eventId: "event-progress",
            at: "2026-04-10T10:03:30.000Z",
            source: "svvyx-dispatch",
            phase: "succeeded",
            family: "workflows",
            command: "svvyx workflows list --json",
            facts: {
              workflowExportCount: 1,
            },
          },
        ],
      },
    ]);
  });

  it("groups recovered patch snapshots", () => {
    expect(getCommandPatchSections(createInspector())).toEqual([
      {
        id: "patch",
        title: "Patch preview",
        snapshots: [
          {
            eventId: "event-patch",
            at: "2026-04-10T10:03:00.000Z",
            source: "accepted-arguments",
            files: [
              {
                path: "docs/summary.md",
                changeType: "created",
                additions: 8,
                deletions: 0,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("groups recovered diagnostics", () => {
    expect(getCommandDiagnosticSections(createInspector())).toEqual([
      {
        id: "diagnostics",
        title: "Diagnostics",
        snapshots: [
          {
            eventId: "event-diagnostics",
            at: "2026-04-10T10:02:30.000Z",
            source: "execute_typescript",
            stage: "typecheck",
            diagnostics: [
              {
                severity: "error",
                message: "Property missing",
                file: "execute-typescript.ts",
                line: 3,
                column: 12,
                code: "2339",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("groups recovered command argument snapshots", () => {
    expect(getCommandArgumentSections(createInspector())).toEqual([
      {
        id: "arguments",
        title: "Argument snapshots",
        snapshots: [
          {
            eventId: "event-args",
            at: "2026-04-10T10:01:30.000Z",
            source: "accepted-arguments",
            arguments: {
              typescriptCode: "return 1",
            },
          },
        ],
      },
    ]);
  });
});
