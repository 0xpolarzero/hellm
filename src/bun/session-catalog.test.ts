import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import * as Effect from "effect/Effect";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, StopReason, ToolCall } from "@mariozechner/pi-ai";
import type { PromptTarget } from "../shared/workspace-contract";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";
import {
  DEFAULT_AGENT_SETTINGS_STATE,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
  DEFAULT_THREAD_HANDLER_PROFILE_ID,
  type AgentProfileSettings,
} from "../shared/agent-settings";
import { buildSystemPrompt } from "./default-system-prompt";
import { createPromptExecutionContext } from "@svvy/runtime/prompt-execution-context";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeSessionWaitStatePort,
  type AbsolutePath,
  type BuildLaunchPolicyInput,
  type PromptExecutionContext,
  type RuntimeApprovalId,
  type SandboxLaunchFacts,
  type StateInvalidationDescriptor,
  type WorkspaceId,
} from "@svvy/core";
import { RuntimeEventBus } from "../../packages/runtime/src/runtime-event-bus";
import { answerRuntimeApproval } from "../../packages/runtime/src/runtime-approval-answer";
import { requestRuntimeDirectToolApproval } from "../../packages/runtime/src/runtime-direct-tool-approval";
import {
  createRuntimeApprovalWaitService,
  RuntimeApprovalWaitService,
  type RuntimeApprovalWaitServiceService,
} from "../../packages/runtime/src/runtime-approval-wait-service";
import {
  getSvvyAgentDir,
  getSvvyDataDir,
  getSvvySessionDir,
  normalizeGeneratedTitle,
  WorkspaceSessionCatalog,
  resolveRestoredSessionDefaults,
  type CatalogAgentProfileAuthority,
  type CatalogAgentProfileAuthoritySnapshot,
  type SessionDefaults,
} from "./session-catalog";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import { createAgentSettingsStore } from "./agent-settings-store";
import type { StructuredSessionStateStore } from "@svvy/state/structured-session-state";
import type { ExtensionUsageState } from "@svvy/extensions";
import { setPiTitleCompletionForTests } from "../../packages/pi-adapter/src/pi-adapter";

const tempDirs: string[] = [];

const runCatalogEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

const catalogApprovalWaitServices = new WeakMap<
  WorkspaceSessionCatalog,
  RuntimeApprovalWaitServiceService
>();

const testRuntimeEventBus = RuntimeEventBus.of({
  publishLive: () =>
    Effect.die(new Error("Unexpected live runtime event in approval test harness.")),
  publishStateInvalidations: () => Effect.succeed([]),
  subscribe: () =>
    Effect.die(new Error("Unexpected runtime event subscription in approval test harness.")),
});

const DEFAULTS: SessionDefaults = {
  provider: "openai",
  model: "gpt-4o",
  thinkingLevel: "medium",
};

describe("svvy storage paths", () => {
  it("roots PI runtime state under the svvy pi directory", () => {
    expect(getSvvyAgentDir()).toBe(join(getSvvyDataDir(), "pi"));
  });
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

type PromptableSession = {
  prompt(
    promptText: string,
    options?: {
      expandPromptTemplates?: boolean;
    },
  ): Promise<void>;
  steer(text: string): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  abort(): Promise<void>;
  agent: {
    state: {
      messages: Message[];
      systemPrompt?: string;
    };
  };
  sessionManager: {
    appendMessage(message: Message): void;
    buildSessionContext(): { messages: Message[] };
    getSessionFile(): string;
  };
};

type ManagedSurfaceRecord = {
  sessionId: string;
  actorKind: "orchestrator" | "handler" | "workflow-task" | "namer";
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  agentProfileId: string;
  systemPrompt: string;
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  externalContextSources: GeneratedAgentContextExternalSource[];
  externalSourceHashes: string[];
  smithersToolSurfaceVersion?: string | null;
  loadedExtensionIds: string[];
  availableExtensionIds: string[];
  session: PromptableSession;
  activePrompt: boolean;
  abortRequested: boolean;
  recreateOnNextPrompt: boolean;
  retainCount: number;
  promptExecutionRuntime: {
    current: PromptExecutionContext | null;
  };
};

function createWorkspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), "svvy-sessions-"));
  tempDirs.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const sessionDir = getSvvySessionDir(cwd, agentDir);
  const workflowsSourceRoot = join(root, "workflows");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  return { cwd, agentDir, sessionDir, workflowsSourceRoot };
}

function configureHermeticTitleNamer(agentDir: string): () => void {
  const previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "svvy-test-anthropic-key";
  writeFileSync(
    join(agentDir, "agent-settings.json"),
    `${JSON.stringify(
      {
        ...DEFAULT_AGENT_SETTINGS_STATE,
        agents: {
          ...DEFAULT_AGENT_SETTINGS_STATE.agents,
          titleNamer: {
            ...DEFAULT_AGENT_SETTINGS_STATE.agents.titleNamer,
            provider: "anthropic",
            model: "claude-sonnet-4-5",
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  return () => {
    if (previousAnthropicApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey;
    }
  };
}

function createWorkspaceSessionCatalog(
  cwd: string,
  agentDir: string,
  sessionDir: string,
  approvalBoundary?: RuntimeApprovalBoundary,
  managedSandbox: boolean | (() => boolean) = false,
  recoveryOptions: {
    artifactDirectory?: string;
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
    workflowsSourceRoot?: string;
    acquireExecuteTypescriptLaunch?: (
      input: Omit<BuildLaunchPolicyInput, "launchKind">,
    ) => Promise<{
      facts: SandboxLaunchFacts;
      close(): Promise<void>;
    }>;
    wakeSurfaceQueue?: (target: PromptTarget) => Promise<void>;
  } = {
    workflowsSourceRoot: join(agentDir, "..", "workflows"),
  },
  startRecovery = true,
): WorkspaceSessionCatalog {
  const approvalWaitService = createRuntimeApprovalWaitService();
  let catalog!: WorkspaceSessionCatalog;
  const runtimeApprovalBoundary: RuntimeApprovalBoundary =
    approvalBoundary ??
    ((input) =>
      runCatalogEffect(
        requestRuntimeDirectToolApproval(input).pipe(
          Effect.provideService(RuntimeApprovalStatePort, catalog.getRuntimeApprovalStatePort()),
          Effect.provideService(RuntimeCommandStatePort, catalog.getRuntimeCommandStatePort()),
          Effect.provideService(
            RuntimeSessionWaitStatePort,
            catalog.getRuntimeSessionWaitStatePort(),
          ),
          Effect.provideService(RuntimeEventBus, testRuntimeEventBus),
          Effect.provideService(RuntimeApprovalWaitService, approvalWaitService),
        ),
      ));
  catalog = new WorkspaceSessionCatalog(
    cwd,
    agentDir,
    sessionDir,
    undefined,
    {
      wakeSurfaceQueue: async () => undefined,
      ...recoveryOptions,
    },
    runtimeApprovalBoundary,
    managedSandbox,
    undefined,
    runCatalogEffect,
  );
  catalog.setAgentProfileAuthority(createInMemoryCatalogAgentProfileAuthority());
  catalog.setRequestInputSettingsAuthority({
    read: () => catalog.workspaceStateRouterRegistration().store.readRequestInputSettings(),
  });
  if (startRecovery) {
    void catalog
      .prepareWorkspaceRecoveryAfterRegistration()
      .then(() => catalog.startWorkspaceRecovery());
  }
  catalogApprovalWaitServices.set(catalog, approvalWaitService);
  return catalog;
}

function createInMemoryCatalogAgentProfileAuthority(): CatalogAgentProfileAuthority {
  let snapshot: CatalogAgentProfileAuthoritySnapshot = {
    configuredProfiles: [
      {
        profileId: DEFAULT_ORCHESTRATOR_PROFILE_ID as never,
        actor: "orchestrator" as const,
        name: "Default orchestrator",
        providerId: "zai" as never,
        modelId: "glm-5-turbo" as never,
        reasoning: { effort: "medium" },
        followComposer: false,
        extensionUsage: {},
        extensionOrder: [],
        position: 0,
        updatedAt: "2026-07-11T00:00:00.000Z" as never,
        builtin: true,
        locked: true,
        deletable: false,
      },
      {
        profileId: DEFAULT_THREAD_HANDLER_PROFILE_ID as never,
        actor: "handler" as const,
        name: "Thread handler",
        providerId: "zai" as never,
        modelId: "glm-5-turbo" as never,
        reasoning: { effort: "medium" },
        followComposer: false,
        extensionUsage: {},
        extensionOrder: [],
        position: 0,
        updatedAt: "2026-07-11T00:00:00.000Z" as never,
        builtin: true,
        locked: true,
        deletable: false,
      },
    ],
    workflowAgents: [
      {
        id: "explorer",
        label: "Explorer",
        instructions:
          "Inspect the repository and return concise findings, evidence, and unresolved questions. Do not edit files.",
      },
      {
        id: "implementer",
        label: "Implementer",
        instructions:
          "Implement the assigned scoped change, keep edits focused, and return changed files plus verification.",
      },
      {
        id: "reviewer",
        label: "Reviewer",
        instructions:
          "Review the assigned result for correctness, regressions, edge cases, and missing tests. Lead with findings.",
      },
    ].map((agent) => ({
      sourceId: agent.id,
      path: `/test/workflows/agents/${agent.id}.agent.json` as never,
      sourceVersion: `sha256:${agent.id}`,
      fingerprint: `sha256:${agent.id}`,
      validationStatus: "valid" as const,
      diagnostics: [],
      parameters: {
        id: agent.id,
        label: agent.label,
        provider: "zai",
        model: "glm-5-turbo",
        reasoning: { effort: "medium" as const },
        instructions: agent.instructions,
        overrides: {},
      },
      extensionOrder: [],
      observedAt: "2026-07-11T00:00:00.000Z" as never,
      updatedAt: "2026-07-11T00:00:00.000Z" as never,
      builtin: true,
      deletable: false,
    })),
    actorExtensionDefaults: (["orchestrator", "workflow-task"] as const).map((actor) => ({
      actor,
      extensionUsage: {},
      extensionOrder: [],
      updatedAt: "2026-07-11T00:00:00.000Z" as never,
    })),
  };
  const replaceProfile = (
    actor: "orchestrator" | "handler",
    profile: {
      profileId: string;
      name: string;
      providerId: string;
      modelId: string;
      reasoning?: { effort: string };
      extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
      extensionOrder?: readonly string[];
      followComposer?: boolean;
    },
  ) => {
    const current = snapshot.configuredProfiles.find(
      (candidate) => candidate.actor === actor && candidate.profileId === profile.profileId,
    );
    const next = {
      profileId: profile.profileId as never,
      actor,
      name: profile.name,
      providerId: profile.providerId as never,
      modelId: profile.modelId as never,
      reasoning: profile.reasoning ?? null,
      followComposer: profile.followComposer ?? false,
      extensionUsage: { ...profile.extensionUsage },
      extensionOrder: [...(profile.extensionOrder ?? [])] as never,
      position:
        current?.position ??
        snapshot.configuredProfiles.filter((candidate) => candidate.actor === actor).length,
      updatedAt: "2026-07-11T00:00:00.000Z" as never,
      builtin: current?.builtin ?? false,
      locked: current?.locked ?? false,
      deletable: current?.deletable ?? actor === "orchestrator",
    };
    snapshot = {
      ...snapshot,
      configuredProfiles: [
        ...snapshot.configuredProfiles.filter(
          (candidate) => !(candidate.actor === actor && candidate.profileId === profile.profileId),
        ),
        next,
      ].toSorted((left, right) => left.position - right.position),
    };
  };
  const commitWorkflowAgentSource = (sourceId: string, text: string) => {
    const current = snapshot.workflowAgents.find((source) => source.sourceId === sourceId);
    const source = JSON.parse(text) as {
      id: string;
      label: string;
      provider: string;
      model: string;
      reasoning: { effort: string };
      instructions: string;
      overrides?: Record<string, ExtensionUsageState>;
      extensionOrder?: string[];
    };
    const sourceVersion = `test:${text}`;
    snapshot = {
      ...snapshot,
      workflowAgents: [
        ...snapshot.workflowAgents.filter((record) => record.sourceId !== sourceId),
        {
          sourceId,
          path: `/test/workflows/agents/${sourceId}.agent.json` as never,
          sourceVersion,
          fingerprint: sourceVersion,
          validationStatus: "valid",
          diagnostics: [],
          parameters: {
            id: source.id,
            label: source.label,
            provider: source.provider,
            model: source.model,
            reasoning: source.reasoning as never,
            instructions: source.instructions,
            overrides: { ...source.overrides },
          },
          extensionOrder: [...(source.extensionOrder ?? [])] as never,
          observedAt: "2026-07-11T00:00:00.000Z" as never,
          updatedAt: "2026-07-11T00:00:00.000Z" as never,
          builtin: current?.builtin ?? false,
          deletable: current?.deletable ?? true,
        },
      ],
    };
  };
  return {
    read: async () => structuredClone(snapshot),
    updateOrchestrator: async (profile) => {
      replaceProfile("orchestrator", profile);
    },
    updateThreadHandler: async (profile) => {
      replaceProfile("handler", profile);
    },
    setProfileExtensionUsage: async (input) => {
      const profile = snapshot.configuredProfiles.find(
        (candidate) => candidate.actor === input.actor && candidate.profileId === input.profileId,
      );
      if (!profile) throw new Error(`Unknown ${input.actor} agent profile: ${input.profileId}`);
      const extensionUsage = { ...profile.extensionUsage };
      const actorDefault = snapshot.actorExtensionDefaults.find(
        (candidate) => candidate.actor === input.actor,
      )?.extensionUsage[input.extensionId];
      if (input.actor === "orchestrator" && actorDefault === input.usage) {
        delete extensionUsage[input.extensionId];
      } else {
        extensionUsage[input.extensionId] = input.usage;
      }
      snapshot = {
        ...snapshot,
        configuredProfiles: snapshot.configuredProfiles.map((candidate) =>
          candidate === profile ? { ...candidate, extensionUsage } : candidate,
        ),
      };
    },
    setActorExtensionDefaults: async (input) => {
      snapshot = {
        ...snapshot,
        actorExtensionDefaults: snapshot.actorExtensionDefaults.map((defaults) =>
          defaults.actor === input.actor
            ? {
                ...defaults,
                extensionUsage: { ...input.extensionUsage },
                extensionOrder: [...input.extensionOrder] as never,
              }
            : defaults,
        ),
      };
    },
    saveWorkflowAgentSource: async (input) => {
      const current = snapshot.workflowAgents.find((source) => source.sourceId === input.sourceId);
      if (current && current.sourceVersion !== input.expectedSourceVersion) {
        throw new Error(`Stale workflow-agent source: ${input.sourceId}`);
      }
      commitWorkflowAgentSource(input.sourceId, input.text);
    },
    upsertWorkflowAgentSource: async (input) => {
      const current = snapshot.workflowAgents.find((source) => source.sourceId === input.sourceId);
      if (current && !input.overwrite) {
        throw new Error(`Workflow source already exists: ${input.sourceId}`);
      }
      commitWorkflowAgentSource(input.sourceId, input.text);
    },
  };
}

async function answerRuntimeApprovalThroughRuntime(
  catalog: WorkspaceSessionCatalog,
  input: {
    approved: boolean;
    reason?: string | null;
    requestId: string;
  },
): Promise<void> {
  const approvalWaitService = catalogApprovalWaitServices.get(catalog);
  if (!approvalWaitService) {
    throw new Error("Catalog approval wait service is not registered for this test catalog.");
  }
  await runCatalogEffect(
    answerRuntimeApproval({
      approvalId: input.requestId as RuntimeApprovalId,
      decision: input.approved ? "approved" : "denied",
      reason: input.reason ?? undefined,
    }).pipe(
      Effect.provideService(RuntimeApprovalStatePort, catalog.getRuntimeApprovalStatePort()),
      Effect.provideService(RuntimeCommandStatePort, catalog.getRuntimeCommandStatePort()),
      Effect.provideService(RuntimeSessionWaitStatePort, catalog.getRuntimeSessionWaitStatePort()),
      Effect.provideService(RuntimeEventBus, testRuntimeEventBus),
      Effect.provideService(RuntimeApprovalWaitService, approvalWaitService),
    ),
  );
}

function userMessage(text: string): Message {
  return {
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text }],
  };
}

function assistantMessage(
  text: string,
  options: {
    errorMessage?: string;
    stopReason?: StopReason;
    provider?: string;
    model?: string;
    toolCalls?: ToolCall[];
  } = {},
): Message {
  const content: AssistantMessage["content"] = [{ type: "text", text }];
  if (options.toolCalls) {
    content.push(...options.toolCalls);
  }

  return {
    role: "assistant",
    timestamp: Date.now(),
    api: `${options.provider ?? "openai"}-responses`,
    provider: options.provider ?? "openai",
    model: options.model ?? "gpt-4o",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: options.stopReason ?? "stop",
    errorMessage: options.errorMessage,
    content,
  };
}

function appendMessagesToSession(session: PromptableSession, messages: readonly Message[]): void {
  for (const message of messages) {
    session.sessionManager.appendMessage(message);
    session.agent.state.messages = [...session.agent.state.messages, message];
  }
}

function createThreadTarget(
  workspaceSessionId: string,
  surfacePiSessionId: string,
  threadId: string,
): PromptTarget {
  return {
    workspaceSessionId,
    surface: "handler",
    surfacePiSessionId,
    threadId,
  };
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await Bun.sleep(10);
  }

  throw new Error("Timed out waiting for test condition.");
}

function getStructuredSessionStore(catalog: WorkspaceSessionCatalog): StructuredSessionStateStore {
  return (catalog as unknown as { structuredSessionStore: StructuredSessionStateStore })
    .structuredSessionStore;
}

function getManagedSurfaces(catalog: WorkspaceSessionCatalog): Map<string, ManagedSurfaceRecord> {
  return (
    catalog as unknown as {
      managedSurfaces: Map<string, ManagedSurfaceRecord>;
    }
  ).managedSurfaces;
}

function getManagedSurface(
  catalog: WorkspaceSessionCatalog,
  surfacePiSessionId: string,
): ManagedSurfaceRecord {
  const surface = getManagedSurfaces(catalog).get(surfacePiSessionId) ?? null;
  if (!surface) {
    throw new Error(`Managed surface not found: ${surfacePiSessionId}`);
  }
  return surface;
}

function getManagedResolvedSystemPrompt(surface: ManagedSurfaceRecord): string {
  const resolved = surface.session.agent.state.systemPrompt?.trim();
  return resolved && resolved.length > 0 ? resolved : surface.systemPrompt;
}

function getActiveToolNames(surface: ManagedSurfaceRecord): string[] {
  return (
    surface.session as unknown as {
      getActiveToolNames(): string[];
    }
  ).getActiveToolNames();
}

function getCustomTool(surface: ManagedSurfaceRecord, name: string) {
  const tool = (
    surface.session as unknown as {
      _customTools: Array<{
        execute: (toolCallId: string, input: unknown, signal?: AbortSignal) => Promise<unknown>;
        name: string;
      }>;
    }
  )._customTools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Custom tool not found: ${name}`);
  }
  return tool;
}

async function closeSurface(catalog: WorkspaceSessionCatalog, target: PromptTarget): Promise<void> {
  const closeSurfaceFn = (
    catalog as unknown as {
      closeSurface: (input: PromptTarget | { target: PromptTarget }) => Promise<{ ok: boolean }>;
    }
  ).closeSurface;
  const source = String(closeSurfaceFn);
  if (source.includes(".target")) {
    await closeSurfaceFn.call(catalog, { target });
    return;
  }
  await closeSurfaceFn.call(catalog, target);
}

async function setSurfaceModel(
  catalog: WorkspaceSessionCatalog,
  target: PromptTarget,
  model: string,
  provider = "openai",
): Promise<void> {
  const setSurfaceModelFn = (
    catalog as unknown as {
      setSurfaceModel: (...args: unknown[]) => Promise<unknown>;
    }
  ).setSurfaceModel;
  const source = String(setSurfaceModelFn);
  if (source.includes(".target")) {
    await setSurfaceModelFn.call(catalog, { target, provider, model });
    return;
  }
  await setSurfaceModelFn.call(catalog, target, provider, model);
}

async function setSurfaceThoughtLevel(
  catalog: WorkspaceSessionCatalog,
  target: PromptTarget,
  level: ThinkingLevel,
): Promise<void> {
  const setSurfaceThoughtLevelFn = (
    catalog as unknown as {
      setSurfaceThoughtLevel: (...args: unknown[]) => Promise<unknown>;
    }
  ).setSurfaceThoughtLevel;
  const source = String(setSurfaceThoughtLevelFn);
  if (source.includes(".target")) {
    await setSurfaceThoughtLevelFn.call(catalog, { target, level });
    return;
  }
  await setSurfaceThoughtLevelFn.call(catalog, target, level);
}

async function setSurfaceExtensionUsage(
  catalog: WorkspaceSessionCatalog,
  target: PromptTarget,
  extensionId: string,
  state: ExtensionUsageState,
): Promise<void> {
  const setSurfaceExtensionUsageFn = (
    catalog as unknown as {
      setSurfaceExtensionUsage: (...args: unknown[]) => Promise<unknown>;
    }
  ).setSurfaceExtensionUsage;
  const source = String(setSurfaceExtensionUsageFn);
  if (source.includes(".target")) {
    await setSurfaceExtensionUsageFn.call(catalog, { target, extensionId, state });
    return;
  }
  await setSurfaceExtensionUsageFn.call(catalog, target, extensionId, state);
}

async function getCatalogAgentProfiles(
  catalog: WorkspaceSessionCatalog,
): Promise<AgentProfileSettings[]> {
  const authority = (catalog as unknown as { agentProfileAuthority: CatalogAgentProfileAuthority })
    .agentProfileAuthority;
  const snapshot = await authority.read();
  return snapshot.configuredProfiles
    .filter((profile) => profile.actor === "orchestrator")
    .map((profile) => ({
      id: profile.profileId,
      kind: "orchestrator",
      name: profile.name,
      provider: profile.providerId,
      model: profile.modelId,
      reasoningEffort: (profile.reasoning as { effort: AgentProfileSettings["reasoningEffort"] })
        .effort,
      systemPrompt: "",
      extensionUsage: { ...profile.extensionUsage },
      extensionOrder: [...profile.extensionOrder],
      updateFromComposer: profile.followComposer,
      builtin: profile.builtin,
      locked: profile.locked,
    }));
}

async function setCatalogAgentProfile(
  catalog: WorkspaceSessionCatalog,
  profile: AgentProfileSettings,
): Promise<void> {
  const authority = (catalog as unknown as { agentProfileAuthority: CatalogAgentProfileAuthority })
    .agentProfileAuthority;
  await authority.updateOrchestrator({
    profileId: profile.id as never,
    name: profile.name,
    providerId: profile.provider as never,
    modelId: profile.model as never,
    reasoning: { effort: profile.reasoningEffort },
    extensionUsage: profile.extensionUsage as never,
    extensionOrder: profile.extensionOrder as never,
    followComposer: profile.updateFromComposer,
  });
}

async function createHandlerThreadHarness(
  catalog: WorkspaceSessionCatalog,
  workspaceSessionId: string,
  input: {
    title: string;
    objective: string;
  },
) {
  const store = getStructuredSessionStore(catalog);
  const turn = store.startTurn({
    sessionId: workspaceSessionId,
    surfacePiSessionId: workspaceSessionId,
    requestSummary: `Delegate ${input.title}`,
  });
  const orchestratorThread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: workspaceSessionId,
    title: `Delegate ${input.title}`,
    objective: `Open ${input.title}.`,
  });
  const handlerThread = await (
    catalog as unknown as {
      createHandlerThread(input: {
        sessionId: string;
        turnId: string;
        parentThreadId: string;
        parentSurfacePiSessionId: string;
        objective: string;
        loadedByCommandId: string;
        autoStart?: boolean;
      }): Promise<{ id: string; surfacePiSessionId: string }>;
    }
  ).createHandlerThread({
    sessionId: workspaceSessionId,
    turnId: turn.id,
    parentThreadId: orchestratorThread.id,
    parentSurfacePiSessionId: workspaceSessionId,
    objective: input.objective,
    loadedByCommandId: orchestratorThread.id,
    autoStart: false,
  });

  return {
    turnId: turn.id,
    orchestratorThreadId: orchestratorThread.id,
    threadId: handlerThread.id,
    surfacePiSessionId: handlerThread.surfacePiSessionId,
    target: createThreadTarget(
      workspaceSessionId,
      handlerThread.surfacePiSessionId,
      handlerThread.id,
    ),
  };
}

describe("WorkspaceSessionCatalog", () => {
  it("exposes the same structured store instance backing catalog state ports", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    const { store } = catalog.workspaceStateRouterRegistration();
    const createOrchestratorSurface = store.createOrchestratorSurface.bind(store);
    let invoked = false;
    store.createOrchestratorSurface = ((input) => {
      invoked = true;
      return createOrchestratorSurface(input);
    }) satisfies StructuredSessionStateStore["createOrchestratorSurface"];

    try {
      const created = await runCatalogEffect(
        catalog.getRuntimeSurfaceLifecycleStatePort().createOrchestratorSurface({
          workspaceId: store.workspaceId as WorkspaceId,
          title: "Accessor Wiring",
        }),
      );

      expect(created.value.workspaceSessionId).toBeDefined();
      expect(invoked).toBe(true);
    } finally {
      store.createOrchestratorSurface = createOrchestratorSurface;
    }
  });

  it("writes generated actor prompt aggregates into the app-global extension cache", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    const preview = await catalog.getAgentContextPreview({ actor: "orchestrator" });
    const aggregatesRoot = join(agentDir, "..", "extensions", "generated", "aggregates");
    const blobIds = readdirSync(join(aggregatesRoot, "blobs")).filter(
      (entry) => !entry.startsWith("."),
    );

    expect(preview.systemPrompt).toContain("You are svvy");
    expect(existsSync(join(aggregatesRoot, "index.sqlite"))).toBe(true);
    expect(blobIds).toHaveLength(1);
    expect(readFileSync(join(aggregatesRoot, "blobs", blobIds[0]!, "prompt.md"), "utf8")).toBe(
      preview.systemPrompt,
    );
    expect(
      JSON.parse(readFileSync(join(aggregatesRoot, "blobs", blobIds[0]!, "manifest.json"), "utf8"))
        .inputs.actorKind,
    ).toBe("orchestrator");
  });

  it("passes the runtime approval boundary into session-created direct and TypeScript tools", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const approvalRequests: unknown[] = [];
    const catalog = createWorkspaceSessionCatalog(
      cwd,
      agentDir,
      sessionDir,
      (input) => {
        approvalRequests.push(input);
        return { approved: false, reason: `Denied ${input.toolName}` };
      },
      false,
      {
        artifactDirectory: join(agentDir, "artifacts"),
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
      },
    );

    try {
      const created = await catalog.createSession({ title: "Approval Wiring" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);

      await expect(
        getCustomTool(managed, "exec_command").execute("tool-call-session-shell", {
          cmd: "echo should-not-run",
        }),
      ).rejects.toThrow("Denied exec_command");

      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Run denied execute_typescript",
      });
      managed.promptExecutionRuntime.current = createPromptExecutionContext({
        workspaceSessionId: created.target.workspaceSessionId,
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        rootThreadId: null,
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      });

      await expect(
        getCustomTool(managed, "execute_typescript").execute("tool-call-session-ts", {
          typescriptCode: "console.log('should not run');",
        }),
      ).resolves.toMatchObject({
        details: {
          commandFacts: {
            success: false,
            error: {
              message: "Denied execute_typescript",
              stage: "approval",
            },
          },
        },
      });

      expect(approvalRequests).toMatchObject([
        {
          approvalMode: "auto-review",
          command: "echo should-not-run",
          cwd,
          toolCallId: "tool-call-session-shell",
          toolName: "exec_command",
        },
        {
          approvalMode: "auto-review",
          commandId: expect.any(String),
          cwd,
          sessionId: created.target.workspaceSessionId,
          snippetArtifactId: expect.any(String),
          surfacePiSessionId: created.target.surfacePiSessionId,
          threadId: null,
          toolCallId: "tool-call-session-ts",
          toolName: "execute_typescript",
          turnId: turn.id,
          typescriptCode: "console.log('should not run');",
        },
      ]);
    } finally {
      await catalog.dispose();
    }
  });

  it("passes runtime-owned launch facts into session-created execute_typescript", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const launchRequests: Array<Omit<BuildLaunchPolicyInput, "launchKind">> = [];
    const catalog = createWorkspaceSessionCatalog(
      cwd,
      agentDir,
      sessionDir,
      () => ({ approved: true }),
      false,
      {
        artifactDirectory: join(agentDir, "artifacts"),
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
        acquireExecuteTypescriptLaunch: async (input) => {
          launchRequests.push(input);
          return {
            facts: {
              mode: "managed",
              spawn: {
                executable: process.execPath as AbsolutePath,
                args: input.command.slice(1),
                cwd: input.cwd,
                envFacts: input.envFacts,
              },
              helperPath: join(agentDir, "sandbox-helper") as AbsolutePath,
              helperArgs: ["--helper"],
              policySnapshot: {
                snapshotId: "session-catalog-execute-ts-snapshot",
                fingerprint: "session-catalog-execute-ts-fingerprint",
                resolvedAt: "2026-04-18T09:00:00.000Z" as never,
                scope: input.scope,
                ...(input.surfacePiSessionId
                  ? { surfacePiSessionId: input.surfacePiSessionId }
                  : {}),
                commandId: input.commandId,
                launchKind: "execute_typescript_runtime",
                cwd: input.cwd,
                sandboxMode: "managed",
                networkPolicy: "deny",
                filesystemPolicy: {
                  defaultAccess: "read",
                  entries: [
                    {
                      access: "write",
                      path: cwd as AbsolutePath,
                      recursive: true,
                      source: "workspace",
                    },
                  ],
                },
                profileDigest: "session-catalog-execute-ts-profile",
              },
            },
            close: async () => {},
          };
        },
      },
    );

    try {
      const created = await catalog.createSession({ title: "Execute Settings" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Run execute_typescript with app execution settings",
      });
      managed.promptExecutionRuntime.current = createPromptExecutionContext({
        workspaceSessionId: created.target.workspaceSessionId,
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        rootThreadId: null,
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      });

      const result = await getCustomTool(managed, "execute_typescript").execute(
        "tool-call-session-ts-settings",
        {
          typescriptCode: "return { ok: true };",
        },
      );
      expect(result).toMatchObject({
        details: {
          commandFacts: {
            success: true,
            result: { ok: true },
          },
        },
      });

      expect(launchRequests).toHaveLength(1);
      expect(launchRequests[0]).toMatchObject({
        scope: {
          kind: "workspace",
        },
        surfacePiSessionId: created.target.surfacePiSessionId,
        cwd,
      });
      expect(store.getSessionState(created.target.workspaceSessionId).commands[0]).toMatchObject({
        toolName: "execute_typescript",
        status: "succeeded",
        facts: {
          sandboxMode: "managed",
          networkPolicy: "deny",
          policySnapshotId: "session-catalog-execute-ts-snapshot",
          policyFingerprint: "session-catalog-execute-ts-fingerprint",
          policyScope: {
            kind: "workspace",
          },
          launchKind: "execute_typescript_runtime",
          commandFamily: "execute_typescript",
          profileDigest: "session-catalog-execute-ts-profile",
        },
      });
    } finally {
      await catalog.dispose();
    }
  });

  it("rejects generated package imports from session-created execute_typescript", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const workflowsPackagePath = join(agentDir, "generated-workflows-package");
    mkdirSync(workflowsPackagePath, { recursive: true });
    writeFileSync(
      join(workflowsPackagePath, "package.json"),
      JSON.stringify({ name: "@svvyx/workflows", main: "index.ts" }, null, 2),
    );
    writeFileSync(
      join(workflowsPackagePath, "index.ts"),
      [
        'export const Agents = Object.freeze({ reviewer: "reviewer" });',
        "export const Components = Object.freeze({});",
        "export const Prompts = Object.freeze({});",
        "export const Workflows = Object.freeze({});",
        "",
      ].join("\n"),
    );
    const catalog = createWorkspaceSessionCatalog(
      cwd,
      agentDir,
      sessionDir,
      () => ({ approved: true }),
      false,
      {
        artifactDirectory: join(agentDir, "artifacts"),
        workflowsGeneratedPackagePath: workflowsPackagePath,
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
      },
    );

    try {
      const created = await catalog.createSession({ title: "Execute Imports" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Reject execute_typescript generated imports",
      });
      managed.promptExecutionRuntime.current = createPromptExecutionContext({
        workspaceSessionId: created.target.workspaceSessionId,
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        rootThreadId: null,
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      });

      const result = await getCustomTool(managed, "execute_typescript").execute(
        "tool-call-session-ts-imports",
        {
          typescriptCode:
            'import { Agents } from "@svvyx/workflows";\nreturn Object.keys(Agents as object);',
        },
      );
      expect(result).toMatchObject({
        details: {
          commandFacts: {
            success: false,
            error: {
              stage: "compile",
              message: "Unsupported execute_typescript import declaration: @svvyx/workflows.",
            },
          },
        },
      });
    } finally {
      await catalog.dispose();
    }
  });

  it("records auto-review approval decisions through the production runtime boundary", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Auto Approval" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Run auto-approved shell",
      });
      const command = store.createCommand({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "surface",
        title: "Shell",
        summary: "printf auto-approved",
        facts: { toolCallId: "tool-auto-approved-shell" },
      });
      store.startCommand(command.id);

      const result = await getCustomTool(managed, "exec_command").execute(
        "tool-auto-approved-shell",
        { cmd: "printf auto-approved" },
        new AbortController().signal,
      );

      expect(JSON.stringify(result)).toContain("auto-approved");
      expect(
        store.getSessionState(created.target.workspaceSessionId).runtimeApprovalRequests,
      ).toMatchObject([
        {
          approvalMode: "auto-review",
          command: "printf auto-approved",
          status: "approved",
          reviewer: "auto-review",
          toolName: "exec_command",
        },
      ]);
    } finally {
      await catalog.dispose();
    }
  });

  it("denies unsafe auto-review requests through the production runtime boundary", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Auto Denial" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Run auto-denied shell",
      });
      const command = store.createCommand({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "surface",
        title: "Shell",
        summary: "sudo printf denied",
        facts: { toolCallId: "tool-auto-denied-shell" },
      });
      store.startCommand(command.id);

      await expect(
        getCustomTool(managed, "exec_command").execute(
          "tool-auto-denied-shell",
          { cmd: "sudo printf denied" },
          new AbortController().signal,
        ),
      ).rejects.toThrow("Auto-review denied privilege escalation.");

      const snapshot = store.getSessionState(created.target.workspaceSessionId);
      const approvalRequest = snapshot.runtimeApprovalRequests?.[0];
      expect(approvalRequest).toMatchObject({
        approvalMode: "auto-review",
        command: "sudo printf denied",
        status: "denied",
        reviewer: "auto-review",
        toolName: "exec_command",
        decisionReason: "Auto-review denied privilege escalation.",
      });
      expect(snapshot.commands.find((entry) => entry.id === command.id)).toMatchObject({
        status: "cancelled",
        facts: {
          approval: "denied",
          approvalRequestId: approvalRequest?.requestId,
        },
      });
    } finally {
      await catalog.dispose();
    }
  });

  it("pauses user-mode runtime approval requests until answered", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "User Approval" }, DEFAULTS);
      const settingsStore = createAgentSettingsStore({ agentDir });
      catalog.updateAppPreferences({
        ...settingsStore.getState().appPreferences,
        approvalMode: "user",
      });
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Run user-approved shell",
      });
      const command = store.createCommand({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "surface",
        title: "Shell",
        summary: "printf user-approved",
        facts: { toolCallId: "tool-user-approved-shell" },
      });
      store.startCommand(command.id);

      const pending = getCustomTool(managed, "exec_command").execute(
        "tool-user-approved-shell",
        { cmd: "printf user-approved" },
        new AbortController().signal,
      );

      await waitFor(() =>
        store
          .listOpenRuntimeApprovalRequests()
          .some(
            (request) =>
              request.toolCallId === "tool-user-approved-shell" && request.status === "pending",
          ),
      );
      const request = store.listOpenRuntimeApprovalRequests()[0]!;
      expect(store.getSessionState(created.target.workspaceSessionId).session.wait).toMatchObject({
        kind: "approval",
      });
      expect(store.getSessionState(created.target.workspaceSessionId).commands[0]).toMatchObject({
        status: "waiting",
        facts: {
          approval: "pending",
          approvalRequestId: request.requestId,
        },
      });

      await answerRuntimeApprovalThroughRuntime(catalog, {
        requestId: request.requestId,
        approved: true,
      });
      const result = await pending;

      expect(JSON.stringify(result)).toContain("user-approved");
      expect(
        store.getSessionState(created.target.workspaceSessionId).runtimeApprovalRequests,
      ).toMatchObject([
        {
          approvalMode: "user",
          command: "printf user-approved",
          status: "approved",
          reviewer: "user",
          toolName: "exec_command",
        },
      ]);
    } finally {
      await catalog.dispose();
    }
  });

  it("settles user-denied runtime approval requests without running the command", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Denied Approval" }, DEFAULTS);
      const settingsStore = createAgentSettingsStore({ agentDir });
      catalog.updateAppPreferences({
        ...settingsStore.getState().appPreferences,
        approvalMode: "user",
      });
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const store = getStructuredSessionStore(catalog);
      const targetPath = join(cwd, "should-not-run.txt");
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Run denied shell",
      });
      const command = store.createCommand({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "surface",
        title: "Shell",
        summary: `printf denied > ${targetPath}`,
        facts: { toolCallId: "tool-user-denied-shell" },
      });
      store.startCommand(command.id);

      const pending = getCustomTool(managed, "exec_command").execute(
        "tool-user-denied-shell",
        { cmd: `printf denied > ${targetPath}` },
        new AbortController().signal,
      );

      await waitFor(() =>
        store
          .listOpenRuntimeApprovalRequests()
          .some(
            (request) =>
              request.toolCallId === "tool-user-denied-shell" && request.status === "pending",
          ),
      );
      const request = store.listOpenRuntimeApprovalRequests()[0]!;
      await answerRuntimeApprovalThroughRuntime(catalog, {
        requestId: request.requestId,
        approved: false,
        reason: "User denied command.",
      });

      await expect(pending).rejects.toThrow("User denied command.");
      expect(existsSync(targetPath)).toBe(false);
      expect(store.getSessionState(created.target.workspaceSessionId).session.wait).toBeNull();
      expect(store.getSessionState(created.target.workspaceSessionId).commands[0]).toMatchObject({
        status: "cancelled",
        facts: {
          approval: "denied",
          approvalRequestId: request.requestId,
        },
      });
      expect(
        store.getSessionState(created.target.workspaceSessionId).runtimeApprovalRequests,
      ).toMatchObject([
        {
          approvalMode: "user",
          command: `printf denied > ${targetPath}`,
          status: "denied",
          reviewer: "user",
          toolName: "exec_command",
        },
      ]);
    } finally {
      await catalog.dispose();
    }
  });

  it("builds generated agent context previews from the active profile and extension state", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    writeFileSync(join(cwd, "AGENTS.md"), "# Project Standards\n\nUse repo rules.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const preview = await catalog.getAgentContextPreview({
        actor: "orchestrator",
        profileId: DEFAULT_ORCHESTRATOR_PROFILE_ID,
      });

      expect(preview.actor).toBe("orchestrator");
      expect(preview.profileId).toBe(DEFAULT_ORCHESTRATOR_PROFILE_ID);
      expect(preview.loadedExtensionIds).toContain("base-common");
      expect(preview.loadedExtensionIds).toContain("base-orchestrator");
      expect(preview.tokenCount).toMatchObject({
        accuracy: "estimated",
      });
      expect(preview.tokenCount.tokens).toBeGreaterThan(0);
      expect(
        preview.extensions.find((extension) => extension.id === "base-common")?.tokenCount,
      ).toMatchObject({
        accuracy: "estimated",
      });
      expect(
        preview.extensions.find((extension) => extension.id === "base-common")?.tokenCount?.tokens,
      ).toBeGreaterThan(0);
      const availablePreviewExtension = preview.extensions.find(
        (extension) => extension.state === "available",
      );
      expect(availablePreviewExtension?.tokenCount?.tokens).toBeGreaterThan(0);
      expect(availablePreviewExtension?.loadedTokenCount?.tokens).toBeGreaterThan(0);
      expect(preview.systemPrompt).toContain("This surface is the orchestrator.");
      expect(preview.systemPrompt).toContain("Loaded native extension: Shell.");
      expect(preview.systemPrompt).toContain("Loaded external_instruction records:");
      expect(preview.systemPrompt).toContain("# Project Standards");

      const handlerPreview = await catalog.getAgentContextPreview({ actor: "handler" });

      expect(handlerPreview.actor).toBe("handler");
      expect(handlerPreview.profileId).toBe(DEFAULT_THREAD_HANDLER_PROFILE_ID);
      expect(handlerPreview.loadedExtensionIds).toContain("base-common");
      expect(handlerPreview.loadedExtensionIds).toContain("base-handler");
      expect(handlerPreview.loadedExtensionIds).not.toContain("base-orchestrator");
      expect(handlerPreview.tokenCount.tokens).toBeGreaterThan(0);
      expect(handlerPreview.systemPrompt).toContain("This surface is a delegated handler thread.");
      expect(handlerPreview.systemPrompt).not.toContain("## Handler Profile Override");

      const workflowTaskPreview = await catalog.getAgentContextPreview({
        actor: "workflow-task",
        profileId: "explorer",
      });

      expect(workflowTaskPreview.actor).toBe("workflow-task");
      expect(workflowTaskPreview.profileId).toBe("explorer");
      expect(workflowTaskPreview.profileName).toBe("Explorer");
      expect(workflowTaskPreview.loadedExtensionIds).toContain("base-common");
      expect(workflowTaskPreview.loadedExtensionIds).toContain("base-workflow-task");
      expect(workflowTaskPreview.loadedExtensionIds).not.toContain("base-orchestrator");
      expect(workflowTaskPreview.tokenCount.tokens).toBeGreaterThan(0);
      expect(workflowTaskPreview.systemPrompt.startsWith("## Custom Instructions")).toBe(true);
      expect(workflowTaskPreview.systemPrompt.indexOf("Inspect the repository")).toBeGreaterThan(
        -1,
      );
      expect(workflowTaskPreview.systemPrompt.indexOf("Inspect the repository")).toBeLessThan(
        workflowTaskPreview.systemPrompt.indexOf(
          "You are a task-scoped coding agent running inside one Smithers workflow task attempt.",
        ),
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("refreshes workflow-task previews from committed workflow-agent and actor-default authority", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const authority = (
      catalog as unknown as { agentProfileAuthority: CatalogAgentProfileAuthority }
    ).agentProfileAuthority;
    const initial = await authority.read();
    let committed: CatalogAgentProfileAuthoritySnapshot = {
      ...initial,
      workflowAgents: initial.workflowAgents.map((source) =>
        source.sourceId === "explorer" && source.parameters
          ? {
              ...source,
              parameters: {
                ...source.parameters,
                label: "Committed Explorer",
                instructions: "Use the freshly committed workflow-agent source.",
              },
            }
          : source,
      ),
      actorExtensionDefaults: initial.actorExtensionDefaults.map((defaults) =>
        defaults.actor === "workflow-task"
          ? {
              ...defaults,
              extensionUsage: { ...defaults.extensionUsage, shell: "unavailable" },
            }
          : defaults,
      ),
    };
    catalog.setAgentProfileAuthority({
      ...authority,
      read: async () => structuredClone(committed),
    });

    try {
      const first = await catalog.getAgentContextPreview({
        actor: "workflow-task",
        profileId: "explorer",
      });
      expect(first.profileName).toBe("Committed Explorer");
      expect(first.systemPrompt).toContain("Use the freshly committed workflow-agent source.");
      expect(first.loadedExtensionIds).not.toContain("shell");

      committed = {
        ...committed,
        workflowAgents: committed.workflowAgents.map((source) =>
          source.sourceId === "explorer" && source.parameters
            ? {
                ...source,
                parameters: {
                  ...source.parameters,
                  label: "Second Committed Explorer",
                  instructions: "Use the second committed workflow-agent source.",
                },
              }
            : source,
        ),
        actorExtensionDefaults: committed.actorExtensionDefaults.map((defaults) =>
          defaults.actor === "workflow-task"
            ? {
                ...defaults,
                extensionUsage: { ...defaults.extensionUsage, shell: "loaded" },
              }
            : defaults,
        ),
      };

      const second = await catalog.getAgentContextPreview({
        actor: "workflow-task",
        profileId: "explorer",
      });
      expect(second.profileName).toBe("Second Committed Explorer");
      expect(second.systemPrompt).toContain("Use the second committed workflow-agent source.");
      expect(second.loadedExtensionIds).toContain("shell");
    } finally {
      await catalog.dispose();
    }
  });

  it("applies Extension Managing profile, defaults, and workflow-source intents through authority", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const mutations = await catalog.getAgentProfileMutationStore();
      mutations.setProfileExtensionUsage({
        actor: "orchestrator",
        profileId: DEFAULT_ORCHESTRATOR_PROFILE_ID,
        extensionId: "shell",
        usage: "available",
        explicit: true,
      });
      mutations.setActorExtensionDefaults({
        actor: "workflow-task",
        extensionUsage: { shell: "available" },
        extensionOrder: ["shell"],
      });
      mutations.setWorkflowAgent({
        ...mutations.getState().workflowAgents.explorer!,
        overrides: { shell: "unavailable" },
      });
      mutations.upsertWorkflowAgentSource({
        sourceId: "reviewerAgent",
        overwrite: false,
        draft: {
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review strictly.",
          overrides: { shell: "loaded" },
          extensionOrder: ["shell"],
        },
        text: `${JSON.stringify({
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review strictly.",
          overrides: { shell: "loaded" },
          extensionOrder: ["shell"],
        })}\n`,
      });

      await catalog.applyAgentProfileMutations(mutations.takeMutations());

      const refreshed = (await catalog.getAgentProfileMutationStore()).getState();
      expect(
        refreshed.agents.orchestrators.find(
          (profile) => profile.id === DEFAULT_ORCHESTRATOR_PROFILE_ID,
        )?.extensionUsage,
      ).toEqual({ shell: "available" });
      expect(refreshed.actorExtensionDefaults["workflow-task"]).toEqual({
        extensionUsage: { shell: "available" },
        extensionOrder: ["shell"],
      });
      expect(refreshed.workflowAgents.explorer?.overrides).toEqual({ shell: "unavailable" });
      expect(refreshed.workflowAgents.reviewerAgent).toMatchObject({
        label: "Reviewer",
        overrides: { shell: "loaded" },
        extensionOrder: ["shell"],
      });
    } finally {
      await catalog.dispose();
    }
  });

  it("normalizes generated session title casing and punctuation without deleting suffixes", () => {
    expect(normalizeGeneratedTitle('"OAuth Login Session."')).toBe("OAuth login session");
    expect(normalizeGeneratedTitle("Project CI Thread")).toBe("Project CI thread");
    expect(normalizeGeneratedTitle("Greeting Exchange")).toBe("greeting exchange");
    expect(normalizeGeneratedTitle("Session")).toBe("Session");
  });

  it("retains committed create invalidations until a publisher exists and publishes delete after commit", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const store = getStructuredSessionStore(catalog);
    const publications: StateInvalidationDescriptor[][] = [];

    try {
      const created = await catalog.createSession({ title: "Cross-tab invalidations" }, DEFAULTS);
      const sessionId = created.target.workspaceSessionId;
      expect(publications).toEqual([]);

      await catalog.setCommittedStateInvalidationPublisher(async (afterCommit) => {
        publications.push([...afterCommit]);
        if (publications.length === 1) {
          expect(store.getSessionState(sessionId).pi.title).toBe("Cross-tab invalidations");
        } else {
          expect(store.isSessionDeleted(sessionId)).toBe(true);
          expect(() => store.getSessionState(sessionId)).toThrow();
        }
      });

      expect(publications).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: cwd as WorkspaceId,
            invalidation: { model: "surface", ids: [sessionId as never] },
          },
          {
            scope: "workspace",
            workspaceId: cwd as WorkspaceId,
            invalidation: { model: "sessionNavigation" },
          },
        ],
      ]);

      await catalog.deleteSession(sessionId);
      expect(publications[1]).toEqual([
        {
          scope: "workspace",
          workspaceId: cwd as WorkspaceId,
          invalidation: { model: "sessionNavigation" },
        },
        {
          scope: "workspace",
          workspaceId: cwd as WorkspaceId,
          invalidation: { model: "surface", ids: [sessionId as never] },
        },
      ]);
    } finally {
      await catalog.dispose();
    }
  });

  it("keeps committed invalidations retryable when publication fails without reporting rollback", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const appLogs: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const retried: StateInvalidationDescriptor[][] = [];
    catalog.setAppLogListener((event) => {
      if (event.level === "error") appLogs.push(event);
    });
    await catalog.setCommittedStateInvalidationPublisher(async () => {
      throw new Error("event bus unavailable");
    });

    try {
      const created = await catalog.createSession({ title: "Committed despite publish" }, DEFAULTS);
      expect(
        getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId).pi
          .title,
      ).toBe("Committed despite publish");
      expect(appLogs).toHaveLength(1);
      expect(appLogs[0]).toMatchObject({
        details: {
          operation: "session.create",
          committed: true,
          rebaselineRequired: true,
        },
      });

      await catalog.setCommittedStateInvalidationPublisher(async (afterCommit) => {
        retried.push([...afterCommit]);
      });
      expect(retried).toHaveLength(1);
      expect(retried[0]?.map((descriptor) => descriptor.invalidation.model)).toEqual([
        "surface",
        "sessionNavigation",
      ]);
    } finally {
      catalog.setAppLogListener(null);
      await catalog.dispose();
    }
  });

  it("publishes composer and queue restore/reorder invalidations only after each commit", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const store = getStructuredSessionStore(catalog);
    const created = await catalog.createSession({ title: "Surface invalidations" }, DEFAULTS);
    const publications: StateInvalidationDescriptor[][] = [];

    try {
      await catalog.setCommittedStateInvalidationPublisher(async (afterCommit) => {
        publications.push([...afterCommit]);
      });
      publications.length = 0;

      await catalog.updateComposerDraft({
        target: created.target,
        draft: { text: "durable cross-tab draft", attachments: [] },
      });
      expect(store.getComposerDraft(created.target.surfacePiSessionId)?.text).toBe(
        "durable cross-tab draft",
      );

      const first = store.enqueueSurfaceMessage({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        messageJson: JSON.stringify(userMessage("first")),
      });
      const second = store.enqueueSurfaceMessage({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        messageJson: JSON.stringify(userMessage("second")),
      });
      await catalog.reorderQueuedSurfaceMessage({
        target: created.target,
        queuedMessageId: second.id,
        beforeQueuedMessageId: first.id,
      });
      expect(
        store
          .listQueuedSurfaceMessages({ surfacePiSessionId: created.target.surfacePiSessionId })
          .map((row) => row.id),
      ).toEqual([second.id, first.id]);

      await catalog.editQueuedSurfaceMessage({
        target: created.target,
        queuedMessageId: first.id,
      });
      expect(store.getSurfaceQueuedMessage({ id: first.id }).status).toBe("cancelled");

      expect(publications).toHaveLength(3);
      for (const publication of publications) {
        expect(publication).toEqual([
          {
            scope: "workspace",
            workspaceId: cwd as WorkspaceId,
            invalidation: {
              model: "surface",
              ids: [created.target.surfacePiSessionId as never],
            },
          },
          {
            scope: "workspace",
            workspaceId: cwd as WorkspaceId,
            invalidation: { model: "sessionNavigation" },
          },
        ]);
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("publishes running and completed top-level title invalidations from the asynchronous job", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const restoreTitleNamerEnv = configureHermeticTitleNamer(agentDir);
    const restoreTitleCompletion = setPiTitleCompletionForTests(
      async () =>
        assistantMessage("Generated async title", {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        }) as AssistantMessage,
    );
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const publications: StateInvalidationDescriptor[][] = [];

    try {
      const created = await catalog.createSession({ title: "New orchestrator" }, DEFAULTS);
      await catalog.setCommittedStateInvalidationPublisher(async (afterCommit) => {
        publications.push([...afterCommit]);
      });
      publications.length = 0;
      const store = getStructuredSessionStore(catalog);
      store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Generate a useful title asynchronously",
      });
      store.queueTitleGeneration(created.target.workspaceSessionId);

      await (
        catalog as unknown as { runTitleGenerationJob(sessionId: string): Promise<void> }
      ).runTitleGenerationJob(created.target.workspaceSessionId);

      expect(store.getSessionState(created.target.workspaceSessionId).pi).toMatchObject({
        title: "Generated async title",
        titleGenerationStatus: "completed",
      });
      expect(publications).toHaveLength(2);
      expect(publications.map((batch) => batch.map((item) => item.invalidation.model))).toEqual([
        ["surface", "sessionNavigation"],
        ["surface", "sessionNavigation"],
      ]);
    } finally {
      restoreTitleCompletion();
      restoreTitleNamerEnv();
      await catalog.dispose();
    }
  });

  it("does not duplicate invalidations returned to runtime-owned turn publication paths", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Runtime-owned publication" }, DEFAULTS);
    const catalogPublications: StateInvalidationDescriptor[][] = [];

    try {
      await catalog.setCommittedStateInvalidationPublisher(async (afterCommit) => {
        catalogPublications.push([...afterCommit]);
      });
      catalogPublications.length = 0;

      const result = await runCatalogEffect(
        catalog.getRuntimeTurnStatePort().startTurn({
          sessionId: created.target.workspaceSessionId as never,
          surfacePiSessionId: created.target.surfacePiSessionId as never,
          requestSummary: "Runtime owns this result and publishes it once.",
        }),
      );

      expect(result.afterCommit.map((item) => item.invalidation.model)).toEqual([
        "surface",
        "sessionNavigation",
      ]);
      expect(catalogPublications).toEqual([]);
    } finally {
      await catalog.dispose();
    }
  });

  it("commits interrupted-turn recovery atomically before publishing its exact invalidations", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Interrupted recovery" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);
    const publications: StateInvalidationDescriptor[][] = [];

    try {
      await catalog.setCommittedStateInvalidationPublisher(async (afterCommit) => {
        publications.push([...afterCommit]);
      });
      publications.length = 0;
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "A turn interrupted by restart",
      });
      await catalog.setCommittedStateInvalidationPublisher(async (afterCommit) => {
        expect(store.getSessionState(created.target.workspaceSessionId).turns[0]).toMatchObject({
          id: turn.id,
          status: "failed",
        });
        publications.push([...afterCommit]);
      });

      await (
        catalog as unknown as {
          recoverInterruptedSurfaceTurn(surfacePiSessionId: string): Promise<void>;
        }
      ).recoverInterruptedSurfaceTurn(created.target.surfacePiSessionId);

      const snapshot = store.getSessionState(created.target.workspaceSessionId);
      expect(
        snapshot.events.some(
          (event) =>
            event.kind === "surface.turn_recovery.interrupted" && event.subject.id === turn.id,
        ),
      ).toBe(true);
      expect(publications).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: cwd as WorkspaceId,
            invalidation: {
              model: "surface",
              ids: [created.target.surfacePiSessionId as never],
            },
          },
          {
            scope: "workspace",
            workspaceId: cwd as WorkspaceId,
            invalidation: { model: "sessionNavigation" },
          },
        ],
      ]);
    } finally {
      await catalog.dispose();
    }
  });

  it("defers startup queue replay until runtime wiring is ready and wakes the runtime queue seam", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const firstCatalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await firstCatalog.createSession(
      { title: "Queued restart recovery" },
      DEFAULTS,
    );
    getStructuredSessionStore(firstCatalog).enqueueSurfaceMessage({
      sessionId: created.target.workspaceSessionId,
      surfacePiSessionId: created.target.surfacePiSessionId,
      messageJson: JSON.stringify(userMessage("Replay this durable row through runtime.")),
    });
    await firstCatalog.dispose();

    const wakeTargets: PromptTarget[] = [];
    const recoveredCatalog = createWorkspaceSessionCatalog(
      cwd,
      agentDir,
      sessionDir,
      undefined,
      false,
      {
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
        wakeSurfaceQueue: async (target) => {
          wakeTargets.push(target);
        },
      },
      false,
    );

    try {
      await Promise.resolve();
      expect(wakeTargets).toEqual([]);

      await recoveredCatalog.prepareWorkspaceRecoveryAfterRegistration();
      recoveredCatalog.startWorkspaceRecovery();
      await waitFor(() => wakeTargets.length === 1);
      recoveredCatalog.startWorkspaceRecovery();
      await Promise.resolve();

      expect(wakeTargets).toEqual([created.target]);
      expect(
        getStructuredSessionStore(recoveredCatalog).listQueuedSurfaceMessages({
          surfacePiSessionId: created.target.surfacePiSessionId,
        }),
      ).toHaveLength(1);
    } finally {
      await recoveredCatalog.dispose();
    }
  });

  it("deletes the pi files and structured state so hard-deleted sessions do not reappear", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const fakeBin = join(mkdtempSync(join(tmpdir(), "svvy-trash-bin-")));
    tempDirs.push(fakeBin);
    const fakeTrashPath = join(fakeBin, "trash");
    writeFileSync(
      fakeTrashPath,
      [
        "#!/bin/sh",
        "# Simulate a trash command that reports success but leaves the file behind.",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(fakeTrashPath, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Delete Me" }, DEFAULTS);
      const sessionId = created.target.workspaceSessionId;
      const sessionFile = getManagedSurface(
        catalog,
        sessionId,
      ).session.sessionManager.getSessionFile();

      expect(existsSync(sessionFile)).toBe(true);
      expect(getStructuredSessionStore(catalog).getSessionState(sessionId).session.id).toBe(
        sessionId,
      );

      await catalog.deleteSession(sessionId);

      expect(existsSync(sessionFile)).toBe(false);
      expect(() => getStructuredSessionStore(catalog).getSessionState(sessionId)).toThrow(
        `Structured session not found: ${sessionId}`,
      );
      expect(() => getStructuredSessionStore(catalog).getSessionState(sessionId)).toThrow(
        `Structured session not found: ${sessionId}`,
      );
    } finally {
      process.env.PATH = previousPath;
      await catalog.dispose();
    }
  });

  it("keeps hard-deleted sessions tombstoned across repeated create/delete and stale renames", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const fakeBin = join(mkdtempSync(join(tmpdir(), "svvy-trash-bin-")));
    tempDirs.push(fakeBin);
    const fakeTrashPath = join(fakeBin, "trash");
    writeFileSync(
      fakeTrashPath,
      [
        "#!/bin/sh",
        "# Simulate a trash command that reports success but leaves the file behind.",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(fakeTrashPath, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const deletedSessionIds: string[] = [];

      for (let index = 0; index < 12; index++) {
        const created = await catalog.createSession({ title: `Delete Stress ${index}` }, DEFAULTS);
        const sessionId = created.target.workspaceSessionId;
        const sessionFile = getManagedSurface(
          catalog,
          sessionId,
        ).session.sessionManager.getSessionFile();

        await catalog.deleteSession(sessionId);
        deletedSessionIds.push(sessionId);

        expect(existsSync(sessionFile)).toBe(false);
        expect(getStructuredSessionStore(catalog).isSessionDeleted(sessionId)).toBe(true);

        await catalog.renameSession(sessionId, `Stale Rename ${index}`);

        expect(() => getStructuredSessionStore(catalog).getSessionState(sessionId)).toThrow();
      }

      for (const sessionId of deletedSessionIds) {
        expect(getStructuredSessionStore(catalog).isSessionDeleted(sessionId)).toBe(true);
      }
    } finally {
      process.env.PATH = previousPath;
      await catalog.dispose();
    }
  });

  it("forks a workspace session from a selected assistant message", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const sourceSessionManager = SessionManager.create(cwd, sessionDir);
    sourceSessionManager.appendSessionInfo("Branch Source");
    sourceSessionManager.appendMessage(userMessage("first question"));
    const firstAssistant = {
      ...assistantMessage("first answer"),
      timestamp: 1_111,
    };
    sourceSessionManager.appendMessage(firstAssistant);
    sourceSessionManager.appendMessage(userMessage("second question"));
    sourceSessionManager.appendMessage({
      ...assistantMessage("second answer"),
      timestamp: 2_222,
    });

    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const forked = await catalog.forkSession(
        {
          sessionId: sourceSessionManager.getSessionId(),
          messageTimestamp: firstAssistant.timestamp,
        },
        DEFAULTS,
      );
      const forkedSurface = getManagedSurface(catalog, forked.target.surfacePiSessionId);
      const forkedSessionManager = (
        forkedSurface.session as unknown as { sessionManager: SessionManager }
      ).sessionManager;
      const messages = forkedSessionManager.buildSessionContext().messages;

      expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect((messages[0] as Message).content).toEqual([{ type: "text", text: "first question" }]);
      expect((messages[1] as AssistantMessage).content[0]).toEqual({
        type: "text",
        text: "first answer",
      });
      expect(forkedSessionManager.getHeader()?.parentSession).toBe(
        sourceSessionManager.getSessionFile(),
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("blocks manual rename while top-level title generation is pending", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
      const sessionId = created.target.workspaceSessionId;
      getStructuredSessionStore(catalog).queueTitleGeneration(sessionId);

      await expect(catalog.renameSession(sessionId, "Manual Title")).rejects.toThrow(
        "Session title is being generated.",
      );

      expect(
        getStructuredSessionStore(catalog).getSessionState(sessionId).pi.titleGenerationStatus,
      ).toBe("pending");
    } finally {
      await catalog.dispose();
    }
  });

  it("persists the live first composer draft across surface close and reopen", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
      await catalog.updateComposerDraft({
        target: created.target,
        draft: {
          text: "A text written in the composer should survive closing surfaces",
          attachments: [
            {
              id: "attachment:docs/progress.md",
              kind: "file",
              name: "progress.md",
              path: join(cwd, "docs/progress.md"),
              workspaceRelativePath: "docs/progress.md",
              mimeType: "text/markdown",
              sizeBytes: 123,
            },
          ],
        },
      });

      await catalog.closeSurface(created.target);
      await catalog.openSurface(created.target);
      const reopenedDraft = getStructuredSessionStore(catalog).getComposerDraft(
        created.target.surfacePiSessionId,
      );
      expect(reopenedDraft?.text).toBe(
        "A text written in the composer should survive closing surfaces",
      );
      expect(reopenedDraft?.attachments).toEqual([
        {
          id: "attachment:docs/progress.md",
          kind: "file",
          name: "progress.md",
          path: join(cwd, "docs/progress.md"),
          workspaceRelativePath: "docs/progress.md",
          mimeType: "text/markdown",
          sizeBytes: 123,
        },
      ]);

      getStructuredSessionStore(catalog).completeTitleGeneration({
        sessionId: created.target.workspaceSessionId,
        title: "Durable Composer Drafts",
      });
      expect(
        getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId).pi
          .title,
      ).toBe("Durable Composer Drafts");
    } finally {
      await catalog.dispose();
    }
  });

  it("uses the namer agent to title handler threads from the delegated objective", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const restoreTitleNamerEnv = configureHermeticTitleNamer(agentDir);
    const restoreTitleCompletion = setPiTitleCompletionForTests(
      async () =>
        assistantMessage("Workflow setup", {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        }) as AssistantMessage,
    );
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Naming" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(
          promptText: string,
          options?: {
            expandPromptTemplates?: boolean;
          },
        ): Promise<void>;
      };
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        appendMessagesToSession(this, [
          userMessage(promptText),
          assistantMessage("Workflow setup"),
        ]);
      });
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Delegate workflow context work",
      });
      const orchestratorThread = store.createThread({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        title: "Delegate workflow context work",
        objective: "Open a handler thread with workflow context.",
      });

      try {
        const handlerThread = await (
          catalog as unknown as {
            createHandlerThread(input: {
              sessionId: string;
              turnId: string;
              parentThreadId: string;
              parentSurfacePiSessionId: string;
              objective: string;
              loadedByCommandId: string;
            }): Promise<{ id: string; title: string }>;
          }
        ).createHandlerThread({
          sessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          parentThreadId: orchestratorThread.id,
          parentSurfacePiSessionId: created.target.surfacePiSessionId,
          objective: "Configure workflow checks for this repository.",
          loadedByCommandId: orchestratorThread.id,
        });

        expect(handlerThread.title).toBe("Configure workflow checks for this repository.");
        await waitFor(
          () => store.getThreadDetail(handlerThread.id).thread.title === "Workflow setup",
        );
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      restoreTitleCompletion();
      restoreTitleNamerEnv();
      await catalog.dispose();
    }
  });

  it("restores provider, model, and thinking level from persisted metadata without buildSessionContext", async () => {
    const { cwd, sessionDir } = createWorkspaceFixture();
    const sessionManager = SessionManager.create(cwd, sessionDir);
    sessionManager.appendThinkingLevelChange("high");
    sessionManager.appendMessage(
      assistantMessage("Assistant reply", {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
    );
    sessionManager.appendModelChange("anthropic", "claude-sonnet-4-5");

    const buildContextSpy = spyOn(SessionManager.prototype, "buildSessionContext");
    try {
      const restored = resolveRestoredSessionDefaults(sessionManager, {});

      expect(buildContextSpy).not.toHaveBeenCalled();
      expect(restored.provider).toBe("anthropic");
      expect(restored.model).toBe("claude-sonnet-4-5");
      expect(restored.thinkingLevel).toBe("high");
    } finally {
      buildContextSpy.mockRestore();
    }
  });

  it("loads svvy's prompt into pi's real systemPrompt channel for orchestrator and handler surfaces", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    writeFileSync(join(cwd, "AGENTS.md"), "# Project Standards\n\nUse repo rules.");
    writeFileSync(join(cwd, "CLAUDE.md"), "# Claude Standards\n\nKeep visible instructions.");
    writeFileSync(join(cwd, "APPEND_SYSTEM.md"), "Hidden root append text.");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "APPEND_SYSTEM.md"), "Hidden append text.");
    writeFileSync(join(cwd, ".pi", "SYSTEM.md"), "Hidden replacement text.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Prompt Channel" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const orchestratorResolvedPrompt = getManagedResolvedSystemPrompt(orchestratorManaged);

      expect(orchestratorManaged.systemPrompt).toContain(
        "You are svvy, a pragmatic software engineering assistant",
      );
      expect(orchestratorManaged.systemPrompt).toContain("Loaded native extension: Shell.");
      expect(orchestratorManaged.systemPrompt).toContain("Loaded external_instruction records:");
      expect(orchestratorManaged.systemPrompt).toContain(`# Project Standards\n\nUse repo rules.`);
      expect(orchestratorManaged.systemPrompt).not.toContain(
        `# Claude Standards\n\nKeep visible instructions.`,
      );
      expect(orchestratorResolvedPrompt).toContain(
        "You are svvy, a pragmatic software engineering assistant",
      );
      expect(orchestratorResolvedPrompt).not.toContain("# Project Context");
      expect(orchestratorResolvedPrompt).toContain("# Project Standards");
      expect(orchestratorResolvedPrompt).not.toContain("# Claude Standards");
      expect(orchestratorResolvedPrompt).not.toContain("Hidden append text.");
      expect(orchestratorResolvedPrompt).not.toContain("Hidden root append text.");
      expect(orchestratorResolvedPrompt).not.toContain("Hidden replacement text.");
      expect(orchestratorManaged.externalContextSources).toEqual([
        expect.objectContaining({
          kind: "AGENTS.md",
          path: join(cwd, "AGENTS.md"),
          content: "# Project Standards\n\nUse repo rules.",
          contentHash: expect.any(String),
          enabled: true,
        }),
        expect.objectContaining({
          kind: "CLAUDE.md",
          path: join(cwd, "CLAUDE.md"),
          content: "# Claude Standards\n\nKeep visible instructions.",
          contentHash: expect.any(String),
          enabled: false,
        }),
      ]);
      expect(orchestratorResolvedPrompt).not.toContain("Current date:");
      expect(orchestratorResolvedPrompt).not.toContain(`Current working directory: ${cwd}`);
      expect(orchestratorManaged.session.agent.state.systemPrompt).toBe(orchestratorResolvedPrompt);

      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Prompt Channel Handler",
        objective: "Inspect handler prompt wiring.",
      });
      await catalog.openSurface(handler.target);
      const handlerManaged = getManagedSurface(catalog, handler.target.surfacePiSessionId);
      const handlerResolvedPrompt = getManagedResolvedSystemPrompt(handlerManaged);

      expect(handlerManaged.systemPrompt).toContain("This surface is a delegated handler thread.");
      expect(handlerManaged.systemPrompt).toContain("Loaded native extension: Shell.");
      expect(handlerManaged.systemPrompt).toContain("Loaded external_instruction records:");
      expect(handlerManaged.systemPrompt).toContain(`# Project Standards\n\nUse repo rules.`);
      expect(handlerManaged.systemPrompt).not.toContain(
        `# Claude Standards\n\nKeep visible instructions.`,
      );
      expect(handlerManaged.systemPrompt).not.toContain("## Handler Profile Override");
      expect(handlerResolvedPrompt).toContain("This surface is a delegated handler thread.");
      expect(handlerResolvedPrompt).not.toContain("# Project Context");
      expect(handlerResolvedPrompt).toContain("# Project Standards");
      expect(handlerResolvedPrompt).not.toContain("# Claude Standards");
      expect(handlerResolvedPrompt).not.toContain("Hidden append text.");
      expect(handlerResolvedPrompt).not.toContain("Hidden root append text.");
      expect(handlerResolvedPrompt).not.toContain("Hidden replacement text.");
      expect(handlerResolvedPrompt).not.toContain("Current date:");
      expect(handlerResolvedPrompt).not.toContain(`Current working directory: ${cwd}`);
      expect(handlerManaged.externalContextSources).toEqual(
        orchestratorManaged.externalContextSources,
      );
      expect(handlerManaged.session.agent.state.systemPrompt).toBe(handlerResolvedPrompt);
    } finally {
      await catalog.dispose();
    }
  });

  it("applies thread_start extension overrides over the threadHandler profile at creation", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Overrides" }, DEFAULTS);
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Delegate with handler extension overrides",
      });
      const orchestratorThread = store.createThread({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        title: "Delegate with handler extension overrides",
        objective: "Open a handler with explicit extension usage overrides.",
      });

      const handlerThread = await (
        catalog as unknown as {
          createHandlerThread(input: {
            sessionId: string;
            turnId: string;
            parentThreadId: string;
            parentSurfacePiSessionId: string;
            objective: string;
            historyMode: "isolated";
            overrides: Record<string, "loaded" | "available" | "unavailable">;
            loadedByCommandId: string;
            autoStart: false;
          }): Promise<{ id: string; surfacePiSessionId: string }>;
        }
      ).createHandlerThread({
        sessionId: created.target.workspaceSessionId,
        turnId: turn.id,
        parentThreadId: orchestratorThread.id,
        parentSurfacePiSessionId: created.target.surfacePiSessionId,
        objective: "Use a narrower handler extension binding for this objective.",
        historyMode: "isolated",
        overrides: {
          "extension-managing": "loaded",
          smithers: "available",
          workflows: "unavailable",
          "request-user-input": "unavailable",
          "thread-orchestration": "loaded",
          "thread-handling": "unavailable",
        },
        loadedByCommandId: orchestratorThread.id,
        autoStart: false,
      });

      const storedThread = store.getThreadDetail(handlerThread.id).thread;
      expect(JSON.parse(storedThread.agentProfileJson ?? "{}")).toMatchObject({
        id: "thread-handler",
        name: "Thread handler",
      });
      expect(storedThread.loadedExtensionIds).toContain("extension-managing");
      expect(storedThread.loadedExtensionIds).toContain("thread-orchestration");
      expect(storedThread.loadedExtensionIds).not.toContain("smithers");
      expect(storedThread.loadedExtensionIds).not.toContain("workflows");
      expect(storedThread.loadedExtensionIds).not.toContain("thread-handling");
      expect(storedThread.availableExtensionIds).toEqual(["smithers"]);

      const handlerTarget = createThreadTarget(
        created.target.workspaceSessionId,
        handlerThread.surfacePiSessionId,
        handlerThread.id,
      );
      await catalog.openSurface(handlerTarget);
      const handlerManaged = getManagedSurface(catalog, handlerThread.surfacePiSessionId);
      const handlerResolvedPrompt = getManagedResolvedSystemPrompt(handlerManaged);
      expect(handlerResolvedPrompt).not.toContain(
        "Loaded prompt-only extension: Smithers CLI workflow authoring.",
      );
      expect(handlerResolvedPrompt).toContain(
        "- smithers: Use official Smithers CLI commands through Shell for workspace .smithers work.",
      );
      expect(handlerResolvedPrompt).not.toContain("svvyx workflows");
      expect(handlerResolvedPrompt).toContain("Loaded native extension: Thread Orchestration.");
      expect(handlerResolvedPrompt).not.toContain("Loaded native extension: Request User Input.");
      const handlerTools = getActiveToolNames(handlerManaged);
      expect(handlerTools).not.toContain("request_user_input");
      expect(handlerTools).not.toContain("thread_current");
      expect(handlerTools).not.toContain("thread_group");
      expect(handlerTools).not.toContain("thread_report");
      expect(handlerTools).not.toContain("thread_episodes");
    } finally {
      await catalog.dispose();
    }
  });

  it("keeps pi ambient resources and submit expansion disabled for managed svvy sessions", () => {
    const adapterSource = readFileSync(
      new URL("../../packages/pi-adapter/src/session.ts", import.meta.url),
      "utf8",
    );
    const catalogSource = readFileSync(new URL("./session-catalog.ts", import.meta.url), "utf8");

    expect(adapterSource).toContain("noExtensions: true");
    expect(adapterSource).toContain("noSkills: true");
    expect(adapterSource).toContain("noPromptTemplates: true");
    expect(adapterSource).toContain("noThemes: true");
    expect(adapterSource).toContain("additionalExtensionPaths: []");
    expect(adapterSource).toContain("additionalSkillPaths: []");
    expect(adapterSource).toContain("additionalPromptTemplatePaths: []");
    expect(adapterSource).toContain("additionalThemePaths: []");
    expect(adapterSource).toContain("extensionFactories: []");
    expect(adapterSource).toContain("systemPromptOverride: () => input.systemPrompt");
    expect(adapterSource).toContain("agentsFilesOverride: () => ({ agentsFiles: [] })");
    expect(adapterSource).toContain("appendSystemPromptOverride: () => []");
    expect(adapterSource).toContain(
      "extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() })",
    );
    expect(adapterSource).toContain("skillsOverride: () => ({ skills: [], diagnostics: [] })");
    expect(adapterSource).toContain("promptsOverride: () => ({ prompts: [], diagnostics: [] })");
    expect(adapterSource).toContain("themesOverride: () => ({ themes: [], diagnostics: [] })");
    expect(adapterSource).toContain('noTools: "builtin"');
    expect(adapterSource).toContain("customTools,");
    expect(adapterSource).toContain(
      "session.setActiveToolsByName(customTools.map((tool) => tool.name))",
    );
    expect(adapterSource).toContain("session.agent.state.systemPrompt = input.systemPrompt");
    expect(adapterSource).not.toContain("extendResources(");
    expect(catalogSource).not.toContain("session.prompt(");
    expect(catalogSource).not.toContain("expandPromptTemplates: false");
  });

  it("keeps the bound context immutable when source standards change", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Standards Drift" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const boundFingerprint = managed.generatedAgentContextFingerprint;
      const boundSourceHashes = [...managed.externalSourceHashes];

      writeFileSync(standardsPath, "# Project Standards\n\nChanged.");
      const reopened = await catalog.openSurface(created.target);

      expect(reopened).toEqual({ target: created.target });
      expect(managed.generatedAgentContextFingerprint).toBe(boundFingerprint);
      expect(managed.externalSourceHashes).toEqual(boundSourceHashes);
      expect(managed.externalContextSources[0]?.content).toContain("Initial.");
    } finally {
      await catalog.dispose();
    }
  });

  it("binds top-level sessions to the stored generated agent context fingerprint", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Generated Context Binding" }, DEFAULTS);
      const storedFingerprint = getStructuredSessionStore(catalog).getSessionState(
        created.target.workspaceSessionId,
      ).pi.generatedAgentContextFingerprint;

      expect(storedFingerprint).toBeTruthy();
      if (!storedFingerprint) {
        throw new Error("Expected generated context fingerprint to be stored.");
      }
      expect(
        getManagedSurface(catalog, created.target.surfacePiSessionId)
          .generatedAgentContextFingerprint,
      ).toBe(storedFingerprint);

      writeFileSync(standardsPath, "# Project Standards\n\nChanged.");
      await catalog.openSurface(created.target);
      expect(
        getManagedSurface(catalog, created.target.surfacePiSessionId)
          .generatedAgentContextFingerprint,
      ).toBe(storedFingerprint);
    } finally {
      await catalog.dispose();
    }
  });

  it("keeps a disposed top-level session bound to its stored generated context fingerprint", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Reopen Context Binding" }, DEFAULTS);
      const storedFingerprint = getStructuredSessionStore(catalog).getSessionState(
        created.target.workspaceSessionId,
      ).pi.generatedAgentContextFingerprint;
      expect(storedFingerprint).toBeTruthy();
      if (!storedFingerprint) {
        throw new Error("Expected generated context fingerprint to be stored.");
      }

      await closeSurface(catalog, created.target);
      writeFileSync(standardsPath, "# Project Standards\n\nChanged after close.");

      const reopened = await catalog.openSurface(created.target);
      expect(reopened).toEqual({ target: created.target });
      expect(
        getManagedSurface(catalog, created.target.surfacePiSessionId)
          .generatedAgentContextFingerprint,
      ).toBe(storedFingerprint);
    } finally {
      await catalog.dispose();
    }
  });

  it("restores a top-level session's bound generated context payload after catalog restart", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial restart payload.");
    const firstCatalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    let target: PromptTarget;
    let storedFingerprint: string;
    let storedAggregateCacheKey = "";

    try {
      const created = await firstCatalog.createSession(
        { title: "Restart Context Binding" },
        DEFAULTS,
      );
      target = created.target;
      const managed = getManagedSurface(firstCatalog, created.target.surfacePiSessionId);
      storedFingerprint = managed.generatedAgentContextFingerprint;
      expect(managed.systemPrompt).toContain("Initial restart payload.");
      expect(storedFingerprint).toBeTruthy();
      const binding = getStructuredSessionStore(firstCatalog).getGeneratedAgentContextBinding({
        surfacePiSessionId: created.target.surfacePiSessionId,
        generatedAgentContextFingerprint: storedFingerprint,
      });
      expect(binding?.aggregateCacheKey).toBeTruthy();
      expect(binding?.systemPrompt).toContain("Initial restart payload.");
      expect(binding?.commandsDts).toContain("declare");
      expect(binding?.nativeToolSchemasJson).toContain("{");
      storedAggregateCacheKey = binding?.aggregateCacheKey ?? "";
    } finally {
      await firstCatalog.dispose();
    }

    writeFileSync(standardsPath, "# Project Standards\n\nChanged after catalog restart.");
    rmSync(join(agentDir, "..", "extensions", "generated", "aggregates"), {
      recursive: true,
      force: true,
    });
    const secondCatalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const reopened = await secondCatalog.openSurface(target!);
      const managed = getManagedSurface(secondCatalog, target!.surfacePiSessionId);
      expect(reopened).toEqual({ target: target! });
      expect(managed.generatedAgentContextFingerprint).toBe(storedFingerprint!);
      expect(managed.systemPrompt).toContain("Initial restart payload.");
      expect(managed.systemPrompt).not.toContain("Changed after catalog restart.");
      const binding = getStructuredSessionStore(secondCatalog).getGeneratedAgentContextBinding({
        surfacePiSessionId: target!.surfacePiSessionId,
        generatedAgentContextFingerprint: storedFingerprint!,
      });
      expect(binding?.aggregateCacheKey).toBe(storedAggregateCacheKey!);
      expect(binding?.systemPrompt).toContain("Initial restart payload.");
      expect(binding?.commandsDts).toContain("declare");
    } finally {
      await secondCatalog.dispose();
    }
  });

  it("binds handler surfaces to the stored generated agent context fingerprint", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Context Binding" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "handler-context-binding",
        objective: "Inspect handler generated context binding.",
      });
      const storedThread = getStructuredSessionStore(catalog)
        .getSessionState(created.target.workspaceSessionId)
        .threads.find((thread) => thread.id === handler.threadId);

      const storedFingerprint = storedThread?.generatedAgentContextFingerprint;
      expect(storedFingerprint).toBeTruthy();
      if (!storedFingerprint) {
        throw new Error("Expected handler generated context fingerprint to be stored.");
      }

      const openedHandler = await catalog.openSurface(handler.target);
      expect(openedHandler).toEqual({ target: handler.target });
      expect(
        getManagedSurface(catalog, handler.target.surfacePiSessionId)
          .generatedAgentContextFingerprint,
      ).toBe(storedFingerprint);
    } finally {
      await catalog.dispose();
    }
  });

  it("keeps a disposed handler surface bound to its stored generated context fingerprint", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Reopen Binding" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "handler-reopen-binding",
        objective: "Inspect handler reopen generated context binding.",
      });
      await catalog.openSurface(handler.target);
      const storedFingerprint = getManagedSurface(
        catalog,
        handler.target.surfacePiSessionId,
      ).generatedAgentContextFingerprint;
      expect(storedFingerprint).toBeTruthy();
      if (!storedFingerprint) {
        throw new Error("Expected handler generated context fingerprint to be stored.");
      }

      await closeSurface(catalog, handler.target);
      writeFileSync(standardsPath, "# Project Standards\n\nChanged after handler close.");

      const reopened = await catalog.openSurface(handler.target);
      expect(reopened).toEqual({ target: handler.target });
      expect(
        getManagedSurface(catalog, handler.target.surfacePiSessionId)
          .generatedAgentContextFingerprint,
      ).toBe(storedFingerprint);
    } finally {
      await catalog.dispose();
    }
  });

  it("restores a handler surface's bound generated context payload after catalog restart", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial handler restart payload.");
    const firstCatalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    let handlerTarget: PromptTarget;
    let storedFingerprint: string;

    try {
      const created = await firstCatalog.createSession(
        { title: "Handler Restart Binding" },
        DEFAULTS,
      );
      const handler = await createHandlerThreadHarness(
        firstCatalog,
        created.target.workspaceSessionId,
        {
          title: "handler-restart-binding",
          objective: "Inspect handler generated context binding after restart.",
        },
      );
      await firstCatalog.openSurface(handler.target);
      const managed = getManagedSurface(firstCatalog, handler.target.surfacePiSessionId);
      handlerTarget = handler.target;
      storedFingerprint = managed.generatedAgentContextFingerprint;
      expect(managed.systemPrompt).toContain("Initial handler restart payload.");
      expect(storedFingerprint).toBeTruthy();
    } finally {
      await firstCatalog.dispose();
    }

    writeFileSync(standardsPath, "# Project Standards\n\nChanged handler restart payload.");
    const secondCatalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const reopened = await secondCatalog.openSurface(handlerTarget!);
      const managed = getManagedSurface(secondCatalog, handlerTarget!.surfacePiSessionId);
      expect(reopened).toEqual({ target: handlerTarget! });
      expect(managed.generatedAgentContextFingerprint).toBe(storedFingerprint!);
      expect(managed.systemPrompt).toContain("Initial handler restart payload.");
      expect(managed.systemPrompt).not.toContain("Changed handler restart payload.");
    } finally {
      await secondCatalog.dispose();
    }
  });

  it("does not mark a fresh orchestrator profile prompt binding stale", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession(
        { title: "Fresh Orchestrator Profile" },
        {
          ...DEFAULTS,
          agentProfileId: DEFAULT_ORCHESTRATOR_PROFILE_ID,
        },
      );
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const stored = getStructuredSessionStore(catalog).getSessionState(
        created.target.workspaceSessionId,
      );

      expect(managed.generatedAgentContextFingerprint).toBe(
        stored.pi.generatedAgentContextFingerprint ?? "",
      );
      expect(stored.pi.updateExtensionContextBeforeNextTurn).toBe(true);
      expect(managed.systemPrompt).not.toContain("## Orchestrator Profile");
      expect(managed.systemPrompt).toBe(buildSystemPrompt("orchestrator"));
    } finally {
      await catalog.dispose();
    }
  });

  it("schedules orchestrator generated context refresh after load_extension applies state", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Load Extension Binding" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      managed.recreateOnNextPrompt = false;
      const notifySpy = spyOn(
        catalog as unknown as {
          notifySourceInputsChanged(reason: string): Promise<void>;
        },
        "notifySourceInputsChanged",
      ).mockResolvedValue(undefined);

      await (
        catalog as unknown as {
          refreshGeneratedContextForLoadExtension(input: {
            scope: "target";
            target: typeof created.target;
            reason: "load_extension";
            sourceCommandId: string;
            refreshBoundSurfaceBeforeNextTurn: boolean;
          }): Promise<void>;
        }
      ).refreshGeneratedContextForLoadExtension({
        scope: "target",
        target: created.target,
        reason: "load_extension",
        sourceCommandId: "command-load-smithers",
        refreshBoundSurfaceBeforeNextTurn: true,
      });

      expect(managed.recreateOnNextPrompt).toBe(true);
      expect(notifySpy).toHaveBeenCalledWith("runtime_refresh:load_extension");
    } finally {
      await catalog.dispose();
    }
  });

  it("schedules handler generated context refresh after load_extension applies state", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Load" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "handler-load-extension",
        objective: "Load handler-local extension guidance.",
      });
      await catalog.openSurface(handler.target);
      const managed = getManagedSurface(catalog, handler.surfacePiSessionId);
      managed.recreateOnNextPrompt = false;
      const notifySpy = spyOn(
        catalog as unknown as {
          notifySourceInputsChanged(reason: string): Promise<void>;
        },
        "notifySourceInputsChanged",
      ).mockResolvedValue(undefined);

      await (
        catalog as unknown as {
          refreshGeneratedContextForLoadExtension(input: {
            scope: "target";
            target: typeof handler.target;
            reason: "load_extension";
            sourceCommandId: string;
            refreshBoundSurfaceBeforeNextTurn: boolean;
          }): Promise<void>;
        }
      ).refreshGeneratedContextForLoadExtension({
        scope: "target",
        target: handler.target,
        reason: "load_extension",
        sourceCommandId: "command-load-extension-managing",
        refreshBoundSurfaceBeforeNextTurn: true,
      });

      expect(managed.recreateOnNextPrompt).toBe(true);
      expect(notifySpy).toHaveBeenCalledWith("runtime_refresh:load_extension");
    } finally {
      await catalog.dispose();
    }
  });

  it("ignores raw orchestrator profile prompt settings", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const suffix = "Custom raw orchestrator profile suffix.";

    try {
      const customProfile: AgentProfileSettings = {
        id: "custom-orchestrator",
        kind: "orchestrator",
        name: "Custom orchestrator",
        provider: DEFAULTS.provider,
        model: DEFAULTS.model,
        reasoningEffort: DEFAULTS.thinkingLevel,
        systemPrompt: suffix,
        extensionUsage: {},
        updateFromComposer: false,
        builtin: false,
        locked: false,
      };
      await setCatalogAgentProfile(catalog, customProfile);
      const created = await catalog.createSession(
        { title: "Raw Settings Prompt" },
        {
          ...DEFAULTS,
          agentProfileId: "custom-orchestrator",
        },
      );
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);

      expect(managed.systemPrompt).toBe(buildSystemPrompt("orchestrator"));
      expect(managed.systemPrompt).not.toContain("## Orchestrator Profile");
      expect(managed.systemPrompt).not.toContain(suffix);
    } finally {
      await catalog.dispose();
    }
  });

  it("rejects unknown create-session agent profiles instead of falling back", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      await expect(
        catalog.createSession(
          { title: "Unknown Profile", agentProfileId: "missing-profile" },
          DEFAULTS,
        ),
      ).rejects.toThrow("Unknown orchestrator agent profile: missing-profile");
    } finally {
      await catalog.dispose();
    }
  });

  it("persists extension context auto-update per surface", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Auto Update Preference" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "auto-update-handler",
        objective: "Check independent auto-update preference.",
      });
      const store = getStructuredSessionStore(catalog);
      expect(
        store.getSessionState(created.target.workspaceSessionId).pi
          .updateExtensionContextBeforeNextTurn,
      ).toBe(true);
      expect(
        store
          .getSessionState(created.target.workspaceSessionId)
          .threads.find((thread) => thread.id === handler.threadId)
          ?.updateExtensionContextBeforeNextTurn,
      ).toBe(true);

      await catalog.setExtensionContextAutoUpdate({ target: created.target, enabled: false });

      expect(
        store.getSessionState(created.target.workspaceSessionId).pi
          .updateExtensionContextBeforeNextTurn,
      ).toBe(false);
      expect(
        store
          .getSessionState(created.target.workspaceSessionId)
          .threads.find((thread) => thread.id === handler.threadId)
          ?.updateExtensionContextBeforeNextTurn,
      ).toBe(true);
    } finally {
      await catalog.dispose();
    }
  });

  it("exposes thread state tools on the intended actor surfaces", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Tool Surface" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const orchestratorTools = getActiveToolNames(orchestratorManaged);
      expect(orchestratorTools).toEqual(
        expect.arrayContaining([
          "thread_list",
          "thread_episodes",
          "thread_start",
          "thread_followup",
          "thread_request_report",
        ]),
      );
      expect(orchestratorTools).not.toContain("request_user_input");
      expect(orchestratorTools).not.toContain("thread_current");
      expect(orchestratorTools).not.toContain("thread_group");
      expect(orchestratorTools).not.toContain("thread_report");
      expect(orchestratorTools).not.toContain("thread_handoff");
      expect(orchestratorTools).not.toContain("thread_handoffs");
      expect(orchestratorTools).not.toContain("thread_resume");
      expect(orchestratorTools).not.toContain("wait");
      expect(orchestratorTools).not.toContain("request_context");
      expect(orchestratorTools.some((name) => name.startsWith("smithers_"))).toBe(false);

      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Tool Surface Handler",
        objective: "Inspect handler tool surface.",
      });
      await catalog.openSurface(handler.target);
      const handlerManaged = getManagedSurface(catalog, handler.target.surfacePiSessionId);
      const handlerTools = getActiveToolNames(handlerManaged);
      expect(handlerTools).toEqual(
        expect.arrayContaining([
          "thread_current",
          "thread_group",
          "thread_report",
          "thread_episodes",
        ]),
      );
      expect(handlerTools).not.toContain("request_user_input");
      expect(handlerTools).not.toContain("thread_list");
      expect(handlerTools).not.toContain("thread_start");
      expect(handlerTools).not.toContain("thread_resume");
      expect(handlerTools).not.toContain("thread_handoffs");
      expect(handlerTools).not.toContain("thread_handoff");
      expect(handlerTools).not.toContain("request_context");
      expect(handlerTools).not.toContain("wait");
      expect(handlerTools.some((name) => name.startsWith("smithers_"))).toBe(false);
    } finally {
      await catalog.dispose();
    }
  });

  it("opens multiple surfaces simultaneously and only disposes them after explicit closes", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Multi Surface" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Parser Fix",
        objective: "Patch the parser bug in a delegated handler surface.",
      });

      const firstHandlerOpen = await catalog.openSurface(handler.target);
      const secondHandlerOpen = await catalog.openSurface(handler.target);

      expect(firstHandlerOpen.target).toEqual(handler.target);
      expect(secondHandlerOpen.target).toEqual(handler.target);
      expect(getManagedSurfaces(catalog).size).toBe(2);
      expect(getManagedSurface(catalog, created.target.surfacePiSessionId).retainCount).toBe(1);
      expect(getManagedSurface(catalog, handler.target.surfacePiSessionId).retainCount).toBe(2);

      const openSurfaceIds = [...getManagedSurfaces(catalog).keys()];
      expect(openSurfaceIds).toEqual(
        expect.arrayContaining([
          created.target.surfacePiSessionId,
          handler.target.surfacePiSessionId,
        ]),
      );

      await closeSurface(catalog, handler.target);
      expect(getManagedSurface(catalog, handler.target.surfacePiSessionId).retainCount).toBe(1);

      await closeSurface(catalog, handler.target);
      await waitFor(() => !getManagedSurfaces(catalog).has(handler.target.surfacePiSessionId));

      await closeSurface(catalog, created.target);
      await waitFor(() => getManagedSurfaces(catalog).size === 0);
    } finally {
      await catalog.dispose();
    }
  });

  it("rejects edit-to-composer for rows that are already dispatching", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Queued Edit Guard" }, DEFAULTS);
      const store = getStructuredSessionStore(catalog);
      const queued = store.enqueueSurfaceMessage({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        messageJson: JSON.stringify(userMessage("This row is already claimed.")),
      });
      const claimed = store.claimNextQueuedSurfaceMessage({
        surfacePiSessionId: created.target.surfacePiSessionId,
        claimOwnerId: "runtime-worker-edit-guard",
        leaseDurationMs: 15_000,
      });

      await expect(
        catalog.editQueuedSurfaceMessage({
          target: created.target,
          queuedMessageId: queued.id,
        }),
      ).rejects.toThrow("Surface queued message claim is stale or not cancellable");

      expect(store.getSurfaceQueuedMessage({ id: queued.id })).toMatchObject({
        id: queued.id,
        status: "dispatching",
        claimOwnerId: "runtime-worker-edit-guard",
        leaseVersion: claimed!.leaseVersion,
      });
    } finally {
      await catalog.dispose();
    }
  });

  it("applies model and reasoning changes only to the targeted surface", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Surface Settings" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Settings Handler",
        objective: "Own handler-local model and reasoning state.",
      });
      await catalog.openSurface(handler.target);
      const orchestrator = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const orchestratorModel = orchestrator.model;
      const orchestratorReasoning = orchestrator.thinkingLevel;

      await setSurfaceModel(catalog, handler.target, "gpt-4.1-mini");
      await setSurfaceThoughtLevel(catalog, handler.target, "high");

      const handlerManaged = getManagedSurface(catalog, handler.target.surfacePiSessionId);
      expect(orchestrator.model).toBe(orchestratorModel);
      expect(orchestrator.thinkingLevel).toBe(orchestratorReasoning);
      expect(handlerManaged.model).toBe("gpt-4.1-mini");
      expect(handlerManaged.thinkingLevel).toBe("high");
    } finally {
      await catalog.dispose();
    }
  });

  it("resolves active orchestrator prompt defaults from structured state", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "State-owned defaults" }, DEFAULTS);
      const storedDefaults = await catalog.resolvePromptDefaultsForTarget(created.target);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      managed.provider = "live-pi-provider";
      managed.model = "live-pi-model";
      managed.thinkingLevel = "xhigh";

      expect(await catalog.resolvePromptDefaultsForTarget(created.target)).toEqual(storedDefaults);
    } finally {
      await catalog.dispose();
    }
  });

  it("does not copy unrelated live pi metadata into structured session defaults", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Narrow defaults commit" }, DEFAULTS);
      const store = getStructuredSessionStore(catalog);
      const before = structuredClone(store.getSessionState(created.target.workspaceSessionId).pi);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      managed.agentProfileId = "live-pi-profile";
      managed.loadedExtensionIds = ["live-pi-loaded"];
      managed.availableExtensionIds = ["live-pi-available"];
      managed.generatedAgentContextFingerprint = "live-pi-fingerprint";

      await setSurfaceThoughtLevel(catalog, created.target, "high");

      const after = store.getSessionState(created.target.workspaceSessionId).pi;
      expect(after.reasoningEffort).toBe("high");
      expect(after.orchestratorAgentProfileId).toBe(before.orchestratorAgentProfileId);
      expect(after.loadedExtensionIds).toEqual(before.loadedExtensionIds);
      expect(after.availableExtensionIds).toEqual(before.availableExtensionIds);
      expect(after.generatedAgentContextFingerprint).toBe(before.generatedAgentContextFingerprint);
    } finally {
      await catalog.dispose();
    }
  });

  it("clamps surface reasoning when a model change no longer supports the current level", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Reasoning Clamp" }, DEFAULTS);
      await setSurfaceThoughtLevel(catalog, created.target, "high");
      await setSurfaceModel(catalog, created.target, "amazon.nova-2-lite-v1:0", "amazon-bedrock");

      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      expect(managed.provider).toBe("amazon-bedrock");
      expect(managed.model).toBe("amazon.nova-2-lite-v1:0");
      expect(managed.thinkingLevel).toBe("off");
    } finally {
      await catalog.dispose();
    }
  });

  it("updates orchestrator profile defaults from composer changes only when enabled", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const syncedProfile: AgentProfileSettings = {
      id: "composer-synced",
      kind: "orchestrator",
      name: "Composer synced",
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "medium",
      systemPrompt: DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
      extensionUsage: {},
      updateFromComposer: true,
      builtin: false,
      locked: false,
    };
    const fixedProfile: AgentProfileSettings = {
      ...syncedProfile,
      id: "fixed-profile",
      name: "Fixed profile",
      updateFromComposer: false,
    };

    try {
      await setCatalogAgentProfile(catalog, syncedProfile);
      await setCatalogAgentProfile(catalog, fixedProfile);

      const synced = await catalog.createSession(
        { title: "Synced profile", agentProfileId: syncedProfile.id },
        {
          provider: syncedProfile.provider,
          model: syncedProfile.model,
          thinkingLevel: syncedProfile.reasoningEffort,
          agentProfileId: syncedProfile.id,
        },
      );
      await setSurfaceModel(catalog, synced.target, "gpt-4.1-mini");
      await setSurfaceThoughtLevel(catalog, synced.target, "high");
      await setSurfaceExtensionUsage(catalog, synced.target, "smithers", "loaded");

      const syncedAfter = (await getCatalogAgentProfiles(catalog)).find(
        (profile) => profile.id === syncedProfile.id,
      );
      expect(syncedAfter).toMatchObject({
        provider: "openai",
        model: "gpt-4.1-mini",
        reasoningEffort: "high",
      });
      expect(syncedAfter?.extensionUsage.smithers).toBe("loaded");

      const fixed = await catalog.createSession(
        { title: "Fixed profile", agentProfileId: fixedProfile.id },
        {
          provider: fixedProfile.provider,
          model: fixedProfile.model,
          thinkingLevel: fixedProfile.reasoningEffort,
          agentProfileId: fixedProfile.id,
        },
      );
      await setSurfaceModel(catalog, fixed.target, "gpt-4.1-mini");
      await setSurfaceThoughtLevel(catalog, fixed.target, "high");
      const fixedExtensionResult = await catalog.setSurfaceExtensionUsage({
        target: fixed.target,
        extensionId: "smithers",
        state: "loaded",
      });

      const fixedAfter = (await getCatalogAgentProfiles(catalog)).find(
        (profile) => profile.id === fixedProfile.id,
      );
      expect(fixedAfter).toMatchObject({
        provider: "openai",
        model: "gpt-4o",
        reasoningEffort: "medium",
      });
      expect(fixedAfter?.extensionUsage.smithers).toBeUndefined();
      expect(fixedExtensionResult).toEqual({ ok: true, target: fixed.target });
      expect(
        getManagedSurface(catalog, fixed.target.surfacePiSessionId).loadedExtensionIds,
      ).toContain("smithers");
    } finally {
      await catalog.dispose();
    }
  });

  it("uses the injected runtime layer config for runtime-owned bridge and queue policy", () => {
    const source = readFileSync(new URL("./session-catalog.ts", import.meta.url), "utf8");

    expect(source).toContain("this.runtimeLayerConfig.workflowTaskAgentBridgeMaxRequestBytes");
    expect(source).toContain("this.runtimeLayerConfig.workflowTaskAgentBridgeRequestTimeoutMs");
    expect(source).toContain("this.runtimeLayerConfig.workflowTaskAgentBridgeMaxResponseBytes");
    expect(source).not.toContain("this.runtimeLayerConfig.queueClaimLeaseMs");
    expect(source).not.toContain(
      "defaultRuntimeLayerConfig.workflowTaskAgentBridgeMaxRequestBytes",
    );
    expect(source).not.toContain(
      "defaultRuntimeLayerConfig.workflowTaskAgentBridgeRequestTimeoutMs",
    );
    expect(source).not.toContain(
      "defaultRuntimeLayerConfig.workflowTaskAgentBridgeMaxResponseBytes",
    );
    expect(source).not.toContain("defaultRuntimeLayerConfig.queueClaimLeaseMs");
  });
});
