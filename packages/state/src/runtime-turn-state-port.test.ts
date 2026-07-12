import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeTurnStatePort,
  StateContractError,
  type SurfacePiSessionId,
  type RuntimeTurnStatePortService,
  type TurnId,
  type WorkspaceId,
} from "@svvy/core";
import { layerRuntimeTurnStatePort } from "./index";
import { runtimeTurnStatePortFromStore } from "./structured-session-adapters";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_turn_state_port",
  cwd: "/tmp/svvy-runtime-turn-state-port",
  label: "Runtime turn state port",
};

describe("RuntimeTurnStatePort", () => {
  it("exposes runtime turn lifecycle operations through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: "session-runtime-turn-state-port",
            title: "Runtime turn state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });

          const port = yield* RuntimeTurnStatePort;
          const turnResult = yield* port.startTurn({
            sessionId: "session-runtime-turn-state-port",
            surfacePiSessionId: "surface-runtime-turn-state-port",
            requestSummary: "Run the next turn.",
          });
          const turn = turnResult.value;
          const decidedResult = yield* port.setTurnDecision({
            turnId: turn.id,
            decision: "reply",
            onlyIfPending: true,
          });
          const decided = decidedResult.value;
          const finishedResult = yield* port.finishTurn({
            turnId: turn.id,
            status: "completed",
            assistantMessageId: `${turn.id}:assistant` as never,
            assistantText: "Turn complete.",
          });
          const finished = finishedResult.value;
          const interruptedTurnResult = yield* port.startTurn({
            sessionId: "session-runtime-turn-state-port",
            surfacePiSessionId: "surface-runtime-turn-state-port",
            requestSummary: "Interrupt the next turn.",
          });
          const recoveredResult = yield* port.recoverInterruptedTurn({
            turnId: interruptedTurnResult.value.id as TurnId,
            terminalStatus: "failed",
            reason: "Synthetic runtime interruption.",
          });
          const repeatedRecoveryResult = yield* port.recoverInterruptedTurn({
            turnId: interruptedTurnResult.value.id as TurnId,
            terminalStatus: "failed",
            reason: "Synthetic runtime interruption.",
          });
          const queued = yield* state.enqueueSurfaceMessage({
            sessionId: "session-runtime-turn-state-port",
            surfacePiSessionId: "surface-runtime-turn-state-port",
            messageJson: JSON.stringify({ text: "Settle the prompt atomically." }),
          });
          const claimed = yield* state.claimNextQueuedSurfaceMessage({
            surfacePiSessionId: "surface-runtime-turn-state-port",
            claimOwnerId: "owner-runtime-turn-state-port",
          });
          const settlementTurnResult = yield* port.startTurn({
            sessionId: "session-runtime-turn-state-port",
            surfacePiSessionId: "surface-runtime-turn-state-port",
            requestSummary: "Settle the prompt atomically.",
          });
          const danglingCommand = yield* state.createCommand({
            turnId: settlementTurnResult.value.id,
            surfacePiSessionId: "surface-runtime-turn-state-port",
            toolName: "exec_command",
            executor: "orchestrator",
            visibility: "surface",
            title: "Dangling command",
            summary: "Still running.",
            status: "running",
          });
          const settlementResult = yield* port.settlePromptTurn({
            turnId: settlementTurnResult.value.id as never,
            queueItemId: queued.id as never,
            status: "failed",
            assistantText: "Partial output",
            terminalCommandIds: [danglingCommand.id as never],
            terminalCommandSummary: "Prompt failed.",
            terminalCommandError: "Prompt failed.",
            claimOwnerId: claimed!.claimOwnerId,
            leaseVersion: claimed!.leaseVersion,
          });
          const repeatedSettlementResult = yield* port.settlePromptTurn({
            turnId: settlementTurnResult.value.id as never,
            queueItemId: queued.id as never,
            status: "failed",
            assistantText: "Partial output",
            terminalCommandIds: [danglingCommand.id as never],
            terminalCommandSummary: "Prompt failed.",
            terminalCommandError: "Prompt failed.",
            claimOwnerId: claimed!.claimOwnerId,
            leaseVersion: claimed!.leaseVersion,
          });

          expect(turn).toMatchObject({
            sessionId: "session-runtime-turn-state-port",
            surfacePiSessionId: "surface-runtime-turn-state-port",
            requestSummary: "Run the next turn.",
            turnDecision: "pending",
            status: "running",
          });
          expect(decided).toMatchObject({
            id: turn.id,
            turnDecision: "reply",
            status: "running",
          });
          expect(finished).toMatchObject({
            id: turn.id,
            turnDecision: "reply",
            status: "completed",
            assistantMessageId: `${turn.id}:assistant`,
            assistantText: "Turn complete.",
            finishedAt: expect.any(String),
          });
          expect(recoveredResult.value).toMatchObject({
            changed: true,
            turn: {
              id: interruptedTurnResult.value.id,
              status: "failed",
            },
            terminalizedAssistantMessageId: null,
            terminalizedCommandIds: [],
            settledQueueItemId: null,
          });
          expect(repeatedRecoveryResult.value.changed).toBeFalse();
          expect(repeatedRecoveryResult.afterCommit).toEqual([]);
          expect(settlementResult.value).toMatchObject({
            changed: true,
            turn: { id: settlementTurnResult.value.id, status: "failed" },
            queuedMessage: { id: queued.id, status: "failed" },
            terminalizedCommandIds: [danglingCommand.id],
          });
          expect(settlementResult.afterCommit).toEqual([
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_turn_state_port" as WorkspaceId,
              invalidation: {
                model: "surface",
                ids: ["surface-runtime-turn-state-port" as SurfacePiSessionId],
              },
            },
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_turn_state_port" as WorkspaceId,
              invalidation: { model: "sessionNavigation" },
            },
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_turn_state_port" as WorkspaceId,
              invalidation: { model: "commandInspector", ids: [danglingCommand.id as never] },
            },
          ]);
          expect(repeatedSettlementResult.value.changed).toBeFalse();
          expect(repeatedSettlementResult.afterCommit).toEqual([]);
          for (const result of [
            turnResult,
            decidedResult,
            finishedResult,
            interruptedTurnResult,
            recoveredResult,
            settlementTurnResult,
          ]) {
            expect(result.afterCommit).toEqual([
              {
                scope: "workspace",
                workspaceId: "workspace_runtime_turn_state_port" as WorkspaceId,
                invalidation: {
                  model: "surface",
                  ids: ["surface-runtime-turn-state-port" as SurfacePiSessionId],
                },
              },
              {
                scope: "workspace",
                workspaceId: "workspace_runtime_turn_state_port" as WorkspaceId,
                invalidation: {
                  model: "sessionNavigation",
                },
              },
            ]);
          }
        }).pipe(
          Effect.provide(
            layerRuntimeTurnStatePort.pipe(
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

  it("maps store failures to typed state errors through the runtime turn port", async () => {
    const store = createFailingStore();
    const port: RuntimeTurnStatePortService = runtimeTurnStatePortFromStore(store);

    await expect(
      runTestEffect(
        port.startTurn({
          sessionId: "missing",
          surfacePiSessionId: "missing",
          requestSummary: "Missing",
        }),
      ),
    ).rejects.toMatchObject({
      operation: "structured-session.startTurn",
    });
    await expect(
      runTestEffect(
        port.startTurn({
          sessionId: "missing",
          surfacePiSessionId: "missing",
          requestSummary: "Missing",
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
    startTurn: () => {
      throw new Error("turn persistence failed");
    },
  } as unknown as StructuredSessionStateStore;
}
