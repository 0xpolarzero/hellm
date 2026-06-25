import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeThreadStatePort,
  StateContractError,
  type CommandId,
  type ExtensionId,
  type SurfacePiSessionId,
  type ThreadId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeThreadStatePort, runtimeThreadStatePortFromStore } from "./index";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_thread_state_port",
  cwd: "/tmp/svvy-runtime-thread-state-port",
  label: "Runtime thread state port",
};
const workspaceId = workspace.id as WorkspaceId;

describe("RuntimeThreadStatePort", () => {
  it("marks handler threads runnable through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: "session-runtime-thread-state-port",
            title: "Runtime thread state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: "session-runtime-thread-state-port",
            surfacePiSessionId: "surface-orchestrator",
            requestSummary: "Run handler.",
          });
          const thread = yield* state.createThread({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-thread-state",
            title: "Runnable handler",
            objective: "Clear wait before execute_typescript runs.",
          });
          yield* state.updateThread({
            threadId: thread.id,
            status: "waiting",
            wait: {
              owner: "handler",
              kind: "user",
              reason: "Waiting for input.",
              resumeWhen: "User answers.",
              since: "2026-04-18T09:00:00.000Z",
            },
          });

          const port = yield* RuntimeThreadStatePort;
          const result = yield* port.ensureHandlerThreadRunnable({
            workspaceSessionId: "session-runtime-thread-state-port" as WorkspaceSessionId,
            surfacePiSessionId: "surface-handler-thread-state" as SurfacePiSessionId,
            threadId: thread.id as ThreadId,
          });
          expect(result.value).toBeUndefined();
          expect(result.afterCommit).toEqual([
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "surface",
                ids: ["surface-handler-thread-state" as SurfacePiSessionId],
              },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "handlerThreadInspector", ids: [thread.id as ThreadId] },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "sessionNavigation" },
            },
          ]);

          const snapshot = yield* state.getSessionState("session-runtime-thread-state-port");
          const updated = snapshot.threads.find((entry) => entry.id === thread.id);
          expect(updated).toMatchObject({
            id: thread.id,
            status: "running-handler",
            wait: null,
          });

          const noopResult = yield* port.ensureHandlerThreadRunnable({
            workspaceSessionId: "session-runtime-thread-state-port" as WorkspaceSessionId,
            surfacePiSessionId: "surface-handler-thread-state" as SurfacePiSessionId,
            threadId: thread.id as ThreadId,
          });
          expect(noopResult).toEqual({ value: undefined, afterCommit: [] });
        }).pipe(
          Effect.provide(
            layerRuntimeThreadStatePort.pipe(
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

  it("atomically starts handler threads with generated context bindings and initial queue rows", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: "session-runtime-thread-start-port",
            title: "Runtime thread start port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T09:10:00.000Z",
            updatedAt: "2026-04-18T09:11:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: "session-runtime-thread-start-port",
            surfacePiSessionId: "surface-orchestrator-start",
            requestSummary: "Start handler threads.",
          });

          const port = yield* RuntimeThreadStatePort;
          const input = {
            workspaceSessionId: "session-runtime-thread-start-port" as WorkspaceSessionId,
            orchestratorTurnId: turn.id as TurnId,
            sourceCommandId: "command-thread-start-port" as CommandId,
            threads: [
              {
                surfacePiSessionId: "surface-handler-start-a" as SurfacePiSessionId,
                title: "Handler A",
                objective: "Review the runtime contract.",
                historyMode: "isolated" as const,
                worktreeId: null,
                loadedExtensionIds: ["extension-thread-handling" as ExtensionId],
                availableExtensionIds: ["extension-github" as ExtensionId],
                agentProfileJson: JSON.stringify({ profile: "handler" }),
                generatedAgentContextBinding: {
                  aggregateCacheKey: "handler-a-cache",
                  systemPrompt: "Handle objective A.",
                  svvyxGuidance: "Use svvyx when needed.",
                  commandsDts: "declare const svvyx: unknown;",
                  nativeToolSchemasJson: "[]",
                  generatedAgentContextFingerprint: "fingerprint-handler-a",
                  generatedAgentContextRevision: 3,
                  loadedExtensionIds: ["extension-thread-handling" as ExtensionId],
                  availableExtensionIds: ["extension-github" as ExtensionId],
                  externalSourceHashes: ["hash-a"],
                },
                initialQueue: {
                  idempotencyKey: "initial-handler-start:a",
                  priority: "runtime" as const,
                  messageJson: JSON.stringify({ role: "user", content: "Start A." }),
                  payloadJson: JSON.stringify({ source: "thread_start", objective: "A" }),
                },
              },
              {
                surfacePiSessionId: "surface-handler-start-b" as SurfacePiSessionId,
                title: "Handler B",
                objective: "Review the state transaction.",
                historyMode: "forked" as const,
                worktreeId: null,
                loadedExtensionIds: ["extension-thread-handling" as ExtensionId],
                availableExtensionIds: [],
                generatedAgentContextBinding: {
                  aggregateCacheKey: "handler-b-cache",
                  systemPrompt: "Handle objective B.",
                  svvyxGuidance: "",
                  commandsDts: "",
                  nativeToolSchemasJson: "[]",
                  generatedAgentContextFingerprint: "fingerprint-handler-b",
                  generatedAgentContextRevision: 3,
                  loadedExtensionIds: ["extension-thread-handling" as ExtensionId],
                  availableExtensionIds: [],
                  externalSourceHashes: ["hash-b"],
                },
                initialQueue: {
                  idempotencyKey: "initial-handler-start:b",
                  priority: "runtime" as const,
                  messageJson: JSON.stringify({ role: "user", content: "Start B." }),
                  payloadJson: JSON.stringify({ source: "thread_start", objective: "B" }),
                },
              },
            ] as const,
          };

          const startedMutation = yield* port.startHandlerThreads(input);
          const started = startedMutation.value;
          expect(started.threads).toHaveLength(2);
          const firstThread = started.threads[0];
          const secondThread = started.threads[1];
          expect(firstThread).toBeDefined();
          expect(secondThread).toBeDefined();
          if (!firstThread || !secondThread) {
            throw new Error("Expected two started handler threads.");
          }
          expect(firstThread).toMatchObject({
            title: "Handler A",
            objective: "Review the runtime contract.",
            status: "running-handler",
            wait: null,
            generatedAgentContextFingerprint: "fingerprint-handler-a",
          });
          expect(secondThread).toMatchObject({
            title: "Handler B",
            historyMode: "forked",
            generatedAgentContextFingerprint: "fingerprint-handler-b",
          });
          expect(secondThread.threadGroupId).toBe(started.threadGroupId);
          expect(firstThread.threadGroupId).toBe(started.threadGroupId);
          expect(firstThread.queuedMessage).toMatchObject({
            kind: "initial_handler_start",
            sourceCommandId: "command-thread-start-port",
            threadId: firstThread.threadId,
          });
          expect(startedMutation.afterCommit).toEqual([
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "sessionNavigation" },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "commandInspector",
                ids: ["command-thread-start-port" as CommandId],
              },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "surface", ids: [firstThread.surfacePiSessionId] },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "handlerThreadInspector", ids: [firstThread.threadId] },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "surface", ids: [secondThread.surfacePiSessionId] },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "handlerThreadInspector", ids: [secondThread.threadId] },
            },
          ]);

          const snapshot = yield* state.getSessionState("session-runtime-thread-start-port");
          expect(snapshot.threads).toHaveLength(2);
          expect(snapshot.generatedAgentContextBindings).toHaveLength(2);
          expect(snapshot.queuedMessages).toHaveLength(2);

          const replayedMutation = yield* port.startHandlerThreads(input);
          expect(replayedMutation.afterCommit).toEqual([]);
          const replayed = replayedMutation.value;
          expect(replayed.threads.map((thread) => thread.threadId)).toEqual(
            started.threads.map((thread) => thread.threadId),
          );
          const replaySnapshot = yield* state.getSessionState("session-runtime-thread-start-port");
          expect(replaySnapshot.threads).toHaveLength(2);
          expect(replaySnapshot.queuedMessages).toHaveLength(2);
        }).pipe(
          Effect.provide(
            layerRuntimeThreadStatePort.pipe(
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

  it("rejects missing handler thread targets with a typed state error", async () => {
    const store = createFailingStore();
    const port = runtimeThreadStatePortFromStore(store);

    await expect(
      runTestEffect(
        port.ensureHandlerThreadRunnable({
          workspaceSessionId: "missing-session" as WorkspaceSessionId,
          surfacePiSessionId: "missing-surface" as SurfacePiSessionId,
          threadId: "missing-thread" as ThreadId,
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
    getSessionState: () => {
      throw new StateContractError({
        operation: "structured-session.getSessionState",
        reason: "not-found",
        message: "Missing session.",
      });
    },
  } as unknown as StructuredSessionStateStore;
}
