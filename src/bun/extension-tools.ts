import {
  type ListExtensionsDetails,
  type NativeToolDefinition,
  listExtensionsForActor,
  summarizeListExtensions,
  type ExtensionRecord,
} from "@svvy/extensions";
import { Type, type Static } from "typebox";
import type { PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import type { CommandFactsPayload } from "@svvy/core";
import { nativeToolParameters } from "./native-tool-parameters";
import {
  type PromptTarget,
  type CommandId,
  type NativeToolResult,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeTurnStatePortService,
  type StateContractError,
  type PromptExecutionContext,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
} from "@svvy/core";
import type { ExtensionRegistryObservation } from "@svvy/core";
import * as Effect from "effect/Effect";

export const LIST_EXTENSIONS_TOOL_NAME = "list_extensions";
export const LOAD_EXTENSION_TOOL_NAME = "load_extension";

export function extensionRecordFromRegistryObservation(
  observation: ExtensionRegistryObservation,
): ExtensionRecord {
  return {
    id: observation.extensionId,
    category: observation.category,
    interface: observation.interfaceKind,
    title: observation.title,
    description: observation.description,
    instructionSourceFiles: observation.contributors.flatMap((contributor) =>
      contributor.source ? [contributor.source.sourceId] : [],
    ),
    minimalLoadingHint: "",
    typescriptApiEnabled: observation.capabilities.typescriptApiEnabled,
    envReadiness: observation.envDeclarations.length > 0 ? "ready" : "not_required",
    dependencyReadiness: observation.dependencyDeclarations.length > 0 ? "ready" : "not_required",
    cliRequirements: observation.cliDeclarations.map((requirement) => ({
      id: requirement.id,
      binary: requirement.binary,
      required: requirement.required,
      ...(requirement.package ? { package: requirement.package } : {}),
      ...(requirement.defaultVersion ? { version: requirement.defaultVersion } : {}),
      ...(requirement.nodeRequirement ? { nodeRequirement: requirement.nodeRequirement } : {}),
      ...(requirement.versionCommand ? { versionCommand: requirement.versionCommand } : {}),
      ...(requirement.installCommand ? { installCommand: requirement.installCommand } : {}),
    })),
    generatedInstructions: observation.contributors.flatMap((contributor) =>
      contributor.kind === "generated-instruction"
        ? [{ output: contributor.name, script: contributor.name }]
        : [],
    ),
    instructionFiles: observation.contributors.flatMap((contributor) =>
      contributor.kind === "instruction" || contributor.kind === "generated-instruction"
        ? [{ file: contributor.name, bypassed: contributor.bypassed }]
        : [],
    ),
    resetBehavior: observation.category === "builtin" ? "builtin_reset" : "user_reset",
    deleteBehavior: observation.capabilities.deletable ? "trash_allowed" : "not_allowed",
  };
}

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

export type RunAcceptedLoadExtension = (input: {
  toolCallId: ToolCallId;
  toolItemId: ToolItemId;
  arguments: LoadExtensionParams;
  context: PromptExecutionContext;
  actorBinding: {
    loadedExtensionIds: readonly string[];
    availableExtensionIds: readonly string[];
    loadedExtensionRecords: readonly ExtensionRecord[];
    availableExtensionRecords: readonly ExtensionRecord[];
  };
  command: {
    commandId: CommandId;
    target: PromptTarget;
    turnId: TurnId;
    approvalMode: "auto-review" | "user" | "full-access";
    approvalFacts?: Readonly<Record<string, unknown>>;
    sandbox: {
      snapshot: Readonly<Record<string, unknown>>;
      launchPolicy?: Readonly<Record<string, unknown>>;
    };
    cwd: string;
    baseEnv: Readonly<Record<string, string>>;
  };
}) => Promise<{
  toolResult: NativeToolResult;
  appliedEffects: readonly {
    type: string;
    binding?: {
      loadedExtensionIds: readonly string[];
      availableExtensionIds: readonly string[];
      generatedAgentContextFingerprint?: string | null | undefined;
    };
  }[];
}>;

export function createListExtensionsTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: ExtensionToolState;
  resolveVisibleRecords: (ids: readonly string[]) => Promise<readonly ExtensionRecord[]>;
}): NativeToolDefinition<ListExtensionsParams> {
  return {
    label: "List Extensions",
    name: LIST_EXTENSIONS_TOOL_NAME,
    description:
      "List the current actor's loaded and available extensions without unavailable details, secrets, fingerprints, or global profile state.",
    parameters: nativeToolParameters(listExtensionsParamsSchema),
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
          loadedExtensionRecords: await options.resolveVisibleRecords(loadedExtensionIds),
          availableExtensionIds,
          availableExtensionRecords: await options.resolveVisibleRecords(availableExtensionIds),
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
          details: {
            summary: summarizeListExtensions(details),
            commandFacts: {
              type: "list_extensions.finished",
              loaded: details.loaded,
              available: details.available,
            } as unknown as CommandFactsPayload,
          },
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
  resolveVisibleRecords: (ids: readonly string[]) => Promise<readonly ExtensionRecord[]>;
  runAcceptedLoadExtension: RunAcceptedLoadExtension;
}): NativeToolDefinition<LoadExtensionParams> {
  return {
    label: "Load Extension",
    name: LOAD_EXTENSION_TOOL_NAME,
    description:
      "Load one available ready extension into this actor session and refresh actor-local extension visibility.",
    parameters: nativeToolParameters(loadExtensionParamsSchema),
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
        const loadedExtensionRecords = await options.resolveVisibleRecords(
          runtime.loadedExtensionIds ?? [],
        );
        const availableExtensionRecords = await options.resolveVisibleRecords(
          runtime.availableExtensionIds ?? [],
        );
        const executed = await options.runAcceptedLoadExtension({
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
        });
        const bindingEffect = executed.appliedEffects.find(
          (effect) => effect.type === "actor_extension_binding.update",
        );
        if (bindingEffect?.type === "actor_extension_binding.update" && bindingEffect.binding) {
          runtime.loadedExtensionIds = [...bindingEffect.binding.loadedExtensionIds];
          runtime.availableExtensionIds = [...bindingEffect.binding.availableExtensionIds];
          if (bindingEffect.binding.generatedAgentContextFingerprint) {
            runtime.generatedAgentContextFingerprint =
              bindingEffect.binding.generatedAgentContextFingerprint;
          }
        }
        const postLoadDetails = listExtensionsForActor({
          actor: runtime.surfaceKind,
          loadedExtensionIds: runtime.loadedExtensionIds ?? [],
          loadedExtensionRecords: await options.resolveVisibleRecords(
            runtime.loadedExtensionIds ?? [],
          ),
          availableExtensionIds: runtime.availableExtensionIds ?? [],
          availableExtensionRecords: await options.resolveVisibleRecords(
            runtime.availableExtensionIds ?? [],
          ),
          externalInstructionSources: runtime.externalInstructionSources ?? [],
        });
        return {
          content: executed.toolResult.content,
          details: {
            summary: `Loaded extension ${id}.`,
            commandFacts: {
              type: "load_extension.finished",
              loadedExtensionId: id,
              loaded: postLoadDetails.loaded,
              available: postLoadDetails.available,
            } as unknown as CommandFactsPayload,
          },
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
