import type {
  CommandId,
  RuntimeEvent,
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  RuntimeEventSubscriptionClose,
  RuntimeEventsInput,
  StateInvalidationDescriptor,
  SurfacePiSessionId,
  SurfaceStreamGenerationId,
  SurfaceStreamSequence,
  WorkspaceId,
} from "@svvy/core";
import type {
  DesktopRendererCommand,
  DesktopRendererNotification,
  DesktopRendererNotificationScope,
  StateReadModelBaseline,
  StateReadModelRebaselineRequest,
  StateReadModelResult,
} from "../shared/workspace-contract";

export interface RuntimeEventSubscriptionLike extends AsyncIterable<RuntimeEvent> {
  close(): Promise<void>;
  readonly closed: Promise<RuntimeEventSubscriptionClose>;
}

export interface DesktopNotificationBridgeState {
  readonly readModels: {
    fetch(input: { readonly kind: "workspaceChrome" }): Promise<StateReadModelResult>;
    rebaseline(input: StateReadModelRebaselineRequest): Promise<StateReadModelBaseline>;
  };
}

export interface CreateDesktopNotificationBridgeOptions {
  readonly runtimeEvents: (input?: RuntimeEventsInput) => Promise<RuntimeEventSubscriptionLike>;
  readonly state: DesktopNotificationBridgeState;
  readonly rendererEmit: (notification: DesktopRendererNotification) => void | Promise<void>;
  readonly onNotification?: (notification: DesktopRendererNotification) => void | Promise<void>;
  readonly onError?: (error: unknown, context: string) => void;
}

export interface DesktopNotificationBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
}

type SubscriptionRecord = {
  readonly key: string;
  readonly context: SubscriptionContext;
  readonly subscription: RuntimeEventSubscriptionLike;
  stopped: boolean;
  recovering: boolean;
};

type SubscriptionContext =
  | { readonly kind: "app" }
  | { readonly kind: "workspace"; readonly workspaceId: WorkspaceId };

type RuntimeEventCursor = {
  readonly eventGenerationId: RuntimeEventGenerationId;
  readonly lastSequence: RuntimeEventSequence;
};

type SurfaceStreamCursor = {
  readonly generationId: SurfaceStreamGenerationId;
  readonly lastStreamSequence: SurfaceStreamSequence;
};
type SurfaceStreamCursors = Map<WorkspaceId, Map<SurfacePiSessionId, SurfaceStreamCursor>>;
type SurfaceStreamEvent = Extract<RuntimeEvent, { readonly type: "surface.stream" }>;
type ReadModelChangedNotification = Extract<
  DesktopRendererNotification,
  { readonly kind: "read-model-changed" }
>;
type RebaselineNotification = Extract<
  DesktopRendererNotification,
  { readonly kind: "read-model-rebaseline-required" }
>;

const appScope: DesktopRendererNotificationScope = { kind: "app" };

export function createDesktopNotificationBridge(
  options: CreateDesktopNotificationBridgeOptions,
): DesktopNotificationBridge {
  let started = false;
  let stopped = false;
  let workspaceScopeReconcileTimer: ReturnType<typeof setInterval> | null = null;
  let reconciliation: Promise<void> | null = null;
  const subscriptions = new Map<string, SubscriptionRecord>();
  const openingKeys = new Set<string>();
  const recoveringKeys = new Set<string>();
  const pendingRebaselines = new Map<
    string,
    {
      readonly context: SubscriptionContext;
      readonly notification: RebaselineNotification;
      readonly resumeFromSurfaceStreamEvent?: SurfaceStreamEvent;
    }
  >();
  const eventCursors = new Map<string, RuntimeEventCursor>();
  const surfaceCursors: SurfaceStreamCursors = new Map();

  const emit = (notification: DesktopRendererNotification): void => {
    if (stopped) {
      return;
    }
    void Promise.resolve()
      .then(() => options.rendererEmit(notification))
      .catch((error) => options.onError?.(error, "desktop-notification-bridge.rendererEmit"));
    void Promise.resolve()
      .then(() => options.onNotification?.(notification))
      .catch((error) => options.onError?.(error, "desktop-notification-bridge.onNotification"));
  };

  const clearScopeCursors = (context: SubscriptionContext): void => {
    eventCursors.delete(subscriptionKey(context));
    if (context.kind === "app") {
      return;
    }
    surfaceCursors.delete(context.workspaceId);
  };

  const closeSubscription = async (
    record: SubscriptionRecord,
    input: { readonly clearCursors: boolean },
  ): Promise<void> => {
    record.stopped = true;
    if (subscriptions.get(record.key) === record) {
      subscriptions.delete(record.key);
    }
    if (input.clearCursors) {
      clearScopeCursors(record.context);
    }
    await record.subscription.close().catch((error) => {
      options.onError?.(error, "desktop-notification-bridge.subscription.close");
    });
  };

  const openSubscription = async (context: SubscriptionContext): Promise<void> => {
    const key = subscriptionKey(context);
    if (stopped || subscriptions.has(key) || openingKeys.has(key) || recoveringKeys.has(key)) {
      return;
    }
    openingKeys.add(key);
    let subscription: RuntimeEventSubscriptionLike;
    try {
      subscription = await options.runtimeEvents(
        runtimeEventsInput(context, eventCursors.get(key)),
      );
    } catch (error) {
      const replayFailure = runtimeEventRebaselineFailure(error);
      if (replayFailure) {
        const notification = rebaseline(
          replayFailure.reason === "generation-changed" ? "runtime-restart" : "event-sequence-gap",
          replayFailure.eventGenerationId,
          scopeForContext(context),
          replayFailure.currentHighWaterSequence,
        );
        pendingRebaselines.set(key, { context, notification });
        openingKeys.delete(key);
        await recoverScope(context, notification);
        return;
      }
      throw error;
    } finally {
      openingKeys.delete(key);
    }
    if (stopped || subscriptions.has(key)) {
      await subscription.close().catch((error) => {
        options.onError?.(error, "desktop-notification-bridge.subscription.close-unused");
      });
      return;
    }
    const record: SubscriptionRecord = {
      key,
      context,
      subscription,
      stopped: false,
      recovering: false,
    };
    subscriptions.set(key, record);
    void pumpSubscription(record);
    void watchSubscriptionClose(record);
  };

  const ensureSubscription = async (context: SubscriptionContext): Promise<void> => {
    const pending = pendingRebaselines.get(subscriptionKey(context));
    if (pending) {
      await recoverScope(
        pending.context,
        pending.notification,
        undefined,
        pending.resumeFromSurfaceStreamEvent,
      );
      return;
    }
    await openSubscription(context);
  };

  const reconcileSubscriptions = async (): Promise<void> => {
    await ensureSubscription({ kind: "app" });
    const workspaceIds = await resolveWorkspaceIdsFromState(options.state);
    const desiredKeys = new Set(workspaceIds.map((workspaceId) => `workspace:${workspaceId}`));
    for (const [key, record] of subscriptions) {
      if (key.startsWith("workspace:") && !desiredKeys.has(key)) {
        pendingRebaselines.delete(key);
        await closeSubscription(record, { clearCursors: true });
      }
    }
    await Promise.all(
      workspaceIds.map((workspaceId) => ensureSubscription({ kind: "workspace", workspaceId })),
    );
  };

  const scheduleReconciliation = (): Promise<void> => {
    if (reconciliation) {
      return reconciliation;
    }
    reconciliation = reconcileSubscriptions().finally(() => {
      reconciliation = null;
    });
    return reconciliation;
  };

  const recoverScope = async (
    context: SubscriptionContext,
    notification: RebaselineNotification,
    record?: SubscriptionRecord,
    resumeFromSurfaceStreamEvent?: SurfaceStreamEvent,
  ): Promise<void> => {
    const key = subscriptionKey(context);
    if (stopped || recoveringKeys.has(key) || record?.recovering) {
      return;
    }
    recoveringKeys.add(key);
    pendingRebaselines.set(key, {
      context,
      notification,
      ...(resumeFromSurfaceStreamEvent ? { resumeFromSurfaceStreamEvent } : {}),
    });
    if (record) {
      record.recovering = true;
      await closeSubscription(record, { clearCursors: false });
    } else {
      const current = subscriptions.get(key);
      if (current) {
        current.recovering = true;
        await closeSubscription(current, { clearCursors: false });
      }
    }
    try {
      await options.state.readModels.rebaseline({
        ...(context.kind === "workspace" ? { workspaceId: context.workspaceId } : {}),
        reason:
          notification.reason === "runtime-restart" ? "runtime-restart" : "event-sequence-gap",
      });
      if (
        resumeFromSurfaceStreamEvent &&
        context.kind === "workspace" &&
        resumeFromSurfaceStreamEvent.workspaceId === context.workspaceId
      ) {
        eventCursors.set(key, {
          eventGenerationId: resumeFromSurfaceStreamEvent.eventGenerationId,
          lastSequence: resumeFromSurfaceStreamEvent.sequence,
        });
        let workspaceSurfaceCursors = surfaceCursors.get(context.workspaceId);
        if (!workspaceSurfaceCursors) {
          workspaceSurfaceCursors = new Map();
          surfaceCursors.set(context.workspaceId, workspaceSurfaceCursors);
        }
        workspaceSurfaceCursors.set(resumeFromSurfaceStreamEvent.target.surfacePiSessionId, {
          generationId: resumeFromSurfaceStreamEvent.streamGenerationId,
          lastStreamSequence: resumeFromSurfaceStreamEvent.streamSequence,
        });
      } else {
        clearScopeCursors(context);
      }
      pendingRebaselines.delete(key);
      emit(notification);
    } catch (error) {
      options.onError?.(error, "desktop-notification-bridge.state.rebaseline");
      return;
    } finally {
      recoveringKeys.delete(key);
    }
    if (!stopped) {
      await openSubscription(context).catch((error) => {
        options.onError?.(error, "desktop-notification-bridge.subscription.reopen");
      });
    }
  };

  const pumpSubscription = async (record: SubscriptionRecord): Promise<void> => {
    try {
      for await (const event of record.subscription) {
        if (record.stopped || stopped) {
          break;
        }
        const sequenceResult = observeRuntimeEvent(record, event);
        if (sequenceResult.kind === "ignore") {
          continue;
        }
        if (sequenceResult.kind === "rebaseline") {
          await recoverScope(record.context, sequenceResult.notification, record);
          return;
        }
        const notification = mapRuntimeEventToDesktopNotification(event, {
          expectedWorkspaceId:
            record.context.kind === "workspace" ? record.context.workspaceId : undefined,
          subscriptionScope: record.context.kind,
          surfaceCursors,
        });
        const workspaceScopesChanged =
          event.type === "app_read_model.changed" && event.invalidation.model === "workspaceChrome";
        if (!notification) {
          if (workspaceScopesChanged) {
            await scheduleReconciliation();
          }
          continue;
        }
        if (notification.kind === "read-model-rebaseline-required") {
          const resumeFromSurfaceStreamEvent =
            event.type === "surface.stream" &&
            (notification.reason === "surface-stream-gap" ||
              notification.reason === "surface-stream-generation-mismatch")
              ? event
              : undefined;
          await recoverScope(record.context, notification, record, resumeFromSurfaceStreamEvent);
          return;
        }
        emit(notification);
        if (workspaceScopesChanged) {
          await scheduleReconciliation();
        }
      }
    } catch (error) {
      if (!record.stopped && !stopped) {
        options.onError?.(error, "desktop-notification-bridge.subscription.pump");
        await recoverScope(
          record.context,
          rebaseline(
            "bridge-restart",
            eventCursors.get(record.key)?.eventGenerationId,
            scopeForContext(record.context),
            eventCursors.get(record.key)?.lastSequence,
          ),
          record,
        );
      }
    }
  };

  const watchSubscriptionClose = async (record: SubscriptionRecord): Promise<void> => {
    try {
      const receipt = await record.subscription.closed;
      if (record.stopped || stopped) {
        return;
      }
      if (receipt.rebaselineRequired) {
        await recoverScope(
          record.context,
          rebaseline(
            receipt.reason === "slow-consumer"
              ? "slow-consumer"
              : receipt.reason === "runtime-restart"
                ? "runtime-restart"
                : "bridge-restart",
            receipt.eventGenerationId,
            scopeForContext(record.context),
            receipt.lastContiguousSequence,
          ),
          record,
        );
        return;
      }
      record.stopped = true;
      if (subscriptions.get(record.key) === record) {
        subscriptions.delete(record.key);
      }
      await openSubscription(record.context).catch((error) => {
        options.onError?.(error, "desktop-notification-bridge.subscription.reopen-closed");
      });
    } catch (error) {
      if (!record.stopped && !stopped) {
        options.onError?.(error, "desktop-notification-bridge.subscription.closed");
        await recoverScope(
          record.context,
          rebaseline(
            "bridge-restart",
            eventCursors.get(record.key)?.eventGenerationId,
            scopeForContext(record.context),
            eventCursors.get(record.key)?.lastSequence,
          ),
          record,
        );
      }
    }
  };

  const observeRuntimeEvent = (
    record: SubscriptionRecord,
    event: RuntimeEvent,
  ):
    | { readonly kind: "accept" }
    | { readonly kind: "ignore" }
    | {
        readonly kind: "rebaseline";
        readonly notification: RebaselineNotification;
      } => {
    const cursor = eventCursors.get(record.key);
    if (!cursor) {
      eventCursors.set(record.key, {
        eventGenerationId: event.eventGenerationId,
        lastSequence: event.sequence,
      });
      return { kind: "accept" };
    }
    if (cursor.eventGenerationId !== event.eventGenerationId) {
      return {
        kind: "rebaseline",
        notification: rebaseline(
          "runtime-restart",
          event.eventGenerationId,
          scopeForContext(record.context),
          cursor.lastSequence,
        ),
      };
    }
    if ((event.sequence as number) <= (cursor.lastSequence as number)) {
      return { kind: "ignore" };
    }
    if (
      record.context.kind === "app" &&
      (event.sequence as number) !== (cursor.lastSequence as number) + 1
    ) {
      return {
        kind: "rebaseline",
        notification: rebaseline(
          "event-sequence-gap",
          event.eventGenerationId,
          appScope,
          cursor.lastSequence,
        ),
      };
    }
    eventCursors.set(record.key, {
      eventGenerationId: event.eventGenerationId,
      lastSequence: event.sequence,
    });
    return { kind: "accept" };
  };

  return {
    async start() {
      if (started && !stopped) {
        return;
      }
      started = true;
      stopped = false;
      eventCursors.clear();
      surfaceCursors.clear();
      pendingRebaselines.clear();
      await scheduleReconciliation();
      workspaceScopeReconcileTimer = setInterval(() => {
        void scheduleReconciliation().catch((error) =>
          options.onError?.(error, "desktop-notification-bridge.workspace-scope-reconcile"),
        );
      }, 1_000);
    },
    async stop() {
      if (stopped) {
        return;
      }
      emit({ kind: "app-shutdown", reason: "bridge-stopped" });
      stopped = true;
      if (workspaceScopeReconcileTimer) {
        clearInterval(workspaceScopeReconcileTimer);
        workspaceScopeReconcileTimer = null;
      }
      await Promise.all(
        [...subscriptions.values()].map((record) =>
          closeSubscription(record, { clearCursors: true }),
        ),
      );
      subscriptions.clear();
      openingKeys.clear();
      recoveringKeys.clear();
      pendingRebaselines.clear();
      eventCursors.clear();
      surfaceCursors.clear();
    },
  };
}

export function mapRuntimeEventToDesktopNotification(
  event: RuntimeEvent,
  context: {
    readonly subscriptionScope?: "app" | "workspace";
    readonly expectedWorkspaceId?: WorkspaceId;
    readonly surfaceCursors?: SurfaceStreamCursors;
  } = {},
): DesktopRendererNotification | null {
  if (context.subscriptionScope === "app" && "workspaceId" in event) {
    return null;
  }
  if (
    context.expectedWorkspaceId &&
    "workspaceId" in event &&
    event.workspaceId !== context.expectedWorkspaceId
  ) {
    return rebaseline("scope-descriptor-mismatch", event.eventGenerationId, {
      kind: "workspace",
      workspaceId: context.expectedWorkspaceId,
    });
  }

  if (event.type === "surface.stream") {
    return mapSurfaceStreamEvent(event, context.surfaceCursors ?? new Map());
  }

  const changed = mapRuntimeEventToReadModelChangedNotification(event);
  if (!changed) {
    return null;
  }
  if (!isScopeDescriptorConsistent(changed.scope, changed.invalidation)) {
    return rebaseline("scope-descriptor-mismatch", event.eventGenerationId, changed.scope);
  }
  return changed;
}

export function desktopRendererCommandNotification(
  command: DesktopRendererCommand,
): DesktopRendererNotification {
  return { kind: "renderer-command", command };
}

function mapSurfaceStreamEvent(
  event: SurfaceStreamEvent,
  surfaceCursors: SurfaceStreamCursors,
): DesktopRendererNotification {
  const surfacePiSessionId = event.target.surfacePiSessionId;
  let workspaceSurfaceCursors = surfaceCursors.get(event.workspaceId);
  if (!workspaceSurfaceCursors) {
    workspaceSurfaceCursors = new Map();
    surfaceCursors.set(event.workspaceId, workspaceSurfaceCursors);
  }
  const existing = workspaceSurfaceCursors.get(surfacePiSessionId);
  if (!existing) {
    if ((event.streamSequence as number) !== 1) {
      return rebaseline("surface-stream-gap", event.eventGenerationId, surfaceScope(event));
    }
    workspaceSurfaceCursors.set(surfacePiSessionId, {
      generationId: event.streamGenerationId,
      lastStreamSequence: event.streamSequence,
    });
    return surfaceStreamPatchNotification(event);
  }
  if (existing.generationId !== event.streamGenerationId) {
    return rebaseline(
      "surface-stream-generation-mismatch",
      event.eventGenerationId,
      surfaceScope(event),
    );
  }
  if ((event.streamSequence as number) !== (existing.lastStreamSequence as number) + 1) {
    return rebaseline("surface-stream-gap", event.eventGenerationId, surfaceScope(event));
  }
  workspaceSurfaceCursors.set(surfacePiSessionId, {
    generationId: event.streamGenerationId,
    lastStreamSequence: event.streamSequence,
  });
  return surfaceStreamPatchNotification(event);
}

function surfaceStreamPatchNotification(
  event: Extract<RuntimeEvent, { readonly type: "surface.stream" }>,
): DesktopRendererNotification {
  return {
    kind: "surface-stream-patch",
    eventGenerationId: event.eventGenerationId,
    sequence: event.sequence,
    workspaceId: event.workspaceId,
    target: event.target,
    surfacePiSessionId: event.target.surfacePiSessionId,
    streamGenerationId: event.streamGenerationId,
    streamSequence: event.streamSequence,
    patch: event.patch,
  };
}

function mapRuntimeEventToReadModelChangedNotification(
  event: Exclude<RuntimeEvent, { readonly type: "surface.stream" }>,
): ReadModelChangedNotification | null {
  switch (event.type) {
    case "command.changed":
      return readModelChanged(
        event,
        commandInspectorDescriptor(event.workspaceId, event.commandId),
        event.target,
      );
    case "queue.changed":
    case "turn.changed":
    case "surface.changed":
      return readModelChanged(
        event,
        surfaceDescriptor(event.workspaceId, event.target.surfacePiSessionId),
        event.target,
      );
    case "workspace_read_model.changed":
      return readModelChanged(event, {
        scope: "workspace",
        workspaceId: event.workspaceId,
        invalidation: event.invalidation,
      });
    case "app_read_model.changed":
      return readModelChanged(event, { scope: "app", invalidation: event.invalidation });
    case "runtime.recovery":
      return readModelChanged(
        event,
        event.scope === "workspace"
          ? {
              scope: "workspace",
              workspaceId: event.workspaceId,
              invalidation: { model: "appLogs" },
            }
          : { scope: "app", invalidation: { model: "appLogs" } },
      );
    case "workflow_task_attempt.changed":
      return readModelChanged(event, {
        scope: "workspace",
        workspaceId: event.workspaceId,
        invalidation: {
          model: "workflowTaskAttemptInspector",
          ids: [event.workflowTaskAttemptId],
        },
      });
  }
}

function readModelChanged(
  event: Pick<RuntimeEvent, "eventGenerationId" | "sequence"> & {
    readonly workspaceId?: WorkspaceId;
  },
  invalidation: StateInvalidationDescriptor,
  target?: { readonly surfacePiSessionId: SurfacePiSessionId },
): ReadModelChangedNotification {
  const scope: DesktopRendererNotificationScope = target
    ? {
        kind: "surface",
        workspaceId:
          invalidation.scope === "workspace" ? invalidation.workspaceId : event.workspaceId!,
        surfacePiSessionId: target.surfacePiSessionId,
      }
    : invalidation.scope === "workspace"
      ? { kind: "workspace", workspaceId: invalidation.workspaceId }
      : appScope;
  return {
    kind: "read-model-changed",
    eventGenerationId: event.eventGenerationId,
    sequence: event.sequence,
    scope,
    invalidation,
  };
}

function commandInspectorDescriptor(
  workspaceId: WorkspaceId,
  commandId: CommandId,
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId,
    invalidation: { model: "commandInspector", ids: [commandId] },
  };
}

function surfaceDescriptor(
  workspaceId: WorkspaceId,
  surfacePiSessionId: SurfacePiSessionId,
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId,
    invalidation: { model: "surface", ids: [surfacePiSessionId] },
  };
}

function isScopeDescriptorConsistent(
  scope: DesktopRendererNotificationScope,
  descriptor: StateInvalidationDescriptor,
): boolean {
  if (scope.kind === "app") {
    return descriptor.scope === "app";
  }
  if (descriptor.scope !== "workspace" || descriptor.workspaceId !== scope.workspaceId) {
    return false;
  }
  if (scope.kind === "surface" && descriptor.invalidation.model === "surface") {
    return descriptor.invalidation.ids.includes(scope.surfacePiSessionId);
  }
  return true;
}

function surfaceScope(
  event: Extract<RuntimeEvent, { readonly type: "surface.stream" | "surface.changed" }>,
): DesktopRendererNotificationScope {
  return {
    kind: "surface",
    workspaceId: event.workspaceId,
    surfacePiSessionId: event.target.surfacePiSessionId,
  };
}

function rebaseline(
  reason: RebaselineNotification["reason"],
  eventGenerationId: RuntimeEventGenerationId | undefined,
  scope?: DesktopRendererNotificationScope,
  lastContiguousSequence?: RuntimeEventSequence,
): RebaselineNotification {
  return {
    kind: "read-model-rebaseline-required",
    reason,
    rebaselineRequired: true,
    ...(eventGenerationId ? { eventGenerationId } : {}),
    ...(lastContiguousSequence !== undefined ? { lastContiguousSequence } : {}),
    ...(scope ? { scope } : {}),
  };
}

function subscriptionKey(context: SubscriptionContext): string {
  return context.kind === "app" ? "app" : `workspace:${context.workspaceId}`;
}

function scopeForContext(context: SubscriptionContext): DesktopRendererNotificationScope {
  return context.kind === "app"
    ? appScope
    : { kind: "workspace", workspaceId: context.workspaceId };
}

function runtimeEventsInput(
  context: SubscriptionContext,
  cursor: RuntimeEventCursor | undefined,
): RuntimeEventsInput {
  return {
    ...(context.kind === "workspace"
      ? { workspaceId: context.workspaceId, includeAppEvents: false }
      : { includeAppEvents: true }),
    ...(cursor
      ? {
          eventGenerationId: cursor.eventGenerationId,
          afterSequence: cursor.lastSequence,
        }
      : {}),
  };
}

function runtimeEventRebaselineFailure(error: unknown):
  | {
      readonly reason: "stale-cursor" | "generation-changed" | "filter-not-lossless";
      readonly eventGenerationId: RuntimeEventGenerationId;
      readonly currentHighWaterSequence: RuntimeEventSequence;
    }
  | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const facadeError = error as { readonly type?: unknown; readonly error?: unknown };
  const candidate = facadeError.type === "runtime-facade-error" ? facadeError.error : error;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const record = candidate as {
    readonly _tag?: unknown;
    readonly reason?: unknown;
    readonly eventGenerationId?: unknown;
    readonly currentHighWaterSequence?: unknown;
  };
  if (
    record._tag !== "RuntimeEventRebaselineRequired" ||
    (record.reason !== "stale-cursor" &&
      record.reason !== "generation-changed" &&
      record.reason !== "filter-not-lossless") ||
    typeof record.eventGenerationId !== "string" ||
    typeof record.currentHighWaterSequence !== "number"
  ) {
    return undefined;
  }
  return {
    reason: record.reason,
    eventGenerationId: record.eventGenerationId as RuntimeEventGenerationId,
    currentHighWaterSequence: record.currentHighWaterSequence as RuntimeEventSequence,
  };
}

async function resolveWorkspaceIdsFromState(
  state: DesktopNotificationBridgeState,
): Promise<WorkspaceId[]> {
  const result = await state.readModels.fetch({ kind: "workspaceChrome" });
  if (result.kind !== "workspaceChrome") {
    throw new Error(`Expected workspaceChrome read model; received ${result.kind}.`);
  }
  const workspaceIds = new Set<WorkspaceId>();
  for (const tab of result.value.tabs) {
    workspaceIds.add(tab.workspaceId);
  }
  return [...workspaceIds];
}
