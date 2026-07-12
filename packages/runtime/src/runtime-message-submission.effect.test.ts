import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeEventStreamError,
  RuntimeQueueStatePort,
  type AbsolutePath,
  type AttachmentDisplayName,
  type AcceptSubmittedRuntimeSurfaceMessageInput,
  type Base64String,
  type MimeType,
  type QueueItemId,
  type RuntimeClientRequestId,
  type RuntimeClientSubmissionId,
  type RuntimeClientSubmissionSource,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type SubmitMessageInput,
  type ThreadId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import {
  materializeRuntimeSubmittedMessageForQueue,
  RuntimeMessageSubmissionPostCommitLane,
  submitRuntimeMessage,
  summarizeRuntimeSubmittedMessageForTelemetry,
} from "./runtime-message-submission";
import { RuntimeEventBus } from "./runtime-event-bus";

const orchestratorTarget = {
  workspaceSessionId: "wsess_runtime_submit_01" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_runtime_submit_orch_01" as SurfacePiSessionId,
} satisfies SubmitMessageInput["target"];

const handlerTarget = {
  workspaceSessionId: "wsess_runtime_submit_01" as WorkspaceSessionId,
  surface: "handler",
  surfacePiSessionId: "pi_runtime_submit_handler_01" as SurfacePiSessionId,
  threadId: "thread_runtime_submit_01" as ThreadId,
} satisfies SubmitMessageInput["target"];
const queueInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_runtime_submit_01" as WorkspaceId,
  invalidation: { model: "surface", ids: [orchestratorTarget.surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

function createQueuedRecord(
  input: AcceptSubmittedRuntimeSurfaceMessageInput,
  id: QueueItemId,
): RuntimeSurfaceMessageRecord {
  return {
    id,
    sessionId: input.target.workspaceSessionId,
    surfacePiSessionId: input.target.surfacePiSessionId,
    threadId: input.target.surface === "handler" ? input.target.threadId : null,
    workflowTaskAttemptId: null,
    kind: "user_message",
    idempotencyKey: input.idempotencyKey ?? `surface_queue:${id}`,
    messageJson: input.messageJson,
    payloadJson: input.payloadJson ?? null,
    status: "queued",
    priority: "runtime",
    orderingKey: `surface:${input.target.surfacePiSessionId}`,
    sequence: 1,
    position: 1,
    sourceCommandId: input.sourceCommandId ?? null,
    claimOwnerId: null,
    claimLeaseExpiresAt: null,
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 3,
    nextAttemptAt: input.nextAttemptAt ?? null,
    lastErrorJson: null,
    createdAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    deliveredAt: null,
    failedAt: null,
    failureError: null,
    cancelledAt: null,
  };
}

function stateMutation<T>(value: T, afterCommit: readonly StateInvalidationDescriptor[] = []) {
  return { value, afterCommit };
}

function createHarness(
  id = "queue_runtime_submit_01" as QueueItemId,
  options: { eventPublicationFails?: boolean; postCommitFails?: boolean } = {},
) {
  const calls: string[] = [];
  const acceptCalls: AcceptSubmittedRuntimeSurfaceMessageInput[] = [];
  const queueStatePort = {
    acceptSubmittedSurfaceMessage: (input) => {
      return Effect.sync(() => {
        calls.push(`state:${input.target.surfacePiSessionId}`);
        acceptCalls.push(input);
        return stateMutation(createQueuedRecord(input, id), [queueInvalidation]);
      });
    },
    enqueueSurfaceMessage: () => Effect.die("Unexpected enqueueSurfaceMessage call."),
    getSurfaceQueuedMessage: () => Effect.die("Unexpected getSurfaceQueuedMessage call."),
    claimNextQueuedSurfaceMessage: () =>
      Effect.die("Unexpected claimNextQueuedSurfaceMessage call."),
    releaseExpiredSurfaceMessageClaims: () =>
      Effect.die("Unexpected releaseExpiredSurfaceMessageClaims call."),
    markSurfaceMessageSteering: () => Effect.die("Unexpected markSurfaceMessageSteering call."),
    markSurfaceMessageQueued: () => Effect.die("Unexpected markSurfaceMessageQueued call."),
    markSurfaceMessageDelivered: () => Effect.die("Unexpected markSurfaceMessageDelivered call."),
    markSurfaceMessageFailed: () => Effect.die("Unexpected markSurfaceMessageFailed call."),
    cancelSurfaceMessage: () => Effect.die("Unexpected cancelSurfaceMessage call."),
    reorderSurfaceMessage: () => Effect.die("Unexpected reorderSurfaceMessage call."),
  } satisfies RuntimeQueueStatePortService;

  const run = (input: SubmitMessageInput) =>
    submitRuntimeMessage({ input }).pipe(
      Effect.provideService(RuntimeQueueStatePort, queueStatePort),
      Effect.provideService(RuntimeEventBus, eventBus(calls, options)),
      Effect.provideService(RuntimeMessageSubmissionPostCommitLane, postCommitLane(calls, options)),
    );

  return { calls, acceptCalls, run };
}

function postCommitLane(
  calls: string[],
  options: { postCommitFails?: boolean } = {},
): RuntimeMessageSubmissionPostCommitLane["Service"] {
  return RuntimeMessageSubmissionPostCommitLane.of({
    afterSubmitCommitted: (input) =>
      Effect.gen(function* () {
        calls.push(`postCommit:${input.queuedMessageId}:${input.delivery}`);
        if (options.postCommitFails) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.messages.submit",
              reason: "stale-state",
              message: "Post-commit lane failed.",
            }),
          );
        }
      }),
  });
}

function eventBus(
  calls: string[],
  options: { eventPublicationFails?: boolean } = {},
): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected live event publication."),
    publishStateInvalidations: (input) =>
      Effect.gen(function* () {
        calls.push(`publish:${input.afterCommit.length}`);
        if (options.eventPublicationFails) {
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

describe("runtime message submission", () => {
  it.effect("queues orchestrator user messages through RuntimeQueueStatePort", () =>
    Effect.gen(function* () {
      const harness = createHarness("queue_runtime_submit_orch" as QueueItemId);
      const input = {
        target: orchestratorTarget,
        message: { text: "Run the runtime-owned queue path." },
        clientSubmission: {
          source: "test" as RuntimeClientSubmissionSource,
          clientRequestId: "client_request_01" as RuntimeClientRequestId,
        },
      } satisfies SubmitMessageInput;

      const result = yield* harness.run(input);
      assert.deepStrictEqual(result, {
        queuedMessageId: "queue_runtime_submit_orch" as QueueItemId,
        target: orchestratorTarget,
        status: "queued",
        receipt: {
          clientRequestId: "client_request_01",
          outcome: "accepted",
          acceptedAt: "2026-04-18T09:00:00.000Z" as typeof result.receipt.acceptedAt,
          stateRevision: 1 as typeof result.receipt.stateRevision,
        },
      });
      assert.strictEqual(harness.acceptCalls.length, 1);
      assert.deepStrictEqual(
        {
          target: harness.acceptCalls[0]?.target,
          idempotencyKey: harness.acceptCalls[0]?.idempotencyKey,
          promptHistoryText: harness.acceptCalls[0]?.promptHistoryText,
        },
        {
          target: orchestratorTarget,
          idempotencyKey: "client_request_01",
          promptHistoryText: input.message.text,
        },
      );
      assert.deepStrictEqual(
        JSON.parse(harness.acceptCalls[0]?.messageJson ?? "{}"),
        input.message,
      );
      assert.deepStrictEqual(JSON.parse(harness.acceptCalls[0]?.payloadJson ?? "{}"), {
        source: "runtime-submit",
        clientSubmission: { source: "test", clientRequestId: "client_request_01" },
        telemetry: { messageCount: 1, userMessageCount: 1, textBlockCount: 1, imageCount: 0 },
      });
      assert.deepStrictEqual(harness.calls, [
        `state:${orchestratorTarget.surfacePiSessionId}`,
        "publish:1",
        "postCommit:queue_runtime_submit_orch:enqueue-and-run",
      ]);
    }),
  );

  it.effect("queues handler user messages against their thread", () =>
    Effect.gen(function* () {
      const harness = createHarness("queue_runtime_submit_handler" as QueueItemId);

      yield* harness.run({
        target: handlerTarget,
        message: { text: "Continue the handler." },
        clientSubmission: {
          submissionId: "submission_01" as RuntimeClientSubmissionId,
          clientRequestId: "client_request_01" as RuntimeClientRequestId,
        },
      });

      assert.deepStrictEqual(
        {
          target: harness.acceptCalls[0]?.target,
          idempotencyKey: harness.acceptCalls[0]?.idempotencyKey,
        },
        {
          target: handlerTarget,
          idempotencyKey: "submission_01",
        },
      );
    }),
  );

  it.effect("rejects empty submissions before inserting a queue row", () =>
    Effect.gen(function* () {
      const harness = createHarness();

      const error = yield* harness
        .run({
          target: orchestratorTarget,
          message: { text: "   " },
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, RuntimeContractError);
      assert.deepStrictEqual(harness.acceptCalls, []);
      assert.deepStrictEqual(harness.calls, []);
    }),
  );

  it.effect("omits prompt history for accepted attachment-only submissions", () =>
    Effect.gen(function* () {
      const harness = createHarness("queue_runtime_submit_attachment" as QueueItemId);

      yield* harness.run({
        target: orchestratorTarget,
        message: {
          text: "   ",
          attachments: [
            {
              kind: "file",
              path: "/repo/notes.md" as AbsolutePath,
              name: "notes.md" as AttachmentDisplayName,
            },
          ],
        },
      });

      assert.strictEqual(harness.acceptCalls[0]?.promptHistoryText, null);
    }),
  );

  it.effect(
    "maps runtime event publication failure after queue commit to a typed submit error",
    () =>
      Effect.gen(function* () {
        const harness = createHarness("queue_runtime_submit_publish_failure" as QueueItemId, {
          eventPublicationFails: true,
        });

        const error = yield* harness
          .run({
            target: orchestratorTarget,
            message: { text: "Queue this but fail publication." },
          })
          .pipe(Effect.flip);

        assertRuntimeSubmitError(error, {
          _tag: "RuntimeContractError",
          operation: "runtime.messages.submit",
          reason: "stale-state",
          message: "Runtime event bus did not accept message submission notifications.",
        });
        assert.deepStrictEqual(harness.calls, [
          `state:${orchestratorTarget.surfacePiSessionId}`,
          "publish:1",
        ]);
      }),
  );

  it.effect("maps post-commit lane failure after publication to a typed submit error", () =>
    Effect.gen(function* () {
      const harness = createHarness("queue_runtime_submit_post_commit_failure" as QueueItemId, {
        postCommitFails: true,
      });

      const error = yield* harness
        .run({
          target: orchestratorTarget,
          message: { text: "Queue this but fail post-commit." },
        })
        .pipe(Effect.flip);

      assertRuntimeSubmitError(error, {
        _tag: "RuntimeContractError",
        operation: "runtime.messages.submit",
        reason: "stale-state",
        message: "Post-commit lane failed.",
      });
      assert.deepStrictEqual(harness.calls, [
        `state:${orchestratorTarget.surfacePiSessionId}`,
        "publish:1",
        "postCommit:queue_runtime_submit_post_commit_failure:enqueue-and-run",
      ]);
    }),
  );

  it("materializes submitted messages without pi-native transcript fields", () => {
    const input = {
      target: orchestratorTarget,
      message: {
        text: "Inspect these files.",
        attachments: [
          {
            kind: "file",
            path: "/repo/src/app.ts" as AbsolutePath,
            name: "app.ts" as AttachmentDisplayName,
          },
          {
            kind: "image",
            path: "/repo/screenshot.png" as AbsolutePath,
            name: "screenshot.png" as AttachmentDisplayName,
            dataBase64: "ZmFrZQ==" as Base64String,
            mimeType: "image/png" as MimeType,
          },
        ],
      },
    } satisfies SubmitMessageInput;

    assert.deepStrictEqual(materializeRuntimeSubmittedMessageForQueue(input), {
      messageJson: JSON.stringify(input.message),
      promptTelemetry: {
        messageCount: 1,
        userMessageCount: 1,
        textBlockCount: 2,
        imageCount: 1,
      },
    });
    assert.deepStrictEqual(summarizeRuntimeSubmittedMessageForTelemetry(input.message), {
      messageCount: 1,
      userMessageCount: 1,
      textBlockCount: 2,
      imageCount: 1,
    });
  });

  it("does not count a pathless image as an attachment text block", () => {
    assert.deepStrictEqual(
      summarizeRuntimeSubmittedMessageForTelemetry({
        text: "",
        attachments: [
          {
            kind: "image",
            dataBase64: "ZmFrZQ==" as Base64String,
            mimeType: "image/png" as MimeType,
          },
        ],
      }),
      {
        messageCount: 1,
        userMessageCount: 1,
        textBlockCount: 0,
        imageCount: 1,
      },
    );
  });
});

function assertRuntimeSubmitError(
  error: RuntimeContractError,
  expected: {
    readonly _tag: "RuntimeContractError";
    readonly operation: string;
    readonly reason: string;
    readonly message: string;
  },
) {
  assert.deepStrictEqual(
    {
      _tag: error._tag,
      operation: error.operation,
      reason: error.reason,
      message: error.message,
    },
    expected,
  );
}
