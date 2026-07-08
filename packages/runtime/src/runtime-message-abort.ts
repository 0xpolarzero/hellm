import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeQueueStatePort,
  type AbortPromptInput,
  type RuntimeSurfaceMessageRecord,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

export type RuntimeQueuedMessageAbortInput = Extract<AbortPromptInput, { readonly mode: "queued" }>;

export type RuntimeQueuedMessageAbortedInput = {
  readonly input: RuntimeQueuedMessageAbortInput;
  readonly queued: RuntimeSurfaceMessageRecord;
};

function mapQueueStateFailure(operation: string, cause: unknown): RuntimeContractError {
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
    message: stateCause.message ?? "Runtime queue state operation failed.",
    ...(stateCause.issues ? { issues: stateCause.issues } : {}),
    cause,
  });
}

function assertQueuedMessageTarget(
  input: RuntimeQueuedMessageAbortInput,
  queued: RuntimeSurfaceMessageRecord,
): Effect.Effect<void, RuntimeContractError> {
  const expectedThreadId = input.target.surface === "handler" ? input.target.threadId : null;
  if (
    queued.id !== input.queuedMessageId ||
    queued.sessionId !== input.target.workspaceSessionId ||
    queued.surfacePiSessionId !== input.target.surfacePiSessionId ||
    (queued.threadId ?? null) !== expectedThreadId
  ) {
    return Effect.fail(
      new RuntimeContractError({
        operation: "runtime.messages.abort",
        reason: "target-not-found",
        message: `Queued surface message ${input.queuedMessageId} does not belong to target.`,
      }),
    );
  }

  return Effect.void;
}

export const abortRuntimeQueuedMessage = Effect.fn("@svvy/runtime/messages.abortQueued")(
  function* ({ input }: { readonly input: RuntimeQueuedMessageAbortInput }) {
    const queue = yield* RuntimeQueueStatePort;
    const eventBus = yield* RuntimeEventBus;
    const existing = yield* queue
      .getSurfaceQueuedMessage({ id: input.queuedMessageId })
      .pipe(
        Effect.mapError((cause) => mapQueueStateFailure("runtime.messages.abort.lookup", cause)),
      );

    yield* assertQueuedMessageTarget(input, existing);

    const cancelledResult = yield* queue
      .cancelSurfaceMessage({ id: input.queuedMessageId })
      .pipe(
        Effect.mapError((cause) => mapQueueStateFailure("runtime.messages.abort.cancel", cause)),
      );
    yield* eventBus.publishStateInvalidations({ afterCommit: cancelledResult.afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: "runtime.messages.abort",
            reason: "stale-state",
            message: "Runtime event bus did not accept queued-message abort notifications.",
            cause,
          }),
      ),
    );
  },
);
