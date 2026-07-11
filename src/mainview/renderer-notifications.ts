import type {
  DesktopRendererCommand,
  DesktopRendererNotification,
  StateReadModelBaseline,
  StateReadModelInvalidationRefetchRequest,
  StateReadModelRebaselineRequest,
  StateReadModelResult,
} from "../shared/workspace-contract";
import type { StateInvalidationDescriptor, WorkspaceId } from "@svvy/core";
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

export interface RendererNotificationStore {
  dispose(): void;
  handle(notification: DesktopRendererNotification): void;
}

export function createRendererNotificationStore(
  options: CreateRendererNotificationStoreOptions,
): RendererNotificationStore {
  let disposed = false;
  let rebaselineGeneration = 0;
  let refetcher: ScheduleReadModelRefetch;

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
      requestRebaseline(notification.reason, notification.scope);
      return;
    }
    refetcher.handleNotification(notification);
  };

  options.rpcClient.addMessageListener("sendDesktopNotification", handle);

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      rebaselineGeneration += 1;
      options.rpcClient.removeMessageListener("sendDesktopNotification", handle);
      refetcher.reset("renderer-notification-store-disposed");
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

function scopeMatchesDescriptor(
  scope: Extract<DesktopRendererNotification, { kind: "read-model-changed" }>["scope"],
  descriptor: StateInvalidationDescriptor,
): boolean {
  if (scope.kind === "app") {
    return descriptor.scope === "app";
  }
  return descriptor.scope === "workspace" && descriptor.workspaceId === scope.workspaceId;
}
