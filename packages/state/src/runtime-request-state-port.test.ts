import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeRequestStatePort,
  StateContractError,
  type PromptTarget,
  type CommandId,
  type RequestInputRequestId,
  type RequestInputOptionId,
  type RequestInputQuestionId,
  type RuntimeRequestStatePortService,
  type PositiveDurationMs,
  type SurfacePiSessionId,
  type ToolItemId,
  type TurnId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeRequestStatePort } from "./index";
import { runtimeRequestStatePortFromStore } from "./structured-session-adapters";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredRequestUserInputAnswerRecord,
  type StructuredRequestUserInputRequestRecord,
  type StructuredSessionStateStore,
  type StructuredSurfaceQueuedMessageRecord,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_request_state_port",
  cwd: "/tmp/svvy-runtime-request-state-port",
  label: "Runtime request state port",
};

const workspaceSessionId = "session-runtime-request-state-port" as WorkspaceSessionId;
const timeoutDurationMs = 300_000 as PositiveDurationMs;

describe("RuntimeRequestStatePort", () => {
  it("creates, reads, answers, and queues nonblocking request input through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const { port, turn, command } = yield* createPortHarness("nonblocking");
          const request = yield* port.createRequestInput({
            target: orchestratorTarget(),
            turnId: turn.id as TurnId,
            toolItemId: "tool-call-request-state-nonblocking" as ToolItemId,
            sourceCommandId: command.id as CommandId,
            mode: "nonblocking",
            timeout: null,
            questions: [
              {
                title: "CI scope",
                question: "Should CI run only unit checks or the full suite?",
                defaultAnswer: {
                  kind: "option",
                  label: "Unit checks only",
                  text: "Unit checks only",
                },
                choices: [
                  {
                    label: "Unit checks only",
                    description: "Faster local signal.",
                    recommended: true,
                  },
                  {
                    label: "Full suite",
                    description: "Includes e2e behavior.",
                    recommended: false,
                  },
                ],
              },
            ],
          });
          const requestRecord = request.value;
          const details = yield* port.getRequestInput({ requestId: requestRecord.requestId });
          const fullSuite = details.questions[0]!.choices.find(
            (choice) => choice.label === "Full suite",
          )!;
          const questionId = details.questions[0]!.questionId as RequestInputQuestionId;
          const answered = yield* port.answerRequestInput({
            surfacePiSessionId: "session-runtime-request-state-port" as SurfacePiSessionId,
            requestId: requestRecord.requestId,
            questionId,
            answer: { kind: "option", optionId: fullSuite.optionId as RequestInputOptionId },
            delivery: "enqueue-and-run",
          });
          const completed = yield* port.getRequestInput({ requestId: requestRecord.requestId });

          expect(requestRecord).toMatchObject({
            sessionId: workspaceSessionId,
            surfacePiSessionId: "session-runtime-request-state-port",
            threadId: null,
            turnId: turn.id,
            commandId: command.id,
            variant: "nonblocking",
            status: "open",
            questionCount: 1,
          });
          expect(request.afterCommit as unknown).toEqual([
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: { model: "requestInput", ids: [requestRecord.requestId] },
            },
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: {
                model: "surface",
                ids: ["session-runtime-request-state-port"],
              },
            },
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: { model: "commandInspector", ids: [command.id] },
            },
          ]);
          expect(details).toMatchObject({
            toolItemId: "tool-call-request-state-nonblocking",
            timeout: null,
            questions: [
              expect.objectContaining({
                title: "CI scope",
                status: "open",
                choices: [
                  expect.objectContaining({ label: "Unit checks only", recommended: true }),
                  expect.objectContaining({ label: "Full suite", recommended: false }),
                ],
              }),
            ],
            answers: [
              expect.objectContaining({
                answeredBy: "default",
                delivery: null,
                queuedItemId: null,
              }),
            ],
          });
          expect(answered.value.answer.requestId).toBe(requestRecord.requestId);
          expect(answered.value.answer.questionId).toBe(questionId);
          expect(answered.value.answer.status).toBe("recorded");
          expect(answered.value.answer.delivery.kind).toBe("nonblocking-queued");
          expect(answered.value.answer.delivery.queuedItemId).toMatch(/^queued-message-/);
          expect(answered.value.target).toEqual(orchestratorTarget());
          expect(answered.afterCommit as unknown).toEqual(request.afterCommit as unknown);
          expect(completed.status).toBe("completed");
          expect(completed.answers).toContainEqual(
            expect.objectContaining({
              answeredBy: "user",
              delivery: "enqueue-and-run",
              queuedItemId: answered.value.answer.delivery.queuedItemId,
              answer: { kind: "option", label: "Full suite", text: "Full suite" },
            }),
          );
        }).pipe(
          Effect.provide(
            layerRuntimeRequestStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("lists, defaults, pauses, and cancels blocking request input through the runtime port", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const { port, turn, command } = yield* createPortHarness("blocking");
          const request = yield* port.createRequestInput({
            target: orchestratorTarget(),
            turnId: turn.id as TurnId,
            toolItemId: "tool-call-request-state-blocking" as ToolItemId,
            sourceCommandId: command.id as CommandId,
            mode: "blocking",
            timeout: { enabled: true, durationMs: timeoutDurationMs },
            questions: [
              {
                title: "Release note tone",
                question: "What release-note tone should I use?",
                defaultAnswer: { kind: "custom", text: "Concise engineering summary." },
              },
            ],
          });
          const requestRecord = request.value;

          const open = yield* port.listOpenBlockingRequestInputs({
            workspaceSessionId,
            surfacePiSessionId: "session-runtime-request-state-port" as SurfacePiSessionId,
          });
          const paused = yield* port.setRequestInputTimerPaused({
            surfacePiSessionId: "session-runtime-request-state-port" as SurfacePiSessionId,
            requestId: requestRecord.requestId,
            paused: true,
          });
          const defaulted = yield* port.defaultOpenRequestInputQuestions({
            requestId: requestRecord.requestId,
            answeredBy: "timeout_default",
          });

          const cancelHarness = yield* createPortHarness("blocking-cancel");
          const cancellable = yield* port.createRequestInput({
            target: orchestratorTarget(),
            turnId: cancelHarness.turn.id as TurnId,
            toolItemId: "tool-call-request-state-cancel" as ToolItemId,
            sourceCommandId: cancelHarness.command.id as CommandId,
            mode: "blocking",
            timeout: { enabled: false, durationMs: timeoutDurationMs },
            questions: [
              {
                title: "Repair direction",
                question: "Should I repair locally or report back?",
                defaultAnswer: { kind: "custom", text: "Repair locally." },
              },
            ],
          });
          const cancellableRecord = cancellable.value;
          const cancelled = yield* port.cancelRequestInput({
            requestId: cancellableRecord.requestId,
          });

          expect(open.map((entry) => entry.requestId)).toEqual([requestRecord.requestId]);
          expect(paused.value).toMatchObject({
            requestId: requestRecord.requestId,
            timeout: expect.objectContaining({
              pausedAt: expect.any(String),
              expiresAt: null,
            }),
          });
          expect(paused.afterCommit as unknown).toEqual(request.afterCommit as unknown);
          expect(defaulted.value).toMatchObject({
            requestId: requestRecord.requestId,
            status: "expired",
            questions: [expect.objectContaining({ status: "defaulted" })],
            answers: [
              expect.objectContaining({ answeredBy: "default" }),
              expect.objectContaining({ answeredBy: "timeout_default" }),
            ],
          });
          expect(defaulted.afterCommit as unknown).toEqual(request.afterCommit as unknown);
          expect(cancelled.value).toMatchObject({
            requestId: cancellableRecord.requestId,
            status: "cancelled",
            questions: [expect.objectContaining({ status: "cancelled" })],
          });
          expect(cancelled.afterCommit as unknown).toEqual(cancellable.afterCommit as unknown);
        }).pipe(
          Effect.provide(
            layerRuntimeRequestStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("validates request timer ownership through the runtime request port", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const { port, turn, command } = yield* createPortHarness("wrong-surface");
          const request = yield* port.createRequestInput({
            target: orchestratorTarget(),
            turnId: turn.id as TurnId,
            toolItemId: "tool-call-request-state-wrong-surface" as ToolItemId,
            sourceCommandId: command.id as CommandId,
            mode: "blocking",
            timeout: { enabled: true, durationMs: timeoutDurationMs },
            questions: [
              {
                title: "Pause timer",
                question: "Can the timer be paused from another surface?",
                defaultAnswer: { kind: "custom", text: "No." },
              },
            ],
          });

          yield* expectStateFailure(
            port.setRequestInputTimerPaused({
              surfacePiSessionId: "wrong-surface" as SurfacePiSessionId,
              requestId: request.value.requestId,
              paused: true,
            }),
          );
        }).pipe(
          Effect.provide(
            layerRuntimeRequestStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("answers request input without adapter-level request pre-read", async () => {
    const request = createStructuredRequestUserInputRecord({
      variant: "nonblocking",
      status: "completed",
    });
    const answer: StructuredRequestUserInputAnswerRecord = {
      answerId: "request-answer-no-pre-read",
      requestId: request.requestId,
      questionId: request.questions[0]!.questionId,
      answer: { kind: "custom", text: "Run the full suite." },
      answeredBy: "user",
      delivery: "enqueue-and-run",
      queuedItemId: "queued-message-no-pre-read",
      createdAt: "2026-04-18T08:56:00.000Z",
    };
    const queuedMessage = createStructuredQueuedMessageRecord(request);
    const port = runtimeRequestStatePortFromStore({
      workspaceId: workspace.id,
      databasePath: ":memory:",
      close: () => undefined,
      getRequestUserInputRequest: () => {
        throw new Error("adapter pre-read should not happen");
      },
      answerRequestUserInput: (
        input: Parameters<StructuredSessionStateStore["answerRequestUserInput"]>[0],
      ) => {
        expect(input).toEqual({
          surfacePiSessionId: request.surfacePiSessionId,
          requestId: request.requestId,
          questionId: request.questions[0]!.questionId,
          answer: { kind: "custom", text: "Run the full suite." },
          delivery: "enqueue-and-run",
        });
        return { request, answer, queuedMessage };
      },
    } as unknown as StructuredSessionStateStore);

    const result = await runTestEffect(
      port.answerRequestInput({
        surfacePiSessionId: request.surfacePiSessionId as SurfacePiSessionId,
        requestId: request.requestId as RequestInputRequestId,
        questionId: request.questions[0]!.questionId as RequestInputQuestionId,
        answer: { kind: "custom", text: "Run the full suite." },
        delivery: "enqueue-and-run",
      }),
    );

    expect(result.value.answer as unknown).toEqual({
      requestId: request.requestId,
      questionId: request.questions[0]!.questionId,
      status: "recorded",
      delivery: { kind: "nonblocking-queued", queuedItemId: queuedMessage.id },
    });
    expect(result.value.target as unknown).toEqual({
      workspaceSessionId,
      surface: "orchestrator",
      surfacePiSessionId: request.surfacePiSessionId,
    });
    expect(result.afterCommit as unknown).toEqual([
      {
        scope: "workspace",
        workspaceId: workspace.id,
        invalidation: { model: "requestInput", ids: [request.requestId] },
      },
      {
        scope: "workspace",
        workspaceId: workspace.id,
        invalidation: { model: "surface", ids: [request.surfacePiSessionId] },
      },
      {
        scope: "workspace",
        workspaceId: workspace.id,
        invalidation: { model: "commandInspector", ids: [request.commandId] },
      },
    ]);
  });

  it("pauses request input timers without adapter-level request pre-read", async () => {
    const request = createStructuredRequestUserInputRecord({
      variant: "blocking",
      status: "open",
      timeout: {
        enabled: true,
        durationMs: 300_000,
        startedAt: "2026-04-18T08:55:00.000Z",
        pausedAt: "2026-04-18T08:56:00.000Z",
        remainingMsWhenPaused: 240_000,
        expiresAt: null,
      },
    });
    const port = runtimeRequestStatePortFromStore({
      workspaceId: workspace.id,
      databasePath: ":memory:",
      close: () => undefined,
      getRequestUserInputRequest: () => {
        throw new Error("adapter pre-read should not happen");
      },
      setRequestUserInputTimerPaused: (
        input: Parameters<StructuredSessionStateStore["setRequestUserInputTimerPaused"]>[0],
      ) => {
        expect(input).toEqual({
          surfacePiSessionId: request.surfacePiSessionId,
          requestId: request.requestId,
          paused: true,
        });
        return request;
      },
    } as unknown as StructuredSessionStateStore);

    const result = await runTestEffect(
      port.setRequestInputTimerPaused({
        surfacePiSessionId: request.surfacePiSessionId as SurfacePiSessionId,
        requestId: request.requestId as RequestInputRequestId,
        paused: true,
      }),
    );

    expect(result.value as unknown).toMatchObject({
      requestId: request.requestId,
      timeout: request.timeout,
    });
    expect(result.afterCommit as unknown).toEqual([
      {
        scope: "workspace",
        workspaceId: workspace.id,
        invalidation: { model: "requestInput", ids: [request.requestId] },
      },
      {
        scope: "workspace",
        workspaceId: workspace.id,
        invalidation: { model: "surface", ids: [request.surfacePiSessionId] },
      },
      {
        scope: "workspace",
        workspaceId: workspace.id,
        invalidation: { model: "commandInspector", ids: [request.commandId] },
      },
    ]);
  });

  it("maps store failures to typed state errors through the runtime request port", async () => {
    const port: RuntimeRequestStatePortService =
      runtimeRequestStatePortFromStore(createFailingStore());

    await expect(
      runTestEffect(port.getRequestInput({ requestId: "missing" as RequestInputRequestId })),
    ).rejects.toMatchObject({
      operation: "structured-session.getRequestUserInputRequest",
    });
    await expect(
      runTestEffect(port.getRequestInput({ requestId: "missing" as RequestInputRequestId })),
    ).rejects.toBeInstanceOf(StateContractError);
  });
});

function orchestratorTarget(): PromptTarget {
  return {
    workspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId: "session-runtime-request-state-port" as SurfacePiSessionId,
  };
}

function createPortHarness(label: string) {
  return Effect.gen(function* () {
    const state = yield* StructuredSessionState;
    yield* state.upsertPiSession({
      sessionId: workspaceSessionId,
      title: `Runtime request state port ${label}`,
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      messageCount: 0,
      status: "idle",
      createdAt: "2026-04-18T08:55:00.000Z",
      updatedAt: "2026-04-18T08:56:00.000Z",
    });
    const turn = yield* state.startTurn({
      sessionId: workspaceSessionId,
      surfacePiSessionId: "session-runtime-request-state-port",
      requestSummary: `Request input ${label}.`,
    });
    const command = yield* state.createCommand({
      turnId: turn.id,
      surfacePiSessionId: "session-runtime-request-state-port",
      toolName: "request_user_input",
      executor: "orchestrator",
      visibility: "surface",
      title: `Ask user ${label}`,
      summary: `Request input ${label}`,
    });
    yield* state.startCommand(command.id);
    const port = yield* RuntimeRequestStatePort;
    return { port, turn, command };
  });
}

function createStructuredRequestUserInputRecord(
  overrides: Partial<StructuredRequestUserInputRequestRecord> = {},
): StructuredRequestUserInputRequestRecord {
  return {
    ...createStructuredRequestUserInputRecordBase(),
    ...overrides,
  };
}

function createStructuredRequestUserInputRecordBase(): StructuredRequestUserInputRequestRecord {
  return {
    requestId: "request-input-no-pre-read",
    sessionId: workspaceSessionId,
    surfacePiSessionId: "session-runtime-request-state-port",
    threadId: null,
    turnId: "turn-no-pre-read",
    commandId: "command-no-pre-read",
    toolItemId: "tool-call-no-pre-read",
    variant: "nonblocking" as const,
    status: "open" as const,
    createdAt: "2026-04-18T08:55:00.000Z",
    completedAt: null,
    timeout: null,
    questions: [
      {
        questionId: "question-no-pre-read",
        requestId: "request-input-no-pre-read",
        ordinal: 0,
        title: "CI scope",
        question: "Should CI run only unit checks or the full suite?",
        defaultAnswer: { kind: "custom" as const, text: "Run unit checks." },
        choices: [],
        status: "open" as const,
      },
    ],
    answers: [
      {
        answerId: "default-answer-no-pre-read",
        requestId: "request-input-no-pre-read",
        questionId: "question-no-pre-read",
        answer: { kind: "custom" as const, text: "Run unit checks." },
        answeredBy: "default" as const,
        delivery: null,
        queuedItemId: null,
        createdAt: "2026-04-18T08:55:00.000Z",
      },
    ],
  };
}

function createStructuredQueuedMessageRecord(
  request: StructuredRequestUserInputRequestRecord,
): StructuredSurfaceQueuedMessageRecord {
  return {
    id: "queued-message-no-pre-read",
    sessionId: request.sessionId,
    surfacePiSessionId: request.surfacePiSessionId,
    threadId: request.threadId,
    workflowTaskAttemptId: null,
    kind: "request_user_input_answer",
    idempotencyKey: "request_user_input_answer:request-answer-no-pre-read",
    messageJson: "{}",
    payloadJson: null,
    status: "steering",
    priority: "interactive",
    orderingKey: `surface:${request.surfacePiSessionId}`,
    sequence: 1,
    position: 1,
    sourceCommandId: null,
    claimOwnerId: null,
    claimLeaseExpiresAt: null,
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    lastErrorJson: null,
    createdAt: "2026-04-18T08:56:00.000Z",
    updatedAt: "2026-04-18T08:56:00.000Z",
    deliveredAt: null,
    failedAt: null,
    failureError: null,
    cancelledAt: null,
  };
}

function expectStateFailure<A>(effect: Effect.Effect<A, StateContractError>) {
  return effect.pipe(
    Effect.flip,
    Effect.tap((error) =>
      Effect.sync(() => {
        expect(error).toBeInstanceOf(StateContractError);
        expect(error).toMatchObject({
          reason: "conflict",
          message: "Request user input timer does not belong to the target surface.",
        });
      }),
    ),
  );
}

function createFailingStore(): StructuredSessionStateStore {
  return {
    workspaceId: "workspace_failure",
    databasePath: ":memory:",
    close: () => undefined,
    getRequestUserInputRequest: () => {
      throw new Error("request persistence failed");
    },
  } as unknown as StructuredSessionStateStore;
}
