import { describe, expect, it } from "bun:test";
import type {
  DesktopRendererNotification,
  StateReadModelBaseline,
  StateReadModelResult,
} from "../shared/workspace-contract";
import {
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  type RuntimeSurfaceTarget,
  type WorkspaceId,
} from "@svvy/core";
import {
  createRendererNotificationStore,
  type SurfaceStreamPatchNotification,
  type SurfaceStreamResetSignal,
} from "./renderer-notifications";

const workspaceId = "workspace-renderer-notifications" as WorkspaceId;
const otherWorkspaceId = "workspace-renderer-notifications-other" as WorkspaceId;
const firstSurfaceTarget = {
  surface: "orchestrator",
  workspaceSessionId: "session-renderer-notifications",
  surfacePiSessionId: "surface-renderer-notifications-first",
} as RuntimeSurfaceTarget;
const secondSurfaceTarget = {
  surface: "orchestrator",
  workspaceSessionId: "session-renderer-notifications",
  surfacePiSessionId: "surface-renderer-notifications-second",
} as RuntimeSurfaceTarget;
const collidingSurfaceTarget = {
  surface: "orchestrator",
  workspaceSessionId: "different-session-renderer-notifications",
  surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
} as RuntimeSurfaceTarget;
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

  it("delivers complete stream patches only to subscribers for their surface target", () => {
    const firstPatches: SurfaceStreamPatchNotification[] = [];
    const secondPatches: SurfaceStreamPatchNotification[] = [];
    const collidingPatches: SurfaceStreamPatchNotification[] = [];
    const errors: string[] = [];
    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: async () => [],
          rebaselineStateReadModels: async () => emptyBaseline(),
        },
        addMessageListener: () => {},
        removeMessageListener: () => {},
      },
      applyReadModelPatch: () => {},
      applyReadModelBaseline: () => {},
      onError: (_error, context) => errors.push(context),
    });
    const unsubscribeFirst = store.subscribeSurface(firstSurfaceTarget, {
      onPatch: (notification) => firstPatches.push(notification),
      onReset: () => {},
    });
    store.subscribeSurface(secondSurfaceTarget, {
      onPatch: (notification) => secondPatches.push(notification),
      onReset: () => {},
    });
    store.subscribeSurface(collidingSurfaceTarget, {
      onPatch: (notification) => collidingPatches.push(notification),
      onReset: () => {},
    });
    const firstPatch = {
      kind: "surface-stream-patch",
      eventGenerationId: "event-generation-7" as never,
      sequence: 42 as never,
      workspaceId,
      target: firstSurfaceTarget,
      surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
      streamGenerationId: "stream-generation-3" as never,
      streamSequence: 9 as never,
      patch: {
        type: "assistant_text_delta",
        messageId: "message-1" as never,
        contentIndex: 0 as never,
        delta: "hello",
      },
    } satisfies SurfaceStreamPatchNotification;

    store.handle(firstPatch);

    expect(firstPatches).toEqual([firstPatch]);
    expect(firstPatches[0]).toMatchObject({
      eventGenerationId: "event-generation-7",
      sequence: 42,
      streamGenerationId: "stream-generation-3",
      streamSequence: 9,
    });
    expect(secondPatches).toEqual([]);
    expect(collidingPatches).toEqual([]);
    store.handle({
      ...firstPatch,
      sequence: 43 as never,
      surfacePiSessionId: secondSurfaceTarget.surfacePiSessionId,
    });
    expect(firstPatches).toEqual([firstPatch]);
    expect(errors).toEqual(["renderer-notifications.surface-target-mismatch"]);

    unsubscribeFirst();
    store.handle({ ...firstPatch, sequence: 44 as never, streamSequence: 10 as never });
    expect(firstPatches).toEqual([firstPatch]);
    store.dispose();
  });

  it("blocks discontinuous lanes without advancing them until the subscriber resumes", () => {
    const patches: SurfaceStreamPatchNotification[] = [];
    const resets: SurfaceStreamResetSignal[] = [];
    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: async () => [],
          rebaselineStateReadModels: async () => emptyBaseline(),
        },
        addMessageListener: () => {},
        removeMessageListener: () => {},
      },
      applyReadModelPatch: () => {},
      applyReadModelBaseline: () => {},
    });
    store.subscribeSurface(firstSurfaceTarget, {
      onPatch: (notification) => patches.push(notification),
      onReset: (signal) => resets.push(signal),
    });
    const patch = (
      streamGenerationId: string,
      streamSequence: number,
      sequence: number,
    ): SurfaceStreamPatchNotification => ({
      kind: "surface-stream-patch",
      eventGenerationId: "event-generation-1" as never,
      sequence: sequence as never,
      workspaceId,
      target: firstSurfaceTarget,
      surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
      streamGenerationId: streamGenerationId as never,
      streamSequence: streamSequence as never,
      patch: {
        type: "assistant_text_delta",
        messageId: "message-1" as never,
        contentIndex: 0 as never,
        delta: `${streamGenerationId}:${streamSequence}`,
      },
    });
    const first = patch("stream-generation-1", 1, 1);
    const generationMismatch = patch("stream-generation-2", 1, 2);
    const droppedWhileBlocked = patch("stream-generation-2", 2, 3);

    store.handle(first);
    store.handle(generationMismatch);
    store.handle(droppedWhileBlocked);

    expect(patches).toEqual([first]);
    expect(resets).toEqual([
      {
        workspaceId,
        target: firstSurfaceTarget,
        surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
        cursor: {
          eventGenerationId: first.eventGenerationId,
          eventSequence: first.sequence,
          streamGenerationId: first.streamGenerationId,
          streamSequence: first.streamSequence,
        },
        trigger: {
          kind: "discontinuity",
          reason: "stream-generation-mismatch",
          notification: generationMismatch,
        },
      },
    ]);

    store.resumeSurfaceAfterRebaseline(firstSurfaceTarget, {
      surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
      streamGenerationId: "stream-generation-2" as never,
      streamSequence: 2 as never,
    });
    const afterBaseline = patch("stream-generation-2", 3, 4);
    const sequenceGap = patch("stream-generation-2", 5, 5);
    store.handle(afterBaseline);
    store.handle(sequenceGap);

    expect(patches).toEqual([first, afterBaseline]);
    expect(resets[1]).toEqual({
      workspaceId,
      target: firstSurfaceTarget,
      surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
      cursor: {
        eventGenerationId: afterBaseline.eventGenerationId,
        eventSequence: afterBaseline.sequence,
        streamGenerationId: afterBaseline.streamGenerationId,
        streamSequence: afterBaseline.streamSequence,
      },
      trigger: {
        kind: "discontinuity",
        reason: "stream-sequence-gap",
        notification: sequenceGap,
        expectedStreamSequence: 4 as never,
      },
    });
    store.dispose();
  });

  it("signals targeted gap and explicit stream resets with the last delivered cursor", () => {
    const firstPatches: SurfaceStreamPatchNotification[] = [];
    const firstResets: SurfaceStreamResetSignal[] = [];
    const secondResets: SurfaceStreamResetSignal[] = [];
    const secondPatches: SurfaceStreamPatchNotification[] = [];
    const store = createRendererNotificationStore({
      workspaceId,
      rpcClient: {
        request: {
          refetchStateReadModelInvalidation: async () => [],
          rebaselineStateReadModels: async () => emptyBaseline(),
        },
        addMessageListener: () => {},
        removeMessageListener: () => {},
      },
      applyReadModelPatch: () => {},
      applyReadModelBaseline: () => {},
    });
    store.subscribeSurface(firstSurfaceTarget, {
      onPatch: (notification) => firstPatches.push(notification),
      onReset: (signal) => firstResets.push(signal),
    });
    store.subscribeSurface(secondSurfaceTarget, {
      onPatch: (notification) => secondPatches.push(notification),
      onReset: (signal) => secondResets.push(signal),
    });
    store.handle({
      kind: "surface-stream-patch",
      eventGenerationId: "event-generation-1" as never,
      sequence: 5 as never,
      workspaceId,
      target: firstSurfaceTarget,
      surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
      streamGenerationId: "first-stream-generation" as never,
      streamSequence: 2 as never,
      patch: {
        type: "assistant_text_delta",
        messageId: "first-message" as never,
        contentIndex: 0 as never,
        delta: "partial",
      },
    });
    const gap = {
      kind: "read-model-rebaseline-required",
      reason: "surface-stream-gap",
      rebaselineRequired: true,
      eventGenerationId: "event-generation-1" as never,
      lastContiguousSequence: 5 as never,
      scope: {
        kind: "surface",
        workspaceId,
        surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
      },
    } satisfies DesktopRendererNotification;

    store.handle(gap);

    expect(firstResets).toEqual([
      {
        workspaceId,
        target: firstSurfaceTarget,
        surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
        cursor: {
          eventGenerationId: gap.eventGenerationId!,
          eventSequence: gap.lastContiguousSequence!,
          streamGenerationId: "first-stream-generation" as never,
          streamSequence: 2 as never,
        },
        trigger: { kind: "rebaseline-required", notification: gap },
      },
    ]);
    expect(secondResets).toEqual([]);
    store.handle({
      kind: "surface-stream-patch",
      eventGenerationId: "event-generation-1" as never,
      sequence: 6 as never,
      workspaceId,
      target: firstSurfaceTarget,
      surfacePiSessionId: firstSurfaceTarget.surfacePiSessionId,
      streamGenerationId: "first-stream-generation" as never,
      streamSequence: 3 as never,
      patch: {
        type: "assistant_text_delta",
        messageId: "first-message" as never,
        contentIndex: 0 as never,
        delta: "dropped until the baseline is applied",
      },
    });
    expect(firstPatches).toHaveLength(1);

    const resetPatch = {
      kind: "surface-stream-patch",
      eventGenerationId: "event-generation-1" as never,
      sequence: 6 as never,
      workspaceId,
      target: secondSurfaceTarget,
      surfacePiSessionId: secondSurfaceTarget.surfacePiSessionId,
      streamGenerationId: "second-stream-generation" as never,
      streamSequence: 1 as never,
      patch: {
        type: "stream_reset",
        reason: "surface_reopened",
        latestStreamSequence: 0 as never,
      },
    } satisfies SurfaceStreamPatchNotification;
    store.handle(resetPatch);

    expect(secondPatches).toEqual([resetPatch]);
    expect(secondResets).toEqual([
      {
        workspaceId,
        target: secondSurfaceTarget,
        surfacePiSessionId: secondSurfaceTarget.surfacePiSessionId,
        cursor: {
          eventGenerationId: resetPatch.eventGenerationId,
          eventSequence: resetPatch.sequence,
          streamGenerationId: resetPatch.streamGenerationId,
          streamSequence: resetPatch.streamSequence,
        },
        trigger: { kind: "stream-reset", notification: resetPatch },
      },
    ]);
    store.handle({
      ...resetPatch,
      sequence: 7 as never,
      streamSequence: 2 as never,
      patch: {
        type: "assistant_text_delta",
        messageId: "second-message" as never,
        contentIndex: 0 as never,
        delta: "also dropped until the baseline is applied",
      },
    });
    expect(secondPatches).toEqual([resetPatch]);
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
