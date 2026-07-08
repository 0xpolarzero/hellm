import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeCommandStatePort,
  StateContractError,
  type RuntimeCommandStatePortService,
} from "@svvy/core";
import { layerRuntimeCommandStatePort } from "./index";
import { runtimeCommandStatePortFromStore } from "./structured-session-adapters";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_command_state_port",
  cwd: "/tmp/svvy-runtime-command-state-port",
  label: "Runtime command state port",
};

describe("RuntimeCommandStatePort", () => {
  it("exposes command records, command events, and output-event reads through an Effect service", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: "session-runtime-command-state-port",
            title: "Runtime command state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: "session-runtime-command-state-port",
            surfacePiSessionId: "surface-runtime-command-state-port",
            requestSummary: "Run a command.",
          });

          const port = yield* RuntimeCommandStatePort;
          const command = yield* port.createCommand({
            turnId: turn.id,
            surfacePiSessionId: "surface-runtime-command-state-port",
            toolName: "exec_command",
            executor: "orchestrator",
            visibility: "summary",
            title: "Run exec_command",
            summary: "exec_command",
            arguments: { cmd: "bun test" },
            facts: { toolCallId: "tool-call-command-port" },
          });
          const found = yield* port.findCommandByToolCallId({
            toolCallId: "tool-call-command-port",
          });
          const foundById = yield* port.findCommandById({ commandId: command.value.id });
          const running = yield* port.startCommand({ commandId: command.value.id });
          yield* port.recordCommandEvent({
            sessionId: "session-runtime-command-state-port",
            commandId: command.value.id,
            kind: "command.output",
            data: {
              stream: "stdout",
              source: "live-stream",
              text: "ok",
            },
          });
          const hasLiveStdout = yield* port.hasCommandOutputEvent({
            sessionId: "session-runtime-command-state-port",
            commandId: command.value.id,
            stream: "stdout",
            source: "live-stream",
          });
          const hasLiveStderr = yield* port.hasCommandOutputEvent({
            sessionId: "session-runtime-command-state-port",
            commandId: command.value.id,
            stream: "stderr",
            source: "live-stream",
          });
          const stdinWrite = yield* port.recordStdinWrite({
            sessionId: "session-runtime-command-state-port",
            commandId: command.value.id,
            text: "hello\n",
            acceptedBytes: 6,
            at: "2026-04-18T08:55:10.000Z",
          });
          const snapshot = yield* state.getSessionState("session-runtime-command-state-port");
          const finished = yield* port.finishCommand({
            commandId: command.value.id,
            status: "succeeded",
            summary: "ok",
            facts: { toolCallId: "tool-call-command-port", exitCode: 0 },
          });

          expect(command.afterCommit as unknown).toEqual([
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: { model: "commandInspector", ids: [command.value.id] },
            },
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: {
                model: "surface",
                ids: ["surface-runtime-command-state-port"],
              },
            },
          ]);
          expect(found?.id).toBe(command.value.id);
          expect(foundById?.id).toBe(command.value.id);
          expect(running.value.status).toBe("running");
          expect(running.afterCommit as unknown).toEqual(command.afterCommit as unknown);
          expect(hasLiveStdout).toBeTrue();
          expect(hasLiveStderr).toBeFalse();
          expect(stdinWrite.afterCommit as unknown).toEqual([
            {
              scope: "workspace",
              workspaceId: workspace.id,
              invalidation: { model: "commandInspector", ids: [command.value.id] },
            },
          ]);
          expect(
            snapshot.events.find(
              (event) => event.kind === "command.stdin" && event.subject.id === command.value.id,
            ),
          ).toMatchObject({
            at: "2026-04-18T08:55:10.000Z",
            data: {
              text: "hello\n",
              acceptedBytes: 6,
            },
          });
          expect(finished.value).toMatchObject({
            id: command.value.id,
            status: "succeeded",
            summary: "ok",
            facts: { toolCallId: "tool-call-command-port", exitCode: 0 },
            finishedAt: expect.any(String),
          });
          expect(finished.afterCommit as unknown).toEqual(command.afterCommit as unknown);
        }).pipe(
          Effect.provide(
            layerRuntimeCommandStatePort.pipe(
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

  it("maps store failures to typed state errors through the runtime command port", async () => {
    const store = createFailingStore();
    const port: RuntimeCommandStatePortService = runtimeCommandStatePortFromStore(store);

    await expect(
      runTestEffect(
        port.createCommand({
          toolName: "exec_command",
          executor: "orchestrator",
          visibility: "summary",
          title: "Run exec_command",
          summary: "Missing owner.",
        }),
      ),
    ).rejects.toMatchObject({
      operation: "structured-session.createCommand",
    });
    await expect(
      runTestEffect(
        port.createCommand({
          toolName: "exec_command",
          executor: "orchestrator",
          visibility: "summary",
          title: "Run exec_command",
          summary: "Missing owner.",
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
    createCommand: () => {
      throw new Error("command persistence failed");
    },
  } as unknown as StructuredSessionStateStore;
}
