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
import type { StructuredSessionSnapshot, StructuredSessionStateStore } from "./structured-session-state";

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

const STRUCTURED_SESSION_LIFECYCLE_TOOL_NAME = "structured-session-state";

type StructuredSessionLifecycleOperation =
  | "startThread"
  | "updateThread"
  | "setThreadResult"
  | "recordVerification"
  | "startWorkflow"
  | "updateWorkflow"
  | "setWaitingState";

function lifecycleToolCall(
  operation: StructuredSessionLifecycleOperation,
  argumentsValue: Record<string, unknown>,
): ToolCall {
  return {
    type: "toolCall",
    id: crypto.randomUUID(),
    name: STRUCTURED_SESSION_LIFECYCLE_TOOL_NAME,
    arguments: {
      operation,
      ...argumentsValue,
    },
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
  const store = (
    catalog as unknown as { structuredSessionStore: StructuredSessionStateStore }
  ).structuredSessionStore;
  return store.getSessionState(sessionId);
}

async function waitForSessionSummary(
  catalog: WorkspaceSessionCatalog,
  sessionId: string,
  predicate: (summary: Record<string, unknown>) => boolean,
  timeoutMs = 3_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessions = await catalog.listSessions();
    const summary = sessions.sessions.find((entry) => entry.id === sessionId) as
      | Record<string, unknown>
      | undefined;
    if (summary && predicate(summary)) {
      return summary;
    }
    await Bun.sleep(20);
  }

  throw new Error(`Timed out waiting for session summary for ${sessionId}.`);
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
        () => promptTexts.length === 1 && getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
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
        () => promptTexts.length === 2 && getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 4,
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
        () => promptTexts.length === 1 && getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
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
        () => promptTexts.length === 2 && getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 4,
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
        () => promptTexts.length === 1 && getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2,
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
        () => promptTexts.length === 2 && getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 4,
      );
      expect(promptTexts[1]).toBe("What changed?");
      expect(getManagedSessionHandle(catalog)).toBe(activeSession);
    } finally {
      promptSpy.mockRestore();
    }
  });

  it("persists a running structured thread before completion and exposes it after catalog restart", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Interrupted Prompt" }, DEFAULTS);
    const prompt = userMessage("Run a direct architecture pass and summarize the change.");

    let releasePrompt: (() => void) | null = null;
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const releasePromptGate = () => {
      const release = releasePrompt;
      if (typeof release === "function") {
        release();
      }
    };

    const sessionPrototype = Object.getPrototypeOf(getManagedSessionHandle(catalog).session) as {
      prompt: (promptText: string) => Promise<void>;
    };
    const promptSpy = spyOn(sessionPrototype, "prompt").mockImplementation(async function (
      this: PromptableSession,
      _promptText: string,
    ) {
      const store = (
        catalog as unknown as { structuredSessionStore: StructuredSessionStateStore }
      ).structuredSessionStore;
      const runningThread = store.startThread({
        sessionId: created.session.id,
        kind: "direct",
        objective: "Run a direct architecture pass and summarize the change.",
      });

      await promptGate;
      appendMessagesToSession(this, [
        prompt,
        assistantMessage("Direct thread completed with structured summary.", {
          toolCalls: [
            lifecycleToolCall("setThreadResult", {
              threadId: runningThread.id,
              kind: "analysis-summary",
              summary: "Direct thread completed with structured summary.",
              body: "The runtime-owned direct thread finished successfully.",
            }),
            lifecycleToolCall("updateThread", {
              threadId: runningThread.id,
              status: "completed",
              blockedReason: null,
            }),
          ],
        }),
      ]);
    });

    const restartedCatalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        messages: [prompt],
        onEvent: () => {},
      });

      const runningSummary = await waitForSessionSummary(
        catalog,
        created.session.id,
        (summary) => {
          const threadIdsByStatus = summary.threadIdsByStatus as
            | { running?: unknown[] }
            | undefined;
          return (
            summary.status === "running" &&
            Array.isArray(threadIdsByStatus?.running) &&
            (threadIdsByStatus?.running.length ?? 0) > 0
          );
        },
      );
      expect(runningSummary.counts).toMatchObject({
        threads: 1,
        results: 0,
      });

      const recoveredRunningSummary = await waitForSessionSummary(
        restartedCatalog,
        created.session.id,
        (summary) => summary.status === "running",
      );
      expect(recoveredRunningSummary.counts).toMatchObject({
        threads: 1,
        results: 0,
      });

      releasePromptGate();
      await waitFor(() => getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2);
    } finally {
      releasePromptGate();
      promptSpy.mockRestore();
      await restartedCatalog.dispose();
      await catalog.dispose();
    }
  });

  it("keeps ordinary verification and workflow mentions direct until explicit lifecycle tool calls write structured state", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Structured Results" }, DEFAULTS);
    const directPrompt = userMessage(
      "Review this change, mention verification and workflow in the reply, but stay direct.",
    );
    const directReply = assistantMessage(
      "This stays direct work even though it mentions verification and workflow in passing.",
    );

    const verificationPrompt = userMessage("Start verification as an explicit lifecycle write.");
    const verificationReply = assistantMessage("Starting the verification thread explicitly.", {
      toolCalls: [
        lifecycleToolCall("startThread", {
          kind: "verification",
          objective: "Run verification for the current change.",
        }),
        lifecycleToolCall("recordVerification", {
          kind: "test",
          status: "failed",
          summary: "Verification failed: build is red.",
          command: "bun test",
        }),
        lifecycleToolCall("setThreadResult", {
          kind: "verification-summary",
          summary: "Verification failed: build is red.",
          body: "The verification result is durable structured state, not transcript text.",
        }),
        lifecycleToolCall("updateThread", {
          status: "failed",
          blockedReason: null,
        }),
      ],
    });

    const workflowPrompt = userMessage("Start the delegated workflow explicitly.");
    const workflowReply = assistantMessage("Starting the workflow thread explicitly.", {
      toolCalls: [
        lifecycleToolCall("startThread", {
          kind: "workflow",
          objective: "Represent the delegated Smithers workflow in structured state.",
        }),
        lifecycleToolCall("startWorkflow", {
          smithersRunId: "smithers-run-001",
          workflowName: "workflow-resume-poc",
          summary: "Delegated workflow started and projected into session state.",
        }),
        lifecycleToolCall("setWaitingState", {
          kind: "user",
          reason: "Need clarification about rollout ownership.",
          resumeWhen: "Resume when the user answers the workflow ownership question.",
        }),
      ],
    });

    const resumePrompt = userMessage("Resume the explicit workflow and finish it.");
    const resumeReply = assistantMessage("Completing the workflow through explicit lifecycle writes.", {
      toolCalls: [
        lifecycleToolCall("updateWorkflow", {
          status: "completed",
          summary: "Workflow resumed and completed after clarification.",
        }),
        lifecycleToolCall("setThreadResult", {
          kind: "workflow-summary",
          summary: "Workflow resumed and completed after clarification.",
          body: "The delegated workflow completed after clarification, and that completion is durable state.",
        }),
        lifecycleToolCall("updateThread", {
          status: "completed",
          blockedReason: null,
        }),
      ],
    });

    const { promptSpy } = installPromptSpy(catalog, [
      { user: directPrompt, assistant: directReply },
      { user: verificationPrompt, assistant: verificationReply },
      { user: workflowPrompt, assistant: workflowReply },
      { user: resumePrompt, assistant: resumeReply },
    ]);

    try {
      await catalog.sendPrompt({
        ...DEFAULTS,
        messages: [directPrompt],
        onEvent: () => {},
      });
      await waitFor(() => getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 2);

      const afterDirect = getStructuredSessionState(catalog, created.session.id);
      expect(afterDirect.threads).toHaveLength(1);
      expect(afterDirect.threads[0]?.kind).toBe("direct");
      expect(afterDirect.threads[0]?.status).toBe("completed");
      expect(afterDirect.verifications).toHaveLength(0);
      expect(afterDirect.workflows).toHaveLength(0);
      expect(afterDirect.session.waitingOn).toBeNull();

      await catalog.sendPrompt({
        ...DEFAULTS,
        messages: [...getManagedSessionHandle(catalog).session.agent.state.messages, verificationPrompt],
        onEvent: () => {},
      });
      await waitFor(() => getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 4);

      const afterVerification = getStructuredSessionState(catalog, created.session.id);
      const verificationThread = afterVerification.threads.find(
        (thread) => thread.kind === "verification",
      );
      expect(verificationThread?.status).toBe("failed");
      expect(verificationThread?.result?.kind).toBe("verification-summary");
      expect(afterVerification.verifications).toHaveLength(1);
      expect(afterVerification.workflows).toHaveLength(0);
      expect(afterVerification.session.waitingOn).toBeNull();

      const verificationSummary = await waitForSessionSummary(
        catalog,
        created.session.id,
        (summary) =>
          summary.status === "error" &&
          typeof summary.preview === "string" &&
          summary.preview.includes("Verification failed: build is red."),
      );
      expect(verificationSummary.counts).toMatchObject({
        threads: 2,
        results: 2,
        verifications: 1,
        workflows: 0,
      });

      await catalog.sendPrompt({
        ...DEFAULTS,
        messages: [...getManagedSessionHandle(catalog).session.agent.state.messages, workflowPrompt],
        onEvent: () => {},
      });
      await waitFor(() => getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 6);

      const afterWorkflowWaiting = getStructuredSessionState(catalog, created.session.id);
      const workflowThread = afterWorkflowWaiting.threads.find((thread) => thread.kind === "workflow");
      expect(workflowThread?.status).toBe("waiting");
      expect(workflowThread?.result).toBeNull();
      expect(afterWorkflowWaiting.workflows).toHaveLength(1);
      expect(afterWorkflowWaiting.session.waitingOn).toMatchObject({
        threadId: workflowThread?.id,
        reason: "Need clarification about rollout ownership.",
      });
      expect(afterWorkflowWaiting.threads.filter((thread) => thread.result !== null)).toHaveLength(
        2,
      );

      const waitingSummary = await waitForSessionSummary(
        catalog,
        created.session.id,
        (summary) =>
          summary.status === "waiting" &&
          typeof summary.preview === "string" &&
          summary.preview.toLowerCase().includes("clarification"),
      );
      expect(waitingSummary.waitingOn).toEqual({
        threadId: expect.any(String),
        reason: expect.stringContaining("clarification"),
        resumeWhen: expect.stringContaining("Resume"),
        since: expect.any(String),
      });
      expect(waitingSummary.counts).toMatchObject({
        threads: 3,
        results: 2,
        verifications: 1,
        workflows: 1,
      });

      await catalog.sendPrompt({
        ...DEFAULTS,
        messages: [...getManagedSessionHandle(catalog).session.agent.state.messages, resumePrompt],
        onEvent: () => {},
      });
      await waitFor(() => getManagedSessionHandle(catalog).promptSyncCursor.messageCount === 8);

      const afterResume = getStructuredSessionState(catalog, created.session.id);
      const resumedWorkflowThread = afterResume.threads.find(
        (thread) => thread.kind === "workflow",
      );
      expect(resumedWorkflowThread?.status).toBe("completed");
      expect(resumedWorkflowThread?.result?.kind).toBe("workflow-summary");
      expect(resumedWorkflowThread?.result?.summary).toContain(
        "Workflow resumed and completed after clarification.",
      );
      expect(afterResume.session.waitingOn).toBeNull();
      expect(afterResume.threads.filter((thread) => thread.result !== null)).toHaveLength(3);

      const resumedSummary = await waitForSessionSummary(
        catalog,
        created.session.id,
        (summary) =>
          summary.status === "idle" &&
          typeof summary.preview === "string" &&
          summary.preview.includes("Workflow resumed and completed after clarification."),
      );
      expect(resumedSummary.waitingOn).toBeNull();
      expect(resumedSummary.counts).toMatchObject({
        threads: 3,
        results: 3,
        verifications: 1,
        workflows: 1,
      });
    } finally {
      promptSpy.mockRestore();
      await catalog.dispose();
    }
  });

  it("keeps dependency-blocked threads out of session waiting", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Blocked Dependencies" }, DEFAULTS);
    const store = (
      catalog as unknown as { structuredSessionStore: StructuredSessionStateStore }
    ).structuredSessionStore;

    try {
      const directThread = store.startThread({
        sessionId: created.session.id,
        kind: "direct",
        objective: "Continue direct work while another thread is blocked.",
      });
      const blockedThread = store.startThread({
        sessionId: created.session.id,
        kind: "workflow",
        objective: "Wait on a dependency without pausing the whole session.",
      });

      store.updateThread({
        threadId: blockedThread.id,
        status: "waiting",
        blockedReason: "Waiting on a dependency thread.",
        blockedOn: {
          kind: "threads",
          threadIds: [directThread.id],
          waitPolicy: "all",
          reason: "Waiting on the direct work thread to finish.",
          since: new Date().toISOString(),
        },
      });

      const waitingSummary = await waitForSessionSummary(
        catalog,
        created.session.id,
        (summary) => summary.status === "running",
      );
      expect(waitingSummary.waitingOn).toBeNull();
      expect(waitingSummary.counts).toMatchObject({
        threads: 2,
        results: 0,
        verifications: 0,
        workflows: 0,
      });

      const snapshot = getStructuredSessionState(catalog, created.session.id);
      const blockedThreadSnapshot = snapshot.threads.find((thread) => thread.id === blockedThread.id);
      expect(blockedThreadSnapshot?.blockedOn).toMatchObject({
        kind: "threads",
        threadIds: [directThread.id],
        waitPolicy: "all",
      });
      expect(snapshot.session.waitingOn).toBeNull();
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
