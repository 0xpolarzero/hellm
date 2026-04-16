import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, StopReason, ToolCall } from "@mariozechner/pi-ai";
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

  it("marks inactive failed sessions as error without rebuilding full context", async () => {
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
        status: "error",
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
    await catalog.createSession({ title: "Prompted" }, DEFAULTS);

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
        messages: [firstUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 1 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
      );
      expect(promptTexts[0]).toContain("System:\nYou are svvy.");
      expect(promptTexts[0]).toContain("User:\nExplain the parser");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);

      await catalog.sendPrompt({
        ...DEFAULTS,
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

  it("recreates the session when earlier history diverges", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    await catalog.createSession({ title: "Prompted" }, DEFAULTS);

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
        messages: [originalUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 1 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
      );
      expect(promptTexts[0]).toContain("System:\nYou are svvy.");
      expect(promptTexts[0]).toContain("User:\nExplain the parser");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);

      await catalog.sendPrompt({
        ...DEFAULTS,
        messages: [divergentUser, firstAssistant, secondUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 2 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 4,
      );
      expect(promptTexts[1]).toContain("System:\nYou are svvy.");
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
    await catalog.createSession({ title: "Prompted" }, DEFAULTS);

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
        messages: [firstUser],
        onEvent: () => {},
      });

      await waitFor(
        () =>
          promptTexts.length === 1 &&
          getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
      );
      expect(promptTexts[0]).toContain("System:\nYou are svvy.");
      expect(promptTexts[0]).toContain("User:\nExplain the parser");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);

      await catalog.sendPrompt({
        ...DEFAULTS,
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
      expect(snapshot.workflows).toHaveLength(0);
      expect(snapshot.session.wait).toBeNull();
      expect(snapshot.turns[0]).toMatchObject({
        requestSummary: "Explain the parser",
        status: "completed",
      });
      expect(snapshot.threads[0]).toMatchObject({
        kind: "task",
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
        "episode.created",
        "thread.finished",
        "turn.completed",
      ]);
    } finally {
      promptSpy.mockRestore();
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
        requestSummary: "Wait on the user",
      });
      const waitingThread = store.createThread({
        turnId: turn.id,
        kind: "workflow",
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
        threadId: waitingThread.id,
        ...wait,
      });

      const sessions = await catalog.listSessions();
      const summary = sessions.sessions.find((session) => session.id === created.session.id);
      expect(summary?.status).toBe("waiting");
      expect(summary?.wait).toEqual(waitingOn);
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
