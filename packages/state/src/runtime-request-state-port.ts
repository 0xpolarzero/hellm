import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeRequestStatePort,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type PromptTarget,
  type CreateRuntimeRequestInputInput,
  type ExtensionId,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestInputTimeoutRecord,
  type QueueItemId,
  type RequestInputAnswerId,
  type RequestInputOptionId,
  type RequestInputQuestionId,
  type FiniteDurationMs,
  type PositiveDurationMs,
  type RuntimeRequestInputRecord,
  type RuntimeRequestStatePortService,
  type SetRequestInputTimerPausedInput,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredRequestUserInputRequestRecord,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import {
  commandInspectorInvalidation,
  dedupeInvalidations,
  mutationResult,
  requestInputInvalidation,
  sessionNavigationInvalidation,
  surfaceInvalidation,
} from "./state-mutation-result";

function assertSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be a safe integer`);
  }
}

function positiveDurationMs(value: number, field: string): PositiveDurationMs {
  assertSafeInteger(value, field);
  if (value <= 0) {
    throw new RangeError(`${field} must be positive`);
  }
  return value as PositiveDurationMs;
}

function finiteDurationMs(value: number, field: string): FiniteDurationMs {
  assertSafeInteger(value, field);
  if (value < 0) {
    throw new RangeError(`${field} must be non-negative`);
  }
  return value as FiniteDurationMs;
}

function mapRuntimeRequestInputTimeoutRecord(
  timeout: StructuredRequestUserInputRequestRecord["timeout"],
): RuntimeRequestInputTimeoutRecord | null {
  return timeout
    ? {
        ...timeout,
        timerVersion: (() => {
          assertSafeInteger(timeout.timerVersion, "request input timeout timerVersion");
          if (timeout.timerVersion <= 0) {
            throw new RangeError("request input timeout timerVersion must be positive");
          }
          return timeout.timerVersion as RuntimeRequestInputTimeoutRecord["timerVersion"];
        })(),
        durationMs: positiveDurationMs(timeout.durationMs, "request input timeout durationMs"),
        remainingMsWhenPaused:
          timeout.remainingMsWhenPaused === null
            ? null
            : finiteDurationMs(
                timeout.remainingMsWhenPaused,
                "request input timeout remainingMsWhenPaused",
              ),
      }
    : null;
}

function mapRuntimeRequestInputRecord(
  request: StructuredRequestUserInputRequestRecord,
): RuntimeRequestInputRecord {
  return {
    requestId: request.requestId as RuntimeRequestInputRecord["requestId"],
    sessionId: request.sessionId as RuntimeRequestInputRecord["sessionId"],
    surfacePiSessionId:
      request.surfacePiSessionId as RuntimeRequestInputRecord["surfacePiSessionId"],
    threadId: request.threadId as RuntimeRequestInputRecord["threadId"],
    turnId: request.turnId as RuntimeRequestInputRecord["turnId"],
    commandId: request.commandId as RuntimeRequestInputRecord["commandId"],
    variant: request.variant,
    status: request.status,
    questionCount: request.questions.length,
  };
}

function mapRuntimeRequestInputDetailsRecord(
  request: StructuredRequestUserInputRequestRecord,
): RuntimeRequestInputDetailsRecord {
  return {
    ...mapRuntimeRequestInputRecord(request),
    toolItemId: request.toolItemId as RuntimeRequestInputDetailsRecord["toolItemId"],
    createdAt: request.createdAt,
    completedAt: request.completedAt,
    timeout: mapRuntimeRequestInputTimeoutRecord(request.timeout),
    questions: request.questions.map((question) => ({
      questionId: question.questionId as RequestInputQuestionId,
      requestId: question.requestId as RuntimeRequestInputDetailsRecord["requestId"],
      ordinal: question.ordinal,
      title: question.title,
      question: question.question,
      defaultAnswer: structuredClone(question.defaultAnswer),
      choices: question.choices.map((choice) => ({
        ...choice,
        optionId: choice.optionId as RequestInputOptionId,
      })),
      status: question.status,
    })),
    answers: request.answers.map((answer) => ({
      answerId: answer.answerId as RequestInputAnswerId,
      requestId: answer.requestId as RuntimeRequestInputDetailsRecord["requestId"],
      questionId: answer.questionId as RequestInputQuestionId,
      answer: structuredClone(answer.answer),
      answeredBy: answer.answeredBy,
      delivery: answer.delivery,
      queuedItemId: (answer.queuedItemId as QueueItemId | null) ?? null,
      createdAt: answer.createdAt,
    })),
  };
}

function mapPromptTarget(request: StructuredRequestUserInputRequestRecord): PromptTarget {
  if (request.threadId) {
    return {
      workspaceSessionId: request.sessionId as PromptTarget["workspaceSessionId"],
      surface: "handler",
      surfacePiSessionId: request.surfacePiSessionId as PromptTarget["surfacePiSessionId"],
      threadId: request.threadId as Extract<PromptTarget, { surface: "handler" }>["threadId"],
    };
  }
  return {
    workspaceSessionId: request.sessionId as PromptTarget["workspaceSessionId"],
    surface: "orchestrator",
    surfacePiSessionId: request.surfacePiSessionId as PromptTarget["surfacePiSessionId"],
  };
}

function requestInputInvalidations(
  workspaceId: string,
  request: RuntimeRequestInputDetailsRecord | RuntimeRequestInputRecord,
  options: { readonly includeSessionNavigation?: boolean } = {},
): readonly StateInvalidationDescriptor[] {
  return dedupeInvalidations([
    requestInputInvalidation(workspaceId, request.requestId),
    surfaceInvalidation(workspaceId, request.surfacePiSessionId),
    commandInspectorInvalidation(workspaceId, request.commandId),
    ...(options.includeSessionNavigation ? [sessionNavigationInvalidation(workspaceId)] : []),
  ]);
}

export function runtimeRequestStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeRequestStatePortService {
  return {
    readRequestInputSettings: () => state.readRequestInputSettings(),
    setRequestInputVariant: (input) =>
      state.setRequestInputVariant(input).pipe(
        Effect.map((settings) =>
          mutationResult(settings, [
            { scope: "app", invalidation: { model: "settings" } },
            {
              scope: "app",
              invalidation: {
                model: "extensions",
                ids: ["request-user-input" as ExtensionId],
              },
            },
            { scope: "app", invalidation: { model: "agents" } },
          ]),
        ),
      ),
    setRequestInputBlockingTimeout: (input) =>
      state
        .setRequestInputBlockingTimeout(input)
        .pipe(
          Effect.map((settings) =>
            mutationResult(settings, [{ scope: "app", invalidation: { model: "settings" } }]),
          ),
        ),
    createRequestInput: (input: CreateRuntimeRequestInputInput) =>
      state
        .createRequestUserInputRequest({
          sessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.surface === "handler" ? input.target.threadId : null,
          turnId: input.turnId,
          commandId: input.sourceCommandId,
          toolItemId: input.toolItemId,
          variant: input.mode,
          timeout: input.timeout ?? null,
          questions: input.questions.map((question) => ({
            title: question.title,
            question: question.question,
            defaultAnswer: question.defaultAnswer,
            ...(question.choices ? { choices: [...question.choices] } : {}),
          })),
        })
        .pipe(
          Effect.map(mapRuntimeRequestInputRecord),
          Effect.map((record) =>
            mutationResult(
              record,
              requestInputInvalidations(state.workspaceId, record, {
                includeSessionNavigation: record.variant === "blocking",
              }),
            ),
          ),
        ),
    getRequestInput: (input) =>
      state
        .getRequestUserInputRequest(input.requestId)
        .pipe(Effect.map(mapRuntimeRequestInputDetailsRecord)),
    listOpenBlockingRequestInputs: (input) =>
      state.listSessionStates().pipe(
        Effect.map((sessions) =>
          sessions.flatMap((session) => {
            return session.requestUserInputRequests
              .filter((request) => {
                return !(
                  request.variant !== "blocking" ||
                  request.status !== "open" ||
                  (input?.workspaceSessionId != null &&
                    request.sessionId !== input.workspaceSessionId) ||
                  (input?.surfacePiSessionId != null &&
                    request.surfacePiSessionId !== input.surfacePiSessionId)
                );
              })
              .map(mapRuntimeRequestInputDetailsRecord);
          }),
        ),
      ),
    answerRequestInput: (input: AnswerRequestInputInput) =>
      Effect.gen(function* () {
        const answered = yield* state.answerRequestUserInput({
          surfacePiSessionId: input.surfacePiSessionId,
          requestId: input.requestId,
          questionId: input.questionId,
          answer: input.answer,
          delivery: input.delivery,
          ...(input.clientSubmission ? { clientSubmission: input.clientSubmission } : {}),
        });
        const queuedItemId = (answered.queuedMessage?.id as QueueItemId | undefined) ?? null;
        const result: AnswerRequestInputResult = {
          requestId: input.requestId,
          questionId: input.questionId,
          status: answered.duplicate ? "duplicate" : "recorded",
          delivery:
            answered.request.variant === "blocking"
              ? answered.request.status === "completed"
                ? { kind: "blocking-resolved", queuedItemId: null }
                : { kind: "blocking-open", queuedItemId: null }
              : queuedItemId
                ? { kind: "nonblocking-queued", queuedItemId }
                : { kind: "nonblocking-recorded", queuedItemId: null },
        };
        return mutationResult(
          {
            answer: result,
            target: mapPromptTarget(answered.request),
          },
          answered.duplicate
            ? []
            : requestInputInvalidations(
                state.workspaceId,
                mapRuntimeRequestInputDetailsRecord(answered.request),
                {
                  includeSessionNavigation:
                    answered.request.variant === "blocking" && answered.request.status !== "open",
                },
              ),
        );
      }),
    defaultOpenRequestInputQuestions: (input) =>
      state.defaultOpenRequestUserInputQuestions(input).pipe(
        Effect.map(({ record: structuredRecord, changed }) => {
          const record = mapRuntimeRequestInputDetailsRecord(structuredRecord);
          return mutationResult(
            record,
            changed
              ? requestInputInvalidations(state.workspaceId, record, {
                  includeSessionNavigation: record.variant === "blocking",
                })
              : [],
          );
        }),
      ),
    cancelRequestInput: (input) =>
      state.cancelRequestUserInputRequest(input).pipe(
        Effect.map(({ record: structuredRecord, changed }) => {
          const record = mapRuntimeRequestInputDetailsRecord(structuredRecord);
          return mutationResult(
            record,
            changed
              ? requestInputInvalidations(state.workspaceId, record, {
                  includeSessionNavigation: record.variant === "blocking",
                })
              : [],
          );
        }),
      ),
    setRequestInputTimerPaused: (input: SetRequestInputTimerPausedInput) =>
      Effect.gen(function* () {
        const { record: structuredRecord, changed } = yield* state.setRequestUserInputTimerPaused({
          surfacePiSessionId: input.surfacePiSessionId,
          requestId: input.requestId,
          paused: input.paused,
        });
        const request = mapRuntimeRequestInputDetailsRecord(structuredRecord);
        return mutationResult(
          request,
          changed ? requestInputInvalidations(state.workspaceId, request) : [],
        );
      }),
  };
}

export function runtimeRequestStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeRequestStatePortService {
  return runtimeRequestStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeRequestStatePort = Effect.fn("@svvy/state/makeRuntimeRequestStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeRequestStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeRequestStatePort = Layer.effect(
  RuntimeRequestStatePort,
  makeRuntimeRequestStatePort(),
);
