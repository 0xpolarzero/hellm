import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeRecoveryStatePort,
  StateContractError,
  type RuntimeOwnerId,
  type RuntimeRecoveryStatePortService,
  type SurfacePiSessionId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeRecoveryStatePort, runtimeRecoveryStatePortFromStore } from "./index";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_recovery_state_port",
  cwd: "/tmp/svvy-runtime-recovery-state-port",
  label: "Runtime Recovery State Port",
};
const workspaceId = workspace.id as WorkspaceId;

describe("RuntimeRecoveryStatePort", () => {
  it("exposes recovery work lifecycle and startup snapshots through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: "session-runtime-recovery-state-port",
            title: "Runtime recovery state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: "session-runtime-recovery-state-port",
            surfacePiSessionId: "surface-runtime-recovery-state-port",
            requestSummary: "Recover this turn",
          });
          const queued = yield* state.enqueueSurfaceMessage({
            sessionId: "session-runtime-recovery-state-port",
            surfacePiSessionId: "surface-runtime-recovery-state-port",
            kind: "thread_report_notification",
            messageJson: JSON.stringify({ role: "user", content: "Thread report" }),
          });
          yield* state.claimNextQueuedSurfaceMessage({
            surfacePiSessionId: "surface-runtime-recovery-state-port",
          });
          const port = yield* RuntimeRecoveryStatePort;

          const normalized = yield* port.normalizeWorkspaceRecoveryState({
            claimedBy: "runtime-recovery-state-port-test" as RuntimeOwnerId,
          });
          expect(normalized).toEqual({
            value: undefined,
            afterCommit: [
              {
                scope: "workspace",
                workspaceId,
                invalidation: {
                  model: "surface",
                  ids: ["surface-runtime-recovery-state-port" as SurfacePiSessionId],
                },
              },
            ],
          });

          const snapshots = yield* port.listWorkspaceRecoveryStartupSnapshots();
          expect(snapshots).toEqual([
            expect.objectContaining({
              session: {
                id: "session-runtime-recovery-state-port",
                orchestratorPiSessionId: "session-runtime-recovery-state-port",
              },
              pi: { titleGenerationStatus: "not-started" },
              turns: [
                expect.objectContaining({
                  id: turn.id,
                  status: "running",
                  surfacePiSessionId: "surface-runtime-recovery-state-port",
                }),
              ],
              queuedMessages: [
                expect.objectContaining({
                  id: queued.id,
                  status: "queued",
                  kind: "thread_report_notification",
                }),
              ],
            }),
          ]);

          const ensuredMutation = yield* port.ensureRecoveryWork({
            kind: "active_turn_recovery",
            ownerScope: {
              kind: "surface",
              workspaceSessionId: "session-runtime-recovery-state-port" as WorkspaceSessionId,
              surfacePiSessionId: "surface-runtime-recovery-state-port" as SurfacePiSessionId,
            },
            idempotencyKey: `active_turn_recovery:${turn.surfacePiSessionId}:${turn.id}`,
            orderingKey: `surface:${turn.surfacePiSessionId}`,
            orderingSeq: 0,
            priority: 10,
            availableAt: "2026-04-18T08:57:00.000Z",
            maxAttempts: 5,
            payloadJson: { turnId: turn.id },
          });
          expect(ensuredMutation.afterCommit).toEqual([]);
          const ensured = ensuredMutation.value;
          const claimedMutation = yield* port.claimNextRecoveryWork({
            claimedBy: "runtime-recovery-state-port-test" as RuntimeOwnerId,
          });
          expect(claimedMutation.afterCommit).toEqual([]);
          const claimed = claimedMutation.value;
          expect(claimed).toMatchObject({
            id: ensured.id,
            kind: "active_turn_recovery",
            status: "claimed",
            attempts: 1,
          });

          const completedMutation = yield* port.completeRecoveryWork({
            id: claimed!.id,
            claimedBy: claimed!.claimedBy,
            leaseVersion: claimed!.leaseVersion,
          });
          expect(completedMutation.afterCommit).toEqual([]);
          const completed = completedMutation.value;
          expect(completed).toMatchObject({
            id: ensured.id,
            status: "completed",
            completedAt: expect.any(String),
          });
        }).pipe(
          Effect.provide(
            layerRuntimeRecoveryStatePort.pipe(
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

  it("maps store failures to typed state errors through the runtime recovery port", async () => {
    const store = createFailingStore();
    const port: RuntimeRecoveryStatePortService = runtimeRecoveryStatePortFromStore(store);

    await expect(
      runTestEffect(
        port.ensureRecoveryWork({
          kind: "title_generation",
          ownerScope: { kind: "workspace" },
          idempotencyKey: "title_generation:failure",
          orderingKey: "workspace:failure",
          orderingSeq: 0,
          priority: 50,
          availableAt: "2026-04-18T08:57:00.000Z",
          maxAttempts: 5,
        }),
      ),
    ).rejects.toMatchObject({
      operation: "structured-session.ensureRecoveryWork",
    });
    await expect(
      runTestEffect(port.listWorkspaceRecoveryStartupSnapshots()),
    ).rejects.toBeInstanceOf(StateContractError);
  });
});

function createFailingStore(): StructuredSessionStateStore {
  return {
    workspaceId: "workspace_failure",
    databasePath: ":memory:",
    close: () => undefined,
    ensureRecoveryWork: () => {
      throw new Error("recovery persistence failed");
    },
    listSessionStates: () => {
      throw new Error("snapshot persistence failed");
    },
  } as unknown as StructuredSessionStateStore;
}
