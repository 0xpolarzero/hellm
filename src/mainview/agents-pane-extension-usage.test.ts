import { describe, expect, it } from "bun:test";
import type { AgentExtensionCatalogItem } from "../shared/workspace-contract";
import {
  canSelectExtensionUsageState,
  extensionUsageItems,
  resolvedExtensionState,
  type ExtensionUsageControlItem,
} from "./agents-pane-extension-usage";

function catalogItem(
  extensionId: string,
  input: Partial<AgentExtensionCatalogItem> & {
    baseline?: Partial<AgentExtensionCatalogItem["usagePolicy"]["baselineUsage"]>;
    canonicalOrder?: number;
    configurable?: boolean;
    networkAccess?: "required" | "not-required";
  } = {},
): AgentExtensionCatalogItem {
  return {
    extensionId,
    category: "builtin",
    title: extensionId,
    description: `${extensionId} extension`,
    usagePolicy: {
      canonicalOrder: (input.canonicalOrder ?? 0) as never,
      baselineUsage: {
        orchestrator: "unavailable",
        handler: "unavailable",
        "workflow-task": "unavailable",
        ...input.baseline,
      },
      networkAccess: input.networkAccess ?? "not-required",
      configurable: input.configurable ?? true,
      fixedReason: input.configurable === false ? "app_native_control" : null,
    },
    ...input,
  };
}

describe("Agents pane extension usage helpers", () => {
  it("resolves package baselines, state actor defaults, and explicit profile overrides", () => {
    const web = catalogItem("web", {
      baseline: { orchestrator: "loaded" },
      networkAccess: "required",
    });
    expect(
      resolvedExtensionState({
        actor: "orchestrator",
        extension: web,
        explicitUsage: {},
        networkAccess: false,
      }),
    ).toBe("unavailable");
    expect(
      resolvedExtensionState({
        actor: "orchestrator",
        extension: web,
        explicitUsage: {},
        actorDefaults: {
          actor: "orchestrator",
          extensionOrder: [],
          extensionUsage: { web: "available" },
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
        networkAccess: false,
      }),
    ).toBe("available");
    expect(
      resolvedExtensionState({
        actor: "orchestrator",
        extension: web,
        explicitUsage: { web: "loaded" },
        networkAccess: false,
      }),
    ).toBe("loaded");
  });

  it("uses canonical policy order unless persisted actor order overrides it", () => {
    const alpha = catalogItem("alpha", {
      category: "user",
      canonicalOrder: 1,
      baseline: { orchestrator: "loaded" },
    });
    const beta = catalogItem("beta", {
      category: "user",
      canonicalOrder: 2,
      baseline: { orchestrator: "available" },
    });
    const canonical = extensionUsageItems({
      actor: "orchestrator",
      extensionCatalogItems: [beta, alpha],
      networkAccess: true,
      profileId: "default",
      usage: {},
    });
    expect(canonical.map((item) => `${item.id}:${item.state}`)).toEqual([
      "alpha:loaded",
      "beta:available",
    ]);

    const persisted = extensionUsageItems({
      actor: "orchestrator",
      extensionCatalogItems: [alpha, beta],
      actorDefaults: {
        actor: "orchestrator",
        extensionOrder: ["beta" as never],
        extensionUsage: {},
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      networkAccess: true,
      profileId: "default",
      usage: {},
    });
    expect(persisted.map((item) => item.id)).toEqual(["beta", "alpha"]);
  });

  it("marks only real profile overrides explicit", () => {
    const smithers = catalogItem("smithers", {
      baseline: { orchestrator: "available" },
    });
    expect(
      extensionUsageItems({
        actor: "orchestrator",
        extensionCatalogItems: [smithers],
        networkAccess: true,
        profileId: "default",
        usage: { smithers: "available" },
      })[0],
    ).toMatchObject({ state: "available", defaultState: "available", explicit: false });
    expect(
      extensionUsageItems({
        actor: "orchestrator",
        extensionCatalogItems: [smithers],
        networkAccess: true,
        profileId: "default",
        usage: { smithers: "loaded" },
      })[0],
    ).toMatchObject({ state: "loaded", defaultState: "available", explicit: true });
  });

  it("preserves fixed package policy and unknown explicit extension rows", () => {
    const fixed = catalogItem("extension-loading", {
      baseline: { orchestrator: "loaded" },
      configurable: false,
    });
    const rows = extensionUsageItems({
      actor: "orchestrator",
      extensionCatalogItems: [fixed],
      networkAccess: true,
      profileId: "default",
      usage: { unknown: "available" },
    });
    expect(rows.find((item) => item.id === "extension-loading")).toMatchObject({
      configurable: false,
      fixedReason: "app_native_control",
    });
    expect(rows.find((item) => item.id === "unknown")).toMatchObject({
      category: "user",
      configurable: true,
      state: "available",
    });
  });

  it("does not allow selecting the active or a policy-disabled state", () => {
    const item: ExtensionUsageControlItem = {
      allowedStates: { available: true, loaded: true, unavailable: true },
      category: "builtin",
      configurable: true,
      defaultState: "available",
      description: "Web search guidance",
      explicit: false,
      id: "web",
      state: "available",
      title: "Web",
    };
    expect(
      canSelectExtensionUsageState({ disabled: false, pending: false, item, state: "available" }),
    ).toBe(false);
    expect(
      canSelectExtensionUsageState({ disabled: false, pending: false, item, state: "loaded" }),
    ).toBe(true);
    expect(
      canSelectExtensionUsageState({
        disabled: false,
        pending: false,
        item: { ...item, configurable: false },
        state: "loaded",
      }),
    ).toBe(false);
  });
});
