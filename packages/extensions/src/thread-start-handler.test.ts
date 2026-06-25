import { describe, expect, it } from "bun:test";
import {
  type CommandId,
  type PromptExecutionContext,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ToolCallId,
  type TurnId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { runTestEffect } from "./effect.test-support";
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
  it("returns an accepted-result acknowledgement and one atomic handler_thread.start effect", async () => {
    const result = await runTestEffect(
      threadStartHandler.invoke(
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
      ),
    );

    expect(result.result).toEqual({
      content: [
        {
          type: "text",
          text: "Accepted 2 handler thread start requests.",
        },
      ],
      details: {
        status: "succeeded",
        summary: "Accepted 2 handler thread start requests.",
        commandFacts: {
          accepted: true,
          requestedThreadCount: 2,
          historyModes: ["forked", "isolated"],
        },
      },
    });
    expect(result.operations).toEqual([
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
  });

  it("rejects empty objectives after trimming", async () => {
    await expect(
      runTestEffect(
        threadStartHandler.invoke(
          invocation({
            value: {
              threads: [
                {
                  objective: "   ",
                },
              ],
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "ExtensionError",
      reason: "invalid-input",
    });
  });

  it("rejects handler and workflow targets because only orchestrators can delegate", async () => {
    await expect(
      runTestEffect(
        threadStartHandler.invoke(
          invocation({
            surfaceKind: "handler",
            value: {
              threads: [{ objective: "Nested delegation should fail." }],
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "ExtensionError",
      reason: "invalid-input",
      message: "thread_start is only available on orchestrator surfaces.",
    });

    await expect(
      runTestEffect(
        threadStartHandler.invoke(
          invocation({
            surfaceKind: "workflow-task",
            value: {
              threads: [{ objective: "Workflow task delegation should fail." }],
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "ExtensionError",
      reason: "invalid-input",
      message: "thread_start is only available on orchestrator surfaces.",
    });
  });
});
