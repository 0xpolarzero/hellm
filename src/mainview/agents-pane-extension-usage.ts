import type { ExtensionCategory, ExtensionUsageState } from "../shared/extensions";
import { BUILTIN_EXTENSIONS, resolveActorExtensionState } from "../shared/extensions";
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
  networkAccess: boolean;
};

export function baselineExtensionState(input: {
  actor: AgentContextActor;
  extensionId: string;
  networkAccess: boolean;
}): ExtensionUsageState {
  const baseline = resolveActorExtensionState({
    actor: input.actor,
    networkAccess: input.networkAccess,
  });
  if (baseline.loadedExtensionIds.includes(input.extensionId)) return "default_loaded";
  if (baseline.availableExtensionIds.includes(input.extensionId)) return "available";
  return "unavailable";
}

export function resolvedExtensionState(input: {
  actor: AgentContextActor;
  extension: Pick<ExtensionInventoryItemReadModel, "category" | "id">;
  explicitUsage: Record<string, ExtensionUsageState>;
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
      networkAccess: input.networkAccess,
    });
  }

  const resolved = resolveActorExtensionState({
    actor: input.actor,
    profileExtensionUsage: input.explicitUsage,
    networkAccess: input.networkAccess,
  });
  if (resolved.loadedExtensionIds.includes(input.extension.id)) return "default_loaded";
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
  networkAccess: boolean;
}): boolean {
  if (!input.configurable) return false;
  if (input.state === "unavailable") return true;
  if (input.extension.category === "user") return true;
  return (
    baselineExtensionState({
      actor: input.actor,
      extensionId: input.extension.id,
      networkAccess: input.networkAccess,
    }) !== "unavailable"
  );
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
      typescriptApiEnabled: extension.typescriptApiEnabled,
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

  return [...extensionIds]
    .flatMap((extensionId): ExtensionUsageControlItem[] => {
      const extension = inventoryById.get(extensionId) ??
        fallbackBuiltinItems.find((candidate) => candidate.id === extensionId) ?? {
          id: extensionId,
          category: "user" as const,
          interface: "instructions" as const,
          title: extensionId,
          description: "Custom extension usage override.",
          typescriptApiEnabled: false,
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
      const baseline = baselineExtensionState({
        actor: input.actor,
        extensionId: extension.id,
        networkAccess: input.networkAccess,
      });
      if (
        extension.category !== "user" &&
        !hasStoredUsage &&
        extension.id !== "extension-loading" &&
        !usage &&
        baseline === "unavailable"
      ) {
        return [];
      }
      if (
        extension.category !== "user" &&
        !hasStoredUsage &&
        extension.id !== "extension-loading" &&
        usage?.state === "unavailable" &&
        baseline === "unavailable"
      ) {
        return [];
      }
      const state = resolvedExtensionState({
        actor: input.actor,
        extension,
        explicitUsage: input.usage,
        inventoryUsage: usage,
        networkAccess: input.networkAccess,
      });
      const defaultUsage = { ...input.usage };
      delete defaultUsage[extension.id];
      const defaultState = resolvedExtensionState({
        actor: input.actor,
        extension,
        explicitUsage: defaultUsage,
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
            default_loaded: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "default_loaded",
              configurable,
              networkAccess: input.networkAccess,
            }),
            available: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "available",
              configurable,
              networkAccess: input.networkAccess,
            }),
            unavailable: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "unavailable",
              configurable,
              networkAccess: input.networkAccess,
            }),
          },
        },
      ];
    })
    .toSorted((left, right) => {
      if (left.id === "extension-loading") return -1;
      if (right.id === "extension-loading") return 1;
      const leftOrder = orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return (
        leftOrder - rightOrder ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
      );
    });
}
