import type { createStateCommandsFacade, createStateFacade } from "@svvy/state";

type BootstrapStateFacade = ReturnType<typeof createStateFacade>;
type BootstrapStateCommandsFacade = ReturnType<typeof createStateCommandsFacade>;

export interface RendererStateFacade {
  readonly readModels: Pick<
    BootstrapStateFacade["readModels"],
    "fetch" | "refetchInvalidation" | "rebaseline"
  >;
}

export interface RendererStateCommandsFacade {
  readonly workspaceChrome: BootstrapStateCommandsFacade["workspaceChrome"];
  readonly workspaceLayout: BootstrapStateCommandsFacade["workspaceLayout"];
  readonly appLogs: BootstrapStateCommandsFacade["appLogs"];
  readonly appPreferences: BootstrapStateCommandsFacade["appPreferences"];
  readonly providerAuth: BootstrapStateCommandsFacade["providerAuth"];
  readonly extensionEnv: Pick<
    BootstrapStateCommandsFacade["extensionEnv"],
    "setOverride" | "removeOverride"
  >;
  readonly agentProfiles: BootstrapStateCommandsFacade["agentProfiles"];
  readonly snippets: BootstrapStateCommandsFacade["snippets"];
}

export function narrowRendererStateFacade(state: BootstrapStateFacade): RendererStateFacade {
  return {
    readModels: {
      fetch: (input, options) => state.readModels.fetch(input, options),
      refetchInvalidation: (input, options) => state.readModels.refetchInvalidation(input, options),
      rebaseline: (input, options) => state.readModels.rebaseline(input, options),
    },
  };
}

export function narrowRendererStateCommandsFacade(
  commands: BootstrapStateCommandsFacade,
): RendererStateCommandsFacade {
  return {
    workspaceChrome: commands.workspaceChrome,
    workspaceLayout: commands.workspaceLayout,
    appLogs: commands.appLogs,
    appPreferences: commands.appPreferences,
    providerAuth: commands.providerAuth,
    extensionEnv: {
      setOverride: (input, options) => commands.extensionEnv.setOverride(input, options),
      removeOverride: (input, options) => commands.extensionEnv.removeOverride(input, options),
    },
    agentProfiles: commands.agentProfiles,
    snippets: commands.snippets,
  };
}
