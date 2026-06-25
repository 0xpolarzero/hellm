import { describe, expect, it } from "bun:test";
import {
  type CommandId,
  type PromptExecutionContext,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { runTestEffect } from "./effect.test-support";
import { loadExtensionHandler } from "./load-extension-handler";

const context = {
  workspaceSessionId: "wsess_load_extension_handler_01" as WorkspaceSessionId,
  turnId: "turn_load_extension_handler_01" as TurnId,
  surfacePiSessionId: "pi_load_extension_handler_01" as SurfacePiSessionId,
  surfaceKind: "orchestrator",
  defaultEpisodeKind: "analysis",
  rootThreadId: null,
  rootEpisodeKind: "analysis",
  sessionWaitApplied: false,
  threadWasTerminalAtStart: false,
  loadedExtensionIds: ["shell"],
  availableExtensionIds: ["smithers"],
  generatedAgentContextFingerprint: "fingerprint",
  generatedAgentContextRevision: "revision",
} satisfies PromptExecutionContext;

function invocation(extensionId: string) {
  return {
    toolCallId: "tool_call_load_extension_handler_01" as ToolCallId,
    toolName: "load_extension" as const,
    arguments: {
      schemaId: "load_extension.input" as const,
      value: {
        extensionId,
      },
    },
    context,
    actorBinding: {
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["smithers"],
    },
    command: {
      commandId: "command_load_extension_handler_01" as CommandId,
      target: {
        workspaceSessionId: context.workspaceSessionId,
        surface: "orchestrator" as const,
        surfacePiSessionId: context.surfacePiSessionId,
      },
      turnId: context.turnId,
      approvalMode: "auto-review" as const,
      sandbox: { snapshot: {} },
      cwd: "/tmp/svvy-load-extension-handler",
      baseEnv: {},
    },
  };
}

describe("load_extension handler", () => {
  it("returns model-facing success details and one actor binding runtime effect", async () => {
    const result = await runTestEffect(loadExtensionHandler.invoke(invocation(" smithers ")));

    expect(result.result.content).toEqual([{ type: "text", text: "Loaded extension `smithers`." }]);
    expect(result.result.details).toEqual({
      status: "succeeded",
      summary: "Loaded extension smithers for the current actor.",
      commandFacts: {
        type: "load_extension.finished",
        status: "succeeded",
        commandId: "command_load_extension_handler_01",
        turnId: "turn_load_extension_handler_01",
        extensionId: "smithers",
        usage: "loaded",
      },
    });
    expect(result.operations as unknown).toEqual([
      {
        kind: "runtime_effect",
        request: {
          type: "actor_extension_binding.update",
          input: {
            target: {
              workspaceSessionId: "wsess_load_extension_handler_01",
              surface: "orchestrator",
              surfacePiSessionId: "pi_load_extension_handler_01",
            },
            extensionId: "smithers",
            usage: "loaded",
            reason: "load_extension",
            sourceCommandId: "command_load_extension_handler_01",
          },
        },
      },
    ]);
    expect(result.result.details).not.toHaveProperty("refreshedContext");
    expect(result.result.details).not.toHaveProperty("systemPrompt");
    expect(result.result.details).not.toHaveProperty("executeTypescriptDeclaration");
  });

  it("rejects unknown, unavailable, and not-ready extensions", async () => {
    await expect(runTestEffect(loadExtensionHandler.invoke(invocation("missing")))).rejects.toThrow(
      "Unknown extension: missing",
    );
    await expect(
      runTestEffect(loadExtensionHandler.invoke(invocation("request-user-input"))),
    ).rejects.toThrow("Extension is not available to load for this actor: request-user-input");
    await expect(
      runTestEffect(
        loadExtensionHandler.invoke({
          ...invocation("linear"),
          actorBinding: {
            loadedExtensionIds: ["shell"],
            availableExtensionIds: ["linear"],
            availableExtensionRecords: [
              {
                id: "linear",
                title: "Linear",
                description: "Linear integration.",
                category: "user",
                interface: "svvyx",
                instructionSourceFiles: [],
                minimalLoadingHint: "Load Linear.",
                typescriptApiEnabled: false,
                resetBehavior: "user_reset",
                deleteBehavior: "trash_allowed",
                envReadiness: "missing",
                dependencyReadiness: "not_required",
              },
            ],
          },
        }),
      ),
    ).rejects.toThrow("Extension is not ready to load for this actor: linear");
  });
});
