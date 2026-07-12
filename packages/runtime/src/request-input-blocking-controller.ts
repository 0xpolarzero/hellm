import {
  type RequestInputRequestId,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type StateInvalidationDescriptor,
  RuntimeContractError,
  type SurfacePiSessionId,
} from "@svvy/core";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import type { RequestUserInputResult } from "@svvy/extensions";

type RuntimeBlockingRequestInputWaitError = RuntimeContractError;

export type RuntimeBlockingRequestInputEffectState = {
  commandState: Pick<RuntimeCommandStatePortService, "finishCommand">;
  requestState: Pick<
    RuntimeRequestStatePortService,
    | "cancelRequestInput"
    | "defaultOpenRequestInputQuestions"
    | "getRequestInput"
    | "listOpenBlockingRequestInputs"
    | "setRequestInputTimerPaused"
  >;
  sessionWaitState: Pick<RuntimeSessionWaitStatePortService, "clearSessionWait" | "setUserWait">;
  publishStateInvalidations: (
    afterCommit: readonly StateInvalidationDescriptor[],
  ) => Effect.Effect<void, RuntimeContractError>;
};

type PendingBlockingRequestEffect = {
  commandId: string;
  sessionId: string;
  deferred: Deferred.Deferred<RequestUserInputResult, RuntimeContractError>;
  timerVersion: number;
  timerScope: Scope.Scope | null;
};

type BlockingTimerInvalidation = {
  readonly timerVersion: number | null;
  readonly timerScope: Scope.Scope | null;
};

export type RuntimeBlockingRequestInputWaitRegistryOptions = {
  onRequestUpdated?: () => Effect.Effect<void>;
  onTimerInterrupted?: (requestId: string) => Effect.Effect<void>;
};

export type RuntimeBlockingRequestInputWaitRegistry = {
  waitForBlockingRequest(input: {
    state: RuntimeBlockingRequestInputEffectState;
    request: RuntimeRequestInputDetailsRecord;
    command: RuntimeCommandRecord;
  }): Effect.Effect<RequestUserInputResult, RuntimeBlockingRequestInputWaitError>;
  setBlockingTimerPaused(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
    paused: boolean,
  ): Effect.Effect<RuntimeRequestInputDetailsRecord, RuntimeBlockingRequestInputWaitError>;
  rescheduleBlockingTimeout(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
  ): Effect.Effect<void, RuntimeBlockingRequestInputWaitError>;
  resolveBlockingRequest(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
  ): Effect.Effect<RequestUserInputResult | null, RuntimeBlockingRequestInputWaitError>;
  cancelBlockingRequestsForSurface(
    state: RuntimeBlockingRequestInputEffectState,
    surfacePiSessionId: string,
    reason?: string,
  ): Effect.Effect<void, RuntimeBlockingRequestInputWaitError>;
  restoreOpenBlockingRequests(
    state: RuntimeBlockingRequestInputEffectState,
  ): Effect.Effect<void, RuntimeBlockingRequestInputWaitError>;
  close(): Effect.Effect<void>;
};

function publishCommittedInvalidations(
  state: RuntimeBlockingRequestInputEffectState,
  operation: string,
  afterCommit: readonly StateInvalidationDescriptor[],
): Effect.Effect<void, RuntimeBlockingRequestInputWaitError> {
  return state
    .publishStateInvalidations(afterCommit)
    .pipe(Effect.mapError((cause) => requestInputWaitError(operation, cause)));
}

export const makeRuntimeBlockingRequestInputWaitRegistry = Effect.fn(
  "@svvy/runtime/request-input.makeBlockingWaitRegistry",
)(function* (options: RuntimeBlockingRequestInputWaitRegistryOptions = {}) {
  const pending = yield* Ref.make(new Map<string, PendingBlockingRequestEffect>());
  const parentScope = yield* Scope.Scope;
  const timerScope = yield* Scope.fork(parentScope, "sequential");
  const closed = yield* Ref.make(false);

  const closePending = Effect.fn("@svvy/runtime/request-input.closeBlockingWaitRegistry")(
    function* (): Effect.fn.Return<void> {
      const alreadyClosed = yield* Ref.getAndSet(closed, true);
      if (alreadyClosed) {
        return;
      }
      const entries = yield* Ref.getAndSet(pending, new Map());
      yield* Effect.forEach(
        entries.values(),
        (entry) =>
          Effect.gen(function* () {
            if (entry.timerScope) {
              yield* Scope.close(entry.timerScope, Exit.void).pipe(Effect.ignore);
            }
            yield* Deferred.fail(
              entry.deferred,
              requestInputWaitError("runtime.requestInput.closeBlockingWaitRegistry", {
                reason: "runtime-closed",
                message: "Request user input wait registry closed.",
              }),
            ).pipe(Effect.asVoid);
          }),
        { discard: true },
      );
    },
  );

  yield* Scope.addFinalizer(timerScope, closePending());

  const invalidateBlockingTimer = Effect.fn("@svvy/runtime/request-input.invalidateBlockingTimer")(
    function* (requestId: string): Effect.fn.Return<number | null> {
      const invalidated: BlockingTimerInvalidation = yield* Ref.modify(
        pending,
        (
          current,
        ): readonly [BlockingTimerInvalidation, Map<string, PendingBlockingRequestEffect>] => {
          const entry = current.get(requestId);
          if (!entry) {
            return [{ timerVersion: null, timerScope: null }, current] as const;
          }
          const next = new Map(current);
          const nextVersion = entry.timerVersion + 1;
          next.set(requestId, { ...entry, timerVersion: nextVersion, timerScope: null });
          return [{ timerVersion: nextVersion, timerScope: entry.timerScope }, next] as const;
        },
      );
      if (invalidated.timerScope) {
        yield* Scope.close(invalidated.timerScope, Exit.void).pipe(Effect.ignore);
      }
      return invalidated.timerVersion;
    },
  );

  const installBlockingTimerScope = Effect.fn(
    "@svvy/runtime/request-input.installBlockingTimerScope",
  )(function* (
    requestId: string,
    timerVersion: number,
    scope: Scope.Scope,
  ): Effect.fn.Return<boolean> {
    return yield* Ref.modify(pending, (current) => {
      const entry = current.get(requestId);
      if (!entry || entry.timerVersion !== timerVersion) {
        return [false, current] as const;
      }
      const next = new Map(current);
      next.set(requestId, { ...entry, timerScope: scope });
      return [true, next] as const;
    });
  });

  const clearCurrentBlockingTimerScope = Effect.fn(
    "@svvy/runtime/request-input.clearCurrentBlockingTimerScope",
  )(function* (requestId: string, timerVersion: number): Effect.fn.Return<void> {
    yield* Ref.update(pending, (current) => {
      const entry = current.get(requestId);
      if (!entry || entry.timerVersion !== timerVersion) {
        return current;
      }
      const next = new Map(current);
      next.set(requestId, { ...entry, timerScope: null });
      return next;
    });
  });

  const closePendingTimer = Effect.fn("@svvy/runtime/request-input.closePendingTimer")(function* (
    entry: PendingBlockingRequestEffect | undefined,
  ): Effect.fn.Return<void> {
    if (entry?.timerScope) {
      yield* Scope.close(entry.timerScope, Exit.void).pipe(Effect.ignore);
    }
  });

  const isCurrentBlockingTimer = Effect.fn("@svvy/runtime/request-input.isCurrentBlockingTimer")(
    function* (requestId: string, timerVersion: number): Effect.fn.Return<boolean> {
      return yield* Ref.get(pending).pipe(
        Effect.map((entries) => entries.get(requestId)?.timerVersion === timerVersion),
      );
    },
  );

  const removePendingRequest = Effect.fn("@svvy/runtime/request-input.removePendingRequest")(
    function* (
      requestId: string,
      expected: PendingBlockingRequestEffect | undefined,
    ): Effect.fn.Return<PendingBlockingRequestEffect | undefined> {
      if (!expected) {
        return undefined;
      }
      return yield* Ref.modify(pending, (current) => {
        if (current.get(requestId)?.deferred !== expected.deferred) {
          return [undefined, current] as const;
        }
        const next = new Map(current);
        next.delete(requestId);
        return [expected, next] as const;
      });
    },
  );

  const resolveBlockingRequest = Effect.fn("@svvy/runtime/request-input.resolveBlockingRequest")(
    function* (
      state: RuntimeBlockingRequestInputEffectState,
      requestId: string,
    ): Effect.fn.Return<RequestUserInputResult | null, RuntimeBlockingRequestInputWaitError> {
      const requestInputId = requestId as RequestInputRequestId;
      const request = yield* state.requestState
        .getRequestInput({ requestId: requestInputId })
        .pipe(mapRequestInputWaitStateError("runtime.requestInput.resolveBlockingRequest"));
      if (request.questions.some((question) => question.status === "open")) {
        return null;
      }
      const pendingRequest = yield* Ref.get(pending).pipe(
        Effect.map((current) => current.get(requestId)),
      );
      const result = buildResultFromRequest(request);
      const removed = yield* removePendingRequest(requestId, pendingRequest);
      yield* closePendingTimer(removed);
      if (removed) {
        yield* Deferred.succeed(removed.deferred, result).pipe(Effect.asVoid);
      }
      return result;
    },
  );

  const rejectBlockingRequest = Effect.fn("@svvy/runtime/request-input.rejectBlockingRequest")(
    function* (
      state: RuntimeBlockingRequestInputEffectState,
      requestId: string,
      error: RuntimeContractError,
    ): Effect.fn.Return<void, RuntimeBlockingRequestInputWaitError> {
      const pendingRequest = yield* Ref.get(pending).pipe(
        Effect.map((current) => current.get(requestId)),
      );
      if (!pendingRequest) {
        return;
      }
      const cancelled = yield* state.requestState
        .cancelRequestInput({ requestId: requestId as RequestInputRequestId })
        .pipe(mapRequestInputWaitStateError("runtime.requestInput.rejectBlockingRequest"));
      yield* publishCommittedInvalidations(
        state,
        "runtime.requestInput.rejectBlockingRequest.cancelRequest.afterCommit",
        cancelled.afterCommit,
      );
      const removed = yield* removePendingRequest(requestId, pendingRequest);
      yield* closePendingTimer(removed);
      if (removed) {
        yield* Deferred.fail(removed.deferred, error).pipe(Effect.asVoid);
      }
    },
  );

  const finishCancelledRequest = Effect.fn(
    "@svvy/runtime/request-input.finishCancelledBlockingRequest",
  )(function* (
    _state: RuntimeBlockingRequestInputEffectState,
    request: RuntimeRequestInputDetailsRecord,
    pendingRequest: PendingBlockingRequestEffect | undefined,
    reason: string,
  ): Effect.fn.Return<void, RuntimeBlockingRequestInputWaitError> {
    const removed = yield* removePendingRequest(request.requestId, pendingRequest);
    yield* closePendingTimer(removed);
    if (removed) {
      yield* Deferred.fail(
        removed.deferred,
        requestInputWaitError("runtime.requestInput.finishCancelledBlockingRequest", {
          reason: "runtime-shutdown",
          message: reason,
        }),
      ).pipe(Effect.asVoid);
    }
  });

  const scheduleBlockingTimeout = Effect.fn("@svvy/runtime/request-input.scheduleBlockingTimeout")(
    function* (
      state: RuntimeBlockingRequestInputEffectState,
      requestId: string,
    ): Effect.fn.Return<void, RuntimeBlockingRequestInputWaitError> {
      const timerVersion = yield* invalidateBlockingTimer(requestId);
      if (timerVersion === null) {
        return;
      }
      const requestInputId = requestId as RequestInputRequestId;
      const request = yield* state.requestState
        .getRequestInput({ requestId: requestInputId })
        .pipe(mapRequestInputWaitStateError("runtime.requestInput.scheduleBlockingTimeout"));
      const timeout = request.timeout;
      if (
        request.status !== "open" ||
        timeout?.enabled !== true ||
        timeout.pausedAt ||
        !timeout.expiresAt
      ) {
        return;
      }
      const expectedTimerVersion = timeout.timerVersion;
      const expectedExpiresAt = timeout.expiresAt;
      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      const durationMs = Math.max(0, Date.parse(expectedExpiresAt) - now);
      const requestTimerScope = yield* Scope.fork(timerScope, "sequential");
      const timerCompleted = yield* Ref.make(false);
      const installed = yield* installBlockingTimerScope(
        requestId,
        timerVersion,
        requestTimerScope,
      );
      if (!installed) {
        yield* Scope.close(requestTimerScope, Exit.void).pipe(Effect.ignore);
        return;
      }
      yield* Scope.addFinalizer(
        requestTimerScope,
        Ref.get(timerCompleted).pipe(
          Effect.flatMap((completed) =>
            completed || !options.onTimerInterrupted
              ? Effect.void
              : options.onTimerInterrupted(requestId),
          ),
        ),
      );
      yield* Effect.sleep(durationMs).pipe(
        Effect.flatMap(() => Ref.update(timerCompleted, () => true)),
        Effect.flatMap(
          Effect.fn("@svvy/runtime/request-input.fireBlockingTimeout")(function* () {
            if (!(yield* isCurrentBlockingTimer(requestId, timerVersion))) {
              return;
            }
            yield* Ref.update(timerCompleted, () => true);
            yield* clearCurrentBlockingTimerScope(requestId, timerVersion);
            const latest = yield* state.requestState
              .getRequestInput({
                requestId: requestInputId,
              })
              .pipe(mapRequestInputWaitStateError("runtime.requestInput.fireBlockingTimeout"));
            const latestTimeout = latest.timeout;
            if (
              latest.status !== "open" ||
              latestTimeout?.enabled !== true ||
              latestTimeout.pausedAt ||
              latestTimeout.timerVersion !== expectedTimerVersion ||
              latestTimeout.expiresAt !== expectedExpiresAt
            ) {
              return;
            }
            const expired = yield* state.requestState
              .defaultOpenRequestInputQuestions({
                requestId: requestInputId,
                answeredBy: "timeout_default",
                expectedTimerVersion,
                expectedExpiresAt,
              })
              .pipe(mapRequestInputWaitStateError("runtime.requestInput.fireBlockingTimeout"));
            yield* publishCommittedInvalidations(
              state,
              "runtime.requestInput.fireBlockingTimeout.defaultQuestions.afterCommit",
              expired.afterCommit,
            );
            yield* resolveBlockingRequest(state, expired.value.requestId);
            if (options.onRequestUpdated) {
              yield* options.onRequestUpdated();
            }
          }),
        ),
        Effect.catch((cause) =>
          cause instanceof RuntimeContractError && cause.reason === "stale-state"
            ? Effect.void
            : state.requestState.getRequestInput({ requestId: requestInputId }).pipe(
                mapRequestInputWaitStateError("runtime.requestInput.fireBlockingTimeout.recover"),
                Effect.flatMap((latest) =>
                  latest.status === "open"
                    ? rejectBlockingRequest(
                        state,
                        requestId,
                        requestInputWaitError("runtime.requestInput.fireBlockingTimeout", cause),
                      )
                    : latest.status === "cancelled"
                      ? Ref.get(pending).pipe(
                          Effect.map((current) => current.get(requestId)),
                          Effect.flatMap((pendingRequest) =>
                            finishCancelledRequest(
                              state,
                              latest,
                              pendingRequest,
                              "Request user input was cancelled while publishing its terminal state.",
                            ),
                          ),
                        )
                      : resolveBlockingRequest(state, requestId).pipe(Effect.asVoid),
                ),
                Effect.catch(() => Effect.void),
              ),
        ),
        Effect.forkIn(requestTimerScope),
        Effect.asVoid,
      );
    },
  );

  const waitForBlockingRequest = Effect.fn("@svvy/runtime/request-input.waitForBlockingRequest")(
    function* (input: {
      state: RuntimeBlockingRequestInputEffectState;
      request: RuntimeRequestInputDetailsRecord;
      command: RuntimeCommandRecord;
    }): Effect.fn.Return<RequestUserInputResult, RuntimeBlockingRequestInputWaitError> {
      const deferred = yield* Deferred.make<RequestUserInputResult, RuntimeContractError>();
      const inserted = yield* Ref.modify(pending, (current) => {
        if (current.has(input.request.requestId)) {
          return [false, current] as const;
        }
        const next = new Map(current);
        next.set(input.request.requestId, {
          commandId: input.command.id,
          sessionId: input.request.sessionId,
          deferred,
          timerVersion: 0,
          timerScope: null,
        });
        return [true, next] as const;
      });
      if (!inserted) {
        return yield* Effect.fail(
          requestInputWaitError("runtime.requestInput.waitForBlockingRequest", {
            reason: "state-conflict",
            message: `Blocking request_user_input is already waiting: ${input.request.requestId}`,
          }),
        );
      }
      return yield* Effect.gen(function* () {
        yield* resolveBlockingRequest(input.state, input.request.requestId);
        yield* scheduleBlockingTimeout(input.state, input.request.requestId);
        return yield* Deferred.await(deferred);
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            const entry = yield* Ref.modify(pending, (current) => {
              const next = new Map(current);
              const removed = next.get(input.request.requestId);
              next.delete(input.request.requestId);
              return [removed, next] as const;
            });
            yield* closePendingTimer(entry);
          }),
        ),
      );
    },
  );

  const restoreOpenBlockingRequests = Effect.fn(
    "@svvy/runtime/request-input.restoreOpenBlockingRequests",
  )(function* (
    state: RuntimeBlockingRequestInputEffectState,
  ): Effect.fn.Return<void, RuntimeBlockingRequestInputWaitError> {
    const requests = yield* state.requestState
      .listOpenBlockingRequestInputs()
      .pipe(mapRequestInputWaitStateError("runtime.requestInput.restoreOpenBlockingRequests"));
    for (const request of requests) {
      const deferred = yield* Deferred.make<RequestUserInputResult, RuntimeContractError>();
      const inserted = yield* Ref.modify(pending, (current) => {
        if (current.has(request.requestId)) {
          return [false, current] as const;
        }
        const next = new Map(current);
        next.set(request.requestId, {
          commandId: request.commandId,
          sessionId: request.sessionId,
          deferred,
          timerVersion: 0,
          timerScope: null,
        });
        return [true, next] as const;
      });
      if (!inserted) {
        continue;
      }
      yield* scheduleBlockingTimeout(state, request.requestId);
    }
  });

  const setBlockingTimerPaused = Effect.fn("@svvy/runtime/request-input.setBlockingTimerPaused")(
    function* (
      state: RuntimeBlockingRequestInputEffectState,
      requestId: string,
      paused: boolean,
    ): Effect.fn.Return<RuntimeRequestInputDetailsRecord, RuntimeBlockingRequestInputWaitError> {
      const requestInputId = requestId as RequestInputRequestId;
      const existing = yield* state.requestState
        .getRequestInput({ requestId: requestInputId })
        .pipe(mapRequestInputWaitStateError("runtime.requestInput.setBlockingTimerPaused"));
      const result = yield* state.requestState
        .setRequestInputTimerPaused({
          surfacePiSessionId: existing.surfacePiSessionId,
          requestId: requestInputId,
          paused,
        })
        .pipe(mapRequestInputWaitStateError("runtime.requestInput.setBlockingTimerPaused"));
      yield* publishCommittedInvalidations(
        state,
        "runtime.requestInput.setBlockingTimerPaused.afterCommit",
        result.afterCommit,
      );
      yield* scheduleBlockingTimeout(state, requestId);
      return result.value;
    },
  );

  const cancelBlockingRequestsForSurface = Effect.fn(
    "@svvy/runtime/request-input.cancelBlockingRequestsForSurface",
  )(function* (
    state: RuntimeBlockingRequestInputEffectState,
    surfacePiSessionId: string,
    reason = "Request user input cancelled.",
  ): Effect.fn.Return<void, RuntimeBlockingRequestInputWaitError> {
    const requests = yield* state.requestState
      .listOpenBlockingRequestInputs({
        surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
      })
      .pipe(mapRequestInputWaitStateError("runtime.requestInput.cancelBlockingRequestsForSurface"));
    for (const request of requests) {
      const pendingRequest = yield* Ref.get(pending).pipe(
        Effect.map((current) => current.get(request.requestId)),
      );
      const cancelled = yield* state.requestState
        .cancelRequestInput({ requestId: request.requestId })
        .pipe(
          mapRequestInputWaitStateError("runtime.requestInput.cancelBlockingRequestsForSurface"),
        );
      yield* publishCommittedInvalidations(
        state,
        "runtime.requestInput.cancelBlockingRequestsForSurface.cancelRequest.afterCommit",
        cancelled.afterCommit,
      );
      yield* finishCancelledRequest(state, cancelled.value, pendingRequest, reason);
    }
  });

  return {
    waitForBlockingRequest,
    setBlockingTimerPaused,
    rescheduleBlockingTimeout: scheduleBlockingTimeout,
    resolveBlockingRequest,
    cancelBlockingRequestsForSurface,
    restoreOpenBlockingRequests,
    close: () => Scope.close(timerScope, Exit.void).pipe(Effect.ignore),
  };
});

function buildResultFromRequest(request: RuntimeRequestInputDetailsRecord): RequestUserInputResult {
  return {
    answers: request.questions.map((question) => {
      const answer = request.answers
        .filter((entry) => entry.questionId === question.questionId)
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1);
      return {
        title: question.title,
        question: question.question,
        answer: structuredClone(answer?.answer ?? question.defaultAnswer),
        answeredBy: answer?.answeredBy ?? "default",
      };
    }),
  };
}

function requestInputWaitError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  if (isRequestInputWaitKnownFailure(cause)) {
    return new RuntimeContractError({
      operation,
      reason: cause.reason,
      message: cause.message,
    });
  }
  return new RuntimeContractError({
    operation,
    reason: "stale-state",
    message: cause instanceof Error ? cause.message : "Runtime request-input wait failed.",
    cause,
  });
}

function mapRequestInputWaitStateError(operation: string) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError((cause) => requestInputWaitError(operation, cause)));
}

function isRequestInputWaitKnownFailure(cause: unknown): cause is {
  readonly reason: "runtime-closed" | "runtime-shutdown" | "state-conflict";
  readonly message: string;
} {
  if (!cause || typeof cause !== "object") {
    return false;
  }
  const record = cause as { readonly reason?: unknown; readonly message?: unknown };
  return (
    typeof record.message === "string" &&
    (record.reason === "runtime-closed" ||
      record.reason === "runtime-shutdown" ||
      record.reason === "state-conflict")
  );
}
