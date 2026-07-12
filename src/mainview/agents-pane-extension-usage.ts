import type { ExtensionCategory, ExtensionUsageState } from "@svvy/core";
import type {
  AgentExtensionCatalogItem,
  AgentActorExtensionDefaultsReadModelRecord,
} from "../shared/workspace-contract";

export type AgentContextActor = "orchestrator" | "handler" | "workflow-task";

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
  usage: Readonly<Record<string, ExtensionUsageState>>;
  profileId: string;
  extensionCatalogItems: readonly AgentExtensionCatalogItem[];
  actorDefaults?: AgentActorExtensionDefaultsReadModelRecord | null;
  networkAccess: boolean;
};

export function baselineExtensionState(input: {
  actor: AgentContextActor;
  extension: AgentExtensionCatalogItem;
  actorDefaults?: AgentActorExtensionDefaultsReadModelRecord | null;
  networkAccess: boolean;
}): ExtensionUsageState {
  const persisted = input.actorDefaults?.extensionUsage[input.extension.extensionId];
  if (persisted) return persisted;
  if (input.extension.usagePolicy.networkAccess === "required" && !input.networkAccess) {
    return "unavailable";
  }
  return input.extension.usagePolicy.baselineUsage[input.actor];
}

export function resolvedExtensionState(input: {
  actor: AgentContextActor;
  extension: AgentExtensionCatalogItem;
  explicitUsage: Record<string, ExtensionUsageState>;
  actorDefaults?: AgentActorExtensionDefaultsReadModelRecord | null;
  networkAccess: boolean;
}): ExtensionUsageState {
  if (input.explicitUsage[input.extension.extensionId] === undefined) {
    return baselineExtensionState({
      actor: input.actor,
      extension: input.extension,
      actorDefaults: input.actorDefaults,
      networkAccess: input.networkAccess,
    });
  }

  return input.explicitUsage[input.extension.extensionId] ?? "unavailable";
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
  extension: AgentExtensionCatalogItem;
  state: ExtensionUsageState;
  configurable: boolean;
  networkAccess: boolean;
}): boolean {
  if (!input.configurable) return false;
  return true;
}

export function extensionUsageItems(
  input: ExtensionUsageInventoryInput,
): ExtensionUsageControlItem[] {
  const catalogById = new Map(
    input.extensionCatalogItems.map((extension) => [extension.extensionId, extension]),
  );
  const extensionIds = new Set([
    ...input.extensionCatalogItems.map((extension) => extension.extensionId),
    ...Object.keys(input.usage),
  ]);
  const persistedOrder = input.actorDefaults?.extensionOrder ?? [];
  const persistedOrderById = new Map(
    persistedOrder.map((id, index) => [id as string, index] as const),
  );

  return [...extensionIds]
    .flatMap((extensionId): ExtensionUsageControlItem[] => {
      const extension = catalogById.get(extensionId) ?? {
        extensionId,
        category: "user" as const,
        title: extensionId,
        description: "Custom extension usage override.",
        usagePolicy: {
          canonicalOrder:
            Number.MAX_SAFE_INTEGER as AgentExtensionCatalogItem["usagePolicy"]["canonicalOrder"],
          baselineUsage: {
            orchestrator: "unavailable" as const,
            handler: "unavailable" as const,
            "workflow-task": "unavailable" as const,
          },
          networkAccess: "not-required" as const,
          configurable: true,
          fixedReason: null,
        },
      };
      const hasStoredUsage = input.usage[extension.extensionId] !== undefined;
      const productBaseline = baselineExtensionState({
        actor: input.actor,
        extension,
        actorDefaults: input.actorDefaults,
        networkAccess: input.networkAccess,
      });
      if (
        extension.category !== "user" &&
        !hasStoredUsage &&
        extension.extensionId !== "extension-loading" &&
        productBaseline === "unavailable"
      ) {
        return [];
      }
      const state = resolvedExtensionState({
        actor: input.actor,
        extension,
        explicitUsage: input.usage,
        actorDefaults: input.actorDefaults,
        networkAccess: input.networkAccess,
      });
      const defaultUsage = { ...input.usage };
      delete defaultUsage[extension.extensionId];
      const defaultState = resolvedExtensionState({
        actor: input.actor,
        extension,
        explicitUsage: defaultUsage,
        actorDefaults: input.actorDefaults,
        networkAccess: input.networkAccess,
      });
      const explicit = state !== defaultState;
      const configurable = extension.usagePolicy.configurable;
      return [
        {
          id: extension.extensionId,
          title: extension.title,
          description: extension.description,
          category: extension.category,
          state,
          defaultState,
          explicit,
          configurable,
          ...(extension.usagePolicy.fixedReason
            ? { fixedReason: extension.usagePolicy.fixedReason }
            : {}),
          allowedStates: {
            loaded: extensionStateAllowed({
              actor: input.actor,
              extension,
              state: "loaded",
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
      const leftOrder =
        persistedOrderById.get(left.id) ??
        catalogById.get(left.id)?.usagePolicy.canonicalOrder ??
        Number.MAX_SAFE_INTEGER;
      const rightOrder =
        persistedOrderById.get(right.id) ??
        catalogById.get(right.id)?.usagePolicy.canonicalOrder ??
        Number.MAX_SAFE_INTEGER;
      return (
        leftOrder - rightOrder ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
      );
    });
}
