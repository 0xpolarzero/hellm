import type { ExtensionCategory, ExtensionUsageState } from "@svvy/core";
import type {
  AgentContextPreviewRequest,
  ExtensionsInventoryReadModel,
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
  inventoryDefaults?: ExtensionsInventoryReadModel["defaults"] | null;
  networkAccess: boolean;
};

export function baselineExtensionState(input: {
  actor: AgentContextActor;
  extensionId: string;
  inventoryDefaults?: ExtensionsInventoryReadModel["defaults"] | null;
}): ExtensionUsageState {
  return (
    input.inventoryDefaults?.usage[input.extensionId]?.find(
      (candidate) => candidate.actorKind === input.actor,
    )?.state ?? "unavailable"
  );
}

export function resolvedExtensionState(input: {
  actor: AgentContextActor;
  extension: Pick<ExtensionInventoryItemReadModel, "category" | "id">;
  explicitUsage: Record<string, ExtensionUsageState>;
  inventoryDefaults?: ExtensionsInventoryReadModel["defaults"] | null;
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
      inventoryDefaults: input.inventoryDefaults,
    });
  }

  return input.explicitUsage[input.extension.id] ?? "unavailable";
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
  inventoryDefaults?: ExtensionsInventoryReadModel["defaults"] | null;
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
  const inventory = input.extensionInventoryItems;
  const orderById = new Map(inventory.map((extension, index) => [extension.id, index]));
  const extensionIds = new Set([
    ...inventory.map((extension) => extension.id),
    ...Object.keys(input.usage),
  ]);
  const defaultOrder = input.actor === "handler" ? [] : (input.inventoryDefaults?.order ?? []);
  const defaultOrderById = new Map(defaultOrder.map((id, index) => [id, index]));

  return [...extensionIds]
    .flatMap((extensionId): ExtensionUsageControlItem[] => {
      const extension = inventoryById.get(extensionId) ?? {
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
      const hasInventoryDefault =
        input.inventoryDefaults?.usage[extension.id]?.some(
          (candidate) => candidate.actorKind === input.actor,
        ) ?? false;
      const productBaseline = baselineExtensionState({
        actor: input.actor,
        extensionId: extension.id,
        inventoryDefaults: input.inventoryDefaults,
      });
      if (
        extension.category !== "user" &&
        !hasStoredUsage &&
        !hasInventoryDefault &&
        extension.id !== "extension-loading" &&
        !usage &&
        productBaseline === "unavailable"
      ) {
        return [];
      }
      if (
        extension.category !== "user" &&
        !hasStoredUsage &&
        !hasInventoryDefault &&
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
        inventoryDefaults: input.inventoryDefaults,
        inventoryUsage: usage,
        networkAccess: input.networkAccess,
      });
      const defaultUsage = { ...input.usage };
      delete defaultUsage[extension.id];
      const defaultState = resolvedExtensionState({
        actor: input.actor,
        extension,
        explicitUsage: defaultUsage,
        inventoryDefaults: input.inventoryDefaults,
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
              inventoryDefaults: input.inventoryDefaults,
              networkAccess: input.networkAccess,
            }),
            available: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "available",
              configurable,
              inventoryDefaults: input.inventoryDefaults,
              networkAccess: input.networkAccess,
            }),
            unavailable: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "unavailable",
              configurable,
              inventoryDefaults: input.inventoryDefaults,
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
