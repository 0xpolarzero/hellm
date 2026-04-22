import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, StopReason, ToolCall } from "@mariozechner/pi-ai";
import type { PromptTarget, SurfaceSyncMessage, WorkspaceSyncMessage } from "../mainview/chat-rpc";
import { buildSystemPrompt } from "./default-system-prompt";
import {
  getSvvySessionDir,
  WorkspaceSessionCatalog,
  resolveRestoredSessionDefaults,
  type SessionDefaults,
} from "./session-catalog";
import type { StructuredSessionStateStore } from "./structured-session-state";

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

type PromptableSession = {
  prompt(
    promptText: string,
    options?: {
      expandPromptTemplates?: boolean;
    },
  ): Promise<void>;
  abort(): Promise<void>;
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

type ManagedSurfaceRecord = {
  sessionId: string;
  actorProfile: "orchestrator" | "handler" | "workflow-task";
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  smithersToolSurfaceVersion?: string | null;
  promptSyncCursor: {
    messageCount: number;
  };
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

function appendMessagesToSession(session: PromptableSession, messages: readonly Message[]): void {
  for (const message of messages) {
    session.sessionManager.appendMessage(message);
    session.agent.appendMessage(message);
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
): Promise<void> {
  const setSurfaceModelFn = (
    catalog as unknown as {
      setSurfaceModel: (...args: unknown[]) => Promise<unknown>;
    }
  ).setSurfaceModel;
  const source = String(setSurfaceModelFn);
  if (source.includes(".target")) {
    await setSurfaceModelFn.call(catalog, { target, model });
    return;
  }
  await setSurfaceModelFn.call(catalog, target, model);
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
        title: string;
        objective: string;
      }): Promise<{ id: string; surfacePiSessionId: string }>;
    }
  ).createHandlerThread({
    sessionId: workspaceSessionId,
    turnId: turn.id,
    parentThreadId: orchestratorThread.id,
    parentSurfacePiSessionId: workspaceSessionId,
    title: input.title,
    objective: input.objective,
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
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    try {
      const created = await catalog.createSession({ title: "Prompt Channel" }, DEFAULTS);
      const orchestratorManaged = getManagedSurface(catalog, created.target.surfacePiSessionId);

      expect(created.systemPrompt).toBe(buildSystemPrompt("orchestrator"));
      expect(created.resolvedSystemPrompt).toContain(buildSystemPrompt("orchestrator"));
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

      expect(openedHandler.systemPrompt).toBe(buildSystemPrompt("handler"));
      expect(openedHandler.resolvedSystemPrompt).toContain(buildSystemPrompt("handler"));
      expect(handlerManaged.session.agent.state.systemPrompt).toBe(
        openedHandler.resolvedSystemPrompt,
      );
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
            ) && workspaceSyncs.some((payload) => payload.reason === "workspace.updated"),
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

        await expect(
          catalog.sendPrompt({
            ...DEFAULTS,
            target: handler.target,
            messages: [handlerPrompt],
            onEvent: () => {},
          }),
        ).rejects.toThrow("already streaming");

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
      } finally {
        handlerPromptGate.resolve();
        handlerPromptSpy.mockRestore();
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
            handlerCancelled.reject(new Error("handler aborted"));
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
          () =>
            handlerPromptSpy.mock.calls.length === 2 &&
            getManagedSurface(catalog, handler.target.surfacePiSessionId).activePrompt &&
            getManagedSurface(catalog, created.target.surfacePiSessionId).activePrompt,
        );

        await cancelSurfacePrompt(catalog, handler.target);
        await waitFor(
          () => !getManagedSurface(catalog, handler.target.surfacePiSessionId).activePrompt,
        );

        expect(handlerAbortSpy).toHaveBeenCalledTimes(1);
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
        toolName: "smithers.run_workflow.workflow_a",
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
        expect(handlerAPrompts).toHaveLength(1);
        expect(handlerAPrompts[0]).toContain("smithers-run-workflow-a");
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
