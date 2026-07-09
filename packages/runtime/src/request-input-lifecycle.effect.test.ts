import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeRequestStatePort,
  StateContractError,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type FiniteDurationMs,
  type PositiveDurationMs,
  type PromptTarget,
  type QueueItemId,
  type RequestInputOptionId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RuntimeClientCorrelationId,
  type RuntimeClientSubmissionSource,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestStatePortService,
  type SetRequestInputTimerPausedInput,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
  type CommandId,
} from "@svvy/core";
import {
  answerRuntimeRequestInput,
  setRuntimeRequestInputTimerPaused,
} from "./request-input-lifecycle";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";

const surfacePiSessionId = "pi_runtime_request_input_01" as SurfacePiSessionId;
const requestId = "rui_runtime_request_input_01" as RequestInputRequestId;
const questionId = "ruiq_runtime_request_input_01" as RequestInputQuestionId;
const queuedItemId = "queue_runtime_request_input_01" as QueueItemId;
const BLOCKING_TIMEOUT_MS = 300_000 as PositiveDurationMs;
const PAUSED_REMAINING_MS = 299_000 as FiniteDurationMs;
const target = {
  workspaceSessionId: "session_runtime_request_input_01" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId,
} satisfies PromptTarget;
const requestInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_request_input_lifecycle" as WorkspaceId,
  invalidation: { model: "requestInput", ids: [requestId] },
} satisfies StateInvalidationDescriptor;

function stateMutation<T>(value: T) {
  return { value, afterCommit: [requestInvalidation] };
}

function answerMutation(delivery: AnswerRequestInputResult["delivery"]) {
  return stateMutation({ answer: answerResult(delivery), target });
}

function answerResult(delivery: AnswerRequestInputResult["delivery"]): AnswerRequestInputResult {
  return {
    requestId,
    questionId,
    status: "recorded",
    delivery,
  };
}

function committedRequestDetails(): RuntimeRequestInputDetailsRecord {
  return {
    requestId,
    sessionId: "session_runtime_request_input_01" as WorkspaceSessionId,
    surfacePiSessionId,
    threadId: null,
    turnId: "turn_runtime_request_input_01" as TurnId,
    commandId: "command_runtime_request_input_01" as CommandId,
    variant: "blocking",
    status: "open",
    questionCount: 1,
    toolItemId: "tool_runtime_request_input_01" as ToolItemId,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    timeout: {
      enabled: true,
      durationMs: BLOCKING_TIMEOUT_MS,
      startedAt: "2026-01-01T00:00:00.000Z",
      pausedAt: "2026-01-01T00:00:01.000Z",
      remainingMsWhenPaused: PAUSED_REMAINING_MS,
      expiresAt: null,
    },
    questions: [],
    answers: [],
  };
}

function eventBus(calls: string[]): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected live event publication."),
    publishStateInvalidations: (input) =>
      Effect.sync(() => {
        calls.push(`publish:${input.afterCommit.length}`);
        return [];
      }),
    subscribe: () => Effect.die("Unexpected runtime event subscription."),
  });
}

function postCommitHost(
  calls: string[],
  options?: { readonly answerFails?: boolean; readonly timerFails?: boolean },
): RuntimeRequestInputWaitService["Service"] {
  return RuntimeRequestInputWaitService.of({
    waitForBlockingRequest: () => Effect.die("Unexpected waitForBlockingRequest call."),
    afterAnswerCommitted: (input) =>
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          calls.push(
            `post-answer:${input.requestId}:${input.delivery.kind}:${input.delivery.queuedItemId ?? "none"}:${input.target.surface}`,
          ),
        );
        if (options?.answerFails) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.requestInput.answer",
              reason: "stale-state",
              message: "Request-input answer post-commit host failed.",
            }),
          );
        }
      }),
    afterTimerPausedCommitted: (input) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => calls.push(`post-timer:${input.requestId}`));
        if (options?.timerFails) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.requestInput.setTimerPaused",
              reason: "stale-state",
              message: "Request-input timer post-commit host failed.",
            }),
          );
        }
      }),
    restoreOpenBlockingRequests: () => Effect.die("Unexpected request-input startup restore."),
    cancelBlockingRequestsForSurface: () =>
      Effect.die("Unexpected request-input surface cancellation."),
  });
}

function answerInput(): AnswerRequestInputInput {
  return {
    surfacePiSessionId,
    requestId,
    questionId,
    answer: { kind: "option", optionId: "ruio_runtime_request_input_01" as RequestInputOptionId },
    delivery: "enqueue-and-run",
    clientSubmission: {
      correlationId: "request-input-lifecycle-answer" as RuntimeClientCorrelationId,
      source: "test" as RuntimeClientSubmissionSource,
    },
  };
}

function timerInput(): SetRequestInputTimerPausedInput {
  return {
    surfacePiSessionId,
    requestId,
    paused: true,
    clientSubmission: {
      correlationId: "request-input-lifecycle-timer" as RuntimeClientCorrelationId,
      source: "test" as RuntimeClientSubmissionSource,
    },
  };
}

describe("request input lifecycle", () => {
  it.effect("records answers through state before publishing committed invalidations", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const requestState = {
        createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
        ...unexpectedRequestStateMethods(),
        answerRequestInput: (input) => {
          calls.push(`state:${input.requestId}`);
          return Effect.succeed(answerMutation({ kind: "nonblocking-queued", queuedItemId }));
        },
        setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
      } satisfies RuntimeRequestStatePortService;

      const result = yield* answerRuntimeRequestInput(answerInput()).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestState),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeRequestInputWaitService, postCommitHost(calls)),
      );
      assert.deepStrictEqual(result, answerResult({ kind: "nonblocking-queued", queuedItemId }));
      assert.deepStrictEqual(calls, [
        `state:${requestId}`,
        "publish:1",
        `post-answer:${requestId}:nonblocking-queued:${queuedItemId}:orchestrator`,
      ]);
    }),
  );

  it.effect("passes blocking resolved delivery to the wait service after publication", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const requestState = {
        createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
        ...unexpectedRequestStateMethods(),
        answerRequestInput: (input) => {
          calls.push(`state:${input.requestId}`);
          return Effect.succeed(answerMutation({ kind: "blocking-resolved", queuedItemId: null }));
        },
        setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
      } satisfies RuntimeRequestStatePortService;

      const result = yield* answerRuntimeRequestInput(answerInput()).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestState),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeRequestInputWaitService, postCommitHost(calls)),
      );
      assert.deepStrictEqual(
        result,
        answerResult({ kind: "blocking-resolved", queuedItemId: null }),
      );
      assert.deepStrictEqual(calls, [
        `state:${requestId}`,
        "publish:1",
        `post-answer:${requestId}:blocking-resolved:none:orchestrator`,
      ]);
    }),
  );

  it.effect("passes blocking-open delivery to the wait service after publication", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const requestState = {
        createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
        ...unexpectedRequestStateMethods(),
        answerRequestInput: (input) => {
          calls.push(`state:${input.requestId}`);
          return Effect.succeed(answerMutation({ kind: "blocking-open", queuedItemId: null }));
        },
        setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
      } satisfies RuntimeRequestStatePortService;

      const result = yield* answerRuntimeRequestInput(answerInput()).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestState),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeRequestInputWaitService, postCommitHost(calls)),
      );
      assert.deepStrictEqual(result, answerResult({ kind: "blocking-open", queuedItemId: null }));
      assert.deepStrictEqual(calls, [
        `state:${requestId}`,
        "publish:1",
        `post-answer:${requestId}:blocking-open:none:orchestrator`,
      ]);
    }),
  );

  it.effect("passes nonblocking recorded delivery to the wait service after publication", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const requestState = {
        createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
        ...unexpectedRequestStateMethods(),
        answerRequestInput: (input) => {
          calls.push(`state:${input.requestId}`);
          return Effect.succeed(
            answerMutation({ kind: "nonblocking-recorded", queuedItemId: null }),
          );
        },
        setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
      } satisfies RuntimeRequestStatePortService;

      const result = yield* answerRuntimeRequestInput(answerInput()).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestState),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeRequestInputWaitService, postCommitHost(calls)),
      );
      assert.deepStrictEqual(
        result,
        answerResult({ kind: "nonblocking-recorded", queuedItemId: null }),
      );
      assert.deepStrictEqual(calls, [
        `state:${requestId}`,
        "publish:1",
        `post-answer:${requestId}:nonblocking-recorded:none:orchestrator`,
      ]);
    }),
  );

  it.effect("publishes timer invalidations after the pause state transaction commits", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const requestState = {
        createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
        ...unexpectedRequestStateMethods(),
        answerRequestInput: () => Effect.die("Unexpected answerRequestInput call."),
        setRequestInputTimerPaused: (input) => {
          calls.push(`state:${input.requestId}:${input.paused}`);
          return Effect.succeed(stateMutation(committedRequestDetails()));
        },
      } satisfies RuntimeRequestStatePortService;

      const result = yield* setRuntimeRequestInputTimerPaused(timerInput()).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestState),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeRequestInputWaitService, postCommitHost(calls)),
      );
      assert.deepStrictEqual(result, { requestId });
      assert.deepStrictEqual(calls, [
        `state:${requestId}:true`,
        "publish:1",
        `post-timer:${requestId}`,
      ]);
    }),
  );

  it.effect("maps request-state failures to runtime contract failures and skips publication", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const requestState = {
        createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
        ...unexpectedRequestStateMethods(),
        answerRequestInput: () =>
          Effect.fail(
            new StateContractError({
              operation: "runtime-request-state.answerRequestInput",
              reason: "not-found",
              message: "Request not found.",
            }),
          ),
        setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
      } satisfies RuntimeRequestStatePortService;

      const error = yield* answerRuntimeRequestInput(answerInput()).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestState),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeRequestInputWaitService, postCommitHost(calls)),
        Effect.flip,
      );
      assert.deepStrictEqual(
        { _tag: error._tag, reason: error.reason, operation: error.operation },
        {
          _tag: "RuntimeContractError",
          reason: "target-not-found",
          operation: "runtime.requestInput.answer",
        } satisfies Partial<RuntimeContractError>,
      );
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect(
    "maps answer post-commit host failures after publication to runtime contract failures",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const requestState = {
          createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
          ...unexpectedRequestStateMethods(),
          answerRequestInput: (input) => {
            calls.push(`state:${input.requestId}`);
            return Effect.succeed(
              answerMutation({ kind: "blocking-resolved", queuedItemId: null }),
            );
          },
          setRequestInputTimerPaused: () =>
            Effect.die("Unexpected setRequestInputTimerPaused call."),
        } satisfies RuntimeRequestStatePortService;

        const error = yield* answerRuntimeRequestInput(answerInput()).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestState),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(
            RuntimeRequestInputWaitService,
            postCommitHost(calls, { answerFails: true }),
          ),
          Effect.flip,
        );
        assert.deepStrictEqual(
          { _tag: error._tag, reason: error.reason, operation: error.operation },
          {
            _tag: "RuntimeContractError",
            reason: "stale-state",
            operation: "runtime.requestInput.answer",
          } satisfies Partial<RuntimeContractError>,
        );
        assert.deepStrictEqual(calls, [
          `state:${requestId}`,
          "publish:1",
          `post-answer:${requestId}:blocking-resolved:none:orchestrator`,
        ]);
      }),
  );

  it.effect(
    "maps timer post-commit host failures after publication to runtime contract failures",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const requestState = {
          createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
          ...unexpectedRequestStateMethods(),
          answerRequestInput: () => Effect.die("Unexpected answerRequestInput call."),
          setRequestInputTimerPaused: (input) => {
            calls.push(`state:${input.requestId}:${input.paused}`);
            return Effect.succeed(stateMutation(committedRequestDetails()));
          },
        } satisfies RuntimeRequestStatePortService;

        const error = yield* setRuntimeRequestInputTimerPaused(timerInput()).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestState),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(
            RuntimeRequestInputWaitService,
            postCommitHost(calls, { timerFails: true }),
          ),
          Effect.flip,
        );
        assert.deepStrictEqual(
          { _tag: error._tag, reason: error.reason, operation: error.operation },
          {
            _tag: "RuntimeContractError",
            reason: "stale-state",
            operation: "runtime.requestInput.setTimerPaused",
          } satisfies Partial<RuntimeContractError>,
        );
        assert.deepStrictEqual(calls, [
          `state:${requestId}:true`,
          "publish:1",
          `post-timer:${requestId}`,
        ]);
      }),
  );
});

function unexpectedRequestStateMethods(): Pick<
  RuntimeRequestStatePortService,
  | "getRequestInput"
  | "listOpenBlockingRequestInputs"
  | "defaultOpenRequestInputQuestions"
  | "cancelRequestInput"
> {
  return {
    getRequestInput: () => Effect.die("Unexpected getRequestInput call."),
    listOpenBlockingRequestInputs: () =>
      Effect.die("Unexpected listOpenBlockingRequestInputs call."),
    defaultOpenRequestInputQuestions: () =>
      Effect.die("Unexpected defaultOpenRequestInputQuestions call."),
    cancelRequestInput: () => Effect.die("Unexpected cancelRequestInput call."),
  };
}
