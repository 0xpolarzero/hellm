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
  it.effect("returns model-facing success details and one actor binding runtime effect", () =>
    Effect.gen(function* () {
      const result = yield* loadExtensionHandler.invoke(invocation(" smithers "));

      assert.deepStrictEqual(result.result.content, [
        { type: "text", text: "Loaded extension `smithers`." },
      ]);
      assert.deepStrictEqual(result.result.details, {
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
      assert.deepStrictEqual(result.operations as unknown, [
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
      const details = result.result.details;
      assert.ok(details);
      assert.strictEqual("refreshedContext" in details, false);
      assert.strictEqual("systemPrompt" in details, false);
      assert.strictEqual("executeTypescriptDeclaration" in details, false);
    }),
  );

  it.effect("rejects unknown, unavailable, and not-ready extensions", () =>
    Effect.gen(function* () {
      const missing = yield* loadExtensionHandler.invoke(invocation("missing")).pipe(Effect.flip);
      assert.deepStrictEqual(
        {
          _tag: missing._tag,
          extensionId: missing.extensionId,
          operation: missing.operation,
          reason: missing.reason,
          message: missing.message,
        },
        {
          _tag: "ExtensionError",
          extensionId: "extension-loading",
          operation: "extensions.native-tools.load-extension.invoke",
          reason: "not-found",
          message: "Unknown extension: missing",
        },
      );

      const unavailable = yield* loadExtensionHandler
        .invoke(invocation("request-user-input"))
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        {
          _tag: unavailable._tag,
          extensionId: unavailable.extensionId,
          operation: unavailable.operation,
          reason: unavailable.reason,
          message: unavailable.message,
        },
        {
          _tag: "ExtensionError",
          extensionId: "extension-loading",
          operation: "extensions.native-tools.load-extension.invoke",
          reason: "not-loaded",
          message: "Extension is not available to load for this actor: request-user-input",
        },
      );

      const notReady = yield* loadExtensionHandler
        .invoke({
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
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        {
          _tag: notReady._tag,
          extensionId: notReady.extensionId,
          operation: notReady.operation,
          reason: notReady.reason,
          message: notReady.message,
        },
        {
          _tag: "ExtensionError",
          extensionId: "extension-loading",
          operation: "extensions.native-tools.load-extension.invoke",
          reason: "dependency-not-ready",
          message: "Extension is not ready to load for this actor: linear",
        },
      );
    }),
  );
});
