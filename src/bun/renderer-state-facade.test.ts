import { describe, expect, it } from "bun:test";
import {
  narrowRendererStateCommandsFacade,
  narrowRendererStateFacade,
} from "./renderer-state-facade";
import type { StateCommandsFacade, StateFacade } from "@svvy/state";

describe("narrowRendererStateFacade", () => {
  it("exposes only renderer-safe read-model methods", () => {
    const state = {
      readModels: {
        fetch: async (input) => ({ kind: input.kind, value: null }) as never,
        refetchInvalidation: async () => [],
        rebaseline: async () => ({ app: [], workspaces: [], revision: 0 }) as never,
      },
      close: () => undefined,
    } satisfies StateFacade;

    const rendererState = narrowRendererStateFacade(state);

    expect(Object.keys(rendererState)).toEqual(["readModels"]);
    expect(Object.keys(rendererState.readModels)).toEqual([
      "fetch",
      "refetchInvalidation",
      "rebaseline",
    ]);
    expect("close" in rendererState).toBe(false);
  });

  it("exposes only renderer-safe state command groups", () => {
    const commands = {
      workspaceChrome: {
        setTabs: async () => ({ receipt: {} }) as never,
        selectTab: async () => ({ receipt: {} }) as never,
        selectLayoutSlot: async () => ({ receipt: {} }) as never,
      },
      workspaceLayout: {
        saveSnapshot: async () => ({ receipt: {} }) as never,
        updatePane: async () => ({ receipt: {} }) as never,
        closePane: async () => ({ receipt: {} }) as never,
      },
      appLogs: {
        markRead: async () => ({ receipt: {} }) as never,
        markVisibleRangeRead: async () => ({ receipt: {} }) as never,
        clearWorkspaceUnread: async () => ({ receipt: {} }) as never,
      },
      appPreferences: {
        update: async () => ({ receipt: {} }) as never,
      },
      providerAuth: {
        recordStatus: async () => ({ receipt: {} }) as never,
      },
      extensionEnv: {
        setOverride: async () => ({ receipt: {} }) as never,
        removeOverride: async () => ({ receipt: {} }) as never,
      },
      agentProfiles: {
        updateOrchestrator: async () => ({ receipt: {} }) as never,
        updateThreadHandler: async () => ({ receipt: {} }) as never,
        deleteOrchestrator: async () => ({ receipt: {} }) as never,
        reorderOrchestrators: async () => ({ receipt: {} }) as never,
        setProfileExtensionUsage: async () => ({ receipt: {} }) as never,
        promoteExtensionDefault: async () => ({ receipt: {} }) as never,
        resetActorExtensionDefaults: async () => ({ receipt: {} }) as never,
        setExternalInstructionActorUsage: async () => ({ receipt: {} }) as never,
      },
      snippets: {
        createManaged: async () => ({ receipt: {}, snippetId: "snippet-test" }) as never,
        updateManaged: async () => ({ receipt: {} }) as never,
        deleteManaged: async () => ({ receipt: {} }) as never,
        setEnabled: async () => ({ receipt: {} }) as never,
      },
      close: () => undefined,
    } satisfies StateCommandsFacade;

    const rendererCommands = narrowRendererStateCommandsFacade(commands);

    expect(Object.keys(rendererCommands)).toEqual([
      "workspaceChrome",
      "workspaceLayout",
      "appLogs",
      "appPreferences",
      "providerAuth",
      "extensionEnv",
      "agentProfiles",
      "snippets",
    ]);
    expect("close" in rendererCommands).toBe(false);
  });
});
