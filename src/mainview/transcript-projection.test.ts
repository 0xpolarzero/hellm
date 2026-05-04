import { describe, expect, it } from "bun:test";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  WorkspaceCommandRollup,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
} from "../shared/workspace-contract";
import {
  buildTranscriptSemanticBlocks,
  summarizeExecuteTypescriptResult,
} from "./transcript-projection";

function commandRollup(commandId = "command-1"): WorkspaceCommandRollup {
  return {
    commandId,
    threadId: null,
    toolName: "execute_typescript",
    visibility: "summary",
    status: "succeeded",
    title: "Run execute_typescript",
    summary: "Read docs and ran tests.",
    childCount: 2,
    summaryChildCount: 1,
    traceChildCount: 1,
    summaryChildren: [
      {
        commandId: "child-1",
        toolName: "api.bash",
        status: "succeeded",
        title: "Run bun test",
        summary: "Tests passed.",
        error: null,
      },
    ],
    updatedAt: "2026-04-29T10:00:00.000Z",
  };
}

function sessionWithWait(): WorkspaceSessionSummary {
  return {
    id: "session-1",
    title: "Transcript",
    preview: "Waiting on approval.",
    createdAt: "2026-04-29T09:00:00.000Z",
    updatedAt: "2026-04-29T10:00:00.000Z",
    messageCount: 4,
    status: "waiting",
    isPinned: false,
    pinnedAt: null,
    isArchived: false,
    archivedAt: null,
    wait: {
      threadId: "thread-1",
      kind: "approval",
      reason: "Approve package install.",
      resumeWhen: "Approval is granted.",
      since: "2026-04-29T09:30:00.000Z",
    },
  };
}

function handlerThread(): WorkspaceHandlerThreadSummary {
  return {
    threadId: "thread-1",
    surfacePiSessionId: "surface-thread-1",
    title: "CI handler",
    objective: "Run Project CI.",
    status: "completed",
    wait: null,
    startedAt: "2026-04-29T09:00:00.000Z",
    updatedAt: "2026-04-29T10:00:00.000Z",
    finishedAt: "2026-04-29T10:00:00.000Z",
    commandCount: 1,
    workflowRunCount: 1,
    episodeCount: 1,
    artifactCount: 0,
    ciRunCount: 1,
    loadedContextKeys: ["ci"],
    latestWorkflowRun: null,
    latestCiRun: null,
    latestEpisode: {
      episodeId: "episode-1",
      kind: "workflow",
      title: "CI passed",
      summary: "All required checks passed.",
      createdAt: "2026-04-29T10:00:00.000Z",
    },
  };
}

describe("transcript projection", () => {
  it("builds semantic wait, failure, command, and handoff blocks from read models", () => {
    const blocks = buildTranscriptSemanticBlocks({
      session: sessionWithWait(),
      errorMessage: "Latest turn failed.",
      commandRollups: [commandRollup()],
      handlerThreads: [handlerThread()],
    });

    expect(blocks.map((block) => block.kind)).toEqual([
      "wait",
      "failure",
      "command-rollup",
      "thread",
      "handoff-episode",
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "wait",
      reason: "Approve package install.",
    });
    expect(blocks[2]).toMatchObject({
      kind: "command-rollup",
      command: { summaryChildCount: 1, traceChildCount: 1 },
    });
  });

  it("summarizes execute_typescript result diagnostics and logs", () => {
    const message = {
      role: "toolResult",
      toolCallId: "tool-call-1",
      toolName: "execute_typescript",
      timestamp: 1,
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            logs: ["[log] compiling"],
            error: {
              message: "Type error",
              stage: "typecheck",
              diagnostics: [
                {
                  severity: "error",
                  message: "Property missing",
                  file: "src/app.ts",
                  line: 12,
                  column: 4,
                },
              ],
            },
          }),
        },
      ],
    } satisfies ToolResultMessage;

    expect(summarizeExecuteTypescriptResult(message)).toEqual({
      success: false,
      resultPreview: null,
      logs: ["[log] compiling"],
      diagnostics: [
        {
          severity: "error",
          message: "Property missing",
          file: "src/app.ts",
          line: 12,
          column: 4,
          code: undefined,
        },
      ],
      error: {
        message: "Type error",
        name: undefined,
        stage: "typecheck",
        line: undefined,
      },
    });
  });

  it("falls back to raw output for non-json execute_typescript results", () => {
    const message = {
      role: "toolResult",
      toolCallId: "tool-call-1",
      toolName: "execute_typescript",
      timestamp: 1,
      isError: true,
      content: [{ type: "text", text: "runtime crashed" }],
    } satisfies ToolResultMessage;

    expect(summarizeExecuteTypescriptResult(message)).toMatchObject({
      success: false,
      resultPreview: "runtime crashed",
      error: { message: "runtime crashed" },
    });
  });
});
