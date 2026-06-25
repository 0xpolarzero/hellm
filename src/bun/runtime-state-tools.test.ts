import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PromptExecutionRuntimeHandle } from "@svvy/core";
import {
  runtimeCommandStatePortFromStore,
  runtimeReadModelStatePortFromStore,
  runtimeTurnStatePortFromStore,
} from "@svvy/state";
import {
  createThreadCurrentTool,
  createThreadEpisodesTool,
  createThreadGroupTool,
  createThreadListTool,
  type ThreadStateToolServices,
} from "./runtime-state-tools";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "@svvy/state/structured-session-state";
import type { StateContractError } from "@svvy/core";

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
    const { runtime, state, store, thread } = createRuntimeFixture();
    const tool = createThreadCurrentTool({ runtime, state });

    runtime.current = {
      ...runtime.current!,
      surfaceKind: "orchestrator",
      threadId: null,
      rootThreadId: null,
    };
    await expect(
      tool.execute("tool-call-1", {}).then(
        () => null,
        (error) => (error as Error).message,
      ),
    ).resolves.toContain("handler thread");
    expect(store.getSessionState(thread.sessionId).commands).toContainEqual(
      expect.objectContaining({
        toolName: "thread_current",
        status: "failed",
        arguments: {},
        error: "thread_current can only run from a handler thread.",
      }),
    );

    runtime.current = {
      ...runtime.current!,
      surfaceKind: "handler",
      threadId: thread.id,
      rootThreadId: thread.id,
    };
    const result = await tool.execute("tool-call-2", {});

    expect(result.details! as unknown).toEqual({
      threadId: thread.id,
      threadGroupId: thread.threadGroupId,
      workspaceSessionId: thread.sessionId,
      surfacePiSessionId: thread.surfacePiSessionId,
      title: "Investigate Runtime Tools",
      objective: "Inspect runtime state without prompt stuffing.",
      objectiveState: "active",
      status: "waiting",
      wait: {
        kind: "external",
        reason: "Waiting for workflow signal.",
        resumeWhen: "Signal arrives.",
      },
      pendingReportRequests: [],
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["web"],
      latestEpisode: {
        id: expect.any(String),
        title: "Prior report",
        summary: "Earlier thread result.",
        createdAt: expect.any(String),
      },
    });
    expect(store.getSessionState(thread.sessionId).commands).toContainEqual(
      expect.objectContaining({
        toolName: "thread_current",
        status: "succeeded",
        arguments: {},
        facts: expect.objectContaining({
          threadId: thread.id,
          threadGroupId: thread.threadGroupId,
        }),
      }),
    );
    expect(store.getSessionState(thread.sessionId).turns[0]?.turnDecision).toBe("thread_current");
  });

  it("lists compact delegated thread rows without transcripts, counts, or workflow summaries", async () => {
    const { runtime, state, store, thread } = createRuntimeFixture();
    const tool = createThreadListTool({ runtime, state });

    const result = await tool.execute("tool-call-1", { status: ["waiting"], limit: 5 });

    expect(result.details!.threads as unknown).toEqual([
      {
        threadId: thread.id,
        threadGroupId: thread.threadGroupId,
        workspaceSessionId: thread.sessionId,
        surfacePiSessionId: thread.surfacePiSessionId,
        title: "Investigate Runtime Tools",
        objective: "Inspect runtime state without prompt stuffing.",
        objectiveState: "active",
        status: "waiting",
        wait: {
          kind: "external",
          reason: "Waiting for workflow signal.",
          resumeWhen: "Signal arrives.",
        },
        latestEpisode: {
          id: expect.any(String),
          title: "Prior report",
          summary: "Earlier thread result.",
          createdAt: expect.any(String),
        },
      },
    ]);
    expect(JSON.stringify(result.details!)).not.toContain("message");
    expect(JSON.stringify(result.details!)).not.toContain("workflow summary");
    expect(JSON.stringify(result.details!)).not.toContain("commandCount");
    expect(store.getSessionState(thread.sessionId).commands).toContainEqual(
      expect.objectContaining({
        toolName: "thread_list",
        status: "succeeded",
        arguments: {
          status: ["waiting"],
          limit: 5,
        },
        facts: {
          threads: [
            expect.objectContaining({
              threadId: thread.id,
              threadGroupId: thread.threadGroupId,
            }),
          ],
        },
      }),
    );
    expect(store.getSessionState(thread.sessionId).turns[0]?.turnDecision).toBe("thread_list");
  });

  it("reads episode bodies and defaults to the current handler thread", async () => {
    const { runtime, state, store, thread, episode } = createRuntimeFixture();
    const tool = createThreadEpisodesTool({ runtime, state });

    const result = await tool.execute("tool-call-1", {});

    expect(result.details!.episodes as unknown).toEqual([
      {
        id: episode.id,
        threadId: episode.threadId,
        title: "Prior report",
        summary: "Earlier thread result.",
        body: "Full durable report body.",
        createdAt: episode.createdAt,
      },
    ]);
    expect(store.getSessionState(thread.sessionId).commands).toContainEqual(
      expect.objectContaining({
        toolName: "thread_episodes",
        status: "succeeded",
        arguments: {
          limit: 10,
        },
        facts: {
          episodes: [
            expect.objectContaining({
              id: episode.id,
              threadId: episode.threadId,
            }),
          ],
        },
      }),
    );
  });

  it("records failed command facts for invalid episode filters", async () => {
    const { runtime, state, store, thread } = createRuntimeFixture();
    const tool = createThreadEpisodesTool({ runtime, state });

    await expect(
      tool.execute("tool-call-invalid-episodes", {
        threadId: thread.id,
        threadGroupId: thread.threadGroupId,
      }),
    ).rejects.toThrow("thread_episodes accepts threadId or threadGroupId, not both.");

    expect(store.getSessionState(thread.sessionId).commands).toContainEqual(
      expect.objectContaining({
        toolName: "thread_episodes",
        status: "failed",
        arguments: {
          threadId: thread.id,
          threadGroupId: thread.threadGroupId,
          limit: 10,
        },
        error: "thread_episodes accepts threadId or threadGroupId, not both.",
      }),
    );
  });

  it("requires an episode filter outside handler-thread context", async () => {
    const { runtime, state, store, thread } = createRuntimeFixture();
    const tool = createThreadEpisodesTool({ runtime, state });
    runtime.current = {
      ...runtime.current!,
      surfaceKind: "orchestrator",
      threadId: null,
      rootThreadId: null,
    };

    await expect(tool.execute("tool-call-missing-episode-filter", {})).rejects.toThrow(
      "thread_episodes requires threadId or threadGroupId outside a handler thread.",
    );

    expect(store.getSessionState(thread.sessionId).commands).toContainEqual(
      expect.objectContaining({
        toolName: "thread_episodes",
        status: "failed",
        arguments: {
          limit: 10,
        },
        error: "thread_episodes requires threadId or threadGroupId outside a handler thread.",
      }),
    );
  });

  it("reads current handler group topology without sharing transcripts", async () => {
    const { runtime, state, store, thread } = createRuntimeFixture();
    const tool = createThreadGroupTool({ runtime, state });

    const result = await tool.execute("tool-call-group", {});

    expect(result.details!.threadGroupId as string).toBe(thread.threadGroupId);
    expect(result.details!.currentThreadId as string).toBe(thread.id);
    expect(result.details!.threads as unknown).toEqual([
      expect.objectContaining({
        threadId: thread.id,
        threadGroupId: thread.threadGroupId,
        objectiveState: "active",
      }),
    ]);
    expect(JSON.stringify(result.details!)).not.toContain("Full durable report body");
    expect(store.getSessionState(thread.sessionId).commands).toContainEqual(
      expect.objectContaining({
        toolName: "thread_group",
        status: "succeeded",
        arguments: {},
        facts: expect.objectContaining({
          threadGroupId: thread.threadGroupId,
          currentThreadId: thread.id,
        }),
      }),
    );
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
    loadedExtensionIds: ["shell"],
    availableExtensionIds: ["web"],
  });
  const command = store.createCommand({
    turnId: turn.id,
    surfacePiSessionId: handlerSurfaceId,
    threadId: thread.id,
    toolName: "exec_command",
    executor: "handler",
    visibility: "surface",
    title: "Run Smithers CLI",
    summary: "smithers command summary should not leak",
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
    title: "Prior report",
    summary: "Earlier thread result.",
    body: "Full durable report body.",
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
      workspaceSessionId: sessionId,
      turnId: turn.id,
      surfacePiSessionId: handlerSurfaceId,
      threadId: thread.id,
      surfaceKind: "handler",
      defaultEpisodeKind: "change",
      rootThreadId: thread.id,
      rootEpisodeKind: "change",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["web"],
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
      suppressPendingWorkflowAttentionDelivery: false,
    },
  };
  return { state: createThreadStateToolServices(store), store, runtime, thread, workflow, episode };
}

function createThreadStateToolServices(
  store: StructuredSessionStateStore,
): ThreadStateToolServices {
  return {
    commandState: runtimeCommandStatePortFromStore(store),
    readModelState: runtimeReadModelStatePortFromStore(store),
    turnState: runtimeTurnStatePortFromStore(store),
    runState: <A>(effect: Effect.Effect<A, StateContractError>) => Effect.runSync(effect),
  };
}
