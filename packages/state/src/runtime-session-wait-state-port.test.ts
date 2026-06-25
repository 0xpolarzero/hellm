import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeSessionWaitStatePort,
  StateContractError,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type WorkspaceSessionId,
  type WorkspaceId,
} from "@svvy/core";
import {
  layerRuntimeSessionWaitStatePort,
  runtimeSessionWaitStatePortFromStore,
} from "./runtime-session-wait-state-port";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_session_wait_state_port",
  cwd: "/tmp/svvy-runtime-session-wait-state-port",
  label: "Runtime session wait state port",
};

const workspaceSessionId = "session-runtime-session-wait-state-port" as WorkspaceSessionId;
const workspaceId = workspace.id as WorkspaceId;

describe("RuntimeSessionWaitStatePort", () => {
  it("sets and clears approval waits through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime session wait state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });

          const port = yield* RuntimeSessionWaitStatePort;
          const setResult = yield* port.setApprovalWait({
            sessionId: workspaceSessionId,
            owner: { kind: "orchestrator" },
            reason: "Waiting for approval.",
            resumeWhen: "Resume when the user approves or denies the runtime action.",
          });
          const waiting = yield* state.getSessionState(workspaceSessionId);
          const clearResult = yield* port.clearSessionWait({ sessionId: workspaceSessionId });
          const noOpClearResult = yield* port.clearSessionWait({ sessionId: workspaceSessionId });
          const cleared = yield* state.getSessionState(workspaceSessionId);

          const expectedInvalidations: readonly StateInvalidationDescriptor[] = [
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "surface",
                ids: [waiting.session.orchestratorPiSessionId as SurfacePiSessionId],
              },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "sessionNavigation" },
            },
          ];

          expect(waiting.session.wait).toEqual({
            owner: { kind: "orchestrator" },
            kind: "approval",
            reason: "Waiting for approval.",
            resumeWhen: "Resume when the user approves or denies the runtime action.",
            since: expect.any(String),
          });
          expect(setResult).toEqual({
            value: undefined,
            afterCommit: expectedInvalidations,
          });
          expect(clearResult).toEqual({
            value: undefined,
            afterCommit: expectedInvalidations,
          });
          expect(noOpClearResult).toEqual({ value: undefined, afterCommit: [] });
          expect(cleared.session.wait).toBeNull();
        }).pipe(
          Effect.provide(
            layerRuntimeSessionWaitStatePort.pipe(
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

  it("sets request-input user waits through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime request-input wait state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });

          const port = yield* RuntimeSessionWaitStatePort;
          const setResult = yield* port.setUserWait({
            sessionId: workspaceSessionId,
            owner: { kind: "orchestrator" },
            reason: "CI scope",
            resumeWhen: "Resume when the user answers the clarification request.",
          });
          const waiting = yield* state.getSessionState(workspaceSessionId);

          expect(waiting.session.wait).toEqual({
            owner: { kind: "orchestrator" },
            kind: "user",
            reason: "CI scope",
            resumeWhen: "Resume when the user answers the clarification request.",
            since: expect.any(String),
          });
          expect(setResult.afterCommit).toEqual([
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "surface",
                ids: [waiting.session.orchestratorPiSessionId as SurfacePiSessionId],
              },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "sessionNavigation" },
            },
          ]);
        }).pipe(
          Effect.provide(
            layerRuntimeSessionWaitStatePort.pipe(
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

  it("maps store failures to typed state errors through the runtime wait port", async () => {
    const port = runtimeSessionWaitStatePortFromStore(createFailingStore());

    await expect(
      runTestEffect(
        port.clearSessionWait({
          sessionId: workspaceSessionId,
        }),
      ),
    ).rejects.toMatchObject({
      operation: "structured-session.clearSessionWait",
    });
    await expect(
      runTestEffect(
        port.clearSessionWait({
          sessionId: workspaceSessionId,
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
    getSessionState: () => ({
      workspace: {
        id: "workspace_failure",
        cwd: "/tmp/workspace_failure",
        label: "Failure",
        artifactDir: "/tmp/workspace_failure/artifacts",
      },
      pi: {
        sessionId: workspaceSessionId,
        title: "Failure",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "high",
        messageCount: 0,
        status: "idle",
        createdAt: "2026-04-18T08:55:00.000Z",
        updatedAt: "2026-04-18T08:56:00.000Z",
      },
      session: {
        id: workspaceSessionId,
        orchestratorPiSessionId: "surface_failure",
        pinnedAt: null,
        archivedAt: null,
        unreadAt: null,
        unreadReason: null,
        lastReadAt: null,
        wait: {
          owner: { kind: "orchestrator" },
          kind: "approval",
          reason: "Failure",
          resumeWhen: "Never",
          since: "2026-04-18T08:55:00.000Z",
        },
      },
      turns: [],
      threads: [],
      commands: [],
      episodes: [],
      workflowRuns: [],
      workflowTaskAttempts: [],
      workflowTaskMessages: [],
      generatedAgentContextBindings: [],
      requestUserInputRequests: [],
      artifacts: [],
      events: [],
    }),
    clearSessionWait: () => {
      throw new Error("wait persistence failed");
    },
  } as unknown as StructuredSessionStateStore;
}
