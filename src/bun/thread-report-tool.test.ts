import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import { createThreadReportTool } from "./thread-report-tool";
import {
  runtimeCommandStatePortFromStore,
  runtimeEpisodeStatePortFromStore,
  runtimeReadModelStatePortFromStore,
  runtimeTurnStatePortFromStore,
} from "@svvy/state/structured-session-adapters";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "@svvy/state/structured-session-state";

const WORKSPACE = {
  id: "/repo/svvy",
  label: "svvy",
  cwd: "/repo/svvy",
} as const;

const stores: StructuredSessionStateStore[] = [];
const tempDirs: string[] = [];
const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

function createStore() {
  const artifactDir = mkdtempSync(join(tmpdir(), "svvy-thread-report-artifacts-"));
  tempDirs.push(artifactDir);
  const store = createStructuredSessionStateStore({
    digest: testDigest,
    workspace: {
      ...WORKSPACE,
      artifactDir,
    },
  });
  store.upsertPiSession({
    sessionId: "session-thread-report-tool",
    title: "Thread Report Tool Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-06-08T09:00:00.000Z",
    updatedAt: "2026-06-08T09:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createHandlerRuntime(store: StructuredSessionStateStore): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: "session-thread-report-tool",
    surfacePiSessionId: "pi-thread-report-001",
    requestSummary: "Report from handler",
  });
  const thread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: "pi-thread-report-001",
    title: "Report thread",
    objective: "Own the delegated report.",
  });

  return {
    current: {
      workspaceSessionId: "session-thread-report-tool",
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-report-001",
      threadId: thread.id,
      surfaceKind: "handler",
      defaultEpisodeKind: "change",
      rootThreadId: thread.id,
      rootEpisodeKind: "change",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
      loadedExtensionIds: [],
      availableExtensionIds: [],
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    },
  };
}

function createThreadReportToolOptions(store: StructuredSessionStateStore) {
  return {
    commandState: runtimeCommandStatePortFromStore(store),
    episodeState: runtimeEpisodeStatePortFromStore(store),
    readModelState: runtimeReadModelStatePortFromStore(store),
    turnState: runtimeTurnStatePortFromStore(store),
    runState: Effect.runSync,
  };
}

describe("thread_report tool", () => {
  it("requires a handler prompt runtime", async () => {
    const store = createStore();
    const tool = createThreadReportTool({
      runtime: { current: null },
      ...createThreadReportToolOptions(store),
      queueThreadReportNotification: async () => {
        throw new Error("unexpected notification");
      },
    });

    await expect(
      tool.execute("tool-call-1", {
        summary: "Update",
      }),
    ).rejects.toThrow("thread_report can only run during an active prompt.");
  });

  it("records update episodes without concluding the objective", async () => {
    const store = createStore();
    const runtime = createHandlerRuntime(store);
    const notifications: string[] = [];
    const tool = createThreadReportTool({
      runtime,
      ...createThreadReportToolOptions(store),
      queueThreadReportNotification: async (request) => {
        notifications.push(request.episode.id);
      },
    });

    const result = await tool.execute("tool-call-2", {
      summary: "Found the root cause.",
      details: "The parser skipped the final token.",
    });

    const snapshot = store.getSessionState("session-thread-report-tool");
    const thread = snapshot.threads[0]!;
    expect(result.details!.commandFacts).toMatchObject({
      threadId: thread.id,
      objectiveState: "active",
      notificationQueued: true,
    });
    expect(snapshot.turns[0]).toMatchObject({ turnDecision: "thread_report" });
    expect(snapshot.threads[0]).toMatchObject({
      objectiveState: "active",
      status: "running-handler",
    });
    expect(snapshot.episodes).toEqual([
      expect.objectContaining({
        title: "Found the root cause.",
        summary: "Found the root cause.",
        body: "The parser skipped the final token.",
      }),
    ]);
    expect(notifications).toEqual([snapshot.episodes[0]!.id]);
  });

  it("concludes the objective when outcome is present", async () => {
    const store = createStore();
    const runtime = createHandlerRuntime(store);
    const threadId = runtime.current!.threadId!;
    const existingCommand = store.createCommand({
      turnId: runtime.current!.turnId,
      surfacePiSessionId: runtime.current!.surfacePiSessionId,
      threadId,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Run tests",
      summary: "Tests passed",
    });
    store.finishCommand({
      commandId: existingCommand.id,
      status: "succeeded",
      summary: "Tests passed",
    });
    const sourceDir = mkdtempSync(join(tmpdir(), "svvy-thread-report-source-"));
    tempDirs.push(sourceDir);
    const sourcePath = join(sourceDir, "summary.md");
    writeFileSync(sourcePath, "# Summary\n");
    const existingArtifact = store.createArtifact({
      sessionId: runtime.current!.workspaceSessionId,
      threadId,
      sourceCommandId: existingCommand.id,
      kind: "text",
      name: "summary.md",
      path: sourcePath,
    });
    const tool = createThreadReportTool({
      runtime,
      ...createThreadReportToolOptions(store),
      queueThreadReportNotification: async () => {},
    });

    const result = await tool.execute("tool-call-3", {
      summary: "Fix landed.",
      outcome: "succeeded",
      relatedCommandIds: [existingCommand.id],
      relatedArtifactIds: [existingArtifact.id],
    });

    const snapshot = store.getSessionState("session-thread-report-tool");
    const command = snapshot.commands.find((entry) => entry.toolName === "thread_report");
    expect(result.details!.commandFacts).toMatchObject({
      objectiveState: "concluded",
    });
    expect(snapshot.threads[0]).toMatchObject({
      objectiveState: "concluded",
      status: "completed",
      wait: null,
    });
    expect(command?.facts).toMatchObject({
      outcome: "succeeded",
      relatedCommandIds: [existingCommand.id],
      relatedArtifactIds: [existingArtifact.id],
    });
    expect(command?.arguments).toEqual({
      summary: "Fix landed.",
      details: "Fix landed.",
      outcome: "succeeded",
      relatedCommandIds: [existingCommand.id],
      relatedArtifactIds: [existingArtifact.id],
    });
  });

  it("rejects non-durable related references before creating an episode", async () => {
    const store = createStore();
    const runtime = createHandlerRuntime(store);
    const tool = createThreadReportTool({
      runtime,
      ...createThreadReportToolOptions(store),
      queueThreadReportNotification: async () => {},
    });

    await expect(
      tool.execute("tool-call-4", {
        summary: "Fix landed.",
        outcome: "succeeded",
        relatedCommandIds: ["missing-command"],
      }),
    ).rejects.toThrow("related command is not durable or inspectable");

    const snapshot = store.getSessionState("session-thread-report-tool");
    expect(snapshot.episodes).toEqual([]);
    expect(snapshot.commands.find((command) => command.toolName === "thread_report")).toMatchObject(
      {
        status: "failed",
        arguments: {
          summary: "Fix landed.",
          details: "Fix landed.",
          outcome: "succeeded",
          relatedCommandIds: ["missing-command"],
          relatedArtifactIds: [],
        },
        error: expect.stringContaining("related command is not durable or inspectable"),
      },
    );
  });

  it("keeps a durable report successful if notification enqueue fails after episode creation", async () => {
    const store = createStore();
    const runtime = createHandlerRuntime(store);
    const tool = createThreadReportTool({
      runtime,
      ...createThreadReportToolOptions(store),
      queueThreadReportNotification: async () => {
        throw new Error("queue unavailable");
      },
    });

    const result = await tool.execute("tool-call-5", {
      summary: "Partial result.",
    });

    const snapshot = store.getSessionState("session-thread-report-tool");
    expect(snapshot.episodes).toHaveLength(1);
    expect(result.details!.commandFacts).toMatchObject({
      notificationQueued: false,
      notificationError: "queue unavailable",
    });
    expect(snapshot.commands.find((command) => command.toolName === "thread_report")).toMatchObject(
      {
        status: "succeeded",
      },
    );
  });
});
