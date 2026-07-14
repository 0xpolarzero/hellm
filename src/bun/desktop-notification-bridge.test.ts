import { describe, expect, it } from "bun:test";
import type {
  RuntimeEvent,
  RuntimeEventSubscriptionClose,
  StateInvalidationDescriptor,
} from "@svvy/core";
import {
  createDesktopNotificationBridge,
  mapRuntimeEventToDesktopNotification,
  type RuntimeEventSubscriptionLike,
} from "./desktop-notification-bridge";
import type {
  DesktopRendererNotification,
  StateReadModelResult,
} from "../shared/workspace-contract";

const workspaceId = "workspace-1" as never;
const generationId = "runtime-event-generation-1" as never;
const surfaceGenerationId = "surface-generation-1" as never;
const target = {
  surface: "orchestrator",
  workspaceSessionId: "session-1",
  surfacePiSessionId: "surface-1",
} as never;

describe("desktop notification bridge", () => {
  it("observes each emitted notification without coupling delivery failures", async () => {
    const appSubscription = new PushSubscription();
    const rendered: DesktopRendererNotification[] = [];
    const observed: DesktopRendererNotification[] = [];
    const errors: string[] = [];
    const bridge = createDesktopNotificationBridge({
      runtimeEvents: async () => appSubscription,
      state: stateWithWorkspaceTabs([]),
      rendererEmit: (notification) => {
        rendered.push(notification);
        throw new Error("renderer failed");
      },
      onNotification: (notification) => {
        observed.push(notification);
        throw new Error("observer failed");
      },
      onError: (_error, context) => errors.push(context),
    });

    await bridge.start();
    try {
      appSubscription.push(
        runtimeEvent({
          type: "app_read_model.changed",
          eventGenerationId: generationId,
          sequence: 1 as never,
          invalidation: { model: "settings" },
        }),
      );
      await waitFor(() => rendered.length === 1 && observed.length === 1 && errors.length === 2);

      expect(rendered[0]).toEqual(observed[0]);
      expect(observed[0]).toMatchObject({
        kind: "read-model-changed",
        invalidation: { scope: "app", invalidation: { model: "settings" } },
      });
      expect(errors).toEqual([
        "desktop-notification-bridge.rendererEmit",
        "desktop-notification-bridge.onNotification",
      ]);
    } finally {
      await bridge.stop();
    }
  });

  it("maps the eight runtime event rows to exact renderer notifications", () => {
    const surfaceStream = mapRuntimeEventToDesktopNotification(
      runtimeEvent({
        type: "surface.stream",
        workspaceId,
        target,
        eventGenerationId: generationId,
        sequence: 1 as never,
        streamGenerationId: surfaceGenerationId,
        streamSequence: 1 as never,
        patch: {
          type: "assistant_message_started",
          messageId: "message-1" as never,
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:00.000Z" as never,
        },
      }),
      { surfaceCursors: new Map() },
    );
    expect(surfaceStream).toMatchObject({
      kind: "surface-stream-patch",
      sequence: 1,
      streamSequence: 1,
      surfacePiSessionId: "surface-1",
    });

    expect(
      mapRuntimeEventToDesktopNotification(
        runtimeEvent({
          type: "command.changed",
          eventGenerationId: generationId,
          sequence: 2 as never,
          workspaceId,
          workspaceSessionId: "session-1" as never,
          target,
          commandId: "command-1" as never,
          change: { kind: "output" },
        }),
      ),
    ).toMatchObject({
      kind: "read-model-changed",
      scope: { kind: "surface", workspaceId, surfacePiSessionId: "surface-1" },
      invalidation: {
        scope: "workspace",
        workspaceId,
        invalidation: { model: "commandInspector", ids: ["command-1"] },
      },
    });

    for (const notification of [
      mapRuntimeEventToDesktopNotification(
        runtimeEvent({
          type: "queue.changed",
          eventGenerationId: generationId,
          sequence: 3 as never,
          workspaceId,
          target,
          queuedMessageId: "queue-1" as never,
          status: "queued",
        }),
      ),
      mapRuntimeEventToDesktopNotification(
        runtimeEvent({
          type: "turn.changed",
          eventGenerationId: generationId,
          sequence: 4 as never,
          workspaceId,
          target,
          turnId: "turn-1" as never,
          status: "running",
        }),
      ),
      mapRuntimeEventToDesktopNotification(
        runtimeEvent({
          type: "surface.changed",
          eventGenerationId: generationId,
          sequence: 5 as never,
          workspaceId,
          target,
          reason: "surface.updated",
        }),
      ),
    ]) {
      expect(notification).toMatchObject({
        kind: "read-model-changed",
        invalidation: {
          scope: "workspace",
          workspaceId,
          invalidation: { model: "surface", ids: ["surface-1"] },
        },
      });
    }

    const appDescriptor: StateInvalidationDescriptor = {
      scope: "app",
      invalidation: { model: "appPreferences" },
    };
    expect(
      mapRuntimeEventToDesktopNotification(
        runtimeEvent({
          type: "app_read_model.changed",
          eventGenerationId: generationId,
          sequence: 6 as never,
          invalidation: appDescriptor.invalidation,
        }),
      ),
    ).toMatchObject({
      kind: "read-model-changed",
      scope: { kind: "app" },
      invalidation: appDescriptor,
    });

    const workspaceDescriptor: StateInvalidationDescriptor = {
      scope: "workspace",
      workspaceId,
      invalidation: { model: "sessionNavigation" },
    };
    expect(
      mapRuntimeEventToDesktopNotification(
        runtimeEvent({
          type: "workspace_read_model.changed",
          eventGenerationId: generationId,
          sequence: 7 as never,
          workspaceId,
          invalidation: workspaceDescriptor.invalidation,
        }),
      ),
    ).toMatchObject({
      kind: "read-model-changed",
      scope: { kind: "workspace", workspaceId },
      invalidation: workspaceDescriptor,
    });

    expect(
      mapRuntimeEventToDesktopNotification(
        runtimeEvent({
          type: "runtime.recovery",
          eventGenerationId: generationId,
          sequence: 8 as never,
          scope: "app",
          workId: "recovery-1" as never,
          status: "completed",
        }),
      ),
    ).toMatchObject({
      kind: "read-model-changed",
      scope: { kind: "app" },
      invalidation: { scope: "app", invalidation: { model: "appLogs" } },
    });
  });

  it("downgrades surface stream generation mismatches and streamSequence gaps to rebaseline", () => {
    const cursors = new Map();
    expect(
      mapRuntimeEventToDesktopNotification(
        surfaceStreamEvent({ sequence: 1, streamSequence: 1, streamGenerationId: "gen-a" }),
        { surfaceCursors: cursors },
      )?.kind,
    ).toBe("surface-stream-patch");
    expect(
      mapRuntimeEventToDesktopNotification(
        surfaceStreamEvent({ sequence: 2, streamSequence: 3, streamGenerationId: "gen-a" }),
        { surfaceCursors: cursors },
      ),
    ).toMatchObject({ kind: "read-model-rebaseline-required", reason: "surface-stream-gap" });
    expect(
      mapRuntimeEventToDesktopNotification(
        surfaceStreamEvent({ sequence: 3, streamSequence: 2, streamGenerationId: "gen-b" }),
        { surfaceCursors: cursors },
      ),
    ).toMatchObject({
      kind: "read-model-rebaseline-required",
      reason: "surface-stream-generation-mismatch",
    });
  });

  it("tracks the same surface id independently in different workspaces", () => {
    const cursors = new Map();

    expect(
      mapRuntimeEventToDesktopNotification(
        surfaceStreamEvent({
          sequence: 1,
          streamSequence: 1,
          streamGenerationId: "workspace-1-generation",
          workspaceId: "workspace-1",
        }),
        { surfaceCursors: cursors },
      ),
    ).toMatchObject({ kind: "surface-stream-patch", workspaceId: "workspace-1" });
    expect(
      mapRuntimeEventToDesktopNotification(
        surfaceStreamEvent({
          sequence: 2,
          streamSequence: 1,
          streamGenerationId: "workspace-2-generation",
          workspaceId: "workspace-2",
        }),
        { surfaceCursors: cursors },
      ),
    ).toMatchObject({ kind: "surface-stream-patch", workspaceId: "workspace-2" });
    expect(
      mapRuntimeEventToDesktopNotification(
        surfaceStreamEvent({
          sequence: 3,
          streamSequence: 2,
          streamGenerationId: "workspace-1-generation",
          workspaceId: "workspace-1",
        }),
        { surfaceCursors: cursors },
      ),
    ).toMatchObject({
      kind: "surface-stream-patch",
      workspaceId: "workspace-1",
      streamSequence: 2,
    });
  });

  it("resumes after a surface stream generation rebaseline from the triggering event", async () => {
    const notifications: DesktopRendererNotification[] = [];
    const rebaselines: unknown[] = [];
    const workspaceSubscriptionInputs: unknown[] = [];
    const appSubscription = new PushSubscription();
    const firstWorkspaceSubscription = new PushSubscription();
    const replacementWorkspaceSubscription = new PushSubscription();
    const bridge = createDesktopNotificationBridge({
      runtimeEvents: async (input) => {
        if (!input?.workspaceId) {
          return appSubscription;
        }
        workspaceSubscriptionInputs.push(input);
        return workspaceSubscriptionInputs.length === 1
          ? firstWorkspaceSubscription
          : replacementWorkspaceSubscription;
      },
      state: stateWithWorkspaceTabs(["workspace-1"], (input) => rebaselines.push(input)),
      rendererEmit: (notification) => {
        notifications.push(notification);
      },
    });

    await bridge.start();
    await firstWorkspaceSubscription.waitForNextCall(1);
    firstWorkspaceSubscription.push(
      surfaceStreamEvent({
        sequence: 1,
        streamSequence: 1,
        streamGenerationId: "turn-1-generation",
      }),
    );
    await waitFor(
      () =>
        notifications.filter((notification) => notification.kind === "surface-stream-patch")
          .length === 1,
    );

    firstWorkspaceSubscription.push(
      surfaceStreamEvent({
        sequence: 2,
        streamSequence: 1,
        streamGenerationId: "turn-2-generation",
      }),
    );
    await waitFor(() => workspaceSubscriptionInputs.length === 2);

    expect(rebaselines).toEqual([{ workspaceId, reason: "event-sequence-gap" }]);
    expect(workspaceSubscriptionInputs[1]).toEqual({
      workspaceId,
      includeAppEvents: false,
      eventGenerationId: generationId,
      afterSequence: 2,
    });
    expect(
      notifications.filter(
        (notification) => notification.kind === "read-model-rebaseline-required",
      ),
    ).toEqual([
      expect.objectContaining({
        reason: "surface-stream-generation-mismatch",
        scope: { kind: "surface", workspaceId, surfacePiSessionId: "surface-1" },
      }),
    ]);

    replacementWorkspaceSubscription.push(
      surfaceStreamEvent({
        sequence: 3,
        streamSequence: 2,
        streamGenerationId: "turn-2-generation",
      }),
    );
    await waitFor(
      () =>
        notifications.filter((notification) => notification.kind === "surface-stream-patch")
          .length === 2,
    );

    expect(
      notifications.filter(
        (notification) => notification.kind === "read-model-rebaseline-required",
      ),
    ).toHaveLength(1);
    expect(notifications).toContainEqual(
      expect.objectContaining({
        kind: "surface-stream-patch",
        streamGenerationId: "turn-2-generation",
        streamSequence: 2,
      }),
    );
    await bridge.stop();
  });

  it("downgrades scope and descriptor mismatches to rebaseline", () => {
    expect(
      mapRuntimeEventToDesktopNotification(
        runtimeEvent({
          type: "workspace_read_model.changed",
          eventGenerationId: generationId,
          sequence: 1 as never,
          workspaceId: "workspace-2" as never,
          invalidation: { model: "sessionNavigation" },
        }),
        { subscriptionScope: "workspace", expectedWorkspaceId: workspaceId },
      ),
    ).toMatchObject({
      kind: "read-model-rebaseline-required",
      reason: "scope-descriptor-mismatch",
      rebaselineRequired: true,
    });
  });

  for (const reason of ["slow-consumer", "runtime-restart"] as const) {
    it(`rebaselines authoritatively before reopening after ${reason}`, async () => {
      const notifications: DesktopRendererNotification[] = [];
      const first = new PushSubscription();
      const replacement = new PushSubscription();
      const subscriptionInputs: unknown[] = [];
      const ordering: string[] = [];
      const bridge = createDesktopNotificationBridge({
        runtimeEvents: async (input) => {
          subscriptionInputs.push(input);
          ordering.push(`subscribe:${subscriptionInputs.length}`);
          return subscriptionInputs.length === 1 ? first : replacement;
        },
        state: stateWithWorkspaceTabs([], () => ordering.push("rebaseline")),
        rendererEmit: (notification) => {
          notifications.push(notification);
        },
      });

      await bridge.start();
      first.finish(closedReceipt(reason, 5));
      await waitFor(() => subscriptionInputs.length === 2);

      expect(ordering).toEqual(["subscribe:1", "rebaseline", "subscribe:2"]);
      expect(subscriptionInputs[1]).toEqual({ includeAppEvents: true });
      expect(notifications).toContainEqual(
        expect.objectContaining({
          kind: "read-model-rebaseline-required",
          reason,
          rebaselineRequired: true,
          lastContiguousSequence: 5,
        }),
      );
      await bridge.stop();
    });
  }

  it("rebaselines and reopens when the app subscription observes an event-sequence gap", async () => {
    const notifications: DesktopRendererNotification[] = [];
    const first = new PushSubscription();
    const replacement = new PushSubscription();
    const subscriptionInputs: unknown[] = [];
    const rebaselines: unknown[] = [];
    const bridge = createDesktopNotificationBridge({
      runtimeEvents: async (input) => {
        subscriptionInputs.push(input);
        return subscriptionInputs.length === 1 ? first : replacement;
      },
      state: stateWithWorkspaceTabs([], (input) => rebaselines.push(input)),
      rendererEmit: (notification) => {
        notifications.push(notification);
      },
    });

    await bridge.start();
    first.push(
      runtimeEvent({
        type: "app_read_model.changed",
        eventGenerationId: generationId,
        sequence: 1 as never,
        invalidation: { model: "appPreferences" },
      }),
    );
    await waitFor(() =>
      notifications.some((notification) => notification.kind === "read-model-changed"),
    );
    first.push(
      runtimeEvent({
        type: "app_read_model.changed",
        eventGenerationId: generationId,
        sequence: 3 as never,
        invalidation: { model: "settings" },
      }),
    );
    await waitFor(() => subscriptionInputs.length === 2);

    expect(rebaselines).toEqual([{ reason: "event-sequence-gap" }]);
    expect(notifications).toContainEqual(
      expect.objectContaining({
        kind: "read-model-rebaseline-required",
        reason: "event-sequence-gap",
        lastContiguousSequence: 1,
      }),
    );
    expect(subscriptionInputs[1]).toEqual({ includeAppEvents: true });
    await bridge.stop();
  });

  it("rebaselines a replay-window setup failure before retrying without the stale cursor", async () => {
    const first = new PushSubscription();
    const replacement = new PushSubscription();
    const subscriptionInputs: unknown[] = [];
    const ordering: string[] = [];
    const notifications: DesktopRendererNotification[] = [];
    const bridge = createDesktopNotificationBridge({
      runtimeEvents: async (input) => {
        subscriptionInputs.push(input);
        ordering.push(`subscribe:${subscriptionInputs.length}`);
        if (subscriptionInputs.length === 2) {
          throw {
            type: "runtime-facade-error",
            reason: "typed-failure",
            error: {
              _tag: "RuntimeEventRebaselineRequired",
              reason: "stale-cursor",
              eventGenerationId: generationId,
              currentHighWaterSequence: 9,
            },
          };
        }
        return subscriptionInputs.length === 1 ? first : replacement;
      },
      state: stateWithWorkspaceTabs([], () => ordering.push("rebaseline")),
      rendererEmit: (notification) => {
        notifications.push(notification);
      },
    });

    await bridge.start();
    first.push(
      runtimeEvent({
        type: "app_read_model.changed",
        eventGenerationId: generationId,
        sequence: 4 as never,
        invalidation: { model: "appPreferences" },
      }),
    );
    await waitFor(() =>
      notifications.some((notification) => notification.kind === "read-model-changed"),
    );
    first.finish({
      reason: "closed",
      eventGenerationId: generationId,
      lastContiguousSequence: 4 as never,
      rebaselineRequired: false,
    });
    await waitFor(() => subscriptionInputs.length === 3);

    expect(ordering).toEqual(["subscribe:1", "subscribe:2", "rebaseline", "subscribe:3"]);
    expect(subscriptionInputs[1]).toEqual({
      includeAppEvents: true,
      eventGenerationId: generationId,
      afterSequence: 4,
    });
    expect(subscriptionInputs[2]).toEqual({ includeAppEvents: true });
    await bridge.stop();
  });

  it("closes only the workspace subscription removed from authoritative tab state", async () => {
    const workspaceIds = ["workspace-1", "workspace-2"];
    const appSubscription = new PushSubscription();
    const firstWorkspaceSubscription = new PushSubscription();
    const secondWorkspaceSubscription = new PushSubscription();
    const bridge = createDesktopNotificationBridge({
      runtimeEvents: async (input) => {
        if (input?.workspaceId === ("workspace-1" as never)) {
          return firstWorkspaceSubscription;
        }
        if (input?.workspaceId === ("workspace-2" as never)) {
          return secondWorkspaceSubscription;
        }
        return appSubscription;
      },
      state: stateWithWorkspaceTabs(workspaceIds),
      rendererEmit: () => {},
    });

    await bridge.start();
    await Promise.all([
      appSubscription.waitForNextCall(1),
      firstWorkspaceSubscription.waitForNextCall(1),
      secondWorkspaceSubscription.waitForNextCall(1),
    ]);
    workspaceIds.splice(0, 1);
    appSubscription.push(
      runtimeEvent({
        type: "app_read_model.changed",
        eventGenerationId: generationId,
        sequence: 1 as never,
        invalidation: { model: "workspaceChrome" },
      }),
    );
    await waitFor(() => firstWorkspaceSubscription.closeCalls === 1);

    expect(appSubscription.closeCalls).toBe(0);
    expect(firstWorkspaceSubscription.closeCalls).toBe(1);
    expect(secondWorkspaceSubscription.closeCalls).toBe(0);

    await bridge.stop();
    expect(appSubscription.closeCalls).toBe(1);
    expect(firstWorkspaceSubscription.closeCalls).toBe(1);
    expect(secondWorkspaceSubscription.closeCalls).toBe(1);
  });

  it("closes the injected runtime subscription once and suppresses fanout after stop", async () => {
    const notifications: DesktopRendererNotification[] = [];
    const subscription = new PushSubscription();
    const bridge = createDesktopNotificationBridge({
      runtimeEvents: async () => subscription,
      state: stateWithWorkspaceTabs([]),
      rendererEmit: (notification) => {
        notifications.push(notification);
      },
    });

    await bridge.start();
    await bridge.stop();
    await bridge.stop();
    subscription.push(
      runtimeEvent({
        type: "app_read_model.changed",
        eventGenerationId: generationId,
        sequence: 1 as never,
        invalidation: { model: "appPreferences" },
      }),
    );

    expect(subscription.closeCalls).toBe(1);
    expect(notifications).toEqual([{ kind: "app-shutdown", reason: "bridge-stopped" }]);
  });
});

function runtimeEvent(input: RuntimeEvent): RuntimeEvent {
  return input;
}

function surfaceStreamEvent(input: {
  sequence: number;
  streamSequence: number;
  streamGenerationId: string;
  workspaceId?: string;
  surfacePiSessionId?: string;
}): RuntimeEvent {
  return runtimeEvent({
    type: "surface.stream",
    workspaceId: (input.workspaceId ?? workspaceId) as never,
    target: {
      surface: "orchestrator",
      workspaceSessionId: "session-1",
      surfacePiSessionId: input.surfacePiSessionId ?? "surface-1",
    } as never,
    eventGenerationId: generationId,
    sequence: input.sequence as never,
    streamGenerationId: input.streamGenerationId as never,
    streamSequence: input.streamSequence as never,
    patch: {
      type: "assistant_text_delta",
      messageId: "message-1" as never,
      contentIndex: 0,
      delta: "hello",
    },
  });
}

function stateWithWorkspaceTabs(workspaceIds: string[], onRebaseline?: (input: unknown) => void) {
  return {
    readModels: {
      fetch: async (): Promise<StateReadModelResult> => ({
        kind: "workspaceChrome",
        value: {
          activeWorkspaceTabId: null,
          knownWorkspaces: [],
          tabs: workspaceIds.map((id) => ({
            workspaceId: id as never,
            workspaceTabId: `tab-${id}` as never,
            cwd: `/tmp/${id}` as never,
            workspaceLabel: id,
            kind: "user" as const,
            openedAt: "2026-01-01T00:00:00.000Z" as never,
            activeLayoutId: "A",
          })),
        },
      }),
      rebaseline: async (input: unknown) => {
        onRebaseline?.(input);
        return { app: [], workspaces: [], revision: 0 as never };
      },
    },
  };
}

class PushSubscription implements RuntimeEventSubscriptionLike {
  private queue: RuntimeEvent[] = [];
  private waiting: ((result: IteratorResult<RuntimeEvent>) => void) | null = null;
  private done = false;
  private nextCallCount = 0;
  private nextCallWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = [];
  private readonly resolveClosed: (receipt: RuntimeEventSubscriptionClose) => void;
  readonly closed: Promise<RuntimeEventSubscriptionClose>;
  closeCalls = 0;

  constructor() {
    let resolveClosed!: (receipt: RuntimeEventSubscriptionClose) => void;
    this.closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    this.resolveClosed = resolveClosed;
  }

  finish(receipt: RuntimeEventSubscriptionClose): void {
    if (this.done) return;
    this.done = true;
    this.waiting?.({ done: true, value: undefined });
    this.waiting = null;
    this.resolveClosed(receipt);
  }

  push(event: RuntimeEvent): void {
    if (this.done) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: false, value: event });
      return;
    }
    this.queue.push(event);
  }

  waitForNextCall(count: number): Promise<void> {
    if (this.nextCallCount >= count) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.nextCallWaiters.push({ count, resolve });
    });
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.finish({
      reason: "closed",
      eventGenerationId: generationId,
      lastContiguousSequence: 0 as never,
      rebaselineRequired: false,
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return {
      next: () => {
        this.nextCallCount += 1;
        const readyWaiters = this.nextCallWaiters.filter(
          (waiter) => this.nextCallCount >= waiter.count,
        );
        this.nextCallWaiters = this.nextCallWaiters.filter(
          (waiter) => this.nextCallCount < waiter.count,
        );
        for (const waiter of readyWaiters) {
          waiter.resolve();
        }
        const value = this.queue.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.done) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
      return: async () => {
        await this.close();
        return { done: true, value: undefined };
      },
    };
  }
}

function closedReceipt(
  reason: "slow-consumer" | "runtime-restart",
  lastContiguousSequence: number,
): RuntimeEventSubscriptionClose {
  return {
    reason,
    eventGenerationId: generationId,
    lastContiguousSequence: lastContiguousSequence as never,
    rebaselineRequired: true,
  };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(assertion()).toBe(true);
}
