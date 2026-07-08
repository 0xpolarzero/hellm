import * as Effect from "effect/Effect";
import {
  ExtensionError as CoreExtensionError,
  type ExtensionError,
  type ExtensionHandlerResult,
  type ExtensionId,
  type PromptTarget,
} from "@svvy/core";
import { getExtensionRecord } from "./extension-records";
import type { ActorExtensionBinding } from "./extensions-service";
import type { ExtensionHandler, ExtensionInvocation } from "./native-tool-handler-contracts";
import type { ExtensionRecord } from "./extension-records";

export type LoadExtensionInput = {
  extensionId: string;
};

export type LoadExtensionHandlerInvocation = ExtensionInvocation & {
  toolName: "load_extension";
  arguments: {
    schemaId: "load_extension.input";
    value: LoadExtensionInput;
  };
  actorBinding: ActorExtensionBinding & {
    loadedExtensionRecords?: readonly ExtensionRecord[];
    availableExtensionRecords?: readonly ExtensionRecord[];
  };
};

function loadExtensionError(
  reason: ExtensionError["reason"],
  message: string,
  cause?: unknown,
): ExtensionError {
  return new CoreExtensionError({
    extensionId: "extension-loading",
    operation: "extensions.native-tools.load-extension.invoke",
    reason,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function promptTargetFromInvocation(
  input: LoadExtensionHandlerInvocation,
): Effect.Effect<PromptTarget, ExtensionError> {
  const context = input.context;
  if (context.surfaceKind === "orchestrator") {
    return Effect.succeed({
      workspaceSessionId: context.workspaceSessionId as PromptTarget["workspaceSessionId"],
      surface: "orchestrator",
      surfacePiSessionId: context.surfacePiSessionId as PromptTarget["surfacePiSessionId"],
    });
  }
  if (context.surfaceKind === "handler") {
    const threadId = context.rootThreadId ?? context.threadId;
    if (!threadId) {
      return Effect.fail(
        loadExtensionError(
          "invalid-input",
          "load_extension handler invocations require a handler thread id.",
        ),
      );
    }
    return Effect.succeed({
      workspaceSessionId: context.workspaceSessionId as PromptTarget["workspaceSessionId"],
      surface: "handler",
      surfacePiSessionId: context.surfacePiSessionId as PromptTarget["surfacePiSessionId"],
      threadId: threadId as Extract<PromptTarget, { surface: "handler" }>["threadId"],
    });
  }
  return Effect.fail(
    loadExtensionError(
      "invalid-input",
      "load_extension is only available on orchestrator and handler surfaces.",
    ),
  );
}

function extensionIsReady(record: ExtensionRecord): boolean {
  return (
    (record.envReadiness === "ready" || record.envReadiness === "not_required") &&
    (record.dependencyReadiness === "ready" || record.dependencyReadiness === "not_required")
  );
}

function extensionRecordForInvocation(
  input: LoadExtensionHandlerInvocation,
  extensionId: string,
): ExtensionRecord | null {
  return (
    input.actorBinding.availableExtensionRecords?.find((record) => record.id === extensionId) ??
    input.actorBinding.loadedExtensionRecords?.find((record) => record.id === extensionId) ??
    getExtensionRecord(extensionId) ??
    null
  );
}

export function createLoadExtensionHandler(): ExtensionHandler<LoadExtensionHandlerInvocation> {
  return {
    invoke: (input) =>
      Effect.gen(function* () {
        const extensionId = input.arguments.value.extensionId.trim();
        if (!extensionId) {
          return yield* Effect.fail(
            loadExtensionError("invalid-input", "load_extension requires extensionId."),
          );
        }
        const record = extensionRecordForInvocation(input, extensionId);
        if (!record) {
          return yield* Effect.fail(
            loadExtensionError("not-found", `Unknown extension: ${extensionId}`),
          );
        }
        if (!input.actorBinding.availableExtensionIds.includes(extensionId)) {
          return yield* Effect.fail(
            loadExtensionError(
              "not-loaded",
              `Extension is not available to load for this actor: ${extensionId}`,
            ),
          );
        }
        if (!extensionIsReady(record)) {
          return yield* Effect.fail(
            loadExtensionError(
              "dependency-not-ready",
              `Extension is not ready to load for this actor: ${extensionId}`,
            ),
          );
        }
        const target = yield* promptTargetFromInvocation(input);
        const summary = `Loaded extension ${extensionId} for the current actor.`;
        return {
          result: {
            content: [{ type: "text", text: `Loaded extension \`${extensionId}\`.` }],
            details: {
              status: "succeeded",
              summary,
              commandFacts: {
                type: "load_extension.finished",
                status: "succeeded",
                commandId: input.command.commandId,
                turnId: input.command.turnId,
                extensionId,
                usage: "loaded",
              },
            },
          },
          operations: [
            {
              kind: "runtime_effect",
              request: {
                type: "actor_extension_binding.update",
                input: {
                  target,
                  extensionId: extensionId as ExtensionId,
                  usage: "loaded",
                  reason: "load_extension",
                  sourceCommandId: input.command.commandId,
                },
              },
            },
          ],
        } satisfies ExtensionHandlerResult;
      }),
  };
}

export const loadExtensionHandler = createLoadExtensionHandler();
