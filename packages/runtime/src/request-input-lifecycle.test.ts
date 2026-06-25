import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeRequestStatePort,
  StateContractError,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type QueueItemId,
  type RequestInputOptionId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RuntimeRequestStatePortService,
  type SetRequestInputTimerPausedInput,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type WorkspaceId,
} from "@svvy/core";
import {
  answerRuntimeRequestInput,
  RuntimeRequestInputPostCommitLane,
  setRuntimeRequestInputTimerPaused,
} from "./request-input-lifecycle";
import { RuntimeEventBus } from "./runtime-event-bus";
import { runTestEffect } from "./effect.test-support";

const surfacePiSessionId = "pi_runtime_request_input_01" as SurfacePiSessionId;
const requestId = "rui_runtime_request_input_01" as RequestInputRequestId;
const questionId = "ruiq_runtime_request_input_01" as RequestInputQuestionId;
const queuedItemId = "queue_runtime_request_input_01" as QueueItemId;
const requestInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_request_input_lifecycle" as WorkspaceId,
  invalidation: { model: "requestInput", ids: [requestId] },
} satisfies StateInvalidationDescriptor;

function stateMutation<T>(value: T) {
  return { value, afterCommit: [requestInvalidation] };
}

function answerResult(delivery: AnswerRequestInputResult["delivery"]): AnswerRequestInputResult {
  return {
    requestId,
    questionId,
    status: "recorded",
    delivery,
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
): RuntimeRequestInputPostCommitLane["Service"] {
  return RuntimeRequestInputPostCommitLane.of({
    afterAnswerCommitted: (input) =>
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          calls.push(`post-answer:${input.requestId}:${input.queuedItemId ?? "none"}`),
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
      correlationId: "request-input-lifecycle-answer",
      source: "test",
    },
  };
}

function timerInput(): SetRequestInputTimerPausedInput {
  return {
    surfacePiSessionId,
    requestId,
    paused: true,
    clientSubmission: {
      correlationId: "request-input-lifecycle-timer",
      source: "test",
    },
  };
}

describe("request input lifecycle", () => {
  it("records answers through state before publishing committed invalidations", async () => {
    const calls: string[] = [];
    const requestState = {
      createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
      ...unexpectedRequestStateMethods(),
      answerRequestInput: (input) => {
        calls.push(`state:${input.requestId}`);
        return Effect.succeed(
          stateMutation(answerResult({ kind: "nonblocking-queued", queuedItemId })),
        );
      },
      setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
    } satisfies RuntimeRequestStatePortService;

    await expect(
      runTestEffect(
        answerRuntimeRequestInput(answerInput()).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestState),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(RuntimeRequestInputPostCommitLane, postCommitHost(calls)),
        ),
      ),
    ).resolves.toEqual(answerResult({ kind: "nonblocking-queued", queuedItemId }));
    expect(calls).toEqual([
      `state:${requestId}`,
      "publish:1",
      `post-answer:${requestId}:${queuedItemId}`,
    ]);
  });

  it("publishes timer invalidations after the pause state transaction commits", async () => {
    const calls: string[] = [];
    const requestState = {
      createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
      ...unexpectedRequestStateMethods(),
      answerRequestInput: () => Effect.die("Unexpected answerRequestInput call."),
      setRequestInputTimerPaused: (input) => {
        calls.push(`state:${input.requestId}:${input.paused}`);
        return Effect.succeed(stateMutation({ requestId: input.requestId }));
      },
    } satisfies RuntimeRequestStatePortService;

    await expect(
      runTestEffect(
        setRuntimeRequestInputTimerPaused(timerInput()).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestState),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(RuntimeRequestInputPostCommitLane, postCommitHost(calls)),
        ),
      ),
    ).resolves.toEqual({ requestId });
    expect(calls).toEqual([`state:${requestId}:true`, "publish:1", `post-timer:${requestId}`]);
  });

  it("maps request-state failures to runtime contract failures and skips publication", async () => {
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

    await expect(
      runTestEffect(
        answerRuntimeRequestInput(answerInput()).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestState),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(RuntimeRequestInputPostCommitLane, postCommitHost(calls)),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "target-not-found",
      operation: "runtime.requestInput.answer",
    } satisfies Partial<RuntimeContractError>);
    expect(calls).toEqual([]);
  });

  it("maps answer post-commit host failures after publication to runtime contract failures", async () => {
    const calls: string[] = [];
    const requestState = {
      createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
      ...unexpectedRequestStateMethods(),
      answerRequestInput: (input) => {
        calls.push(`state:${input.requestId}`);
        return Effect.succeed(
          stateMutation(answerResult({ kind: "blocking-resolved", queuedItemId: null })),
        );
      },
      setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
    } satisfies RuntimeRequestStatePortService;

    await expect(
      runTestEffect(
        answerRuntimeRequestInput(answerInput()).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestState),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(
            RuntimeRequestInputPostCommitLane,
            postCommitHost(calls, { answerFails: true }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "stale-state",
      operation: "runtime.requestInput.answer",
    } satisfies Partial<RuntimeContractError>);
    expect(calls).toEqual([`state:${requestId}`, "publish:1", `post-answer:${requestId}:none`]);
  });

  it("maps timer post-commit host failures after publication to runtime contract failures", async () => {
    const calls: string[] = [];
    const requestState = {
      createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
      ...unexpectedRequestStateMethods(),
      answerRequestInput: () => Effect.die("Unexpected answerRequestInput call."),
      setRequestInputTimerPaused: (input) => {
        calls.push(`state:${input.requestId}:${input.paused}`);
        return Effect.succeed(stateMutation({ requestId: input.requestId }));
      },
    } satisfies RuntimeRequestStatePortService;

    await expect(
      runTestEffect(
        setRuntimeRequestInputTimerPaused(timerInput()).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestState),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(
            RuntimeRequestInputPostCommitLane,
            postCommitHost(calls, { timerFails: true }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "stale-state",
      operation: "runtime.requestInput.setTimerPaused",
    } satisfies Partial<RuntimeContractError>);
    expect(calls).toEqual([`state:${requestId}:true`, "publish:1", `post-timer:${requestId}`]);
  });
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
