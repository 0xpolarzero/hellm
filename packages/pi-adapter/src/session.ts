import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
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
import type {
  NativeToolDeclaration,
  NativeToolResult,
  PiToolExecutor,
  RuntimeToolExecutionError,
  SurfacePiSessionId,
  ToolCallId,
  TurnId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";
import { createPiCustomToolDefinitions } from "./native-tools";

type CreateAgentSessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;
type PiManagedSessionModel = NonNullable<CreateAgentSessionOptions["model"]>;
type PiManagedSessionThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export interface CreatePiManagedAgentSessionInput {
  cwd: string;
  agentDir: string;
  sessionManager: SessionManager;
  provider: string;
  model: string;
  thinkingLevel: PiManagedSessionThinkingLevel;
  systemPrompt: string;
  tools: readonly NativeToolDeclaration[];
  toolExecutor: PiToolExecutor;
  runToolEffect: (
    effect: Effect.Effect<NativeToolResult, RuntimeToolExecutionError>,
  ) => Promise<NativeToolResult>;
  getToolExecutionContext: (input: {
    readonly piToolCallId: ToolCallId;
    readonly toolName: string;
  }) => {
    readonly turnId: TurnId;
    readonly surfacePiSessionId: SurfacePiSessionId;
  };
  syncAuthStorage?: (authStorage: AuthStorage) => void;
}

export interface CreatePiManagedAgentSessionResult {
  session: AgentSession;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  activeModel: PiManagedSessionModel;
}

export async function createPiManagedAgentSession(
  input: CreatePiManagedAgentSessionInput,
): Promise<CreatePiManagedAgentSessionResult> {
  const authStorage = AuthStorage.inMemory();
  input.syncAuthStorage?.(authStorage);
  const customTools = createPiCustomToolDefinitions(
    input.tools,
    input.toolExecutor,
    input.runToolEffect,
    input.getToolExecutionContext,
  );
  const modelRegistryFactory = ModelRegistry as unknown as {
    create?: (authStorage: AuthStorage, modelPath: string) => ModelRegistry;
    new (authStorage: AuthStorage, modelPath: string): ModelRegistry;
  };
  const modelRegistryPath = join(input.agentDir, "models.json");
  const modelRegistry =
    typeof modelRegistryFactory.create === "function"
      ? modelRegistryFactory.create(authStorage, modelRegistryPath)
      : new modelRegistryFactory(authStorage, modelRegistryPath);
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
    systemPromptOverride: () => input.systemPrompt,
    appendSystemPromptOverride: () => [],
    extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    themesOverride: () => ({ themes: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  });
  await resourceLoader.reload();

  const resolvedModel = resolvePiManagedSessionModel(modelRegistry, input.provider, input.model);
  if (!resolvedModel) {
    throw new Error(`Model not found: ${input.provider}/${input.model}`);
  }

  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir: input.agentDir,
    authStorage,
    modelRegistry,
    sessionManager: input.sessionManager,
    settingsManager,
    model: resolvedModel,
    thinkingLevel: input.thinkingLevel,
    noTools: "builtin",
    customTools,
    resourceLoader,
  });
  session.setActiveToolsByName(customTools.map((tool) => tool.name));
  session.agent.state.systemPrompt = input.systemPrompt;

  return {
    session,
    authStorage,
    modelRegistry,
    activeModel: session.agent.state.model ?? resolvedModel,
  };
}

function resolvePiManagedSessionModel(
  modelRegistry: ModelRegistry,
  provider: string,
  model: string,
): PiManagedSessionModel | undefined {
  return (
    modelRegistry.find(provider, model) ??
    getModel(provider as Parameters<typeof getModel>[0], model as Parameters<typeof getModel>[1])
  );
}
