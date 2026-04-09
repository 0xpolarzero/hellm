import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  InteractiveMode,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
} from "@mariozechner/pi-coding-agent";
import type { OrchestratorDependencies } from "@hellm/orchestrator";
import { createHellmExtension } from "./hellm-extension.ts";

interface RuntimeRef {
  current?: AgentSessionRuntime;
}

export type HellmOrchestratorOverrides = Pick<
  OrchestratorDependencies,
  | "classifier"
  | "clock"
  | "idGenerator"
  | "piBridge"
  | "smithersBridge"
  | "verificationRunner"
>;

export interface HellmRuntimeOptions {
  cwd?: string;
  orchestratorOverrides?: HellmOrchestratorOverrides;
}

export interface HellmTuiStartOptions extends HellmRuntimeOptions {
  initOnly?: boolean;
  initialMessage?: string;
}

export async function createHellmRuntime(
  options: HellmRuntimeOptions = {},
): Promise<AgentSessionRuntime> {
  const cwd = options.cwd ?? process.cwd();
  const agentDir = getAgentDir();
  const runtimeRef: RuntimeRef = {};

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      agentDir,
      resourceLoaderOptions: {
        extensionFactories: [
          createHellmExtension({
            runtimeRef,
            ...(options.orchestratorOverrides
              ? { orchestratorOverrides: options.orchestratorOverrides }
              : {}),
          }),
        ],
      },
    });

    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(sessionStartEvent ? { sessionStartEvent } : {}),
    });

    return {
      ...created,
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd),
  });
  runtimeRef.current = runtime;
  return runtime;
}

export async function startHellmTui(
  options: HellmTuiStartOptions = {},
): Promise<void> {
  const runtime = await createHellmRuntime(options);
  const initOnly =
    options.initOnly ??
    (process.env.HELLM_TUI_INIT_ONLY === "1" ||
      process.env.HELLM_TUI_INIT_ONLY === "true");

  try {
    if (initOnly) {
      const commands = runtime.session.extensionRunner
        ?.getRegisteredCommands()
        .map((command) => `/${command.invocationName}`)
        .join(",");
      console.log(`[hellm/tui] pi-runtime ${runtime.cwd}`);
      console.log(`[hellm/tui] hellm-commands ${commands ?? ""}`);
      return;
    }

    const mode = new InteractiveMode(runtime, {
      migratedProviders: [],
      ...(runtime.modelFallbackMessage
        ? { modelFallbackMessage: runtime.modelFallbackMessage }
        : {}),
      ...(options.initialMessage
        ? { initialMessage: options.initialMessage }
        : {}),
      initialImages: [],
      initialMessages: [],
    });
    await mode.run();
  } finally {
    await runtime.dispose();
  }
}
