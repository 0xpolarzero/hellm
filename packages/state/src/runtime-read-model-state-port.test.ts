import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeReadModelStatePort,
  StateContractError,
  type ThreadGroupId,
  type ThreadId,
  type RuntimeReadModelStatePortService,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeReadModelStatePort, runtimeReadModelStatePortFromStore } from "./index";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_read_model_state_port",
  cwd: "/tmp/svvy-runtime-read-model-state-port",
  label: "Runtime read-model state port",
};

const workspaceSessionId = "session-runtime-read-model-state-port" as WorkspaceSessionId;

describe("RuntimeReadModelStatePort", () => {
  it("exposes compact thread read models and durable episode bodies through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: "session-runtime-read-model-state-port",
            title: "Runtime read-model state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: "session-runtime-read-model-state-port",
            surfacePiSessionId: "surface-orchestrator",
            requestSummary: "Delegate read-model inspection.",
          });
          const thread = yield* state.createThread({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-a",
            title: "Inspect read models",
            objective: "Return compact thread state from the state port.",
            loadedExtensionIds: ["shell"],
            availableExtensionIds: ["web"],
          });
          const sibling = yield* state.createThread({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-b",
            title: "Check sibling",
            objective: "Validate group ordering.",
            threadGroupId: thread.threadGroupId,
          });
          yield* state.updateThread({
            threadId: sibling.id,
            status: "waiting",
            wait: {
              owner: "handler",
              kind: "user",
              reason: "Waiting for user input.",
              resumeWhen: "User replies.",
              since: "2026-04-18T10:02:00.000Z",
            },
          });
          const command = yield* state.createCommand({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-a",
            threadId: thread.id,
            toolName: "exec_command",
            executor: "handler",
            visibility: "surface",
            title: "Run check",
            summary: "command summary must not appear in compact rows",
          });
          yield* state.createEpisode({
            threadId: thread.id,
            sourceCommandId: command.id,
            title: "Read-model report",
            summary: "Compact report summary.",
            body: "Full durable body.",
          });
          yield* state.enqueueSurfaceMessage({
            sessionId: "session-runtime-read-model-state-port",
            surfacePiSessionId: thread.surfacePiSessionId,
            threadId: thread.id,
            kind: "report_request",
            priority: "runtime",
            messageJson: "{}",
            payloadJson: JSON.stringify({ request: "Send a concise report." }),
          });

          const port = yield* RuntimeReadModelStatePort;
          const current = yield* port.getCurrentThread({
            workspaceSessionId,
            threadId: thread.id as ThreadId,
          });
          const list = yield* port.listThreads({
            workspaceSessionId,
            threadGroupId: thread.threadGroupId as ThreadGroupId,
            limit: 10,
          });
          const episodes = yield* port.readThreadEpisodes({
            workspaceSessionId,
            threadId: thread.id as ThreadId,
            limit: 1,
          });
          const group = yield* port.getThreadGroup({
            workspaceSessionId,
            currentThreadId: thread.id as ThreadId,
          });

          expect(current).toMatchObject({
            threadId: thread.id,
            threadGroupId: thread.threadGroupId,
            loadedExtensionIds: ["shell"],
            availableExtensionIds: ["web"],
            pendingReportRequests: [
              expect.objectContaining({
                request: "Send a concise report.",
              }),
            ],
            latestEpisode: expect.objectContaining({
              title: "Read-model report",
              summary: "Compact report summary.",
            }),
          });
          expect(JSON.stringify(current)).not.toContain("Full durable body");
          expect(list.threads.map((row) => row.threadId as string)).toEqual([
            sibling.id,
            thread.id,
          ]);
          expect(JSON.stringify(list)).not.toContain("command summary must not appear");
          expect(episodes.episodes).toEqual([
            expect.objectContaining({
              threadId: thread.id,
              title: "Read-model report",
              body: "Full durable body.",
            }),
          ]);
          expect(group).toMatchObject({
            threadGroupId: thread.threadGroupId,
            currentThreadId: thread.id,
          });
          expect(group.threads.map((row) => row.threadId as string)).toEqual([
            sibling.id,
            thread.id,
          ]);
        }).pipe(
          Effect.provide(
            layerRuntimeReadModelStatePort.pipe(
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

  it("maps missing thread reads to typed state errors", async () => {
    const store = createFailingStore();
    const port: RuntimeReadModelStatePortService = runtimeReadModelStatePortFromStore(store);

    await expect(
      runTestEffect(
        port.getCurrentThread({
          workspaceSessionId: "missing" as WorkspaceSessionId,
          threadId: "missing-thread" as ThreadId,
        }),
      ),
    ).rejects.toMatchObject({
      operation: "structured-session.getSessionState",
    });
    await expect(
      runTestEffect(
        port.getCurrentThread({
          workspaceSessionId: "missing" as WorkspaceSessionId,
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
      throw new Error("read-model persistence failed");
    },
  } as unknown as StructuredSessionStateStore;
}
