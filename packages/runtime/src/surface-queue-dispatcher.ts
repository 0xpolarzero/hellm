import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeQueueStatePort,
  RuntimeTurnStatePort,
  type RuntimeOwnerId,
  type RuntimeSurfaceMessageRecord,
  type RuntimeTurnRecord,
  type PositiveDurationMs,
  type StartRuntimeTurnInput,
  type StateContractError,
  type WorkspaceId,
} from "@svvy/core";

export type SurfaceQueueMaterializedMessage<TMessage, TMetadata = never> =
  | { kind: "dispatch"; message: TMessage; metadata?: TMetadata }
  | { kind: "delivered" };

export interface SurfaceQueuePreparedTurn<TPrepared = undefined> {
  startTurnInput: StartRuntimeTurnInput;
  prepared: TPrepared;
}

type SurfaceQueueHostResult<A> =
  | A
  | Promise<A>
  | Effect.Effect<A, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort>;

export interface SurfaceQueueStartedPrompt {
  promptDone: SurfaceQueueHostResult<unknown>;
  continueAfterPrompt(): boolean;
}

export interface SurfaceQueueDispatchHost<
  TTarget,
  TSurface,
  TMessage,
  TMetadata = never,
  TPrepared = undefined,
> {
  isClosed(): boolean;
  resolveTarget(target: TTarget): SurfaceQueueHostResult<TTarget>;
  retainSurface(target: TTarget): SurfaceQueueHostResult<TSurface>;
  releaseSurface(input: { target: TTarget; surface: TSurface }): SurfaceQueueHostResult<void>;
  isSurfaceActive(input: { target: TTarget; surface: TSurface }): boolean;
  activePromptDone(input: {
    target: TTarget;
    surface: TSurface;
  }): SurfaceQueueHostResult<void> | null;
  continueAfterActivePrompt(input: { target: TTarget; surface: TSurface }): boolean;
  refreshBeforeDispatch(input: {
    target: TTarget;
    surface: TSurface;
  }): SurfaceQueueHostResult<TSurface>;
  materializeQueuedMessage(input: {
    target: TTarget;
    surface: TSurface;
    queued: RuntimeSurfaceMessageRecord;
  }): SurfaceQueueHostResult<SurfaceQueueMaterializedMessage<TMessage, TMetadata>>;
  prepareTurn(input: {
    target: TTarget;
    surface: TSurface;
    queued: RuntimeSurfaceMessageRecord;
    message: TMessage;
    metadata: TMetadata | undefined;
  }): SurfaceQueueHostResult<SurfaceQueuePreparedTurn<TPrepared>>;
  startPrompt(input: {
    target: TTarget;
    surface: TSurface;
    queued: RuntimeSurfaceMessageRecord;
    turn: RuntimeTurnRecord;
    prepared: TPrepared;
    message: TMessage;
    metadata: TMetadata | undefined;
  }): SurfaceQueueHostResult<SurfaceQueueStartedPrompt>;
  notifyQueueUpdated(input: { target: TTarget }): SurfaceQueueHostResult<void>;
}

export interface SurfaceQueueDispatcher<TTarget> {
  drainSurfaceQueue(
    target: TTarget,
  ): Effect.Effect<void, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort>;
  drainNextQueuedSurfaceMessage(
    target: TTarget,
    options: { awaitPrompt: boolean },
  ): Effect.Effect<boolean, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort>;
}

export function createSurfaceQueueDispatcher<
  TTarget,
  TSurface,
  TMessage,
  TMetadata = never,
  TPrepared = undefined,
>(input: {
  host: SurfaceQueueDispatchHost<TTarget, TSurface, TMessage, TMetadata, TPrepared>;
  claimOwnerId: RuntimeOwnerId;
  leaseDurationMs: PositiveDurationMs;
}): SurfaceQueueDispatcher<TTarget> {
  const { claimOwnerId, host, leaseDurationMs } = input;

  const hostResultToEffect = <A>(
    operation: string,
    result: SurfaceQueueHostResult<A>,
  ): Effect.Effect<A, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort> => {
    if (Effect.isEffect(result)) {
      return result.pipe(
        Effect.mapError((error) =>
          error instanceof RuntimeContractError
            ? error
            : runtimeQueueDispatchError(operation, error),
        ),
      );
    }
    return Effect.tryPromise({
      try: async () => result,
      catch: (error) => runtimeQueueDispatchError(operation, error),
    });
  };

  const runHost = <A>(
    operation: string,
    run: () => SurfaceQueueHostResult<A>,
  ): Effect.Effect<A, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort> =>
    Effect.try({
      try: run,
      catch: (error) => runtimeQueueDispatchError(operation, error),
    }).pipe(Effect.flatMap((result) => hostResultToEffect(operation, result)));

  const releaseSurface = (target: TTarget, surface: TSurface) =>
    runHost("runtime.queue.dispatch.releaseSurface", () =>
      host.releaseSurface({ target, surface }),
    );

  const failQueuedDelivery = (
    target: TTarget,
    queued: RuntimeSurfaceMessageRecord,
    error: RuntimeContractError,
  ): Effect.Effect<never, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort> =>
    Effect.gen(function* () {
      const queue = yield* RuntimeQueueStatePort;

      yield* queue
        .markSurfaceMessageFailed({
          id: queued.id,
          failureError: error.message,
          claimOwnerId,
          leaseVersion: queued.leaseVersion,
        })
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueueStateError("runtime.queue.dispatch.markFailed", cause),
          ),
        );
      yield* runHost("runtime.queue.dispatch.notifyQueueUpdated", () =>
        host.notifyQueueUpdated({ target }),
      );
      return yield* Effect.fail(error);
    });

  const requeueClaimedDelivery = (
    target: TTarget,
    queued: RuntimeSurfaceMessageRecord,
    error: RuntimeContractError,
  ): Effect.Effect<never, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort> =>
    Effect.gen(function* () {
      const queue = yield* RuntimeQueueStatePort;
      yield* queue
        .markSurfaceMessageQueued({
          id: queued.id,
          position: "front",
          claimOwnerId,
          leaseVersion: queued.leaseVersion,
          expectedStatuses: ["dispatching"],
        })
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueueStateError("runtime.queue.dispatch.requeueClaimed", cause),
          ),
        );
      yield* runHost("runtime.queue.dispatch.notifyQueueUpdated", () =>
        host.notifyQueueUpdated({ target }),
      );
      return yield* Effect.fail(error);
    });

  const drainNextQueuedSurfaceMessage = (
    target: TTarget,
    options: { awaitPrompt: boolean },
  ): Effect.Effect<boolean, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort> =>
    Effect.gen(function* () {
      if (host.isClosed()) {
        return false;
      }

      const queue = yield* RuntimeQueueStatePort;
      const currentTarget = yield* runHost("runtime.queue.dispatch.resolveTarget", () =>
        host.resolveTarget(target),
      );
      const surfacePiSessionId = yield* currentTargetSurfacePiSessionId(currentTarget);
      let releaseTransferred = false;
      let retainedSurface: TSurface | null = null;
      const acquired = yield* runHost("runtime.queue.dispatch.retainSurface", () =>
        host.retainSurface(currentTarget),
      );
      return yield* Effect.gen(function* () {
        let surface = acquired;
        retainedSurface = acquired;
        if (host.isSurfaceActive({ target: currentTarget, surface })) {
          const activePromptDone = host.activePromptDone({ target: currentTarget, surface });
          if (options.awaitPrompt && activePromptDone) {
            yield* hostResultToEffect(
              "runtime.queue.dispatch.awaitActivePrompt",
              activePromptDone,
            ).pipe(Effect.catch(() => Effect.void));
            return host.continueAfterActivePrompt({
              target: currentTarget,
              surface,
            });
          }
          return false;
        }

        const queuedResult = yield* queue
          .claimNextQueuedSurfaceMessage({
            surfacePiSessionId,
            claimOwnerId,
            leaseDurationMs,
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeQueueStateError("runtime.queue.dispatch.claimNext", cause),
            ),
          );
        const queued = queuedResult.value;
        if (!queued) {
          return false;
        }

        surface = yield* runHost("runtime.queue.dispatch.refreshBeforeDispatch", () =>
          host.refreshBeforeDispatch({ target: currentTarget, surface }),
        ).pipe(Effect.catch((error) => requeueClaimedDelivery(currentTarget, queued, error)));
        retainedSurface = surface;

        const materialized = yield* runHost("runtime.queue.dispatch.materializeQueuedMessage", () =>
          host.materializeQueuedMessage({
            target: currentTarget,
            surface,
            queued,
          }),
        ).pipe(Effect.catch((error) => failQueuedDelivery(currentTarget, queued, error)));

        if (materialized.kind === "delivered") {
          yield* queue
            .markSurfaceMessageDelivered({
              id: queued.id,
              claimOwnerId,
              leaseVersion: queued.leaseVersion,
            })
            .pipe(
              Effect.mapError((cause) =>
                runtimeQueueStateError("runtime.queue.dispatch.markDelivered", cause),
              ),
            );
          return true;
        }

        const turnState = yield* RuntimeTurnStatePort;
        const preparedTurn = yield* runHost("runtime.queue.dispatch.prepareTurn", () =>
          host.prepareTurn({
            target: currentTarget,
            surface,
            queued,
            message: materialized.message,
            metadata: materialized.metadata,
          }),
        ).pipe(Effect.catch((error) => requeueClaimedDelivery(currentTarget, queued, error)));
        const turn = yield* turnState.startTurn(preparedTurn.startTurnInput).pipe(
          Effect.map((result) => result.value),
          Effect.mapError((cause) =>
            runtimeQueueStateError("runtime.queue.dispatch.startTurn", cause),
          ),
          Effect.catch((error) => requeueClaimedDelivery(currentTarget, queued, error)),
        );

        const started = yield* runHost("runtime.queue.dispatch.startPrompt", () =>
          host.startPrompt({
            target: currentTarget,
            surface,
            queued,
            turn,
            prepared: preparedTurn.prepared,
            message: materialized.message,
            metadata: materialized.metadata,
          }),
        ).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* turnState
                .finishTurn({ turnId: turn.id, status: "failed" })
                .pipe(
                  Effect.mapError((cause) =>
                    runtimeQueueStateError("runtime.queue.dispatch.finishStartedTurn", cause),
                  ),
                );
              return yield* failQueuedDelivery(currentTarget, queued, error);
            }),
          ),
        );

        const promptDoneWithRelease = hostResultToEffect(
          "runtime.queue.dispatch.awaitStartedPrompt",
          started.promptDone,
        ).pipe(Effect.ensuring(releaseSurface(currentTarget, surface).pipe(Effect.ignore)));
        releaseTransferred = true;

        if (options.awaitPrompt) {
          yield* promptDoneWithRelease;
          return started.continueAfterPrompt();
        }
        yield* promptDoneWithRelease.pipe(
          Effect.catch(() => Effect.void),
          Effect.forkDetach,
        );
        return true;
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            if (releaseTransferred || retainedSurface === null) {
              return;
            }
            yield* releaseSurface(currentTarget, retainedSurface as TSurface).pipe(Effect.ignore);
          }),
        ),
      );
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

export function createRuntimeSurfaceQueueDispatcher<
  TTarget,
  TSurface,
  TMessage,
  TMetadata = never,
  TPrepared = undefined,
>(input: {
  host: SurfaceQueueDispatchHost<TTarget, TSurface, TMessage, TMetadata, TPrepared>;
  workspaceId: WorkspaceId;
  queueClaimLeaseMs: PositiveDurationMs;
}): SurfaceQueueDispatcher<TTarget> {
  return createSurfaceQueueDispatcher({
    host: input.host,
    claimOwnerId: `surface-queue-dispatcher:${input.workspaceId}` as RuntimeOwnerId,
    leaseDurationMs: input.queueClaimLeaseMs,
  });
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
