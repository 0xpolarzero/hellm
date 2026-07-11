import { describe, expect, it } from "bun:test";
import type { WorkspaceTabId } from "@svvy/core";
import {
  createWorkspaceChromeMutationQueue,
  type WorkspaceChromeMutation,
} from "./workspace-chrome-mutation-queue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function workspaceTab(workspaceTabId: WorkspaceTabId) {
  return {
    workspaceTabId,
    workspaceId: "workspace" as never,
    cwd: "/tmp/workspace" as never,
    workspaceLabel: "Workspace",
    kind: "user" as const,
    openedAt: "2026-07-11T00:00:00.000Z" as never,
    activeLayoutId: "A" as const,
  };
}

describe("workspace chrome mutation queue", () => {
  it("runs captured reorder and selection mutations in invocation order", async () => {
    const first = deferred();
    const calls: WorkspaceChromeMutation[] = [];
    const queue = createWorkspaceChromeMutationQueue(async (mutation) => {
      calls.push(mutation);
      if (calls.length === 1) await first.promise;
    });
    const tabA = "tab-a" as WorkspaceTabId;
    const tabB = "tab-b" as WorkspaceTabId;
    const reordered = [workspaceTab(tabB), workspaceTab(tabA)];
    const reorder = queue.enqueue({
      kind: "set-tabs",
      input: {
        activeWorkspaceTabId: tabA,
        tabs: reordered,
        knownWorkspaces: reordered,
      },
    });
    reordered.reverse();
    const select = queue.enqueue({
      kind: "select-tab",
      input: { workspaceTabId: tabB },
    });

    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: "set-tabs",
      input: { tabs: [{ workspaceTabId: tabB }, { workspaceTabId: tabA }] },
    });
    first.resolve();
    await Promise.all([reorder, select]);
    expect(calls.map((call) => call.kind)).toEqual(["set-tabs", "select-tab"]);
  });

  it("continues after a rejected mutation without reordering later work", async () => {
    const calls: string[] = [];
    const queue = createWorkspaceChromeMutationQueue(async (mutation) => {
      calls.push(mutation.kind);
      if (mutation.kind === "select-tab") throw new Error("rejected");
    });
    await expect(
      queue.enqueue({
        kind: "select-tab",
        input: { workspaceTabId: "tab-a" as WorkspaceTabId },
      }),
    ).rejects.toThrow("rejected");
    await queue.enqueue({
      kind: "select-layout-slot",
      input: { workspaceTabId: "tab-a" as WorkspaceTabId, layoutId: "C" },
    });
    expect(calls).toEqual(["select-tab", "select-layout-slot"]);
  });

  it("finishes authoritative rejection handling before running the next mutation", async () => {
    const rollback = deferred();
    const calls: string[] = [];
    const queue = createWorkspaceChromeMutationQueue(async (mutation) => {
      calls.push(`execute:${mutation.kind}`);
      if (mutation.kind === "select-tab") throw new Error("rejected");
    });
    const rejected = queue.enqueue(
      {
        kind: "select-tab",
        input: { workspaceTabId: "tab-a" as WorkspaceTabId },
      },
      async () => {
        calls.push("rollback:start");
        await rollback.promise;
        calls.push("rollback:complete");
      },
    );
    const later = queue.enqueue({
      kind: "select-layout-slot",
      input: { workspaceTabId: "tab-a" as WorkspaceTabId, layoutId: "C" },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["execute:select-tab", "rollback:start"]);
    rollback.resolve();
    await expect(rejected).rejects.toThrow("rejected");
    await later;
    expect(calls).toEqual([
      "execute:select-tab",
      "rollback:start",
      "rollback:complete",
      "execute:select-layout-slot",
    ]);
  });

  it("drains all chrome work already admitted before prompt routing continues", async () => {
    const first = deferred();
    const calls: string[] = [];
    const queue = createWorkspaceChromeMutationQueue(async (mutation) => {
      calls.push(mutation.kind);
      await first.promise;
    });
    const mutation = queue.enqueue({
      kind: "select-tab",
      input: { workspaceTabId: "tab-a" as WorkspaceTabId },
    });
    const drained = queue.drain().then(() => calls.push("drained"));

    await Promise.resolve();
    expect(calls).toEqual(["select-tab"]);
    first.resolve();
    await Promise.all([mutation, drained]);
    expect(calls).toEqual(["select-tab", "drained"]);
  });

  it("drains complete tracked operations through post-RPC reconciliation", async () => {
    const rpcCommitted = deferred();
    const reconciliationStarted = deferred();
    const reconciliationCompleted = deferred();
    const calls: string[] = [];
    const queue = createWorkspaceChromeMutationQueue(async () => {
      calls.push("rpc:start");
      await rpcCommitted.promise;
      calls.push("rpc:complete");
    });
    const operation = queue.runTracked(async () => {
      await queue.enqueue({
        kind: "select-tab",
        input: { workspaceTabId: "tab-a" as WorkspaceTabId },
      });
      calls.push("reconcile:start");
      reconciliationStarted.resolve();
      await reconciliationCompleted.promise;
      calls.push("reconcile:complete");
    });
    const drained = queue.drain().then(() => calls.push("drained"));

    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["rpc:start"]);
    rpcCommitted.resolve();
    await reconciliationStarted.promise;
    expect(calls).toContain("reconcile:start");
    expect(calls).not.toContain("drained");
    reconciliationCompleted.resolve();
    await Promise.all([operation, drained]);
    expect(calls.at(-1)).toBe("drained");
  });

  it("finishes draining a tracked operation after its caller-visible failure settles", async () => {
    const cleanupStarted = deferred();
    const cleanupCompleted = deferred();
    const calls: string[] = [];
    const queue = createWorkspaceChromeMutationQueue(async () => {
      throw new Error("rejected");
    });
    const operation = queue.runTracked(async () => {
      try {
        await queue.enqueue({
          kind: "select-tab",
          input: { workspaceTabId: "tab-a" as WorkspaceTabId },
        });
      } finally {
        calls.push("cleanup:start");
        cleanupStarted.resolve();
        await cleanupCompleted.promise;
        calls.push("cleanup:complete");
      }
    });
    const drained = queue.drain().then(() => calls.push("drained"));

    await cleanupStarted.promise;
    expect(calls).toEqual(["cleanup:start"]);
    cleanupCompleted.resolve();
    await expect(operation).rejects.toThrow("rejected");
    await drained;
    expect(calls).toEqual(["cleanup:start", "cleanup:complete", "drained"]);
  });
});
