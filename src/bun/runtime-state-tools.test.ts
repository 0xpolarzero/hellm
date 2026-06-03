import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import {
  createThreadCurrentTool,
  createThreadHandoffsTool,
  createThreadListTool,
} from "./runtime-state-tools";
import { createStructuredSessionStateStore } from "./structured-session-state";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("thread state tools", () => {
  it("fails thread_current outside a handler and returns compact current handler state inside a handler", async () => {
    const { runtime, store, thread, workflow } = createRuntimeFixture();
    const tool = createThreadCurrentTool({ runtime, store });

    runtime.current = {
      ...runtime.current!,
      surfaceKind: "orchestrator",
      surfaceThreadId: null,
      rootThreadId: null,
    };
    await expect(
      tool.execute("tool-call-1", {}).then(
        () => null,
        (error) => (error as Error).message,
      ),
    ).resolves.toContain("handler thread");

    runtime.current = {
      ...runtime.current!,
      surfaceKind: "handler",
      surfaceThreadId: thread.id,
      rootThreadId: thread.id,
    };
    const result = await tool.execute("tool-call-2", {});

    expect(result.details).toEqual({
      id: thread.id,
      title: "Investigate Runtime Tools",
      objective: "Inspect runtime state without prompt stuffing.",
      status: "waiting",
      wait: {
        kind: "external",
        reason: "Waiting for workflow signal.",
        resumeWhen: "Signal arrives.",
      },
      loadedContextKeys: ["ci"],
      activeWorkflowRunIds: [workflow.smithersRunId],
      latestHandoff: {
        id: expect.any(String),
        title: "Prior handoff",
        summary: "Earlier thread result.",
        createdAt: expect.any(String),
      },
    });
  });

  it("lists compact delegated thread rows without transcripts, counts, or workflow summaries", async () => {
    const { runtime, store, thread, workflow } = createRuntimeFixture();
    const tool = createThreadListTool({ runtime, store });

    const result = await tool.execute("tool-call-1", { status: ["waiting"], limit: 5 });

    expect(result.details.threads).toEqual([
      {
        id: thread.id,
        title: "Investigate Runtime Tools",
        objective: "Inspect runtime state without prompt stuffing.",
        status: "waiting",
        wait: {
          kind: "external",
          reason: "Waiting for workflow signal.",
          resumeWhen: "Signal arrives.",
        },
        activeWorkflowRunIds: [workflow.smithersRunId],
        latestHandoff: {
          id: expect.any(String),
          title: "Prior handoff",
          summary: "Earlier thread result.",
          createdAt: expect.any(String),
        },
      },
    ]);
    expect(JSON.stringify(result.details)).not.toContain("message");
    expect(JSON.stringify(result.details)).not.toContain("workflow summary");
    expect(JSON.stringify(result.details)).not.toContain("commandCount");
  });

  it("reads handoff episode bodies and defaults to the current handler thread", async () => {
    const { runtime, store, episode } = createRuntimeFixture();
    const tool = createThreadHandoffsTool({ runtime, store });

    const result = await tool.execute("tool-call-1", {});

    expect(result.details.handoffs).toEqual([
      {
        id: episode.id,
        threadId: episode.threadId,
        title: "Prior handoff",
        summary: "Earlier thread result.",
        body: "Full durable handoff body.",
        createdAt: episode.createdAt,
      },
    ]);
  });
});

function createRuntimeFixture() {
  const root = mkdtempSync(join(tmpdir(), "svvy-runtime-tools-"));
  tempDirs.push(root);
  const store = createStructuredSessionStateStore({
    databasePath: join(root, "structured.sqlite"),
    workspace: {
      id: root,
      label: "runtime-tools",
      cwd: root,
    },
  });
  const sessionId = "workspace-session-1";
  const orchestratorSurfaceId = "orchestrator-surface-1";
  const handlerSurfaceId = "handler-surface-1";
  store.upsertPiSession({
    sessionId,
    title: "Runtime Tools",
    provider: "openai",
    model: "gpt-4o",
    reasoningEffort: "medium",
    messageCount: 0,
    status: "idle",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });
  const turn = store.startTurn({
    sessionId,
    surfacePiSessionId: orchestratorSurfaceId,
    requestSummary: "Delegate runtime state inspection",
  });
  const thread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: handlerSurfaceId,
    title: "Investigate Runtime Tools",
    objective: "Inspect runtime state without prompt stuffing.",
  });
  const context = store.loadThreadContext({
    threadId: thread.id,
    contextKey: "ci",
    contextVersion: "1",
  });
  expect(context.contextKey).toBe("ci");
  const command = store.createCommand({
    turnId: turn.id,
    surfacePiSessionId: handlerSurfaceId,
    threadId: thread.id,
    toolName: "smithers_run_workflow",
    executor: "smithers",
    visibility: "surface",
    title: "Run workflow",
    summary: "workflow summary should not leak",
  });
  store.startCommand(command.id);
  const workflow = store.recordWorkflow({
    threadId: thread.id,
    commandId: command.id,
    smithersRunId: "smithers-run-1",
    workflowName: "runtime_state_probe",
    workflowSource: "saved",
    entryPath: ".svvy/workflows/entries/runtime-state-probe.tsx",
    savedEntryId: "runtime_state_probe",
    status: "waiting",
    smithersStatus: "waiting-event",
    waitKind: "event",
    summary: "workflow summary should not leak",
  });
  store.updateThread({
    threadId: thread.id,
    status: "waiting",
    wait: {
      owner: "workflow",
      kind: "signal",
      reason: "Waiting for workflow signal.",
      resumeWhen: "Signal arrives.",
      since: new Date(1).toISOString(),
    },
  });
  store.updateThread({ threadId: thread.id, status: "completed", wait: null });
  const episode = store.createEpisode({
    threadId: thread.id,
    sourceCommandId: command.id,
    title: "Prior handoff",
    summary: "Earlier thread result.",
    body: "Full durable handoff body.",
  });
  store.updateThread({
    threadId: thread.id,
    status: "waiting",
    wait: {
      owner: "workflow",
      kind: "signal",
      reason: "Waiting for workflow signal.",
      resumeWhen: "Signal arrives.",
      since: new Date(1).toISOString(),
    },
  });

  const runtime: PromptExecutionRuntimeHandle = {
    current: {
      sessionId,
      turnId: turn.id,
      surfacePiSessionId: handlerSurfaceId,
      surfaceThreadId: thread.id,
      surfaceKind: "handler",
      defaultEpisodeKind: "change",
      rootThreadId: thread.id,
      promptText: "Follow up.",
      rootEpisodeKind: "change",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
      suppressPendingWorkflowAttentionDelivery: false,
    },
  };

  return { store, runtime, thread, workflow, episode };
}
