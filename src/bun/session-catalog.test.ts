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
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, StopReason, ToolCall } from "@mariozechner/pi-ai";
import type {
  PromptTarget,
  SurfaceSyncMessage,
  WorkspaceSyncMessage,
} from "../shared/workspace-contract";
import {
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
  DEFAULT_THREAD_HANDLER_PROFILE_ID,
  DEFAULT_THREAD_HANDLER_PROMPT,
  type AgentProfileSettings,
} from "../shared/agent-settings";
import { buildSystemPrompt } from "./default-system-prompt";
import {
  createPromptExecutionContext,
  type PromptExecutionContext,
} from "./prompt-execution-context";
import {
  getSvvyAgentDir,
  getSvvyDataDir,
  getSvvySessionDir,
  normalizeGeneratedTitle,
  WorkspaceSessionCatalog,
  resolveRestoredSessionDefaults,
  type SessionDefaults,
  type TitleGenerationLogEvent,
} from "./session-catalog";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import { createAgentSettingsStore } from "./agent-settings-store";
import type { StructuredSessionStateStore } from "./structured-session-state";
import { createThreadReportTool } from "./thread-report-tool";

const tempDirs: string[] = [];

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
  systemPrompt: string;
  generatedAgentContextFingerprint: string;
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

function createWorkspaceSessionCatalog(
  cwd: string,
  agentDir: string,
  sessionDir: string,
  approvalBoundary?: RuntimeApprovalBoundary,
): WorkspaceSessionCatalog {
  return new WorkspaceSessionCatalog(
    cwd,
    agentDir,
    sessionDir,
    undefined,
    undefined,
    {
      workflowsSourceRoot: join(agentDir, "..", "workflows"),
    },
    approvalBoundary,
  );
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function userMessage(text: string): Message {
  return {
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text }],
  };
}

function userMessageText(message: AgentMessage | null | undefined): string {
  if (!message || message.role !== "user") {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
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
    surface: "thread",
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

function createPersistedSession(
  cwd: string,
  sessionDir: string,
  options: {
    title?: string;
    prompt: string;
    reply: string;
    replyStopReason?: StopReason;
    thinkingLevel?: ThinkingLevel;
    assistantProvider?: string;
    assistantModel?: string;
    modelChange?: {
      provider: string;
      model: string;
    };
  },
) {
  const sessionManager = SessionManager.create(cwd, sessionDir);
  if (options.title) {
    sessionManager.appendSessionInfo(options.title);
  }
  if (options.thinkingLevel) {
    sessionManager.appendThinkingLevelChange(options.thinkingLevel);
  }
  sessionManager.appendMessage(userMessage(options.prompt));
  sessionManager.appendMessage(
    assistantMessage(options.reply, {
      stopReason: options.replyStopReason,
      provider: options.assistantProvider,
      model: options.assistantModel,
    }),
  );
  if (options.modelChange) {
    sessionManager.appendModelChange(options.modelChange.provider, options.modelChange.model);
  }

  return {
    id: sessionManager.getSessionId(),
    path: sessionManager.getSessionFile(),
  };
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

function expectNoPromptReconstruction(promptText: string): void {
  const oldDurableContextHeader = ["Durable Surface", "Context:"].join(" ");
  const oldContinuationWrapper = [
    "Continue the conversation from the latest user message.",
    "Respond only as the assistant.",
  ].join(" ");
  expect(promptText).not.toContain(oldDurableContextHeader);
  expect(promptText).not.toContain(oldContinuationWrapper);
  expect(promptText).not.toContain("\nUser:");
  expect(promptText).not.toContain("\nAssistant:");
}

function captureTitleGenerationLogs(catalog: WorkspaceSessionCatalog): TitleGenerationLogEvent[] {
  const events: TitleGenerationLogEvent[] = [];
  catalog.setTitleGenerationLogListener((event) => {
    events.push(structuredClone(event));
  });
  return events;
}

function findManagedSurfaceBySession(
  catalog: WorkspaceSessionCatalog,
  session: PromptableSession,
): ManagedSurfaceRecord | null {
  for (const surface of getManagedSurfaces(catalog).values()) {
    if (surface.session === session) {
      return surface;
    }
  }
  return null;
}

function appendGeneratedAgentContextMarker(catalog: WorkspaceSessionCatalog, marker: string): void {
  const state = catalog.getGeneratedAgentContextState();
  const block = Object.values(state.instructionBlocks)[0];
  if (!block) {
    throw new Error("Expected default generated agent context instruction block.");
  }
  catalog.updateGeneratedAgentContextState({
    ...state,
    revision: state.revision + 1,
    updatedAt: new Date().toISOString(),
    instructionBlocks: {
      ...state.instructionBlocks,
      [block.id]: {
        ...block,
        body: `${block.body}\n\n${marker}`,
      },
    },
  });
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
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

async function cancelSurfacePrompt(
  catalog: WorkspaceSessionCatalog,
  target: PromptTarget,
): Promise<void> {
  const cancelPromptFn = (
    catalog as unknown as {
      cancelPrompt: (input: PromptTarget | { target: PromptTarget }) => Promise<void>;
    }
  ).cancelPrompt;
  const source = String(cancelPromptFn);
  if (source.includes(".target")) {
    await cancelPromptFn.call(catalog, { target });
    return;
  }
  await cancelPromptFn.call(catalog, target);
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

function getCatalogAgentProfiles(catalog: WorkspaceSessionCatalog): AgentProfileSettings[] {
  return (
    catalog as unknown as {
      agentSettingsStore: {
        getState: () => { agents: { orchestrators: AgentProfileSettings[] } };
      };
    }
  ).agentSettingsStore.getState().agents.orchestrators;
}

function setCatalogAgentProfile(
  catalog: WorkspaceSessionCatalog,
  profile: AgentProfileSettings,
): void {
  (
    catalog as unknown as {
      agentSettingsStore: {
        setAgentProfile: (profile: AgentProfileSettings) => unknown;
      };
    }
  ).agentSettingsStore.setAgentProfile(profile);
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

function hasAssistantReply(messages: readonly AgentMessage[], text: string): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.content[0]?.type === "text" &&
      message.content[0].text === text,
  );
}

describe("WorkspaceSessionCatalog", () => {
  it("writes generated agent context entries into workspace-owned files", () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    const entries = catalog.getGeneratedAgentContextEntries();
    const webContext = entries.orchestrator.find((entry) => entry.id === "web-context");

    expect(webContext?.sourcePath).toBe(
      ".svvy/generated/agent-context/orchestrator/web-context.md",
    );
    expect(webContext?.source).toBe(".svvy/generated/agent-context/orchestrator/web-context.md");
    expect(existsSync(join(cwd, webContext!.sourcePath))).toBe(true);
    expect(readFileSync(join(cwd, webContext!.sourcePath), "utf8")).toContain(
      "Loaded extension: Web.",
    );
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
    const settingsStore = createAgentSettingsStore({
      cwd,
      agentDir,
      workflowsSourceRoot: join(agentDir, "..", "workflows"),
    });
    settingsStore.setAppPreferences({
      ...settingsStore.getState().appPreferences,
      artifactDirectory: join(agentDir, "artifacts"),
    });
    const approvalRequests: unknown[] = [];
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir, (input) => {
      approvalRequests.push(input);
      return { approved: false, reason: `Denied ${input.toolName}` };
    });

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
        sessionId: created.target.workspaceSessionId,
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        rootThreadId: null,
        promptText: "Run denied execute_typescript",
      });

      await expect(
        getCustomTool(managed, "execute_typescript").execute("tool-call-session-ts", {
          typescriptCode: "console.log('should not run');",
        }),
      ).resolves.toMatchObject({
        details: {
          success: false,
          error: {
            message: "Denied execute_typescript",
            stage: "approval",
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
          context: {
            sessionId: created.target.workspaceSessionId,
            surfacePiSessionId: created.target.surfacePiSessionId,
            actor: "orchestrator",
          },
          cwd,
          toolCallId: "tool-call-session-ts",
          toolName: "execute_typescript",
          typescriptCode: "console.log('should not run');",
        },
      ]);
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
      const settingsStore = createAgentSettingsStore({
        cwd,
        agentDir,
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
      });
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

      await catalog.answerRuntimeApprovalRequest({
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
      const settingsStore = createAgentSettingsStore({
        cwd,
        agentDir,
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
      });
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
      await catalog.answerRuntimeApprovalRequest({
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

  it("cancels pending runtime approval requests when the owning prompt is cancelled", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Cancelled Approval" }, DEFAULTS);
      const settingsStore = createAgentSettingsStore({
        cwd,
        agentDir,
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
      });
      catalog.updateAppPreferences({
        ...settingsStore.getState().appPreferences,
        approvalMode: "user",
      });
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Run cancellable shell",
      });
      const command = store.createCommand({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "surface",
        title: "Shell",
        summary: "printf cancelled",
        facts: { toolCallId: "tool-cancelled-approval-shell" },
      });
      store.startCommand(command.id);

      const pending = getCustomTool(managed, "exec_command").execute(
        "tool-cancelled-approval-shell",
        { cmd: "printf cancelled" },
        new AbortController().signal,
      );

      await waitFor(() =>
        store
          .listOpenRuntimeApprovalRequests()
          .some(
            (request) =>
              request.toolCallId === "tool-cancelled-approval-shell" &&
              request.status === "pending",
          ),
      );
      const request = store.listOpenRuntimeApprovalRequests()[0]!;
      managed.activePrompt = true;
      await cancelSurfacePrompt(catalog, created.target);

      await expect(pending).rejects.toThrow("Prompt cancelled.");
      expect(store.getSessionState(created.target.workspaceSessionId).session.wait).toBeNull();
      expect(store.getSessionState(created.target.workspaceSessionId).commands[0]).toMatchObject({
        status: "cancelled",
        facts: {
          approval: "cancelled",
          approvalRequestId: request.requestId,
        },
      });
      expect(
        store.getSessionState(created.target.workspaceSessionId).runtimeApprovalRequests,
      ).toMatchObject([
        {
          approvalMode: "user",
          command: "printf cancelled",
          status: "cancelled",
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
      expect(handlerPreview.systemPrompt).toContain("This surface is a delegated handler thread.");
      expect(handlerPreview.systemPrompt).toContain("## Handler Profile Override");

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

  it("lists workspace sessions through a sessions array without activeSessionId", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const existing = createPersistedSession(cwd, sessionDir, {
      title: "Existing Session",
      prompt: "Inspect the queue",
      reply: "Queue inspected",
      thinkingLevel: "high",
    });
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Live Session" }, DEFAULTS);
      const result = await catalog.listSessions();

      expect(result.sessions.some((session) => session.id === existing.id)).toBe(true);
      expect(
        result.sessions.some((session) => session.id === created.target.workspaceSessionId),
      ).toBe(true);
      expect("activeSessionId" in (result as unknown as Record<string, unknown>)).toBe(false);
    } finally {
      await catalog.dispose();
    }
  });

  it("records UI-triggered extension revert product events on the owning conversation", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Extension Revert" }, DEFAULTS);
      const recorded = await catalog.recordExtensionRevertProductEvent({
        target: created.target,
        changeId: "chg_linear_00000000-0000-4000-8000-000000000001",
        revertChangeId: "chg_linear_00000000-0000-4000-8000-000000000002",
        extensionId: "linear",
        resultKind: "extension_files",
        autoBuildStatus: "succeeded",
      });

      expect(recorded).toBe(true);
      expect((await catalog.listSessions()).sessions[0]?.productEvents).toEqual([
        expect.objectContaining({
          title: "Extension change reverted",
          summary:
            "User reverted extension extension_files chg_linear_00000000-0000-4000-8000-000000000001 for linear.",
          subject: {
            kind: "session",
            id: created.target.workspaceSessionId,
          },
          details: expect.objectContaining({
            surface: "orchestrator",
            surfacePiSessionId: created.target.surfacePiSessionId,
            changeId: "chg_linear_00000000-0000-4000-8000-000000000001",
            revertChangeId: "chg_linear_00000000-0000-4000-8000-000000000002",
            extensionId: "linear",
            resultKind: "extension_files",
            autoBuildStatus: "succeeded",
          }),
        }),
      ]);
    } finally {
      await catalog.dispose();
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
      expect(
        (await catalog.listSessions()).sessions.some((session) => session.id === sessionId),
      ).toBe(false);

      await catalog.recordFocusedSession({
        sessionId,
        surfacePiSessionId: sessionId,
      });

      expect(() => getStructuredSessionStore(catalog).getSessionState(sessionId)).toThrow(
        `Structured session not found: ${sessionId}`,
      );
      expect(
        (await catalog.listSessions()).sessions.some((session) => session.id === sessionId),
      ).toBe(false);
    } finally {
      process.env.PATH = previousPath;
      await catalog.dispose();
    }
  });

  it("does not clear archive metadata unless the pi file is actually removed", async () => {
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
      const created = await catalog.createSession({ title: "Archived Delete Me" }, DEFAULTS);
      const sessionId = created.target.workspaceSessionId;
      const sessionFile = getManagedSurface(
        catalog,
        sessionId,
      ).session.sessionManager.getSessionFile();

      await catalog.archiveSession(sessionId);
      const archived = (await catalog.listSessions()).sessions.find(
        (session) => session.id === sessionId,
      );
      expect(archived?.isArchived).toBe(true);

      await catalog.deleteSession(sessionId);

      expect(existsSync(sessionFile)).toBe(false);
      expect(
        (await catalog.listSessions()).sessions.some((session) => session.id === sessionId),
      ).toBe(false);
    } finally {
      process.env.PATH = previousPath;
      await catalog.dispose();
    }
  });

  it("keeps hard-deleted sessions tombstoned across repeated create/delete and stale mutations", async () => {
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

        if (index % 3 === 0) {
          await catalog.archiveSession(sessionId);
        } else if (index % 3 === 1) {
          await catalog.pinSession(sessionId);
        }

        await catalog.deleteSession(sessionId);
        deletedSessionIds.push(sessionId);

        expect(existsSync(sessionFile)).toBe(false);
        expect(getStructuredSessionStore(catalog).isSessionDeleted(sessionId)).toBe(true);

        await catalog.recordFocusedSession({ sessionId, surfacePiSessionId: sessionId });
        await catalog.markSessionRead(sessionId);
        await catalog.markSessionUnread(sessionId);
        await catalog.archiveSession(sessionId);
        await catalog.unarchiveSession(sessionId);
        await catalog.pinSession(sessionId);
        await catalog.unpinSession(sessionId);
        await catalog.renameSession(sessionId, `Stale Rename ${index}`);

        expect(() => getStructuredSessionStore(catalog).getSessionState(sessionId)).toThrow();
        expect(
          (await catalog.listSessions()).sessions.some((session) => session.id === sessionId),
        ).toBe(false);
      }

      const listedIds = new Set(
        (await catalog.listSessions()).sessions.map((session) => session.id),
      );
      for (const sessionId of deletedSessionIds) {
        expect(listedIds.has(sessionId)).toBe(false);
      }
    } finally {
      process.env.PATH = previousPath;
      await catalog.dispose();
    }
  });

  it("aborts an active prompt before hard-deleting the session", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Streaming Delete" }, DEFAULTS);
      const sessionId = created.target.workspaceSessionId;
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const sessionFile = managed.session.sessionManager.getSessionFile();
      const promptGate = createDeferred<void>();
      const sessionPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string): Promise<void>;
        abort(): Promise<void>;
      };
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(
        async function (this: PromptableSession) {
          const surface = findManagedSurfaceBySession(catalog, this);
          if (surface?.sessionId !== created.target.surfacePiSessionId) {
            appendMessagesToSession(this, [
              userMessage("Name the session."),
              assistantMessage("Streaming delete"),
            ]);
            return;
          }
          await promptGate.promise;
        },
      );
      const abortSpy = spyOn(sessionPrototype, "abort").mockImplementation(
        async function (this: PromptableSession) {
          const surface = findManagedSurfaceBySession(catalog, this);
          if (surface?.sessionId === created.target.surfacePiSessionId) {
            promptGate.resolve();
          }
        },
      );

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("Keep streaming.")],
          onEvent: () => {},
        });
        await waitFor(
          () => getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );

        await catalog.deleteSession(sessionId);

        expect(abortSpy).toHaveBeenCalled();
        expect(existsSync(sessionFile)).toBe(false);
        expect(getStructuredSessionStore(catalog).isSessionDeleted(sessionId)).toBe(true);
        expect(
          (await catalog.listSessions()).sessions.some((session) => session.id === sessionId),
        ).toBe(false);
      } finally {
        promptGate.resolve();
        promptSpy.mockRestore();
        abortSpy.mockRestore();
      }
    } finally {
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

  it("commits provider errors as visible assistant text when pi records empty content", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Error Surface" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string): Promise<void>;
      };
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        appendMessagesToSession(this, [
          userMessage(promptText),
          {
            ...assistantMessage("", {
              stopReason: "error",
              errorMessage: "Provider validation failed.",
            }),
            content: [],
          } as AssistantMessage,
        ]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("Trigger provider validation.")],
          onEvent: () => {},
        });

        const messages = managed.session.agent.state.messages;
        const latestAssistant = messages.findLast(
          (message): message is AssistantMessage => message.role === "assistant",
        );
        expect(latestAssistant?.stopReason).toBe("error");
        expect(latestAssistant?.errorMessage).toBe("Provider validation failed.");
        expect(latestAssistant?.content).toEqual([
          { type: "text", text: "Provider validation failed." },
        ]);
      } finally {
        promptSpy.mockRestore();
      }
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

  it("uses the live first composer draft as the provisional session title", async () => {
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

      expect((await catalog.listSessions()).sessions[0]?.title).toBe(
        "A text written in the composer should survive closing surfaces",
      );
      await catalog.closeSurface(created.target);
      const reopened = await catalog.openSurface(created.target);
      expect(reopened.composerDraft.text).toBe(
        "A text written in the composer should survive closing surfaces",
      );
      expect(reopened.composerDraft.attachments).toEqual([
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

      expect((await catalog.listSessions()).sessions[0]?.title).toBe("Durable Composer Drafts");
    } finally {
      await catalog.dispose();
    }
  });

  it("starts top-level title generation while the first orchestrator turn is still running", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
      const prompt = userMessage("Inspect duplicate prompt rendering");
      const reply = assistantMessage("Still working.");
      const orchestrator = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const orchestratorGate = Promise.withResolvers<void>();
      const promptSpy = spyOn(orchestrator.session, "prompt").mockImplementation(
        async function (this: PromptableSession) {
          await orchestratorGate.promise;
          appendMessagesToSession(this, [prompt, reply]);
        },
      );

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [prompt],
          onEvent: () => {},
        });

        await waitFor(() => orchestrator.activePrompt);
        await waitFor(
          () =>
            getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId).pi
              .titleGenerationStatus !== "not-started",
        );

        const titleState = getStructuredSessionStore(catalog).getSessionState(
          created.target.workspaceSessionId,
        ).pi;
        expect(
          ["pending", "running", "completed"].includes(
            titleState.titleGenerationStatus ?? "not-started",
          ),
        ).toBe(true);
      } finally {
        orchestratorGate.resolve();
        promptSpy.mockRestore();
      }

      await waitFor(() => !orchestrator.activePrompt);
    } finally {
      await catalog.dispose();
    }
  });

  it("marks title generation failed instead of using the first message when the namer returns a generic title", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        if (promptText.startsWith("First user message:")) {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("New Session")]);
          return;
        }

        appendMessagesToSession(this, [
          userMessage("investigate dockview streaming duplicates"),
          assistantMessage("Done."),
        ]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("investigate dockview streaming duplicates")],
          onEvent: () => {},
        });

        await waitFor(
          () =>
            getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId).pi
              .titleGenerationStatus === "failed",
        );

        const titleState = getStructuredSessionStore(catalog).getSessionState(
          created.target.workspaceSessionId,
        ).pi;
        expect(titleState.title).toBe("New Session");
        expect(titleState.titleGenerationError).toContain("generic title");
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("marks title generation failed instead of using the first message when the namer returns no title", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        if (promptText.startsWith("First user message:")) {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("")]);
          return;
        }

        appendMessagesToSession(this, [
          userMessage("fix broken session naming"),
          assistantMessage("Done."),
        ]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("fix broken session naming")],
          onEvent: () => {},
        });

        await waitFor(
          () =>
            getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId).pi
              .titleGenerationStatus === "failed",
        );

        const titleState = getStructuredSessionStore(catalog).getSessionState(
          created.target.workspaceSessionId,
        ).pi;
        expect(titleState.title).toBe("New Session");
        expect(titleState.titleGenerationError).toContain("generic title");
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("surfaces namer model errors instead of using the first message as a title", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      await Bun.sleep(0);
      const titleLogs = captureTitleGenerationLogs(catalog);
      const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        if (promptText.startsWith("First user message:")) {
          appendMessagesToSession(this, [
            userMessage(promptText),
            assistantMessage("", {
              stopReason: "error",
              errorMessage: "Provided authentication token is expired.",
            }),
          ]);
          return;
        }

        appendMessagesToSession(this, [
          userMessage("debug session naming auth failures"),
          assistantMessage("Done."),
        ]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("debug session naming auth failures")],
          onEvent: () => {},
        });

        await waitFor(
          () =>
            getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId).pi
              .titleGenerationStatus === "failed",
        );

        const titleState = getStructuredSessionStore(catalog).getSessionState(
          created.target.workspaceSessionId,
        ).pi;
        expect(titleState.title).toBe("New Session");
        expect(titleState.titleGenerationError).toBe("Provided authentication token is expired.");
        expect(titleLogs).toEqual([
          {
            level: "info",
            status: "queued",
            sessionId: created.target.workspaceSessionId,
          },
          {
            level: "info",
            status: "started",
            sessionId: created.target.workspaceSessionId,
          },
          {
            level: "warning",
            status: "failed",
            sessionId: created.target.workspaceSessionId,
            error: "Provided authentication token is expired.",
          },
        ]);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("uses the namer agent to title handler threads from the delegated objective", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
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
              agentProfileSettings: null;
              loadedByCommandId: string;
            }): Promise<{ id: string; title: string }>;
          }
        ).createHandlerThread({
          sessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          parentThreadId: orchestratorThread.id,
          parentSurfacePiSessionId: created.target.surfacePiSessionId,
          objective: "Configure workflow checks for this repository.",
          agentProfileSettings: null,
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

      expect(created.systemPrompt).toContain(
        "You are svvy, a pragmatic software engineering assistant",
      );
      expect(created.systemPrompt).toContain("Loaded native extension: Shell.");
      expect(created.systemPrompt).toContain("Loaded external_instruction records:");
      expect(created.systemPrompt).toContain(`# Project Standards\n\nUse repo rules.`);
      expect(created.systemPrompt).not.toContain(
        `# Claude Standards\n\nKeep visible instructions.`,
      );
      expect(created.resolvedSystemPrompt).toContain(
        "You are svvy, a pragmatic software engineering assistant",
      );
      expect(created.resolvedSystemPrompt).not.toContain("# Project Context");
      expect(created.resolvedSystemPrompt).toContain("# Project Standards");
      expect(created.resolvedSystemPrompt).not.toContain("# Claude Standards");
      expect(created.resolvedSystemPrompt).not.toContain("Hidden append text.");
      expect(created.resolvedSystemPrompt).not.toContain("Hidden root append text.");
      expect(created.resolvedSystemPrompt).not.toContain("Hidden replacement text.");
      expect(created.externalContextSources).toEqual([
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
      expect(created.resolvedSystemPrompt).toContain("Current date:");
      expect(created.resolvedSystemPrompt).toContain(`Current working directory: ${cwd}`);
      expect(orchestratorManaged.session.agent.state.systemPrompt).toBe(
        created.resolvedSystemPrompt,
      );

      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Prompt Channel Handler",
        objective: "Inspect handler prompt wiring.",
      });
      const openedHandler = await catalog.openSurface(handler.target);
      const handlerManaged = getManagedSurface(catalog, handler.target.surfacePiSessionId);

      expect(openedHandler.systemPrompt).toContain("This surface is a delegated handler thread.");
      expect(openedHandler.systemPrompt).toContain("Loaded native extension: Shell.");
      expect(openedHandler.systemPrompt).toContain("Loaded external_instruction records:");
      expect(openedHandler.systemPrompt).toContain(`# Project Standards\n\nUse repo rules.`);
      expect(openedHandler.systemPrompt).not.toContain(
        `# Claude Standards\n\nKeep visible instructions.`,
      );
      expect(openedHandler.systemPrompt).toContain(
        `## Handler Profile Override\n${DEFAULT_THREAD_HANDLER_PROMPT}`,
      );
      expect(openedHandler.resolvedSystemPrompt).toContain(
        "This surface is a delegated handler thread.",
      );
      expect(openedHandler.resolvedSystemPrompt).not.toContain("# Project Context");
      expect(openedHandler.resolvedSystemPrompt).toContain("# Project Standards");
      expect(openedHandler.resolvedSystemPrompt).not.toContain("# Claude Standards");
      expect(openedHandler.resolvedSystemPrompt).not.toContain("Hidden append text.");
      expect(openedHandler.resolvedSystemPrompt).not.toContain("Hidden root append text.");
      expect(openedHandler.resolvedSystemPrompt).not.toContain("Hidden replacement text.");
      expect(openedHandler.externalContextSources).toEqual(created.externalContextSources);
      expect(handlerManaged.session.agent.state.systemPrompt).toBe(
        openedHandler.resolvedSystemPrompt,
      );
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
            extensions: Record<string, "default_loaded" | "available" | "unavailable">;
            agentProfileSettings: null;
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
        extensions: {
          "extension-managing": "default_loaded",
          smithers: "available",
          workflows: "unavailable",
          "request-user-input": "unavailable",
          "thread-orchestration": "default_loaded",
          "thread-handling": "unavailable",
        },
        agentProfileSettings: null,
        loadedByCommandId: orchestratorThread.id,
        autoStart: false,
      });

      const storedThread = store.getThreadDetail(handlerThread.id).thread;
      expect(JSON.parse(storedThread.agentProfileJson ?? "{}")).toMatchObject({
        id: "thread-handler",
        name: "Thread handler",
      });
      expect(storedThread.loadedExtensionIds).toContain("extension-managing");
      expect(storedThread.loadedExtensionIds).not.toContain("smithers");
      expect(storedThread.loadedExtensionIds).not.toContain("workflows");
      expect(storedThread.loadedExtensionIds).not.toContain("thread-orchestration");
      expect(storedThread.loadedExtensionIds).not.toContain("thread-handling");
      expect(storedThread.availableExtensionIds).toEqual(["smithers"]);

      const openedHandler = await catalog.openSurface(
        createThreadTarget(
          created.target.workspaceSessionId,
          handlerThread.surfacePiSessionId,
          handlerThread.id,
        ),
      );
      expect(openedHandler.resolvedSystemPrompt).not.toContain(
        "Loaded prompt-only extension: Smithers CLI workflow authoring.",
      );
      expect(openedHandler.resolvedSystemPrompt).toContain(
        "- smithers: Use official Smithers CLI commands through Shell for workspace .smithers work.",
      );
      expect(openedHandler.resolvedSystemPrompt).not.toContain("svvyx workflows");
      expect(openedHandler.resolvedSystemPrompt).not.toContain(
        "Loaded native extension: Thread Orchestration.",
      );
      expect(openedHandler.resolvedSystemPrompt).not.toContain(
        "Loaded native extension: Request User Input.",
      );
      const handlerManaged = getManagedSurface(catalog, handlerThread.surfacePiSessionId);
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
    const source = readFileSync(new URL("./session-catalog.ts", import.meta.url), "utf8");

    expect(source).toContain("noExtensions: true");
    expect(source).toContain("noSkills: true");
    expect(source).toContain("noPromptTemplates: true");
    expect(source).toContain("noThemes: true");
    expect(source).toContain("additionalExtensionPaths: []");
    expect(source).toContain("additionalSkillPaths: []");
    expect(source).toContain("additionalPromptTemplatePaths: []");
    expect(source).toContain("additionalThemePaths: []");
    expect(source).toContain("extensionFactories: []");
    expect(source).toContain("systemPromptOverride: () => options.systemPrompt");
    expect(source).toContain("agentsFilesOverride: () => ({ agentsFiles: [] })");
    expect(source).toContain("appendSystemPromptOverride: () => []");
    expect(source).toContain(
      "extensionsOverride: (base) => ({ ...base, extensions: [], errors: [] })",
    );
    expect(source).toContain("skillsOverride: () => ({ skills: [], diagnostics: [] })");
    expect(source).toContain("promptsOverride: () => ({ prompts: [], diagnostics: [] })");
    expect(source).toContain("themesOverride: () => ({ themes: [], diagnostics: [] })");
    expect(source).toContain('noTools: "builtin"');
    expect(source).toContain("customTools,");
    expect(source).not.toContain("extendResources(");
    expect(source).toContain("expandPromptTemplates: false");
  });

  it("marks prompt binding stale when runtime standards change", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Standards Drift" }, DEFAULTS);
      expect(created.promptBinding?.stale).toBe(false);

      writeFileSync(standardsPath, "# Project Standards\n\nChanged.");
      const reopened = await catalog.openSurface(created.target);

      expect(reopened.promptBinding?.stale).toBe(true);
      expect(reopened.promptBinding?.boundExternalSourceHashes).not.toEqual(
        reopened.promptBinding?.currentExternalSourceHashes,
      );
      expect(reopened.externalContextSources[0]?.content).toContain("Initial.");
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
      expect(created.promptBinding?.boundFingerprint).toBe(storedFingerprint);
      expect(created.promptBinding?.currentFingerprint).toBe(storedFingerprint);
      expect(created.promptBinding?.stale).toBe(false);

      writeFileSync(standardsPath, "# Project Standards\n\nChanged.");
      const reopened = await catalog.openSurface(created.target);
      expect(reopened.promptBinding?.boundFingerprint).toBe(storedFingerprint);
      expect(reopened.promptBinding?.currentFingerprint).not.toBe(storedFingerprint);
      expect(reopened.promptBinding?.stale).toBe(true);
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
      const storedFingerprint = created.promptBinding?.boundFingerprint;
      expect(storedFingerprint).toBeTruthy();
      if (!storedFingerprint) {
        throw new Error("Expected generated context fingerprint to be stored.");
      }

      await closeSurface(catalog, created.target);
      writeFileSync(standardsPath, "# Project Standards\n\nChanged after close.");

      const reopened = await catalog.openSurface(created.target);
      expect(reopened.promptBinding?.boundFingerprint).toBe(storedFingerprint);
      expect(reopened.promptBinding?.currentFingerprint).not.toBe(storedFingerprint);
      expect(reopened.promptBinding?.stale).toBe(true);
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
      storedFingerprint = created.promptBinding?.boundFingerprint ?? "";
      expect(created.promptBinding?.boundSystemPrompt).toContain("Initial restart payload.");
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
      expect(reopened.promptBinding?.boundFingerprint).toBe(storedFingerprint!);
      expect(reopened.promptBinding?.boundSystemPrompt).toContain("Initial restart payload.");
      expect(reopened.promptBinding?.boundSystemPrompt).not.toContain(
        "Changed after catalog restart.",
      );
      expect(reopened.promptBinding?.currentSystemPrompt).toContain(
        "Changed after catalog restart.",
      );
      expect(reopened.promptBinding?.stale).toBe(true);
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
      expect(openedHandler.promptBinding?.boundFingerprint).toBe(storedFingerprint);
      expect(openedHandler.promptBinding?.currentFingerprint).toBe(storedFingerprint);
      expect(openedHandler.promptBinding?.stale).toBe(false);
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
      const openedHandler = await catalog.openSurface(handler.target);
      const storedFingerprint = openedHandler.promptBinding?.boundFingerprint;
      expect(storedFingerprint).toBeTruthy();
      if (!storedFingerprint) {
        throw new Error("Expected handler generated context fingerprint to be stored.");
      }

      await closeSurface(catalog, handler.target);
      writeFileSync(standardsPath, "# Project Standards\n\nChanged after handler close.");

      const reopened = await catalog.openSurface(handler.target);
      expect(reopened.promptBinding?.boundFingerprint).toBe(storedFingerprint);
      expect(reopened.promptBinding?.currentFingerprint).not.toBe(storedFingerprint);
      expect(reopened.promptBinding?.stale).toBe(true);
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
      const openedHandler = await firstCatalog.openSurface(handler.target);
      handlerTarget = handler.target;
      storedFingerprint = openedHandler.promptBinding?.boundFingerprint ?? "";
      expect(openedHandler.promptBinding?.boundSystemPrompt).toContain(
        "Initial handler restart payload.",
      );
      expect(storedFingerprint).toBeTruthy();
    } finally {
      await firstCatalog.dispose();
    }

    writeFileSync(standardsPath, "# Project Standards\n\nChanged handler restart payload.");
    const secondCatalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const reopened = await secondCatalog.openSurface(handlerTarget!);
      expect(reopened.promptBinding?.boundFingerprint).toBe(storedFingerprint!);
      expect(reopened.promptBinding?.boundSystemPrompt).toContain(
        "Initial handler restart payload.",
      );
      expect(reopened.promptBinding?.boundSystemPrompt).not.toContain(
        "Changed handler restart payload.",
      );
      expect(reopened.promptBinding?.currentSystemPrompt).toContain(
        "Changed handler restart payload.",
      );
      expect(reopened.promptBinding?.stale).toBe(true);
    } finally {
      await secondCatalog.dispose();
    }
  });

  it("updates a handler thread's stored generated context fingerprint after refresh", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Refresh Binding" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "handler-refresh-binding",
        objective: "Inspect handler refresh generated context binding.",
      });
      const openedHandler = await catalog.openSurface(handler.target);
      const originalFingerprint = openedHandler.promptBinding?.boundFingerprint;
      expect(originalFingerprint).toBeTruthy();

      writeFileSync(standardsPath, "# Project Standards\n\nChanged before refresh.");
      const stale = await catalog.openSurface(handler.target);
      expect(stale.promptBinding?.stale).toBe(true);

      await catalog.queuePromptRefresh({ target: handler.target });
      const storedThread = getStructuredSessionStore(catalog)
        .getSessionState(created.target.workspaceSessionId)
        .threads.find((thread) => thread.id === handler.threadId);
      const refreshed = await catalog.openSurface(handler.target);

      expect(storedThread?.generatedAgentContextFingerprint).toBe(
        refreshed.promptBinding?.currentFingerprint,
      );
      expect(storedThread?.generatedAgentContextFingerprint).not.toBe(originalFingerprint);
      expect(refreshed.promptBinding?.boundFingerprint).toBe(
        refreshed.promptBinding?.currentFingerprint,
      );
      expect(refreshed.promptBinding?.stale).toBe(false);
      expect(
        getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId)
          .events,
      ).toContainEqual(
        expect.objectContaining({
          kind: "Agent context updated",
          subject: {
            kind: "thread",
            id: handler.threadId,
          },
          data: expect.objectContaining({
            surface: "thread",
            surfacePiSessionId: handler.surfacePiSessionId,
            previousFingerprint: originalFingerprint,
            currentFingerprint: refreshed.promptBinding?.currentFingerprint,
            systemPromptChanged: true,
            externalSourceHashes: expect.objectContaining({
              added: expect.any(Array),
              removed: expect.any(Array),
            }),
          }),
        }),
      );
    } finally {
      await catalog.dispose();
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
          agentProfileSettings: {
            id: DEFAULT_ORCHESTRATOR_PROFILE_ID,
            kind: "orchestrator",
            name: "Default orchestrator",
            provider: DEFAULTS.provider,
            model: DEFAULTS.model,
            reasoningEffort: DEFAULTS.thinkingLevel,
            systemPrompt: DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
            extensionUsage: {},
            updateFromComposer: false,
            builtin: true,
            locked: true,
          },
        },
      );

      expect(created.promptBinding?.stale).toBe(false);
      expect(created.systemPrompt).not.toContain("## Orchestrator Profile");
      expect(created.systemPrompt).toBe(buildSystemPrompt("orchestrator"));
    } finally {
      await catalog.dispose();
    }
  });

  it("marks prompt binding stale when the orchestrator profile removes an extension", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const smithersLoadedMarker = "Loaded always-on prompt context: Smithers workflow routing.";
    const profile: AgentProfileSettings = {
      id: "extension-drift-orchestrator",
      kind: "orchestrator",
      name: "Extension drift orchestrator",
      provider: DEFAULTS.provider,
      model: DEFAULTS.model,
      reasoningEffort: DEFAULTS.thinkingLevel,
      systemPrompt: DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
      extensionUsage: { smithers: "default_loaded" },
      updateFromComposer: false,
      builtin: false,
      locked: false,
    };

    try {
      setCatalogAgentProfile(catalog, profile);
      const created = await catalog.createSession(
        {
          title: "Profile Extension Drift",
          agentProfileId: profile.id,
        },
        DEFAULTS,
      );

      expect(created.promptBinding?.stale).toBe(false);
      expect(created.systemPrompt).toContain(smithersLoadedMarker);

      setCatalogAgentProfile(catalog, {
        ...profile,
        extensionUsage: {},
      });
      const reopened = await catalog.openSurface(created.target);

      expect(reopened.promptBinding?.stale).toBe(true);
      expect(reopened.promptBinding?.boundSystemPrompt).toContain(smithersLoadedMarker);
      expect(reopened.promptBinding?.currentSystemPrompt).not.toContain(smithersLoadedMarker);

      await catalog.queuePromptRefresh({ target: created.target });
      const refreshed = await catalog.openSurface(created.target);
      expect(refreshed.promptBinding?.stale).toBe(false);
      expect(refreshed.resolvedSystemPrompt).not.toContain(smithersLoadedMarker);
      expect(refreshed.queuedMessages).toEqual([]);
      expect(refreshed.agentContextUpdate).toMatchObject({
        state: "applied",
        requestedRevision: expect.any(Number),
        currentRevision: expect.any(Number),
        systemPromptChanged: true,
      });
      expect((await catalog.listSessions()).sessions[0]?.productEvents).toContainEqual(
        expect.objectContaining({
          title: "Agent context update applied",
          summary: expect.stringContaining("Agent context update applied"),
          details: expect.objectContaining({
            state: "applied",
            surfacePiSessionId: created.target.surfacePiSessionId,
          }),
        }),
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("projects cancelled context refreshes without keeping stale active queue rows", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Cancel Context Refresh" }, DEFAULTS);
      await catalog.openSurface(created.target);
      const queued = getStructuredSessionStore(catalog).enqueueSurfaceMessage({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        kind: "agent_context_refresh",
        idempotencyKey: "agent_context_refresh:test-cancelled-terminal",
        messageJson: "{}",
        payloadJson: JSON.stringify({
          requestedRevision: 7,
          requestedAt: "2026-06-10T12:00:00.000Z",
          reason: "test cancellation",
        }),
        requestSummary: "Update agent context",
        position: "front",
      });

      const cancelled = await catalog.deleteQueuedSurfaceMessage({
        target: created.target,
        queuedMessageId: queued.id,
      });

      expect(cancelled.snapshot?.queuedMessages).toEqual([]);
      expect(cancelled.snapshot?.agentContextUpdate).toMatchObject({
        state: "cancelled",
        queueMessageId: queued.id,
        requestedRevision: 7,
        reason: "test cancellation",
      });
      expect(
        getStructuredSessionStore(catalog)
          .listQueuedSurfaceMessages({ surfacePiSessionId: created.target.surfacePiSessionId })
          .map((message) => message.id),
      ).toEqual([]);
      expect((await catalog.listSessions()).sessions[0]?.productEvents).toContainEqual(
        expect.objectContaining({
          title: "Agent context update cancelled",
          summary: expect.stringContaining("Agent context update cancelled"),
          details: expect.objectContaining({
            state: "cancelled",
            queueMessageId: queued.id,
            surfacePiSessionId: created.target.surfacePiSessionId,
          }),
        }),
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("records cancelled context refreshes when edit-and-resend clears queued rows", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Edit Cancels Refresh" }, DEFAULTS);
      const original = {
        ...userMessage("Original request"),
        timestamp: 101,
      };
      appendMessagesToSession(
        getManagedSurface(catalog, created.target.surfacePiSessionId).session,
        [original, assistantMessage("Original answer.")],
      );
      const queued = getStructuredSessionStore(catalog).enqueueSurfaceMessage({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        kind: "agent_context_refresh",
        idempotencyKey: "agent_context_refresh:test-edit-cancelled-terminal",
        messageJson: "{}",
        payloadJson: JSON.stringify({
          requestedRevision: 8,
          requestedAt: "2026-06-10T12:30:00.000Z",
          reason: "edit resend",
        }),
        requestSummary: "Update agent context",
        position: "front",
      });
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string): Promise<void>;
      };
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        appendMessagesToSession(this, [
          userMessage(promptText),
          assistantMessage("Edited answer."),
        ]);
      });

      try {
        await catalog.editCommittedUserMessage({
          target: created.target,
          messageTimestamp: original.timestamp,
          message: userMessage("Edited request"),
          onEvent: () => {},
        });

        await waitFor(
          () => !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );
      } finally {
        promptSpy.mockRestore();
      }

      const reopened = await catalog.openSurface(created.target);
      expect(reopened.queuedMessages).toEqual([]);
      expect(reopened.agentContextUpdate).toMatchObject({
        state: "cancelled",
        queueMessageId: queued.id,
        requestedRevision: 8,
        reason: "edit resend",
      });
      expect((await catalog.listSessions()).sessions[0]?.productEvents).toContainEqual(
        expect.objectContaining({
          title: "Agent context update cancelled",
          details: expect.objectContaining({
            state: "cancelled",
            queueMessageId: queued.id,
            surfacePiSessionId: created.target.surfacePiSessionId,
          }),
        }),
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("projects dispatching context refreshes as updating without exposing prompt-bearing dispatch rows", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Updating Context Refresh" }, DEFAULTS);
      await catalog.openSurface(created.target);
      const store = getStructuredSessionStore(catalog);
      const refresh = store.enqueueSurfaceMessage({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        kind: "agent_context_refresh",
        idempotencyKey: "agent_context_refresh:test-updating",
        messageJson: "{}",
        payloadJson: JSON.stringify({
          requestedRevision: 9,
          requestedAt: "2026-06-10T13:00:00.000Z",
        }),
        requestSummary: "Update agent context",
        position: "front",
      });
      store.enqueueSurfaceMessage({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        kind: "user_message",
        idempotencyKey: "user_message:test-dispatch-hidden",
        messageJson: JSON.stringify(userMessage("Hidden dispatching prompt.")),
        requestSummary: "Hidden dispatching prompt.",
        position: "back",
      });
      expect(
        store.claimNextQueuedSurfaceMessage({
          surfacePiSessionId: created.target.surfacePiSessionId,
        })?.id,
      ).toBe(refresh.id);
      const userDispatch = store.claimNextQueuedSurfaceMessage({
        surfacePiSessionId: created.target.surfacePiSessionId,
      });
      expect(userDispatch?.kind).toBe("user_message");

      const snapshot = await catalog.openSurface(created.target);

      expect(snapshot.queuedMessages.map((message) => [message.id, message.status])).toEqual([
        [refresh.id, "dispatching"],
      ]);
      expect(snapshot.queuedMessages[0]?.agentContextUpdate).toMatchObject({
        state: "updating",
        requestedRevision: 9,
      });
    } finally {
      await catalog.dispose();
    }
  });

  it("keeps failed context refreshes visible with grouped context details", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const profile: AgentProfileSettings = {
      id: "failed-refresh-extension-drift",
      kind: "orchestrator",
      name: "Failed refresh extension drift",
      provider: DEFAULTS.provider,
      model: DEFAULTS.model,
      reasoningEffort: DEFAULTS.thinkingLevel,
      systemPrompt: DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
      extensionUsage: { smithers: "default_loaded" },
      updateFromComposer: false,
      builtin: false,
      locked: false,
    };

    try {
      setCatalogAgentProfile(catalog, profile);
      const created = await catalog.createSession(
        {
          title: "Failed Context Refresh",
          agentProfileId: profile.id,
        },
        DEFAULTS,
      );
      await catalog.openSurface(created.target);
      setCatalogAgentProfile(catalog, {
        ...profile,
        extensionUsage: {},
      });
      const refreshSpy = spyOn(
        catalog as unknown as {
          refreshManagedSurfacePromptBinding(...args: unknown[]): Promise<unknown>;
        },
        "refreshManagedSurfacePromptBinding",
      ).mockRejectedValue(new Error("Generated context refresh failed."));

      try {
        await expect(catalog.queuePromptRefresh({ target: created.target })).rejects.toThrow(
          "Generated context refresh failed.",
        );
      } finally {
        refreshSpy.mockRestore();
      }

      const snapshot = await catalog.openSurface(created.target);
      expect(snapshot.queuedMessages).toHaveLength(1);
      expect(snapshot.queuedMessages[0]).toMatchObject({
        kind: "agent_context_refresh",
        status: "failed",
        failureError: "Generated context refresh failed.",
        agentContextUpdate: {
          state: "failed",
          loadedExtensionIds: {
            added: [],
            removed: ["smithers"],
          },
          availableExtensionIds: {
            added: ["smithers"],
            removed: [],
          },
        },
      });

      await catalog.queuePromptRefresh({ target: created.target });
      await waitFor(
        async () => (await catalog.openSurface(created.target)).promptBinding?.stale === false,
      );
      const retried = await catalog.openSurface(created.target);
      expect(retried.queuedMessages).toEqual([]);
      expect(retried.promptBinding?.stale).toBe(false);
    } finally {
      await catalog.dispose();
    }
  });

  it("preserves top-level actor-local loaded extensions across context refresh", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const smithersLoadedMarker = "Loaded always-on prompt context: Smithers workflow routing.";

    try {
      const created = await catalog.createSession(
        { title: "Actor Local Extension Load" },
        DEFAULTS,
      );
      expect(created.systemPrompt).not.toContain(smithersLoadedMarker);

      getStructuredSessionStore(catalog).updatePiSessionExtensionState({
        sessionId: created.target.workspaceSessionId,
        loadedExtensionIds: [
          ...(getManagedSurface(catalog, created.target.surfacePiSessionId).loadedExtensionIds ??
            []),
          "smithers",
        ],
        availableExtensionIds: getManagedSurface(
          catalog,
          created.target.surfacePiSessionId,
        ).availableExtensionIds.filter((id) => id !== "smithers"),
      });
      await closeSurface(catalog, created.target);

      const stale = await catalog.openSurface(created.target);
      expect(stale.promptBinding?.stale).toBe(true);
      expect(stale.promptBinding?.currentSystemPrompt).toContain(smithersLoadedMarker);

      await catalog.queuePromptRefresh({ target: created.target });
      const refreshed = await catalog.openSurface(created.target);

      expect(refreshed.promptBinding?.stale).toBe(false);
      expect(refreshed.resolvedSystemPrompt).toContain(smithersLoadedMarker);
      expect(
        getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId).pi
          .loadedExtensionIds,
      ).toContain("smithers");
    } finally {
      await catalog.dispose();
    }
  });

  it("applies load_extension context changes to the durable generated binding", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const smithersLoadedMarker = "Loaded always-on prompt context: Smithers workflow routing.";

    try {
      const created = await catalog.createSession({ title: "Load Extension Binding" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      expect(managed.systemPrompt).not.toContain(smithersLoadedMarker);
      expect(managed.availableExtensionIds).toContain("smithers");
      const beforeFingerprint = managed.generatedAgentContextFingerprint;
      const turn = getStructuredSessionStore(catalog).startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Load Smithers",
      });
      const loadedExtensionIds = [...managed.loadedExtensionIds, "smithers"].toSorted();
      const availableExtensionIds = managed.availableExtensionIds
        .filter((id) => id !== "smithers")
        .toSorted();
      const runtime = {
        sessionId: created.target.workspaceSessionId,
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        surfaceThreadId: null,
        surfaceKind: "orchestrator" as const,
        defaultEpisodeKind: "analysis" as const,
        rootThreadId: null,
        promptText: "Load Smithers",
        rootEpisodeKind: "analysis" as const,
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds,
        availableExtensionIds,
        externalInstructionSources: [],
        systemPrompt: undefined as string | undefined,
        generatedAgentContextFingerprint: undefined as string | undefined,
      };

      const refreshed = await (
        catalog as unknown as {
          applyLoadedExtensionContext(input: {
            extensionId: string;
            refreshedContext: {
              actor: "orchestrator";
              loadedExtensionIds: string[];
              availableExtensionIds: string[];
              systemPrompt: string;
              executeTypescriptDeclaration: string;
            };
            runtime: typeof runtime;
          }): Promise<{
            actor: "orchestrator";
            loadedExtensionIds: string[];
            availableExtensionIds: string[];
            systemPrompt: string;
            executeTypescriptDeclaration: string;
          }>;
        }
      ).applyLoadedExtensionContext({
        extensionId: "smithers",
        refreshedContext: {
          actor: "orchestrator",
          loadedExtensionIds,
          availableExtensionIds,
          systemPrompt: "",
          executeTypescriptDeclaration: "",
        },
        runtime,
      });

      expect(refreshed.loadedExtensionIds).toContain("smithers");
      expect(refreshed.availableExtensionIds).not.toContain("smithers");
      expect(refreshed.systemPrompt).toContain(smithersLoadedMarker);
      expect(runtime.systemPrompt).toBe(refreshed.systemPrompt);
      expect(runtime.generatedAgentContextFingerprint).toBeTruthy();
      expect(managed.systemPrompt).toContain(smithersLoadedMarker);
      expect(managed.generatedAgentContextFingerprint).not.toBe(beforeFingerprint);
      expect(managed.recreateOnNextPrompt).toBe(true);
      const snapshot = getStructuredSessionStore(catalog).getSessionState(
        created.target.workspaceSessionId,
      );
      expect(snapshot.pi.loadedExtensionIds).toContain("smithers");
      expect(snapshot.pi.availableExtensionIds).not.toContain("smithers");
      expect(snapshot.pi.generatedAgentContextFingerprint).toBe(
        managed.generatedAgentContextFingerprint,
      );
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({
          kind: "Agent context updated",
          subject: {
            kind: "session",
            id: created.target.workspaceSessionId,
          },
          data: expect.objectContaining({
            surface: "orchestrator",
            surfacePiSessionId: created.target.surfacePiSessionId,
            previousFingerprint: beforeFingerprint,
            currentFingerprint: managed.generatedAgentContextFingerprint,
            loadedExtensionIds: {
              added: ["smithers"],
              removed: [],
            },
          }),
        }),
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("applies handler load_extension context changes to thread bindings", async () => {
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
      expect(managed.availableExtensionIds).toContain("extension-managing");
      const beforeFingerprint = managed.generatedAgentContextFingerprint;
      const turn = getStructuredSessionStore(catalog).startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: handler.surfacePiSessionId,
        threadId: handler.threadId,
        requestSummary: "Load Extension Managing",
      });
      const loadedExtensionIds = [...managed.loadedExtensionIds, "extension-managing"].toSorted();
      const availableExtensionIds = managed.availableExtensionIds
        .filter((id) => id !== "extension-managing")
        .toSorted();
      const runtime = {
        sessionId: created.target.workspaceSessionId,
        turnId: turn.id,
        surfacePiSessionId: handler.surfacePiSessionId,
        surfaceThreadId: handler.threadId,
        surfaceKind: "handler" as const,
        defaultEpisodeKind: "analysis" as const,
        rootThreadId: handler.threadId,
        promptText: "Load Extension Managing",
        rootEpisodeKind: "analysis" as const,
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds,
        availableExtensionIds,
        externalInstructionSources: [],
        systemPrompt: undefined as string | undefined,
        generatedAgentContextFingerprint: undefined as string | undefined,
      };

      await (
        catalog as unknown as {
          applyLoadedExtensionContext(input: {
            extensionId: string;
            refreshedContext: {
              actor: "handler";
              loadedExtensionIds: string[];
              availableExtensionIds: string[];
              systemPrompt: string;
              executeTypescriptDeclaration: string;
            };
            runtime: typeof runtime;
          }): Promise<{
            actor: "handler";
            loadedExtensionIds: string[];
            availableExtensionIds: string[];
            systemPrompt: string;
            executeTypescriptDeclaration: string;
          }>;
        }
      ).applyLoadedExtensionContext({
        extensionId: "extension-managing",
        refreshedContext: {
          actor: "handler",
          loadedExtensionIds,
          availableExtensionIds,
          systemPrompt: "",
          executeTypescriptDeclaration: "",
        },
        runtime,
      });

      const snapshot = getStructuredSessionStore(catalog).getSessionState(
        created.target.workspaceSessionId,
      );
      const thread = snapshot.threads.find((entry) => entry.id === handler.threadId);
      expect(thread?.loadedExtensionIds).toContain("extension-managing");
      expect(thread?.availableExtensionIds).not.toContain("extension-managing");
      expect(thread?.generatedAgentContextFingerprint).toBe(
        managed.generatedAgentContextFingerprint,
      );
      expect(managed.generatedAgentContextFingerprint).not.toBe(beforeFingerprint);
      expect(managed.recreateOnNextPrompt).toBe(true);
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({
          kind: "Agent context updated",
          subject: {
            kind: "thread",
            id: handler.threadId,
          },
          data: expect.objectContaining({
            surface: "thread",
            surfacePiSessionId: handler.surfacePiSessionId,
            loadedExtensionIds: {
              added: ["extension-managing"],
              removed: [],
            },
          }),
        }),
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("composes new-session prompts from raw orchestrator profile settings once", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const suffix = "Custom raw orchestrator profile suffix.";

    try {
      const created = await catalog.createSession(
        { title: "Raw Settings Prompt" },
        {
          ...DEFAULTS,
          agentProfileId: "custom-orchestrator",
          agentProfileSettings: {
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
          },
        },
      );

      expect(created.systemPrompt.startsWith(buildSystemPrompt("orchestrator"))).toBe(true);
      expect(countOccurrences(created.systemPrompt, "## Orchestrator Profile")).toBe(1);
      expect(countOccurrences(created.systemPrompt, suffix)).toBe(1);
      expect(created.systemPrompt).not.toContain(
        `${buildSystemPrompt("orchestrator")}\n\n## Orchestrator Profile\n${buildSystemPrompt("orchestrator")}`,
      );
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

  it("applies stale idle context before the next prompt-bearing user message", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Keep Stale Prompt" }, DEFAULTS);
      const oldPrompt = getManagedSurface(catalog, created.target.surfacePiSessionId).systemPrompt;
      const freshMarker = "Fresh prompt marker for explicit refresh.";
      appendGeneratedAgentContextMarker(catalog, freshMarker);

      const reopened = await catalog.openSurface(created.target);
      expect(reopened.promptBinding?.stale).toBe(true);

      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string): Promise<void>;
      };
      const systemPromptsSeen: string[] = [];
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        if (promptText !== "Use the existing prompt.") {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("")]);
          return;
        }
        systemPromptsSeen.push(this.agent.state.systemPrompt ?? "");
        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("Use the existing prompt.")],
          onEvent: () => {},
        });

        await waitFor(() => systemPromptsSeen.length === 1);
        await waitFor(
          () => !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );
        expect(systemPromptsSeen.at(-1)).toContain(freshMarker);
        expect(systemPromptsSeen.at(-1)).not.toBe(oldPrompt);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("emits a stale prompt binding update when generated agent context changes", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Context Sync" }, DEFAULTS);
      expect(created.promptBinding?.stale).toBe(false);

      appendGeneratedAgentContextMarker(catalog, "Fresh prompt marker for live sync.");

      await waitFor(() =>
        surfaceSyncs.some(
          (payload) =>
            payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
            payload.snapshot?.promptBinding?.stale === true,
        ),
      );

      const update = surfaceSyncs.findLast(
        (payload) => payload.target.surfacePiSessionId === created.target.surfacePiSessionId,
      );
      expect(update?.snapshot?.promptBinding?.stale).toBe(true);
      expect(update?.snapshot?.promptBinding?.currentRevision).toBe(
        catalog.getGeneratedAgentContextState().revision,
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("emits a stale prompt binding update when Request User Input mode changes", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Request Input Mode" }, DEFAULTS);
      expect(created.promptBinding?.stale).toBe(false);
      expect(created.promptBinding?.boundSystemPrompt).toContain(
        "where you can choose a conservative default now",
      );

      catalog.updateRequestUserInputSettings({
        mode: "blocking",
        blockingTimeout: {
          enabled: true,
          durationMs: 300_000,
        },
      });

      await waitFor(() =>
        surfaceSyncs.some(
          (payload) =>
            payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
            payload.snapshot?.promptBinding?.stale === true &&
            payload.snapshot.promptBinding.currentSystemPrompt.includes(
              "only when the answer is required before proceeding",
            ),
        ),
      );

      const update = surfaceSyncs.findLast(
        (payload) => payload.target.surfacePiSessionId === created.target.surfacePiSessionId,
      );
      expect(update?.snapshot?.promptBinding?.stale).toBe(true);
      expect(update?.snapshot?.promptBinding?.boundSystemPrompt).toContain(
        "where you can choose a conservative default now",
      );
      expect(update?.snapshot?.promptBinding?.currentSystemPrompt).toContain(
        "only when the answer is required before proceeding",
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("emits a stale prompt binding update when external instruction controls change", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const agentsPath = join(cwd, "AGENTS.md");
    writeFileSync(agentsPath, "# Project Standards\n\nUse repo rules.");
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "External Sync" }, DEFAULTS);
      expect(created.promptBinding?.stale).toBe(false);
      expect(created.promptBinding?.boundSystemPrompt).toContain("# Project Standards");

      const currentPreferences = createAgentSettingsStore({
        cwd,
        agentDir,
        workflowsSourceRoot: join(agentDir, "..", "workflows"),
      }).getState().appPreferences;
      catalog.updateAppPreferences({
        ...currentPreferences,
        externalInstructions: {
          ...currentPreferences.externalInstructions,
          workspaceControls: {
            ...currentPreferences.externalInstructions.workspaceControls,
            [cwd]: {
              ...currentPreferences.externalInstructions.workspaceControls[cwd],
              [agentsPath]: {
                enabled: false,
                actors: ["orchestrator", "handler", "workflow-task"],
              },
            },
          },
        },
      });

      await waitFor(() =>
        surfaceSyncs.some(
          (payload) =>
            payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
            payload.snapshot?.promptBinding?.stale === true &&
            !payload.snapshot.promptBinding.currentSystemPrompt.includes("# Project Standards"),
        ),
      );

      const staleUpdate = surfaceSyncs.find(
        (payload) =>
          payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
          payload.snapshot?.promptBinding?.stale === true &&
          !payload.snapshot.promptBinding.currentSystemPrompt.includes("# Project Standards"),
      );
      expect(staleUpdate?.snapshot?.promptBinding?.stale).toBe(true);
      expect(staleUpdate?.snapshot?.promptBinding?.boundSystemPrompt).toContain(
        "# Project Standards",
      );
      expect(staleUpdate?.snapshot?.promptBinding?.currentSystemPrompt).not.toContain(
        "# Project Standards",
      );

      await waitFor(
        () =>
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.some(
              (message) =>
                message.kind === "agent_context_refresh" && message.status === "delivered",
            ) === true,
      );

      const refreshed = await catalog.openSurface(created.target);
      expect(refreshed.promptBinding?.stale).toBe(false);
      expect(refreshed.promptBinding?.boundSystemPrompt).not.toContain("# Project Standards");
      expect(refreshed.promptBinding?.currentSystemPrompt).not.toContain("# Project Standards");
    } finally {
      await catalog.dispose();
    }
  });

  it("clears the live stale prompt binding when context returns to the bound prompt", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Context Revert" }, DEFAULTS);
      const originalPromptState = catalog.getGeneratedAgentContextState();
      appendGeneratedAgentContextMarker(catalog, "Temporary prompt marker for live revert.");

      await waitFor(() =>
        surfaceSyncs.some(
          (payload) =>
            payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
            payload.snapshot?.promptBinding?.stale === true,
        ),
      );

      catalog.updateGeneratedAgentContextState(originalPromptState);

      await waitFor(() => {
        const latest = surfaceSyncs.findLast(
          (payload) => payload.target.surfacePiSessionId === created.target.surfacePiSessionId,
        );
        return latest?.snapshot?.promptBinding?.stale === false;
      });

      const update = surfaceSyncs.findLast(
        (payload) => payload.target.surfacePiSessionId === created.target.surfacePiSessionId,
      );
      expect(update?.snapshot?.promptBinding?.stale).toBe(false);
      expect(update?.snapshot?.promptBinding?.currentRevision).toBe(
        catalog.getGeneratedAgentContextState().revision,
      );
      expect(update?.snapshot?.promptBinding?.boundSystemPrompt).toBe(
        update?.snapshot?.promptBinding?.currentSystemPrompt,
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("applies an idle prompt refresh through the durable surface queue", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Idle Prompt Refresh" }, DEFAULTS);
      const freshMarker = "Fresh prompt marker for idle refresh.";
      appendGeneratedAgentContextMarker(catalog, freshMarker);
      const stale = await catalog.openSurface(created.target);
      expect(stale.promptBinding?.stale).toBe(true);

      const refreshed = await catalog.queuePromptRefresh({ target: created.target });

      expect(refreshed.snapshot?.queuedMessages).toEqual([]);
      expect(
        surfaceSyncs.some(
          (payload) =>
            payload.reason === "surface.updated" &&
            payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
            payload.snapshot?.queuedMessages.some(
              (message) => message.kind === "agent_context_refresh",
            ),
        ),
      ).toBe(false);
      await waitFor(
        () =>
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.every((message) => message.status === "delivered") === true,
      );
      const applied = await catalog.openSurface(created.target);
      expect(applied.promptBinding?.stale).toBe(false);
      expect(applied.resolvedSystemPrompt).toContain(freshMarker);
      expect(
        getStructuredSessionStore(catalog)
          .getSessionState(created.target.workspaceSessionId)
          .queuedMessages?.map((message) => message.status),
      ).toEqual(["delivered"]);
    } finally {
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });

  it("queues a prompt refresh and applies it before the next queued user message", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Queued Prompt Refresh" }, DEFAULTS);
      const freshMarker = "Fresh prompt marker for queued refresh.";

      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string): Promise<void>;
      };
      const firstPromptGate = createDeferred<void>();
      const systemPromptsSeen: string[] = [];
      let orchestratorPromptCount = 0;
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        if (promptText !== "Keep working." && promptText !== "Run after refresh.") {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("")]);
          return;
        }
        orchestratorPromptCount += 1;
        systemPromptsSeen.push(this.agent.state.systemPrompt ?? "");
        if (orchestratorPromptCount === 1) {
          await firstPromptGate.promise;
        }
        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("Keep working.")],
          onEvent: () => {},
        });
        await waitFor(
          () =>
            orchestratorPromptCount === 1 &&
            getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );

        appendGeneratedAgentContextMarker(catalog, freshMarker);
        const refresh = await catalog.queuePromptRefresh({ target: created.target });
        expect(refresh.snapshot?.queuedMessages.map((message) => message.kind)).toEqual([
          "agent_context_refresh",
        ]);
        const queuedRefresh = refresh.snapshot?.queuedMessages[0];
        expect(queuedRefresh?.summary).toContain("system prompt");
        expect(queuedRefresh?.agentContextUpdate).toMatchObject({
          state: "queued",
          requestedRevision: catalog.getGeneratedAgentContextState().revision,
          currentRevision: catalog.getGeneratedAgentContextState().revision,
          systemPromptChanged: true,
        });

        const newerMarker = "Superseding prompt marker for queued refresh.";
        appendGeneratedAgentContextMarker(catalog, newerMarker);
        const superseded = await catalog.openSurface(created.target);
        const supersededRefresh = superseded.queuedMessages.find(
          (message) => message.kind === "agent_context_refresh",
        );
        expect(supersededRefresh?.agentContextUpdate?.state).toBe("out_of_date");
        expect(supersededRefresh?.agentContextUpdate?.currentRevision).toBe(
          catalog.getGeneratedAgentContextState().revision,
        );
        expect(supersededRefresh?.summary).toContain("Out-of-date context update");

        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("Run after refresh.")],
          onEvent: () => {},
        });
        expect(
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.map((message) => message.kind),
        ).toEqual(["agent_context_refresh", "user_message", "user_message"]);

        firstPromptGate.resolve();
        await waitFor(() => orchestratorPromptCount === 2);
        await waitFor(
          () => !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );

        expect(systemPromptsSeen[0]).not.toContain(freshMarker);
        expect(systemPromptsSeen[1]).toContain(freshMarker);
        expect(systemPromptsSeen[1]).toContain(newerMarker);
        const refreshed = await catalog.openSurface(created.target);
        expect(refreshed.promptBinding?.stale).toBe(false);
        expect(refreshed.queuedMessages).toEqual([]);
      } finally {
        firstPromptGate.resolve();
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("sends first orchestrator prompts as raw user text without prompt reconstruction", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Raw Prompt" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const sentPrompts: string[] = [];
      const sentPromptOptions: Array<{ expandPromptTemplates?: boolean } | undefined> = [];
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
        options?: { expandPromptTemplates?: boolean },
      ) {
        if (promptText.startsWith("First user message:")) {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Raw prompt")]);
          return;
        }

        sentPrompts.push(promptText);
        sentPromptOptions.push(options);
        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("User: keep this exact label")],
          onEvent: () => {},
        });

        await waitFor(() => sentPrompts.length === 1);
        const sentPrompt = sentPrompts[0]!;
        expect(sentPrompt).toBe("User: keep this exact label");
        expect(sentPromptOptions).toEqual([{ expandPromptTemplates: false }]);
        expectNoPromptReconstruction(sentPrompt);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("sends direct handler user prompts as raw latest user text only", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Follow Up" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Follow Up Handler",
        objective: "Handle follow-up prompts.",
      });
      await catalog.openSurface(handler.target);
      const handlerManaged = getManagedSurface(catalog, handler.target.surfacePiSessionId);
      const sessionPrototype = Object.getPrototypeOf(handlerManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const sentPrompts: string[] = [];
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.sessionId !== handler.target.surfacePiSessionId) {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Ignored.")]);
          return;
        }
        sentPrompts.push(promptText);
        appendMessagesToSession(this, [
          userMessage(promptText),
          assistantMessage("Handled with ordinary transcript-local detail.", {
            stopReason: "toolUse",
            toolCalls: [
              {
                type: "toolCall",
                id: "ordinary-handler-tool-call",
                name: "exec_command",
                arguments: { cmd: "echo ordinary handler work" },
              },
            ],
          }),
        ]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: handler.target,
          messages: [
            userMessage("Earlier handler question"),
            assistantMessage("Earlier handler answer"),
            userMessage("Assistant: keep this literal follow-up"),
          ],
          onEvent: () => {},
        });

        await waitFor(() => sentPrompts.length === 1);
        const sentPrompt = sentPrompts[0]!;
        expect(sentPrompt).toBe("Assistant: keep this literal follow-up");
        expectNoPromptReconstruction(sentPrompt);

        const store = getStructuredSessionStore(catalog);
        const handlerTurn = store
          .getSessionState(created.target.workspaceSessionId)
          .turns.find((turn) => turn.threadId === handler.threadId);
        if (!handlerTurn) {
          throw new Error("Expected direct handler prompt to create a handler-owned turn.");
        }
        const command = store.createCommand({
          turnId: handlerTurn.id,
          surfacePiSessionId: handler.target.surfacePiSessionId,
          threadId: handler.threadId,
          toolName: "exec_command",
          executor: "handler",
          visibility: "surface",
          title: "Ordinary handler command",
          summary: "Command summary stays command-owned.",
        });
        store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary: "Command summary stays command-owned.",
        });
        const snapshot = store.getSessionState(created.target.workspaceSessionId);
        expect(snapshot.commands.map((entry) => entry.id)).toContain(command.id);
        expect(snapshot.episodes).toEqual([]);
        expect(store.getThreadDetail(handler.threadId).episodes).toEqual([]);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("keeps handler-local Smithers failure repair on the handler surface until thread_report", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Repair" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Repair Handler",
        objective: "Repair a Smithers command failure locally.",
      });
      await catalog.openSurface(handler.target);

      const handlerManaged = getManagedSurface(catalog, handler.target.surfacePiSessionId);
      const sessionPrototype = Object.getPrototypeOf(handlerManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const handlerPrompts: string[] = [];
      const orchestratorPrompts: string[] = [];
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.sessionId === created.target.surfacePiSessionId) {
          orchestratorPrompts.push(promptText);
          appendMessagesToSession(this, [
            userMessage(promptText),
            assistantMessage("Orchestrator should only receive explicit reports."),
          ]);
          return;
        }

        if (surface?.sessionId !== handler.target.surfacePiSessionId) {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
          return;
        }

        handlerPrompts.push(promptText);
        appendMessagesToSession(this, [userMessage(promptText)]);
        if (promptText === "Run the broken Smithers workflow.") {
          appendMessagesToSession(this, [
            assistantMessage("Smithers failed. I will repair it inside this handler thread."),
          ]);
          return;
        }

        if (promptText === "Repair and rerun the Smithers workflow locally.") {
          appendMessagesToSession(this, [
            assistantMessage("Repair rerun succeeded and remains handler-local."),
          ]);
          return;
        }

        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
      });

      try {
        const store = getStructuredSessionStore(catalog);
        const initialOrchestratorTurnIds = store
          .getSessionState(created.target.workspaceSessionId)
          .turns.filter(
            (turn) =>
              turn.surfacePiSessionId === created.target.surfacePiSessionId && !turn.threadId,
          )
          .map((turn) => turn.id);

        await catalog.sendPrompt({
          ...DEFAULTS,
          target: handler.target,
          messages: [userMessage("Run the broken Smithers workflow.")],
          onEvent: () => {},
        });
        await waitFor(() => handlerPrompts.length === 1);

        const firstHandlerTurn = store
          .getSessionState(created.target.workspaceSessionId)
          .turns.find(
            (turn) =>
              turn.threadId === handler.threadId &&
              turn.surfacePiSessionId === handler.target.surfacePiSessionId,
          );
        if (!firstHandlerTurn) {
          throw new Error("Expected failed Smithers prompt to create a handler-owned turn.");
        }
        const failedCommand = store.createCommand({
          turnId: firstHandlerTurn.id,
          surfacePiSessionId: handler.target.surfacePiSessionId,
          threadId: handler.threadId,
          toolName: "exec_command",
          executor: "handler",
          visibility: "surface",
          title: "Run Smithers workflow",
          summary: "smithers workflow run broken.workflow.tsx",
          facts: {
            command: "smithers workflow run broken.workflow.tsx",
            toolCallId: "tool-call-smithers-failed",
          },
        });
        store.startCommand(failedCommand.id);
        store.finishCommand({
          commandId: failedCommand.id,
          status: "failed",
          summary: "Smithers failed: missing input binding.",
          error: "Smithers failed: missing input binding.",
        });
        const afterFailure = store.getSessionState(created.target.workspaceSessionId);
        const storedFailedCommand = afterFailure.commands.find(
          (command) => command.id === failedCommand.id,
        );
        expect(storedFailedCommand).toMatchObject({
          threadId: handler.threadId,
          surfacePiSessionId: handler.target.surfacePiSessionId,
          toolName: "exec_command",
          executor: "handler",
          status: "failed",
          error: "Smithers failed: missing input binding.",
        });
        expect(afterFailure.episodes).toEqual([]);
        expect(
          afterFailure.turns
            .filter(
              (turn) =>
                turn.surfacePiSessionId === created.target.surfacePiSessionId && !turn.threadId,
            )
            .map((turn) => turn.id),
        ).toEqual(initialOrchestratorTurnIds);
        expect(
          store
            .listQueuedSurfaceMessages({
              surfacePiSessionId: created.target.surfacePiSessionId,
            })
            .filter((message) => message.kind === "thread_report_notification"),
        ).toEqual([]);
        expect(orchestratorPrompts).toEqual([]);

        await catalog.sendPrompt({
          ...DEFAULTS,
          target: handler.target,
          messages: [userMessage("Repair and rerun the Smithers workflow locally.")],
          onEvent: () => {},
        });
        await waitFor(() => handlerPrompts.length === 2);

        const handlerTurns = store
          .getSessionState(created.target.workspaceSessionId)
          .turns.filter(
            (turn) =>
              turn.threadId === handler.threadId &&
              turn.surfacePiSessionId === handler.target.surfacePiSessionId,
          );
        expect(handlerTurns).toHaveLength(2);
        const secondHandlerTurn = handlerTurns[1]!;
        const rerunCommand = store.createCommand({
          turnId: secondHandlerTurn.id,
          surfacePiSessionId: handler.target.surfacePiSessionId,
          threadId: handler.threadId,
          toolName: "exec_command",
          executor: "handler",
          visibility: "surface",
          title: "Rerun Smithers workflow",
          summary: "smithers workflow run repaired.workflow.tsx",
          facts: {
            command: "smithers workflow run repaired.workflow.tsx",
            toolCallId: "tool-call-smithers-rerun",
          },
        });
        store.startCommand(rerunCommand.id);
        store.finishCommand({
          commandId: rerunCommand.id,
          status: "succeeded",
          summary: "Smithers run completed.",
          facts: { exitCode: 0 },
        });
        const afterRepair = store.getSessionState(created.target.workspaceSessionId);
        const storedRerunCommand = afterRepair.commands.find(
          (command) => command.id === rerunCommand.id,
        );
        expect(storedRerunCommand).toMatchObject({
          threadId: handler.threadId,
          surfacePiSessionId: handler.target.surfacePiSessionId,
          toolName: "exec_command",
          executor: "handler",
          status: "succeeded",
        });
        expect(afterRepair.episodes).toEqual([]);
        expect(orchestratorPrompts).toEqual([]);
        expect(
          afterRepair.turns
            .filter(
              (turn) =>
                turn.surfacePiSessionId === created.target.surfacePiSessionId && !turn.threadId,
            )
            .map((turn) => turn.id),
        ).toEqual(initialOrchestratorTurnIds);
        expect(
          store
            .listQueuedSurfaceMessages({
              surfacePiSessionId: created.target.surfacePiSessionId,
            })
            .filter((message) => message.kind === "thread_report_notification"),
        ).toEqual([]);

        const reportTurn = store.startTurn({
          sessionId: created.target.workspaceSessionId,
          surfacePiSessionId: handler.target.surfacePiSessionId,
          threadId: handler.threadId,
          requestSummary: "Report repaired handler work",
        });
        const reportTool = createThreadReportTool({
          runtime: {
            current: createPromptExecutionContext({
              sessionId: created.target.workspaceSessionId,
              turnId: reportTurn.id,
              surfacePiSessionId: handler.target.surfacePiSessionId,
              surfaceThreadId: handler.threadId,
              surfaceKind: "handler",
              rootThreadId: handler.threadId,
              promptText: "Report repaired handler work.",
            }),
          },
          store,
          queueThreadReportNotification: (request) =>
            (
              catalog as unknown as {
                queueThreadReportNotification(input: typeof request): Promise<void>;
              }
            ).queueThreadReportNotification.call(catalog, request),
        });
        await reportTool.execute("tool-call-handler-report", {
          summary: "Smithers repair completed",
          details: "The handler repaired and reran the Smithers workflow.",
          outcome: "succeeded",
          relatedCommandIds: [rerunCommand!.id],
        });

        expect(store.getSessionState(created.target.workspaceSessionId).episodes).toEqual([
          expect.objectContaining({
            threadId: handler.threadId,
            summary: "Smithers repair completed",
          }),
        ]);
        expect(
          store
            .listQueuedSurfaceMessages({
              surfacePiSessionId: created.target.surfacePiSessionId,
            })
            .filter((message) => message.kind === "thread_report_notification"),
        ).toHaveLength(1);
      } finally {
        promptSpy.mockRestore();
      }
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
          "request_user_input",
          "thread_list",
          "thread_episodes",
          "thread_start",
          "thread_followup",
          "thread_request_report",
        ]),
      );
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
          "request_user_input",
          "thread_current",
          "thread_group",
          "thread_report",
          "thread_episodes",
        ]),
      );
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
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

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

      const openSurfaceIds = (await catalog.listOpenSurfaceSnapshots()).map(
        (snapshot) => snapshot.target.surfacePiSessionId,
      );
      expect(openSurfaceIds).toEqual(
        expect.arrayContaining([
          created.target.surfacePiSessionId,
          handler.target.surfacePiSessionId,
        ]),
      );

      await closeSurface(catalog, handler.target);
      expect(getManagedSurface(catalog, handler.target.surfacePiSessionId).retainCount).toBe(1);
      expect(
        surfaceSyncs.some(
          (payload) =>
            payload.reason === "surface.closed" &&
            payload.target.surfacePiSessionId === handler.target.surfacePiSessionId,
        ),
      ).toBe(false);

      await closeSurface(catalog, handler.target);
      await waitFor(() => !getManagedSurfaces(catalog).has(handler.target.surfacePiSessionId));
      expect(
        surfaceSyncs.some(
          (payload) =>
            payload.reason === "surface.closed" &&
            payload.target.surfacePiSessionId === handler.target.surfacePiSessionId,
        ),
      ).toBe(true);

      await closeSurface(catalog, created.target);
      await waitFor(() => getManagedSurfaces(catalog).size === 0);
      expect(
        surfaceSyncs.some(
          (payload) =>
            payload.reason === "surface.closed" &&
            payload.target.surfacePiSessionId === created.target.surfacePiSessionId,
        ),
      ).toBe(true);
    } finally {
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });

  it("emits workspace and surface syncs through separate payloads", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const workspaceSyncs: WorkspaceSyncMessage[] = [];
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setWorkspaceSyncListener((payload) => {
      workspaceSyncs.push(payload);
    });
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Prompt Sync" }, DEFAULTS);
      expect(workspaceSyncs).toHaveLength(1);
      expect(workspaceSyncs[0]?.reason).toBe("workspace.updated");
      expect(surfaceSyncs).toHaveLength(0);
      workspaceSyncs.length = 0;

      const draftResponse = await catalog.updateComposerDraft({
        target: created.target,
        draft: {
          text: "Explain the parser",
          attachments: [],
        },
      });
      expect(draftResponse).toEqual({ ok: true, target: created.target });
      expect("snapshot" in (draftResponse as unknown as Record<string, unknown>)).toBe(false);
      expect(workspaceSyncs).toHaveLength(1);
      expect(workspaceSyncs[0]?.reason).toBe("structured.updated");
      expect(surfaceSyncs).toHaveLength(0);
      workspaceSyncs.length = 0;

      const prompt = userMessage("Explain the parser");
      const reply = assistantMessage("Parser cursor synced.");
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptSpy = spyOn(managed.session, "prompt").mockImplementation(
        async function (this: PromptableSession) {
          appendMessagesToSession(this, [prompt, reply]);
        },
      );

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [prompt],
          onEvent: () => {},
        });

        await waitFor(
          () =>
            surfaceSyncs.some(
              (payload) =>
                payload.reason === "prompt.settled" &&
                payload.target.surfacePiSessionId === created.target.surfacePiSessionId,
            ) &&
            workspaceSyncs
              .flatMap((payload) => payload.sessions)
              .some(
                (session) =>
                  session.id === created.target.workspaceSessionId &&
                  session.status === "idle" &&
                  session.preview.length > 0,
              ),
        );

        expect("snapshot" in (workspaceSyncs[0] as unknown as Record<string, unknown>)).toBe(false);

        const promptSettled =
          surfaceSyncs.find(
            (payload) =>
              payload.reason === "prompt.settled" &&
              payload.target.surfacePiSessionId === created.target.surfacePiSessionId,
          ) ?? null;
        expect(promptSettled).toBeTruthy();
        expect(promptSettled?.snapshot?.promptStatus).toBe("idle");
        expect(
          hasAssistantReply(promptSettled?.snapshot?.messages ?? [], "Parser cursor synced."),
        ).toBe(true);
        expect("sessions" in (promptSettled as unknown as Record<string, unknown>)).toBe(false);

        expect(
          workspaceSyncs
            .flatMap((payload) => payload.sessions)
            .some(
              (session) =>
                session.id === created.target.workspaceSessionId &&
                session.status === "idle" &&
                session.preview.length > 0,
            ),
        ).toBe(true);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      catalog.setWorkspaceSyncListener(null);
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });

  it("keeps prompt locks independent across surfaces", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Independent Locks" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Delegated Fix",
        objective: "Own a delegated handler objective while the orchestrator stays usable.",
      });
      await catalog.openSurface(handler.target);

      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const handlerPromptGate = createDeferred<void>();
      const handlerPrompt = userMessage("Keep working on the delegated fix.");
      const orchestratorPrompt = userMessage("What should the orchestrator do next?");
      const promptPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(
          promptText: string,
          options?: {
            expandPromptTemplates?: boolean;
          },
        ): Promise<void>;
      };
      const handlerPromptSpy = spyOn(promptPrototype, "prompt").mockImplementation(
        async function (this: PromptableSession) {
          const surface = findManagedSurfaceBySession(catalog, this);
          if (!surface) {
            throw new Error("Prompt executed on an unknown managed surface.");
          }
          if (surface.sessionId === handler.target.surfacePiSessionId) {
            await handlerPromptGate.promise;
            appendMessagesToSession(this, [
              handlerPrompt,
              assistantMessage("Handler kept working on the delegated fix."),
            ]);
            return;
          }
          if (surface.sessionId === created.target.surfacePiSessionId) {
            appendMessagesToSession(this, [
              orchestratorPrompt,
              assistantMessage("The orchestrator can continue independently."),
            ]);
            return;
          }
          throw new Error(`Unexpected prompt surface: ${surface.sessionId}`);
        },
      );

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: handler.target,
          messages: [handlerPrompt],
          onEvent: () => {},
        });

        await waitFor(
          () =>
            handlerPromptSpy.mock.calls.length === 1 &&
            getManagedSurface(catalog, handler.target.surfacePiSessionId).activePrompt,
        );

        await catalog.sendPrompt({
          ...DEFAULTS,
          target: handler.target,
          messages: [handlerPrompt],
          onEvent: () => {},
        });
        expect(
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.filter((message) => message.status === "queued"),
        ).toHaveLength(1);
        expect(
          surfaceSyncs.some(
            (payload) =>
              payload.reason === "surface.updated" &&
              payload.target.surfacePiSessionId === handler.target.surfacePiSessionId &&
              payload.snapshot?.queuedMessages.some(
                (message) =>
                  message.status === "queued" &&
                  message.text === "Keep working on the delegated fix.",
              ),
          ),
        ).toBe(true);

        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [orchestratorPrompt],
          onEvent: () => {},
        });

        await waitFor(() => handlerPromptSpy.mock.calls.length === 2);
        expect(getManagedSurface(catalog, handler.target.surfacePiSessionId).activePrompt).toBe(
          true,
        );
        expect(handlerPromptSpy).toHaveBeenCalledTimes(2);

        handlerPromptGate.resolve();
        await waitFor(
          () =>
            !getManagedSurface(catalog, handler.target.surfacePiSessionId).activePrompt &&
            !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );
        await waitFor(() => handlerPromptSpy.mock.calls.length === 3);
        expect(
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.map((message) => message.status) ?? [],
        ).toEqual(["delivered", "delivered", "delivered"]);
      } finally {
        handlerPromptGate.resolve();
        handlerPromptSpy.mockRestore();
      }
    } finally {
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });

  it("claims idle sends before publishing a visible queued row", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Queued Drain" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const queuedPrompt = userMessage("Run the queued turn.");
      const queuedPromptGate = createDeferred<void>();
      const promptPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(
          promptText: string,
          options?: {
            expandPromptTemplates?: boolean;
          },
        ): Promise<void>;
      };
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(
        async function (this: PromptableSession) {
          const surface = findManagedSurfaceBySession(catalog, this);
          if (surface?.actorKind === "namer") {
            appendMessagesToSession(this, [userMessage("Name the session."), assistantMessage("")]);
            return;
          }
          await queuedPromptGate.promise;
          appendMessagesToSession(this, [queuedPrompt, assistantMessage("Queued turn finished.")]);
        },
      );

      try {
        (managed as unknown as { activeStreamSequence: number }).activeStreamSequence = 42;
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [queuedPrompt],
          onEvent: () => {},
        });

        await waitFor(() => {
          const queue =
            getStructuredSessionStore(catalog).getSessionState(created.target.workspaceSessionId)
              .queuedMessages ?? [];
          return (
            promptSpy.mock.calls.length === 1 &&
            getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt &&
            queue.some((message) => message.status === "dispatching")
          );
        });

        const snapshot = await catalog.openSurface(created.target);
        const runningTurn = getStructuredSessionStore(catalog)
          .getSessionState(created.target.workspaceSessionId)
          .turns.find(
            (turn) =>
              turn.surfacePiSessionId === created.target.surfacePiSessionId &&
              turn.status === "running",
          );
        if (!runningTurn) {
          throw new Error("Expected an active running turn.");
        }
        expect(snapshot.activeTurnId).toBe(runningTurn.id);
        expect(snapshot.activeTurnStartedAt).toBe(runningTurn.startedAt);
        expect(snapshot.queuedMessages).toEqual([]);
        expect(userMessageText(snapshot.pendingUserMessage)).toBe("Run the queued turn.");
        expect(
          surfaceSyncs.some(
            (payload) =>
              payload.reason === "surface.updated" &&
              payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
              payload.snapshot?.queuedMessages.some((message) => message.status === "queued"),
          ),
        ).toBe(false);
        expect(
          surfaceSyncs.some(
            (payload) =>
              payload.reason === "background.started" &&
              payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
              userMessageText(payload.snapshot?.pendingUserMessage ?? null) ===
                "Run the queued turn." &&
              payload.snapshot?.streamSequence === 0 &&
              payload.snapshot?.activeTurnId === runningTurn?.id &&
              payload.snapshot?.activeTurnStartedAt === runningTurn?.startedAt &&
              payload.snapshot?.queuedMessages.length === 0,
          ),
        ).toBe(true);

        queuedPromptGate.resolve();
        await waitFor(
          () => !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );
        expect(
          promptSpy.mock.calls.filter(([promptText]) => promptText === "Run the queued turn."),
        ).toHaveLength(1);
        expect(
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.map((message) => message.status) ?? [],
        ).toEqual(["delivered"]);
        const finishedTurn = getStructuredSessionStore(catalog)
          .getSessionState(created.target.workspaceSessionId)
          .turns.find((turn) => turn.id === runningTurn?.id);
        if (!runningTurn || !finishedTurn?.finishedAt) {
          throw new Error("Expected queued turn to finish with timing metadata.");
        }
        const settledSnapshot = await catalog.openSurface(created.target);
        expect(settledSnapshot.turnTimings).toContainEqual({
          turnId: runningTurn.id,
          assistantMessageTimestamp: expect.any(Number),
          startedAt: runningTurn.startedAt,
          finishedAt: finishedTurn.finishedAt,
        });
      } finally {
        queuedPromptGate.resolve();
        promptSpy.mockRestore();
      }
    } finally {
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });

  it("keeps pre-turn queued delivery failures as failed composer rows", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Queue Delivery Failure" }, DEFAULTS);
      const store = getStructuredSessionStore(catalog);
      const queued = store.enqueueSurfaceMessage({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        messageJson: "{not-json",
        requestSummary: "Malformed queued prompt",
      });
      const runner = catalog as unknown as {
        runSurfaceQueue(target: PromptTarget): Promise<void>;
      };

      await expect(runner.runSurfaceQueue(created.target)).rejects.toThrow(
        `Queued surface message ${queued.id} could not be parsed.`,
      );

      const failed = store.getSurfaceQueuedMessage({ id: queued.id });
      expect(failed).toMatchObject({
        id: queued.id,
        status: "failed",
        failureError: `Queued surface message ${queued.id} could not be parsed.`,
      });
      const snapshot = await catalog.openSurface(created.target);
      expect(snapshot.queuedMessages).toContainEqual(
        expect.objectContaining({
          id: queued.id,
          status: "failed",
          text: "Malformed queued prompt",
          failureError: `Queued surface message ${queued.id} could not be parsed.`,
        }),
      );
      expect(snapshot.activeTurnId).toBeNull();
      expect(
        store
          .getSessionState(created.target.workspaceSessionId)
          .turns.filter((turn) => turn.surfacePiSessionId === created.target.surfacePiSessionId),
      ).toEqual([]);
      expect(
        surfaceSyncs.some((payload) =>
          payload.snapshot?.queuedMessages.some(
            (message) => message.id === queued.id && message.status === "failed",
          ),
        ),
      ).toBe(true);

      const restored = await catalog.editQueuedSurfaceMessage({
        target: created.target,
        queuedMessageId: queued.id,
      });
      expect(restored.text).toBe("Malformed queued prompt");
      expect(restored.snapshot?.queuedMessages).toEqual([]);
    } finally {
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });

  it("routes active steer requests through the durable surface queue", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Steer Surface" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptGate = createDeferred<void>();
      const prompt = userMessage("Start a long turn.");
      const steer = userMessage("Focus on the failing backend contract.");
      let targetPromptCalls = 0;
      const sessionPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(
          promptText: string,
          options?: {
            expandPromptTemplates?: boolean;
          },
        ): Promise<void>;
        steer(text: string): Promise<void>;
      };
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(
        async function (this: PromptableSession) {
          const surface = findManagedSurfaceBySession(catalog, this);
          if (surface?.sessionId !== created.target.surfacePiSessionId) {
            appendMessagesToSession(this, [
              userMessage("Name the session."),
              assistantMessage("Steer surface"),
            ]);
            return;
          }
          targetPromptCalls += 1;
          await promptGate.promise;
          appendMessagesToSession(this, [prompt, assistantMessage("Long turn finished.")]);
        },
      );
      const steerSpy = spyOn(sessionPrototype, "steer").mockResolvedValue(undefined);

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [prompt],
          onEvent: () => {},
        });
        await waitFor(
          () => getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );

        await catalog.steerPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [steer],
          onEvent: () => {},
        });

        expect(
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.filter((message) => message.status === "queued")
            .map((message) => message.requestSummary),
        ).toEqual(["Focus on the failing backend contract."]);
        expect(steerSpy).not.toHaveBeenCalled();

        promptGate.resolve();
        await waitFor(() => targetPromptCalls === 2);
        await waitFor(
          () => !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );
      } finally {
        promptGate.resolve();
        promptSpy.mockRestore();
        steerSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("records handler thread reports durably while orchestrator reconciliation is queued", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Blocked Report" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptGate = createDeferred<void>();
      const sessionPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.sessionId === created.target.surfacePiSessionId) {
          await promptGate.promise;
        }
        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
      });

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [userMessage("Keep working while a handler finishes.")],
          onEvent: () => {},
        });
        await waitFor(
          () => getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );

        const store = getStructuredSessionStore(catalog);
        const turn = store.startTurn({
          sessionId: created.target.workspaceSessionId,
          surfacePiSessionId: created.target.surfacePiSessionId,
          requestSummary: "Delegate durable report work",
        });
        const parentThread = store.createThread({
          turnId: turn.id,
          surfacePiSessionId: created.target.surfacePiSessionId,
          title: "Parent",
          objective: "Parent delegated work.",
        });
        const handlerThread = store.createThread({
          turnId: turn.id,
          parentThreadId: parentThread.id,
          surfacePiSessionId: "handler-blocked-report",
          title: "Handler",
          objective: "Finish the durable report.",
        });
        const command = store.createCommand({
          turnId: turn.id,
          surfacePiSessionId: handlerThread.surfacePiSessionId,
          threadId: handlerThread.id,
          toolName: "thread_report",
          executor: "handler",
          visibility: "surface",
          title: "Thread report",
          summary: "Handler finished while orchestrator was active.",
        });
        store.startCommand(command.id);
        const episode = store.createEpisode({
          threadId: handlerThread.id,
          sourceCommandId: command.id,
          title: "Durable report",
          summary: "Handler finished while orchestrator was active.",
          body: "The handler completed its work and is asking the orchestrator to reconcile.",
        });
        store.updateThread({
          threadId: handlerThread.id,
          objectiveState: "concluded",
          status: "completed",
        });
        await (
          catalog as unknown as {
            queueThreadReportNotification(input: {
              runtime: {
                sessionId: string;
                turnId: string;
                surfacePiSessionId: string;
                surfaceThreadId: string;
                surfaceKind: "handler";
                rootThreadId: string;
                promptText: string;
                rootEpisodeKind: "change";
                sessionWaitApplied: false;
                threadWasTerminalAtStart: false;
              };
              commandId: string;
              episode: typeof episode;
              outcome: "succeeded";
            }): Promise<void>;
          }
        ).queueThreadReportNotification.call(catalog, {
          runtime: {
            sessionId: created.target.workspaceSessionId,
            turnId: turn.id,
            surfacePiSessionId: handlerThread.surfacePiSessionId,
            surfaceThreadId: handlerThread.id,
            surfaceKind: "handler",
            rootThreadId: handlerThread.id,
            promptText: "Hand off",
            rootEpisodeKind: "change",
            sessionWaitApplied: false,
            threadWasTerminalAtStart: false,
          },
          commandId: command.id,
          episode,
          outcome: "succeeded",
        });

        await waitFor(() =>
          store
            .listQueuedSurfaceMessages({
              surfacePiSessionId: created.target.surfacePiSessionId,
            })
            .some((message) => message.kind === "thread_report_notification"),
        );
        const queued = store
          .listQueuedSurfaceMessages({ surfacePiSessionId: created.target.surfacePiSessionId })
          .find((message) => message.kind === "thread_report_notification");
        expect(queued).toBeDefined();
        if (!queued) return;
        expect(store.getSessionState(created.target.workspaceSessionId).episodes).toEqual([
          expect.objectContaining({
            id: episode.id,
            threadId: handlerThread.id,
            sourceCommandId: command.id,
          }),
        ]);
        expect(
          store
            .getSessionState(created.target.workspaceSessionId)
            .threads.find((thread) => thread.id === handlerThread.id),
        ).toMatchObject({ status: "completed" });
        await catalog.deleteQueuedSurfaceMessage({
          target: created.target,
          queuedMessageId: queued.id,
        });
        expect(store.getSessionState(created.target.workspaceSessionId).episodes).toEqual([
          expect.objectContaining({
            id: episode.id,
            threadId: handlerThread.id,
            sourceCommandId: command.id,
          }),
        ]);

        promptGate.resolve();
        await waitFor(
          () => !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );
      } finally {
        promptGate.resolve();
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("reactivates a concluded handler thread through thread_followup", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Resume Handler" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Resume Target",
        objective: "Own follow-up investigation context.",
      });
      const store = getStructuredSessionStore(catalog);
      store.updateThread({
        threadId: handler.threadId,
        objectiveState: "concluded",
        status: "completed",
      });

      const handlerPrompts: string[] = [];
      await catalog.openSurface(handler.target);
      const managed = getManagedSurface(catalog, handler.target.surfacePiSessionId);
      const sessionPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.sessionId === handler.target.surfacePiSessionId) {
          handlerPrompts.push(promptText);
        }
        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
      });

      try {
        const turn = store.startTurn({
          sessionId: created.target.workspaceSessionId,
          surfacePiSessionId: created.target.surfacePiSessionId,
          requestSummary: "Resume existing handler",
        });
        const command = store.createCommand({
          turnId: turn.id,
          surfacePiSessionId: created.target.surfacePiSessionId,
          toolName: "thread_followup",
          executor: "orchestrator",
          visibility: "surface",
          title: "Queue thread follow-up",
          summary: "Ask the same handler for follow-up evidence.",
        });
        store.startCommand(command.id);

        const followup = await (
          catalog as unknown as {
            queueThreadFollowup(input: {
              runtime: {
                sessionId: string;
                turnId: string;
                surfacePiSessionId: string;
                surfaceKind: "orchestrator";
                rootThreadId: null;
              };
              commandId: string;
              threadIds: string[];
              threadGroupId: null;
              message: string;
              activate: true;
            }): Promise<{ threads: Array<{ queuedMessageId: string }> }>;
          }
        ).queueThreadFollowup.call(catalog, {
          runtime: {
            sessionId: created.target.workspaceSessionId,
            turnId: turn.id,
            surfacePiSessionId: created.target.surfacePiSessionId,
            surfaceKind: "orchestrator",
            rootThreadId: null,
          },
          commandId: command.id,
          threadIds: [handler.threadId],
          threadGroupId: null,
          message: "Please inspect the previous report and add one missing detail.",
          activate: true,
        });

        expect(followup.threads[0]?.queuedMessageId).toBeTruthy();
        expect(
          store
            .getSessionState(created.target.workspaceSessionId)
            .threads.find((thread) => thread.id === handler.threadId),
        ).toMatchObject({ objectiveState: "active", status: "running-handler" });
        await waitFor(() => handlerPrompts.length === 1);
        expect(handlerPrompts[0]).toBe(
          "Please inspect the previous report and add one missing detail.",
        );
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("delivers later request_user_input answers to the owning handler surface", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Handler Answer" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Clarification Target",
        objective: "Own a clarification request inside the handler thread.",
      });
      const store = getStructuredSessionStore(catalog);
      const command = store.createCommand({
        turnId: handler.turnId,
        surfacePiSessionId: handler.surfacePiSessionId,
        threadId: handler.threadId,
        toolName: "request_user_input",
        executor: "handler",
        visibility: "surface",
        title: "Ask user",
        summary: "Clarify the handler repair direction.",
      });
      const request = store.createRequestUserInputRequest({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: handler.surfacePiSessionId,
        threadId: handler.threadId,
        turnId: handler.turnId,
        commandId: command.id,
        toolItemId: "tool-call-handler-answer",
        variant: "nonblocking",
        questions: [
          {
            title: "Repair direction",
            question: "Should I repair locally or report back now?",
            defaultAnswer: {
              kind: "option",
              label: "Repair locally",
              text: "Repair locally",
            },
            choices: [
              {
                label: "Repair locally",
                description: "Keeps the objective inside this handler.",
                recommended: true,
              },
              {
                label: "Report back",
                description: "Returns control to the orchestrator.",
                recommended: false,
              },
            ],
          },
        ],
      });
      const reportBack = request.questions[0]!.choices.find(
        (choice) => choice.label === "Report back",
      )!;
      expect((await catalog.listSessions()).requestUserInputRequests).toEqual([
        expect.objectContaining({
          requestId: request.requestId,
          workspaceSessionId: created.target.workspaceSessionId,
          surfacePiSessionId: handler.surfacePiSessionId,
          threadId: handler.threadId,
          ownerTitle: "Own a clarification request inside the handler thread.",
          variant: "nonblocking",
          status: "open",
          questions: [
            expect.objectContaining({
              questionId: request.questions[0]!.questionId,
              title: "Repair direction",
              status: "open",
              choices: [
                expect.objectContaining({ label: "Repair locally", recommended: true }),
                expect.objectContaining({ label: "Report back", recommended: false }),
              ],
            }),
          ],
        }),
      ]);
      await catalog.openSurface(handler.target);
      const managed = getManagedSurface(catalog, handler.target.surfacePiSessionId);
      const sessionPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const handlerPrompts: string[] = [];
      const orchestratorPrompts: string[] = [];
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.sessionId === handler.surfacePiSessionId) {
          handlerPrompts.push(promptText);
        }
        if (surface?.sessionId === created.target.surfacePiSessionId) {
          orchestratorPrompts.push(promptText);
        }
        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
      });

      try {
        const answer = await catalog.answerRequestUserInput({
          surfacePiSessionId: handler.surfacePiSessionId,
          requestId: request.requestId,
          questionId: request.questions[0]!.questionId,
          answer: { kind: "option", optionId: reportBack.optionId },
          delivery: "after_turn",
        });
        await waitFor(() => handlerPrompts.length === 1);
        expect(orchestratorPrompts).toEqual([]);
        expect(JSON.parse(handlerPrompts[0]!)).toEqual({
          type: "request_user_input.answer",
          title: "Repair direction",
          question: "Should I repair locally or report back now?",
          originalAnswer: {
            kind: "option",
            label: "Repair locally",
            text: "Repair locally",
          },
          userAnswer: {
            kind: "option",
            label: "Report back",
            text: "Report back",
          },
        });
        const queuedMessageId = answer.snapshot?.queuedMessages.find(
          (message) => message.kind === "request_user_input_answer",
        )?.id;
        expect(queuedMessageId).toBeTruthy();
        expect(store.getSurfaceQueuedMessage({ id: queuedMessageId! }).status).toBe("delivered");
        expect((await catalog.listSessions()).requestUserInputRequests).toEqual([
          expect.objectContaining({
            requestId: request.requestId,
            status: "completed",
            questions: [expect.objectContaining({ status: "answered" })],
          }),
        ]);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("delivers a queued thread report notification as the next orchestrator input", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Accepted Report" }, DEFAULTS);
      const managed = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const sessionPrototype = Object.getPrototypeOf(managed.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const orchestratorPrompts: string[] = [];
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.sessionId === created.target.surfacePiSessionId) {
          orchestratorPrompts.push(promptText);
        }
        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Done.")]);
      });

      try {
        const store = getStructuredSessionStore(catalog);
        const turn = store.startTurn({
          sessionId: created.target.workspaceSessionId,
          surfacePiSessionId: created.target.surfacePiSessionId,
          requestSummary: "Delegate accepted report work",
        });
        const parentThread = store.createThread({
          turnId: turn.id,
          surfacePiSessionId: created.target.surfacePiSessionId,
          title: "Parent",
          objective: "Parent delegated work.",
        });
        const handlerThread = store.createThread({
          turnId: turn.id,
          parentThreadId: parentThread.id,
          surfacePiSessionId: "handler-accepted-report",
          title: "Handler",
          objective: "Finish the accepted report.",
        });
        const command = store.createCommand({
          turnId: turn.id,
          surfacePiSessionId: handlerThread.surfacePiSessionId,
          threadId: handlerThread.id,
          toolName: "thread_report",
          executor: "handler",
          visibility: "surface",
          title: "Thread report",
          summary: "Handler finished and can be reconciled.",
        });
        store.startCommand(command.id);
        const episode = store.createEpisode({
          threadId: handlerThread.id,
          sourceCommandId: command.id,
          title: "Accepted report",
          summary: "Handler finished and can be reconciled.",
          body: "The handler completed its work and is asking the orchestrator to reconcile.",
        });
        store.updateThread({
          threadId: handlerThread.id,
          objectiveState: "concluded",
          status: "completed",
        });
        await (
          catalog as unknown as {
            queueThreadReportNotification(input: {
              runtime: {
                sessionId: string;
                turnId: string;
                surfacePiSessionId: string;
                surfaceThreadId: string;
                surfaceKind: "handler";
                rootThreadId: string;
                promptText: string;
                rootEpisodeKind: "change";
                sessionWaitApplied: false;
                threadWasTerminalAtStart: false;
              };
              commandId: string;
              episode: typeof episode;
              outcome: "succeeded";
            }): Promise<void>;
          }
        ).queueThreadReportNotification.call(catalog, {
          runtime: {
            sessionId: created.target.workspaceSessionId,
            turnId: turn.id,
            surfacePiSessionId: handlerThread.surfacePiSessionId,
            surfaceThreadId: handlerThread.id,
            surfaceKind: "handler",
            rootThreadId: handlerThread.id,
            promptText: "Thread report",
            rootEpisodeKind: "change",
            sessionWaitApplied: false,
            threadWasTerminalAtStart: false,
          },
          commandId: command.id,
          episode,
          outcome: "succeeded",
        });

        await waitFor(() => orchestratorPrompts.length === 1);
        expect(orchestratorPrompts[0]).toContain(
          "System event: A handler thread concluded with outcome succeeded.",
        );
        expect(orchestratorPrompts[0]).toContain("Handler finished and can be reconciled.");
        const snapshot = store.getSessionState(created.target.workspaceSessionId);
        expect(snapshot.episodes).toEqual([
          expect.objectContaining({
            id: episode.id,
            threadId: handlerThread.id,
            sourceCommandId: command.id,
          }),
        ]);
        expect(snapshot.threads.find((thread) => thread.id === handlerThread.id)).toMatchObject({
          status: "completed",
        });
        expect(
          store.listQueuedSurfaceMessages({
            surfacePiSessionId: created.target.surfacePiSessionId,
          }),
        ).toEqual([]);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("applies model and reasoning changes only to the targeted surface", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Surface Settings" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Settings Handler",
        objective: "Own handler-local model and reasoning state.",
      });
      await catalog.openSurface(handler.target);

      await setSurfaceModel(catalog, handler.target, "gpt-4.1-mini");
      await setSurfaceThoughtLevel(catalog, handler.target, "high");

      const openSnapshots = await catalog.listOpenSurfaceSnapshots();
      const orchestratorSnapshot =
        openSnapshots.find(
          (snapshot) => snapshot.target.surfacePiSessionId === created.target.surfacePiSessionId,
        ) ?? null;
      const handlerSnapshot =
        openSnapshots.find(
          (snapshot) => snapshot.target.surfacePiSessionId === handler.target.surfacePiSessionId,
        ) ?? null;

      expect(orchestratorSnapshot?.model).toBe(DEFAULTS.model);
      expect(orchestratorSnapshot?.reasoningEffort).toBe(DEFAULTS.thinkingLevel);
      expect(handlerSnapshot?.reasoningEffort).toBe("high");

      const handlerUpdates = surfaceSyncs.filter(
        (payload) =>
          payload.reason === "surface.updated" &&
          payload.target.surfacePiSessionId === handler.target.surfacePiSessionId,
      );
      expect(handlerUpdates).toHaveLength(2);
      expect(handlerUpdates[0]?.snapshot?.model).toBe("gpt-4.1-mini");
      expect(handlerUpdates[1]?.snapshot?.reasoningEffort).toBe("high");
      expect(
        surfaceSyncs.some(
          (payload) => payload.target.surfacePiSessionId === created.target.surfacePiSessionId,
        ),
      ).toBe(false);
    } finally {
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });

  it("clamps surface reasoning when a model change no longer supports the current level", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Reasoning Clamp" }, DEFAULTS);
      await setSurfaceThoughtLevel(catalog, created.target, "high");
      await setSurfaceModel(catalog, created.target, "amazon.nova-2-lite-v1:0", "amazon-bedrock");

      const [snapshot] = await catalog.listOpenSurfaceSnapshots();
      expect(snapshot?.provider).toBe("amazon-bedrock");
      expect(snapshot?.model).toBe("amazon.nova-2-lite-v1:0");
      expect(snapshot?.reasoningEffort).toBe("off");

      const latestUpdate = surfaceSyncs
        .filter((payload) => payload.reason === "surface.updated")
        .at(-1);
      expect(latestUpdate?.snapshot?.reasoningEffort).toBe("off");
    } finally {
      catalog.setSurfaceSyncListener(null);
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
      setCatalogAgentProfile(catalog, syncedProfile);
      setCatalogAgentProfile(catalog, fixedProfile);

      const synced = await catalog.createSession(
        { title: "Synced profile", agentProfileId: syncedProfile.id },
        {
          provider: syncedProfile.provider,
          model: syncedProfile.model,
          thinkingLevel: syncedProfile.reasoningEffort,
          agentProfileId: syncedProfile.id,
          agentProfileSettings: syncedProfile,
        },
      );
      await setSurfaceModel(catalog, synced.target, "gpt-4.1-mini");
      await setSurfaceThoughtLevel(catalog, synced.target, "high");

      const syncedAfter = getCatalogAgentProfiles(catalog).find(
        (profile) => profile.id === syncedProfile.id,
      );
      expect(syncedAfter).toMatchObject({
        provider: "openai",
        model: "gpt-4.1-mini",
        reasoningEffort: "high",
      });

      const fixed = await catalog.createSession(
        { title: "Fixed profile", agentProfileId: fixedProfile.id },
        {
          provider: fixedProfile.provider,
          model: fixedProfile.model,
          thinkingLevel: fixedProfile.reasoningEffort,
          agentProfileId: fixedProfile.id,
          agentProfileSettings: fixedProfile,
        },
      );
      await setSurfaceModel(catalog, fixed.target, "gpt-4.1-mini");
      await setSurfaceThoughtLevel(catalog, fixed.target, "high");

      const fixedAfter = getCatalogAgentProfiles(catalog).find(
        (profile) => profile.id === fixedProfile.id,
      );
      expect(fixedAfter).toMatchObject({
        provider: "openai",
        model: "gpt-4o",
        reasoningEffort: "medium",
      });
    } finally {
      await catalog.dispose();
    }
  });

  it("auto-starts a new handler thread and clears live handler activity after a normal reply", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Auto Start Handler" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const sessionPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const handlerPrompts: string[] = [];
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.actorKind === "handler") {
          handlerPrompts.push(promptText);
          const partial = assistantMessage("I started the delegated objective.");
          const emit = (
            this as PromptableSession & {
              _emit?: (event: unknown) => void;
            }
          )._emit;
          appendMessagesToSession(this, [
            userMessage("Inspect the repository and report the result."),
          ]);
          emit?.call(this, {
            type: "message_update",
            message: partial,
            assistantMessageEvent: {
              type: "text_delta",
              contentIndex: 0,
              delta: "I started the delegated objective.",
              partial,
            },
          });
          appendMessagesToSession(this, [partial]);
          return;
        }

        appendMessagesToSession(this, [
          userMessage(promptText),
          assistantMessage("Auto-start handler title"),
        ]);
      });

      try {
        const store = getStructuredSessionStore(catalog);
        const turn = store.startTurn({
          sessionId: created.target.workspaceSessionId,
          surfacePiSessionId: created.target.surfacePiSessionId,
          requestSummary: "Delegate auto-start work",
        });
        const orchestratorThread = store.createThread({
          turnId: turn.id,
          surfacePiSessionId: created.target.surfacePiSessionId,
          title: "Delegate auto-start work",
          objective: "Open a handler thread for auto-start verification.",
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
              agentProfileSettings: null;
            }): Promise<{ id: string; surfacePiSessionId: string }>;
          }
        ).createHandlerThread({
          sessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          parentThreadId: orchestratorThread.id,
          parentSurfacePiSessionId: created.target.surfacePiSessionId,
          objective: "Inspect the repository and report the result.",
          loadedByCommandId: orchestratorThread.id,
          agentProfileSettings: null,
        });

        await waitFor(() => handlerPrompts.length === 1);
        const handlerPrompt = handlerPrompts[0]!;
        expect(handlerPrompt).toBe("Inspect the repository and report the result.");
        expectNoPromptReconstruction(handlerPrompt);
        await waitFor(() =>
          surfaceSyncs.some(
            (payload) =>
              payload.reason === "background.started" &&
              payload.target.surfacePiSessionId === handlerThread.surfacePiSessionId &&
              payload.snapshot?.pendingUserMessage?.role === "user",
          ),
        );
        const startedSnapshot = surfaceSyncs.find(
          (payload) =>
            payload.reason === "background.started" &&
            payload.target.surfacePiSessionId === handlerThread.surfacePiSessionId,
        )?.snapshot;
        expect(startedSnapshot?.messages).toHaveLength(0);
        expect(userMessageText(startedSnapshot?.pendingUserMessage)).toBe(
          "Inspect the repository and report the result.",
        );
        await waitFor(() =>
          surfaceSyncs.some(
            (payload) =>
              payload.reason === "stream.patch" &&
              payload.target.surfacePiSessionId === handlerThread.surfacePiSessionId &&
              payload.streamPatch?.type === "text_delta" &&
              payload.streamPatch.delta === "I started the delegated objective." &&
              !payload.snapshot,
          ),
        );
        await waitFor(() =>
          surfaceSyncs.some(
            (payload) =>
              payload.reason === "prompt.settled" &&
              payload.target.surfacePiSessionId === handlerThread.surfacePiSessionId &&
              payload.snapshot?.pendingUserMessage === null &&
              payload.snapshot.messages.some(
                (message) =>
                  message.role === "user" &&
                  userMessageText(message) === "Inspect the repository and report the result.",
              ),
          ),
        );
        await waitFor(
          () =>
            store
              .getSessionState(created.target.workspaceSessionId)
              .threads.find((thread) => thread.id === handlerThread.id)?.status === "idle",
        );
        const settledSnapshot = surfaceSyncs.findLast(
          (payload) =>
            payload.reason === "prompt.settled" &&
            payload.target.surfacePiSessionId === handlerThread.surfacePiSessionId,
        )?.snapshot;
        expect(settledSnapshot?.streamMessage).toBeNull();
        expect(settledSnapshot?.pendingUserMessage).toBeNull();
        expect(
          settledSnapshot?.messages.filter(
            (message) =>
              message.role === "assistant" &&
              message.content.some(
                (block) =>
                  block.type === "text" && block.text === "I started the delegated objective.",
              ),
          ),
        ).toHaveLength(1);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });

  it("delivers forked handler history as a first-prompt context block only", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Forked Handler" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      appendMessagesToSession(orchestratorManaged.session, [
        userMessage("The accepted direction is to keep the pi runtime seam."),
        assistantMessage("Accepted: no standalone terminal loop."),
        {
          ...assistantMessage("Visible assistant text only.", {
            stopReason: "toolUse",
            toolCalls: [
              {
                type: "toolCall",
                id: "tool-call-not-inherited",
                name: "exec_command",
                arguments: { cmd: "echo should-not-appear-from-tool-call" },
              },
            ],
          }),
        },
        {
          role: "toolResult",
          timestamp: Date.now(),
          toolCallId: "tool-call-not-inherited",
          toolName: "exec_command",
          content: [{ type: "text", text: "tool result should not be inherited" }],
        } as Message,
        {
          role: "user",
          timestamp: Date.now(),
          content: [
            { type: "text", text: "Keep the textual parent fact." },
            { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
          ],
        } as Message,
        userMessage("Please continue this exact design discussion in a handler."),
      ]);

      const sessionPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const handlerPrompts: string[] = [];
      const handlerSessionMessages: Message[][] = [];
      let handlerSystemPrompt = "";
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.actorKind !== "handler") {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Ignored.")]);
          return;
        }
        handlerPrompts.push(promptText);
        handlerSystemPrompt = this.agent.state.systemPrompt ?? "";
        appendMessagesToSession(this, [
          userMessage(promptText),
          assistantMessage("Forked handler started."),
        ]);
        handlerSessionMessages.push([...this.sessionManager.buildSessionContext().messages]);
      });

      try {
        const store = getStructuredSessionStore(catalog);
        const turn = store.startTurn({
          sessionId: created.target.workspaceSessionId,
          surfacePiSessionId: created.target.surfacePiSessionId,
          requestSummary: "Delegate forked history work",
        });
        const orchestratorThread = store.createThread({
          turnId: turn.id,
          surfacePiSessionId: created.target.surfacePiSessionId,
          title: "Delegate forked history work",
          objective: "Open a forked handler thread.",
        });
        const handlerThread = await (
          catalog as unknown as {
            createHandlerThread(input: {
              sessionId: string;
              turnId: string;
              parentThreadId: string;
              parentSurfacePiSessionId: string;
              objective: string;
              historyMode: "forked";
              loadedByCommandId: string;
              agentProfileSettings: null;
            }): Promise<{ id: string; surfacePiSessionId: string }>;
          }
        ).createHandlerThread({
          sessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          parentThreadId: orchestratorThread.id,
          parentSurfacePiSessionId: created.target.surfacePiSessionId,
          objective: "Continue the runtime-seam design discussion and report the decision.",
          historyMode: "forked",
          loadedByCommandId: orchestratorThread.id,
          agentProfileSettings: null,
        });

        await waitFor(() => handlerPrompts.length === 1);
        const handlerPrompt = handlerPrompts[0]!;
        expect(handlerPrompt).toContain(
          "Continue the runtime-seam design discussion and report the decision.",
        );
        expect(handlerPrompt).toContain("<inherited_history>");
        expect(handlerPrompt).toContain("</inherited_history>");
        expect(handlerPrompt).toContain(
          "1. orchestrator user: The accepted direction is to keep the pi runtime seam.",
        );
        expect(handlerPrompt).toContain(
          "2. orchestrator assistant: Accepted: no standalone terminal loop.",
        );
        expect(handlerPrompt).toContain("3. orchestrator assistant: Visible assistant text only.");
        expect(handlerPrompt).toContain("4. orchestrator user: Keep the textual parent fact.");
        expect(handlerPrompt).toContain(
          "5. orchestrator user: Please continue this exact design discussion in a handler.",
        );
        expect(handlerPrompt).not.toContain("tool result should not be inherited");
        expect(handlerPrompt).not.toContain("should-not-appear-from-tool-call");
        expect(handlerPrompt).not.toContain("[image]");
        expect(handlerPrompt).toContain(
          "Use the inherited history only as bounded background for this delegated objective.",
        );
        expect(handlerSystemPrompt).not.toContain("<inherited_history>");
        expect(handlerSystemPrompt).not.toContain(
          "The accepted direction is to keep the pi runtime seam.",
        );
        expect(handlerSessionMessages[0]?.map((message) => message.role)).toEqual([
          "user",
          "assistant",
        ]);
        expect(userMessageText(handlerSessionMessages[0]?.[0])).toBe(handlerPrompt);
        expect(
          store
            .getSessionState(created.target.workspaceSessionId)
            .turns.filter((entry) => entry.threadId === handlerThread.id),
        ).toHaveLength(1);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("does not inherit parent history for isolated handler starts", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Isolated Handler" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      appendMessagesToSession(orchestratorManaged.session, [
        userMessage("This parent transcript must stay out of an isolated handler."),
        assistantMessage("This assistant history must also stay out."),
      ]);

      const sessionPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const handlerPrompts: string[] = [];
      const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        const surface = findManagedSurfaceBySession(catalog, this);
        if (surface?.actorKind !== "handler") {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Ignored.")]);
          return;
        }
        handlerPrompts.push(promptText);
        appendMessagesToSession(this, [
          userMessage(promptText),
          assistantMessage("Isolated handler started."),
        ]);
      });

      try {
        const store = getStructuredSessionStore(catalog);
        const turn = store.startTurn({
          sessionId: created.target.workspaceSessionId,
          surfacePiSessionId: created.target.surfacePiSessionId,
          requestSummary: "Delegate isolated history work",
        });
        const orchestratorThread = store.createThread({
          turnId: turn.id,
          surfacePiSessionId: created.target.surfacePiSessionId,
          title: "Delegate isolated history work",
          objective: "Open an isolated handler thread.",
        });
        await (
          catalog as unknown as {
            createHandlerThread(input: {
              sessionId: string;
              turnId: string;
              parentThreadId: string;
              parentSurfacePiSessionId: string;
              objective: string;
              historyMode: "isolated";
              loadedByCommandId: string;
              agentProfileSettings: null;
            }): Promise<{ id: string; surfacePiSessionId: string }>;
          }
        ).createHandlerThread({
          sessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          parentThreadId: orchestratorThread.id,
          parentSurfacePiSessionId: created.target.surfacePiSessionId,
          objective: "Inspect the repository without inherited parent transcript context.",
          historyMode: "isolated",
          loadedByCommandId: orchestratorThread.id,
          agentProfileSettings: null,
        });

        await waitFor(() => handlerPrompts.length === 1);
        const handlerPrompt = handlerPrompts[0]!;
        expect(handlerPrompt).toBe(
          "Inspect the repository without inherited parent transcript context.",
        );
        expect(handlerPrompt).not.toContain("<inherited_history>");
        expect(handlerPrompt).not.toContain(
          "This parent transcript must stay out of an isolated handler.",
        );
        expect(handlerPrompt).not.toContain("This assistant history must also stay out.");
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("cancels only the targeted surface prompt", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = createWorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Surface Cancel" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Cancel Handler",
        objective: "Keep one handler prompt cancellable without aborting other surfaces.",
      });
      await catalog.openSurface(handler.target);

      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const handlerCancelled = createDeferred<void>();
      const orchestratorPromptGate = createDeferred<void>();
      const handlerPrompt = userMessage("Continue the handler.");
      const orchestratorPrompt = userMessage("Continue the orchestrator.");
      const sessionPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(
          promptText: string,
          options?: {
            expandPromptTemplates?: boolean;
          },
        ): Promise<void>;
        abort(): Promise<void>;
      };
      const handlerPromptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(
        async function (this: PromptableSession) {
          const surface = findManagedSurfaceBySession(catalog, this);
          if (!surface) {
            throw new Error("Prompt executed on an unknown managed surface.");
          }
          if (surface.sessionId === handler.target.surfacePiSessionId) {
            await handlerCancelled.promise;
            return;
          }
          if (surface.sessionId === created.target.surfacePiSessionId) {
            await orchestratorPromptGate.promise;
            appendMessagesToSession(this, [
              orchestratorPrompt,
              assistantMessage("The orchestrator kept running."),
            ]);
            return;
          }
          throw new Error(`Unexpected prompt surface: ${surface.sessionId}`);
        },
      );
      const handlerAbortSpy = spyOn(sessionPrototype, "abort").mockImplementation(
        async function (this: PromptableSession) {
          const surface = findManagedSurfaceBySession(catalog, this);
          if (surface?.sessionId === handler.target.surfacePiSessionId) {
            handlerCancelled.resolve();
            return;
          }
        },
      );

      try {
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: handler.target,
          messages: [handlerPrompt],
          onEvent: () => {},
        });
        await catalog.sendPrompt({
          ...DEFAULTS,
          target: created.target,
          messages: [orchestratorPrompt],
          onEvent: () => {},
        });

        await waitFor(
          () => getManagedSurface(catalog, handler.target.surfacePiSessionId).activePrompt,
        );
        await waitFor(
          () => getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );

        await catalog.sendPrompt({
          ...DEFAULTS,
          target: handler.target,
          messages: [userMessage("Run this after the current handler turn.")],
          onEvent: () => {},
        });
        expect(
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.filter(
              (message) => message.kind === "user_message" && message.status === "queued",
            )
            .map((message) => message.status) ?? [],
        ).toEqual(["queued"]);

        await cancelSurfacePrompt(catalog, handler.target);
        await waitFor(
          () => !getManagedSurface(catalog, handler.target.surfacePiSessionId).activePrompt,
        );

        expect(handlerAbortSpy).toHaveBeenCalledTimes(1);
        expect(handlerPromptSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(
          getStructuredSessionStore(catalog)
            .getSessionState(created.target.workspaceSessionId)
            .queuedMessages?.filter(
              (message) => message.kind === "user_message" && message.status === "queued",
            )
            .map((message) => message.status) ?? [],
        ).toEqual(["queued"]);
        expect(getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt).toBe(
          true,
        );

        orchestratorPromptGate.resolve();
        await waitFor(
          () => !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );
      } finally {
        orchestratorPromptGate.resolve();
        handlerPromptSpy.mockRestore();
        handlerAbortSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });
});
