import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";
import {
  type CommandId,
  type PositiveDurationMs,
  type RequestInputAnswerId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type SurfacePiSessionId,
  type ToolItemId,
  type TurnId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { makeRuntimeBlockingRequestInputWaitRegistry } from "./request-input-blocking-controller";

const sessionId = "session_runtime_blocking_rui" as WorkspaceSessionId;
const surfacePiSessionId = "pi_runtime_blocking_rui" as SurfacePiSessionId;
const requestId = "rui_runtime_blocking_rui" as RequestInputRequestId;
const commandId = "cmd_runtime_blocking_rui" as CommandId;
const questionId = "ruiq_runtime_blocking_rui" as RequestInputQuestionId;
const SHORT_TIMEOUT_MS = 500 as PositiveDurationMs;

function stateMutation<T>(value: T) {
  return { value, afterCommit: [] };
}

describe("RuntimeBlockingRequestInputWaitRegistry", () => {
  it.effect("resolves timeout waits through the Effect Deferred registry", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const request = makeOpenRequest();
        const command = makeCommand();
        const commandEvents: unknown[] = [];
        const waits: unknown[] = [];
        const state = makeEffectState({ request, commandEvents, waits });

        const registry = yield* makeRuntimeBlockingRequestInputWaitRegistry();
        const resultFiber = yield* registry
          .waitForBlockingRequest({
            state,
            request,
            command,
          })
          .pipe(Effect.forkScoped);
        yield* TestClock.adjust(1500);
        const result = yield* Fiber.join(resultFiber);

        assert.deepStrictEqual(result, {
          answers: [
            {
              title: "CI scope",
              question: "What should run before handoff?",
              answer: { kind: "custom", text: "Use unit checks." },
              answeredBy: "timeout_default",
            },
          ],
        });
        assert.deepStrictEqual(commandEventSummaries(commandEvents), [
          {
            commandId,
            status: "waiting",
            facts: { questionCount: 1, answeredBy: "pending" },
          },
          {
            commandId,
            status: "succeeded",
            facts: { questionCount: 1, answeredBy: "timeout_default" },
          },
        ]);
        assert.deepStrictEqual(waitKinds(waits), ["set", "clear"]);
      }),
    ),
  );

  it.effect("invalidates stale Effect timeout fibers when a blocking timer is paused", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const openRequest = makeOpenRequest();
        const request = {
          ...openRequest,
          timeout: {
            ...openRequest.timeout!,
            expiresAt: "1970-01-01T00:00:00.025Z",
          },
        };
        const command = makeCommand();
        const commandEvents: unknown[] = [];
        const waits: unknown[] = [];
        const defaultCalls: unknown[] = [];
        const timerInterrupted = yield* Deferred.make<string>();
        const state = makeEffectState({ request, commandEvents, waits, defaultCalls });

        const registry = yield* makeRuntimeBlockingRequestInputWaitRegistry({
          onTimerInterrupted: (interruptedRequestId) =>
            Deferred.succeed(timerInterrupted, interruptedRequestId).pipe(Effect.asVoid),
        });
        const waitFiber = yield* registry
          .waitForBlockingRequest({
            state,
            request,
            command,
          })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* registry.setBlockingTimerPaused(state, request.requestId, true);
        const interruptedRequestId = yield* Deferred.await(timerInterrupted);
        yield* TestClock.adjust(75);
        const status = request.status;
        yield* registry.close();
        yield* Fiber.await(waitFiber).pipe(Effect.ignore);

        assert.strictEqual(status, "open");
        assert.deepStrictEqual(defaultCalls, []);
        assert.strictEqual(interruptedRequestId, request.requestId);
        assert.deepStrictEqual(commandEventSummaries(commandEvents), [
          {
            commandId,
            status: "waiting",
            facts: { questionCount: 1, answeredBy: "pending" },
          },
        ]);
      }),
    ),
  );

  it.effect("rejects pending blocking waits when the parent scope closes", () =>
    Effect.gen(function* () {
      const request = { ...makeOpenRequest(), timeout: null };
      const command = makeCommand();
      const commandEvents: unknown[] = [];
      const waits: unknown[] = [];
      const state = makeEffectState({ request, commandEvents, waits });
      const scope = yield* Scope.make("sequential");
      const registry = yield* makeRuntimeBlockingRequestInputWaitRegistry().pipe(
        Effect.provideService(Scope.Scope, scope),
      );

      const waitFiber = yield* registry
        .waitForBlockingRequest({
          state,
          request,
          command,
        })
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* Scope.close(scope, Exit.void);
      const exit = yield* Fiber.await(waitFiber);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.match(Cause.pretty(exit.cause), /Request user input wait registry closed/);
      }
      assert.deepStrictEqual(commandEventSummaries(commandEvents), [
        {
          commandId,
          status: "waiting",
          facts: { questionCount: 1, answeredBy: "pending" },
        },
      ]);
    }),
  );

  it.effect("restores open blocking requests into command/session wait state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const request = { ...makeOpenRequest(), timeout: null };
        const commandEvents: unknown[] = [];
        const waits: unknown[] = [];
        const state = makeEffectState({
          request,
          commandEvents,
          waits,
          openRequests: [request],
        });

        const registry = yield* makeRuntimeBlockingRequestInputWaitRegistry();
        yield* registry.restoreOpenBlockingRequests(state);
        yield* registry.close();

        assert.deepStrictEqual(commandEventSummaries(commandEvents), [
          {
            commandId,
            status: "waiting",
            facts: { questionCount: 1, answeredBy: "pending" },
          },
        ]);
        assert.deepStrictEqual(waitKinds(waits), ["set"]);
      }),
    ),
  );
});

function commandEventSummaries(events: unknown[]) {
  return events.map((event) => {
    const record = event as {
      commandId: CommandId;
      status: string;
      facts?: { questionCount?: number; answeredBy?: string } | null;
    };
    return {
      commandId: record.commandId,
      status: record.status,
      facts: record.facts
        ? {
            questionCount: record.facts.questionCount,
            answeredBy: record.facts.answeredBy,
          }
        : null,
    };
  });
}

function waitKinds(waits: unknown[]) {
  return waits.map((wait) => (wait as { kind: string }).kind);
}

function makeCommand(): RuntimeCommandRecord {
  return {
    id: commandId,
    sessionId,
    turnId: "turn_runtime_blocking_rui",
    workflowTaskAttemptId: null,
    surfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName: "request_user_input",
    executor: "orchestrator",
    visibility: "surface",
    status: "running",
    attempts: 1,
    title: "Ask user: CI scope",
    summary: "CI scope",
    arguments: {},
    facts: null,
    error: null,
    startedAt: "2026-06-21T00:00:01.000Z",
    updatedAt: "2026-06-21T00:00:01.000Z",
    finishedAt: null,
  };
}

function makeEffectState(input: {
  request: RuntimeRequestInputDetailsRecord;
  commandEvents: unknown[];
  waits: unknown[];
  openRequests?: RuntimeRequestInputDetailsRecord[];
  defaultCalls?: unknown[];
}) {
  let currentRequest = input.request;
  const requestState = {
    createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
    getRequestInput: () => Effect.succeed(currentRequest),
    listOpenBlockingRequestInputs: () =>
      input.openRequests
        ? Effect.succeed(input.openRequests)
        : Effect.die("Unexpected listOpenBlockingRequestInputs."),
    answerRequestInput: () => Effect.die("Unexpected answerRequestInput call."),
    setRequestInputTimerPaused: (pauseInput) =>
      Effect.sync(() => {
        currentRequest = {
          ...currentRequest,
          timeout: currentRequest.timeout
            ? {
                ...currentRequest.timeout,
                pausedAt: pauseInput.paused ? "2026-06-21T00:00:01.250Z" : null,
              }
            : null,
        };
        return stateMutation(currentRequest);
      }),
    defaultOpenRequestInputQuestions: () =>
      Effect.sync(() => {
        input.defaultCalls?.push({ requestId });
        currentRequest = {
          ...currentRequest,
          status: "completed",
          completedAt: "2026-06-21T00:00:01.500Z",
          questions: currentRequest.questions.map((question) => ({
            ...question,
            status: "defaulted",
          })),
          answers: [
            {
              answerId: "ruia_runtime_blocking_rui" as RequestInputAnswerId,
              requestId,
              questionId,
              answer: { kind: "custom", text: "Use unit checks." },
              answeredBy: "timeout_default",
              delivery: null,
              queuedItemId: null,
              createdAt: "2026-06-21T00:00:01.500Z",
            },
          ],
        };
        return stateMutation(currentRequest);
      }),
    cancelRequestInput: () => Effect.die("Unexpected cancelRequestInput call."),
  } satisfies RuntimeRequestStatePortService;
  const commandState = {
    finishCommand: (finishInput) =>
      Effect.sync(() => {
        input.commandEvents.push(finishInput);
        return stateMutation({
          ...makeCommand(),
          status: finishInput.status,
          summary: finishInput.summary ?? "CI scope",
          facts: finishInput.facts ?? null,
          error: finishInput.error ?? null,
          finishedAt: finishInput.status === "waiting" ? null : "2026-06-21T00:00:01.500Z",
        });
      }),
    createCommand: () => Effect.die("Unexpected createCommand call."),
    createOrReuseStreamingCommand: () =>
      Effect.die("Unexpected createOrReuseStreamingCommand call."),
    findCommandByToolCallId: () => Effect.die("Unexpected findCommandByToolCallId call."),
    findCommandById: () => Effect.die("Unexpected findCommandById call."),
    updateCommandArguments: () => Effect.die("Unexpected updateCommandArguments call."),
    startCommand: () => Effect.die("Unexpected startCommand call."),
    recordCommandEvent: () => Effect.die("Unexpected recordCommandEvent call."),
    recordStdinWrite: () => Effect.die("Unexpected recordStdinWrite call."),
    hasCommandOutputEvent: () => Effect.die("Unexpected hasCommandOutputEvent call."),
  } satisfies RuntimeCommandStatePortService;
  const sessionWaitState = {
    setApprovalWait: () => Effect.die("Unexpected setApprovalWait call."),
    setUserWait: (waitInput) =>
      Effect.sync(() => {
        input.waits.push({ kind: "set", input: waitInput });
        return stateMutation(undefined);
      }),
    clearSessionWait: (waitInput) =>
      Effect.sync(() => {
        input.waits.push({ kind: "clear", input: waitInput });
        return stateMutation(undefined);
      }),
  } satisfies RuntimeSessionWaitStatePortService;

  return {
    commandState,
    requestState,
    sessionWaitState,
  };
}

function makeOpenRequest(): RuntimeRequestInputDetailsRecord {
  return {
    requestId,
    sessionId,
    surfacePiSessionId,
    threadId: null,
    turnId: "turn_runtime_blocking_rui" as TurnId,
    commandId,
    toolItemId: "tool_runtime_blocking_rui" as ToolItemId,
    variant: "blocking",
    status: "open",
    questionCount: 1,
    createdAt: "2026-06-21T00:00:01.000Z",
    completedAt: null,
    timeout: {
      enabled: true,
      durationMs: SHORT_TIMEOUT_MS,
      startedAt: "2026-06-21T00:00:01.000Z",
      pausedAt: null,
      remainingMsWhenPaused: null,
      expiresAt: "1970-01-01T00:00:01.500Z",
    },
    questions: [
      {
        questionId,
        requestId,
        ordinal: 0,
        title: "CI scope",
        question: "What should run before handoff?",
        defaultAnswer: { kind: "custom", text: "Use unit checks." },
        choices: [],
        status: "open",
      },
    ],
    answers: [],
  };
}
