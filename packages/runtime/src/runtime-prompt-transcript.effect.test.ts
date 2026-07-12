import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  RuntimeCommandStatePort,
  RuntimeEventStreamError,
  RuntimeQueueStatePort,
  RuntimeTranscriptStatePort,
  RuntimeTurnStatePort,
  type MessageId,
  type PiRuntimeEvent,
  type PromptExecutionContext,
  type RuntimeCommandStatePortService,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type RuntimeTranscriptAssistantMessage,
  type RuntimeTranscriptStatePortService,
  type RuntimeTranscriptStreamCursor,
  type RuntimeTurnRecord,
  type RuntimeTurnStatePortService,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  layerRuntimePromptExecutionService,
  RuntimePromptExecutionService,
} from "./runtime-prompt-execution-service";
import { RuntimeSurfaceEventPublisher } from "./runtime-surface-event-publisher";
import { RuntimeSurfaceRuntimeService } from "./surface-runtime-scope-service";

const workspaceId = "workspace_prompt_transcript" as WorkspaceId;
const workspaceSessionId = "session_prompt_transcript" as WorkspaceSessionId;
const surfacePiSessionId = "surface_prompt_transcript" as SurfacePiSessionId;
const turnId = "turn_prompt_transcript" as TurnId;
const userMessageId = "message_user_transcript" as MessageId;
const assistantMessageId = "message_assistant_transcript" as MessageId;
const target = {
  workspaceSessionId,
  surface: "orchestrator" as const,
  surfacePiSessionId,
};

const queueItem = {
  id: "queue_prompt_transcript",
  sessionId: workspaceSessionId,
  surfacePiSessionId,
  threadId: null,
  workflowTaskAttemptId: null,
  kind: "user_message",
  idempotencyKey: "queue_prompt_transcript",
  messageJson: JSON.stringify({ text: "Inspect the transcript." }),
  payloadJson: null,
  status: "dispatching",
  priority: "runtime",
  orderingKey: `surface:${surfacePiSessionId}`,
  sequence: 1,
  position: 1,
  sourceCommandId: null,
  claimOwnerId: "owner_prompt_transcript",
  claimLeaseExpiresAt: null,
  leaseVersion: 1,
  attemptCount: 1,
  maxAttempts: 3,
  nextAttemptAt: null,
  lastErrorJson: null,
  createdAt: "2026-07-11T12:00:00.000Z",
  updatedAt: "2026-07-11T12:00:00.000Z",
  deliveredAt: null,
  failedAt: null,
  failureError: null,
  cancelledAt: null,
} satisfies RuntimeSurfaceMessageRecord;

const turn = {
  id: turnId,
  sessionId: workspaceSessionId,
  surfacePiSessionId,
  threadId: null,
  requestSummary: "Inspect the transcript.",
  turnDecision: "pending",
  status: "running",
  assistantMessageId: null,
  assistantText: null,
  startedAt: "2026-07-11T12:00:00.000Z",
  updatedAt: "2026-07-11T12:00:00.000Z",
  finishedAt: null,
} satisfies RuntimeTurnRecord;

const transcriptInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "surface", ids: [surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

describe("@svvy/runtime durable prompt transcript", () => {
  it.effect("sequences durable transcript events across internal pi turn boundaries", () => {
    let cursor: RuntimeTranscriptStreamCursor | null = null;
    let assistantContent = "";
    let assistantStatus: RuntimeTranscriptAssistantMessage["status"] = "streaming";
    const transcriptCalls: string[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[][] = [];
    const publishedPatches: Array<{ sequence: number | undefined; type: string }> = [];

    const nextCursor = (input: {
      readonly streamGenerationId: RuntimeTranscriptStreamCursor["streamGenerationId"];
      readonly expectedCursor: RuntimeTranscriptStreamCursor | null;
    }): RuntimeTranscriptStreamCursor => {
      assert.deepStrictEqual(input.expectedCursor, cursor);
      cursor = {
        surfacePiSessionId,
        streamGenerationId: input.streamGenerationId,
        streamSequence: ((cursor?.streamSequence ?? 0) + 1) as never,
      };
      return cursor;
    };
    const assistantMessage = (): RuntimeTranscriptAssistantMessage => ({
      role: "assistant",
      messageId: assistantMessageId,
      workspaceSessionId,
      surfacePiSessionId,
      turnId,
      ordinal: 1,
      status: assistantStatus,
      content: assistantContent ? [{ kind: "text", contentIndex: 0, text: assistantContent }] : [],
      api: "openai-responses",
      providerId: "openai" as never,
      modelId: "gpt-5" as never,
      responseId: assistantStatus === "completed" ? "response_transcript" : null,
      usage: null,
      stopReason: assistantStatus === "completed" ? "stop" : null,
      errorMessage: null,
      piHistoryEntry: null,
      startedAt: "2026-07-11T12:00:01.000Z" as never,
      messageTimestamp: "2026-07-11T12:00:01.000Z" as never,
      updatedAt: "2026-07-11T12:00:02.000Z" as never,
      finishedAt: assistantStatus === "completed" ? ("2026-07-11T12:00:03.000Z" as never) : null,
    });
    const userMessage = (piHistoryEntry: null | { readonly entryId: string } = null) => ({
      role: "user" as const,
      messageId: userMessageId,
      workspaceSessionId,
      surfacePiSessionId,
      turnId,
      ordinal: 0,
      queueItemId: queueItem.id as never,
      message: { text: "Inspect the transcript." },
      piHistoryEntry: piHistoryEntry
        ? {
            session: { surfacePiSessionId },
            entryId: piHistoryEntry.entryId,
            messageId: userMessageId,
          }
        : null,
      submittedAt: queueItem.createdAt as never,
      committedAt: "2026-07-11T12:00:00.500Z" as never,
    });

    const transcriptState = {
      readSurfaceTranscript: () =>
        Effect.succeed({
          surfacePiSessionId,
          messages: [],
          activeAssistantMessage: null,
          streamCursor: cursor,
        }),
      advanceStreamCursor: (input) =>
        Effect.sync(() => {
          transcriptCalls.push("cursor");
          return { value: nextCursor(input), afterCommit: [] };
        }),
      commitUserMessage: (input) =>
        Effect.sync(() => {
          transcriptCalls.push("user");
          return {
            value: { message: userMessage(), cursor: nextCursor(input) },
            afterCommit: [transcriptInvalidation],
          };
        }),
      bindPiHistoryEntry: (input) =>
        Effect.sync(() => {
          transcriptCalls.push(`history:${input.messageId}:${input.piHistoryEntry.entryId}`);
          return {
            value: userMessage({ entryId: input.piHistoryEntry.entryId }),
            afterCommit: [],
          };
        }),
      beginAssistantMessage: (input) =>
        Effect.sync(() => {
          transcriptCalls.push("assistant:start");
          return {
            value: { message: assistantMessage(), cursor: nextCursor(input) },
            afterCommit: [transcriptInvalidation],
          };
        }),
      appendAssistantContentDelta: (input) =>
        Effect.sync(() => {
          transcriptCalls.push(`assistant:delta:${input.delta}`);
          assistantContent += input.delta;
          return {
            value: { message: assistantMessage(), cursor: nextCursor(input) },
            afterCommit: [],
          };
        }),
      commitAssistantMessage: (input) =>
        Effect.sync(() => {
          transcriptCalls.push("assistant:commit");
          assistantContent = input.content
            .filter((block) => block.kind === "text")
            .map((block) => block.text)
            .join("");
          assistantStatus = "completed";
          return {
            value: { message: assistantMessage(), cursor: nextCursor(input) },
            afterCommit: [transcriptInvalidation],
          };
        }),
      upsertAssistantToolCall: () => Effect.die("Unexpected tool call."),
      linkAssistantToolCallCommand: () => Effect.die("Unexpected tool link."),
      failAssistantMessage: () => Effect.die("Unexpected assistant failure."),
    } satisfies RuntimeTranscriptStatePortService;

    const queueState = {
      markSurfaceMessageDelivered: () =>
        Effect.succeed({
          value: { ...queueItem, status: "delivered" as const },
          afterCommit: [],
        }),
      markSurfaceMessageFailed: () => Effect.die("Unexpected failed queue settlement."),
      acceptSubmittedSurfaceMessage: () => Effect.die("Unexpected submit."),
      enqueueSurfaceMessage: () => Effect.die("Unexpected enqueue."),
      getSurfaceQueuedMessage: () => Effect.die("Unexpected queue read."),
      claimNextQueuedSurfaceMessage: () => Effect.die("Unexpected claim."),
      releaseExpiredSurfaceMessageClaims: () => Effect.die("Unexpected claim release."),
      markSurfaceMessageSteering: () => Effect.die("Unexpected steering."),
      markSurfaceMessageQueued: () => Effect.die("Unexpected requeue."),
      cancelSurfaceMessage: () => Effect.die("Unexpected cancellation."),
    } satisfies RuntimeQueueStatePortService;

    const turnState = {
      finishTurn: (input) =>
        Effect.succeed({
          value: {
            ...turn,
            status: input.status,
            assistantMessageId: input.assistantMessageId ?? null,
            assistantText: input.assistantText ?? null,
            finishedAt: "2026-07-11T12:00:04.000Z",
          },
          afterCommit: [],
        }),
      startTurn: () => Effect.die("Unexpected turn start."),
      queueTopLevelTitleGeneration: () => Effect.die("Unexpected title generation."),
      setTurnDecision: () => Effect.die("Unexpected turn decision."),
      recoverInterruptedTurn: () => Effect.die("Unexpected turn recovery."),
      settlePromptTurn: (input) =>
        Effect.succeed({
          value: {
            changed: true,
            turn: {
              ...turn,
              status: input.status,
              assistantMessageId: input.assistantMessageId ?? null,
              assistantText: input.assistantText ?? null,
              finishedAt: "2026-07-11T12:00:04.000Z",
            },
            queuedMessage: {
              ...queueItem,
              status:
                input.status === "completed"
                  ? ("delivered" as const)
                  : input.status === "cancelled"
                    ? ("cancelled" as const)
                    : ("failed" as const),
            },
            terminalizedCommandIds: [],
          },
          afterCommit: [],
        }),
    } satisfies RuntimeTurnStatePortService;

    const events = [
      {
        type: "pi.user_message.committed",
        session: { surfacePiSessionId },
        turnId,
        surfacePiSessionId,
        piMessageRef: "pi_user_transcript",
        piHistoryEntry: {
          session: { surfacePiSessionId },
          entryId: "history_user_transcript",
        },
        committedAt: "2026-07-11T12:00:00.500Z",
      },
      {
        type: "pi.assistant_message.started",
        session: { surfacePiSessionId },
        turnId,
        surfacePiSessionId,
        piMessageRef: "pi_assistant_transcript",
        api: "openai-responses",
        providerId: "openai",
        modelId: "gpt-5",
        startedAt: "2026-07-11T12:00:01.000Z",
      },
      {
        type: "pi.turn.finished",
        session: { surfacePiSessionId },
        turnId,
        surfacePiSessionId,
        status: "completed",
        stopReason: "toolUse",
      },
      {
        type: "pi.assistant.text.delta",
        session: { surfacePiSessionId },
        turnId,
        surfacePiSessionId,
        piMessageRef: "pi_assistant_transcript",
        contentIndex: 0,
        delta: "Durable response.",
      },
      {
        type: "pi.assistant_message.committed",
        session: { surfacePiSessionId },
        turnId,
        surfacePiSessionId,
        piMessageRef: "pi_assistant_transcript",
        content: [{ kind: "text", contentIndex: 0, text: "Durable response." }],
        api: "openai-responses",
        providerId: "openai",
        modelId: "gpt-5",
        responseId: "response_transcript",
        usage: null,
        stopReason: "stop",
        errorMessage: null,
        piHistoryEntry: {
          session: { surfacePiSessionId },
          entryId: "history_assistant_transcript",
        },
        messageTimestamp: "2026-07-11T12:00:01.000Z",
        finishedAt: "2026-07-11T12:00:03.000Z",
      },
      {
        type: "pi.agent.finished",
        session: { surfacePiSessionId },
        turnId,
        surfacePiSessionId,
        status: "completed",
        stopReason: "stop",
      },
    ] as unknown as readonly PiRuntimeEvent[];

    return Effect.gen(function* () {
      const service = yield* RuntimePromptExecutionService;
      const result = yield* service
        .executeClaimedPrompt({
          workspaceId,
          target,
          claimedMessage: queueItem,
          turn,
          promptContext: {
            workspaceSessionId,
            turnId,
            surfacePiSessionId,
            surfaceKind: "orchestrator",
            loadedExtensionIds: [],
            availableExtensionIds: [],
            externalInstructionSources: [],
            generatedAgentContextFingerprint: "context_prompt_transcript" as never,
            generatedAgentContextRevision: "1" as never,
            queueItemId: queueItem.id,
            defaultEpisodeKind: "analysis",
            rootThreadId: null,
            rootEpisodeKind: "analysis",
            sessionWaitApplied: false,
            threadWasTerminalAtStart: false,
          } satisfies PromptExecutionContext,
          piTurnInput: {
            session: { surfacePiSessionId },
            turnId,
            surfacePiSessionId,
            userMessage: { text: "Inspect the transcript." },
            userMessageSubmittedAt: queueItem.createdAt as never,
            systemPromptBinding: {
              fingerprint: "context_prompt_transcript" as never,
              revision: "1" as never,
              text: "Test transcript persistence.",
            },
            model: { providerId: "openai" as never, modelId: "gpt-5" as never },
            reasoning: { effort: "medium" },
            tools: [],
            toolExecutor: () => Effect.die("Unexpected tool execution."),
          },
        })
        .pipe(
          Effect.provideService(
            RuntimeSurfaceRuntimeService,
            RuntimeSurfaceRuntimeService.of({
              surfacePiSessionId,
              session: { surfacePiSessionId },
              withPromptLock: (effect) => effect,
              runPiTurn: () =>
                Effect.succeed({
                  stream: Stream.fromIterable(events),
                  close: () => Effect.void,
                  closed: Effect.void,
                }),
              interruptActivePrompt: () => Effect.void,
              isPromptActive: () => false,
              activePromptDone: () => null,
              installActivePrompt: () => Effect.void,
              clearActivePrompt: () => Effect.void,
            }),
          ),
        );

      assert.strictEqual(result.status, "completed");
      assert.strictEqual(result.assistantText, "Durable response.");
      assert.deepStrictEqual(transcriptCalls, [
        "cursor",
        "user",
        "history:message_user_transcript:history_user_transcript",
        "assistant:start",
        "assistant:delta:Durable response.",
        "assistant:commit",
        "cursor",
      ]);
      assert.deepStrictEqual(
        publishedPatches.map((patch) => patch.sequence),
        [1, 2, 3, 4, 5, 6],
      );
      assert.deepStrictEqual(
        publishedPatches.map((patch) => patch.type),
        [
          "prompt_status",
          "user_message_committed",
          "assistant_message_started",
          "assistant_text_delta",
          "assistant_message_finished",
          "prompt_status",
        ],
      );
      assert.strictEqual(publishedInvalidations.length, 3);
    }).pipe(
      Effect.provide(layerRuntimePromptExecutionService),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(RuntimeTranscriptStatePort, transcriptState),
          Layer.succeed(RuntimeQueueStatePort, queueState),
          Layer.succeed(RuntimeTurnStatePort, turnState),
          Layer.succeed(RuntimeCommandStatePort, {} as RuntimeCommandStatePortService),
          Layer.succeed(RuntimeEventBus, {
            publishLive: () => Effect.die("Unexpected direct live event."),
            publishStateInvalidations: ({ afterCommit }) =>
              Effect.sync(() => {
                if (afterCommit.length > 0) {
                  publishedInvalidations.push([...afterCommit]);
                }
                return [];
              }),
            subscribe: () => Effect.die("Unexpected subscription."),
          }),
          Layer.succeed(RuntimeSurfaceEventPublisher, {
            publishSurfaceChanged: () => Effect.die("Unexpected surface change."),
            publishStreamPatch: (input) =>
              Effect.sync(() => {
                publishedPatches.push({
                  sequence: input.streamSequence,
                  type: input.patch.type,
                });
              }).pipe(
                Effect.andThen(
                  input.patch.type === "assistant_text_delta"
                    ? Effect.fail(
                        new RuntimeEventStreamError({
                          operation: "runtime.prompt-transcript.test",
                          reason: "stream-failed",
                          message: "Synthetic renderer notification failure.",
                        }),
                      )
                    : Effect.succeed({} as never),
                ),
              ),
            resetSurfaceStream: () => Effect.die("Unexpected stream reset."),
          }),
        ),
      ),
    );
  });
});
