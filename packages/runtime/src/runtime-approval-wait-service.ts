import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeContractError,
  type RuntimeApprovalId,
  type RuntimeApprovalRecord,
} from "@svvy/core";

export type RuntimeApprovalDecision = { approved: true } | { approved: false; reason?: string };

type PendingRuntimeApproval = {
  readonly deferred: Deferred.Deferred<RuntimeApprovalDecision, RuntimeContractError>;
};

export interface RuntimeApprovalWaitServiceService {
  waitForApproval(input: {
    readonly request: RuntimeApprovalRecord;
    readonly recheck: Effect.Effect<RuntimeApprovalRecord, RuntimeContractError>;
  }): Effect.Effect<RuntimeApprovalDecision, RuntimeContractError>;
  afterApprovalCommitted(input: {
    readonly approved: boolean;
    readonly reason?: string | null;
    readonly request: RuntimeApprovalRecord;
  }): Effect.Effect<void, RuntimeContractError>;
  cancelApprovalWait(input: {
    readonly reason: string;
    readonly request: RuntimeApprovalRecord;
  }): Effect.Effect<void, RuntimeContractError>;
  cancelAllApprovalWaits(input: {
    readonly reason: string;
  }): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeApprovalWaitService extends Context.Service<
  RuntimeApprovalWaitService,
  RuntimeApprovalWaitServiceService
>()("@svvy/runtime/RuntimeApprovalWaitService") {}

export function createRuntimeApprovalWaitService(): RuntimeApprovalWaitServiceService {
  const pending = new Map<RuntimeApprovalId, PendingRuntimeApproval>();

  const removePending = (requestId: RuntimeApprovalId) =>
    Effect.sync(() => {
      pending.delete(requestId);
    });

  const takePending = (requestId: RuntimeApprovalId) =>
    Effect.sync(() => {
      const waiter = pending.get(requestId);
      pending.delete(requestId);
      return waiter;
    });

  const completePending = (
    request: RuntimeApprovalRecord,
    decision: RuntimeApprovalDecision,
  ): Effect.Effect<void, RuntimeContractError> =>
    takePending(request.requestId).pipe(
      Effect.flatMap((waiter) =>
        waiter ? Deferred.succeed(waiter.deferred, decision).pipe(Effect.asVoid) : Effect.void,
      ),
    );

  return RuntimeApprovalWaitService.of({
    waitForApproval: ({ request, recheck }) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<RuntimeApprovalDecision, RuntimeContractError>();
        const inserted = yield* Effect.sync(() => {
          if (pending.has(request.requestId)) {
            return false;
          }
          pending.set(request.requestId, { deferred });
          return true;
        });
        if (!inserted) {
          return yield* Effect.fail(
            waitServiceError("runtime.approvals.waitForApproval", {
              message: `Runtime approval request ${request.requestId} is already waiting.`,
              reason: "state-conflict",
            }),
          );
        }
        return yield* Effect.gen(function* () {
          const latest = yield* recheck;
          if (latest.status !== "pending") {
            yield* completePending(
              latest,
              latest.status === "approved"
                ? { approved: true }
                : {
                    approved: false,
                    reason:
                      latest.decisionReason ??
                      (latest.status === "cancelled"
                        ? "Runtime approval request was cancelled."
                        : "Runtime action was not approved."),
                  },
            );
          }
          return yield* Deferred.await(deferred);
        }).pipe(Effect.ensuring(removePending(request.requestId)));
      }),
    afterApprovalCommitted: ({ request, approved, reason }) =>
      completePending(
        request,
        approved
          ? { approved: true }
          : { approved: false, reason: reason ?? "Runtime action was not approved." },
      ).pipe(
        Effect.mapError((cause: unknown) =>
          waitServiceError("runtime.approvals.afterApprovalCommitted", cause),
        ),
      ),
    cancelApprovalWait: ({ request, reason }) =>
      takePending(request.requestId).pipe(
        Effect.flatMap((waiter) => {
          if (!waiter) {
            return Effect.void;
          }
          return Deferred.succeed(waiter.deferred, { approved: false, reason }).pipe(Effect.asVoid);
        }),
        Effect.mapError((cause: unknown) =>
          waitServiceError("runtime.approvals.cancelApprovalWait", cause),
        ),
      ),
    cancelAllApprovalWaits: ({ reason }) =>
      Effect.sync(() => {
        const waiters = [...pending.values()];
        pending.clear();
        return waiters;
      }).pipe(
        Effect.flatMap((waiters) =>
          Effect.forEach(
            waiters,
            (waiter) =>
              Deferred.fail(
                waiter.deferred,
                waitServiceError("runtime.approvals.cancelAllApprovalWaits", {
                  message: reason,
                  reason: "runtime-shutdown",
                }),
              ),
            { discard: true },
          ),
        ),
        Effect.mapError((cause: unknown) =>
          waitServiceError("runtime.approvals.cancelAllApprovalWaits", cause),
        ),
      ),
  });
}

export const makeRuntimeApprovalWaitService = Effect.fn(
  "@svvy/runtime/makeRuntimeApprovalWaitService",
)(() => Effect.sync(createRuntimeApprovalWaitService));

export const layerRuntimeApprovalWaitService = Layer.effect(
  RuntimeApprovalWaitService,
  Effect.gen(function* () {
    const service = yield* makeRuntimeApprovalWaitService();
    yield* Effect.addFinalizer(() =>
      service
        .cancelAllApprovalWaits({
          reason: "Runtime approval wait service scope closed.",
        })
        .pipe(Effect.ignore),
    );
    return service;
  }),
);

function waitServiceError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  if (isWaitServiceKnownFailure(cause)) {
    return new RuntimeContractError({
      operation,
      reason: cause.reason,
      message: cause.message,
    });
  }
  return new RuntimeContractError({
    operation,
    reason: "stale-state",
    message: cause instanceof Error ? cause.message : "Runtime approval wait service failed.",
    cause,
  });
}

function isWaitServiceKnownFailure(cause: unknown): cause is {
  readonly message: string;
  readonly reason: "runtime-shutdown" | "state-conflict";
} {
  if (!cause || typeof cause !== "object") {
    return false;
  }
  const record = cause as { readonly message?: unknown; readonly reason?: unknown };
  return (
    typeof record.message === "string" &&
    (record.reason === "runtime-shutdown" || record.reason === "state-conflict")
  );
}
