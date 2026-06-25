import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeEventStreamError,
  RuntimeQueueStatePort,
  StateContractError,
  type AbortPromptInput,
  type QueueItemId,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type ThreadId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  abortRuntimeQueuedMessage,
  RuntimeQueuedMessageAbortPostCommitHost,
} from "./runtime-message-abort";
import { runTestEffect } from "./effect.test-support";

const handlerTarget = {
  workspaceSessionId: "wsess_runtime_abort_01" as WorkspaceSessionId,
  surface: "handler",
  surfacePiSessionId: "pi_runtime_abort_handler_01" as SurfacePiSessionId,
  threadId: "thread_runtime_abort_01" as ThreadId,
} satisfies AbortPromptInput["target"];

const orchestratorTarget = {
  workspaceSessionId: "wsess_runtime_abort_01" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_runtime_abort_orchestrator_01" as SurfacePiSessionId,
} satisfies AbortPromptInput["target"];

const abortInput = {
  target: handlerTarget,
  mode: "queued",
  queuedMessageId: "queue_runtime_abort_01" as QueueItemId,
  reason: "User removed the queued prompt.",
} satisfies Extract<AbortPromptInput, { mode: "queued" }>;

const queueInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_runtime_abort_01" as WorkspaceId,
  invalidation: { model: "surface", ids: [handlerTarget.surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

function queuedRecord(
  overrides: Partial<RuntimeSurfaceMessageRecord> = {},
): RuntimeSurfaceMessageRecord {
  return {
    id: "queue_runtime_abort_01" as QueueItemId,
    sessionId: handlerTarget.workspaceSessionId,
    surfacePiSessionId: handlerTarget.surfacePiSessionId,
    threadId: handlerTarget.threadId,
    workflowTaskAttemptId: null,
    kind: "user_message",
    idempotencyKey: "surface_queue:queue_runtime_abort_01",
    messageJson: JSON.stringify({ text: "Cancel this queued message." }),
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
    readonly cancelFails?: boolean;
    readonly publishFails?: boolean;
    readonly postCommitFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const existing = options.existing ?? queuedRecord();
  const cancelled = queuedRecord({
    ...existing,
    status: "cancelled",
    cancelledAt: "2026-04-18T09:02:00.000Z",
  });
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
    markSurfaceMessageQueued: () => Effect.die("Unexpected markSurfaceMessageQueued call."),
    markSurfaceMessageDelivered: () => Effect.die("Unexpected markSurfaceMessageDelivered call."),
    markSurfaceMessageFailed: () => Effect.die("Unexpected markSurfaceMessageFailed call."),
    cancelSurfaceMessage: (input) =>
      Effect.gen(function* () {
        calls.push(`cancel:${input.id}`);
        if (options.cancelFails) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "state.queue.cancel",
              reason: "transaction-failed",
              message: "Queue cancellation transaction failed.",
            }),
          );
        }
        return mutation(cancelled, [queueInvalidation]);
      }),
  } satisfies RuntimeQueueStatePortService;

  const run = (input: Extract<AbortPromptInput, { mode: "queued" }> = abortInput) =>
    runTestEffect(
      abortRuntimeQueuedMessage({ input }).pipe(
        Effect.provideService(RuntimeQueueStatePort, queueStatePort),
        Effect.provideService(RuntimeEventBus, eventBus(calls, options)),
        Effect.provideService(
          RuntimeQueuedMessageAbortPostCommitHost,
          postCommitHost(calls, options),
        ),
      ),
    );

  return { calls, run };
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

function postCommitHost(
  calls: string[],
  options: { readonly postCommitFails?: boolean } = {},
): RuntimeQueuedMessageAbortPostCommitHost["Service"] {
  return RuntimeQueuedMessageAbortPostCommitHost.of({
    afterQueuedMessageAborted: (input) =>
      Effect.gen(function* () {
        calls.push(`post-commit:${input.input.queuedMessageId}:${input.queued.status}`);
        if (options.postCommitFails) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.messages.abort",
              reason: "stale-state",
              message: "Queued-message abort post-commit hook failed.",
            }),
          );
        }
      }),
  });
}

describe("runtime queued message abort", () => {
  it("cancels the queued row, publishes invalidations, and runs the post-commit hook", async () => {
    const harness = createHarness();

    await expect(harness.run()).resolves.toBeUndefined();
    expect(harness.calls).toEqual([
      "lookup:queue_runtime_abort_01",
      "cancel:queue_runtime_abort_01",
      "publish:1",
      "post-commit:queue_runtime_abort_01:cancelled",
    ]);
  });

  it("allows orchestrator queue targets with distinct workspace and pi surface ids", async () => {
    const harness = createHarness({
      existing: queuedRecord({
        surfacePiSessionId: orchestratorTarget.surfacePiSessionId,
        threadId: null,
      }),
    });

    await expect(
      harness.run({
        target: orchestratorTarget,
        mode: "queued",
        queuedMessageId: "queue_runtime_abort_01" as QueueItemId,
        reason: "User removed the queued prompt.",
      }),
    ).resolves.toBeUndefined();

    expect(harness.calls).toEqual([
      "lookup:queue_runtime_abort_01",
      "cancel:queue_runtime_abort_01",
      "publish:1",
      "post-commit:queue_runtime_abort_01:cancelled",
    ]);
  });

  it("rejects queued messages that do not belong to the target before cancelling", async () => {
    const harness = createHarness({
      existing: queuedRecord({
        surfacePiSessionId: "pi_runtime_abort_other" as SurfacePiSessionId,
      }),
    });

    await expect(harness.run()).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.messages.abort",
      reason: "target-not-found",
    });
    expect(harness.calls).toEqual(["lookup:queue_runtime_abort_01"]);
  });

  it("maps state, event, and post-commit failures to runtime contract errors", async () => {
    await expect(createHarness({ cancelFails: true }).run()).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.messages.abort.cancel",
      reason: "stale-state",
    });

    await expect(createHarness({ publishFails: true }).run()).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.messages.abort",
      reason: "stale-state",
    });

    await expect(createHarness({ postCommitFails: true }).run()).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.messages.abort",
      reason: "stale-state",
    });
  });
});
