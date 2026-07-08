import { assert, describe, it } from "@effect/vitest";
import {
  type CommandId,
  type PromptExecutionContext,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ToolCallId,
  type TurnId,
  type WorkspaceSessionId,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import { threadStartHandler, type ThreadStartHandlerInvocation } from "./thread-start-handler";

const context = {
  workspaceSessionId: "wsess_thread_start_handler_01" as WorkspaceSessionId,
  turnId: "turn_thread_start_handler_01" as TurnId,
  surfacePiSessionId: "pi_thread_start_handler_01" as SurfacePiSessionId,
  surfaceKind: "orchestrator",
  defaultEpisodeKind: "analysis",
  rootThreadId: null,
  rootEpisodeKind: "analysis",
  sessionWaitApplied: false,
  threadWasTerminalAtStart: false,
  loadedExtensionIds: ["thread-orchestration"],
  availableExtensionIds: ["thread-orchestration"],
  generatedAgentContextFingerprint: "fingerprint",
  generatedAgentContextRevision: "revision",
} satisfies PromptExecutionContext;

function invocation(overrides: {
  value: unknown;
  surfaceKind?: PromptExecutionContext["surfaceKind"];
}): ThreadStartHandlerInvocation {
  return {
    toolCallId: "tool_call_thread_start_handler_01" as ToolCallId,
    toolName: "thread_start",
    arguments: {
      schemaId: "thread_start.input" as const,
      value: overrides.value,
    },
    context: {
      ...context,
      surfaceKind: overrides.surfaceKind ?? context.surfaceKind,
    },
    actorBinding: {
      loadedExtensionIds: ["thread-orchestration"],
      availableExtensionIds: ["thread-orchestration"],
    },
    command: {
      commandId: "command_thread_start_handler_01" as CommandId,
      target: {
        workspaceSessionId: context.workspaceSessionId,
        surface: "orchestrator" as const,
        surfacePiSessionId: context.surfacePiSessionId,
      },
      turnId: context.turnId,
      approvalMode: "auto-review" as const,
      sandbox: { snapshot: {} },
      cwd: "/tmp/svvy-thread-start-handler",
      baseEnv: {},
    },
  } as ThreadStartHandlerInvocation;
}

describe("thread_start handler", () => {
  it.effect(
    "returns an accepted-result acknowledgement and one atomic handler_thread.start effect",
    () =>
      Effect.gen(function* () {
        const result = yield* threadStartHandler.invoke(
          invocation({
            value: {
              threadGroupId: " group_existing_01 ",
              threads: [
                {
                  objective: " Inspect the failing queue delivery test. ",
                  overrides: {
                    " github ": "available",
                    " workflows ": "loaded",
                  },
                },
                {
                  objective: " Review the runtime source invalidation plan. ",
                  history: "forked",
                },
              ],
            },
          }),
        );

        assert.deepStrictEqual(result.result, {
          content: [
            {
              type: "text",
              text: "Accepted 2 handler thread start requests.",
            },
          ],
          details: {
            status: "succeeded",
            summary: "Accepted 2 handler thread start requests.",
          },
        });
        assert.deepStrictEqual(result.operations, [
          {
            kind: "runtime_effect",
            request: {
              type: "handler_thread.start",
              input: {
                workspaceSessionId: context.workspaceSessionId,
                threadGroupId: "group_existing_01" as ThreadGroupId,
                sourceCommandId: "command_thread_start_handler_01" as CommandId,
                threads: [
                  {
                    objective: "Inspect the failing queue delivery test.",
                    history: "isolated",
                    overrides: {
                      github: "available",
                      workflows: "loaded",
                    },
                  },
                  {
                    objective: "Review the runtime source invalidation plan.",
                    history: "forked",
                  },
                ],
              },
            },
          },
        ]);
      }),
  );

  it.effect("rejects empty objectives after trimming", () =>
    Effect.gen(function* () {
      const error = yield* threadStartHandler
        .invoke(
          invocation({
            value: {
              threads: [
                {
                  objective: "   ",
                },
              ],
            },
          }),
        )
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        {
          _tag: error._tag,
          extensionId: error.extensionId,
          operation: error.operation,
          reason: error.reason,
        },
        {
          _tag: "ExtensionError",
          extensionId: "thread-orchestration",
          operation: "extensions.native-tools.thread-start.invoke",
          reason: "invalid-input",
        },
      );
      assert.match(error.message, /\["threads"\]\[0\]\["objective"\]/);
    }),
  );

  it.effect("rejects handler and workflow targets because only orchestrators can delegate", () =>
    Effect.gen(function* () {
      const handlerError = yield* threadStartHandler
        .invoke(
          invocation({
            surfaceKind: "handler",
            value: {
              threads: [{ objective: "Nested delegation should fail." }],
            },
          }),
        )
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        {
          _tag: handlerError._tag,
          extensionId: handlerError.extensionId,
          operation: handlerError.operation,
          reason: handlerError.reason,
          message: handlerError.message,
        },
        {
          _tag: "ExtensionError",
          extensionId: "thread-orchestration",
          operation: "extensions.native-tools.thread-start.invoke",
          reason: "invalid-input",
          message: "thread_start is only available on orchestrator surfaces.",
        },
      );

      const workflowError = yield* threadStartHandler
        .invoke(
          invocation({
            surfaceKind: "workflow-task",
            value: {
              threads: [{ objective: "Workflow task delegation should fail." }],
            },
          }),
        )
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        {
          _tag: workflowError._tag,
          extensionId: workflowError.extensionId,
          operation: workflowError.operation,
          reason: workflowError.reason,
          message: workflowError.message,
        },
        {
          _tag: "ExtensionError",
          extensionId: "thread-orchestration",
          operation: "extensions.native-tools.thread-start.invoke",
          reason: "invalid-input",
          message: "thread_start is only available on orchestrator surfaces.",
        },
      );
    }),
  );
});
