import { describe, expect, it } from "bun:test";
import type {
  DesktopRendererNotification,
  StateReadModelBaseline,
  StateReadModelResult,
} from "../shared/workspace-contract";
import { DEFAULT_EXTERNAL_INSTRUCTIONS, type WorkspaceId } from "@svvy/core";
import { createRendererNotificationStore } from "./renderer-notifications";

const workspaceId = "workspace-renderer-notifications" as WorkspaceId;
const otherWorkspaceId = "workspace-renderer-notifications-other" as WorkspaceId;
const emptyBaseline = (): StateReadModelBaseline => ({
  app: [],
  workspaces: [],
  revision: 1 as never,
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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
          externalInstructions: DEFAULT_EXTERNAL_INSTRUCTIONS,
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
            externalInstructions: DEFAULT_EXTERNAL_INSTRUCTIONS,
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
    const applied: Array<{ baseline: StateReadModelBaseline; scope: unknown }> = [];
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
      applyReadModelBaseline: (next, scope) => applied.push({ baseline: next, scope }),
    });

    store.handle({
      kind: "read-model-rebaseline-required",
      reason: "runtime-restart",
      rebaselineRequired: true,
      scope: { kind: "workspace", workspaceId },
    });
    await waitFor(() => applied.length === 1);

    expect(requests).toEqual([{ workspaceId, reason: "runtime-restart" }]);
    expect(applied).toEqual([{ baseline, scope: { kind: "workspace", workspaceId } }]);
    store.dispose();
  });

  it("rebaselines both app and mounted-workspace scopes when the bridge scope is unknown", async () => {
    const requests: unknown[] = [];
    const scopes: unknown[] = [];
    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: async () => [],
          rebaselineStateReadModels: async (input) => {
            requests.push(input);
            return emptyBaseline();
          },
        },
        addMessageListener: () => {},
        removeMessageListener: () => {},
      },
      applyReadModelPatch: () => {},
      applyReadModelBaseline: (_baseline, scope) => scopes.push(scope),
    });

    store.handle({
      kind: "read-model-rebaseline-required",
      reason: "slow-consumer",
      rebaselineRequired: true,
    });
    await waitFor(() => scopes.length === 2);

    expect(requests).toEqual([
      { reason: "event-sequence-gap" },
      { workspaceId, reason: "event-sequence-gap" },
    ]);
    expect(scopes).toEqual([{ kind: "app" }, { kind: "workspace", workspaceId }]);
    store.dispose();
  });

  it("uses one sequence-aware lane for runtime and state-command invalidations", async () => {
    const listeners = new Set<(payload: DesktopRendererNotification) => void>();
    const firstRefetch = createDeferred<readonly StateReadModelResult[]>();
    const secondRefetch = createDeferred<readonly StateReadModelResult[]>();
    const thirdRefetch = createDeferred<readonly StateReadModelResult[]>();
    const postBaselineRefetch = createDeferred<readonly StateReadModelResult[]>();
    const secondRefetchStarted = createDeferred<void>();
    const thirdRefetchStarted = createDeferred<void>();
    const postBaselineRefetchStarted = createDeferred<void>();
    const newerPatchApplied = createDeferred<void>();
    const postBaselinePatchApplied = createDeferred<void>();
    const baselineRequested = createDeferred<void>();
    const baselineResult = createDeferred<StateReadModelBaseline>();
    const baselineApplied = createDeferred<void>();
    const refetches: unknown[] = [];
    const applications: Array<
      | { kind: "patch"; sequence: number; patch: readonly StateReadModelResult[] }
      | { kind: "baseline"; baseline: StateReadModelBaseline }
    > = [];
    const olderPatch: StateReadModelResult[] = [
      { kind: "appPreferences", value: { appearance: "dark" } as never },
    ];
    const newerPatch: StateReadModelResult[] = [
      { kind: "appPreferences", value: { appearance: "light" } as never },
    ];
    const preBaselinePatch: StateReadModelResult[] = [
      { kind: "appPreferences", value: { appearance: "dark" } as never },
    ];
    const postBaselinePatch: StateReadModelResult[] = [
      { kind: "appPreferences", value: { appearance: "system" } as never },
    ];
    const authoritativeBaseline = emptyBaseline();
    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: (input) => {
            refetches.push(input);
            if (refetches.length === 1) return firstRefetch.promise;
            if (refetches.length === 2) {
              secondRefetchStarted.resolve();
              return secondRefetch.promise;
            }
            if (refetches.length === 3) {
              thirdRefetchStarted.resolve();
              return thirdRefetch.promise;
            }
            postBaselineRefetchStarted.resolve();
            return postBaselineRefetch.promise;
          },
          rebaselineStateReadModels: () => {
            baselineRequested.resolve();
            return baselineResult.promise;
          },
        },
        addMessageListener: (_messageName, listener) => listeners.add(listener),
        removeMessageListener: (_messageName, listener) => listeners.delete(listener),
      },
      applyReadModelPatch: (patch, context) => {
        applications.push({ kind: "patch", sequence: context.sequence, patch });
        if (context.sequence === 2) newerPatchApplied.resolve();
        if (patch === postBaselinePatch) postBaselinePatchApplied.resolve();
      },
      applyReadModelBaseline: (baseline) => {
        applications.push({ kind: "baseline", baseline });
        baselineApplied.resolve();
      },
    });

    const listener = [...listeners][0]!;
    const runtimeInvalidation: DesktopRendererNotification = {
      kind: "read-model-changed",
      eventGenerationId: "generation-1" as never,
      sequence: 1 as never,
      scope: { kind: "app" },
      invalidation: { scope: "app", invalidation: { model: "appPreferences" } },
    };
    // Committed state commands and ordinary runtime work deliberately converge on this
    // renderer-safe shape; origin is not part of the public desktop contract.
    const stateCommandInvalidation: DesktopRendererNotification = {
      ...runtimeInvalidation,
      sequence: 2 as never,
    };
    listener(runtimeInvalidation);
    listener(stateCommandInvalidation);

    expect(refetches).toHaveLength(1);
    firstRefetch.resolve(olderPatch);
    await secondRefetchStarted.promise;
    expect(applications).toEqual([]);

    secondRefetch.resolve(newerPatch);
    await newerPatchApplied.promise;
    expect(applications).toEqual([{ kind: "patch", sequence: 2, patch: newerPatch }]);

    listener({ ...runtimeInvalidation, sequence: 3 as never });
    await thirdRefetchStarted.promise;
    listener({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
      rebaselineRequired: true,
      scope: { kind: "app" },
    });
    await baselineRequested.promise;
    baselineResult.resolve(authoritativeBaseline);
    await baselineApplied.promise;

    thirdRefetch.resolve(preBaselinePatch);
    listener({
      ...runtimeInvalidation,
      eventGenerationId: "generation-2" as never,
      sequence: 1 as never,
    });
    await postBaselineRefetchStarted.promise;
    postBaselineRefetch.resolve(postBaselinePatch);
    await postBaselinePatchApplied.promise;

    expect(applications).toEqual([
      { kind: "patch", sequence: 2, patch: newerPatch },
      { kind: "baseline", baseline: authoritativeBaseline },
      { kind: "patch", sequence: 1, patch: postBaselinePatch },
    ]);
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
