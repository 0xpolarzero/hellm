import * as Effect from "effect/Effect";
import {
  RuntimeApprovalStatePort,
  RuntimeContractError,
  type AnswerRuntimeApprovalInput,
  type AnswerRuntimeApprovalResult,
  type CommandId,
  type RuntimeApprovalRecord,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";

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
  const approvalWaitService = yield* RuntimeApprovalWaitService;

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

  yield* approvalWaitService.afterApprovalCommitted({
    request,
    approved: input.decision === "approved",
    reason: input.reason ?? null,
  });

  return {
    approvalId: request.requestId,
    commandId,
    status: input.decision,
  } satisfies AnswerRuntimeApprovalResult;
});
