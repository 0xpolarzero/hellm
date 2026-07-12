import { assert, describe, it } from "@effect/vitest";
import {
  type CommandId,
  type PromptExecutionContext,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
  type WorkspaceSessionId,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import { requestUserInputHandler } from "./request-user-input-handler";

const context = {
  workspaceSessionId: "wsess_request_input_handler_01" as WorkspaceSessionId,
  turnId: "turn_request_input_handler_01" as TurnId,
  surfacePiSessionId: "pi_request_input_handler_01" as SurfacePiSessionId,
  surfaceKind: "orchestrator",
  defaultEpisodeKind: "analysis",
  rootThreadId: null,
  rootEpisodeKind: "analysis",
  sessionWaitApplied: false,
  threadWasTerminalAtStart: false,
  loadedExtensionIds: ["request-user-input"],
  availableExtensionIds: ["request-user-input"],
  generatedAgentContextFingerprint: "fingerprint",
  generatedAgentContextRevision: "revision",
} satisfies PromptExecutionContext;

describe("request_user_input handler", () => {
  it.effect("returns default model-facing answers and a runtime effect request", () =>
    Effect.gen(function* () {
      const result = yield* requestUserInputHandler.invoke({
        toolCallId: "tool_call_request_input_handler_01" as ToolCallId,
        toolName: "request_user_input",
        arguments: {
          schemaId: "request_user_input.input",
          value: {
            questions: [
              {
                title: " CI scope ",
                question: " Should CI run unit checks or the full suite? ",
                options: [
                  {
                    label: " Unit checks only ",
                    description: " Faster. ",
                    recommended: true,
                  },
                  {
                    label: " Full suite ",
                    description: " Slower. ",
                  },
                ],
              },
              {
                title: " Release note ",
                question: " What tone should I use? ",
                defaultAnswer: " Concise engineering summary. ",
              },
            ],
          },
        },
        context,
        actorBinding: {
          loadedExtensionIds: ["request-user-input"],
          availableExtensionIds: ["request-user-input"],
        },
        command: {
          commandId: "command_request_input_handler_01" as CommandId,
          target: {
            workspaceSessionId: context.workspaceSessionId,
            surface: "orchestrator",
            surfacePiSessionId: context.surfacePiSessionId,
          },
          turnId: context.turnId,
          approvalMode: "auto-review",
          sandbox: { snapshot: {} },
          cwd: "/tmp/svvy-request-input-handler",
          baseEnv: {},
        },
      });

      const firstContent = result.result.content?.[0] as { type: "text"; text: string };
      const modelResult = JSON.parse(firstContent.text);

      assert.deepStrictEqual(modelResult, {
        answers: [
          {
            title: "CI scope",
            question: "Should CI run unit checks or the full suite?",
            answer: {
              kind: "option",
              label: "Unit checks only",
              text: "Unit checks only",
            },
            answeredBy: "default",
          },
          {
            title: "Release note",
            question: "What tone should I use?",
            answer: {
              kind: "custom",
              text: "Concise engineering summary.",
            },
            answeredBy: "default",
          },
        ],
      });
      assert.strictEqual(result.result.details?.status, "succeeded");
      const commandFacts = result.result.details?.commandFacts as {
        questionCount?: number;
        answeredBy?: string;
      };
      assert.deepStrictEqual(
        {
          questionCount: commandFacts.questionCount,
          answeredBy: commandFacts.answeredBy,
        },
        {
          questionCount: 2,
          answeredBy: "default",
        },
      );
      assert.deepStrictEqual(result.operations, [
        {
          kind: "runtime_effect",
          request: {
            type: "request_input.create",
            input: {
              target: {
                workspaceSessionId: context.workspaceSessionId,
                surface: "orchestrator",
                surfacePiSessionId: context.surfacePiSessionId,
              },
              sourceCommandId: "command_request_input_handler_01" as CommandId,
              questions: [
                {
                  title: "CI scope",
                  question: "Should CI run unit checks or the full suite?",
                  options: [
                    {
                      label: "Unit checks only",
                      description: "Faster.",
                      recommended: true,
                    },
                    {
                      label: "Full suite",
                      description: "Slower.",
                    },
                  ],
                },
                {
                  title: "Release note",
                  question: "What tone should I use?",
                  defaultAnswer: "Concise engineering summary.",
                },
              ],
            },
          },
        },
      ]);
    }),
  );

  it.effect("rejects workflow targets because runtime request input is prompt-surface scoped", () =>
    Effect.gen(function* () {
      const error = yield* requestUserInputHandler
        .invoke({
          toolCallId: "tool_call_request_input_handler_02" as ToolCallId,
          toolName: "request_user_input",
          arguments: {
            schemaId: "request_user_input.input",
            value: {
              questions: [
                {
                  title: "Scope",
                  question: "What should happen?",
                  defaultAnswer: "Keep the current behavior.",
                },
              ],
            },
          },
          context: {
            ...context,
            surfaceKind: "workflow-task",
          },
          actorBinding: {
            loadedExtensionIds: ["request-user-input"],
            availableExtensionIds: ["request-user-input"],
          },
          command: {
            commandId: "command_request_input_handler_02" as CommandId,
            target: {
              workspaceSessionId: context.workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: context.surfacePiSessionId,
            },
            turnId: context.turnId,
            approvalMode: "auto-review",
            sandbox: { snapshot: {} },
            cwd: "/tmp/svvy-request-input-handler",
            baseEnv: {},
          },
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        {
          _tag: error._tag,
          extensionId: error.extensionId,
          operation: error.operation,
          reason: error.reason,
          message: error.message,
        },
        {
          _tag: "ExtensionError",
          extensionId: "request-user-input",
          operation: "extensions.native-tools.request-user-input.invoke",
          reason: "invalid-input",
          message: "request_user_input is only available on orchestrator and handler surfaces.",
        },
      );
    }),
  );
});
