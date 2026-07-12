import { expect, it, mock } from "bun:test";
import type { DevBrowserToolsSurfaceReadModelBundle } from "./dev-browser-tools-bridge";

let closeCalls = 0;
let mountedState: (() => Promise<Record<string, Record<string, unknown>>>) | null = null;

mock.module("electrobun-browser-tools/bridge", () => ({
  mountElectrobunToolBridge: async (input: {
    state: () => Promise<Record<string, Record<string, unknown>>>;
  }) => {
    mountedState = input.state;
    return {
      appId: "svvy-test",
      url: "ws://127.0.0.1:59000",
      close: async () => {
        closeCalls += 1;
      },
      recordError: () => {},
      recordEvent: () => {},
      recordLog: () => {},
    };
  },
}));

const { mountDevBrowserToolsBridge } = await import("./dev-browser-tools-bridge");

it("closes the mounted dev browser-tools registration idempotently", async () => {
  closeCalls = 0;
  const mainWindow = {
    id: 1,
    webviewId: 2,
  } as never;
  const bridge = await mountDevBrowserToolsBridge({
    defaultSystemPrompt: "system",
    getDefaultAgentSettings: () => ({
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "medium",
    }),
    getActiveWorkspace: async () => null,
    getMainWindow: () => mainWindow,
    getWorkspaceBranch: () => undefined,
    getOpenWorkspaces: () => [],
    listProviderAuthSummaries: async () => [],
    listOpenSurfaceReadModels: async () => [],
    listWorkspaceSessions: async () => ({ sessions: [] }),
    mainWindow,
  });

  await bridge.close();
  await bridge.close();

  expect(closeCalls).toBe(1);
});

it("uses canonical active-tab identity before that runtime appears in open workspaces", async () => {
  const requestedSurfaceWorkspaces: string[] = [];
  const requestedSessionWorkspaces: string[] = [];
  const mainWindow = { id: 1, webviewId: 2 } as never;
  const bridge = await mountDevBrowserToolsBridge({
    defaultSystemPrompt: "system",
    getDefaultAgentSettings: () => ({
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "medium",
    }),
    getActiveWorkspace: async () => ({
      workspaceId: "workspace-canonical",
      cwd: "/tmp/canonical",
      workspaceLabel: "Canonical",
      kind: "user",
    }),
    getMainWindow: () => mainWindow,
    getWorkspaceBranch: () => "main",
    getOpenWorkspaces: () => [],
    listProviderAuthSummaries: async () => [],
    listOpenSurfaceReadModels: async (workspaceId) => {
      requestedSurfaceWorkspaces.push(workspaceId);
      return [];
    },
    listWorkspaceSessions: async (workspaceId) => {
      requestedSessionWorkspaces.push(workspaceId);
      return { sessions: [] };
    },
    mainWindow,
  });

  const state = await mountedState?.();

  expect(state?.workspace).toMatchObject({
    workspaceId: "workspace-canonical",
    activeWorkspaceId: "workspace-canonical",
  });
  expect(requestedSurfaceWorkspaces).toEqual(["workspace-canonical"]);
  expect(requestedSessionWorkspaces).toEqual(["workspace-canonical"]);
  await bridge.close();
});

it("projects open surfaces from renderer-safe state read-model bundles", async () => {
  const mainWindow = { id: 1, webviewId: 2 } as never;
  const target = {
    workspaceSessionId: "session-1",
    surface: "orchestrator",
    surfacePiSessionId: "surface-1",
  } as DevBrowserToolsSurfaceReadModelBundle["summary"]["target"];
  const readModels: DevBrowserToolsSurfaceReadModelBundle = {
    transcript: {
      target,
      surfaceStatus: "running",
      promptLock: { activeTurnId: null, queuedCount: 1 },
      composerDraft: { text: "follow up", attachmentIds: [] },
      messages: [],
      activeAssistantMessage: null,
      streamCursor: null,
    },
    summary: {
      target,
      title: "State-backed surface",
      status: "running",
      activeTurnId: null,
      activeTurnStartedAt: null,
      queuedCount: 1,
      model: "gpt-5",
      provider: "openai",
      reasoningEffort: "medium",
      agentProfileId: "default",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["workflows"],
    },
    composer: {
      target,
      draft: {
        text: "follow up",
        attachments: [],
        snippetMentions: [],
        updatedAt: null,
      },
    },
    queuedMessages: {
      target,
      queuedMessages: [
        {
          id: "queue-1" as never,
          kind: "user_message",
          text: "queued request",
          status: "queued",
          createdAt: "2026-07-11T10:00:00.000Z",
          updatedAt: "2026-07-11T10:00:00.000Z",
        },
      ],
    },
  };
  const bridge = await mountDevBrowserToolsBridge({
    defaultSystemPrompt: "system",
    getDefaultAgentSettings: () => ({
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "medium",
    }),
    getActiveWorkspace: async () => ({
      workspaceId: "workspace-canonical",
      cwd: "/tmp/canonical",
      workspaceLabel: "Canonical",
      kind: "user",
    }),
    getMainWindow: () => mainWindow,
    getWorkspaceBranch: () => "main",
    getOpenWorkspaces: () => [],
    listProviderAuthSummaries: async () => [],
    listOpenSurfaceReadModels: async () => [readModels],
    listWorkspaceSessions: async () => ({ sessions: [] }),
    mainWindow,
  });

  const state = await mountedState?.();

  expect(state?.surfaces).toEqual({
    items: [
      {
        transcript: readModels.transcript,
        summary: readModels.summary,
        composer: readModels.composer,
        queuedMessages: readModels.queuedMessages,
        messageCount: 0,
        queuedMessageCount: 1,
      },
    ],
    total: 1,
  });
  expect(JSON.stringify(state?.surfaces)).not.toContain("systemPrompt");
  expect(JSON.stringify(state?.surfaces)).not.toContain("promptStatus");
  await bridge.close();
});
