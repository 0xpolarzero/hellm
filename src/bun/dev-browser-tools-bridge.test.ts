import { expect, it, mock } from "bun:test";

let closeCalls = 0;

mock.module("electrobun-browser-tools/bridge", () => ({
  mountElectrobunToolBridge: async () => ({
    appId: "svvy-test",
    url: "ws://127.0.0.1:59000",
    close: async () => {
      closeCalls += 1;
    },
    recordError: () => {},
    recordEvent: () => {},
    recordLog: () => {},
  }),
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
    getActiveWorkspace: () => null,
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
