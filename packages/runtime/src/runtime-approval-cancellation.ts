import * as Effect from "effect/Effect";
import {
  RuntimeApprovalStatePort,
  RuntimeContractError,
  type RuntimeApprovalRecord,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";

function mapApprovalCancelFailure(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
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
    message: stateCause.message ?? "Runtime approval cancellation failed.",
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
            message: "Runtime event bus did not accept approval cancellation notifications.",
            cause,
          }),
      ),
    );
  });
}

const cancelApprovalRequest = Effect.fn("@svvy/runtime/approvals.cancelRequest")(function* (
  request: RuntimeApprovalRecord,
  reason: string,
) {
  const approvalState = yield* RuntimeApprovalStatePort;
  const approvalWaitService = yield* RuntimeApprovalWaitService;
  const resolved = yield* approvalState
    .resolveApprovalRequest({
      requestId: request.requestId,
      status: "cancelled",
      reviewer: "user",
      decisionReason: reason,
    })
    .pipe(
      Effect.mapError((cause) =>
        mapApprovalCancelFailure("runtime.approvals.cancel.resolve", cause),
      ),
    );
  yield* publishAfterCommit("runtime.approvals.cancel.resolve", resolved.afterCommit);
  const cancelled = resolved.value;
  yield* approvalWaitService
    .cancelApprovalWait({ request: cancelled, reason })
    .pipe(
      Effect.mapError((cause) =>
        mapApprovalCancelFailure("runtime.approvals.cancel.wakeWaiter", cause),
      ),
    );
});

export const cancelRuntimeApprovalRequestsForSurface = Effect.fn(
  "@svvy/runtime/approvals.cancelForSurface",
)(function* (input: { readonly surfacePiSessionId: SurfacePiSessionId; readonly reason: string }) {
  const approvalState = yield* RuntimeApprovalStatePort;
  const requests = yield* approvalState
    .listOpenApprovalRequests({ surfacePiSessionId: input.surfacePiSessionId })
    .pipe(
      Effect.mapError((cause) => mapApprovalCancelFailure("runtime.approvals.cancel.list", cause)),
    );
  yield* Effect.forEach(requests, (request) => cancelApprovalRequest(request, input.reason), {
    discard: true,
  });
});

export const cancelAllRuntimeApprovalRequests = Effect.fn("@svvy/runtime/approvals.cancelAll")(
  function* (input: { readonly reason: string }) {
    const approvalState = yield* RuntimeApprovalStatePort;
    const requests = yield* approvalState
      .listOpenApprovalRequests()
      .pipe(
        Effect.mapError((cause) =>
          mapApprovalCancelFailure("runtime.approvals.cancelAll.list", cause),
        ),
      );
    yield* Effect.forEach(requests, (request) => cancelApprovalRequest(request, input.reason), {
      discard: true,
    });
  },
);
