import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeSessionWaitStatePort,
  type AnswerRuntimeApprovalInput,
  type AnswerRuntimeApprovalResult,
  type CommandId,
  type RuntimeApprovalRecord,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

export type RuntimeApprovalAnsweredInput = {
  readonly input: AnswerRuntimeApprovalInput;
  readonly request: RuntimeApprovalRecord;
  readonly commandId: CommandId;
};

export interface RuntimeApprovalAnswerPostCommitHostService {
  afterApprovalAnswered(
    input: RuntimeApprovalAnsweredInput,
  ): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeApprovalAnswerPostCommitHost extends Context.Service<
  RuntimeApprovalAnswerPostCommitHost,
  RuntimeApprovalAnswerPostCommitHostService
>()("@svvy/runtime/RuntimeApprovalAnswerPostCommitHost") {}

function mapApprovalStateFailure(operation: string, cause: unknown): RuntimeContractError {
  const stateCause = cause as {
    readonly reason?: string;
    readonly message?: string;
    readonly issues?: RuntimeContractError["issues"];
  };
  return new RuntimeContractError({
    operation,
    reason:
      stateCause.reason === "not-found"
        ? "target-not-found"
        : stateCause.reason === "invalid-input"
          ? "invalid-input"
          : "stale-state",
    message: stateCause.message ?? "Runtime approval state operation failed.",
    ...(stateCause.issues ? { issues: stateCause.issues } : {}),
    cause,
  });
}

function approvalRequestSummary(request: RuntimeApprovalRecord): string {
  if (request.toolName === "exec_command" && request.command) {
    return `Run command: ${request.command}`;
  }
  if (request.toolName === "apply_patch") {
    return "Apply patch";
  }
  return "Run TypeScript";
}

function publishAfterCommit(
  operation: string,
  afterCommit: readonly StateInvalidationDescriptor[],
): Effect.Effect<void, RuntimeContractError, RuntimeEventBus> {
  return Effect.gen(function* () {
    const eventBus = yield* RuntimeEventBus;
    yield* eventBus.publishStateInvalidations({ afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation,
            reason: "stale-state",
            message: "Runtime event bus did not accept approval answer notifications.",
            cause,
          }),
      ),
    );
  });
}

function assertApprovalHasCommand(
  request: RuntimeApprovalRecord,
): Effect.Effect<CommandId, RuntimeContractError> {
  if (request.commandId) {
    return Effect.succeed(request.commandId);
  }
  return Effect.fail(
    new RuntimeContractError({
      operation: "runtime.approvals.answer",
      reason: "stale-state",
      message: `Runtime approval request ${request.requestId} is not bound to a command.`,
    }),
  );
}

export const answerRuntimeApproval = Effect.fn("@svvy/runtime/approvals.answer")(function* (
  input: AnswerRuntimeApprovalInput,
) {
  const approvalState = yield* RuntimeApprovalStatePort;
  const commandState = yield* RuntimeCommandStatePort;
  const sessionWaitState = yield* RuntimeSessionWaitStatePort;
  const postCommitHost = yield* RuntimeApprovalAnswerPostCommitHost;

  const pending = yield* approvalState
    .getApprovalRequest({ requestId: input.approvalId })
    .pipe(
      Effect.mapError((cause) => mapApprovalStateFailure("runtime.approvals.answer.lookup", cause)),
    );
  const commandId = yield* assertApprovalHasCommand(pending);

  const resolvedResult = yield* approvalState
    .resolveApprovalRequest({
      requestId: input.approvalId,
      status: input.decision,
      reviewer: "user",
      decisionReason: input.reason ?? null,
    })
    .pipe(
      Effect.mapError((cause) =>
        mapApprovalStateFailure("runtime.approvals.answer.resolve", cause),
      ),
    );
  const request = resolvedResult.value;
  yield* publishAfterCommit("runtime.approvals.answer", resolvedResult.afterCommit);

  if (input.decision === "approved") {
    const startResult = yield* commandState
      .startCommand({ commandId })
      .pipe(
        Effect.mapError((cause) =>
          mapApprovalStateFailure("runtime.approvals.answer.startCommand", cause),
        ),
      );
    yield* publishAfterCommit("runtime.approvals.answer", startResult.afterCommit);
  } else {
    const command = yield* commandState
      .findCommandById({ commandId })
      .pipe(
        Effect.mapError((cause) =>
          mapApprovalStateFailure("runtime.approvals.answer.findCommand", cause),
        ),
      );
    const finishResult = yield* commandState
      .finishCommand({
        commandId,
        status: "cancelled",
        summary: `Approval denied: ${approvalRequestSummary(request)}`,
        facts: {
          ...command?.facts,
          approval: "denied",
          approvalRequestId: request.requestId,
        },
      })
      .pipe(
        Effect.mapError((cause) =>
          mapApprovalStateFailure("runtime.approvals.answer.finishCommand", cause),
        ),
      );
    yield* publishAfterCommit("runtime.approvals.answer", finishResult.afterCommit);
  }

  const clearWaitResult = yield* sessionWaitState
    .clearSessionWait({ sessionId: request.sessionId })
    .pipe(
      Effect.mapError((cause) =>
        mapApprovalStateFailure("runtime.approvals.answer.clearWait", cause),
      ),
    );
  yield* publishAfterCommit("runtime.approvals.answer", clearWaitResult.afterCommit);

  yield* postCommitHost.afterApprovalAnswered({ input, request, commandId });

  return {
    approvalId: request.requestId,
    commandId,
    status: input.decision,
  } satisfies AnswerRuntimeApprovalResult;
});
