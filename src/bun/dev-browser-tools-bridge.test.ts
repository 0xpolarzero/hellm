import { expect, it, mock } from "bun:test";
import type {
  DevBrowserToolsInspectionState,
  DevBrowserToolsSurfaceReadModelBundle,
} from "./dev-browser-tools-bridge";

let closeCalls = 0;
let mountedState: (() => Promise<Record<string, Record<string, unknown>>>) | null = null;
let mountedOptions: Record<string, unknown> | null = null;
const primaryBrowserView = { getAll: () => [] } as never;
const primaryBuildConfig = { get: async () => ({}) } as never;

mock.module("electrobun-browser-tools/bridge", () => ({
  mountElectrobunToolBridge: async (
    input: Record<string, unknown> & {
      state: () => Promise<Record<string, Record<string, unknown>>>;
    },
  ) => {
    mountedOptions = input;
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

function readyInspectionState(
  overrides: Partial<DevBrowserToolsInspectionState> = {},
): DevBrowserToolsInspectionState {
  const ready = { status: "ready" as const, value: {} };
  return {
    settings: ready,
    agents: ready,
    extensions: ready,
    appLogs: ready,
    promptHistory: ready,
    requestInput: ready,
    approvals: ready,
    snippets: ready,
    workflowsGenerated: ready,
    workspaceChrome: ready,
    workspaceLayout: ready,
    externalInstructions: ready,
    ...overrides,
  };
}

const unavailableWorkspaceState = {
  status: "unavailable" as const,
  reason: "no-active-workspace" as const,
  value: null,
};

it("closes the mounted dev browser-tools registration idempotently", async () => {
  closeCalls = 0;
  let quitRequests = 0;
  const mainWindow = {
    id: 1,
    webviewId: 2,
  } as never;
  const bridge = await mountDevBrowserToolsBridge({
    browserView: primaryBrowserView,
    buildConfig: primaryBuildConfig,
    getDefaultAgentSettings: () => ({
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "medium",
    }),
    getActiveWorkspace: async () => null,
    getMainWindow: () => mainWindow,
    getWorkspaceBranch: () => undefined,
    getOpenWorkspaces: () => [],
    readInspectionState: async () => readyInspectionState(),
    listProviderAuthSummaries: async () => [],
    listOpenSurfaceReadModels: async () => [],
    listWorkspaceSessions: async () => ({ sessions: [] }),
    mainWindow,
    requestQuit: () => {
      quitRequests += 1;
    },
  });

  expect(mountedOptions).toMatchObject({
    browserView: primaryBrowserView,
    buildConfig: primaryBuildConfig,
    port: 0,
    trustedRuntime: true,
  });
  const mountedRequestQuit = mountedOptions?.requestQuit;
  expect(mountedRequestQuit).toBeFunction();
  if (typeof mountedRequestQuit !== "function") {
    throw new Error("Expected the browser tools bridge to receive requestQuit.");
  }
  mountedRequestQuit();
  expect(quitRequests).toBe(1);

  await bridge.close();
  await bridge.close();

  expect(closeCalls).toBe(1);
});

it("uses canonical active-tab identity before that runtime appears in open workspaces", async () => {
  const requestedInspectionWorkspaces: Array<string | null> = [];
  const requestedSurfaceWorkspaces: string[] = [];
  const requestedSessionWorkspaces: string[] = [];
  const mainWindow = { id: 1, webviewId: 2 } as never;
  const bridge = await mountDevBrowserToolsBridge({
    browserView: primaryBrowserView,
    buildConfig: primaryBuildConfig,
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
    readInspectionState: async (workspaceId) => {
      requestedInspectionWorkspaces.push(workspaceId);
      return readyInspectionState();
    },
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
  expect(requestedInspectionWorkspaces).toEqual(["workspace-canonical"]);
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
    browserView: primaryBrowserView,
    buildConfig: primaryBuildConfig,
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
    readInspectionState: async () => readyInspectionState(),
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

it("projects every inspection namespace without one namespace error hiding the others", async () => {
  const mainWindow = { id: 1, webviewId: 2 } as never;
  const bridge = await mountDevBrowserToolsBridge({
    browserView: primaryBrowserView,
    buildConfig: primaryBuildConfig,
    getDefaultAgentSettings: () => ({
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "medium",
    }),
    getActiveWorkspace: async () => ({
      workspaceId: "workspace-a",
      cwd: "/tmp/a",
      workspaceLabel: "A",
      kind: "user",
    }),
    getMainWindow: () => mainWindow,
    getWorkspaceBranch: () => "main",
    getOpenWorkspaces: () => [],
    readInspectionState: async () =>
      readyInspectionState({
        settings: { status: "ready", value: { approvalMode: "auto-review" } },
        agents: {
          status: "error",
          error: {
            kind: "read-model-error",
            name: "StateContractError",
            message: "Agents projection failed.",
          },
          value: null,
        },
        appLogs: {
          status: "ready",
          value: {
            app: { entries: [{ seq: 2 }], summary: { latestSeq: 2 } },
            workspace: { entries: [{ seq: 3 }], summary: { latestSeq: 3 } },
          },
        },
        promptHistory: { status: "ready", value: { entries: [{ text: "test prompt" }] } },
      }),
    listProviderAuthSummaries: async () => [],
    listOpenSurfaceReadModels: async () => [],
    listWorkspaceSessions: async () => ({ sessions: [] }),
    mainWindow,
  });

  const state = await mountedState?.();

  expect(Object.keys(state ?? {})).toEqual(
    expect.arrayContaining([
      "settings",
      "agents",
      "extensions",
      "appLogs",
      "promptHistory",
      "requestInput",
      "approvals",
      "snippets",
      "workflowsGenerated",
      "workspaceChrome",
      "workspaceLayout",
      "externalInstructions",
    ]),
  );
  expect(state?.settings).toEqual({
    status: "ready",
    value: { approvalMode: "auto-review" },
  });
  expect(state?.agents).toEqual({
    status: "error",
    error: {
      kind: "read-model-error",
      name: "StateContractError",
      message: "Agents projection failed.",
    },
    value: null,
  });
  expect(state?.appLogs).toMatchObject({
    status: "ready",
    value: {
      app: { entries: [{ seq: 2 }] },
      workspace: { entries: [{ seq: 3 }] },
    },
  });
  expect(state?.promptHistory).toEqual({
    status: "ready",
    value: { entries: [{ text: "test prompt" }] },
  });
  await bridge.close();
});

it("requests app inspection state with null and returns explicit unavailable workspace namespaces", async () => {
  const requestedInspectionWorkspaces: Array<string | null> = [];
  const mainWindow = { id: 1, webviewId: 2 } as never;
  const bridge = await mountDevBrowserToolsBridge({
    browserView: primaryBrowserView,
    buildConfig: primaryBuildConfig,
    getDefaultAgentSettings: () => ({
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "medium",
    }),
    getActiveWorkspace: async () => null,
    getMainWindow: () => mainWindow,
    getWorkspaceBranch: () => undefined,
    getOpenWorkspaces: () => [],
    readInspectionState: async (workspaceId) => {
      requestedInspectionWorkspaces.push(workspaceId);
      return readyInspectionState({
        promptHistory: unavailableWorkspaceState,
        requestInput: unavailableWorkspaceState,
        approvals: unavailableWorkspaceState,
        snippets: unavailableWorkspaceState,
        workspaceLayout: unavailableWorkspaceState,
        externalInstructions: unavailableWorkspaceState,
      });
    },
    listProviderAuthSummaries: async () => [],
    listOpenSurfaceReadModels: async () => {
      throw new Error("workspace surface reads must not run without an active workspace");
    },
    listWorkspaceSessions: async () => {
      throw new Error("workspace session reads must not run without an active workspace");
    },
    mainWindow,
  });

  const state = await mountedState?.();

  expect(requestedInspectionWorkspaces).toEqual([null]);
  for (const namespace of [
    "promptHistory",
    "requestInput",
    "approvals",
    "snippets",
    "workspaceLayout",
    "externalInstructions",
  ] as const) {
    expect(state?.[namespace]).toEqual(unavailableWorkspaceState);
  }
  expect(state?.sessions).toEqual({ summaries: [], total: 0 });
  expect(state?.surfaces).toEqual({ items: [], total: 0 });
  await bridge.close();
});

it("removes system prompts, raw auth, secrets, and command payloads at the bridge boundary", async () => {
  const mainWindow = { id: 1, webviewId: 2 } as never;
  const bridge = await mountDevBrowserToolsBridge({
    browserView: primaryBrowserView,
    buildConfig: primaryBuildConfig,
    getDefaultAgentSettings: () => ({
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "medium",
    }),
    getActiveWorkspace: async () => null,
    getMainWindow: () => mainWindow,
    getWorkspaceBranch: () => undefined,
    getOpenWorkspaces: () => [],
    readInspectionState: async () =>
      readyInspectionState({
        agents: {
          status: "ready",
          value: {
            generatedSystemPrompt: "DO_NOT_EXPOSE_SYSTEM_PROMPT",
            safeFingerprint: "context-fingerprint",
          },
        },
        extensions: {
          status: "ready",
          value: {
            env: {
              secret: true,
              secretValue: "DO_NOT_EXPOSE_SECRET",
            },
          },
        },
        appLogs: {
          status: "ready",
          value: {
            app: {
              entries: [
                {
                  message: "Command failed.",
                  details: { commandPayload: "DO_NOT_EXPOSE_COMMAND" },
                },
              ],
            },
            workspace: null,
          },
        },
        approvals: {
          status: "ready",
          value: {
            requests: [
              {
                summary: "Run command",
                command: "DO_NOT_EXPOSE_APPROVAL_COMMAND",
                commandFamily: "shell",
              },
            ],
          },
        },
      }),
    listProviderAuthSummaries: async () =>
      [
        {
          provider: "openai",
          hasKey: true,
          keyType: "apikey",
          supportsOAuth: false,
          authHealth: "available",
          apiKey: "DO_NOT_EXPOSE_API_KEY",
        },
      ] as never,
    listOpenSurfaceReadModels: async () => [],
    listWorkspaceSessions: async () => ({ sessions: [] }),
    mainWindow,
  });

  const state = await mountedState?.();
  const serialized = JSON.stringify(state);

  expect(serialized).not.toContain("DO_NOT_EXPOSE");
  expect(serialized).not.toContain("generatedSystemPrompt");
  expect(serialized).not.toContain("secretValue");
  expect(serialized).not.toContain("commandPayload");
  expect(serialized).not.toContain("apiKey");
  expect(state?.extensions).toMatchObject({
    status: "ready",
    value: { env: { secret: true } },
  });
  expect(state?.approvals).toMatchObject({
    status: "ready",
    value: { requests: [{ summary: "Run command", commandFamily: "shell" }] },
  });
  await bridge.close();
});
