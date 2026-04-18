import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { StructuredSessionStateStore, StructuredThreadRecord } from "./structured-session-state";

export const START_THREAD_TOOL_NAME = "thread.start";

export const startThreadParamsSchema = Type.Object(
  {
    objective: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type StartThreadParams = Static<typeof startThreadParamsSchema>;

const START_THREAD_DESCRIPTION = [
  "Open a delegated handler thread for a bounded objective.",
  "Use this from the orchestrator when the work should continue inside its own handler-thread surface.",
].join(" ");

export interface ThreadStartBridge {
  createHandlerThread(input: {
    sessionId: string;
    turnId: string;
    parentThreadId: string;
    parentSurfacePiSessionId: string;
    title: string;
    objective: string;
  }): Promise<StructuredThreadRecord>;
}

export function createStartThreadTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  bridge: ThreadStartBridge;
}): AgentTool<typeof startThreadParamsSchema, Record<string, unknown>> {
  return {
    label: "Thread",
    name: START_THREAD_TOOL_NAME,
    description: START_THREAD_DESCRIPTION,
    parameters: startThreadParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${START_THREAD_TOOL_NAME} can only run during an active prompt.`);
      }

      const objective = params.objective.trim();
      const title = params.title?.trim() || objective;
      const command = options.store.createCommand({
        turnId: runtime.turnId,
        surfacePiSessionId: runtime.surfacePiSessionId,
        threadId: runtime.rootThreadId,
        toolName: START_THREAD_TOOL_NAME,
        executor: runtime.surfaceKind === "handler" ? "handler" : "orchestrator",
        visibility: "surface",
        title: `Start handler thread: ${title}`,
        summary: objective,
      });
      options.store.startCommand(command.id);

      try {
        const thread = await options.bridge.createHandlerThread({
          sessionId: runtime.sessionId,
          turnId: runtime.turnId,
          parentThreadId: runtime.rootThreadId,
          parentSurfacePiSessionId: runtime.surfacePiSessionId ?? runtime.sessionId,
          title,
          objective,
        });

        options.store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary: `Opened handler thread ${thread.id} for ${title}.`,
          facts: {
            threadId: thread.id,
            surfacePiSessionId: thread.surfacePiSessionId ?? null,
            objective: thread.objective,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                threadId: thread.id,
                surfacePiSessionId: thread.surfacePiSessionId ?? null,
                title: thread.title,
                objective: thread.objective,
              }),
            },
          ],
          details: {
            ok: true,
            threadId: thread.id,
            surfacePiSessionId: thread.surfacePiSessionId ?? null,
            title: thread.title,
            objective: thread.objective,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create delegated handler thread.";
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
