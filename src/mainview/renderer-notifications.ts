import type {
  DesktopRendererCommand,
  DesktopRendererNotification,
  StateReadModelBaseline,
  StateReadModelInvalidationRefetchRequest,
  StateReadModelRebaselineRequest,
  StateReadModelResult,
} from "../shared/workspace-contract";
import type {
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  RuntimeSurfaceTarget,
  RuntimeTranscriptStreamCursor,
  StateInvalidationDescriptor,
  SurfacePiSessionId,
  SurfaceStreamGenerationId,
  SurfaceStreamSequence,
  WorkspaceId,
} from "@svvy/core";
import {
  createSequenceAwareRefetcher,
  type ApplyReadModelPatchContext,
  type ScheduleReadModelRefetch,
} from "./sequence-aware-refetcher";

export interface RendererNotificationRpcClient {
  request: {
    refetchStateReadModelInvalidation(
      input: StateReadModelInvalidationRefetchRequest,
    ): Promise<readonly StateReadModelResult[]>;
    rebaselineStateReadModels(
      input: StateReadModelRebaselineRequest,
    ): Promise<StateReadModelBaseline>;
  };
  addMessageListener(
    messageName: "sendDesktopNotification",
    listener: (payload: DesktopRendererNotification) => void,
  ): void;
  removeMessageListener(
    messageName: "sendDesktopNotification",
    listener: (payload: DesktopRendererNotification) => void,
  ): void;
}

export interface CreateRendererNotificationStoreOptions {
  readonly rpcClient: RendererNotificationRpcClient;
  readonly workspaceId: WorkspaceId;
  readonly applyReadModelPatch: (
    patch: readonly StateReadModelResult[],
    context: ApplyReadModelPatchContext,
  ) => void;
  readonly applyReadModelBaseline: (
    baseline: StateReadModelBaseline,
    scope: RendererReadModelBaselineScope,
  ) => void;
  readonly onRendererCommand?: (command: DesktopRendererCommand) => void;
  readonly onAppShutdown?: (reason: string) => void;
  readonly onError?: (error: unknown, context: string) => void;
}

export type RendererReadModelBaselineScope =
  | { readonly kind: "app" }
  | { readonly kind: "workspace"; readonly workspaceId: WorkspaceId };

export type SurfaceStreamPatchNotification = Extract<
  DesktopRendererNotification,
  { readonly kind: "surface-stream-patch" }
>;

export type SurfaceStreamRebaselineNotification = Extract<
  DesktopRendererNotification,
  { readonly kind: "read-model-rebaseline-required" }
>;

export interface SurfaceStreamCursor {
  readonly eventGenerationId: RuntimeEventGenerationId | null;
  readonly eventSequence: RuntimeEventSequence | null;
  readonly streamGenerationId: SurfaceStreamGenerationId;
  readonly streamSequence: SurfaceStreamSequence;
}

export interface SurfaceStreamResetSignal {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly surfacePiSessionId: SurfacePiSessionId;
  /** The last patch delivered for this surface, including a stream_reset patch when it triggered. */
  readonly cursor: SurfaceStreamCursor | null;
  readonly trigger:
    | {
        readonly kind: "stream-reset";
        readonly notification: SurfaceStreamPatchNotification;
      }
    | {
        readonly kind: "rebaseline-required";
        readonly notification: SurfaceStreamRebaselineNotification;
      }
    | {
        readonly kind: "discontinuity";
        readonly reason:
          | "event-generation-mismatch"
          | "stream-generation-mismatch"
          | "stream-sequence-gap";
        readonly notification: SurfaceStreamPatchNotification;
        readonly expectedStreamSequence?: SurfaceStreamSequence;
      };
}

export interface SurfaceStreamSubscriber {
  /** Receives the complete desktop notification, preserving both event and stream ordering. */
  readonly onPatch: (notification: SurfaceStreamPatchNotification) => void;
  /** Signals that the subscriber must discard its overlay and request an authoritative baseline. */
  readonly onReset: (signal: SurfaceStreamResetSignal) => void;
}

export interface RendererNotificationStore {
  subscribeSurface(target: RuntimeSurfaceTarget, subscriber: SurfaceStreamSubscriber): () => void;
  /** Reopens a blocked stream lane only after its authoritative baseline has been applied. */
  resumeSurfaceAfterRebaseline(
    target: RuntimeSurfaceTarget,
    cursor: RuntimeTranscriptStreamCursor | null,
  ): void;
  dispose(): void;
  handle(notification: DesktopRendererNotification): void;
}

interface SurfaceStreamSubscription {
  readonly target: RuntimeSurfaceTarget;
  readonly subscriber: SurfaceStreamSubscriber;
}

interface PendingSurfaceStreamReset {
  readonly cursor: SurfaceStreamCursor | null;
  readonly trigger: SurfaceStreamResetSignal["trigger"];
}

export function createRendererNotificationStore(
  options: CreateRendererNotificationStoreOptions,
): RendererNotificationStore {
  let disposed = false;
  let rebaselineGeneration = 0;
  let refetcher: ScheduleReadModelRefetch;
  const surfaceSubscriptions = new Map<string, Set<SurfaceStreamSubscription>>();
  const surfaceTargets = new Map<string, RuntimeSurfaceTarget>();
  const surfaceCursors = new Map<string, SurfaceStreamCursor>();
  const pendingSurfaceResets = new Map<string, PendingSurfaceStreamReset>();

  const reportSubscriberError = (error: unknown, context: string): void => {
    options.onError?.(error, context);
  };

  const blockSurfaceStream = (
    targetKey: string,
    trigger: SurfaceStreamResetSignal["trigger"],
    cursor: SurfaceStreamCursor | null,
  ): void => {
    pendingSurfaceResets.set(targetKey, { cursor, trigger });
    const subscriptions = surfaceSubscriptions.get(targetKey);
    if (!subscriptions) {
      return;
    }
    for (const subscription of subscriptions) {
      try {
        subscription.subscriber.onReset({
          workspaceId: options.workspaceId,
          target: subscription.target,
          surfacePiSessionId: subscription.target.surfacePiSessionId,
          cursor,
          trigger,
        });
      } catch (error) {
        reportSubscriberError(error, "renderer-notifications.surface-reset");
      }
    }
  };

  const notifySurfaceReset = (notification: SurfaceStreamRebaselineNotification): void => {
    const targetKeys = [
      ...new Set([...surfaceTargets.keys(), ...surfaceSubscriptions.keys()]),
    ].filter((targetKey) => {
      if (notification.scope?.kind !== "surface") {
        return true;
      }
      return (
        surfaceTargets.get(targetKey)?.surfacePiSessionId === notification.scope.surfacePiSessionId
      );
    });
    for (const targetKey of targetKeys) {
      blockSurfaceStream(
        targetKey,
        { kind: "rebaseline-required", notification },
        surfaceCursors.get(targetKey) ?? null,
      );
    }
  };

  const notifySurfacePatch = (notification: SurfaceStreamPatchNotification): void => {
    if (notification.surfacePiSessionId !== notification.target.surfacePiSessionId) {
      reportSubscriberError(
        new Error("Surface stream notification target does not match its surfacePiSessionId."),
        "renderer-notifications.surface-target-mismatch",
      );
      return;
    }
    const targetKey = runtimeSurfaceTargetKey(notification.target);
    surfaceTargets.set(targetKey, notification.target);
    if (pendingSurfaceResets.has(targetKey)) {
      return;
    }
    const existingCursor = surfaceCursors.get(targetKey);
    if (existingCursor) {
      const discontinuity =
        existingCursor.eventGenerationId !== null &&
        existingCursor.eventGenerationId !== notification.eventGenerationId
          ? ({
              kind: "discontinuity",
              reason: "event-generation-mismatch",
              notification,
            } as const)
          : existingCursor.streamGenerationId !== notification.streamGenerationId
            ? ({
                kind: "discontinuity",
                reason: "stream-generation-mismatch",
                notification,
              } as const)
            : (notification.streamSequence as number) !==
                (existingCursor.streamSequence as number) + 1
              ? ({
                  kind: "discontinuity",
                  reason: "stream-sequence-gap",
                  notification,
                  expectedStreamSequence: ((existingCursor.streamSequence as number) +
                    1) as SurfaceStreamSequence,
                } as const)
              : null;
      if (discontinuity) {
        blockSurfaceStream(targetKey, discontinuity, existingCursor);
        return;
      }
    }
    const cursor = {
      eventGenerationId: notification.eventGenerationId,
      eventSequence: notification.sequence,
      streamGenerationId: notification.streamGenerationId,
      streamSequence: notification.streamSequence,
    } satisfies SurfaceStreamCursor;
    surfaceCursors.set(targetKey, cursor);
    const subscriptions = surfaceSubscriptions.get(targetKey);
    if (subscriptions) {
      for (const subscription of subscriptions) {
        try {
          subscription.subscriber.onPatch(notification);
        } catch (error) {
          reportSubscriberError(error, "renderer-notifications.surface-patch");
        }
      }
    }
    if (notification.patch.type !== "stream_reset") {
      return;
    }
    blockSurfaceStream(targetKey, { kind: "stream-reset", notification }, cursor);
  };

  const requestRebaseline = (
    reason: string,
    notificationScope?: Extract<
      DesktopRendererNotification,
      { readonly kind: "read-model-rebaseline-required" }
    >["scope"],
  ): void => {
    refetcher.reset(reason);
    rebaselineGeneration += 1;
    const requestedGeneration = rebaselineGeneration;
    const scopes: RendererReadModelBaselineScope[] =
      notificationScope?.kind === "app"
        ? [{ kind: "app" }]
        : notificationScope
          ? [{ kind: "workspace", workspaceId: notificationScope.workspaceId }]
          : [{ kind: "app" }, { kind: "workspace", workspaceId: options.workspaceId }];
    void Promise.all(
      scopes.map(async (scope) => ({
        scope,
        baseline: await options.rpcClient.request.rebaselineStateReadModels({
          ...(scope.kind === "workspace" ? { workspaceId: scope.workspaceId } : {}),
          reason: reason === "runtime-restart" ? "runtime-restart" : "event-sequence-gap",
        }),
      })),
    )
      .then((results) => {
        if (disposed || requestedGeneration !== rebaselineGeneration) {
          return;
        }
        for (const result of results) {
          options.applyReadModelBaseline(result.baseline, result.scope);
        }
      })
      .catch((error) => options.onError?.(error, "renderer-notifications.rebaseline"));
  };

  refetcher = createSequenceAwareRefetcher({
    state: {
      readModels: {
        refetchInvalidation: (input: { readonly descriptor: StateInvalidationDescriptor }) =>
          options.rpcClient.request.refetchStateReadModelInvalidation(input),
      },
    },
    applyReadModelPatch: options.applyReadModelPatch,
    onRebaselineRequired: requestRebaseline,
  });

  const handle = (notification: DesktopRendererNotification): void => {
    if (disposed) {
      return;
    }
    if (notification.kind === "renderer-command") {
      options.onRendererCommand?.(notification.command);
      return;
    }
    if (notification.kind === "app-shutdown") {
      options.onAppShutdown?.(notification.reason);
      return;
    }
    const workspaceId = notificationWorkspaceId(notification);
    if (workspaceId && workspaceId !== options.workspaceId) {
      return;
    }
    if (
      notification.kind === "read-model-changed" &&
      !scopeMatchesDescriptor(notification.scope, notification.invalidation)
    ) {
      requestRebaseline("scope-descriptor-mismatch");
      return;
    }
    if (notification.kind === "read-model-rebaseline-required") {
      notifySurfaceReset(notification);
      requestRebaseline(notification.reason, notification.scope);
      return;
    }
    if (notification.kind === "surface-stream-patch") {
      notifySurfacePatch(notification);
      return;
    }
    refetcher.handleNotification(notification);
  };

  options.rpcClient.addMessageListener("sendDesktopNotification", handle);

  return {
    subscribeSurface(target, subscriber) {
      if (disposed) {
        return () => {};
      }
      const targetKey = runtimeSurfaceTargetKey(target);
      surfaceTargets.set(targetKey, target);
      let subscriptions = surfaceSubscriptions.get(targetKey);
      if (!subscriptions) {
        subscriptions = new Set();
        surfaceSubscriptions.set(targetKey, subscriptions);
      }
      const subscription = { target, subscriber } satisfies SurfaceStreamSubscription;
      subscriptions.add(subscription);
      const pendingReset = pendingSurfaceResets.get(targetKey);
      if (pendingReset) {
        try {
          subscriber.onReset({
            workspaceId: options.workspaceId,
            target,
            surfacePiSessionId: target.surfacePiSessionId,
            cursor: pendingReset.cursor,
            trigger: pendingReset.trigger,
          });
        } catch (error) {
          reportSubscriberError(error, "renderer-notifications.surface-reset");
        }
      }
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        const current = surfaceSubscriptions.get(targetKey);
        current?.delete(subscription);
        if (current?.size === 0) {
          surfaceSubscriptions.delete(targetKey);
        }
      };
    },
    resumeSurfaceAfterRebaseline(target, cursor) {
      if (disposed) {
        return;
      }
      const targetKey = runtimeSurfaceTargetKey(target);
      pendingSurfaceResets.delete(targetKey);
      if (!cursor) {
        surfaceCursors.delete(targetKey);
        return;
      }
      surfaceCursors.set(targetKey, {
        eventGenerationId: null,
        eventSequence: null,
        streamGenerationId: cursor.streamGenerationId,
        streamSequence: cursor.streamSequence,
      });
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      rebaselineGeneration += 1;
      options.rpcClient.removeMessageListener("sendDesktopNotification", handle);
      refetcher.reset("renderer-notification-store-disposed");
      surfaceSubscriptions.clear();
      surfaceTargets.clear();
      surfaceCursors.clear();
      pendingSurfaceResets.clear();
    },
    handle,
  };
}

function notificationWorkspaceId(
  notification: DesktopRendererNotification,
): WorkspaceId | undefined {
  if (notification.kind === "surface-stream-patch") {
    return notification.workspaceId;
  }
  if (
    (notification.kind === "read-model-changed" ||
      notification.kind === "read-model-rebaseline-required") &&
    notification.scope?.kind !== "app"
  ) {
    return notification.scope?.workspaceId;
  }
  return undefined;
}

function runtimeSurfaceTargetKey(target: RuntimeSurfaceTarget): string {
  switch (target.surface) {
    case "orchestrator":
      return JSON.stringify([target.surface, target.workspaceSessionId, target.surfacePiSessionId]);
    case "handler":
      return JSON.stringify([
        target.surface,
        target.workspaceSessionId,
        target.surfacePiSessionId,
        target.threadId,
      ]);
    case "workflow-task":
      return JSON.stringify([
        target.surface,
        target.workspaceSessionId,
        target.surfacePiSessionId,
        target.workflowTaskAttemptId,
        target.workflowRunId ?? null,
        target.threadId,
      ]);
  }
}

function scopeMatchesDescriptor(
  scope: Extract<DesktopRendererNotification, { kind: "read-model-changed" }>["scope"],
  descriptor: StateInvalidationDescriptor,
): boolean {
  if (scope.kind === "app") {
    return descriptor.scope === "app";
  }
  return descriptor.scope === "workspace" && descriptor.workspaceId === scope.workspaceId;
}
