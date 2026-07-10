import { describe, expect, it } from "bun:test";
import type {
  DesktopRendererNotification,
  StateReadModelBaseline,
  StateReadModelResult,
} from "../shared/workspace-contract";
import type { WorkspaceId } from "@svvy/core";
import { createRendererNotificationStore } from "./renderer-notifications";

const workspaceId = "workspace-renderer-notifications" as WorkspaceId;
const otherWorkspaceId = "workspace-renderer-notifications-other" as WorkspaceId;
const emptyBaseline = (): StateReadModelBaseline => ({
  app: [],
  workspaces: [],
  revision: 1 as never,
});

describe("renderer notification store", () => {
  it("uses one desktop notification listener to drive descriptor refetch patches", async () => {
    const listeners = new Set<(payload: DesktopRendererNotification) => void>();
    const refetches: unknown[] = [];
    const applied: StateReadModelResult[][] = [];
    const patch: StateReadModelResult[] = [
      {
        kind: "appPreferences",
        value: {
          appearance: "dark",
          externalEditor: null,
          artifactDirectory: "/tmp/artifacts" as never,
          approvalMode: "auto-review",
          networkAccess: true,
          ambientResources: {},
          updatedAt: "2026-01-01T00:00:00.000Z" as never,
          revision: 1 as never,
        },
      },
    ];

    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: async (input) => {
            refetches.push(input);
            return patch;
          },
          rebaselineStateReadModels: async () => emptyBaseline(),
        },
        addMessageListener: (_messageName, listener) => {
          listeners.add(listener);
        },
        removeMessageListener: (_messageName, listener) => {
          listeners.delete(listener);
        },
      },
      applyReadModelPatch: (nextPatch) => applied.push([...nextPatch]),
      applyReadModelBaseline: () => {},
    });

    expect(listeners.size).toBe(1);
    for (const listener of listeners) {
      listener({
        kind: "read-model-changed",
        eventGenerationId: "generation-1" as never,
        sequence: 1 as never,
        scope: { kind: "app" },
        invalidation: { scope: "app", invalidation: { model: "appPreferences" } },
      });
    }
    await waitFor(() => applied.length === 1);

    expect(refetches).toEqual([
      { descriptor: { scope: "app", invalidation: { model: "appPreferences" } } },
    ]);
    expect(applied).toEqual([patch]);

    store.dispose();
    expect(listeners.size).toBe(0);
  });

  it("drops other-workspace notifications while preserving app notifications", async () => {
    const listeners = new Set<(payload: DesktopRendererNotification) => void>();
    const refetches: unknown[] = [];
    const rebaselines: unknown[] = [];
    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: async (input) => {
            refetches.push(input);
            return [];
          },
          rebaselineStateReadModels: async (input) => {
            rebaselines.push(input);
            return emptyBaseline();
          },
        },
        addMessageListener: (_messageName, listener) => listeners.add(listener),
        removeMessageListener: (_messageName, listener) => listeners.delete(listener),
      },
      applyReadModelPatch: () => {},
      applyReadModelBaseline: () => {},
    });

    store.handle({
      kind: "read-model-changed",
      eventGenerationId: "generation-1" as never,
      sequence: 1 as never,
      scope: { kind: "workspace", workspaceId: otherWorkspaceId },
      invalidation: {
        scope: "workspace",
        workspaceId: otherWorkspaceId,
        invalidation: { model: "sessionNavigation" },
      },
    });
    store.handle({
      kind: "surface-stream-patch",
      eventGenerationId: "generation-1" as never,
      sequence: 2 as never,
      workspaceId: otherWorkspaceId,
      target: {
        workspaceSessionId: "session-other",
        surface: "orchestrator",
        surfacePiSessionId: "surface-other",
      } as never,
      surfacePiSessionId: "surface-other" as never,
      streamGenerationId: "stream-generation-other" as never,
      streamSequence: 1 as never,
      patch: {
        type: "assistant_text_delta",
        messageId: "message-other" as never,
        contentIndex: 0 as never,
        delta: "ignored",
      },
    });
    store.handle({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
      rebaselineRequired: true,
      scope: { kind: "workspace", workspaceId: otherWorkspaceId },
    });
    store.handle({
      kind: "read-model-changed",
      eventGenerationId: "generation-1" as never,
      sequence: 3 as never,
      scope: { kind: "app" },
      invalidation: { scope: "app", invalidation: { model: "appPreferences" } },
    });

    await waitFor(() => refetches.length === 1);
    expect(refetches).toEqual([
      { descriptor: { scope: "app", invalidation: { model: "appPreferences" } } },
    ]);
    expect(rebaselines).toEqual([]);
    store.dispose();
  });

  it("applies authoritative rebaseline results for the mounted workspace", async () => {
    const baseline: StateReadModelBaseline = {
      app: [
        {
          kind: "appPreferences",
          value: {
            appearance: "light",
            externalEditor: null,
            artifactDirectory: "/tmp/artifacts" as never,
            approvalMode: "user",
            networkAccess: false,
            ambientResources: {},
            updatedAt: "2026-01-01T00:00:00.000Z" as never,
            revision: 2 as never,
          },
        },
      ],
      workspaces: [],
      revision: 2 as never,
    };
    const requests: unknown[] = [];
    const applied: StateReadModelBaseline[] = [];
    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: async () => [],
          rebaselineStateReadModels: async (input) => {
            requests.push(input);
            return baseline;
          },
        },
        addMessageListener: () => {},
        removeMessageListener: () => {},
      },
      applyReadModelPatch: () => {},
      applyReadModelBaseline: (next) => applied.push(next),
    });

    store.handle({
      kind: "read-model-rebaseline-required",
      reason: "runtime-restart",
      rebaselineRequired: true,
      scope: { kind: "workspace", workspaceId },
    });
    await waitFor(() => applied.length === 1);

    expect(requests).toEqual([{ workspaceId, reason: "runtime-restart" }]);
    expect(applied).toEqual([baseline]);
    store.dispose();
  });

  it("does not apply an in-flight refetch after rebaseline resets its lane", async () => {
    let resolveRefetch!: (value: readonly StateReadModelResult[]) => void;
    const refetch = new Promise<readonly StateReadModelResult[]>((resolve) => {
      resolveRefetch = resolve;
    });
    const patches: StateReadModelResult[][] = [];
    const baselines: StateReadModelBaseline[] = [];
    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: async () => refetch,
          rebaselineStateReadModels: async () => emptyBaseline(),
        },
        addMessageListener: () => {},
        removeMessageListener: () => {},
      },
      applyReadModelPatch: (patch) => patches.push([...patch]),
      applyReadModelBaseline: (baseline) => baselines.push(baseline),
    });

    store.handle({
      kind: "read-model-changed",
      eventGenerationId: "generation-1" as never,
      sequence: 1 as never,
      scope: { kind: "workspace", workspaceId },
      invalidation: {
        scope: "workspace",
        workspaceId,
        invalidation: { model: "sessionNavigation" },
      },
    });
    store.handle({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
      rebaselineRequired: true,
      scope: { kind: "workspace", workspaceId },
    });
    await waitFor(() => baselines.length === 1);

    resolveRefetch([{ kind: "sessionNavigation", value: {} as never }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(patches).toEqual([]);
    store.dispose();
  });
});

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(assertion()).toBe(true);
}
