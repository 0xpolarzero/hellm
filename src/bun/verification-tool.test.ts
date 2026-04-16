import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { createVerifyRunTool } from "./verification-tool";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";

const WORKSPACE = {
  id: "/repo/svvy",
  label: "svvy",
  cwd: "/repo/svvy",
} as const;

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

function createStore() {
  const store = createStructuredSessionStateStore({
    workspace: WORKSPACE,
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
    requestSummary: "Run verification",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    kind: "task",
    title: "Run verification",
    objective: "Use verification.run from the prompt execution context.",
  });

  return {
    current: {
      sessionId: "session-verify-tool",
      turnId: turn.id,
      rootThreadId: rootThread.id,
      promptText: "Run verification",
      rootEpisodeKind: "analysis",
      sessionWaitApplied: false,
    },
  };
}

describe("verification tool", () => {
  it("requires an active prompt runtime", async () => {
    const tool = createVerifyRunTool({
      cwd: process.cwd(),
      runtime: { current: null },
      store: createStore(),
    });

    await expect(tool.execute("tool-call-1", { kind: "typecheck" })).rejects.toThrow(
      "verification.run can only run during an active prompt.",
    );
  });

  it("runs test verifications and records the structured command, verification, and episode", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "svvy-verify-tool-"));
    tempDirs.push(tempDir);
    const target = join(tempDir, "verify-run.test.ts");
    writeFileSync(
      target,
      [
        'import { expect, test } from "bun:test";',
        'test("tool verification fixture", () => {',
        "  expect(1 + 1).toBe(2);",
        "});",
        "",
      ].join("\n"),
    );

    const store = createStore();
    const tool = createVerifyRunTool({
      cwd: process.cwd(),
      runtime: createRuntime(store),
      store,
    });

    const result = await tool.execute("tool-call-2", {
      kind: "test",
      target,
    });
    const details = result.details as {
      ok: boolean;
      status: string;
      cancelled: boolean;
      exitCode: number;
      commandId: string;
      verificationId: string;
      threadId: string;
      summary: string;
    };

    expect(details).toMatchObject({
      ok: true,
      status: "passed",
      cancelled: false,
      exitCode: 0,
    });
    expect(details.commandId).toBeTruthy();
    expect(details.verificationId).toBeTruthy();
    expect(details.threadId).toBeTruthy();
    expect(details.summary).toContain("passed");

    const snapshot = store.getSessionState("session-verify-tool");
    const [rootThread, verificationThread] = snapshot.threads;
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.threads).toHaveLength(2);
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.verifications).toHaveLength(1);
    expect(snapshot.episodes).toHaveLength(1);
    expect(rootThread?.status).toBe("running");
    expect(rootThread?.dependsOnThreadIds).toEqual([]);
    expect(verificationThread?.kind).toBe("verification");
    expect(verificationThread?.parentThreadId).toBe(rootThread?.id);
    expect(snapshot.commands[0]?.threadId).toBe(verificationThread?.id);
    expect(snapshot.verifications[0]?.threadId).toBe(verificationThread?.id);
    expect(snapshot.episodes[0]?.sourceCommandId).toBe(snapshot.commands[0]?.id);
    expect(
      snapshot.events.filter(
        (event) => event.subject.kind === "thread" && event.subject.id === rootThread?.id,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "thread.created",
      }),
      expect.objectContaining({
        kind: "thread.updated",
        data: {
          status: "waiting",
          dependsOnThreadIds: [verificationThread?.id],
          wait: null,
        },
      }),
      expect.objectContaining({
        kind: "thread.updated",
        data: {
          status: "running",
          dependsOnThreadIds: [],
          wait: null,
        },
      }),
    ]);

    const detail = store.getThreadDetail(verificationThread!.id);
    expect(detail.commands.map((entry) => entry.id)).toEqual([snapshot.commands[0]!.id]);
    expect(detail.verifications.map((entry) => entry.id)).toEqual([snapshot.verifications[0]!.id]);
    expect(detail.episodes.map((entry) => entry.id)).toEqual([snapshot.episodes[0]!.id]);
  });

  it("rejects unsupported targets for non-test verifications", async () => {
    const store = createStore();
    const tool = createVerifyRunTool({
      cwd: process.cwd(),
      runtime: createRuntime(store),
      store,
    });

    await expect(
      tool.execute("tool-call-3", {
        kind: "lint",
        target: "src/bun",
      }),
    ).rejects.toThrow("verification.run does not accept target for lint.");
  });
});
