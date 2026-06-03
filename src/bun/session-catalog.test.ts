import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  DEFAULT_THREAD_HANDLER_PROMPT,
  type AgentProfileSettings,
} from "../shared/agent-settings";
import { buildSystemPrompt } from "./default-system-prompt";
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
import { SmithersRuntimeManager } from "./smithers-runtime/manager";
import type { StructuredSessionStateStore } from "./structured-session-state";

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
  smithersToolSurfaceVersion?: string | null;
  session: PromptableSession;
  activePrompt: boolean;
  abortRequested: boolean;
  recreateOnNextPrompt: boolean;
  retainCount: number;
  promptExecutionRuntime: {
    current: {
      rootThreadId: string | null;
      turnId: string;
    } | null;
  };
};

function createWorkspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), "svvy-sessions-"));
  tempDirs.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const sessionDir = getSvvySessionDir(cwd, agentDir);
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  return { cwd, agentDir, sessionDir };
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

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
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

function getSmithersRuntimeManager(catalog: WorkspaceSessionCatalog): {
  listWorkflows(): unknown[];
  restoreSessionSupervision(
    sessionId: string,
    options?: { emitAttention?: boolean },
  ): Promise<void>;
} {
  return (
    catalog as unknown as {
      smithersRuntimeManager: {
        listWorkflows(): unknown[];
        restoreSessionSupervision(
          sessionId: string,
          options?: { emitAttention?: boolean },
        ): Promise<void>;
      };
    }
  ).smithersRuntimeManager;
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

function appendPromptLibraryMarker(catalog: WorkspaceSessionCatalog, marker: string): void {
  const state = catalog.getPromptLibraryState();
  const block = Object.values(state.instructionBlocks)[0];
  if (!block) {
    throw new Error("Expected default prompt library instruction block.");
  }
  catalog.updatePromptLibraryState({
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
        contextKeys: [];
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
    contextKeys: [],
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

async function seedDurableWorkflowSession(input: {
  cwd: string;
  agentDir: string;
  sessionDir: string;
  workflowStatus?: "running" | "waiting" | "continued" | "completed" | "failed" | "cancelled";
  pendingAttentionSeq?: number | null;
}): Promise<string> {
  const catalog = new WorkspaceSessionCatalog(input.cwd, input.agentDir, input.sessionDir);
  await catalog.restoreDurableWorkflowSupervision();

  try {
    const created = await catalog.createSession({ title: "Durable Workflow" }, DEFAULTS);
    const sessionId = created.target.workspaceSessionId;
    const handler = await createHandlerThreadHarness(catalog, sessionId, {
      title: "Durable Workflow",
      objective: "Supervise durable workflow.",
    });
    const store = getStructuredSessionStore(catalog);
    const workflowCommand = store.createCommand({
      turnId: handler.turnId,
      surfacePiSessionId: handler.surfacePiSessionId,
      threadId: handler.threadId,
      toolName: "smithers_run_workflow",
      executor: "smithers",
      visibility: "surface",
      title: "Run durable workflow",
      summary: "Launch durable workflow.",
    });
    store.startCommand(workflowCommand.id);
    store.recordWorkflow({
      threadId: handler.threadId,
      commandId: workflowCommand.id,
      smithersRunId: "smithers-run-durable-startup",
      workflowName: "durable_startup",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/durable-startup.tsx",
      savedEntryId: "durable_startup",
      status: input.workflowStatus ?? "running",
      smithersStatus: input.workflowStatus === "completed" ? "finished" : "running",
      pendingAttentionSeq: input.pendingAttentionSeq ?? null,
      lastAttentionSeq: null,
      summary: "Durable workflow needs startup supervision.",
    });
    return sessionId;
  } finally {
    await catalog.dispose();
  }
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
  it("writes generated context library entries into workspace-owned files", () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    const entries = catalog.getPromptLibraryGeneratedEntries();
    const webContext = entries.orchestrator.find((entry) => entry.id === "web-context");

    expect(webContext?.sourcePath).toBe(
      ".svvy/generated/context-library/orchestrator/web-context.md",
    );
    expect(webContext?.source).toBe(".svvy/generated/context-library/orchestrator/web-context.md");
    expect(existsSync(join(cwd, webContext!.sourcePath))).toBe(true);
    expect(readFileSync(join(cwd, webContext!.sourcePath), "utf8")).toContain(
      "Loaded always-on prompt context: provider-backed web tools.",
    );
  });

  it("normalizes generated session title casing and punctuation without deleting suffixes", () => {
    expect(normalizeGeneratedTitle('"OAuth Login Session."')).toBe("OAuth login session");
    expect(normalizeGeneratedTitle("Project CI Thread")).toBe("Project CI thread");
    expect(normalizeGeneratedTitle("Greeting Exchange")).toBe("greeting exchange");
    expect(normalizeGeneratedTitle("Session")).toBe("Session");
  });

  it("starts without registering test or POC Smithers workflows", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      expect(getSmithersRuntimeManager(catalog).listWorkflows()).toEqual([]);
    } finally {
      await catalog.dispose();
    }
  });

  it("lists workspace sessions through a sessions array without activeSessionId", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const existing = createPersistedSession(cwd, sessionDir, {
      title: "Existing Session",
      prompt: "Inspect the queue",
      reply: "Queue inspected",
      thinkingLevel: "high",
    });
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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

    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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

  it("restores workflow supervision with pending handler attention delivery when a tracked session opens", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Tracked Session" }, DEFAULTS);
      const sessionId = created.target.workspaceSessionId;
      const handler = await createHandlerThreadHarness(catalog, sessionId, {
        title: "Tracked Workflow",
        objective: "Supervise tracked workflow.",
      });
      const store = getStructuredSessionStore(catalog);
      const workflowCommand = store.createCommand({
        turnId: handler.turnId,
        surfacePiSessionId: handler.surfacePiSessionId,
        threadId: handler.threadId,
        toolName: "smithers_run_workflow",
        executor: "smithers",
        visibility: "surface",
        title: "Run tracked workflow",
        summary: "Launch tracked workflow.",
      });
      store.startCommand(workflowCommand.id);
      store.recordWorkflow({
        threadId: handler.threadId,
        commandId: workflowCommand.id,
        smithersRunId: "smithers-run-tracked-open",
        workflowName: "tracked_open",
        workflowSource: "saved",
        entryPath: ".svvy/workflows/entries/tracked-open.tsx",
        savedEntryId: "tracked_open",
        status: "completed",
        smithersStatus: "finished",
        pendingAttentionSeq: 7,
        lastAttentionSeq: null,
        summary: "Tracked workflow finished and needs handler attention.",
      });
      const restoreCalls: Array<{ sessionId: string; options?: { emitAttention?: boolean } }> = [];
      const manager = getSmithersRuntimeManager(catalog);
      const restoreSpy = spyOn(manager, "restoreSessionSupervision").mockImplementation(
        async (nextSessionId, options) => {
          restoreCalls.push({ sessionId: nextSessionId, options });
        },
      );

      try {
        await catalog.openSession(sessionId);
      } finally {
        restoreSpy.mockRestore();
      }

      expect(restoreCalls).toEqual([{ sessionId, options: undefined }]);
    } finally {
      await catalog.dispose();
    }
  });

  it("restores durable workflow supervision at catalog startup without opening a surface", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const sessionId = await seedDurableWorkflowSession({ cwd, agentDir, sessionDir });
    const restoreCalls: Array<{ sessionId: string; options?: { emitAttention?: boolean } }> = [];
    const restoreSpy = spyOn(
      SmithersRuntimeManager.prototype,
      "restoreSessionSupervision",
    ).mockImplementation(async (nextSessionId, options) => {
      restoreCalls.push({ sessionId: nextSessionId, options });
    });
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      await waitFor(() => restoreCalls.length === 1);

      expect(restoreCalls).toEqual([{ sessionId, options: undefined }]);
      expect(getManagedSurfaces(catalog).size).toBe(0);
    } finally {
      restoreSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("does not restore durable workflow supervision for sessions with no workflow state", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const seedCatalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    await seedCatalog.restoreDurableWorkflowSupervision();
    await seedCatalog.createSession({ title: "No Workflow State" }, DEFAULTS);
    await seedCatalog.dispose();

    const restoreCalls: string[] = [];
    const restoreSpy = spyOn(
      SmithersRuntimeManager.prototype,
      "restoreSessionSupervision",
    ).mockImplementation(async (sessionId) => {
      restoreCalls.push(sessionId);
    });
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      await catalog.restoreDurableWorkflowSupervision();

      expect(restoreCalls).toEqual([]);
    } finally {
      restoreSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("blocks manual rename while top-level title generation is pending", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
      await catalog.updateComposerDraft({
        target: created.target,
        draft: {
          text: "A text written in the composer should survive closing surfaces",
          attachments: [],
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
          assistantMessage("Project CI setup"),
        ]);
      });
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Delegate Project CI context work",
      });
      const orchestratorThread = store.createThread({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        title: "Delegate Project CI context work",
        objective: "Open a handler thread with Project CI context.",
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
              contextKeys: [];
              agentProfileSettings: null;
              loadedByCommandId: string;
            }): Promise<{ id: string; title: string }>;
          }
        ).createHandlerThread({
          sessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          parentThreadId: orchestratorThread.id,
          parentSurfacePiSessionId: created.target.surfacePiSessionId,
          objective: "Configure Project CI checks for this repository.",
          contextKeys: [],
          agentProfileSettings: null,
          loadedByCommandId: orchestratorThread.id,
        });

        expect(handlerThread.title).toBe("Configure Project CI checks for this repository.");
        await waitFor(
          () => store.getThreadDetail(handlerThread.id).thread.title === "Project CI setup",
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
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "APPEND_SYSTEM.md"), "Hidden append text.");
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Prompt Channel" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);

      expect(created.systemPrompt).toBe(buildSystemPrompt("orchestrator"));
      expect(created.resolvedSystemPrompt).toContain(buildSystemPrompt("orchestrator"));
      expect(created.resolvedSystemPrompt).toContain("# Project Context");
      expect(created.resolvedSystemPrompt).toContain("# Project Standards");
      expect(created.resolvedSystemPrompt).not.toContain("Hidden append text.");
      expect(created.externalContextSources).toEqual([
        expect.objectContaining({
          kind: "AGENTS.md",
          path: join(cwd, "AGENTS.md"),
          content: "# Project Standards\n\nUse repo rules.",
          contentHash: expect.any(String),
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

      expect(openedHandler.systemPrompt).toBe(
        `${buildSystemPrompt("handler")}\n\n## Handler Profile Override\n${DEFAULT_THREAD_HANDLER_PROMPT}`,
      );
      expect(openedHandler.resolvedSystemPrompt).toContain(buildSystemPrompt("handler"));
      expect(openedHandler.resolvedSystemPrompt).toContain("# Project Standards");
      expect(openedHandler.resolvedSystemPrompt).not.toContain("Hidden append text.");
      expect(openedHandler.externalContextSources).toEqual(created.externalContextSources);
      expect(handlerManaged.session.agent.state.systemPrompt).toBe(
        openedHandler.resolvedSystemPrompt,
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("marks prompt binding stale when runtime standards change", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const standardsPath = join(cwd, "AGENTS.md");
    writeFileSync(standardsPath, "# Project Standards\n\nInitial.");
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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

  it("does not mark a fresh orchestrator profile prompt binding stale", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
            extensions: [],
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

  it("composes new-session prompts from raw orchestrator profile settings once", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
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
            extensions: [],
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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

  it("keeps a stale surface on its bound prompt until the user queues a context update", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Keep Stale Prompt" }, DEFAULTS);
      const oldPrompt = getManagedSurface(catalog, created.target.surfacePiSessionId).systemPrompt;
      const freshMarker = "Fresh prompt marker for explicit refresh.";
      appendPromptLibraryMarker(catalog, freshMarker);

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
        expect(systemPromptsSeen.at(-1)).toContain(oldPrompt);
        expect(systemPromptsSeen.at(-1)).not.toContain(freshMarker);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("emits a stale prompt binding update when the context library changes", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Context Sync" }, DEFAULTS);
      expect(created.promptBinding?.stale).toBe(false);

      appendPromptLibraryMarker(catalog, "Fresh prompt marker for live sync.");

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
        catalog.getPromptLibraryState().revision,
      );
    } finally {
      await catalog.dispose();
    }
  });

  it("clears the live stale prompt binding when context returns to the bound prompt", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Context Revert" }, DEFAULTS);
      const originalPromptState = catalog.getPromptLibraryState();
      appendPromptLibraryMarker(catalog, "Temporary prompt marker for live revert.");

      await waitFor(() =>
        surfaceSyncs.some(
          (payload) =>
            payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
            payload.snapshot?.promptBinding?.stale === true,
        ),
      );

      catalog.updatePromptLibraryState(originalPromptState);

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
        catalog.getPromptLibraryState().revision,
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Idle Prompt Refresh" }, DEFAULTS);
      const freshMarker = "Fresh prompt marker for idle refresh.";
      appendPromptLibraryMarker(catalog, freshMarker);
      const stale = await catalog.openSurface(created.target);
      expect(stale.promptBinding?.stale).toBe(true);

      const refreshed = await catalog.queuePromptRefresh({ target: created.target });

      expect(refreshed.snapshot?.queuedMessages).toEqual([]);
      expect(
        surfaceSyncs.some(
          (payload) =>
            payload.reason === "surface.updated" &&
            payload.target.surfacePiSessionId === created.target.surfacePiSessionId &&
            payload.snapshot?.queuedMessages.some((message) => message.kind === "prompt_refresh"),
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Queued Prompt Refresh" }, DEFAULTS);
      const freshMarker = "Fresh prompt marker for queued refresh.";
      appendPromptLibraryMarker(catalog, freshMarker);

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

        const refresh = await catalog.queuePromptRefresh({ target: created.target });
        expect(refresh.snapshot?.queuedMessages.map((message) => message.kind)).toEqual([
          "prompt_refresh",
        ]);

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
        ).toEqual(["prompt_refresh", "user_message", "user_message"]);

        firstPromptGate.resolve();
        await waitFor(() => orchestratorPromptCount === 2);
        await waitFor(
          () => !getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );

        expect(systemPromptsSeen[0]).not.toContain(freshMarker);
        expect(systemPromptsSeen[1]).toContain(freshMarker);
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Raw Prompt" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const promptPrototype = Object.getPrototypeOf(orchestratorManaged.session) as {
        prompt(promptText: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
      };
      const sentPrompts: string[] = [];
      const promptSpy = spyOn(promptPrototype, "prompt").mockImplementation(async function (
        this: PromptableSession,
        promptText: string,
      ) {
        if (promptText.startsWith("First user message:")) {
          appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Raw prompt")]);
          return;
        }

        sentPrompts.push(promptText);
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
        expectNoPromptReconstruction(sentPrompt);
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("sends handler follow-up prompts as raw latest user text only", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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
        appendMessagesToSession(this, [userMessage(promptText), assistantMessage("Handled.")]);
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
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("exposes thread state tools on the intended actor surfaces", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Tool Surface" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);
      const orchestratorTools = getActiveToolNames(orchestratorManaged);
      expect(orchestratorTools).toEqual(
        expect.arrayContaining([
          "thread_list",
          "thread_handoffs",
          "thread_start",
          "thread_resume",
          "wait",
        ]),
      );
      expect(orchestratorTools).not.toContain("thread_current");
      expect(orchestratorTools).not.toContain("thread_handoff");
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
          "thread_list",
          "thread_handoffs",
          "thread_handoff",
          "request_context",
          "wait",
          "smithers_list_workflows",
          "smithers_run_workflow",
        ]),
      );
      expect(handlerTools).not.toContain("thread_start");
      expect(handlerTools).not.toContain("thread_resume");
    } finally {
      await catalog.dispose();
    }
  });

  it("preloads optional prompt context into handler surface prompts", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Context Prompt Channel" }, DEFAULTS);
      const store = getStructuredSessionStore(catalog);
      const turn = store.startTurn({
        sessionId: created.target.workspaceSessionId,
        surfacePiSessionId: created.target.surfacePiSessionId,
        requestSummary: "Delegate Project CI context work",
      });
      const orchestratorThread = store.createThread({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        title: "Delegate Project CI context work",
        objective: "Open a handler thread with Project CI context.",
      });
      const command = store.createCommand({
        turnId: turn.id,
        surfacePiSessionId: created.target.surfacePiSessionId,
        threadId: orchestratorThread.id,
        toolName: "thread_start",
        executor: "orchestrator",
        visibility: "surface",
        title: "Start Project CI handler",
        summary: "Start a handler thread with Project CI context.",
      });
      const handlerThread = await (
        catalog as unknown as {
          createHandlerThread(input: {
            sessionId: string;
            turnId: string;
            parentThreadId: string;
            parentSurfacePiSessionId: string;
            objective: string;
            contextKeys: ["ci"];
            loadedByCommandId: string;
          }): Promise<{ id: string; surfacePiSessionId: string }>;
        }
      ).createHandlerThread({
        sessionId: created.target.workspaceSessionId,
        turnId: turn.id,
        parentThreadId: orchestratorThread.id,
        parentSurfacePiSessionId: created.target.surfacePiSessionId,
        objective: "Create or update Project CI when requested.",
        contextKeys: ["ci"],
        loadedByCommandId: command.id,
      });

      const openedHandler = await catalog.openSurface(
        createThreadTarget(
          created.target.workspaceSessionId,
          handlerThread.surfacePiSessionId,
          handlerThread.id,
        ),
      );

      expect(openedHandler.systemPrompt).toBe(
        `${buildSystemPrompt("handler", {
          loadedContextKeys: ["ci"],
        })}\n\n## Handler Profile Override\n${DEFAULT_THREAD_HANDLER_PROMPT}`,
      );
      expect(openedHandler.resolvedSystemPrompt).toContain(
        "Loaded optional prompt context: Project CI.",
      );
      expect(openedHandler.resolvedSystemPrompt).toContain('productKind = "project-ci"');
      expect(store.getThreadDetail(handlerThread.id).thread.loadedContextKeys).toEqual(["ci"]);
    } finally {
      await catalog.dispose();
    }
  });

  it("opens multiple surfaces simultaneously and only disposes them after explicit closes", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
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

  it("routes active steer requests through the durable surface queue", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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

  it("records handler handoff durably while orchestrator reconciliation is queued", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Blocked Handoff" }, DEFAULTS);
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
          requestSummary: "Delegate durable handoff work",
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
          surfacePiSessionId: "handler-blocked-handoff",
          title: "Handler",
          objective: "Finish the durable handoff.",
        });
        const command = store.createCommand({
          turnId: turn.id,
          surfacePiSessionId: handlerThread.surfacePiSessionId,
          threadId: handlerThread.id,
          toolName: "thread_handoff",
          executor: "handler",
          visibility: "surface",
          title: "Hand off",
          summary: "Handler finished while orchestrator was active.",
        });
        store.startCommand(command.id);

        const accepted = await (
          catalog as unknown as {
            awaitThreadHandoffAcceptance(input: {
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
              title: string;
              summary: string;
              body: string;
              kind: "change";
            }): Promise<{ episodeId: string }>;
          }
        ).awaitThreadHandoffAcceptance.call(catalog, {
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
          title: "Durable handoff",
          summary: "Handler finished while orchestrator was active.",
          body: "The handler completed its work and is asking the orchestrator to reconcile.",
          kind: "change",
        });

        await waitFor(() =>
          store
            .listQueuedSurfaceMessages({
              surfacePiSessionId: created.target.surfacePiSessionId,
            })
            .some((message) => message.kind === "handler_handoff"),
        );
        const queued = store
          .listQueuedSurfaceMessages({ surfacePiSessionId: created.target.surfacePiSessionId })
          .find((message) => message.kind === "handler_handoff");
        expect(queued).toBeDefined();
        if (!queued) return;
        expect(store.getSessionState(created.target.workspaceSessionId).episodes).toEqual([
          expect.objectContaining({
            id: accepted.episodeId,
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
            id: accepted.episodeId,
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

  it("resumes a completed handler thread through the durable surface queue", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Resume Handler" }, DEFAULTS);
      const handler = await createHandlerThreadHarness(catalog, created.target.workspaceSessionId, {
        title: "Resume Target",
        objective: "Own follow-up investigation context.",
      });
      const store = getStructuredSessionStore(catalog);
      store.updateThread({ threadId: handler.threadId, status: "completed" });

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
          toolName: "thread_resume",
          executor: "orchestrator",
          visibility: "surface",
          title: "Resume handler",
          summary: "Ask the same handler for follow-up evidence.",
        });
        store.startCommand(command.id);

        const resumed = await (
          catalog as unknown as {
            resumeHandlerThread(input: {
              sessionId: string;
              turnId: string;
              threadId: string;
              message: string;
              resumedByCommandId: string;
            }): Promise<{ queuedMessageId: string }>;
          }
        ).resumeHandlerThread.call(catalog, {
          sessionId: created.target.workspaceSessionId,
          turnId: turn.id,
          threadId: handler.threadId,
          message: "Please inspect the previous handoff and add one missing detail.",
          resumedByCommandId: command.id,
        });

        expect(resumed.queuedMessageId).toBeTruthy();
        expect(
          store
            .getSessionState(created.target.workspaceSessionId)
            .threads.find((thread) => thread.id === handler.threadId),
        ).toMatchObject({ status: "running-handler" });
        await waitFor(() => handlerPrompts.length === 1);
        expect(handlerPrompts[0]).toBe(
          "Please inspect the previous handoff and add one missing detail.",
        );
      } finally {
        promptSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("accepts a queued handler handoff as the next orchestrator input", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Accepted Handoff" }, DEFAULTS);
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
          requestSummary: "Delegate accepted handoff work",
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
          surfacePiSessionId: "handler-accepted-handoff",
          title: "Handler",
          objective: "Finish the accepted handoff.",
        });
        const command = store.createCommand({
          turnId: turn.id,
          surfacePiSessionId: handlerThread.surfacePiSessionId,
          threadId: handlerThread.id,
          toolName: "thread_handoff",
          executor: "handler",
          visibility: "surface",
          title: "Hand off",
          summary: "Handler finished and can be accepted.",
        });
        store.startCommand(command.id);

        const accepted = await (
          catalog as unknown as {
            awaitThreadHandoffAcceptance(input: {
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
              title: string;
              summary: string;
              body: string;
              kind: "change";
            }): Promise<{ episodeId: string }>;
          }
        ).awaitThreadHandoffAcceptance.call(catalog, {
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
          title: "Accepted handoff",
          summary: "Handler finished and can be accepted.",
          body: "The handler completed its work and is asking the orchestrator to reconcile.",
          kind: "change",
        });

        await waitFor(() => orchestratorPrompts.length === 1);
        expect(orchestratorPrompts[0]).toContain(
          "System event: A handler thread emitted a durable handoff.",
        );
        expect(orchestratorPrompts[0]).toContain("Handler finished and can be accepted.");
        const snapshot = store.getSessionState(created.target.workspaceSessionId);
        expect(snapshot.episodes).toEqual([
          expect.objectContaining({
            id: accepted.episodeId,
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
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

  it("updates orchestrator profile defaults from composer changes only when enabled", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const syncedProfile: AgentProfileSettings = {
      id: "composer-synced",
      kind: "orchestrator",
      name: "Composer synced",
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "medium",
      systemPrompt: DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
      extensions: [],
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
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
              contextKeys: [];
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
          contextKeys: [],
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

  it("cancels only the targeted surface prompt", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

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

  it("routes workflow attention to the owning handler surface when multiple handlers are open", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const surfaceSyncs: SurfaceSyncMessage[] = [];
    catalog.setSurfaceSyncListener((payload) => {
      surfaceSyncs.push(payload);
    });

    try {
      const created = await catalog.createSession({ title: "Workflow Attention" }, DEFAULTS);
      const handlerA = await createHandlerThreadHarness(
        catalog,
        created.target.workspaceSessionId,
        {
          title: "Workflow A",
          objective: "Own workflow A attention.",
        },
      );
      const handlerB = await createHandlerThreadHarness(
        catalog,
        created.target.workspaceSessionId,
        {
          title: "Workflow B",
          objective: "Own workflow B attention.",
        },
      );
      await catalog.openSurface(handlerA.target);
      await catalog.openSurface(handlerB.target);

      const store = getStructuredSessionStore(catalog);
      const workflowCommand = store.createCommand({
        turnId: handlerA.turnId,
        surfacePiSessionId: handlerA.surfacePiSessionId,
        threadId: handlerA.threadId,
        toolName: "smithers_run_workflow",
        executor: "smithers",
        visibility: "surface",
        title: "Run workflow A",
        summary: "Launch workflow A.",
      });
      store.startCommand(workflowCommand.id);
      const workflow = store.recordWorkflow({
        threadId: handlerA.threadId,
        commandId: workflowCommand.id,
        smithersRunId: "smithers-run-workflow-a",
        workflowName: "workflow_a",
        workflowSource: "saved",
        entryPath: ".svvy/workflows/entries/workflow-a.tsx",
        savedEntryId: "workflow_a",
        status: "completed",
        smithersStatus: "finished",
        pendingAttentionSeq: 42,
        lastAttentionSeq: null,
        summary: "workflow_a finished and still needs handler attention.",
      });
      store.updateThread({
        threadId: handlerA.threadId,
        status: "running-handler",
        wait: null,
      });

      const handlerAManaged = getManagedSurface(catalog, handlerA.surfacePiSessionId);
      const handlerBManaged = getManagedSurface(catalog, handlerB.surfacePiSessionId);
      const handlerAPrompts: string[] = [];
      const handlerAPromptSpy = spyOn(handlerAManaged.session, "prompt").mockImplementation(
        async function (this: PromptableSession, promptText: string) {
          handlerAPrompts.push(promptText);
          appendMessagesToSession(this, [
            userMessage(
              "System event: A supervised Smithers workflow now requires handler attention.",
            ),
            assistantMessage("Handler A reconciled workflow attention."),
          ]);
        },
      );
      const handlerBPromptSpy = spyOn(handlerBManaged.session, "prompt").mockImplementation(
        async function () {
          throw new Error("Workflow attention routed to the wrong handler surface.");
        },
      );

      try {
        const delivered = await (
          catalog as unknown as {
            resumeHandlerAfterWorkflowAttention(
              input: {
                sessionId: string;
                threadId: string;
                workflowRunId: string;
                smithersRunId: string;
                workflowId: string;
                summary: string;
                reason: string;
              },
              systemPrompt: string,
            ): Promise<boolean>;
          }
        ).resumeHandlerAfterWorkflowAttention(
          {
            sessionId: created.target.workspaceSessionId,
            threadId: handlerA.threadId,
            workflowRunId: workflow.id,
            smithersRunId: "smithers-run-workflow-a",
            workflowId: "workflow_a",
            summary: "workflow_a finished and still needs handler attention.",
            reason: "The workflow completed and still needs handler reconciliation.",
          },
          buildSystemPrompt("handler"),
        );

        expect(delivered).toBe(true);
        await waitFor(() => handlerAPrompts.length === 1);
        expect(handlerAPrompts).toHaveLength(1);
        expect(handlerAPrompts[0]).toBe(
          [
            "System event: A supervised Smithers workflow now requires handler attention.",
            "Use thread_current for current handler state and active workflow run ids, then inspect workflow details with smithers_* tools and decide the next handler action.",
          ].join("\n"),
        );
        expect(handlerAPrompts[0]).not.toContain("smithers-run-workflow-a");
        expect(handlerBPromptSpy).not.toHaveBeenCalled();

        const attentionEvents = surfaceSyncs.filter(
          (payload) =>
            payload.reason === "background.started" || payload.reason === "prompt.settled",
        );
        expect(attentionEvents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              reason: "background.started",
              target: handlerA.target,
            }),
            expect.objectContaining({
              reason: "prompt.settled",
              target: handlerA.target,
            }),
          ]),
        );
        expect(
          attentionEvents.some((payload) => payload.target.threadId === handlerB.threadId),
        ).toBe(false);

        const snapshotA =
          (await catalog.listOpenSurfaceSnapshots()).find(
            (snapshot) => snapshot.target.surfacePiSessionId === handlerA.surfacePiSessionId,
          ) ?? null;
        const snapshotB =
          (await catalog.listOpenSurfaceSnapshots()).find(
            (snapshot) => snapshot.target.surfacePiSessionId === handlerB.surfacePiSessionId,
          ) ?? null;

        expect(
          hasAssistantReply(snapshotA?.messages ?? [], "Handler A reconciled workflow attention."),
        ).toBe(true);
        expect(snapshotB?.messages).toEqual([]);
      } finally {
        handlerAPromptSpy.mockRestore();
        handlerBPromptSpy.mockRestore();
      }
    } finally {
      catalog.setSurfaceSyncListener(null);
      await catalog.dispose();
    }
  });
});
