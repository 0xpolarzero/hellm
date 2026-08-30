import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  DEFAULT_THREAD_HANDLER_PROFILE_ID,
} from "../shared/agent-settings";
import { createPromptExecutionContext } from "@svvy/runtime/prompt-execution-context";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeSessionWaitStatePort,
  type AbsolutePath,
  type BuildLaunchPolicyInput,
  type CommandId,
  type PromptExecutionContext,
  type RuntimeApprovalId,
  type RuntimeSurfaceTarget,
  type SandboxLaunchFacts,
  type StateInvalidationDescriptor,
  type ToolCallId,
  type TurnId,
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
import { createWorkspaceStateRouter } from "@svvy/state/structured-session-adapters";
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
          profileId: DEFAULT_ORCHESTRATOR_PROFILE_ID as never,
          provider: "zai" as never,
          model: "glm-5-turbo" as never,
          reasoningEffort: "medium",
          loadedExtensionIds: ["extension-loading" as never],
          availableExtensionIds: [],
        }),
      );

      expect(created.value.workspaceSessionId).toBeDefined();
      expect(invoked).toBe(true);
    } finally {
      store.createOrchestratorSurface = createOrchestratorSurface;
    }
  });

  it("projects sandbox policy from hydrated app preferences without copying workspace state", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(
      cwd,
      agentDir,
      sessionDir,
      undefined,
      false,
      { workflowsSourceRoot: join(agentDir, "..", "workflows") },
      false,
    );

    try {
      const { store } = catalog.workspaceStateRouterRegistration();
      const source = catalog.getSandboxPolicySource();
      const defaults = createAgentSettingsStore({ agentDir }).getState().appPreferences;
      catalog.updateAppPreferences({
        ...defaults,
        approvalMode: "full-access",
        networkAccess: false,
      });

      expect(store.readAppPreferences()).toMatchObject({
        approvalMode: "auto-review",
        networkAccess: true,
      });
      const fullAccess = await runCatalogEffect(
        source.snapshot({
          scope: { kind: "workspace", workspaceId: store.workspaceId as WorkspaceId },
          commandId: "command-catalog-full-access-policy" as CommandId,
          launchKind: "execute_typescript_runtime",
          cwd: cwd as AbsolutePath,
        }),
      );
      expect(fullAccess).toMatchObject({
        sandboxMode: "omitted_full_access",
        networkPolicy: "allow",
        filesystemPolicy: { defaultAccess: "read", entries: [] },
      });

      catalog.updateAppPreferences({
        ...defaults,
        approvalMode: "auto-review",
        networkAccess: false,
      });
      const managed = await runCatalogEffect(
        source.snapshot({
          scope: { kind: "workspace", workspaceId: store.workspaceId as WorkspaceId },
          commandId: "command-catalog-managed-policy" as CommandId,
          launchKind: "execute_typescript_runtime",
          cwd: cwd as AbsolutePath,
        }),
      );
      expect(managed).toMatchObject({
        sandboxMode: "managed",
        networkPolicy: "deny",
      });
    } finally {
      await catalog.dispose();
    }
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

  it("runs accepted execute_typescript without a synchronous profile snapshot and publishes committed facts", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const published: StateInvalidationDescriptor[][] = [];
    const catalog = createWorkspaceSessionCatalog(
      cwd,
      agentDir,
      sessionDir,
      () => ({ approved: true }),
      false,
      {
        artifactDirectory: join(agentDir, "artifacts"),
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
        acquireExecuteTypescriptLaunch: async (input) => ({
          facts: {
            mode: "managed",
            spawn: {
              executable: process.execPath as AbsolutePath,
              args: input.command.slice(1),
              cwd: input.cwd,
              envFacts: input.envFacts,
            },
            helperPath: join(agentDir, "sandbox-helper") as AbsolutePath,
            helperArgs: [],
            policySnapshot: {
              snapshotId: "accepted-execute-ts-snapshot",
              fingerprint: "accepted-execute-ts-fingerprint",
              resolvedAt: "2026-07-13T00:00:00.000Z" as never,
              scope: input.scope,
              ...(input.surfacePiSessionId ? { surfacePiSessionId: input.surfacePiSessionId } : {}),
              commandId: input.commandId,
              launchKind: "execute_typescript_runtime",
              cwd: input.cwd,
              sandboxMode: "managed",
              networkPolicy: "allow",
              filesystemPolicy: { defaultAccess: "read", entries: [] },
            },
          },
          close: async () => {},
        }),
      },
    );

    try {
      await catalog.setCommittedStateInvalidationPublisher(async (afterCommit) => {
        published.push([...afterCommit]);
      });
      const created = await catalog.createSession(
        { title: "Accepted Execute TypeScript" },
        DEFAULTS,
      );
      catalog.setAgentProfileAuthority(createInMemoryCatalogAgentProfileAuthority());
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Run accepted execute_typescript",
      });
      const toolCallId = "tool-call-accepted-execute-ts" as never;
      const command = await runCatalogEffect(
        catalog.getRuntimeCommandStatePort().createOrReuseStreamingCommand({
          toolCallId,
          turnId: turn.id,
          workflowTaskAttemptId: null,
          surfacePiSessionId: created.target.surfacePiSessionId,
          threadId: null,
          workflowRunId: null,
          toolName: "execute_typescript",
          executor: "orchestrator",
          visibility: "surface",
          title: "Run execute_typescript",
          summary: "Execute bounded TypeScript.",
          arguments: { typescriptCode: "return { answer: 42 };" },
        }),
      );
      await runCatalogEffect(
        catalog.getRuntimeCommandStatePort().startCommand({ commandId: command.value.id }),
      );

      const result = await catalog.runAcceptedExecuteTypescript({
        workspaceId: store.workspaceId as WorkspaceId,
        target: created.target as unknown as RuntimeSurfaceTarget,
        turnId: turn.id as TurnId,
        toolCallId: toolCallId as ToolCallId,
        commandId: command.value.id as CommandId,
        typescriptCode: "return { answer: 42 };",
        approvalMode: "auto-review",
        cwd: cwd as AbsolutePath,
        promptContext: createPromptExecutionContext({
          workspaceSessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          surfacePiSessionId: created.target.surfacePiSessionId,
          rootThreadId: null,
          generatedAgentContextFingerprint: "accepted_execute_ts_context",
          generatedAgentContextRevision: "1",
        }),
        actorBinding: {
          actorKind: "orchestrator",
          loadedExtensionIds: [],
          availableExtensionIds: [],
          unavailableExtensionIds: [],
          instructionOrder: [],
          source: "surface-binding",
        },
      });

      expect(
        JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "{}"),
      ).toEqual({
        success: true,
        result: { answer: 42 },
      });
      const snapshot = store.getSessionState(created.target.workspaceSessionId);
      expect(
        snapshot.commands.find((candidate) => candidate.id === command.value.id),
      ).toMatchObject({
        status: "succeeded",
        facts: { snippetArtifactId: expect.any(String) },
      });
      expect(snapshot.artifacts).toHaveLength(1);
      expect(
        published.flat().some((descriptor) => descriptor.invalidation.model === "commandInspector"),
      ).toBe(true);
      expect(
        published
          .flat()
          .some((descriptor) => descriptor.invalidation.model === "sessionNavigation"),
      ).toBe(true);

      const failureToolCallId = "tool-call-accepted-execute-ts-failure" as never;
      const failedCommand = await runCatalogEffect(
        catalog.getRuntimeCommandStatePort().createOrReuseStreamingCommand({
          toolCallId: failureToolCallId,
          turnId: turn.id,
          workflowTaskAttemptId: null,
          surfacePiSessionId: created.target.surfacePiSessionId,
          threadId: null,
          workflowRunId: null,
          toolName: "execute_typescript",
          executor: "orchestrator",
          visibility: "surface",
          title: "Run execute_typescript",
          summary: "Execute bounded TypeScript.",
          arguments: { typescriptCode: "return missingIdentifier;" },
        }),
      );
      await runCatalogEffect(
        catalog.getRuntimeCommandStatePort().startCommand({ commandId: failedCommand.value.id }),
      );
      const failedResult = await catalog.runAcceptedExecuteTypescript({
        workspaceId: store.workspaceId as WorkspaceId,
        target: created.target as unknown as RuntimeSurfaceTarget,
        turnId: turn.id as TurnId,
        toolCallId: failureToolCallId as ToolCallId,
        commandId: failedCommand.value.id as CommandId,
        typescriptCode: "return missingIdentifier;",
        approvalMode: "auto-review",
        cwd: cwd as AbsolutePath,
        promptContext: createPromptExecutionContext({
          workspaceSessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          surfacePiSessionId: created.target.surfacePiSessionId,
          rootThreadId: null,
          generatedAgentContextFingerprint: "accepted_execute_ts_context",
          generatedAgentContextRevision: "1",
        }),
        actorBinding: {
          actorKind: "orchestrator",
          loadedExtensionIds: [],
          availableExtensionIds: [],
          unavailableExtensionIds: [],
          instructionOrder: [],
          source: "surface-binding",
        },
      });
      expect(
        JSON.parse(
          failedResult.content?.[0]?.type === "text" ? failedResult.content[0].text : "{}",
        ),
      ).toMatchObject({ success: false, error: { stage: "typecheck" } });
      expect(
        store
          .getSessionState(created.target.workspaceSessionId)
          .commands.find((candidate) => candidate.id === failedCommand.value.id),
      ).toMatchObject({ status: "failed", facts: { diagnosticsArtifactId: expect.any(String) } });
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

  it("publishes running and completed top-level title invalidations from the asynchronous job", async () => {
    const { cwd, agentDir, sessionDir, workflowsSourceRoot } = createWorkspaceFixture();
    const restoreTitleNamerEnv = configureHermeticTitleNamer(agentDir);
    const restoreTitleCompletion = setPiTitleCompletionForTests(
      async () =>
        assistantMessage("Generated async title", {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        }) as AssistantMessage,
    );
    const catalog = createWorkspaceSessionCatalog(
      cwd,
      agentDir,
      sessionDir,
      undefined,
      false,
      { workflowsSourceRoot },
      false,
    );
    const publications: StateInvalidationDescriptor[][] = [];
    const titleLogStatuses: string[] = [];
    const completedTitle = Promise.withResolvers<void>();

    try {
      catalog.setTitleGenerationLogListener((event) => {
        titleLogStatuses.push(event.status);
        if (event.status === "completed") completedTitle.resolve();
      });
      await catalog.prepareWorkspaceRecoveryAfterRegistration();
      catalog.startWorkspaceRecovery();
      const created = await catalog.createSession({ title: "New orchestrator" }, DEFAULTS);
      const registration = catalog.workspaceStateRouterRegistration();
      const stateRouter = createWorkspaceStateRouter({
        appGlobalStore: registration.store,
        workspaceStores: [{ ...registration, isDefaultWorkspace: true }],
      });
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
      const queued = await runCatalogEffect(
        stateRouter.turn.queueTopLevelTitleGeneration({
          sessionId: created.target.workspaceSessionId as never,
          surfacePiSessionId: created.target.surfacePiSessionId as never,
        }),
      );
      expect(queued.value.queued).toBe(true);
      await completedTitle.promise;

      expect(store.getSessionState(created.target.workspaceSessionId).pi).toMatchObject({
        title: "Generated async title",
        titleGenerationStatus: "completed",
      });
      expect(titleLogStatuses).toEqual(["queued", "started", "completed"]);
      expect(publications).toHaveLength(2);
      expect(publications.map((batch) => batch.map((item) => item.invalidation.model))).toEqual([
        ["surface", "sessionNavigation"],
        ["surface", "sessionNavigation"],
      ]);
    } finally {
      catalog.setTitleGenerationLogListener(null);
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

  it("persists the live first composer draft across surface close and reopen", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
      getStructuredSessionStore(catalog).setComposerDraft({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        threadId: null,
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
        snippetMentions: [],
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
