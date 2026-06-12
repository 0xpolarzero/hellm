import { describe, expect, it } from "bun:test";
import type { ExtensionInventoryItemReadModel } from "../shared/workspace-contract";
import {
  canSelectExtensionUsageState,
  extensionUsageItems,
  resolvedExtensionState,
  type ExtensionUsageControlItem,
} from "./agents-pane-extension-usage";

function extensionInventoryItem(
  input: Partial<ExtensionInventoryItemReadModel> & Pick<ExtensionInventoryItemReadModel, "id">,
): ExtensionInventoryItemReadModel {
  const { id, ...overrides } = input;
  return {
    category: "builtin",
    customized: false,
    description: `${id} extension`,
    id,
    interface: "instructions",
    minimalInstruction: {
      name: "minimal.md",
      path: "",
      content: "",
      sourceVersion: "",
      skipped: false,
      editable: false,
      generated: false,
      tokenCount: {
        tokens: 0,
        accuracy: "estimated",
      },
    },
    requirements: {
      cliRequirements: [],
      env: [],
    },
    state: {
      issues: [],
      ready: true,
    },
    title: id,
    typescriptApiEnabled: false,
    usage: [],
    ...overrides,
  };
}

describe("Agents pane extension usage helpers", () => {
  it("resolves implicit builtin Web usage from the local network-aware baseline", () => {
    const web = extensionInventoryItem({
      id: "web",
      usage: [
        {
          actorKind: "orchestrator",
          agentProfile: "default",
          configurable: true,
          state: "default_loaded",
        },
      ],
    });

    expect(
      resolvedExtensionState({
        actor: "orchestrator",
        extension: web,
        explicitUsage: {},
        inventoryUsage: web.usage[0] ?? null,
        networkAccess: false,
      }),
    ).toBe("unavailable");

    expect(
      resolvedExtensionState({
        actor: "orchestrator",
        extension: web,
        explicitUsage: {},
        inventoryUsage: { ...web.usage[0]!, state: "unavailable" },
        networkAccess: true,
      }),
    ).toBe("default_loaded");
  });

  it("keeps explicit overrides resolved through actor extension policy", () => {
    const web = extensionInventoryItem({
      id: "web",
      usage: [
        {
          actorKind: "orchestrator",
          agentProfile: "default",
          configurable: true,
          state: "default_loaded",
        },
      ],
    });

    expect(
      resolvedExtensionState({
        actor: "orchestrator",
        extension: web,
        explicitUsage: { web: "default_loaded" },
        inventoryUsage: web.usage[0] ?? null,
        networkAccess: false,
      }),
    ).toBe("unavailable");

    expect(
      resolvedExtensionState({
        actor: "orchestrator",
        extension: web,
        explicitUsage: { web: "unavailable" },
        inventoryUsage: web.usage[0] ?? null,
        networkAccess: true,
      }),
    ).toBe("unavailable");
  });

  it("preserves inventory defaults for user extensions", () => {
    const userExtension = extensionInventoryItem({
      category: "user",
      id: "team-notes",
      usage: [
        {
          actorKind: "handler",
          agentProfile: "threadHandler",
          configurable: true,
          state: "available",
        },
      ],
    });

    expect(
      extensionUsageItems({
        actor: "handler",
        extensionInventoryItems: [userExtension],
        networkAccess: false,
        profileId: "threadHandler",
        usage: {},
      }),
    ).toEqual([
      expect.objectContaining({
        explicit: false,
        id: "team-notes",
        state: "available",
      }),
    ]);
  });

  it("does not count stored no-op usage entries as overrides", () => {
    const items = extensionUsageItems({
      actor: "orchestrator",
      extensionInventoryItems: [
        extensionInventoryItem({
          id: "smithers",
          title: "Smithers",
          usage: [
            {
              actorKind: "orchestrator",
              agentProfile: "default",
              configurable: true,
              state: "available",
            },
          ],
        }),
      ],
      networkAccess: true,
      profileId: "default",
      usage: { smithers: "available" },
    });

    expect(items).toEqual([
      expect.objectContaining({
        defaultState: "available",
        explicit: false,
        id: "smithers",
        state: "available",
      }),
    ]);
  });

  it("marks true usage overrides against the default state", () => {
    const items = extensionUsageItems({
      actor: "orchestrator",
      extensionInventoryItems: [
        extensionInventoryItem({
          id: "smithers",
          title: "Smithers",
          usage: [
            {
              actorKind: "orchestrator",
              agentProfile: "default",
              configurable: true,
              state: "available",
            },
          ],
        }),
      ],
      networkAccess: true,
      profileId: "default",
      usage: { smithers: "default_loaded" },
    });

    expect(items).toEqual([
      expect.objectContaining({
        defaultState: "available",
        explicit: true,
        id: "smithers",
        state: "default_loaded",
      }),
    ]);
  });

  it("keeps extension order stable independent of resolved usage state", () => {
    const first = extensionInventoryItem({
      category: "user",
      id: "first-extension",
      title: "First Extension",
      usage: [
        {
          actorKind: "orchestrator",
          agentProfile: "default",
          configurable: true,
          state: "unavailable",
        },
      ],
    });
    const second = extensionInventoryItem({
      category: "user",
      id: "second-extension",
      title: "Second Extension",
      usage: [
        {
          actorKind: "orchestrator",
          agentProfile: "default",
          configurable: true,
          state: "default_loaded",
        },
      ],
    });
    const third = extensionInventoryItem({
      category: "user",
      id: "third-extension",
      title: "Third Extension",
      usage: [
        {
          actorKind: "orchestrator",
          agentProfile: "default",
          configurable: true,
          state: "available",
        },
      ],
    });

    expect(
      extensionUsageItems({
        actor: "orchestrator",
        extensionInventoryItems: [first, second, third],
        networkAccess: true,
        profileId: "default",
        usage: {},
      }).map((item) => `${item.id}:${item.state}`),
    ).toEqual([
      "first-extension:unavailable",
      "second-extension:default_loaded",
      "third-extension:available",
    ]);
  });

  it("projects app extension defaults into non-handler profile rows", () => {
    const items = extensionUsageItems({
      actor: "orchestrator",
      extensionDefaults: {
        order: ["team-notes", "smithers"],
        usage: {
          orchestrator: {
            "team-notes": "default_loaded",
            smithers: "default_loaded",
          },
        },
      },
      extensionInventoryItems: [
        extensionInventoryItem({
          category: "user",
          id: "team-notes",
          title: "Team Notes",
          usage: [],
        }),
        extensionInventoryItem({
          id: "smithers",
          title: "Smithers",
          usage: [],
        }),
      ],
      networkAccess: true,
      profileId: "default",
      usage: {},
    });

    expect(items.map((item) => `${item.id}:${item.state}:${item.explicit}`)).toEqual([
      "team-notes:default_loaded:false",
      "smithers:default_loaded:false",
    ]);
  });

  it("keeps handler profile rows owned by Agents instead of app extension defaults", () => {
    const items = extensionUsageItems({
      actor: "handler",
      extensionDefaults: {
        order: ["team-notes"],
        usage: {
          handler: {
            "team-notes": "default_loaded",
          },
        },
      },
      extensionInventoryItems: [
        extensionInventoryItem({
          category: "user",
          id: "team-notes",
          title: "Team Notes",
          usage: [],
        }),
      ],
      networkAccess: true,
      profileId: "threadHandler",
      usage: {},
    });

    expect(items).toEqual([
      expect.objectContaining({
        defaultState: "unavailable",
        explicit: false,
        id: "team-notes",
        state: "unavailable",
      }),
    ]);
  });

  it("does not allow selecting the already active usage state", () => {
    const item: ExtensionUsageControlItem = {
      allowedStates: {
        available: true,
        default_loaded: true,
        unavailable: true,
      },
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
      canSelectExtensionUsageState({
        disabled: false,
        item,
        pending: false,
        state: "available",
      }),
    ).toBe(false);
    expect(
      canSelectExtensionUsageState({
        disabled: false,
        item,
        pending: false,
        state: "unavailable",
      }),
    ).toBe(true);
  });
});
