import { expect, it, mock } from "bun:test";

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
    listOpenSurfaceSnapshots: async () => [],
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
    listOpenSurfaceSnapshots: async (workspaceId) => {
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
