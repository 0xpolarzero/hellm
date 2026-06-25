import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeEventStreamError,
  RuntimeQueueStatePort,
  type AcceptSubmittedRuntimeSurfaceMessageInput,
  type QueueItemId,
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
import { runTestEffect } from "./effect.test-support";

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
  } satisfies RuntimeQueueStatePortService;

  const run = (input: SubmitMessageInput) =>
    runTestEffect(
      submitRuntimeMessage({ input }).pipe(
        Effect.provideService(RuntimeQueueStatePort, queueStatePort),
        Effect.provideService(RuntimeEventBus, eventBus(calls, options)),
        Effect.provideService(
          RuntimeMessageSubmissionPostCommitLane,
          postCommitLane(calls, options),
        ),
      ),
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
  it("queues orchestrator user messages through RuntimeQueueStatePort", async () => {
    const harness = createHarness("queue_runtime_submit_orch" as QueueItemId);
    const input = {
      target: orchestratorTarget,
      message: { text: "Run the runtime-owned queue path." },
      clientSubmission: { source: "test", clientRequestId: "client_request_01" },
    } satisfies SubmitMessageInput;

    await expect(harness.run(input)).resolves.toEqual({
      queuedMessageId: "queue_runtime_submit_orch" as QueueItemId,
      target: orchestratorTarget,
      status: "queued",
      receipt: {
        clientRequestId: "client_request_01",
        outcome: "accepted",
        acceptedAt: "2026-04-18T09:00:00.000Z" as Awaited<
          ReturnType<typeof harness.run>
        >["receipt"]["acceptedAt"],
        stateRevision: 1 as Awaited<ReturnType<typeof harness.run>>["receipt"]["stateRevision"],
      },
    });
    expect(harness.acceptCalls).toHaveLength(1);
    expect(harness.acceptCalls[0]).toMatchObject({
      target: orchestratorTarget,
      idempotencyKey: "client_request_01",
    });
    expect(JSON.parse(harness.acceptCalls[0]?.messageJson ?? "{}")).toEqual(input.message);
    expect(JSON.parse(harness.acceptCalls[0]?.payloadJson ?? "{}")).toMatchObject({
      source: "runtime-submit",
      clientSubmission: { source: "test", clientRequestId: "client_request_01" },
      telemetry: { messageCount: 1, userMessageCount: 1, textBlockCount: 1, imageCount: 0 },
    });
    expect(harness.calls).toEqual([
      `state:${orchestratorTarget.surfacePiSessionId}`,
      "publish:1",
      "postCommit:queue_runtime_submit_orch:enqueue-and-run",
    ]);
  });

  it("queues handler user messages against their thread", async () => {
    const harness = createHarness("queue_runtime_submit_handler" as QueueItemId);

    await harness.run({
      target: handlerTarget,
      message: { text: "Continue the handler." },
      clientSubmission: { submissionId: "submission_01", clientRequestId: "client_request_01" },
    });

    expect(harness.acceptCalls[0]).toMatchObject({
      target: handlerTarget,
      idempotencyKey: "submission_01",
    });
  });

  it("rejects empty submissions before inserting a queue row", async () => {
    const harness = createHarness();

    await expect(
      harness.run({
        target: orchestratorTarget,
        message: { text: "   " },
      }),
    ).rejects.toBeInstanceOf(RuntimeContractError);
    expect(harness.acceptCalls).toEqual([]);
    expect(harness.calls).toEqual([]);
  });

  it("maps runtime event publication failure after queue commit to a typed submit error", async () => {
    const harness = createHarness("queue_runtime_submit_publish_failure" as QueueItemId, {
      eventPublicationFails: true,
    });

    await expect(
      harness.run({
        target: orchestratorTarget,
        message: { text: "Queue this but fail publication." },
      }),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.messages.submit",
      reason: "stale-state",
      message: "Runtime event bus did not accept message submission notifications.",
    } satisfies Partial<RuntimeContractError>);
    expect(harness.calls).toEqual([`state:${orchestratorTarget.surfacePiSessionId}`, "publish:1"]);
  });

  it("maps post-commit lane failure after publication to a typed submit error", async () => {
    const harness = createHarness("queue_runtime_submit_post_commit_failure" as QueueItemId, {
      postCommitFails: true,
    });

    await expect(
      harness.run({
        target: orchestratorTarget,
        message: { text: "Queue this but fail post-commit." },
      }),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.messages.submit",
      reason: "stale-state",
      message: "Post-commit lane failed.",
    } satisfies Partial<RuntimeContractError>);
    expect(harness.calls).toEqual([
      `state:${orchestratorTarget.surfacePiSessionId}`,
      "publish:1",
      "postCommit:queue_runtime_submit_post_commit_failure:enqueue-and-run",
    ]);
  });

  it("materializes submitted messages without pi-native transcript fields", () => {
    const input = {
      target: orchestratorTarget,
      message: {
        text: "Inspect these files.",
        attachments: [
          {
            kind: "file",
            path: "/repo/src/app.ts",
            name: "app.ts",
          },
          {
            kind: "image",
            path: "/repo/screenshot.png",
            name: "screenshot.png",
            dataBase64: "ZmFrZQ==",
            mimeType: "image/png",
          },
        ],
      },
    } satisfies SubmitMessageInput;

    expect(materializeRuntimeSubmittedMessageForQueue(input)).toEqual({
      messageJson: JSON.stringify(input.message),
      promptTelemetry: {
        messageCount: 1,
        userMessageCount: 1,
        textBlockCount: 2,
        imageCount: 1,
      },
    });
    expect(summarizeRuntimeSubmittedMessageForTelemetry(input.message)).toEqual({
      messageCount: 1,
      userMessageCount: 1,
      textBlockCount: 2,
      imageCount: 1,
    });
  });

  it("does not count a pathless image as an attachment text block", () => {
    expect(
      summarizeRuntimeSubmittedMessageForTelemetry({
        text: "",
        attachments: [
          {
            kind: "image",
            dataBase64: "ZmFrZQ==",
            mimeType: "image/png",
          },
        ],
      }),
    ).toEqual({
      messageCount: 1,
      userMessageCount: 1,
      textBlockCount: 0,
      imageCount: 1,
    });
  });
});
