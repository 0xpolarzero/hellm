import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeTurnStatePort,
  StateContractError,
  type SurfacePiSessionId,
  type RuntimeTurnStatePortService,
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
          for (const result of [turnResult, decidedResult, finishedResult]) {
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
