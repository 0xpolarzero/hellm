import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  DefaultResourceLoader,
  ModelRegistry,
  SettingsManager,
  type AgentSession,
  type SessionManager,
} from "@mariozechner/pi-coding-agent";

export async function createPiHistoryNavigationAgentSession(input: {
  readonly cwd: string;
  readonly agentDir: string;
  readonly modelRegistryPath: string;
  readonly sessionManager: SessionManager;
}): Promise<AgentSession> {
  const authStorage = AuthStorage.inMemory();
  const modelRegistryFactory = ModelRegistry as unknown as {
    create?: (authStorage: AuthStorage, modelPath: string) => ModelRegistry;
    new (authStorage: AuthStorage, modelPath: string): ModelRegistry;
  };
  const modelRegistry =
    typeof modelRegistryFactory.create === "function"
      ? modelRegistryFactory.create(authStorage, input.modelRegistryPath)
      : new modelRegistryFactory(authStorage, input.modelRegistryPath);
  const settingsManager = SettingsManager.create(input.cwd, input.agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir,
    settingsManager,
    additionalExtensionPaths: [],
    additionalSkillPaths: [],
    additionalPromptTemplatePaths: [],
    additionalThemePaths: [],
    extensionFactories: [],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPromptOverride: () => "",
    appendSystemPromptOverride: () => [],
    extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    themesOverride: () => ({ themes: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir: input.agentDir,
    authStorage,
    modelRegistry,
    sessionManager: input.sessionManager,
    settingsManager,
    noTools: "builtin",
    customTools: [],
    resourceLoader,
  });
  return session;
}
