import type { ExtensionCategory, ExtensionUsageState } from "@svvy/extensions";
import { BUILTIN_EXTENSIONS, resolveActorExtensionState } from "@svvy/extensions";
import {
  DEFAULT_AGENT_SETTINGS_STATE,
  type ExtensionDefaultsSettings,
} from "../shared/agent-settings";
import type {
  AgentContextPreviewRequest,
  ExtensionInventoryItemReadModel,
  ExtensionUsageReadiness,
} from "../shared/workspace-contract";

export type AgentContextActor = NonNullable<AgentContextPreviewRequest["actor"]>;

export type ExtensionUsageControlItem = {
  id: string;
  title: string;
  description: string;
  category: ExtensionCategory;
  state: ExtensionUsageState;
  defaultState: ExtensionUsageState;
  explicit: boolean;
  configurable: boolean;
  fixedReason?: string;
  allowedStates: Record<ExtensionUsageState, boolean>;
};

type ExtensionUsageInventoryInput = {
  actor: AgentContextActor;
  usage: Record<string, ExtensionUsageState>;
  profileId: string;
  extensionInventoryItems: ExtensionInventoryItemReadModel[];
  extensionDefaults?: ExtensionDefaultsSettings;
  networkAccess: boolean;
};

export function baselineExtensionState(input: {
  actor: AgentContextActor;
  extensionId: string;
  extensionDefaults?: ExtensionDefaultsSettings | null;
  networkAccess: boolean;
}): ExtensionUsageState {
  const baseline = resolveActorExtensionState({
    actor: input.actor,
    defaultExtensionOrder: input.extensionDefaults?.order,
    defaultExtensionUsage: input.extensionDefaults?.usage,
    networkAccess: input.networkAccess,
  });
  if (baseline.loadedExtensionIds.includes(input.extensionId)) return "loaded";
  if (baseline.availableExtensionIds.includes(input.extensionId)) return "available";
  return "unavailable";
}

export function resolvedExtensionState(input: {
  actor: AgentContextActor;
  extension: Pick<ExtensionInventoryItemReadModel, "category" | "id">;
  explicitUsage: Record<string, ExtensionUsageState>;
  extensionDefaults?: ExtensionDefaultsSettings | null;
  inventoryUsage: ExtensionUsageReadiness | null;
  networkAccess: boolean;
}): ExtensionUsageState {
  if (input.explicitUsage[input.extension.id] === undefined) {
    if (input.extension.category === "user" && input.inventoryUsage) {
      return input.inventoryUsage.state;
    }
    return baselineExtensionState({
      actor: input.actor,
      extensionId: input.extension.id,
      extensionDefaults: input.extensionDefaults,
      networkAccess: input.networkAccess,
    });
  }

  const resolved = resolveActorExtensionState({
    actor: input.actor,
    defaultExtensionOrder: input.extensionDefaults?.order,
    defaultExtensionUsage: input.extensionDefaults?.usage,
    profileExtensionUsage: input.explicitUsage,
    networkAccess: input.networkAccess,
  });
  if (resolved.loadedExtensionIds.includes(input.extension.id)) return "loaded";
  if (resolved.availableExtensionIds.includes(input.extension.id)) return "available";
  return "unavailable";
}

export function canSelectExtensionUsageState(input: {
  disabled: boolean;
  pending: boolean;
  item: Pick<ExtensionUsageControlItem, "allowedStates" | "configurable" | "state">;
  state: ExtensionUsageState;
}): boolean {
  return (
    !input.disabled &&
    !input.pending &&
    input.item.configurable &&
    input.item.allowedStates[input.state] &&
    input.item.state !== input.state
  );
}

export function extensionStateAllowed(input: {
  actor: AgentContextActor;
  extension: ExtensionInventoryItemReadModel;
  state: ExtensionUsageState;
  configurable: boolean;
  extensionDefaults?: ExtensionDefaultsSettings | null;
  networkAccess: boolean;
}): boolean {
  if (!input.configurable) return false;
  return true;
}

export function extensionUsageItems(
  input: ExtensionUsageInventoryInput,
): ExtensionUsageControlItem[] {
  const inventoryById = new Map(
    input.extensionInventoryItems.map((extension) => [extension.id, extension]),
  );
  const fallbackBuiltinItems: ExtensionInventoryItemReadModel[] = BUILTIN_EXTENSIONS.map(
    (extension) => ({
      id: extension.id,
      category: extension.category,
      interface: extension.interface,
      title: extension.title,
      description: extension.description,
      customized: false,
      minimalInstruction: minimalInstructionPlaceholder(extension.minimalLoadingHint),
      loadedInstructionContributors: [],
      typescriptApiEnabled: extension.typescriptApiEnabled,
      tooling: {
        typescriptApiStatus: extension.typescriptApiEnabled ? "not_emitted" : "disabled",
      },
      usage: [],
      requirements: {
        cliRequirements: [],
        env: [],
      },
      state: {
        ready: true,
        issues: [],
      },
    }),
  );
  const inventory =
    input.extensionInventoryItems.length > 0 ? input.extensionInventoryItems : fallbackBuiltinItems;
  const orderById = new Map(inventory.map((extension, index) => [extension.id, index]));
  const extensionIds = new Set([
    ...inventory.map((extension) => extension.id),
    ...Object.keys(input.usage),
  ]);
  const extensionDefaults =
    input.extensionDefaults ?? DEFAULT_AGENT_SETTINGS_STATE.extensionDefaults;
  const defaultOrder = input.actor === "handler" ? [] : extensionDefaults.order;
  const defaultOrderById = new Map(defaultOrder.map((id, index) => [id, index]));

  return [...extensionIds]
    .flatMap((extensionId): ExtensionUsageControlItem[] => {
      const extension = inventoryById.get(extensionId) ??
        fallbackBuiltinItems.find((candidate) => candidate.id === extensionId) ?? {
          id: extensionId,
          category: "user" as const,
          interface: "instructions" as const,
          title: extensionId,
          description: "Custom extension usage override.",
          customized: false,
          minimalInstruction: minimalInstructionPlaceholder(""),
          loadedInstructionContributors: [],
          typescriptApiEnabled: false,
          tooling: {
            typescriptApiStatus: "disabled",
          },
          usage: [],
          requirements: {
            cliRequirements: [],
            env: [],
          },
          state: {
            ready: true,
            issues: [],
          },
        };
      const usage =
        extension.usage.find(
          (candidate) =>
            candidate.actorKind === input.actor && candidate.agentProfile === input.profileId,
        ) ?? null;
      const hasStoredUsage = input.usage[extension.id] !== undefined;
      const productBaseline = baselineExtensionState({
        actor: input.actor,
        extensionId: extension.id,
        extensionDefaults: null,
        networkAccess: input.networkAccess,
      });
      if (
        extension.category !== "user" &&
        !hasStoredUsage &&
        extension.id !== "extension-loading" &&
        !usage &&
        productBaseline === "unavailable"
      ) {
        return [];
      }
      if (
        extension.category !== "user" &&
        !hasStoredUsage &&
        extension.id !== "extension-loading" &&
        usage?.state === "unavailable" &&
        productBaseline === "unavailable"
      ) {
        return [];
      }
      const state = resolvedExtensionState({
        actor: input.actor,
        extension,
        explicitUsage: input.usage,
        extensionDefaults,
        inventoryUsage: usage,
        networkAccess: input.networkAccess,
      });
      const defaultUsage = { ...input.usage };
      delete defaultUsage[extension.id];
      const defaultState = resolvedExtensionState({
        actor: input.actor,
        extension,
        explicitUsage: defaultUsage,
        extensionDefaults: input.extensionDefaults,
        inventoryUsage: usage,
        networkAccess: input.networkAccess,
      });
      const explicit = state !== defaultState;
      const configurable =
        usage?.configurable ??
        (extension.category !== "external_instruction" && extension.id !== "extension-loading");
      return [
        {
          id: extension.id,
          title: extension.title,
          description: extension.description,
          category: extension.category,
          state,
          defaultState,
          explicit,
          configurable,
          fixedReason: usage?.fixedReason,
          allowedStates: {
            loaded: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "loaded",
              configurable,
              extensionDefaults,
              networkAccess: input.networkAccess,
            }),
            available: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "available",
              configurable,
              extensionDefaults,
              networkAccess: input.networkAccess,
            }),
            unavailable: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "unavailable",
              configurable,
              extensionDefaults,
              networkAccess: input.networkAccess,
            }),
          },
        },
      ];
    })
    .toSorted((left, right) => {
      if (left.id === "extension-loading") return -1;
      if (right.id === "extension-loading") return 1;
      const leftOrder =
        defaultOrderById.get(left.id) ?? orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder =
        defaultOrderById.get(right.id) ?? orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return (
        leftOrder - rightOrder ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
      );
    });
}

function minimalInstructionPlaceholder(
  content: string,
): ExtensionInventoryItemReadModel["minimalInstruction"] {
  return {
    name: "minimal.md",
    path: "",
    content,
    sourceVersion: "",
    bypassed: false,
    editable: false,
    tokenCount: {
      tokens: 0,
      accuracy: "estimated",
    },
  };
}
