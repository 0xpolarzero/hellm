import type {
  RuntimeEventSequence,
  StateInvalidationDescriptor,
  SurfacePiSessionId,
  SurfaceStreamPatchInput,
  WorkspaceId,
} from "@svvy/core";
import type { StateReadModelResult } from "../shared/workspace-contract";

export type DesktopRendererNotificationForRefetcher =
  | {
      readonly kind: "read-model-changed";
      readonly sequence: RuntimeEventSequence;
      readonly scope:
        | { readonly kind: "app" }
        | { readonly kind: "workspace"; readonly workspaceId: WorkspaceId }
        | {
            readonly kind: "surface";
            readonly workspaceId: WorkspaceId;
            readonly surfacePiSessionId: SurfacePiSessionId;
          };
      readonly invalidation: StateInvalidationDescriptor;
    }
  | {
      readonly kind: "surface-stream-patch";
      readonly sequence: RuntimeEventSequence;
      readonly workspaceId: WorkspaceId;
      readonly surfacePiSessionId: SurfacePiSessionId;
      readonly patch: SurfaceStreamPatchInput;
    }
  | { readonly kind: "read-model-rebaseline-required"; readonly reason: string }
  | {
      readonly kind: "renderer-command";
      readonly command: "command-palette.open" | "quick-open.open" | "settings.open";
    }
  | { readonly kind: "app-shutdown"; readonly reason: string };

type ReadModelChangedNotification = Extract<
  DesktopRendererNotificationForRefetcher,
  { readonly kind: "read-model-changed" }
>;

export interface SequenceAwareRefetcherState {
  readonly readModels: {
    refetchInvalidation(input: {
      readonly descriptor: StateInvalidationDescriptor;
    }): Promise<readonly StateReadModelResult[]>;
  };
}

export interface ApplyReadModelPatchContext {
  readonly sequence: RuntimeEventSequence;
  readonly descriptor: StateInvalidationDescriptor;
}

export interface SequenceGapContext {
  readonly targetKey: string;
  readonly expectedSequence: RuntimeEventSequence;
  readonly receivedSequence: RuntimeEventSequence;
  readonly descriptor: StateInvalidationDescriptor;
}

export interface CreateSequenceAwareRefetcherOptions {
  readonly state: SequenceAwareRefetcherState;
  readonly applyReadModelPatch: (
    patch: readonly StateReadModelResult[],
    context: ApplyReadModelPatchContext,
  ) => void;
  readonly discardIfStale?: boolean;
  readonly onSequenceGap?: (context: SequenceGapContext) => void;
  readonly onRebaselineRequired?: (reason: string) => void;
}

export type ScheduleReadModelRefetch = {
  (
    sequence: RuntimeEventSequence,
    event: Pick<ReadModelChangedNotification, "scope" | "invalidation">,
  ): void;
  handleNotification(notification: DesktopRendererNotificationForRefetcher): void;
  reset(reason?: string): void;
};

interface TargetRefetchState {
  appliedSequence: RuntimeEventSequence | null;
  highestScheduledSequence: RuntimeEventSequence | null;
  inFlight: boolean;
  pending: {
    sequence: RuntimeEventSequence;
    descriptor: StateInvalidationDescriptor;
  } | null;
}

export function createSequenceAwareRefetcher(
  options: CreateSequenceAwareRefetcherOptions,
): ScheduleReadModelRefetch {
  const discardIfStale = options.discardIfStale ?? true;
  const targets = new Map<string, TargetRefetchState>();

  const schedule = ((
    sequence: RuntimeEventSequence,
    event: Pick<ReadModelChangedNotification, "scope" | "invalidation">,
  ) => {
    const descriptor = event.invalidation;
    const targetKey = readModelTargetKey(event.scope, descriptor);
    const state = getTargetState(targets, targetKey);
    const expectedSequence =
      state.highestScheduledSequence === null
        ? null
        : (((state.highestScheduledSequence as number) + 1) as RuntimeEventSequence);

    if (expectedSequence !== null && (sequence as number) > (expectedSequence as number)) {
      options.onSequenceGap?.({
        targetKey,
        expectedSequence,
        receivedSequence: sequence,
        descriptor,
      });
    }

    if (
      state.highestScheduledSequence !== null &&
      (sequence as number) <= (state.highestScheduledSequence as number)
    ) {
      return;
    }

    state.highestScheduledSequence = sequence;
    state.pending = { sequence, descriptor };
    void drainTarget(targetKey, state);
  }) as ScheduleReadModelRefetch;

  schedule.handleNotification = (notification) => {
    if (notification.kind === "read-model-changed") {
      schedule(notification.sequence, {
        scope: notification.scope,
        invalidation: notification.invalidation,
      });
      return;
    }
    if (notification.kind === "read-model-rebaseline-required") {
      schedule.reset(notification.reason);
      options.onRebaselineRequired?.(notification.reason);
    }
  };

  schedule.reset = () => {
    targets.clear();
  };

  async function drainTarget(targetKey: string, state: TargetRefetchState): Promise<void> {
    if (state.inFlight) {
      return;
    }
    while (state.pending) {
      const next = state.pending;
      state.pending = null;
      state.inFlight = true;
      const patch = await options.state.readModels.refetchInvalidation({
        descriptor: next.descriptor,
      });
      state.inFlight = false;

      const isStale =
        state.highestScheduledSequence !== null &&
        (next.sequence as number) < (state.highestScheduledSequence as number);
      if (!discardIfStale || !isStale) {
        state.appliedSequence = next.sequence;
        options.applyReadModelPatch(patch, {
          sequence: next.sequence,
          descriptor: next.descriptor,
        });
      }
      targets.set(targetKey, state);
    }
  }

  return schedule;
}

function getTargetState(
  targets: Map<string, TargetRefetchState>,
  targetKey: string,
): TargetRefetchState {
  const existing = targets.get(targetKey);
  if (existing) {
    return existing;
  }
  const next: TargetRefetchState = {
    appliedSequence: null,
    highestScheduledSequence: null,
    inFlight: false,
    pending: null,
  };
  targets.set(targetKey, next);
  return next;
}

function readModelTargetKey(
  scope: ReadModelChangedNotification["scope"],
  descriptor: StateInvalidationDescriptor,
): string {
  const descriptorScope =
    descriptor.scope === "workspace" ? `workspace:${descriptor.workspaceId}` : "app";
  const routingScope =
    scope.kind === "surface"
      ? `surface:${scope.workspaceId}:${scope.surfacePiSessionId}`
      : scope.kind === "workspace"
        ? `workspace:${scope.workspaceId}`
        : "app";
  const invalidation = descriptor.invalidation as {
    readonly model: string;
    readonly ids?: unknown;
  };
  const ids = Array.isArray(invalidation.ids) ? invalidation.ids.join(",") : "*";
  return `${routingScope}|${descriptorScope}|${invalidation.model}:${ids}`;
}
