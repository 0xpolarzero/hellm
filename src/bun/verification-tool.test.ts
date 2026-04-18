import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { createVerifyRunTool } from "./verification-tool";
import { createPromptExecutionContext, type PromptExecutionRuntimeHandle } from "./prompt-execution-context";

const stores: StructuredSessionStateStore[] = [];
const tempDirs: string[] = [];

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

function createWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "svvy-verify-tool-"));
  tempDirs.push(root);
  return root;
}

function createStore(workspaceCwd: string) {
  const store = createStructuredSessionStateStore({
    workspace: {
      id: workspaceCwd,
      label: "svvy",
      cwd: workspaceCwd,
    },
  });
  store.upsertPiSession({
    sessionId: "session-verify-tool",
    title: "Verification Tool Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-15T09:00:00.000Z",
    updatedAt: "2026-04-15T09:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createRuntime(store: StructuredSessionStateStore): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: "session-verify-tool",
    requestSummary: "Attempt deprecated verification tool",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    kind: "task",
    title: "Attempt deprecated verification tool",
    objective: "The compatibility shim should reject native verification execution.",
  });

  return {
    current: createPromptExecutionContext({
      sessionId: "session-verify-tool",
      turnId: turn.id,
      surfaceThreadId: rootThread.id,
      promptText: "Run verification",
      defaultEpisodeKind: "analysis",
    }),
  };
}

describe("verification tool", () => {
  it("still requires an active prompt runtime", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const tool = createVerifyRunTool({
      cwd: workspaceCwd,
      runtime: { current: null },
      store: createStore(workspaceCwd),
    });

    await expect(tool.execute("tool-call-1", { kind: "typecheck" })).rejects.toThrow(
      "verification.run can only run during an active prompt.",
    );
  });

  it("rejects direct native verification and points callers to workflow-based verification", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore(workspaceCwd);
    const tool = createVerifyRunTool({
      cwd: workspaceCwd,
      runtime: createRuntime(store),
      store,
    });

    await expect(tool.execute("tool-call-2", { kind: "test" })).rejects.toThrow(
      "verification.run is deprecated. Start or resume a verification workflow template or preset instead.",
    );

    const snapshot = store.getSessionState("session-verify-tool");
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.commands).toHaveLength(0);
    expect(snapshot.verifications).toHaveLength(0);
    expect(snapshot.episodes).toHaveLength(0);
    expect(snapshot.artifacts).toHaveLength(0);
  });
});
