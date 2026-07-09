import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import {
  type CommandId,
  type PositiveDurationMs,
  type RequestInputAnswerId,
  type RequestInputQuestionId,
  RuntimeCommandStatePort,
  type RuntimeCommandStatePortService,
  type RuntimeCommandRecord,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestStatePortService,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  type RuntimeSessionWaitStatePortService,
  type RequestInputRequestId,
  type SurfacePiSessionId,
  type ThreadId,
  type ToolItemId,
  type TurnId,
  type WorkspaceSessionId,
  type QueueItemId,
  type PromptTarget,
} from "@svvy/core";
import {
  layerRuntimeRequestInputWaitService,
  RuntimeRequestInputWaitService,
} from "./runtime-request-input-wait-service";
import { RuntimeQueueWakeService } from "./runtime-queue-wake-service";

const requestId = "rui_wait_service_01" as RequestInputRequestId;
const surfacePiSessionId = "pi_wait_service_01" as SurfacePiSessionId;
const workspaceSessionId = "workspace_session_wait_service_01" as WorkspaceSessionId;
const threadId = "thread_wait_service_01" as ThreadId;
const queuedItemId = "queue_wait_service_01" as QueueItemId;
const commandId = "cmd_wait_service_01" as CommandId;
const questionId = "ruiq_wait_service_01" as RequestInputQuestionId;
const SHORT_TIMEOUT_MS = 500 as PositiveDurationMs;

function stateMutation<T>(value: T) {
  return { value, afterCommit: [] };
}

function target(input: { readonly threadId: ThreadId | null } = { threadId: null }): PromptTarget {
  if (input.threadId) {
    return {
      workspaceSessionId,
      surface: "handler",
      surfacePiSessionId,
      threadId: input.threadId,
    };
  }
  return {
    workspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId,
  };
}

function requestState(): RuntimeRequestStatePortService {
  return {
    createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
    getRequestInput: () => Effect.die("Unexpected getRequestInput call."),
    listOpenBlockingRequestInputs: () =>
      Effect.die("Unexpected listOpenBlockingRequestInputs call."),
    answerRequestInput: () => Effect.die("Unexpected answerRequestInput call."),
    setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
    defaultOpenRequestInputQuestions: () =>
      Effect.die("Unexpected defaultOpenRequestInputQuestions call."),
    cancelRequestInput: () => Effect.die("Unexpected cancelRequestInput call."),
  };
}

function waitRequestState(input: {
  readonly request: RuntimeRequestInputDetailsRecord;
}): RuntimeRequestStatePortService {
  let currentRequest = input.request;
  return {
    createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
    getRequestInput: () => Effect.succeed(currentRequest),
    listOpenBlockingRequestInputs: () =>
      Effect.die("Unexpected listOpenBlockingRequestInputs call."),
    answerRequestInput: () => Effect.die("Unexpected answerRequestInput call."),
    setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
    defaultOpenRequestInputQuestions: () =>
      Effect.sync(() => {
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
              answerId: "ruia_wait_service_01" as RequestInputAnswerId,
              requestId,
              questionId,
              answer: { kind: "custom", text: "Run focused Effect tests." },
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
  };
}

function waitCommandState(calls: unknown[]): RuntimeCommandStatePortService {
  return {
    finishCommand: (input) =>
      Effect.sync(() => {
        calls.push(input);
        return stateMutation({
          ...command(),
          status: input.status,
          summary: input.summary ?? "CI scope",
          facts: input.facts ?? null,
          error: input.error ?? null,
          finishedAt: input.status === "waiting" ? null : "2026-06-21T00:00:01.500Z",
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
  };
}

function waitSessionState(calls: unknown[]): RuntimeSessionWaitStatePortService {
  return {
    setApprovalWait: () => Effect.die("Unexpected setApprovalWait call."),
    setUserWait: (input) =>
      Effect.sync(() => {
        calls.push({ kind: "set", input });
        return stateMutation(undefined);
      }),
    clearSessionWait: (input) =>
      Effect.sync(() => {
        calls.push({ kind: "clear", input });
        return stateMutation(undefined);
      }),
  };
}

function testLayer(calls: string[]) {
  return layerRuntimeRequestInputWaitService.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RuntimeRequestStatePort, requestState()),
        Layer.succeed(RuntimeCommandStatePort, {} as RuntimeCommandStatePortService),
        Layer.succeed(RuntimeSessionWaitStatePort, {} as RuntimeSessionWaitStatePortService),
        Layer.succeed(
          RuntimeQueueWakeService,
          RuntimeQueueWakeService.of({
            wakeSurface: (input) =>
              Effect.sync(() => {
                calls.push(
                  `wake:${input.reason}:${input.target.surface}:${input.target.surfacePiSessionId}`,
                );
              }),
          }),
        ),
      ),
    ),
  );
}

function blockingWaitLayer(input: {
  readonly request: RuntimeRequestInputDetailsRecord;
  readonly commandCalls: unknown[];
  readonly waitCalls: unknown[];
}) {
  return layerRuntimeRequestInputWaitService.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RuntimeRequestStatePort, waitRequestState({ request: input.request })),
        Layer.succeed(RuntimeCommandStatePort, waitCommandState(input.commandCalls)),
        Layer.succeed(RuntimeSessionWaitStatePort, waitSessionState(input.waitCalls)),
        Layer.succeed(
          RuntimeQueueWakeService,
          RuntimeQueueWakeService.of({
            wakeSurface: () => Effect.die("Unexpected wakeSurface call."),
          }),
        ),
      ),
    ),
  );
}

describe("RuntimeRequestInputWaitService", () => {
  it.effect("waits for blocking requests using runtime-owned state ports", () => {
    const commandCalls: unknown[] = [];
    const waitCalls: unknown[] = [];
    return Effect.gen(function* () {
      const request = openBlockingRequest();
      const commandRecord = command();

      const service = yield* RuntimeRequestInputWaitService;
      const resultFiber = yield* service
        .waitForBlockingRequest({
          request,
          command: commandRecord,
        })
        .pipe(Effect.forkScoped);
      yield* TestClock.adjust(1500);
      const result = yield* Fiber.join(resultFiber);

      assert.deepStrictEqual(result, {
        answers: [
          {
            title: "CI scope",
            question: "What should run before handoff?",
            answer: { kind: "custom", text: "Run focused Effect tests." },
            answeredBy: "timeout_default",
          },
        ],
      });
      assert.deepStrictEqual(commandEventSummaries(commandCalls), [
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
      assert.deepStrictEqual(waitKinds(waitCalls), ["set", "clear"]);
    }).pipe(
      Effect.provide(
        blockingWaitLayer({
          request: openBlockingRequest(),
          commandCalls,
          waitCalls,
        }),
      ),
    );
  });

  it.effect("wakes the owning orchestrator surface for nonblocking queued answers", () => {
    const calls: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeRequestInputWaitService;

      yield* service.afterAnswerCommitted({
        surfacePiSessionId,
        requestId,
        delivery: { kind: "nonblocking-queued", queuedItemId },
        target: target(),
      });

      assert.deepStrictEqual(calls, [
        `wake:request-input-answer-queued:orchestrator:${surfacePiSessionId}`,
      ]);
    }).pipe(Effect.provide(testLayer(calls)));
  });

  it.effect("wakes the owning handler surface for nonblocking queued answers", () => {
    const calls: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeRequestInputWaitService;

      yield* service.afterAnswerCommitted({
        surfacePiSessionId,
        requestId,
        delivery: { kind: "nonblocking-queued", queuedItemId },
        target: target({ threadId }),
      });

      assert.deepStrictEqual(calls, [
        `wake:request-input-answer-queued:handler:${surfacePiSessionId}`,
      ]);
    }).pipe(Effect.provide(testLayer(calls)));
  });

  it.effect("does not read state or wake queues for nonblocking recorded answers", () => {
    const calls: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeRequestInputWaitService;

      yield* service.afterAnswerCommitted({
        surfacePiSessionId,
        requestId,
        delivery: { kind: "nonblocking-recorded", queuedItemId: null },
        target: target(),
      });

      assert.deepStrictEqual(calls, []);
    }).pipe(Effect.provide(testLayer(calls)));
  });

  it.effect("does not read state or wake queues for partial blocking answers", () => {
    const calls: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeRequestInputWaitService;

      yield* service.afterAnswerCommitted({
        surfacePiSessionId,
        requestId,
        delivery: { kind: "blocking-open", queuedItemId: null },
        target: target(),
      });

      assert.deepStrictEqual(calls, []);
    }).pipe(Effect.provide(testLayer(calls)));
  });
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

function command(): RuntimeCommandRecord {
  return {
    id: commandId,
    sessionId: workspaceSessionId,
    turnId: "turn_wait_service_01",
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

function openBlockingRequest(): RuntimeRequestInputDetailsRecord {
  return {
    requestId,
    sessionId: workspaceSessionId,
    surfacePiSessionId,
    threadId: null,
    turnId: "turn_wait_service_01" as TurnId,
    commandId,
    toolItemId: "tool_wait_service_01" as ToolItemId,
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
        defaultAnswer: { kind: "custom", text: "Run focused Effect tests." },
        choices: [],
        status: "open",
      },
    ],
    answers: [],
  };
}
