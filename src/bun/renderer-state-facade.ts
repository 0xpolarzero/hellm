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
  readonly appLogs: BootstrapStateCommandsFacade["appLogs"];
  readonly appPreferences: BootstrapStateCommandsFacade["appPreferences"];
  readonly providerAuth: BootstrapStateCommandsFacade["providerAuth"];
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
    appLogs: commands.appLogs,
    appPreferences: commands.appPreferences,
    providerAuth: commands.providerAuth,
  };
}
