import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeQueueStatePort,
  type RuntimeSurfaceMessageRecord,
  type StateContractError,
} from "@svvy/core";

export type SurfaceQueueMaterializedMessage<TMessage, TMetadata = never> =
  | { kind: "dispatch"; message: TMessage; metadata?: TMetadata }
  | { kind: "delivered" };

export interface SurfaceQueueStartedPrompt {
  promptDone: Promise<void>;
  continueAfterPrompt(): boolean;
}

export interface SurfaceQueueDispatchHost<TTarget, TSurface, TMessage, TMetadata = never> {
  isClosed(): boolean;
  resolveTarget(target: TTarget): TTarget | Promise<TTarget>;
  retainSurface(target: TTarget): Promise<TSurface>;
  releaseSurface(input: { target: TTarget; surface: TSurface }): Promise<void>;
  isSurfaceActive(input: { target: TTarget; surface: TSurface }): boolean;
  activePromptDone(input: { target: TTarget; surface: TSurface }): Promise<void> | null;
  continueAfterActivePrompt(input: { target: TTarget; surface: TSurface }): boolean;
  hasClaimableQueuedMessage(input: {
    target: TTarget;
    surface: TSurface;
  }): boolean | Promise<boolean>;
  refreshBeforeDispatch(input: { target: TTarget; surface: TSurface }): Promise<TSurface>;
  materializeQueuedMessage(input: {
    target: TTarget;
    surface: TSurface;
    queued: RuntimeSurfaceMessageRecord;
  }): Promise<SurfaceQueueMaterializedMessage<TMessage, TMetadata>>;
  startPrompt(input: {
    target: TTarget;
    surface: TSurface;
    queued: RuntimeSurfaceMessageRecord;
    message: TMessage;
    metadata: TMetadata | undefined;
  }): Promise<SurfaceQueueStartedPrompt>;
  notifyQueueUpdated(input: { target: TTarget }): Promise<void>;
}

export interface SurfaceQueueDispatcher<TTarget> {
  drainSurfaceQueue(
    target: TTarget,
  ): Effect.Effect<void, RuntimeContractError, RuntimeQueueStatePort>;
  drainNextQueuedSurfaceMessage(
    target: TTarget,
    options: { awaitPrompt: boolean },
  ): Effect.Effect<boolean, RuntimeContractError, RuntimeQueueStatePort>;
}

export function createSurfaceQueueDispatcher<
  TTarget,
  TSurface,
  TMessage,
  TMetadata = never,
>(input: {
  host: SurfaceQueueDispatchHost<TTarget, TSurface, TMessage, TMetadata>;
}): SurfaceQueueDispatcher<TTarget> {
  const { host } = input;

  const runHost = <A>(
    operation: string,
    run: () => A | Promise<A>,
  ): Effect.Effect<A, RuntimeContractError> =>
    Effect.tryPromise({
      try: async () => run(),
      catch: (error) => runtimeQueueDispatchError(operation, error),
    });

  const releaseSurface = (target: TTarget, surface: TSurface): Promise<void> => {
    return host.releaseSurface({ target, surface });
  };

  const failQueuedDelivery = (
    target: TTarget,
    surface: TSurface,
    queued: RuntimeSurfaceMessageRecord,
    error: RuntimeContractError,
  ): Effect.Effect<never, RuntimeContractError, RuntimeQueueStatePort> =>
    Effect.gen(function* () {
      const queue = yield* RuntimeQueueStatePort;

      yield* queue
        .markSurfaceMessageFailed({ id: queued.id, failureError: error.message })
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueueStateError("runtime.queue.dispatch.markFailed", cause),
          ),
        );
      yield* runHost("runtime.queue.dispatch.notifyQueueUpdated", () =>
        host.notifyQueueUpdated({ target }),
      );
      yield* runHost("runtime.queue.dispatch.releaseSurface", () =>
        releaseSurface(target, surface),
      );
      return yield* Effect.fail(error);
    });

  const drainNextQueuedSurfaceMessage = (
    target: TTarget,
    options: { awaitPrompt: boolean },
  ): Effect.Effect<boolean, RuntimeContractError, RuntimeQueueStatePort> =>
    Effect.gen(function* () {
      if (host.isClosed()) {
        return false;
      }

      const queue = yield* RuntimeQueueStatePort;
      const currentTarget = yield* runHost("runtime.queue.dispatch.resolveTarget", () =>
        host.resolveTarget(target),
      );
      const surfacePiSessionId = yield* currentTargetSurfacePiSessionId(currentTarget);
      let surface = yield* runHost("runtime.queue.dispatch.retainSurface", () =>
        host.retainSurface(currentTarget),
      );
      if (host.isSurfaceActive({ target: currentTarget, surface })) {
        const activePromptDone = host.activePromptDone({ target: currentTarget, surface });
        if (options.awaitPrompt && activePromptDone) {
          yield* runHost("runtime.queue.dispatch.awaitActivePrompt", () =>
            activePromptDone.catch((error) => {
              console.error("Failed while waiting for the active surface prompt:", error);
            }),
          );
          const shouldContinueDrain = host.continueAfterActivePrompt({
            target: currentTarget,
            surface,
          });
          yield* runHost("runtime.queue.dispatch.releaseSurface", () =>
            releaseSurface(currentTarget, surface),
          );
          return shouldContinueDrain;
        }
        yield* runHost("runtime.queue.dispatch.releaseSurface", () =>
          releaseSurface(currentTarget, surface),
        );
        return false;
      }

      const hasClaimableQueuedMessage = yield* runHost(
        "runtime.queue.dispatch.hasClaimableQueuedMessage",
        () =>
          host.hasClaimableQueuedMessage({
            target: currentTarget,
            surface,
          }),
      );
      if (!hasClaimableQueuedMessage) {
        yield* runHost("runtime.queue.dispatch.releaseSurface", () =>
          releaseSurface(currentTarget, surface),
        );
        return false;
      }

      surface = yield* runHost("runtime.queue.dispatch.refreshBeforeDispatch", () =>
        host.refreshBeforeDispatch({ target: currentTarget, surface }),
      );
      const queuedResult = yield* queue
        .claimNextQueuedSurfaceMessage({
          surfacePiSessionId,
        })
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueueStateError("runtime.queue.dispatch.claimNext", cause),
          ),
        );
      const queued = queuedResult.value;
      if (!queued) {
        yield* runHost("runtime.queue.dispatch.releaseSurface", () =>
          releaseSurface(currentTarget, surface),
        );
        return false;
      }

      const materialized = yield* runHost("runtime.queue.dispatch.materializeQueuedMessage", () =>
        host.materializeQueuedMessage({
          target: currentTarget,
          surface,
          queued,
        }),
      ).pipe(Effect.catch((error) => failQueuedDelivery(currentTarget, surface, queued, error)));

      if (materialized.kind === "delivered") {
        yield* queue
          .markSurfaceMessageDelivered({ id: queued.id })
          .pipe(
            Effect.mapError((cause) =>
              runtimeQueueStateError("runtime.queue.dispatch.markDelivered", cause),
            ),
          );
        yield* runHost("runtime.queue.dispatch.releaseSurface", () =>
          releaseSurface(currentTarget, surface),
        );
        return true;
      }

      const started = yield* runHost("runtime.queue.dispatch.startPrompt", () =>
        host.startPrompt({
          target: currentTarget,
          surface,
          queued,
          message: materialized.message,
          metadata: materialized.metadata,
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* queue
              .markSurfaceMessageQueued({ id: queued.id, position: "front" })
              .pipe(
                Effect.mapError((cause) =>
                  runtimeQueueStateError("runtime.queue.dispatch.requeueClaimed", cause),
                ),
              );
            yield* runHost("runtime.queue.dispatch.notifyQueueUpdated", () =>
              host.notifyQueueUpdated({ target: currentTarget }),
            );
            yield* runHost("runtime.queue.dispatch.releaseSurface", () =>
              releaseSurface(currentTarget, surface),
            );
            return yield* Effect.fail(error);
          }),
        ),
      );

      const promptDoneWithRelease = started.promptDone.finally(async () => {
        await releaseSurface(currentTarget, surface);
      });
      void promptDoneWithRelease.catch(() => undefined);

      if (options.awaitPrompt) {
        yield* runHost("runtime.queue.dispatch.awaitStartedPrompt", () => promptDoneWithRelease);
        return started.continueAfterPrompt();
      }
      return true;
    });

  return {
    drainSurfaceQueue: (target) =>
      Effect.gen(function* () {
        while (!host.isClosed()) {
          const dispatched = yield* drainNextQueuedSurfaceMessage(target, { awaitPrompt: true });
          if (!dispatched) {
            return;
          }
        }
      }),
    drainNextQueuedSurfaceMessage,
  };
}

function currentTargetSurfacePiSessionId<TTarget>(
  target: TTarget,
): Effect.Effect<string, RuntimeContractError> {
  const candidate = target as { surfacePiSessionId?: unknown };
  if (typeof candidate.surfacePiSessionId !== "string" || !candidate.surfacePiSessionId) {
    return Effect.fail(
      new RuntimeContractError({
        operation: "runtime.queue.dispatch.resolveTargetSurface",
        reason: "invalid-input",
        message: "Runtime queue dispatch target must expose surfacePiSessionId.",
      }),
    );
  }
  return Effect.succeed(candidate.surfacePiSessionId);
}

function runtimeQueueDispatchError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  return new RuntimeContractError({
    operation,
    reason: "stale-state",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function runtimeQueueStateError(
  operation: string,
  cause: StateContractError,
): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: "state-conflict",
    message: cause.message,
    cause,
  });
}
