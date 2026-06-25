import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeRequestStatePort,
  StateContractError,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type CreateRuntimeRequestInputInput,
  type RuntimeRequestInputDetailsRecord,
  type QueueItemId,
  type RequestInputAnswerId,
  type RequestInputOptionId,
  type RequestInputQuestionId,
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
  surfaceInvalidation,
} from "./state-mutation-result";

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
    timeout: request.timeout ? { ...request.timeout } : null,
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

function requestInputInvalidations(
  workspaceId: string,
  request: RuntimeRequestInputDetailsRecord | RuntimeRequestInputRecord,
): readonly StateInvalidationDescriptor[] {
  return dedupeInvalidations([
    requestInputInvalidation(workspaceId, request.requestId),
    surfaceInvalidation(workspaceId, request.surfacePiSessionId),
    commandInspectorInvalidation(workspaceId, request.commandId),
  ]);
}

export function runtimeRequestStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeRequestStatePortService {
  return {
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
            mutationResult(record, requestInputInvalidations(state.workspaceId, record)),
          ),
        ),
    getRequestInput: (input) =>
      state
        .getRequestUserInputRequest(input.requestId)
        .pipe(Effect.map(mapRuntimeRequestInputDetailsRecord)),
    listOpenBlockingRequestInputs: (input) =>
      state
        .listSessionStates()
        .pipe(
          Effect.map((sessions) =>
            sessions.flatMap((session) =>
              session.requestUserInputRequests
                .filter(
                  (request) =>
                    request.variant === "blocking" &&
                    request.status === "open" &&
                    (input?.workspaceSessionId == null ||
                      request.sessionId === input.workspaceSessionId) &&
                    (input?.surfacePiSessionId == null ||
                      request.surfacePiSessionId === input.surfacePiSessionId),
                )
                .map(mapRuntimeRequestInputDetailsRecord),
            ),
          ),
        ),
    answerRequestInput: (input: AnswerRequestInputInput) =>
      Effect.gen(function* () {
        const request = yield* state.getRequestUserInputRequest(input.requestId);
        const answered = yield* state.answerRequestUserInput({
          sessionId: request.sessionId,
          surfacePiSessionId: input.surfacePiSessionId,
          requestId: input.requestId,
          questionId: input.questionId,
          answer: input.answer,
          delivery: input.delivery,
        });
        const queuedItemId = (answered.queuedMessage?.id as QueueItemId | undefined) ?? null;
        const result: AnswerRequestInputResult = {
          requestId: input.requestId,
          questionId: input.questionId,
          status: "recorded",
          delivery:
            answered.request.variant === "blocking"
              ? { kind: "blocking-resolved", queuedItemId: null }
              : queuedItemId
                ? { kind: "nonblocking-queued", queuedItemId }
                : { kind: "nonblocking-recorded", queuedItemId: null },
        };
        return mutationResult(
          result,
          requestInputInvalidations(
            state.workspaceId,
            mapRuntimeRequestInputDetailsRecord(answered.request),
          ),
        );
      }),
    defaultOpenRequestInputQuestions: (input) =>
      state.defaultOpenRequestUserInputQuestions(input).pipe(
        Effect.map(mapRuntimeRequestInputDetailsRecord),
        Effect.map((record) =>
          mutationResult(record, requestInputInvalidations(state.workspaceId, record)),
        ),
      ),
    cancelRequestInput: (input) =>
      state.cancelRequestUserInputRequest(input).pipe(
        Effect.map(mapRuntimeRequestInputDetailsRecord),
        Effect.map((record) =>
          mutationResult(record, requestInputInvalidations(state.workspaceId, record)),
        ),
      ),
    setRequestInputTimerPaused: (input: SetRequestInputTimerPausedInput) =>
      Effect.gen(function* () {
        const request = yield* state.getRequestUserInputRequest(input.requestId);
        if (request.surfacePiSessionId !== input.surfacePiSessionId) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "runtime-request-state.setRequestInputTimerPaused",
              reason: "conflict",
              message: "Request user input timer does not belong to the target surface.",
            }),
          );
        }
        yield* state.setRequestUserInputTimerPaused({
          requestId: input.requestId,
          paused: input.paused,
        });
        return mutationResult(
          { requestId: input.requestId },
          requestInputInvalidations(
            state.workspaceId,
            mapRuntimeRequestInputDetailsRecord(request),
          ),
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
