import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as PiCodingAgent from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, StopReason, ToolCall } from "@mariozechner/pi-ai";
import type { PromptTarget, SessionSyncMessage } from "../mainview/chat-rpc";
import {
  getSvvySessionDir,
  WorkspaceSessionCatalog,
  resolveRestoredSessionDefaults,
  type SessionDefaults,
} from "./session-catalog";
import type {
  StructuredSessionSnapshot,
  StructuredSessionStateStore,
} from "./structured-session-state";

const tempDirs: string[] = [];

const DEFAULTS: SessionDefaults = {
  provider: "openai",
  model: "gpt-4o",
  thinkingLevel: "medium",
  systemPrompt: "You are svvy.",
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

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
    content,
  };
}

type PromptableSession = {
  agent: {
    appendMessage(message: Message): void;
    state: {
      messages: Message[];
      systemPrompt?: string;
    };
  };
  sessionManager: {
    appendMessage(message: Message): void;
  };
};

type ManagedSessionHandle = {
  session: PromptableSession;
  promptSyncCursor: {
    messageCount: number;
  };
};

function getManagedSessionHandle(catalog: WorkspaceSessionCatalog): ManagedSessionHandle {
  return (catalog as unknown as { activeSession: ManagedSessionHandle }).activeSession;
}

function appendMessagesToSession(session: PromptableSession, messages: readonly Message[]): void {
  for (const message of messages) {
    session.sessionManager.appendMessage(message);
    session.agent.appendMessage(message);
  }
}

function createOrchestratorTarget(workspaceSessionId: string): PromptTarget {
  return {
    workspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId: workspaceSessionId,
  };
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

  throw new Error("Timed out waiting for prompt sync.");
}

function getStructuredSessionState(
  catalog: WorkspaceSessionCatalog,
  sessionId: string,
): StructuredSessionSnapshot {
  const store = (catalog as unknown as { structuredSessionStore: StructuredSessionStateStore })
    .structuredSessionStore;
  return store.getSessionState(sessionId);
}

function getStructuredSessionStore(catalog: WorkspaceSessionCatalog): StructuredSessionStateStore {
  return (catalog as unknown as { structuredSessionStore: StructuredSessionStateStore })
    .structuredSessionStore;
}

function seedCommandRollupSession(
  catalog: WorkspaceSessionCatalog,
  sessionId: string,
  title: string,
): void {
  const store = getStructuredSessionStore(catalog);
  const timestamp = new Date().toISOString();
  store.upsertPiSession({
    sessionId,
    title,
    provider: DEFAULTS.provider,
    model: DEFAULTS.model,
    reasoningEffort: DEFAULTS.thinkingLevel,
    messageCount: 2,
    status: "idle",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const turn = store.startTurn({
    sessionId,
    surfacePiSessionId: sessionId,
    requestSummary: `Inspect ${title}`,
  });
  const thread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: sessionId,
    title: `Inspect ${title}`,
    objective: `Inspect ${title} command rollups.`,
  });
  const command = store.createCommand({
    turnId: turn.id,
    threadId: thread.id,
    toolName: "execute_typescript",
    executor: "execute_typescript",
    visibility: "summary",
    title: `Inspect ${title}`,
    summary: `Read the structured session for ${title}.`,
  });
  const childCommand = store.createCommand({
    turnId: turn.id,
    threadId: thread.id,
    parentCommandId: command.id,
    toolName: "runtime",
    executor: "runtime",
    visibility: "trace",
    title: `Inspect ${title} child`,
    summary: `Child command for ${title}.`,
  });

  store.finishCommand({
    commandId: childCommand.id,
    status: "succeeded",
    summary: `Child command for ${title} finished.`,
  });
  store.finishCommand({
    commandId: command.id,
    status: "succeeded",
    summary: `Read the structured session for ${title}.`,
  });
  store.updateThread({
    threadId: thread.id,
    status: "completed",
  });
  store.finishTurn({
    turnId: turn.id,
    status: "completed",
  });
}

function installPromptSpy(
  catalog: WorkspaceSessionCatalog,
  responses: Array<{ user: Message; assistant: Message; error?: Error }>,
) {
  const promptTexts: string[] = [];
  const sessionPrototype = Object.getPrototypeOf(getManagedSessionHandle(catalog).session) as {
    prompt: (promptText: string) => Promise<void>;
  };
  const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
    this: PromptableSession,
    promptText: string,
  ) {
    const response = responses[promptTexts.length];
    if (!response) {
      throw new Error("Unexpected prompt invocation.");
    }

    promptTexts.push(promptText);
    appendMessagesToSession(this, [response.user, response.assistant]);
    if (response.error) {
      throw response.error;
    }
  });

  return { promptTexts, promptSpy };
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

describe("WorkspaceSessionCatalog", () => {
  it("registers execute_typescript and native control tools as custom tools", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const createAgentSessionSpy = spyOn(PiCodingAgent, "createAgentSession");
    let catalog: WorkspaceSessionCatalog | null = null;

    try {
      catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
      await catalog.createSession({ title: "Tool Surface" }, DEFAULTS);

      const [options] = createAgentSessionSpy.mock.calls[0] ?? [];
      expect(options?.tools).toEqual([]);
      expect(options?.customTools?.map((tool) => tool.name).toSorted()).toEqual(
        [
          "execute_typescript",
          "thread.handoff",
          "thread.start",
          "workflow.start",
          "workflow.resume",
          "wait",
        ].toSorted(),
      );
    } finally {
      createAgentSessionSpy.mockRestore();
      await catalog?.dispose();
    }
  });

  it("loads svvy's prompt into pi's real systemPrompt channel for the active session", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Prompt Channel" }, DEFAULTS);
      const resolvedSystemPrompt = created.resolvedSystemPrompt;
      const managedSession = getManagedSessionHandle(catalog);

      expect(created.systemPrompt).toBe(DEFAULTS.systemPrompt);
      expect(resolvedSystemPrompt).toContain(DEFAULTS.systemPrompt);
      expect(resolvedSystemPrompt).toContain("Current date:");
      expect(resolvedSystemPrompt).toContain(`Current working directory: ${cwd}`);
      expect(resolvedSystemPrompt).not.toContain(
        "You are an expert coding assistant operating inside pi",
      );
      expect(managedSession.session.agent.state.systemPrompt).toBe(resolvedSystemPrompt);
    } finally {
      await catalog.dispose();
    }
  });

  it("lists persisted sessions sorted by recency", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const first = createPersistedSession(cwd, sessionDir, {
      title: "Investigate parser",
      prompt: "Investigate parser regression",
      reply: "Parser root cause found",
      thinkingLevel: "high",
    });
    const second = createPersistedSession(cwd, sessionDir, {
      prompt: "Write a regression test",
      reply: "Regression test added",
    });

    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const sessions = await catalog.listSessions();

    expect(sessions.sessions).toHaveLength(2);
    expect(sessions.sessions.some((session) => session.id === first.id)).toBe(true);
    expect(sessions.sessions.some((session) => session.id === second.id)).toBe(true);
    expect(sessions.sessions.find((session) => session.id === first.id)?.title).toBe(
      "Investigate parser",
    );
  });

  it("preserves structured command rollups on session summaries", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const inactive = createPersistedSession(cwd, sessionDir, {
      title: "Inactive rollups",
      prompt: "Investigate parser regression",
      reply: "Parser root cause found",
    });

    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const active = await catalog.createSession({ title: "Active rollups" }, DEFAULTS);

    seedCommandRollupSession(catalog, inactive.id, "Inactive rollups");
    seedCommandRollupSession(catalog, active.session.id, "Active rollups");

    const sessions = await catalog.listSessions();
    const inactiveSummary = sessions.sessions.find((session) => session.id === inactive.id);
    const activeSummary = sessions.sessions.find((session) => session.id === active.session.id);

    expect(inactiveSummary?.commandRollups).toHaveLength(1);
    expect(activeSummary?.commandRollups).toHaveLength(1);
    expect(inactiveSummary?.commandRollups?.[0]).toMatchObject({
      commandId: expect.any(String),
      threadId: expect.any(String),
      toolName: "execute_typescript",
      visibility: "summary",
      status: "succeeded",
      title: "Inspect Inactive rollups",
      summary: "Read the structured session for Inactive rollups.",
      childCount: 1,
      summaryChildCount: 0,
      traceChildCount: 1,
      summaryChildren: [],
    });
    expect(activeSummary?.commandRollups?.[0]).toMatchObject({
      commandId: expect.any(String),
      threadId: expect.any(String),
      toolName: "execute_typescript",
      visibility: "summary",
      status: "succeeded",
      title: "Inspect Active rollups",
      summary: "Read the structured session for Active rollups.",
      childCount: 1,
      summaryChildCount: 0,
      traceChildCount: 1,
      summaryChildren: [],
    });
  });

  it("returns command inspector detail for active and reopened sessions", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const active = await catalog.createSession({ title: "Inspector Session" }, DEFAULTS);

    const store = getStructuredSessionStore(catalog);
    const timestamp = new Date().toISOString();
    store.upsertPiSession({
      sessionId: active.session.id,
      title: "Inspector Session",
      provider: DEFAULTS.provider,
      model: DEFAULTS.model,
      reasoningEffort: DEFAULTS.thinkingLevel,
      messageCount: 2,
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const turn = store.startTurn({
      sessionId: active.session.id,
      surfacePiSessionId: active.session.id,
      requestSummary: "Inspect execute_typescript rollups",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: active.session.id,
      title: "Inspect execute_typescript rollups",
      objective: "Inspect execute_typescript rollups",
    });
    const parentCommand = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "orchestrator",
      visibility: "summary",
      title: "Inspect execute_typescript",
      summary: "Read docs and created 1 artifact.",
      facts: {
        repoReads: 1,
        artifactsCreated: 1,
      },
    });
    const traceChild = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      parentCommandId: parentCommand.id,
      toolName: "repo.readFile",
      executor: "execute_typescript",
      visibility: "trace",
      title: "Read docs/prd.md",
      summary: "Loaded docs/prd.md.",
      facts: {
        path: "docs/prd.md",
        bytesRead: 10,
      },
    });
    const summaryChild = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      parentCommandId: parentCommand.id,
      toolName: "artifact.writeText",
      executor: "execute_typescript",
      visibility: "summary",
      title: "Create summary.md",
      summary: "Created summary.md.",
      facts: {
        artifactId: "artifact-child",
        name: "summary.md",
      },
    });

    store.finishCommand({
      commandId: traceChild.id,
      status: "succeeded",
      summary: "Loaded docs/prd.md.",
      facts: {
        path: "docs/prd.md",
        bytesRead: 10,
      },
    });
    store.finishCommand({
      commandId: summaryChild.id,
      status: "succeeded",
      summary: "Created summary.md.",
      facts: {
        artifactId: "artifact-child",
        name: "summary.md",
      },
    });
    store.createArtifact({
      threadId: thread.id,
      sourceCommandId: parentCommand.id,
      kind: "text",
      name: "execute-typescript.ts",
      content: 'return "ok";',
    });
    store.createArtifact({
      threadId: thread.id,
      sourceCommandId: summaryChild.id,
      kind: "file",
      name: "summary.md",
      content: "summary",
    });
    store.finishCommand({
      commandId: parentCommand.id,
      status: "succeeded",
      summary: "Read docs and created 1 artifact.",
      facts: {
        repoReads: 1,
        artifactsCreated: 1,
      },
    });
    store.updateThread({
      threadId: thread.id,
      status: "completed",
    });
    store.finishTurn({
      turnId: turn.id,
      status: "completed",
    });

    const activeInspector = await catalog.getCommandInspector({
      sessionId: active.session.id,
      commandId: parentCommand.id,
    });
    expect(activeInspector).toMatchObject({
      commandId: parentCommand.id,
      title: "Inspect execute_typescript",
      summaryChildCount: 1,
      traceChildCount: 1,
      summaryChildren: [
        expect.objectContaining({
          commandId: summaryChild.id,
          toolName: "artifact.writeText",
        }),
      ],
      traceChildren: [
        expect.objectContaining({
          commandId: traceChild.id,
          toolName: "repo.readFile",
        }),
      ],
    });

    await catalog.dispose();

    const reopenedCatalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    try {
      const reopenedInspector = await reopenedCatalog.getCommandInspector({
        sessionId: active.session.id,
        commandId: parentCommand.id,
      });
      expect(reopenedInspector).toMatchObject({
        commandId: parentCommand.id,
        summaryChildCount: 1,
        traceChildCount: 1,
        artifacts: [
          expect.objectContaining({
            name: "execute-typescript.ts",
          }),
        ],
        summaryChildren: [
          expect.objectContaining({
            commandId: summaryChild.id,
            artifacts: [
              expect.objectContaining({
                name: "summary.md",
              }),
            ],
          }),
        ],
      });
    } finally {
      await reopenedCatalog.dispose();
    }
  });

  it("lists inactive sessions from metadata only while keeping the active session rich", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const inactive = createPersistedSession(cwd, sessionDir, {
      title: "Inactive",
      prompt: "Investigate parser regression",
      reply: "Parser root cause found",
    });

    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const active = await catalog.createSession({ title: "Active Session" }, DEFAULTS);

    const openSpy = spyOn(SessionManager, "open");
    const buildContextSpy = spyOn(SessionManager.prototype, "buildSessionContext");

    try {
      const sessions = await catalog.listSessions();

      expect(openSpy).not.toHaveBeenCalled();
      expect(buildContextSpy).not.toHaveBeenCalled();
      expect(sessions.activeSessionId).toBe(active.session.id);
      expect(sessions.sessions).toHaveLength(2);
      expect(sessions.sessions.some((session) => session.id === active.session.id)).toBe(true);
      expect(sessions.sessions.some((session) => session.id === inactive.id)).toBe(true);

      const activeSummary = sessions.sessions.find((session) => session.id === active.session.id);
      expect(activeSummary).toMatchObject({
        id: active.session.id,
        title: "Active Session",
        status: "idle",
        messageCount: 0,
        provider: DEFAULTS.provider,
        modelId: DEFAULTS.model,
        thinkingLevel: DEFAULTS.thinkingLevel,
      });

      const inactiveSummary = sessions.sessions.find((session) => session.id === inactive.id);
      expect(inactiveSummary).toMatchObject({
        id: inactive.id,
        title: "Inactive",
        preview: "Investigate parser regression",
        status: "idle",
        messageCount: 2,
        sessionFile: inactive.path,
      });
      expect(inactiveSummary?.provider).toBeUndefined();
      expect(inactiveSummary?.modelId).toBeUndefined();
      expect(inactiveSummary?.thinkingLevel).toBeUndefined();
    } finally {
      openSpy.mockRestore();
      buildContextSpy.mockRestore();
    }
  });

  it("does not infer inactive session status from transcript files", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const inactive = createPersistedSession(cwd, sessionDir, {
      title: "Failed Session",
      prompt: "Investigate parser regression",
      reply: "Parser root cause failed.",
      replyStopReason: "error",
    });

    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    await catalog.createSession({ title: "Active Session" }, DEFAULTS);

    const openSpy = spyOn(SessionManager, "open");
    const buildContextSpy = spyOn(SessionManager.prototype, "buildSessionContext");

    try {
      const sessions = await catalog.listSessions();
      const inactiveSummary = sessions.sessions.find((session) => session.id === inactive.id);

      expect(openSpy).not.toHaveBeenCalled();
      expect(buildContextSpy).not.toHaveBeenCalled();
      expect(inactiveSummary).toMatchObject({
        id: inactive.id,
        title: "Failed Session",
        status: "idle",
      });
    } finally {
      openSpy.mockRestore();
      buildContextSpy.mockRestore();
    }
  });

  it("restores provider, model, and thinking level from persisted metadata without buildSessionContext", async () => {
    const { cwd, sessionDir } = createWorkspaceFixture();
    const sessionManager = SessionManager.create(cwd, sessionDir);
    sessionManager.appendSessionInfo("Metadata Restore");
    sessionManager.appendThinkingLevelChange("high");
    sessionManager.appendMessage(userMessage("Inspect the queue"));
    sessionManager.appendMessage(
      assistantMessage("Queue inspected", {
        provider: "openai",
        model: "gpt-4o",
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

  it("reuses the synced boundary for an appended user turn", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Prompted" }, DEFAULTS);

    const firstUser = userMessage("Explain the parser");
    const firstAssistant = assistantMessage("Parser cursor synced.");
    const secondUser = userMessage("What changed?");
    const secondAssistant = assistantMessage("Only the delta is sent.");
    const { promptTexts, promptSpy } = installPromptSpy(catalog, [
      { user: firstUser, assistant: firstAssistant },
      { user: secondUser, assistant: secondAssistant },
    ]);

    try {
      const activeSession = getManagedSessionHandle(catalog);

      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [firstUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 1 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
      );
      expect(promptTexts[0]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[0]).toContain("User:\nExplain the parser");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);

      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [firstUser, firstAssistant, secondUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 2 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 4,
      );
      expect(promptTexts[1]).toBe("What changed?");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);
    } finally {
      promptSpy.mockRestore();
    }
  });

  it("emits an explicit session sync payload when a prompt settles", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Prompt Sync" }, DEFAULTS);

    const syncs: SessionSyncMessage[] = [];
    catalog.setSessionSyncListener((payload) => {
      syncs.push(payload);
    });

    const prompt = userMessage("Explain the parser");
    const reply = assistantMessage("Parser cursor synced.");
    const { promptTexts, promptSpy } = installPromptSpy(catalog, [
      { user: prompt, assistant: reply },
    ]);

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [prompt],
        onEvent: () => {},
      });

      await waitFor(() => promptTexts.length === 1 && syncs.length === 1);

      expect(syncs[0]).toMatchObject({
        reason: "prompt.settled",
        activeSession: {
          target: {
            workspaceSessionId: created.session.id,
            surface: "orchestrator",
            surfacePiSessionId: created.session.id,
          },
          session: {
            title: "Prompt Sync",
            preview: "Parser cursor synced.",
            status: "idle",
          },
        },
      });
      expect(
        syncs[0]?.activeSession.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.content[0]?.type === "text" &&
            message.content[0].text === "Parser cursor synced.",
        ),
      ).toBe(true);
      expect(syncs[0]?.sessions.find((session) => session.title === "Prompt Sync")).toMatchObject({
        preview: "Parser cursor synced.",
        status: "idle",
      });
    } finally {
      promptSpy.mockRestore();
      catalog.setSessionSyncListener(null);
    }
  });

  it("recreates the session when earlier history diverges", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Prompted" }, DEFAULTS);

    const originalUser = userMessage("Explain the parser");
    const firstAssistant = assistantMessage("Parser cursor synced.");
    const divergentUser = userMessage("Explain the parser, but differently");
    const secondUser = userMessage("What changed?");
    const secondAssistant = assistantMessage("The transcript was rebuilt.");
    const { promptTexts, promptSpy } = installPromptSpy(catalog, [
      { user: originalUser, assistant: firstAssistant },
      { user: secondUser, assistant: secondAssistant },
    ]);

    try {
      const activeSession = getManagedSessionHandle(catalog);

      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [originalUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 1 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
      );
      expect(promptTexts[0]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[0]).toContain("User:\nExplain the parser");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);

      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [divergentUser, firstAssistant, secondUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 2 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 4,
      );
      expect(promptTexts[1]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[1]).toContain("User:\nExplain the parser, but differently");
      expect(promptTexts[1]).toContain("User:\nWhat changed?");
      expect(getManagedSessionHandle(catalog)).not.toBe(activeSession);
    } finally {
      promptSpy.mockRestore();
    }
  });

  it("keeps the prompt boundary usable after a prompt failure", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Prompted" }, DEFAULTS);

    const firstUser = userMessage("Explain the parser");
    const firstAssistant = assistantMessage("Prompt failed but the boundary stayed synced.");
    const secondUser = userMessage("What changed?");
    const secondAssistant = assistantMessage("Only the next delta was sent.");
    const { promptTexts, promptSpy } = installPromptSpy(catalog, [
      {
        user: firstUser,
        assistant: firstAssistant,
        error: new Error("simulated prompt failure"),
      },
      { user: secondUser, assistant: secondAssistant },
    ]);

    try {
      const activeSession = getManagedSessionHandle(catalog);

      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [firstUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 1 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
      );
      expect(promptTexts[0]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[0]).toContain("User:\nExplain the parser");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);

      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [firstUser, firstAssistant, secondUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 2 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 4,
      );
      expect(promptTexts[1]).toBe("What changed?");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);
    } finally {
      promptSpy.mockRestore();
    }
  });

  it("creates a structured turn, thread, and episode for a plain assistant reply", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Plain Reply" }, DEFAULTS);
    const prompt = userMessage("Explain the parser");
    const sessionPrototype = Object.getPrototypeOf(getManagedSessionHandle(catalog).session) as {
      prompt: (promptText: string) => Promise<void>;
    };
    const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
      this: PromptableSession,
      _promptText: string,
    ) {
      appendMessagesToSession(this, [prompt, assistantMessage("Parser cursor synced.")]);
    });

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [prompt],
        onEvent: () => {},
      });

      await waitFor(() => {
        const snapshot = getStructuredSessionState(catalog, created.session.id);
        return snapshot.episodes.length === 1;
      });

      const snapshot = getStructuredSessionState(catalog, created.session.id);
      expect(snapshot.turns).toHaveLength(1);
      expect(snapshot.threads).toHaveLength(1);
      expect(snapshot.commands).toHaveLength(0);
      expect(snapshot.episodes).toHaveLength(1);
      expect(snapshot.verifications).toHaveLength(0);
      expect(snapshot.workflowRuns).toHaveLength(0);
      expect(snapshot.session.wait).toBeNull();
      expect(snapshot.turns[0]).toMatchObject({
        requestSummary: "Explain the parser",
        turnDecision: "reply",
        status: "completed",
      });
      expect(snapshot.threads[0]).toMatchObject({
        surfacePiSessionId: created.session.id,
        status: "completed",
        parentThreadId: null,
      });
      expect(snapshot.episodes[0]).toMatchObject({
        kind: "analysis",
        title: "Explain the parser",
      });
      expect(snapshot.events.map((event) => event.kind)).toEqual([
        "turn.started",
        "thread.created",
        "thread.finished",
        "episode.created",
        "turn.decision",
        "turn.completed",
      ]);
    } finally {
      promptSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("injects latest durable handler handoffs into orchestrator prompt assembly", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Handoff Context" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);
    const seedTurn = store.startTurn({
      sessionId: created.session.id,
      surfacePiSessionId: created.session.id,
      requestSummary: "Delegate the parser fix",
    });
    const orchestratorThread = store.createThread({
      turnId: seedTurn.id,
      surfacePiSessionId: created.session.id,
      title: "Delegate the parser fix",
      objective: "Open a handler thread for the parser fix.",
    });
    const handlerThread = store.createThread({
      turnId: seedTurn.id,
      parentThreadId: orchestratorThread.id,
      surfacePiSessionId: "pi-thread-parser-fix",
      title: "Parser fix thread",
      objective: "Patch the parser bug and add regression coverage.",
    });
    store.updateThread({
      threadId: handlerThread.id,
      status: "completed",
    });
    store.createEpisode({
      threadId: handlerThread.id,
      kind: "change",
      title: "Parser fix handoff",
      summary: "Patched the parser bug and added regression coverage.",
      body: "Changed parser state transitions and added a regression test for the failing case.",
    });
    store.finishTurn({
      turnId: seedTurn.id,
      status: "completed",
    });

    const prompt = userMessage("What should we do next?");
    const { promptTexts, promptSpy } = installPromptSpy(catalog, [
      {
        user: prompt,
        assistant: assistantMessage("We can validate the parser fix and land it."),
      },
    ]);

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createOrchestratorTarget(created.session.id),
        messages: [prompt],
        onEvent: () => {},
      });

      await waitFor(() => promptTexts.length === 1);
      expect(promptTexts[0]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[0]).toContain("Durable Surface Context:");
      expect(promptTexts[0]).toContain("Latest handler-thread handoffs from durable state:");
      expect(promptTexts[0]).toContain("Parser fix thread");
      expect(promptTexts[0]).toContain("Patched the parser bug and added regression coverage.");
      expect(promptTexts[0]).toContain(
        "Changed parser state transitions and added a regression test for the failing case.",
      );
    } finally {
      promptSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("keeps ordinary handler-thread replies interactive instead of auto-emitting a handoff episode", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Handler Reply" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);

    const seedTurn = store.startTurn({
      sessionId: created.session.id,
      surfacePiSessionId: created.session.id,
      requestSummary: "Delegate the parser fix",
    });
    const orchestratorThread = store.createThread({
      turnId: seedTurn.id,
      surfacePiSessionId: created.session.id,
      title: "Delegate the parser fix",
      objective: "Open a handler thread for the parser fix.",
    });
    const handlerThread = await (
      catalog as unknown as {
        createHandlerThread(input: {
          sessionId: string;
          turnId: string;
          parentThreadId: string;
          parentSurfacePiSessionId: string;
          title: string;
          objective: string;
        }): Promise<{ id: string; surfacePiSessionId: string }>;
      }
    ).createHandlerThread({
      sessionId: created.session.id,
      turnId: seedTurn.id,
      parentThreadId: orchestratorThread.id,
      parentSurfacePiSessionId: created.session.id,
      title: "Parser fix thread",
      objective: "Patch the parser bug and add regression coverage.",
    });

    const followUpText = "What changed in the parser state machine?";
    const followUp = userMessage(followUpText);
    const { promptTexts, promptSpy } = installPromptSpy(catalog, [
      {
        user: followUp,
        assistant: assistantMessage("I updated the transition that lost the parser cursor."),
      },
    ]);

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createThreadTarget(
          created.session.id,
          handlerThread.surfacePiSessionId,
          handlerThread.id,
        ),
        messages: [followUp],
        onEvent: () => {},
      });

      await waitFor(() => promptTexts.length === 1);
      const snapshot = getStructuredSessionState(catalog, created.session.id);
      const followUpTurn = snapshot.turns.find((turn) => turn.requestSummary === followUpText);
      const persistedThread = snapshot.threads.find((thread) => thread.id === handlerThread.id);

      expect(promptTexts[0]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[0]).toContain("Durable Surface Context:");
      expect(promptTexts[0]).toContain("Current interactive surface: handler thread.");
      expect(promptTexts[0]).toContain(
        "You are currently inside the delegated handler-thread surface, not the orchestrator surface.",
      );
      expect(promptTexts[0]).toContain("Title: Parser fix thread");
      expect(promptTexts[0]).toContain("Objective: Patch the parser bug and add regression coverage.");
      expect(promptTexts[0]).toContain(`User:\n${followUpText}`);
      expect(snapshot.episodes).toEqual([]);
      expect(followUpTurn).toMatchObject({
        threadId: handlerThread.id,
        status: "completed",
        turnDecision: "reply",
      });
      expect(persistedThread).toMatchObject({
        id: handlerThread.id,
        status: "running",
      });
    } finally {
      promptSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("opens an orchestrator reconciliation turn immediately after a handler handoff", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Auto Reconcile" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);

    const seedTurn = store.startTurn({
      sessionId: created.session.id,
      surfacePiSessionId: created.session.id,
      requestSummary: "Delegate the parser fix",
    });
    const orchestratorThread = store.createThread({
      turnId: seedTurn.id,
      surfacePiSessionId: created.session.id,
      title: "Delegate the parser fix",
      objective: "Open a handler thread for the parser fix.",
    });
    const handlerThread = await (
      catalog as unknown as {
        createHandlerThread(input: {
          sessionId: string;
          turnId: string;
          parentThreadId: string;
          parentSurfacePiSessionId: string;
          title: string;
          objective: string;
        }): Promise<{ id: string; surfacePiSessionId: string }>;
      }
    ).createHandlerThread({
      sessionId: created.session.id,
      turnId: seedTurn.id,
      parentThreadId: orchestratorThread.id,
      parentSurfacePiSessionId: created.session.id,
      title: "Parser fix thread",
      objective: "Patch the parser bug and add regression coverage.",
    });

    const promptTexts: string[] = [];
    const closeThreadText = "Close this thread with a short summary";
    const closeThread = userMessage(closeThreadText);
    const sessionPrototype = Object.getPrototypeOf(getManagedSessionHandle(catalog).session) as {
      prompt: (promptText: string) => Promise<void>;
    };
    const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
      this: PromptableSession,
      promptText: string,
    ) {
      promptTexts.push(promptText);

      if (promptTexts.length === 1) {
        const runtime = (
          catalog as unknown as {
            activeSession: { promptExecutionRuntime: { current: { rootThreadId: string; turnId: string } | null } };
          }
        ).activeSession.promptExecutionRuntime.current;
        if (!runtime) {
          throw new Error("Expected an active handler runtime before handoff.");
        }

        store.updateThread({
          threadId: runtime.rootThreadId,
          status: "completed",
          wait: null,
        });
        store.createEpisode({
          threadId: runtime.rootThreadId,
          kind: "change",
          title: "Parser fix handoff",
          summary: "Patched the parser bug and handed the objective back.",
          body: "Patched the parser bug, added regression coverage, and handed the objective back.",
        });
        store.setTurnDecision({
          turnId: runtime.turnId,
          decision: "handoff",
        });

        appendMessagesToSession(this, [
          closeThread,
          assistantMessage("I handed the parser fix back to the orchestrator."),
        ]);
        return;
      }

      if (promptTexts.length === 2) {
        appendMessagesToSession(this, [
          userMessage("System event: A handler thread emitted a durable handoff."),
          assistantMessage("I reviewed the handoff and will validate the parser fix before landing it."),
        ]);
        return;
      }

      throw new Error("Unexpected prompt invocation.");
    });

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createThreadTarget(
          created.session.id,
          handlerThread.surfacePiSessionId,
          handlerThread.id,
        ),
        messages: [closeThread],
        onEvent: () => {},
      });

      await waitFor(() => promptTexts.length === 2);

      expect(promptTexts[0]).toContain("Current interactive surface: handler thread.");
      expect(promptTexts[0]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[1]).toContain("System event: A handler thread emitted a durable handoff.");
      expect(promptTexts[1]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[1]).toContain("Latest handler-thread handoffs from durable state:");
      expect(promptTexts[1]).toContain("Parser fix handoff");
      expect(promptTexts[1]).toContain("Patched the parser bug and handed the objective back.");

      const activeSession = await catalog.getActiveSession();
      expect(activeSession?.session.id).toBe(created.session.id);
      expect(activeSession?.target).toEqual(createOrchestratorTarget(created.session.id));

      const listed = await catalog.listSessions();
      const orchestratorSummary = listed.sessions.find((session) => session.id === created.session.id);
      expect(orchestratorSummary).toMatchObject({
        status: "running",
        threadIdsByStatus: {
          running: [],
          waiting: [],
          failed: [],
        },
      });

      const snapshot = getStructuredSessionState(catalog, created.session.id);
      const orchestratorTurn = snapshot.turns.find(
        (turn) =>
          turn.surfacePiSessionId === created.session.id &&
          turn.requestSummary.includes("handler thread emitted a durable handoff"),
      );
      expect(orchestratorTurn).toMatchObject({
        status: "completed",
        turnDecision: "reply",
      });
    } finally {
      promptSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("emits a background-started session sync when orchestrator reconciliation begins after handoff", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Sync After Handoff" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);
    const syncs: SessionSyncMessage[] = [];
    catalog.setSessionSyncListener((payload) => {
      syncs.push(payload);
    });

    const seedTurn = store.startTurn({
      sessionId: created.session.id,
      surfacePiSessionId: created.session.id,
      requestSummary: "Delegate the parser fix",
    });
    const orchestratorThread = store.createThread({
      turnId: seedTurn.id,
      surfacePiSessionId: created.session.id,
      title: "Delegate the parser fix",
      objective: "Open a handler thread for the parser fix.",
    });
    const handlerThread = await (
      catalog as unknown as {
        createHandlerThread(input: {
          sessionId: string;
          turnId: string;
          parentThreadId: string;
          parentSurfacePiSessionId: string;
          title: string;
          objective: string;
        }): Promise<{ id: string; surfacePiSessionId: string }>;
      }
    ).createHandlerThread({
      sessionId: created.session.id,
      turnId: seedTurn.id,
      parentThreadId: orchestratorThread.id,
      parentSurfacePiSessionId: created.session.id,
      title: "Parser fix thread",
      objective: "Patch the parser bug and add regression coverage.",
    });

    const promptTexts: string[] = [];
    const closeThread = userMessage("Close this thread with a short summary");
    const sessionPrototype = Object.getPrototypeOf(getManagedSessionHandle(catalog).session) as {
      prompt: (promptText: string) => Promise<void>;
    };
    const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
      this: PromptableSession,
      promptText: string,
    ) {
      promptTexts.push(promptText);

      if (promptTexts.length === 1) {
        const runtime = (
          catalog as unknown as {
            activeSession: { promptExecutionRuntime: { current: { rootThreadId: string; turnId: string } | null } };
          }
        ).activeSession.promptExecutionRuntime.current;
        if (!runtime) {
          throw new Error("Expected an active handler runtime before handoff.");
        }

        store.updateThread({
          threadId: runtime.rootThreadId,
          status: "completed",
          wait: null,
        });
        store.createEpisode({
          threadId: runtime.rootThreadId,
          kind: "change",
          title: "Parser fix handoff",
          summary: "Patched the parser bug and handed the objective back.",
          body: "Patched the parser bug, added regression coverage, and handed the objective back.",
        });
        store.setTurnDecision({
          turnId: runtime.turnId,
          decision: "handoff",
        });

        appendMessagesToSession(this, [
          closeThread,
          assistantMessage("I handed the parser fix back to the orchestrator."),
        ]);
        return;
      }

      if (promptTexts.length === 2) {
        appendMessagesToSession(this, [
          userMessage("System event: A handler thread emitted a durable handoff."),
          assistantMessage("I reviewed the handoff and will validate the parser fix before landing it."),
        ]);
        return;
      }

      throw new Error("Unexpected prompt invocation.");
    });

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createThreadTarget(
          created.session.id,
          handlerThread.surfacePiSessionId,
          handlerThread.id,
        ),
        messages: [closeThread],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          syncs.some((payload) => payload.reason === "background.started") &&
          syncs.some(
            (payload) =>
              payload.reason === "prompt.settled" &&
              payload.activeSession.target.surface === "orchestrator" &&
              payload.activeSession.session.preview ===
                "I reviewed the handoff and will validate the parser fix before landing it.",
          ),
      );

      const backgroundStarted = syncs.find((payload) => payload.reason === "background.started");
      expect(backgroundStarted).toMatchObject({
        reason: "background.started",
        activeSession: {
          target: {
            workspaceSessionId: created.session.id,
            surface: "orchestrator",
            surfacePiSessionId: created.session.id,
          },
          session: {
            id: created.session.id,
            status: "running",
            preview: "Patched the parser bug and handed the objective back.",
          },
        },
      });
    } finally {
      promptSpy.mockRestore();
      catalog.setSessionSyncListener(null);
      await catalog.dispose();
    }
  });

  it("keeps a handed-back handler thread directly interactive for follow-up chat without opening a new thread", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Follow-up Thread" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);

    const seedTurn = store.startTurn({
      sessionId: created.session.id,
      surfacePiSessionId: created.session.id,
      requestSummary: "Delegate the parser fix",
    });
    const orchestratorThread = store.createThread({
      turnId: seedTurn.id,
      surfacePiSessionId: created.session.id,
      title: "Delegate the parser fix",
      objective: "Open a handler thread for the parser fix.",
    });
    const handlerThread = await (
      catalog as unknown as {
        createHandlerThread(input: {
          sessionId: string;
          turnId: string;
          parentThreadId: string;
          parentSurfacePiSessionId: string;
          title: string;
          objective: string;
        }): Promise<{ id: string; surfacePiSessionId: string }>;
      }
    ).createHandlerThread({
      sessionId: created.session.id,
      turnId: seedTurn.id,
      parentThreadId: orchestratorThread.id,
      parentSurfacePiSessionId: created.session.id,
      title: "Parser fix thread",
      objective: "Patch the parser bug and add regression coverage.",
    });
    store.updateThread({
      threadId: handlerThread.id,
      status: "completed",
    });
    store.createEpisode({
      threadId: handlerThread.id,
      kind: "change",
      title: "Parser fix handoff",
      summary: "Patched the parser bug and handed the objective back.",
      body: "Patched the parser bug and handed the objective back.",
    });
    store.finishTurn({
      turnId: seedTurn.id,
      status: "completed",
    });

    const followUpText = "Why did you choose that parser transition?";
    const followUp = userMessage(followUpText);
    const { promptTexts, promptSpy } = installPromptSpy(catalog, [
      {
        user: followUp,
        assistant: assistantMessage("That transition preserves the parser cursor invariant."),
      },
    ]);

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createThreadTarget(
          created.session.id,
          handlerThread.surfacePiSessionId,
          handlerThread.id,
        ),
        messages: [followUp],
        onEvent: () => {},
      });

      await waitFor(() => promptTexts.length === 1);
      const snapshot = getStructuredSessionState(catalog, created.session.id);
      const followUpTurn = snapshot.turns.find((turn) => turn.requestSummary === followUpText);
      const persistedThread = snapshot.threads.find((thread) => thread.id === handlerThread.id);

      expect(promptTexts[0]).toContain(`User:\n${followUpText}`);
      expect(snapshot.threads).toHaveLength(2);
      expect(snapshot.episodes).toHaveLength(1);
      expect(followUpTurn).toMatchObject({
        threadId: handlerThread.id,
        status: "completed",
        turnDecision: "reply",
      });
      expect(persistedThread).toMatchObject({
        id: handlerThread.id,
        status: "completed",
      });
    } finally {
      promptSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("clears handler-thread user wait when the user answers in that same thread surface", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Resume Waiting Thread" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);

    const seedTurn = store.startTurn({
      sessionId: created.session.id,
      surfacePiSessionId: created.session.id,
      requestSummary: "Delegate the parser fix",
    });
    const orchestratorThread = store.createThread({
      turnId: seedTurn.id,
      surfacePiSessionId: created.session.id,
      title: "Delegate the parser fix",
      objective: "Open a handler thread for the parser fix.",
    });
    const handlerThread = await (
      catalog as unknown as {
        createHandlerThread(input: {
          sessionId: string;
          turnId: string;
          parentThreadId: string;
          parentSurfacePiSessionId: string;
          title: string;
          objective: string;
        }): Promise<{ id: string; surfacePiSessionId: string }>;
      }
    ).createHandlerThread({
      sessionId: created.session.id,
      turnId: seedTurn.id,
      parentThreadId: orchestratorThread.id,
      parentSurfacePiSessionId: created.session.id,
      title: "Parser fix thread",
      objective: "Patch the parser bug and add regression coverage.",
    });

    const wait = {
      kind: "user" as const,
      reason: "Need the expected parser output before continuing.",
      resumeWhen: "Resume when the user shares the expected parser output.",
      since: new Date().toISOString(),
    };
    store.updateThread({
      threadId: orchestratorThread.id,
      status: "completed",
    });
    store.updateThread({
      threadId: handlerThread.id,
      status: "waiting",
      wait,
    });
    store.setSessionWait({
      sessionId: created.session.id,
      owner: { kind: "thread", threadId: handlerThread.id },
      kind: wait.kind,
      reason: wait.reason,
      resumeWhen: wait.resumeWhen,
    });

    const replyText = "The expected parser output is AST-v2";
    const reply = userMessage(replyText);
    const { promptTexts, promptSpy } = installPromptSpy(catalog, [
      {
        user: reply,
        assistant: assistantMessage("That resolves the blocker. I can continue."),
      },
    ]);

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        target: createThreadTarget(
          created.session.id,
          handlerThread.surfacePiSessionId,
          handlerThread.id,
        ),
        messages: [reply],
        onEvent: () => {},
      });

      await waitFor(() => promptTexts.length === 1);
      const snapshot = getStructuredSessionState(catalog, created.session.id);
      const persistedThread = snapshot.threads.find((thread) => thread.id === handlerThread.id);

      expect(promptTexts[0]).not.toContain(DEFAULTS.systemPrompt);
      expect(promptTexts[0]).toContain(`User:\n${replyText}`);
      expect(snapshot.session.wait).toBeNull();
      expect(persistedThread).toMatchObject({
        id: handlerThread.id,
        status: "running",
        wait: null,
      });
    } finally {
      promptSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("creates a fresh handler-thread session without cloning the orchestrator transcript", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Fresh Thread Session" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);

    const seedTurn = store.startTurn({
      sessionId: created.session.id,
      surfacePiSessionId: created.session.id,
      requestSummary: "Delegate the parser fix",
    });
    const orchestratorThread = store.createThread({
      turnId: seedTurn.id,
      surfacePiSessionId: created.session.id,
      title: "Delegate the parser fix",
      objective: "Open a handler thread for the parser fix.",
    });

    try {
      const handlerThread = await (
        catalog as unknown as {
          createHandlerThread(input: {
            sessionId: string;
            turnId: string;
            parentThreadId: string;
            parentSurfacePiSessionId: string;
            title: string;
            objective: string;
          }): Promise<{ id: string; surfacePiSessionId: string }>;
        }
      ).createHandlerThread({
        sessionId: created.session.id,
        turnId: seedTurn.id,
        parentThreadId: orchestratorThread.id,
        parentSurfacePiSessionId: created.session.id,
        title: "Parser fix thread",
        objective: "Patch the parser bug and add regression coverage.",
      });

      const threadSurface = await catalog.openSurface(
        createThreadTarget(created.session.id, handlerThread.surfacePiSessionId, handlerThread.id),
      );

      expect(threadSurface.session.id).toBe(created.session.id);
      expect(threadSurface.target).toEqual(
        createThreadTarget(created.session.id, handlerThread.surfacePiSessionId, handlerThread.id),
      );
      expect(threadSurface.messages).toEqual([]);
      expect(threadSurface.session.messageCount).toBe(0);
      expect(threadSurface.systemPrompt).toBe(DEFAULTS.systemPrompt);
      expect(threadSurface.resolvedSystemPrompt).toContain(DEFAULTS.systemPrompt);
    } finally {
      await catalog.dispose();
    }
  });

  it("lists and inspects delegated handler threads on demand without changing orchestrator reconciliation", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Inspect Threads" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);

    try {
      const turn = store.startTurn({
        sessionId: created.session.id,
        surfacePiSessionId: created.session.id,
        requestSummary: "Delegate parser fix",
      });
      store.createThread({
        turnId: turn.id,
        surfacePiSessionId: created.session.id,
        title: "Orchestrator local work",
        objective: "Keep the main surface local.",
      });
      const handlerThread = store.createThread({
        turnId: turn.id,
        parentThreadId: null,
        surfacePiSessionId: "pi-thread-parser-fix",
        title: "Parser fix thread",
        objective: "Patch the parser bug and add regression coverage.",
      });
      const command = store.createCommand({
        turnId: turn.id,
        threadId: handlerThread.id,
        toolName: "execute_typescript",
        executor: "execute_typescript",
        visibility: "summary",
        title: "Patch parser transitions",
        summary: "Updated parser transitions and added a regression test.",
      });
      store.finishCommand({
        commandId: command.id,
        status: "succeeded",
        summary: "Updated parser transitions and added a regression test.",
      });
      store.recordWorkflow({
        threadId: handlerThread.id,
        commandId: command.id,
        smithersRunId: "run-parser-fix",
        workflowName: "verification_run",
        templateId: "verification_run",
        status: "completed",
        summary: "Verification passed.",
      });
      store.updateThread({
        threadId: handlerThread.id,
        status: "completed",
      });
      store.createEpisode({
        threadId: handlerThread.id,
        kind: "change",
        title: "Parser fix handoff",
        summary: "Patched the parser transitions and handed back the thread.",
        body: "Patched the parser transitions and handed back the thread.",
      });
      store.finishTurn({
        turnId: turn.id,
        status: "completed",
      });

      const summaries = await catalog.listHandlerThreads({ sessionId: created.session.id });
      expect(summaries).toEqual([
        expect.objectContaining({
          threadId: handlerThread.id,
          surfacePiSessionId: "pi-thread-parser-fix",
          title: "Parser fix thread",
          status: "completed",
          latestEpisode: expect.objectContaining({
            summary: "Patched the parser transitions and handed back the thread.",
          }),
          latestWorkflowRun: expect.objectContaining({
            summary: "Verification passed.",
          }),
        }),
      ]);

      const inspector = await catalog.getHandlerThreadInspector({
        sessionId: created.session.id,
        threadId: handlerThread.id,
      });
      expect(inspector).toMatchObject({
        threadId: handlerThread.id,
        title: "Parser fix thread",
        commandRollups: [
          expect.objectContaining({
            commandId: command.id,
            summary: "Updated parser transitions and added a regression test.",
          }),
        ],
        workflowRuns: [
          expect.objectContaining({
            workflowName: "verification_run",
            summary: "Verification passed.",
          }),
        ],
        episodes: [
          expect.objectContaining({
            summary: "Patched the parser transitions and handed back the thread.",
          }),
        ],
      });
    } finally {
      await catalog.dispose();
    }
  });

  it("projects durable session wait separately from thread wait", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Blocked Dependencies" }, DEFAULTS);
    const store = (catalog as unknown as { structuredSessionStore: StructuredSessionStateStore })
      .structuredSessionStore;

    try {
      const turn = store.startTurn({
        sessionId: created.session.id,
        surfacePiSessionId: created.session.id,
        requestSummary: "Wait on the user",
      });
      const waitingThread = store.createThread({
        turnId: turn.id,
        surfacePiSessionId: "pi-thread-blocked-dependencies",
        title: "Pause for input",
        objective: "Wait for a durable session wait.",
      });

      const wait = {
        kind: "user" as const,
        reason: "Need clarification before continuing.",
        resumeWhen: "Resume when the user answers the rollout question.",
        since: new Date().toISOString(),
      };
      store.updateThread({
        threadId: waitingThread.id,
        status: "waiting",
        wait,
      });
      const waitingOn = store.setSessionWait({
        sessionId: created.session.id,
        owner: { kind: "thread", threadId: waitingThread.id },
        ...wait,
      });

      const sessions = await catalog.listSessions();
      const summary = sessions.sessions.find((session) => session.id === created.session.id);
      expect(summary?.status).toBe("waiting");
      expect(summary?.wait).toEqual({
        threadId: waitingThread.id,
        kind: waitingOn.kind,
        reason: waitingOn.reason,
        resumeWhen: waitingOn.resumeWhen,
        since: waitingOn.since,
      });
      expect(summary?.preview).toBe("Waiting: Need clarification before continuing.");
      expect(summary?.counts).toMatchObject({
        turns: 1,
        threads: 1,
        commands: 0,
        episodes: 0,
        verifications: 0,
        workflows: 0,
        artifacts: 0,
      });
      expect(summary?.threadIds).toEqual([waitingThread.id]);

      const snapshot = getStructuredSessionState(catalog, created.session.id);
      expect(snapshot.session.wait).toEqual(waitingOn);
      expect(snapshot.threads[0]?.wait).toMatchObject({
        kind: "user",
        reason: "Need clarification before continuing.",
      });
      expect(snapshot.events.map((event) => event.kind)).toEqual([
        "turn.started",
        "thread.created",
        "thread.updated",
        "session.wait.started",
      ]);
    } finally {
      await catalog.dispose();
    }
  });

  it("does not mutate Smithers workflow state during read APIs", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Workflow Refresh" }, DEFAULTS);
    const store = (catalog as unknown as { structuredSessionStore: StructuredSessionStateStore })
      .structuredSessionStore;

    try {
      const turn = store.startTurn({
        sessionId: created.session.id,
        surfacePiSessionId: created.session.id,
        requestSummary: "Refresh workflow state on the handler thread",
      });
      const handlerThread = store.createThread({
        turnId: turn.id,
        surfacePiSessionId: "pi-thread-workflow-refresh",
        title: "Supervise workflow",
        objective: "Keep the handler thread in control while Smithers runs.",
      });
      const command = store.createCommand({
        turnId: turn.id,
        threadId: handlerThread.id,
        toolName: "workflow.start",
        executor: "smithers",
        visibility: "surface",
        title: "Start workflow",
        summary: "Start the delegated workflow.",
      });
      const workflow = store.recordWorkflow({
        threadId: handlerThread.id,
        commandId: command.id,
        smithersRunId: "run-refresh-123",
        workflowName: "implement-feature",
        templateId: "single_task",
        status: "running",
        summary: "Workflow started.",
      });

      store.updateWorkflow({
        workflowId: workflow.id,
        status: "waiting",
        summary: "implement-feature run run-refresh-123 is waiting for an external event.",
      });
      store.updateThread({
        threadId: handlerThread.id,
        status: "waiting",
        wait: {
          kind: "external",
          reason: "Waiting for an external Smithers event before the workflow can continue.",
          resumeWhen: "Resume when the required external Smithers event arrives.",
          since: "2026-04-19T13:30:00.000Z",
        },
      });
      store.setSessionWait({
        sessionId: created.session.id,
        owner: { kind: "thread", threadId: handlerThread.id },
        kind: "external",
        reason: "Waiting for an external Smithers event before the workflow can continue.",
        resumeWhen: "Resume when the required external Smithers event arrives.",
      });

      const beforeReads = getStructuredSessionState(catalog, created.session.id);

      await catalog.listSessions();
      await catalog.getActiveSession();
      await catalog.listHandlerThreads({ sessionId: created.session.id });
      await catalog.getHandlerThreadInspector({
        sessionId: created.session.id,
        threadId: handlerThread.id,
      });

      const afterReads = getStructuredSessionState(catalog, created.session.id);
      expect(afterReads).toEqual(beforeReads);
    } finally {
      await catalog.dispose();
    }
  });

  it("updates session metadata on explicit actions instead of summary reads", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Original Title" }, DEFAULTS);
    const store = getStructuredSessionStore(catalog);

    try {
      const turn = store.startTurn({
        sessionId: created.session.id,
        surfacePiSessionId: created.session.id,
        requestSummary: "Seed a structured summary projection",
      });
      store.finishTurn({
        turnId: turn.id,
        status: "completed",
      });

      await catalog.renameSession(created.session.id, "Renamed Title");

      expect(getStructuredSessionState(catalog, created.session.id).pi.title).toBe("Renamed Title");

      const upsertSpy = spyOn(store, "upsertPiSession");
      try {
        const listed = await catalog.listSessions();
        const active = await catalog.getActiveSession();

        expect(listed.sessions.find((session) => session.id === created.session.id)?.title).toBe(
          "Renamed Title",
        );
        expect(active?.session.title).toBe("Renamed Title");
        expect(upsertSpy).not.toHaveBeenCalled();
        expect(getStructuredSessionState(catalog, created.session.id).pi.title).toBe(
          "Renamed Title",
        );
      } finally {
        upsertSpy.mockRestore();
      }
    } finally {
      await catalog.dispose();
    }
  });

  it("creates, opens, renames, forks, and restores sessions across catalog restarts", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const existing = createPersistedSession(cwd, sessionDir, {
      title: "Existing",
      prompt: "Inspect the queue",
      reply: "Queue inspected",
      thinkingLevel: "high",
    });

    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
    expect(created.session.title).toBe("New Session");

    await catalog.renameSession(created.session.id, "Renamed Session");
    const renamedList = await catalog.listSessions();
    expect(renamedList.sessions.find((session) => session.id === created.session.id)?.title).toBe(
      "Renamed Session",
    );

    const opened = await catalog.openSession(existing.id, DEFAULTS.systemPrompt);
    expect(opened.session.title).toBe("Existing");
    expect(opened.messages.some((message) => message.role === "assistant")).toBe(true);
    expect(opened.reasoningEffort).toBe("high");

    const forked = await catalog.forkSession(
      { sessionId: existing.id, title: "Forked Session" },
      DEFAULTS,
    );
    expect(forked.session.title).toBe("Forked Session");
    expect(forked.session.parentSessionId).toBe(existing.id);
    expect(forked.messages.length).toBe(opened.messages.length);

    await catalog.dispose();

    const reopenedCatalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const reopened = await reopenedCatalog.openSession(existing.id, DEFAULTS.systemPrompt);
    expect(reopened.session.title).toBe("Existing");
    expect(reopened.reasoningEffort).toBe("high");
  });

  it("persists a blank created session before the first assistant message", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    const created = await catalog.createSession({}, DEFAULTS);
    expect(created.session.title).toBe("New Session");

    await catalog.dispose();

    const reopenedCatalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const sessions = await reopenedCatalog.listSessions();

    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]?.id).toBe(created.session.id);
    expect(sessions.sessions[0]?.title).toBe("New Session");
    expect(sessions.sessions[0]?.messageCount).toBe(0);
  });

  it("blocks deleting the active session while a prompt is streaming", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Streaming" }, DEFAULTS);

    (
      catalog as unknown as { activeSession?: { activePrompt: boolean } }
    ).activeSession!.activePrompt = true;

    await expect(catalog.deleteSession(created.session.id, DEFAULTS)).rejects.toThrow(
      "Cannot delete a session while it is streaming.",
    );
  });
});
