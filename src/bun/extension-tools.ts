import {
  BUILTIN_EXTENSIONS,
  type ExtensionsService,
  type ListExtensionsDetails,
  type NativeToolDefinition,
  getExtensionRecord,
  listExtensionsForActor,
  summarizeListExtensions,
} from "@svvy/extensions";
import { Type, type Static } from "typebox";
import type { PromptExecutionRuntimeHandle } from "@svvy/core";
import { resolveExtensionRecord, resolveVisibleExtensionRecords } from "./svvyx-extensions-command";
import {
  ExtensionError as CoreExtensionError,
  RuntimeContractError,
  type PromptTarget,
  type CommandId,
  type RefreshGeneratedContextRequest,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeTurnStatePortService,
  type StateContractError,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import { runAcceptedLoadExtensionToolCallAtRuntimeBoundary } from "./runtime-service-adapter";

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

export interface LoadExtensionDetails extends ListExtensionsDetails {
  loadedExtensionId: string;
}

type ExtensionToolState = {
  commandState: RuntimeCommandStatePortService;
  turnState: RuntimeTurnStatePortService;
  actorExtensionBindingState: RuntimeActorExtensionBindingStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
};

export function createListExtensionsTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: ExtensionToolState;
  extensionsRoot?: string;
}): NativeToolDefinition<ListExtensionsParams, ListExtensionsDetails> {
  return {
    label: "List Extensions",
    name: LIST_EXTENSIONS_TOOL_NAME,
    description:
      "List the current actor's loaded and available extensions without unavailable details, secrets, fingerprints, or global profile state.",
    parameters: listExtensionsParamsSchema,
    execute: async (_toolCallId, _params: ListExtensionsParams) => {
      const runtime = requireActiveRuntime(options.runtime, LIST_EXTENSIONS_TOOL_NAME);
      if (runtime.turnId) {
        options.state.runState(
          options.state.turnState.setTurnDecision({
            turnId: runtime.turnId,
            decision: LIST_EXTENSIONS_TOOL_NAME,
            onlyIfPending: true,
          }),
        );
      }
      const command = options.state.runState(
        options.state.commandState.createOrReuseStreamingCommand({
          toolCallId: _toolCallId,
          turnId: runtime.turnId,
          workflowTaskAttemptId: runtime.workflowTaskAttemptId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId: runtime.surfaceKind === "handler" ? runtime.threadId : null,
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
        }),
      ).value;
      options.state.runState(options.state.commandState.startCommand({ commandId: command.id }));

      try {
        const loadedExtensionIds = runtime.loadedExtensionIds ?? [];
        const availableExtensionIds = runtime.availableExtensionIds ?? [];
        const details = listExtensionsForActor({
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
        options.state.runState(
          options.state.commandState.finishCommand({
            commandId: command.id,
            status: "succeeded",
            summary: summarizeListExtensions(details),
            facts: {
              loadedExtensionIds: details.loaded.map((extension) => extension.id),
              availableExtensionIds: details.available.map((extension) => extension.id),
            },
          }),
        );
        return {
          content: [{ type: "text", text: summarizeListExtensions(details) }],
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to list extensions.";
        options.state.runState(
          options.state.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: message,
            error: message,
          }),
        );
        throw error;
      }
    },
  };
}

export function createLoadExtensionTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: ExtensionToolState;
  extensionsRoot?: string;
  refreshGeneratedContext: (input: RefreshGeneratedContextRequest) => Promise<void>;
}): NativeToolDefinition<LoadExtensionParams, LoadExtensionDetails> {
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
        options.state.runState(
          options.state.turnState.setTurnDecision({
            turnId: runtime.turnId,
            decision: "load_extension",
            onlyIfPending: true,
          }),
        );
      }
      const command = options.state.runState(
        options.state.commandState.createOrReuseStreamingCommand({
          toolCallId: _toolCallId,
          turnId: runtime.turnId,
          workflowTaskAttemptId: runtime.workflowTaskAttemptId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId: runtime.surfaceKind === "handler" ? runtime.threadId : null,
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
        }),
      ).value;
      options.state.runState(options.state.commandState.startCommand({ commandId: command.id }));
      try {
        const target = promptTargetFromRuntime(runtime, LOAD_EXTENSION_TOOL_NAME);
        const loadedExtensionRecords = resolveVisibleExtensionRecords(
          runtime.loadedExtensionIds ?? [],
          options.extensionsRoot,
        );
        const availableExtensionRecords = resolveVisibleExtensionRecords(
          runtime.availableExtensionIds ?? [],
          options.extensionsRoot,
        );
        const executed = await runAcceptedLoadExtensionToolCallAtRuntimeBoundary({
          request: {
            toolCallId: _toolCallId as ToolCallId,
            toolItemId: _toolCallId as ToolItemId,
            arguments: {
              extensionId: id,
            },
            context: runtime,
            actorBinding: {
              loadedExtensionIds: runtime.loadedExtensionIds ?? [],
              availableExtensionIds: runtime.availableExtensionIds ?? [],
              loadedExtensionRecords,
              availableExtensionRecords,
            },
            command: {
              commandId: command.id as CommandId,
              target,
              turnId: runtime.turnId! as TurnId,
              approvalMode: "auto-review",
              sandbox: { snapshot: {} },
              cwd: "",
              baseEnv: {},
            },
            sourceInvalidation: {
              refreshGeneratedContext: (input) =>
                hostPromise("load_extension.refreshGeneratedContext", () =>
                  options.refreshGeneratedContext(input),
                ),
              refreshGeneratedPackages: () =>
                Effect.die("load_extension must not refresh generated packages."),
            },
          },
          commandStatePort: options.state.commandState,
          actorExtensionBindingStatePort: options.state.actorExtensionBindingState,
          extensionsService: runtimeBoundaryExtensionsService(options.extensionsRoot),
        });
        const bindingEffect = executed.appliedEffects.find(
          (effect) => effect.type === "actor_extension_binding.update",
        );
        if (bindingEffect?.type === "actor_extension_binding.update") {
          runtime.loadedExtensionIds = [...bindingEffect.binding.loadedExtensionIds];
          runtime.availableExtensionIds = [...bindingEffect.binding.availableExtensionIds];
          if (bindingEffect.binding.generatedAgentContextFingerprint) {
            runtime.generatedAgentContextFingerprint =
              bindingEffect.binding.generatedAgentContextFingerprint;
          }
        }
        const details = {
          loadedExtensionId: id,
          ...listExtensionsForActor({
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
        return {
          content: executed.toolResult.content,
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to load extension ${id}.`;
        options.state.runState(
          options.state.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: message,
            error: message,
          }),
        );
        throw error;
      }
    },
  };
}

function promptTargetFromRuntime(
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>,
  toolName: string,
): PromptTarget {
  if (runtime.surfaceKind === "orchestrator") {
    return {
      workspaceSessionId: runtime.workspaceSessionId,
      surface: "orchestrator",
      surfacePiSessionId: runtime.surfacePiSessionId,
    } as PromptTarget;
  }
  if (runtime.surfaceKind === "handler") {
    const threadId = runtime.rootThreadId ?? runtime.threadId;
    if (!threadId) {
      throw new Error(`${toolName} handler runtime requires a thread id.`);
    }
    return {
      workspaceSessionId: runtime.workspaceSessionId,
      surface: "handler",
      surfacePiSessionId: runtime.surfacePiSessionId,
      threadId,
    } as PromptTarget;
  }
  throw new Error(`${toolName} can only run on orchestrator or handler surfaces.`);
}

function runtimeBoundaryExtensionsService(extensionsRoot?: string): ExtensionsService {
  return {
    registry: {
      list: () => Effect.succeed(BUILTIN_EXTENSIONS),
      inspect: ({ id }) => {
        const record = resolveExtensionRecord(id, extensionsRoot) ?? getExtensionRecord(id);
        if (record) {
          return Effect.succeed(record);
        }
        return Effect.fail(
          new CoreExtensionError({
            extensionId: id,
            operation: "extensions.registry.inspect",
            reason: "not-found",
            message: `Extension record does not exist: ${id}`,
          }),
        );
      },
    },
    actorBindings: {
      resolve: () => Effect.die("Unexpected actor binding resolution in load_extension boundary."),
      visibleRecords: () =>
        Effect.die("Unexpected visible record resolution in load_extension boundary."),
    },
    nativeTools: {
      schemasJson: () => Effect.die("Unexpected native tool schema request."),
      schemaJsonForExtension: () => Effect.die("Unexpected native tool schema request."),
      listCommandMetadata: () => Effect.die("Unexpected command metadata request."),
      getCommandMetadata: () => Effect.die("Unexpected command metadata request."),
      handler: () => Effect.die("Unexpected native tool handler request."),
    },
    generatedPackages: {
      refresh: () => Effect.die("Unexpected generated package refresh."),
      planWorkspaceLink: () => Effect.die("Unexpected generated package workspace link plan."),
    },
  };
}

function hostPromise<A>(
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, RuntimeContractError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new RuntimeContractError({
        operation,
        reason: "stale-state",
        message: cause instanceof Error ? cause.message : `${operation} failed.`,
        cause,
      }),
  });
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
