import { describe, expect, it } from "bun:test";
import type {
  WorkspaceCommandInspector,
  WorkspaceSessionSummary,
} from "../shared/workspace-contract";
import {
  getCommandInspectorSections,
  getVisibleCommandRollups,
  getWorkspaceCommandStatusPresentation,
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
        childCount: 2,
        summaryChildCount: 1,
        traceChildCount: 1,
        summaryChildren: [
          {
            commandId: "command-summary-child",
            toolName: "artifact.write_text",
            status: "succeeded",
            title: "Create summary.md",
            summary: "Created summary.md.",
            error: null,
          },
        ],
        updatedAt: "2026-04-10T10:05:00.000Z",
      },
    ],
  };
}

function createInspector(): WorkspaceCommandInspector {
  return {
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
    childCount: 2,
    summaryChildCount: 1,
    traceChildCount: 1,
    summaryChildren: [
      {
        commandId: "command-summary-child",
        toolName: "artifact.write_text",
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
      tone: "warning",
    });
  });
});
