import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import { getHandlerContextPack, validateHandlerContextKeys } from "./handler-context-packs";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { StructuredSessionStateStore } from "./structured-session-state";

export const REQUEST_CONTEXT_TOOL_NAME = "request_context";

const contextKeySchema = Type.Literal("ci");

export const requestContextParamsSchema = Type.Object(
  {
    keys: Type.Array(contextKeySchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type RequestContextParams = Static<typeof requestContextParamsSchema>;

const REQUEST_CONTEXT_DESCRIPTION = [
  "Load optional typed product context into the current handler thread for future turns.",
  "Use this before configuring or modifying specialized product lanes such as Project CI.",
  "This is a top-level handler tool, not part of execute_typescript.",
].join(" ");

export function createRequestContextTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof requestContextParamsSchema, Record<string, unknown>> {
  return {
    label: "Request Context",
    name: REQUEST_CONTEXT_TOOL_NAME,
    description: REQUEST_CONTEXT_DESCRIPTION,
    parameters: requestContextParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${REQUEST_CONTEXT_TOOL_NAME} can only run during an active prompt.`);
      }
      if (runtime.surfaceKind !== "handler" || !runtime.surfaceThreadId) {
        throw new Error(`${REQUEST_CONTEXT_TOOL_NAME} can only run from a handler thread surface.`);
      }

      const keys = validateHandlerContextKeys(params.keys);
      options.store.setTurnDecision({
        turnId: runtime.turnId,
        decision: REQUEST_CONTEXT_TOOL_NAME,
        onlyIfPending: true,
      });

      const command = options.store.createCommand({
        turnId: runtime.turnId,
        surfacePiSessionId: runtime.surfacePiSessionId,
        threadId: runtime.surfaceThreadId,
        toolName: REQUEST_CONTEXT_TOOL_NAME,
        executor: "handler",
        visibility: "surface",
        title: `Load handler context: ${keys.join(", ")}`,
        summary: `Load optional handler context pack(s): ${keys.join(", ")}.`,
      });
      options.store.startCommand(command.id);

      try {
        const loaded = keys.map((key) => {
          const pack = getHandlerContextPack(key);
          return options.store.loadThreadContext({
            threadId: runtime.surfaceThreadId!,
            contextKey: pack.key,
            contextVersion: pack.version,
            loadedByCommandId: command.id,
          });
        });

        options.store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary: `Loaded handler context: ${loaded.map((entry) => entry.contextKey).join(", ")}.`,
          facts: {
            contextKeys: loaded.map((entry) => entry.contextKey),
            versions: Object.fromEntries(
              loaded.map((entry) => [entry.contextKey, entry.contextVersion]),
            ),
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                loadedContextKeys: loaded.map((entry) => entry.contextKey),
              }),
            },
          ],
          details: {
            ok: true,
            loadedContextKeys: loaded.map((entry) => entry.contextKey),
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load handler context.";
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: message,
          error: message,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                commandId: command.id,
                error: message,
              }),
            },
          ],
          details: {
            ok: false,
            commandId: command.id,
            error: message,
          },
        };
      }
    },
  };
}
