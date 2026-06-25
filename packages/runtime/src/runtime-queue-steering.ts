import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeQueueStatePort,
  type RuntimeSurfaceMessageRecord,
  type SteerQueuedMessageInput,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

export type RuntimeQueuedMessageSteeredInput = {
  readonly input: SteerQueuedMessageInput;
  readonly queued: RuntimeSurfaceMessageRecord;
};

export interface RuntimeQueueSteeringPostCommitLaneService {
  afterQueueSteerCommitted(
    input: RuntimeQueuedMessageSteeredInput,
  ): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeQueueSteeringPostCommitLane extends Context.Service<
  RuntimeQueueSteeringPostCommitLane,
  RuntimeQueueSteeringPostCommitLaneService
>()("@svvy/runtime/RuntimeQueueSteeringPostCommitLane") {}

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
  input: SteerQueuedMessageInput,
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
        operation: "runtime.queues.steer",
        reason: "target-not-found",
        message: `Queued surface message ${input.queuedMessageId} does not belong to target.`,
      }),
    );
  }

  return Effect.void;
}

export const steerRuntimeQueuedMessage = Effect.fn("@svvy/runtime/queues.steer")(function* ({
  input,
}: {
  readonly input: SteerQueuedMessageInput;
}) {
  const queue = yield* RuntimeQueueStatePort;
  const eventBus = yield* RuntimeEventBus;
  const postCommitLane = yield* RuntimeQueueSteeringPostCommitLane;
  const existing = yield* queue
    .getSurfaceQueuedMessage({ id: input.queuedMessageId })
    .pipe(Effect.mapError((cause) => mapQueueStateFailure("runtime.queues.steer.lookup", cause)));

  yield* assertQueuedMessageTarget(input, existing);

  const queuedResult = yield* queue
    .markSurfaceMessageQueued({ id: input.queuedMessageId, position: "front" })
    .pipe(Effect.mapError((cause) => mapQueueStateFailure("runtime.queues.steer.mark", cause)));
  const queued = queuedResult.value;

  yield* eventBus.publishStateInvalidations({ afterCommit: queuedResult.afterCommit }).pipe(
    Effect.mapError(
      (cause) =>
        new RuntimeContractError({
          operation: "runtime.queues.steer",
          reason: "stale-state",
          message: "Runtime event bus did not accept queue steering notifications.",
          cause,
        }),
    ),
  );

  yield* postCommitLane.afterQueueSteerCommitted({ input, queued });
});
