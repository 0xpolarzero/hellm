import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  RuntimeComposerDraftStatePort,
  RuntimeContractError,
  RuntimeQueueStatePort,
  type QueueItemId,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  reorderRuntimeQueuedMessage,
  restoreRuntimeQueuedMessageToComposer,
  updateRuntimeComposerDraft,
} from "./runtime-composer-queue-mutations";

const target = {
  workspaceSessionId: "wsess_composer_queue" as WorkspaceSessionId,
  surface: "orchestrator" as const,
  surfacePiSessionId: "surface_composer_queue" as SurfacePiSessionId,
};
const invalidation = {
  scope: "workspace",
  workspaceId: "workspace_composer_queue" as WorkspaceId,
  invalidation: { model: "surface", ids: [target.surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

function queued(
  id: string,
  overrides: Partial<RuntimeSurfaceMessageRecord> = {},
): RuntimeSurfaceMessageRecord {
  return {
    id: id as QueueItemId,
    sessionId: target.workspaceSessionId,
    surfacePiSessionId: target.surfacePiSessionId,
    threadId: null,
    workflowTaskAttemptId: null,
    kind: "user_message",
    idempotencyKey: id,
    messageJson: JSON.stringify({ text: `message ${id}`, attachments: [] }),
    payloadJson: null,
    status: "queued",
    priority: "runtime",
    orderingKey: `surface:${target.surfacePiSessionId}`,
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
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    deliveredAt: null,
    failedAt: null,
    failureError: null,
    cancelledAt: null,
    ...overrides,
  };
}

function eventBus(published: StateInvalidationDescriptor[][]): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("unused"),
    publishStateInvalidations: ({ afterCommit }) =>
      Effect.sync(() => {
        published.push([...afterCommit]);
        return [];
      }),
    subscribe: () => Effect.die("unused"),
  });
}

function queuePort(
  records: RuntimeSurfaceMessageRecord[],
  calls: string[],
): RuntimeQueueStatePortService {
  return {
    acceptSubmittedSurfaceMessage: () => Effect.die("unused"),
    acceptEditedCommittedSurfaceMessage: () => Effect.die("unused"),
    enqueueSurfaceMessage: () => Effect.die("unused"),
    getSurfaceQueuedMessage: ({ id }) =>
      Effect.sync(() => {
        calls.push(`lookup:${id}`);
        return records.find((record) => record.id === id)!;
      }),
    claimNextQueuedSurfaceMessage: () => Effect.die("unused"),
    releaseExpiredSurfaceMessageClaims: () => Effect.die("unused"),
    markSurfaceMessageSteering: () => Effect.die("unused"),
    markSurfaceMessageQueued: () => Effect.die("unused"),
    markSurfaceMessageDelivered: () => Effect.die("unused"),
    markSurfaceMessageFailed: () => Effect.die("unused"),
    cancelSurfaceMessage: ({ id }) =>
      Effect.sync(() => {
        calls.push(`cancel:${id}`);
        return { value: records.find((record) => record.id === id)!, afterCommit: [invalidation] };
      }),
    reorderSurfaceMessage: ({ id, beforeId }) =>
      Effect.sync(() => {
        calls.push(`reorder:${id}:${beforeId ?? "end"}`);
        return { value: records, afterCommit: [invalidation] };
      }),
  };
}

describe("runtime composer and queue mutations", () => {
  it.effect("persists a composer draft and publishes its committed invalidations", () =>
    Effect.gen(function* () {
      const published: StateInvalidationDescriptor[][] = [];
      const observed: unknown[] = [];
      const result = yield* updateRuntimeComposerDraft({
        target,
        draft: { text: "draft", attachments: [] },
      }).pipe(
        Effect.provideService(RuntimeComposerDraftStatePort, {
          setDraft: (input) =>
            Effect.sync(() => {
              observed.push(input);
              return { value: undefined, afterCommit: [invalidation] };
            }),
          clearSubmittedDraft: () => Effect.die("unused"),
        }),
        Effect.provideService(RuntimeEventBus, eventBus(published)),
      );
      assert.deepStrictEqual(result, { target });
      assert.deepStrictEqual(observed, [
        { target, text: "draft", attachments: [], snippetMentions: [] },
      ]);
      assert.deepStrictEqual(published, [[invalidation]]);
    }),
  );

  it.effect("restores only a decodable queued user message owned by the explicit target", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const published: StateInvalidationDescriptor[][] = [];
      const record = queued("queue_restore");
      const result = yield* restoreRuntimeQueuedMessageToComposer({
        target,
        queuedMessageId: record.id as QueueItemId,
      }).pipe(
        Effect.provideService(RuntimeQueueStatePort, queuePort([record], calls)),
        Effect.provideService(RuntimeEventBus, eventBus(published)),
      );
      assert.deepStrictEqual(result, { target, text: "message queue_restore" });
      assert.deepStrictEqual(calls, ["lookup:queue_restore", "cancel:queue_restore"]);
      assert.deepStrictEqual(published, [[invalidation]]);

      const invalidRecords = [
        queued("wrong_target", { sessionId: "other" as WorkspaceSessionId }),
        queued("wrong_kind", { kind: "report_request" }),
        queued("invalid_payload", { messageJson: "not-json" }),
      ];
      for (const invalid of invalidRecords) {
        const exit = yield* Effect.exit(
          restoreRuntimeQueuedMessageToComposer({
            target,
            queuedMessageId: invalid.id as QueueItemId,
          }).pipe(
            Effect.provideService(RuntimeQueueStatePort, queuePort([invalid], [])),
            Effect.provideService(RuntimeEventBus, eventBus([])),
          ),
        );
        assert.strictEqual(exit._tag, "Failure");
      }
    }),
  );

  it.effect("validates both reorder rows against the target before publishing the commit", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const published: StateInvalidationDescriptor[][] = [];
      const first = queued("queue_first");
      const second = queued("queue_second", { position: 2 });
      const result = yield* reorderRuntimeQueuedMessage({
        target,
        queuedMessageId: second.id as QueueItemId,
        beforeQueuedMessageId: first.id as QueueItemId,
      }).pipe(
        Effect.provideService(RuntimeQueueStatePort, queuePort([first, second], calls)),
        Effect.provideService(RuntimeEventBus, eventBus(published)),
      );
      assert.deepStrictEqual(result, { target });
      assert.deepStrictEqual(calls, [
        "lookup:queue_second",
        "lookup:queue_first",
        "reorder:queue_second:queue_first",
      ]);
      assert.deepStrictEqual(published, [[invalidation]]);

      const foreignBefore = queued("foreign", {
        surfacePiSessionId: "foreign" as SurfacePiSessionId,
      });
      const exit = yield* Effect.exit(
        reorderRuntimeQueuedMessage({
          target,
          queuedMessageId: second.id as QueueItemId,
          beforeQueuedMessageId: foreignBefore.id as QueueItemId,
        }).pipe(
          Effect.provideService(RuntimeQueueStatePort, queuePort([second, foreignBefore], [])),
          Effect.provideService(RuntimeEventBus, eventBus([])),
        ),
      );
      assert.strictEqual(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        assert(exit.cause.toString().includes(RuntimeContractError.name));
      }
    }),
  );
});
