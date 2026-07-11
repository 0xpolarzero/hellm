import type { NativeToolDefinition } from "@svvy/extensions";
import { Type, type Static } from "typebox";
import type { AppLoggerEvent } from "./app-logger";
import { nativeToolParameters } from "./native-tool-parameters";
import type { PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import type {
  CommandFactsPayload,
  RuntimeCommandStatePortService,
  RuntimeTurnStatePortService,
  StateContractError,
} from "@svvy/core";
import type * as Effect from "effect/Effect";

export const START_THREAD_TOOL_NAME = "thread_start";

const extensionUsageStateSchema = Type.Union([
  Type.Literal("loaded"),
  Type.Literal("available"),
  Type.Literal("unavailable"),
]);

const threadHistorySchema = Type.Union([Type.Literal("isolated"), Type.Literal("forked")], {
  description:
    "Defaults to isolated. Use forked only when explicit conversational continuity is requested or materially necessary; do not use forked for ordinary implementation, research, tests, review, verification, or tasks already specified by durable files.",
});

const threadStartItemSchema = Type.Object(
  {
    objective: Type.String({
      minLength: 1,
      description:
        "Compact task packet with goal, acceptance criteria, durable paths, accepted decisions, constraints, expected output, and what not to do.",
    }),
    history: Type.Optional(threadHistorySchema),
    overrides: Type.Optional(Type.Record(Type.String({ minLength: 1 }), extensionUsageStateSchema)),
  },
  { additionalProperties: false },
);

export const startThreadParamsSchema = Type.Object(
  {
    threadGroupId: Type.Optional(Type.String({ minLength: 1 })),
    threads: Type.Array(threadStartItemSchema, {
      minItems: 1,
      description:
        "Required and normally one item. Use multiple items only for separate user-visible handler conversations that should share one durable thread group and may need independent direct follow-up; do not use multiple items for ordinary internal parallelism.",
    }),
  },
  { additionalProperties: false },
);

export type StartThreadParams = Static<typeof startThreadParamsSchema>;
export type ThreadHistoryMode = "isolated" | "forked";

const START_THREAD_DESCRIPTION = [
  "Open a delegated handler thread for a bounded objective.",
  "Use this from the orchestrator when the work should continue inside its own handler-thread surface.",
  "Normally pass one threads[] item; pass multiple items only for separate user-visible handler conversations with independent follow-up needs.",
].join(" ");

export interface ThreadStartBridge {
  createHandlerThread(input: {
    sessionId: string;
    turnId: string;
    parentThreadId: string | null;
    parentSurfacePiSessionId: string;
    threadGroupId: string | null;
    objective: string;
    historyMode: ThreadHistoryMode;
    overrides: Record<string, "loaded" | "available" | "unavailable"> | null;
    loadedByCommandId: string;
  }): Promise<{
    id: string;
    threadGroupId: string;
    surfacePiSessionId: string;
    objective: string;
    objectiveState: "active" | "concluded";
  }>;
}

export function createStartThreadTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  commandState: RuntimeCommandStatePortService;
  turnState: RuntimeTurnStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  bridge: ThreadStartBridge;
  onAppLog?: (event: AppLoggerEvent) => void;
}): NativeToolDefinition<StartThreadParams> {
  return {
    label: "Thread",
    name: START_THREAD_TOOL_NAME,
    description: START_THREAD_DESCRIPTION,
    parameters: nativeToolParameters(startThreadParamsSchema),
    execute: async (_toolCallId, params) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${START_THREAD_TOOL_NAME} can only run during an active prompt.`);
      }

      options.runState(
        options.turnState.setTurnDecision({
          turnId: runtime.turnId!,
          decision: "thread_start",
          onlyIfPending: true,
        }),
      );

      const requestedThreads = params.threads.map((thread) => ({
        objective: thread.objective.trim(),
        historyMode: thread.history ?? "isolated",
        overrides: thread.overrides ?? null,
      }));
      const emptyObjective = requestedThreads.find((thread) => !thread.objective);
      let threadGroupId = params.threadGroupId?.trim() || null;
      const summary = requestedThreads.map((thread) => thread.objective).join("; ");
      const command = options.runState(
        options.commandState.createOrReuseStreamingCommand({
          toolCallId: _toolCallId,
          turnId: runtime.turnId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId: runtime.rootThreadId ?? null,
          toolName: START_THREAD_TOOL_NAME,
          executor: runtime.surfaceKind === "handler" ? "handler" : "orchestrator",
          visibility: "surface",
          title:
            requestedThreads.length === 1
              ? `Start handler thread: ${requestedThreads[0]!.objective}`
              : `Start ${requestedThreads.length} handler threads`,
          summary,
          arguments: {
            ...(threadGroupId ? { threadGroupId } : {}),
            threads: requestedThreads,
          },
        }),
      ).value;
      options.runState(options.commandState.startCommand({ commandId: command.id }));
      if (emptyObjective) {
        const message = `${START_THREAD_TOOL_NAME} requires every thread objective to be non-empty.`;
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: message,
            error: message,
          }),
        );
        throw new Error(message);
      }

      try {
        const threads: Array<{
          id: string;
          threadGroupId: string;
          surfacePiSessionId: string;
          objective: string;
          objectiveState: "active" | "concluded";
        }> = [];
        for (const requestedThread of requestedThreads) {
          const thread = await options.bridge.createHandlerThread({
            sessionId: runtime.workspaceSessionId,
            turnId: runtime.turnId!,
            parentThreadId: runtime.rootThreadId ?? null,
            parentSurfacePiSessionId: runtime.surfacePiSessionId,
            threadGroupId,
            objective: requestedThread.objective,
            historyMode: requestedThread.historyMode,
            overrides: requestedThread.overrides,
            loadedByCommandId: command.id,
          });
          threadGroupId = thread.threadGroupId;
          threads.push(thread);
        }

        const resultThreads = threads.map((thread) => ({
          threadId: thread.id,
          surfacePiSessionId: thread.surfacePiSessionId,
          objective: thread.objective,
          objectiveState: thread.objectiveState,
        }));

        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "succeeded",
            summary:
              threads.length === 1
                ? `Opened handler thread ${threads[0]!.id} for ${threads[0]!.objective}.`
                : `Opened ${threads.length} handler threads in group ${threadGroupId}.`,
            facts: {
              threadGroupId,
              threads: resultThreads,
            },
          }),
        );
        options.onAppLog?.({
          level: "info",
          source: "thread",
          message:
            threads.length === 1 ? "Handler thread created." : "Handler thread group created.",
          details: {
            workspaceSessionId: runtime.workspaceSessionId,
            surfacePiSessionId: runtime.surfacePiSessionId,
            ...(runtime.rootThreadId ? { threadId: runtime.rootThreadId } : {}),
            commandId: command.id,
            threadGroupId: threadGroupId!,
            threadIds: threads.map((thread) => thread.id),
            threadCount: threads.length,
          },
        });

        const details = {
          threadGroupId: threadGroupId!,
          threads: resultThreads,
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(details),
            },
          ],
          details: { commandFacts: details as CommandFactsPayload },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create delegated handler thread.";
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: message,
            error: message,
          }),
        );
        options.onAppLog?.({
          level: "warning",
          source: "thread",
          message: "Handler thread creation failed.",
          details: {
            workspaceSessionId: runtime.workspaceSessionId,
            surfacePiSessionId: runtime.surfacePiSessionId,
            ...(runtime.rootThreadId ? { threadId: runtime.rootThreadId } : {}),
            commandId: command.id,
            errorMessage: message,
          },
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
            commandFacts: {
              ok: false,
              commandId: command.id,
              error: message,
            } as CommandFactsPayload,
          },
        };
      }
    },
  };
}
