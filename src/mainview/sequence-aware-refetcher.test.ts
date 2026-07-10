import { describe, expect, it } from "bun:test";
import type {
  CommandId,
  RuntimeEventSequence,
  StateInvalidationDescriptor,
  SurfacePiSessionId,
  WorkspaceId,
} from "@svvy/core";
import { createSequenceAwareRefetcher } from "./sequence-aware-refetcher";
import type { StateReadModelResult } from "../shared/workspace-contract";

const commandDescriptor = (commandId: string): StateInvalidationDescriptor => ({
  scope: "workspace",
  workspaceId: "workspace-refetcher" as WorkspaceId,
  invalidation: { model: "commandInspector", ids: [commandId as CommandId] },
});

const surfaceDescriptor = (surfacePiSessionId: string): StateInvalidationDescriptor => ({
  scope: "workspace",
  workspaceId: "workspace-refetcher" as WorkspaceId,
  invalidation: { model: "surface", ids: [surfacePiSessionId as SurfacePiSessionId] },
});

const appDescriptor = (): StateInvalidationDescriptor => ({
  scope: "app",
  invalidation: { model: "appPreferences" },
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("createSequenceAwareRefetcher", () => {
  const seq = (value: number) => value as RuntimeEventSequence;
  const workspaceId = "workspace-refetcher" as WorkspaceId;

  it("coalesces refetches per read-model target and applies only the newest queued sequence", async () => {
    const first = createDeferred<readonly StateReadModelResult[]>();
    const calls: StateInvalidationDescriptor[] = [];
    const applied: number[] = [];
    const refetcher = createSequenceAwareRefetcher({
      state: {
        readModels: {
          refetchInvalidation: async ({ descriptor }) => {
            calls.push(descriptor);
            if (calls.length === 1) return first.promise;
            return [{ kind: "commandInspector", value: null }];
          },
        },
      },
      applyReadModelPatch: (_patch, context) => applied.push(context.sequence),
      discardIfStale: true,
    });

    refetcher(seq(1), {
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    refetcher(seq(2), {
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    refetcher(seq(3), {
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });

    expect(calls).toHaveLength(1);
    first.resolve([{ kind: "commandInspector", value: null }]);
    await waitFor(() => calls.length === 2);
    await waitFor(() => applied.includes(3));

    expect(calls).toEqual([commandDescriptor("command-1"), commandDescriptor("command-1")]);
    expect(applied).toEqual([3]);
  });

  it("keeps independent targets on independent refetch lanes", async () => {
    const calls: StateInvalidationDescriptor[] = [];
    const applied: string[] = [];
    const refetcher = createSequenceAwareRefetcher({
      state: {
        readModels: {
          refetchInvalidation: async ({ descriptor }) => {
            calls.push(descriptor);
            return [];
          },
        },
      },
      applyReadModelPatch: (_patch, context) => {
        applied.push((context.descriptor.invalidation as { model: string }).model);
      },
    });

    refetcher(seq(1), {
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    refetcher(seq(1), {
      scope: {
        kind: "surface",
        workspaceId,
        surfacePiSessionId: "surface-1" as SurfacePiSessionId,
      },
      invalidation: surfaceDescriptor("surface-1"),
    });
    refetcher(seq(1), {
      scope: { kind: "app" },
      invalidation: appDescriptor(),
    });

    await waitFor(() => applied.length === 3);
    expect(calls).toHaveLength(3);
    expect(applied.toSorted()).toEqual(["appPreferences", "commandInspector", "surface"]);
  });

  it("reports sequence gaps and resets stale state on rebaseline notification", async () => {
    const gaps: Array<{ expected: number; received: number }> = [];
    const rebaselines: string[] = [];
    const applied: number[] = [];
    const refetcher = createSequenceAwareRefetcher({
      state: {
        readModels: {
          refetchInvalidation: async () => [],
        },
      },
      applyReadModelPatch: (_patch, context) => applied.push(context.sequence),
      onSequenceGap: (gap) =>
        gaps.push({ expected: gap.expectedSequence, received: gap.receivedSequence }),
      onRebaselineRequired: (reason) => rebaselines.push(reason),
    });

    refetcher.handleNotification({
      kind: "read-model-changed",
      sequence: seq(1),
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    await waitFor(() => applied.includes(1));
    refetcher.handleNotification({
      kind: "read-model-changed",
      sequence: seq(3),
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    await waitFor(() => applied.includes(3));
    refetcher.handleNotification({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
    });
    refetcher.handleNotification({
      kind: "read-model-changed",
      sequence: seq(1),
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    await waitFor(() => applied.filter((sequence) => sequence === 1).length === 2);

    expect(gaps).toEqual([{ expected: 2, received: 3 }]);
    expect(rebaselines).toEqual(["event-sequence-gap"]);
  });

  it("invalidates in-flight refetches when reset so they cannot apply or restore stale lanes", async () => {
    const stale = createDeferred<readonly StateReadModelResult[]>();
    const calls: StateInvalidationDescriptor[] = [];
    const applied: number[] = [];
    const refetcher = createSequenceAwareRefetcher({
      state: {
        readModels: {
          refetchInvalidation: async ({ descriptor }) => {
            calls.push(descriptor);
            if (calls.length === 1) return stale.promise;
            return [{ kind: "commandInspector", value: null }];
          },
        },
      },
      applyReadModelPatch: (_patch, context) => applied.push(context.sequence),
    });

    refetcher(seq(10), {
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    expect(calls).toHaveLength(1);

    refetcher.reset("runtime-restart");
    refetcher(seq(1), {
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    await waitFor(() => applied.includes(1));

    stale.resolve([{ kind: "commandInspector", value: null }]);
    await Bun.sleep(0);
    refetcher(seq(2), {
      scope: { kind: "workspace", workspaceId },
      invalidation: commandDescriptor("command-1"),
    });
    await waitFor(() => applied.includes(2));

    expect(calls).toHaveLength(3);
    expect(applied).toEqual([1, 2]);
  });
});

async function waitFor(assertion: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!assertion()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await Bun.sleep(0);
  }
}
