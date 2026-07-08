import * as Effect from "effect/Effect";
import {
  ExtensionError as CoreExtensionError,
  type ExtensionError,
  type ExtensionHandlerResult,
  type ThreadGroupId,
  type StartHandlerThreadItem,
  type WorkspaceSessionId,
} from "@svvy/core";
import { decodeThreadStartInputEffect, type ThreadStartInput } from "./thread-start-contracts";
import type { ExtensionHandler, ExtensionInvocation } from "./native-tool-handler-contracts";

export type ThreadStartHandlerInvocation = ExtensionInvocation & {
  arguments: {
    schemaId: "thread_start.input";
    value: ThreadStartInput;
  };
};

function normalizeOverrides(
  overrides: ThreadStartInput["threads"][number]["overrides"],
): ThreadStartInput["threads"][number]["overrides"] {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(overrides).map(([extensionId, state]) => [extensionId.trim(), state]),
  );
}

function normalizeInput(input: unknown): Effect.Effect<ThreadStartInput, unknown, never> {
  return Effect.gen(function* () {
    const decoded = yield* decodeThreadStartInputEffect(input);
    const threadGroupId = decoded.threadGroupId?.trim();
    return yield* decodeThreadStartInputEffect({
      ...(threadGroupId ? { threadGroupId } : {}),
      threads: decoded.threads.map((thread) => {
        const objective = thread.objective.trim();
        return {
          objective,
          history: thread.history ?? "isolated",
          ...(thread.overrides ? { overrides: normalizeOverrides(thread.overrides) } : {}),
        };
      }),
    });
  });
}

function requestThreadsFromInput(input: ThreadStartInput): StartHandlerThreadItem[] {
  return input.threads.map((thread) => ({
    objective: thread.objective,
    history: thread.history ?? "isolated",
    ...(thread.overrides ? { overrides: thread.overrides } : {}),
  }));
}

function resultSummary(input: ThreadStartInput): string {
  return input.threads.length === 1
    ? "Accepted 1 handler thread start request."
    : `Accepted ${input.threads.length} handler thread start requests.`;
}

function threadStartError(message: string, cause?: unknown): ExtensionError {
  return new CoreExtensionError({
    extensionId: "thread-orchestration",
    operation: "extensions.native-tools.thread-start.invoke",
    reason: "invalid-input",
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function createThreadStartHandler(): ExtensionHandler<ThreadStartHandlerInvocation> {
  return {
    invoke: (input) =>
      Effect.gen(function* () {
        if (input.context.surfaceKind !== "orchestrator") {
          return yield* Effect.fail(
            threadStartError("thread_start is only available on orchestrator surfaces."),
          );
        }

        const normalized = yield* normalizeInput(input.arguments.value).pipe(
          Effect.mapError((cause) =>
            threadStartError(cause instanceof Error ? cause.message : String(cause), cause),
          ),
        );
        const summary = resultSummary(normalized);
        return {
          result: {
            content: [
              {
                type: "text",
                text: summary,
              },
            ],
            details: {
              status: "succeeded",
              summary,
            },
          },
          operations: [
            {
              kind: "runtime_effect",
              request: {
                type: "handler_thread.start",
                input: {
                  workspaceSessionId: input.context.workspaceSessionId as WorkspaceSessionId,
                  ...(normalized.threadGroupId
                    ? { threadGroupId: normalized.threadGroupId as ThreadGroupId }
                    : {}),
                  sourceCommandId: input.command.commandId,
                  threads: requestThreadsFromInput(normalized),
                },
              },
            },
          ],
        } satisfies ExtensionHandlerResult;
      }),
  };
}

export const threadStartHandler = createThreadStartHandler();
