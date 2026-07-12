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
