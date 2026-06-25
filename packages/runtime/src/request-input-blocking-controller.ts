import {
  type RequestInputRequestId,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type StateContractError,
  type SurfacePiSessionId,
  type WorkspaceSessionId,
} from "@svvy/core";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import type { RequestUserInputResult } from "@svvy/extensions";

export type RuntimeBlockingRequestInputEffectState = {
  commandState: RuntimeCommandStatePortService;
  requestState: RuntimeRequestStatePortService;
  sessionWaitState: RuntimeSessionWaitStatePortService;
};

type PendingBlockingRequestEffect = {
  commandId: string;
  sessionId: string;
  deferred: Deferred.Deferred<RequestUserInputResult, Error>;
  timerVersion: number;
};

export type RuntimeBlockingRequestInputWaitRegistryOptions = {
  onRequestUpdated?: () => Effect.Effect<void>;
};

export type RuntimeBlockingRequestInputWaitRegistry = {
  waitForBlockingRequest(input: {
    state: RuntimeBlockingRequestInputEffectState;
    request: RuntimeRequestInputDetailsRecord;
    command: RuntimeCommandRecord;
  }): Effect.Effect<RequestUserInputResult, StateContractError | Error>;
  setBlockingTimerPaused(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
    paused: boolean,
  ): Effect.Effect<RuntimeRequestInputDetailsRecord, StateContractError | Error>;
  rescheduleBlockingTimeout(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
  ): Effect.Effect<void, StateContractError | Error>;
  resolveBlockingRequest(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
  ): Effect.Effect<RequestUserInputResult | null, StateContractError | Error>;
  rejectBlockingRequest(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
    error: Error,
  ): Effect.Effect<void, StateContractError | Error>;
  cancelBlockingRequestsForSurface(
    state: RuntimeBlockingRequestInputEffectState,
    surfacePiSessionId: string,
    reason?: string,
  ): Effect.Effect<void, StateContractError | Error>;
  restoreOpenBlockingRequests(
    state: RuntimeBlockingRequestInputEffectState,
  ): Effect.Effect<void, StateContractError | Error>;
  close(): Effect.Effect<void>;
};

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
          Deferred.fail(entry.deferred, new Error("Request user input wait registry closed.")).pipe(
            Effect.asVoid,
          ),
        { discard: true },
      );
    },
  );

  yield* Scope.addFinalizer(timerScope, closePending());

  const invalidateBlockingTimer = Effect.fn("@svvy/runtime/request-input.invalidateBlockingTimer")(
    function* (requestId: string): Effect.fn.Return<number | null> {
      return yield* Ref.modify(pending, (current) => {
        const entry = current.get(requestId);
        if (!entry) {
          return [null, current] as const;
        }
        const next = new Map(current);
        const nextVersion = entry.timerVersion + 1;
        next.set(requestId, { ...entry, timerVersion: nextVersion });
        return [nextVersion, next] as const;
      });
    },
  );

  const isCurrentBlockingTimer = Effect.fn("@svvy/runtime/request-input.isCurrentBlockingTimer")(
    function* (requestId: string, timerVersion: number): Effect.fn.Return<boolean> {
      return yield* Ref.get(pending).pipe(
        Effect.map((entries) => entries.get(requestId)?.timerVersion === timerVersion),
      );
    },
  );

  const finishResolvedRequest = Effect.fn(
    "@svvy/runtime/request-input.finishResolvedBlockingRequest",
  )(function* (
    state: RuntimeBlockingRequestInputEffectState,
    request: RuntimeRequestInputDetailsRecord,
    pendingRequest: PendingBlockingRequestEffect | undefined,
  ): Effect.fn.Return<RequestUserInputResult, StateContractError | Error> {
    yield* state.sessionWaitState.clearSessionWait({
      sessionId: (pendingRequest?.sessionId ?? request.sessionId) as WorkspaceSessionId,
    });
    const result = buildResultFromRequest(request);
    const answeredBy = summarizeRequestUserInputResult(result);
    yield* state.commandState.finishCommand({
      commandId: pendingRequest?.commandId ?? request.commandId,
      status: "succeeded",
      summary:
        request.questions.length === 1
          ? `Answered ${request.questions[0]!.title}.`
          : `Answered ${request.questions.length} clarification questions.`,
      facts: {
        questionCount: request.questions.length,
        answeredBy,
        result,
      },
    });
    if (pendingRequest) {
      yield* Deferred.succeed(pendingRequest.deferred, result).pipe(Effect.asVoid);
    }
    return result;
  });

  const resolveBlockingRequest = Effect.fn("@svvy/runtime/request-input.resolveBlockingRequest")(
    function* (
      state: RuntimeBlockingRequestInputEffectState,
      requestId: string,
    ): Effect.fn.Return<RequestUserInputResult | null, StateContractError | Error> {
      const requestInputId = requestId as RequestInputRequestId;
      const request = yield* state.requestState.getRequestInput({ requestId: requestInputId });
      if (request.questions.some((question) => question.status === "open")) {
        return null;
      }
      const pendingRequest = yield* Ref.modify(pending, (current) => {
        const next = new Map(current);
        const entry = next.get(requestId);
        next.delete(requestId);
        return [entry, next] as const;
      });
      return yield* finishResolvedRequest(state, request, pendingRequest);
    },
  );

  const rejectBlockingRequest = Effect.fn("@svvy/runtime/request-input.rejectBlockingRequest")(
    function* (
      state: RuntimeBlockingRequestInputEffectState,
      requestId: string,
      error: Error,
    ): Effect.fn.Return<void, StateContractError | Error> {
      const pendingRequest = yield* Ref.modify(pending, (current) => {
        const next = new Map(current);
        const entry = next.get(requestId);
        next.delete(requestId);
        return [entry, next] as const;
      });
      if (!pendingRequest) {
        return;
      }
      yield* state.sessionWaitState.clearSessionWait({
        sessionId: pendingRequest.sessionId as WorkspaceSessionId,
      });
      yield* state.commandState.finishCommand({
        commandId: pendingRequest.commandId,
        status: "failed",
        error: error.message,
        summary: "Request user input failed.",
      });
      yield* Deferred.fail(pendingRequest.deferred, error).pipe(Effect.asVoid);
    },
  );

  const scheduleBlockingTimeout = Effect.fn("@svvy/runtime/request-input.scheduleBlockingTimeout")(
    function* (
      state: RuntimeBlockingRequestInputEffectState,
      requestId: string,
    ): Effect.fn.Return<void, StateContractError | Error> {
      const timerVersion = yield* invalidateBlockingTimer(requestId);
      if (timerVersion === null) {
        return;
      }
      const requestInputId = requestId as RequestInputRequestId;
      const request = yield* state.requestState.getRequestInput({ requestId: requestInputId });
      const timeout = request.timeout;
      if (
        request.status !== "open" ||
        timeout?.enabled !== true ||
        timeout.pausedAt ||
        !timeout.expiresAt
      ) {
        return;
      }
      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      const durationMs = Math.max(0, Date.parse(timeout.expiresAt) - now);
      yield* Effect.sleep(durationMs).pipe(
        Effect.flatMap(
          Effect.fn("@svvy/runtime/request-input.fireBlockingTimeout")(function* () {
            if (!(yield* isCurrentBlockingTimer(requestId, timerVersion))) {
              return;
            }
            const latest = yield* state.requestState.getRequestInput({
              requestId: requestInputId,
            });
            const latestTimeout = latest.timeout;
            if (
              latest.status !== "open" ||
              latestTimeout?.enabled !== true ||
              latestTimeout.pausedAt ||
              !latestTimeout.expiresAt
            ) {
              return;
            }
            const expired = yield* state.requestState.defaultOpenRequestInputQuestions({
              requestId: requestInputId,
              answeredBy: "timeout_default",
            });
            yield* resolveBlockingRequest(state, expired.value.requestId);
            if (options.onRequestUpdated) {
              yield* options.onRequestUpdated();
            }
          }),
        ),
        Effect.catch((cause) =>
          rejectBlockingRequest(
            state,
            requestId,
            cause instanceof Error ? cause : new Error("Blocking request_user_input failed."),
          ),
        ),
        Effect.forkIn(timerScope),
        Effect.asVoid,
      );
    },
  );

  const enterBlockingWait = Effect.fn("@svvy/runtime/request-input.enterBlockingWait")(function* (
    state: RuntimeBlockingRequestInputEffectState,
    request: RuntimeRequestInputDetailsRecord,
  ): Effect.fn.Return<void, StateContractError> {
    yield* state.commandState.finishCommand({
      commandId: request.commandId,
      status: "waiting",
      summary: `Waiting for user answer: ${request.questions.map((question) => question.title).join("; ")}`,
      facts: {
        questionCount: request.questions.length,
        answeredBy: "pending",
      },
    });
    yield* state.sessionWaitState
      .setUserWait({
        sessionId: request.sessionId,
        owner: request.threadId
          ? { kind: "thread", threadId: request.threadId }
          : { kind: "orchestrator" },
        reason:
          request.questions.length === 1
            ? request.questions[0]!.title
            : `Waiting for ${request.questions.length} clarification answers.`,
        resumeWhen: "Resume when the user answers the clarification request.",
      })
      .pipe(Effect.catch(() => Effect.void));
  });

  const waitForBlockingRequest = Effect.fn("@svvy/runtime/request-input.waitForBlockingRequest")(
    function* (input: {
      state: RuntimeBlockingRequestInputEffectState;
      request: RuntimeRequestInputDetailsRecord;
      command: RuntimeCommandRecord;
    }): Effect.fn.Return<RequestUserInputResult, StateContractError | Error> {
      const deferred = yield* Deferred.make<RequestUserInputResult, Error>();
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
        });
        return [true, next] as const;
      });
      if (!inserted) {
        return yield* Effect.fail(
          new Error(`Blocking request_user_input is already waiting: ${input.request.requestId}`),
        );
      }
      yield* enterBlockingWait(input.state, input.request);
      yield* scheduleBlockingTimeout(input.state, input.request.requestId);
      return yield* Deferred.await(deferred).pipe(
        Effect.ensuring(
          Ref.update(pending, (current) => {
            const next = new Map(current);
            next.delete(input.request.requestId);
            return next;
          }),
        ),
      );
    },
  );

  const restoreOpenBlockingRequests = Effect.fn(
    "@svvy/runtime/request-input.restoreOpenBlockingRequests",
  )(function* (
    state: RuntimeBlockingRequestInputEffectState,
  ): Effect.fn.Return<void, StateContractError | Error> {
    const requests = yield* state.requestState.listOpenBlockingRequestInputs();
    for (const request of requests) {
      const deferred = yield* Deferred.make<RequestUserInputResult, Error>();
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
        });
        return [true, next] as const;
      });
      if (!inserted) {
        continue;
      }
      yield* enterBlockingWait(state, request);
      yield* scheduleBlockingTimeout(state, request.requestId);
    }
  });

  const setBlockingTimerPaused = Effect.fn("@svvy/runtime/request-input.setBlockingTimerPaused")(
    function* (
      state: RuntimeBlockingRequestInputEffectState,
      requestId: string,
      paused: boolean,
    ): Effect.fn.Return<RuntimeRequestInputDetailsRecord, StateContractError | Error> {
      const requestInputId = requestId as RequestInputRequestId;
      const existing = yield* state.requestState.getRequestInput({ requestId: requestInputId });
      yield* state.requestState.setRequestInputTimerPaused({
        surfacePiSessionId: existing.surfacePiSessionId,
        requestId: requestInputId,
        paused,
      });
      const request = yield* state.requestState.getRequestInput({ requestId: requestInputId });
      yield* scheduleBlockingTimeout(state, requestId);
      return request;
    },
  );

  const cancelBlockingRequestsForSurface = Effect.fn(
    "@svvy/runtime/request-input.cancelBlockingRequestsForSurface",
  )(function* (
    state: RuntimeBlockingRequestInputEffectState,
    surfacePiSessionId: string,
    reason = "Request user input cancelled.",
  ): Effect.fn.Return<void, StateContractError | Error> {
    const requests = yield* state.requestState.listOpenBlockingRequestInputs({
      surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
    });
    for (const request of requests) {
      const pendingRequest = yield* Ref.modify(pending, (current) => {
        const next = new Map(current);
        const entry = next.get(request.requestId);
        next.delete(request.requestId);
        return [entry, next] as const;
      });
      yield* state.requestState.cancelRequestInput({ requestId: request.requestId });
      yield* state.sessionWaitState.clearSessionWait({ sessionId: request.sessionId });
      yield* state.commandState.finishCommand({
        commandId: request.commandId,
        status: "cancelled",
        error: reason,
        summary: "Request user input cancelled.",
      });
      if (pendingRequest) {
        yield* Deferred.fail(pendingRequest.deferred, new Error(reason)).pipe(Effect.asVoid);
      }
    }
  });

  return {
    waitForBlockingRequest,
    setBlockingTimerPaused,
    rescheduleBlockingTimeout: scheduleBlockingTimeout,
    resolveBlockingRequest,
    rejectBlockingRequest,
    cancelBlockingRequestsForSurface,
    restoreOpenBlockingRequests,
    close: () => Scope.close(timerScope, Exit.void).pipe(Effect.ignore),
  };
});

function summarizeRequestUserInputResult(
  result: RequestUserInputResult,
): "user" | "default" | "timeout_default" | "mixed" {
  const values = new Set(result.answers.map((answer) => answer.answeredBy));
  if (values.size === 1) {
    return result.answers[0]?.answeredBy ?? "default";
  }
  return "mixed";
}

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
