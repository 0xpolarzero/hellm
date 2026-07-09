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
      close: () => undefined,
    } satisfies StateCommandsFacade;

    const rendererCommands = narrowRendererStateCommandsFacade(commands);

    expect(Object.keys(rendererCommands)).toEqual(["appLogs", "appPreferences", "providerAuth"]);
    expect("close" in rendererCommands).toBe(false);
  });
});
