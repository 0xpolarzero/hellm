import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "typebox";
import type { SvvyActorKind } from "./actor-capabilities";
import { buildSystemPrompt } from "./default-system-prompt";
import { buildExecuteTypescriptApiDeclaration } from "./execute-typescript-api-declaration";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { StructuredSessionStateStore } from "./structured-session-state";
import {
  resolveExtensionRecord,
  resolveExtensionRecords,
  resolveVisibleExtensionRecords,
} from "./svvyx-extensions-command";
import { visibleExtensionRecords, type ExtensionRecord } from "../shared/extensions";

export const LIST_EXTENSIONS_TOOL_NAME = "list_extensions";
export const LOAD_EXTENSION_TOOL_NAME = "load_extension";

const listExtensionsParamsSchema = Type.Object({}, { additionalProperties: false });
const loadExtensionParamsSchema = Type.Object(
  {
    extensionId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

type ListExtensionsParams = Static<typeof listExtensionsParamsSchema>;
type LoadExtensionParams = Static<typeof loadExtensionParamsSchema>;

export interface ListExtensionsDetails {
  loaded: ReturnType<typeof visibleExtensionRecords>["loaded"];
  available: ReturnType<typeof visibleExtensionRecords>["available"];
}

export interface LoadExtensionDetails extends ListExtensionsDetails {
  loadedExtensionId: string;
  refreshedContext: {
    actor: SvvyActorKind;
    loadedExtensionIds: string[];
    availableExtensionIds: string[];
    systemPrompt: string;
    executeTypescriptDeclaration: string;
  };
}

export function createListExtensionsTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  extensionsRoot?: string;
}): AgentTool<typeof listExtensionsParamsSchema, ListExtensionsDetails> {
  return {
    label: "List Extensions",
    name: LIST_EXTENSIONS_TOOL_NAME,
    description:
      "List the current actor's loaded and available extensions without unavailable details, secrets, fingerprints, or global profile state.",
    parameters: listExtensionsParamsSchema,
    execute: async (_toolCallId, _params: ListExtensionsParams) => {
      const runtime = requireActiveRuntime(options.runtime, LIST_EXTENSIONS_TOOL_NAME);
      if (runtime.turnId) {
        options.store.setTurnDecision({
          turnId: runtime.turnId,
          decision: LIST_EXTENSIONS_TOOL_NAME,
          onlyIfPending: true,
        });
      }
      const command = options.store.createOrReuseStreamingCommand({
        toolCallId: _toolCallId,
        turnId: runtime.turnId,
        workflowTaskAttemptId: runtime.workflowTaskAttemptId,
        surfacePiSessionId: runtime.surfacePiSessionId,
        threadId: runtime.surfaceKind === "handler" ? runtime.surfaceThreadId : null,
        workflowRunId: runtime.workflowRunId,
        toolName: LIST_EXTENSIONS_TOOL_NAME,
        executor:
          runtime.surfaceKind === "workflow-task"
            ? "workflow-task-agent"
            : runtime.surfaceKind === "handler"
              ? "handler"
              : "orchestrator",
        visibility: "surface",
        title: "List extensions",
        summary: "List loaded and available extensions.",
        arguments: {},
      });
      options.store.startCommand(command.id);

      try {
        const loadedExtensionIds = runtime.loadedExtensionIds ?? [];
        const availableExtensionIds = runtime.availableExtensionIds ?? [];
        const details = visibleExtensionRecords({
          actor: runtime.surfaceKind,
          loadedExtensionIds,
          loadedExtensionRecords: resolveVisibleExtensionRecords(
            loadedExtensionIds,
            options.extensionsRoot,
          ),
          availableExtensionIds,
          availableExtensionRecords: resolveVisibleExtensionRecords(
            availableExtensionIds,
            options.extensionsRoot,
          ),
          externalInstructionSources: runtime.externalInstructionSources ?? [],
        });
        options.store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary: summarizeExtensions(details),
          facts: {
            loadedExtensionIds: details.loaded.map((extension) => extension.id),
            availableExtensionIds: details.available.map((extension) => extension.id),
          },
        });
        return {
          content: [{ type: "text", text: summarizeExtensions(details) }],
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to list extensions.";
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: message,
          error: message,
        });
        throw error;
      }
    },
  };
}

export function createLoadExtensionTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  extensionsRoot?: string;
  onContextRefreshed?: (input: {
    extensionId: string;
    refreshedContext: LoadExtensionDetails["refreshedContext"];
    runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
  }) =>
    | Promise<LoadExtensionDetails["refreshedContext"] | void>
    | LoadExtensionDetails["refreshedContext"]
    | void;
}): AgentTool<typeof loadExtensionParamsSchema, LoadExtensionDetails> {
  return {
    label: "Load Extension",
    name: LOAD_EXTENSION_TOOL_NAME,
    description:
      "Load one available ready extension into this actor session and refresh actor-local extension visibility.",
    parameters: loadExtensionParamsSchema,
    execute: async (_toolCallId, params: LoadExtensionParams) => {
      const runtime = requireActiveRuntime(options.runtime, LOAD_EXTENSION_TOOL_NAME);
      const id = params.extensionId.trim();
      if (runtime.turnId) {
        options.store.setTurnDecision({
          turnId: runtime.turnId,
          decision: "load_extension",
          onlyIfPending: true,
        });
      }
      const command = options.store.createOrReuseStreamingCommand({
        toolCallId: _toolCallId,
        turnId: runtime.turnId,
        workflowTaskAttemptId: runtime.workflowTaskAttemptId,
        surfacePiSessionId: runtime.surfacePiSessionId,
        threadId: runtime.surfaceKind === "handler" ? runtime.surfaceThreadId : null,
        workflowRunId: runtime.workflowRunId,
        toolName: LOAD_EXTENSION_TOOL_NAME,
        executor:
          runtime.surfaceKind === "workflow-task"
            ? "workflow-task-agent"
            : runtime.surfaceKind === "handler"
              ? "handler"
              : "orchestrator",
        visibility: "surface",
        title: `Load extension: ${id}`,
        summary: `Load extension ${id}.`,
        arguments: {
          extensionId: id,
        },
      });
      options.store.startCommand(command.id);
      const failLoad = (message: string): never => {
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: message,
          error: message,
        });
        throw new Error(message);
      };
      const record = resolveExtensionRecord(id, options.extensionsRoot);
      if (!record) {
        return failLoad(`Unknown extension: ${id}`);
      }
      if (!(runtime.availableExtensionIds ?? []).includes(id)) {
        return failLoad(`Extension is not available to load for this actor: ${id}`);
      }
      if (!extensionIsReady(record)) {
        return failLoad(`Extension is not ready to load for this actor: ${id}`);
      }

      const previousLoadedExtensionIds = [...(runtime.loadedExtensionIds ?? [])];
      const previousAvailableExtensionIds = [...(runtime.availableExtensionIds ?? [])];
      const previousSystemPrompt = runtime.systemPrompt;
      const previousGeneratedAgentContextFingerprint = runtime.generatedAgentContextFingerprint;

      try {
        runtime.loadedExtensionIds = [
          ...new Set([...(runtime.loadedExtensionIds ?? []), id]),
        ].toSorted();
        runtime.availableExtensionIds = (runtime.availableExtensionIds ?? [])
          .filter((candidate) => candidate !== id)
          .toSorted();

        if (runtime.surfaceKind === "handler" && runtime.surfaceThreadId) {
          options.store.updateThread({
            threadId: runtime.surfaceThreadId,
            loadedExtensionIds: runtime.loadedExtensionIds,
            availableExtensionIds: runtime.availableExtensionIds,
          });
        } else if (runtime.surfaceKind === "orchestrator") {
          options.store.updatePiSessionExtensionState({
            sessionId: runtime.sessionId,
            loadedExtensionIds: runtime.loadedExtensionIds,
            availableExtensionIds: runtime.availableExtensionIds,
          });
        }

        let refreshedContext = buildRefreshedContextPreview(runtime, options.extensionsRoot);
        let appliedContext: LoadExtensionDetails["refreshedContext"] | void;
        appliedContext = await options.onContextRefreshed?.({
          extensionId: id,
          refreshedContext,
          runtime,
        });
        if (appliedContext) {
          refreshedContext = appliedContext;
        }

        const details = {
          loadedExtensionId: id,
          refreshedContext,
          ...visibleExtensionRecords({
            actor: runtime.surfaceKind,
            loadedExtensionIds: runtime.loadedExtensionIds ?? [],
            loadedExtensionRecords: resolveVisibleExtensionRecords(
              runtime.loadedExtensionIds ?? [],
              options.extensionsRoot,
            ),
            availableExtensionIds: runtime.availableExtensionIds ?? [],
            availableExtensionRecords: resolveVisibleExtensionRecords(
              runtime.availableExtensionIds ?? [],
              options.extensionsRoot,
            ),
            externalInstructionSources: runtime.externalInstructionSources ?? [],
          }),
        };
        options.store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary: `Loaded extension ${id}.`,
          facts: {
            loadedExtensionId: id,
            loadedExtensionIds: runtime.loadedExtensionIds ?? [],
            availableExtensionIds: runtime.availableExtensionIds ?? [],
          },
        });
        return {
          content: [{ type: "text", text: `Loaded extension ${id}.` }],
          details,
        };
      } catch (error) {
        runtime.loadedExtensionIds = previousLoadedExtensionIds;
        runtime.availableExtensionIds = previousAvailableExtensionIds;
        runtime.systemPrompt = previousSystemPrompt;
        runtime.generatedAgentContextFingerprint = previousGeneratedAgentContextFingerprint;
        if (runtime.surfaceKind === "handler" && runtime.surfaceThreadId) {
          options.store.updateThread({
            threadId: runtime.surfaceThreadId,
            loadedExtensionIds: previousLoadedExtensionIds,
            availableExtensionIds: previousAvailableExtensionIds,
          });
        } else if (runtime.surfaceKind === "orchestrator") {
          options.store.updatePiSessionExtensionState({
            sessionId: runtime.sessionId,
            loadedExtensionIds: previousLoadedExtensionIds,
            availableExtensionIds: previousAvailableExtensionIds,
          });
        }
        const message = error instanceof Error ? error.message : `Failed to load extension ${id}.`;
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: message,
          error: message,
        });
        throw error;
      }
    },
  };
}

function extensionIsReady(record: ExtensionRecord): boolean {
  return (
    (record.envReadiness === "ready" || record.envReadiness === "not_required") &&
    (record.dependencyReadiness === "ready" || record.dependencyReadiness === "not_required")
  );
}

function summarizeExtensions(details: ListExtensionsDetails): string {
  const loaded = details.loaded.map((extension) => extension.id).join(", ") || "none";
  const available = details.available.map((extension) => extension.id).join(", ") || "none";
  return `Loaded extensions: ${loaded}\nAvailable extensions: ${available}`;
}

function buildRefreshedContextPreview(
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>,
  extensionsRoot?: string,
): LoadExtensionDetails["refreshedContext"] {
  const actor = runtime.surfaceKind === "handler" ? "handler" : "orchestrator";
  const loadedExtensionIds = [...(runtime.loadedExtensionIds ?? [])];
  const availableExtensionIds = [...(runtime.availableExtensionIds ?? [])];
  return {
    actor,
    loadedExtensionIds,
    availableExtensionIds,
    systemPrompt: buildSystemPrompt(actor, {
      extensionsRoot,
      loadedExtensionIds,
      loadedExtensionRecords: resolveExtensionRecords(loadedExtensionIds, extensionsRoot),
      availableExtensionIds,
      availableExtensionRecords: resolveExtensionRecords(availableExtensionIds, extensionsRoot),
      externalInstructionSources: runtime.externalInstructionSources,
    }),
    executeTypescriptDeclaration: buildExecuteTypescriptApiDeclaration(actor, {
      extensionsRoot,
      loadedExtensionIds,
      loadedExtensionRecords: resolveExtensionRecords(loadedExtensionIds, extensionsRoot),
    }),
  };
}

function requireActiveRuntime(
  runtimeHandle: PromptExecutionRuntimeHandle,
  toolName: string,
): NonNullable<PromptExecutionRuntimeHandle["current"]> {
  const runtime = runtimeHandle.current;
  if (!runtime) {
    throw new Error(`${toolName} can only run during an active prompt.`);
  }
  return runtime;
}
