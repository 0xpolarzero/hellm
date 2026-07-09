import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeEventStreamError,
  RuntimeQueueStatePort,
  StateContractError,
  type MarkRuntimeSurfaceMessageQueuedInput,
  type QueueItemId,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type StateInvalidationDescriptor,
  type SteerQueuedMessageInput,
  type SurfacePiSessionId,
  type ThreadId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  RuntimeQueueSteeringPostCommitLane,
  steerRuntimeQueuedMessage,
} from "./runtime-queue-steering";

const handlerTarget = {
  workspaceSessionId: "wsess_runtime_steer_01" as WorkspaceSessionId,
  surface: "handler",
  surfacePiSessionId: "pi_runtime_steer_handler_01" as SurfacePiSessionId,
  threadId: "thread_runtime_steer_01" as ThreadId,
} satisfies SteerQueuedMessageInput["target"];

const orchestratorTarget = {
  workspaceSessionId: "wsess_runtime_steer_01" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_runtime_steer_orchestrator_01" as SurfacePiSessionId,
} satisfies SteerQueuedMessageInput["target"];

const queueInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_runtime_steer_01" as WorkspaceId,
  invalidation: { model: "surface", ids: [handlerTarget.surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

function queuedRecord(
  overrides: Partial<RuntimeSurfaceMessageRecord> = {},
): RuntimeSurfaceMessageRecord {
  return {
    id: "queue_runtime_steer_01" as QueueItemId,
    sessionId: handlerTarget.workspaceSessionId,
    surfacePiSessionId: handlerTarget.surfacePiSessionId,
    threadId: handlerTarget.threadId,
    workflowTaskAttemptId: null,
    kind: "user_message",
    idempotencyKey: "surface_queue:queue_runtime_steer_01",
    messageJson: JSON.stringify({ text: "Steer this queued message." }),
    payloadJson: null,
    status: "queued",
    priority: "runtime",
    orderingKey: `surface:${handlerTarget.surfacePiSessionId}`,
    sequence: 1,
    position: 2,
    sourceCommandId: null,
    claimOwnerId: null,
    claimLeaseExpiresAt: null,
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    lastErrorJson: null,
    createdAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:01:00.000Z",
    deliveredAt: null,
    failedAt: null,
    failureError: null,
    cancelledAt: null,
    ...overrides,
  };
}

function mutation<T>(value: T, afterCommit: readonly StateInvalidationDescriptor[] = []) {
  return { value, afterCommit };
}

function createHarness(
  options: {
    readonly existing?: RuntimeSurfaceMessageRecord;
    readonly markFails?: boolean;
    readonly publishFails?: boolean;
    readonly postCommitFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const markCalls: MarkRuntimeSurfaceMessageQueuedInput[] = [];
  const existing = options.existing ?? queuedRecord();
  const steered = queuedRecord({ ...existing, status: "queued", position: 1 });
  const queueStatePort = {
    acceptSubmittedSurfaceMessage: () =>
      Effect.die("Unexpected acceptSubmittedSurfaceMessage call."),
    enqueueSurfaceMessage: () => Effect.die("Unexpected enqueueSurfaceMessage call."),
    getSurfaceQueuedMessage: (input) =>
      Effect.sync(() => {
        calls.push(`lookup:${input.id}`);
        return existing;
      }),
    claimNextQueuedSurfaceMessage: () =>
      Effect.die("Unexpected claimNextQueuedSurfaceMessage call."),
    releaseExpiredSurfaceMessageClaims: () =>
      Effect.die("Unexpected releaseExpiredSurfaceMessageClaims call."),
    markSurfaceMessageSteering: () => Effect.die("Unexpected markSurfaceMessageSteering call."),
    markSurfaceMessageQueued: (input) =>
      Effect.gen(function* () {
        calls.push(`mark:${input.id}:${input.position ?? "default"}`);
        markCalls.push(input);
        if (input.expectedStatuses && !input.expectedStatuses.includes(existing.status)) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "state.queue.markQueued",
              reason: "claim-conflict",
              message: "Queued row is already dispatching.",
            }),
          );
        }
        if (options.markFails) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "state.queue.markQueued",
              reason: "transaction-failed",
              message: "Queue steering transaction failed.",
            }),
          );
        }
        return mutation(steered, [queueInvalidation]);
      }),
    markSurfaceMessageDelivered: () => Effect.die("Unexpected markSurfaceMessageDelivered call."),
    markSurfaceMessageFailed: () => Effect.die("Unexpected markSurfaceMessageFailed call."),
    cancelSurfaceMessage: () => Effect.die("Unexpected cancelSurfaceMessage call."),
  } satisfies RuntimeQueueStatePortService;

  const run = (input: SteerQueuedMessageInput) =>
    steerRuntimeQueuedMessage({ input }).pipe(
      Effect.provideService(RuntimeQueueStatePort, queueStatePort),
      Effect.provideService(RuntimeEventBus, eventBus(calls, options)),
      Effect.provideService(RuntimeQueueSteeringPostCommitLane, postCommitLane(calls, options)),
    );

  return { calls, markCalls, run };
}

function eventBus(
  calls: string[],
  options: { readonly publishFails?: boolean } = {},
): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected live event publication."),
    publishStateInvalidations: (input) =>
      Effect.gen(function* () {
        calls.push(`publish:${input.afterCommit.length}`);
        if (options.publishFails) {
          return yield* Effect.fail(
            new RuntimeEventStreamError({
              operation: "runtime.events.publishStateInvalidations",
              reason: "stream-failed",
              message: "Event bus unavailable.",
            }),
          );
        }
        return [];
      }),
    subscribe: () => Effect.die("Unexpected runtime event subscription."),
  });
}

function postCommitLane(
  calls: string[],
  options: { readonly postCommitFails?: boolean } = {},
): RuntimeQueueSteeringPostCommitLane["Service"] {
  return RuntimeQueueSteeringPostCommitLane.of({
    afterQueueSteerCommitted: (input) =>
      Effect.gen(function* () {
        calls.push(`postCommit:${input.input.queuedMessageId}:${input.queued.position}`);
        if (options.postCommitFails) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.queues.steer",
              reason: "stale-state",
              message: "Queue steering post-commit lane failed.",
            }),
          );
        }
      }),
  });
}

describe("runtime queue steering", () => {
  it.effect(
    "marks the queued message at the front, publishes invalidations, and runs the post-commit lane",
    () =>
      Effect.gen(function* () {
        const harness = createHarness();

        const result = yield* harness.run({
          target: handlerTarget,
          queuedMessageId: "queue_runtime_steer_01" as QueueItemId,
        });
        assert.strictEqual(result, undefined);

        assert.deepStrictEqual(harness.markCalls, [
          {
            id: "queue_runtime_steer_01" as QueueItemId,
            position: "front",
            expectedStatuses: ["queued", "steering"],
          },
        ]);
        assert.deepStrictEqual(harness.calls, [
          "lookup:queue_runtime_steer_01",
          "mark:queue_runtime_steer_01:front",
          "publish:1",
          "postCommit:queue_runtime_steer_01:1",
        ]);
      }),
  );

  it.effect("allows orchestrator queue targets with distinct workspace and pi surface ids", () =>
    Effect.gen(function* () {
      const harness = createHarness({
        existing: queuedRecord({
          surfacePiSessionId: orchestratorTarget.surfacePiSessionId,
          threadId: null,
        }),
      });

      const result = yield* harness.run({
        target: orchestratorTarget,
        queuedMessageId: "queue_runtime_steer_01" as QueueItemId,
      });
      assert.strictEqual(result, undefined);

      assert.deepStrictEqual(harness.calls, [
        "lookup:queue_runtime_steer_01",
        "mark:queue_runtime_steer_01:front",
        "publish:1",
        "postCommit:queue_runtime_steer_01:1",
      ]);
    }),
  );

  it.effect("rejects dispatching messages without clearing the active claim", () =>
    Effect.gen(function* () {
      const harness = createHarness({
        existing: queuedRecord({
          status: "dispatching",
          claimOwnerId: "surface-queue-dispatcher:workspace_runtime_steer_01",
          claimLeaseExpiresAt: "2026-04-18T09:02:00.000Z",
          leaseVersion: 2,
        }),
      });

      const error = yield* harness
        .run({
          target: handlerTarget,
          queuedMessageId: "queue_runtime_steer_01" as QueueItemId,
        })
        .pipe(Effect.flip);

      assert.deepStrictEqual(
        { _tag: error._tag, operation: error.operation, reason: error.reason },
        {
          _tag: "RuntimeContractError",
          operation: "runtime.queues.steer.mark",
          reason: "state-conflict",
        },
      );
      assert.deepStrictEqual(harness.calls, [
        "lookup:queue_runtime_steer_01",
        "mark:queue_runtime_steer_01:front",
      ]);
    }),
  );

  it.effect("rejects queued messages that do not belong to the target before marking", () =>
    Effect.gen(function* () {
      const harness = createHarness({
        existing: queuedRecord({
          surfacePiSessionId: "pi_runtime_steer_other" as SurfacePiSessionId,
        }),
      });

      const error = yield* harness
        .run({
          target: handlerTarget,
          queuedMessageId: "queue_runtime_steer_01" as QueueItemId,
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        { _tag: error._tag, operation: error.operation, reason: error.reason },
        {
          _tag: "RuntimeContractError",
          operation: "runtime.queues.steer",
          reason: "target-not-found",
        },
      );
      assert.deepStrictEqual(harness.calls, ["lookup:queue_runtime_steer_01"]);
      assert.deepStrictEqual(harness.markCalls, []);
    }),
  );

  it.effect("maps state, event, and post-commit failures to runtime contract errors", () =>
    Effect.gen(function* () {
      const markError = yield* createHarness({ markFails: true })
        .run({
          target: handlerTarget,
          queuedMessageId: "queue_runtime_steer_01" as QueueItemId,
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        { _tag: markError._tag, operation: markError.operation, reason: markError.reason },
        {
          _tag: "RuntimeContractError",
          operation: "runtime.queues.steer.mark",
          reason: "stale-state",
        },
      );

      const publishError = yield* createHarness({ publishFails: true })
        .run({
          target: handlerTarget,
          queuedMessageId: "queue_runtime_steer_01" as QueueItemId,
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        { _tag: publishError._tag, operation: publishError.operation, reason: publishError.reason },
        {
          _tag: "RuntimeContractError",
          operation: "runtime.queues.steer",
          reason: "stale-state",
        },
      );

      const postCommitError = yield* createHarness({ postCommitFails: true })
        .run({
          target: handlerTarget,
          queuedMessageId: "queue_runtime_steer_01" as QueueItemId,
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        {
          _tag: postCommitError._tag,
          operation: postCommitError.operation,
          reason: postCommitError.reason,
        },
        {
          _tag: "RuntimeContractError",
          operation: "runtime.queues.steer",
          reason: "stale-state",
        },
      );
    }),
  );
});
