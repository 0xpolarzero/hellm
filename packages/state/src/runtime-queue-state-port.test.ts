import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeQueueStatePort,
  StateContractError,
  type RuntimeQueueStatePortService,
  type SurfacePiSessionId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeQueueStatePort } from "./index";
import { runtimeQueueStatePortFromStore } from "./structured-session-adapters";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_queue_state_port",
  cwd: "/tmp/svvy-runtime-queue-state-port",
  label: "Runtime Queue State Port",
};

describe("RuntimeQueueStatePort", () => {
  it("accepts submitted surface messages and clears the durable draft in one port commit", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          const workspaceSessionId =
            "session-runtime-queue-state-port-submit" as WorkspaceSessionId;
          const surfacePiSessionId =
            "surface-runtime-queue-state-port-submit" as SurfacePiSessionId;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime queue state port submit",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          yield* state.setComposerDraft({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            text: "draft accepted by runtime",
            attachments: [],
            snippetMentions: [],
          });

          const port = yield* RuntimeQueueStatePort;
          const result = yield* port.acceptSubmittedSurfaceMessage({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId,
            },
            idempotencyKey: "runtime-submit-accept",
            promptHistoryText: "  draft accepted by runtime  ",
            messageJson: JSON.stringify({ text: "draft accepted by runtime" }),
            payloadJson: JSON.stringify({ source: "runtime-submit" }),
          });
          const draft = yield* state.getComposerDraft(surfacePiSessionId);
          const promptHistory = yield* state.listPromptHistory({ workspaceId: workspace.id });

          expect(result.value).toMatchObject({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            kind: "user_message",
            priority: "runtime",
            orderingKey: `surface:${surfacePiSessionId}`,
            idempotencyKey: "runtime-submit-accept",
          });
          expect(draft).toBeNull();
          expect(promptHistory).toEqual([
            {
              workspaceId: workspace.id,
              workspaceSessionId,
              surfacePiSessionId,
              queueItemId: result.value.id,
              text: "  draft accepted by runtime  ",
              sentAt: result.value.createdAt,
            },
          ]);
          expect(result.afterCommit as unknown).toEqual([
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: {
                model: "surface",
                ids: [surfacePiSessionId],
              },
            },
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: { model: "sessionNavigation" },
            },
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: { model: "promptHistory" },
            },
          ]);
        }).pipe(
          Effect.provide(
            layerRuntimeQueueStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("returns terminal duplicate submissions without clearing the current draft or history", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          const workspaceSessionId =
            "session-runtime-queue-state-port-duplicate" as WorkspaceSessionId;
          const surfacePiSessionId =
            "surface-runtime-queue-state-port-duplicate" as SurfacePiSessionId;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime queue state port duplicate",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });

          const port = yield* RuntimeQueueStatePort;
          const first = yield* port.acceptSubmittedSurfaceMessage({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId,
            },
            idempotencyKey: "runtime-submit-duplicate",
            promptHistoryText: "original accepted message",
            messageJson: JSON.stringify({ text: "original accepted message" }),
          });
          yield* port.cancelSurfaceMessage({ id: first.value.id });
          yield* state.setComposerDraft({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            text: "new local draft after accepted send",
            attachments: [],
            snippetMentions: [],
          });
          const duplicate = yield* port.acceptSubmittedSurfaceMessage({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId,
            },
            idempotencyKey: "runtime-submit-duplicate",
            promptHistoryText: "replayed accepted message",
            messageJson: JSON.stringify({ text: "replayed accepted message" }),
          });
          const draft = yield* state.getComposerDraft(surfacePiSessionId);

          expect(duplicate.value.id).toBe(first.value.id);
          expect(duplicate.afterCommit).toEqual([]);
          expect(draft?.text).toBe("new local draft after accepted send");
          expect(yield* state.listPromptHistory({ workspaceId: workspace.id })).toEqual([
            expect.objectContaining({
              queueItemId: first.value.id,
              text: "original accepted message",
            }),
          ]);
        }).pipe(
          Effect.provide(
            layerRuntimeQueueStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("atomically accepts committed edits, rejects queued work, clears drafts, and replays after rebase", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          const workspaceSessionId = "session-runtime-queue-edit" as WorkspaceSessionId;
          const surfacePiSessionId = "surface-runtime-queue-edit" as SurfacePiSessionId;
          const committedAt = "2026-07-12T09:00:00.000Z";
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Edit queue",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: committedAt,
            updatedAt: committedAt,
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            requestSummary: "Original",
          });
          const committed = yield* state.commitRuntimeTranscriptUserMessage({
            workspaceSessionId,
            surfacePiSessionId,
            turnId: turn.id as never,
            queueItemId: "queue-original-edit" as never,
            message: { text: "Original" },
            submittedAt: committedAt as never,
            committedAt: committedAt as never,
            streamGenerationId: "stream-original-edit" as never,
            expectedCursor: null,
          });
          const sourcePiHistoryEntry = {
            session: { surfacePiSessionId },
            entryId: "pi-original-edit",
            messageId: committed.message.messageId,
          };
          yield* state.bindRuntimeTranscriptPiHistoryEntry({
            messageId: committed.message.messageId,
            piHistoryEntry: sourcePiHistoryEntry,
          });
          yield* state.setComposerDraft({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            text: "local draft",
            attachments: [],
            snippetMentions: [],
          });

          const port = yield* RuntimeQueueStatePort;
          const pending = yield* port.enqueueSurfaceMessage({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            messageJson: JSON.stringify({ text: "pending" }),
          });
          const request = {
            workspaceId: workspace.id as never,
            target: {
              workspaceSessionId,
              surface: "orchestrator" as const,
              surfacePiSessionId,
            },
            sourceMessageId: committed.message.messageId,
            expectedCommittedAt: committedAt as never,
            sourcePiHistoryEntry,
            idempotencyKey: "committed-edit:atomic",
            promptHistoryText: "Replacement",
            messageJson: JSON.stringify({ text: "Replacement" }),
            payloadJson: JSON.stringify({
              source: "committed-user-message-edit",
              sourceMessageId: committed.message.messageId,
              expectedCommittedAt: committedAt,
              sourcePiHistoryEntry,
            }),
          };
          const rejected = yield* Effect.exit(port.acceptEditedCommittedSurfaceMessage(request));
          expect(rejected._tag).toBe("Failure");
          expect(
            (yield* state.readRuntimeSurfaceTranscript(surfacePiSessionId)).messages,
          ).toHaveLength(1);
          expect((yield* state.getComposerDraft(surfacePiSessionId))?.text).toBe("local draft");

          yield* port.cancelSurfaceMessage({ id: pending.value.id });
          const accepted = yield* port.acceptEditedCommittedSurfaceMessage(request);
          expect(accepted.value.accepted).toBe("created");
          expect(accepted.value.queuedMessage.priority).toBe("interactive");
          expect((yield* state.readRuntimeSurfaceTranscript(surfacePiSessionId)).messages).toEqual(
            [],
          );
          expect(yield* state.getComposerDraft(surfacePiSessionId)).toBeNull();

          yield* port.markSurfaceMessageDelivered({ id: accepted.value.queuedMessage.id });
          const replay = yield* port.acceptEditedCommittedSurfaceMessage(request);
          expect(replay.value).toEqual({
            queuedMessage: expect.objectContaining({ id: accepted.value.queuedMessage.id }),
            accepted: "existing",
          });
          expect(replay.afterCommit).toEqual([]);
        }).pipe(
          Effect.provide(
            layerRuntimeQueueStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });

  it("exposes runtime queue lifecycle operations through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: "session-runtime-queue-state-port",
            title: "Runtime queue state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const port = yield* RuntimeQueueStatePort;
          const first = yield* port.enqueueSurfaceMessage({
            sessionId: "session-runtime-queue-state-port",
            surfacePiSessionId: "surface-runtime-queue-state-port",
            messageJson: JSON.stringify({ role: "user", content: "First queued prompt" }),
          });
          const second = yield* port.enqueueSurfaceMessage({
            sessionId: "session-runtime-queue-state-port",
            surfacePiSessionId: "surface-runtime-queue-state-port",
            messageJson: JSON.stringify({ role: "user", content: "Second queued prompt" }),
          });
          const reordered = yield* port.reorderSurfaceMessage({
            surfacePiSessionId: "surface-runtime-queue-state-port" as SurfacePiSessionId,
            id: second.value.id as never,
            beforeId: first.value.id as never,
          });
          expect(reordered.value.map((record) => record.id)).toEqual([
            second.value.id,
            first.value.id,
          ]);
          expect(reordered.afterCommit).toEqual(second.afterCommit);
          const noOpReorder = yield* port.reorderSurfaceMessage({
            surfacePiSessionId: "surface-runtime-queue-state-port" as SurfacePiSessionId,
            id: second.value.id as never,
            beforeId: first.value.id as never,
          });
          expect(noOpReorder.afterCommit).toEqual([]);

          const firstClaim = yield* port.claimNextQueuedSurfaceMessage({
            surfacePiSessionId: "surface-runtime-queue-state-port",
          });
          const secondClaim = yield* port.claimNextQueuedSurfaceMessage({
            surfacePiSessionId: "surface-runtime-queue-state-port",
          });
          const emptyClaim = yield* port.claimNextQueuedSurfaceMessage({
            surfacePiSessionId: "surface-runtime-queue-state-port",
          });

          expect(firstClaim.value).toMatchObject({ id: first.value.id, status: "dispatching" });
          expect(secondClaim.value).toMatchObject({ id: second.value.id, status: "dispatching" });
          expect(emptyClaim.value).toBeNull();
          expect(first.afterCommit as unknown).toEqual([
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: {
                model: "surface",
                ids: ["surface-runtime-queue-state-port"],
              },
            },
          ]);
          expect(firstClaim.afterCommit as unknown).toEqual(first.afterCommit as unknown);

          yield* port.markSurfaceMessageDelivered({
            id: first.value.id,
            claimOwnerId: firstClaim.value!.claimOwnerId,
            leaseVersion: firstClaim.value!.leaseVersion,
          });
          const released = yield* port.releaseExpiredSurfaceMessageClaims({
            surfacePiSessionId: "surface-runtime-queue-state-port",
            now: "2099-01-01T00:00:00.000Z",
          });
          expect(released.value).toEqual([
            expect.objectContaining({
              id: second.value.id,
              status: "queued",
              claimOwnerId: null,
              claimLeaseExpiresAt: null,
            }),
          ]);
          expect(released.afterCommit as unknown).toEqual(second.afterCommit as unknown);
          yield* port.markSurfaceMessageQueued({ id: second.value.id, position: "front" });

          const restored = yield* port.getSurfaceQueuedMessage({ id: second.value.id });
          expect(restored).toMatchObject({
            id: second.value.id,
            status: "queued",
            failedAt: null,
            failureError: null,
          });
        }).pipe(
          Effect.provide(
            layerRuntimeQueueStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("maps store failures to typed state errors through the runtime queue port", async () => {
    const store = createFailingStore();
    const port: RuntimeQueueStatePortService = runtimeQueueStatePortFromStore(store);

    await expect(
      runTestEffect(
        port.enqueueSurfaceMessage({
          sessionId: "missing",
          surfacePiSessionId: "missing",
          messageJson: "{}",
        }),
      ),
    ).rejects.toMatchObject({
      operation: "structured-session.enqueueSurfaceMessage",
    });
    await expect(
      runTestEffect(
        port.enqueueSurfaceMessage({
          sessionId: "missing",
          surfacePiSessionId: "missing",
          messageJson: "{}",
        }),
      ),
    ).rejects.toBeInstanceOf(StateContractError);
  });
});

function createFailingStore(): StructuredSessionStateStore {
  return {
    workspaceId: "workspace_failure",
    databasePath: ":memory:",
    close: () => undefined,
    acceptSubmittedSurfaceMessage: () => {
      throw new Error("queue acceptance failed");
    },
    enqueueSurfaceMessage: () => {
      throw new Error("queue persistence failed");
    },
  } as unknown as StructuredSessionStateStore;
}
