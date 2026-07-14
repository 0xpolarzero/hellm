import type { BrowserView, BrowserWindow, BuildConfig } from "electrobun/bun";
import { mountElectrobunToolBridge } from "electrobun-browser-tools/bridge";
import type { AgentDefaults } from "../shared/agent-settings";
import type {
  ProviderAuthInfo,
  SurfaceComposerReadModel,
  SurfaceQueuedMessagesReadModel,
  SurfaceSummaryReadModel,
  SurfaceTranscriptReadModel,
  WorkspaceInfoResponse,
} from "../shared/workspace-contract";

type LogLevel = "debug" | "info" | "warn" | "error";
type ErrorKind = "app" | "rpc";
type DevBrowserToolsBridgeInstance = {
  appId: string;
  url?: string;
  close: () => Promise<void>;
  recordEvent: (input: {
    eventName: string;
    payload?: Record<string, unknown>;
    viewId?: number;
    windowId?: number;
  }) => void;
  recordLog: (input: {
    context?: Record<string, unknown>;
    level: LogLevel;
    message: string;
    source?: string;
    viewId?: number;
    windowId?: number;
  }) => void;
  recordError: (input: {
    details?: Record<string, unknown>;
    kind: ErrorKind;
    message: string;
    source?: string;
    stack?: string;
    viewId?: number;
    windowId?: number;
  }) => void;
};

export type DevBrowserToolsSurfaceReadModelBundle = {
  transcript: SurfaceTranscriptReadModel;
  summary: SurfaceSummaryReadModel;
  composer: SurfaceComposerReadModel;
  queuedMessages: SurfaceQueuedMessagesReadModel;
};

type WorkspaceSessionsState = {
  sessions: unknown[];
};

type DevBrowserToolsState = Record<string, Record<string, unknown>>;

export type DevBrowserToolsNamespaceError = {
  kind: "read-model-error";
  name: string;
  message: string;
};

export type DevBrowserToolsNamespaceState<Value = unknown> =
  | { status: "ready"; value: Value }
  | { status: "unavailable"; reason: "no-active-workspace"; value: null }
  | { status: "error"; error: DevBrowserToolsNamespaceError; value: null };

export type DevBrowserToolsInspectionState = {
  settings: DevBrowserToolsNamespaceState;
  agents: DevBrowserToolsNamespaceState;
  extensions: DevBrowserToolsNamespaceState;
  appLogs: DevBrowserToolsNamespaceState;
  promptHistory: DevBrowserToolsNamespaceState;
  requestInput: DevBrowserToolsNamespaceState;
  approvals: DevBrowserToolsNamespaceState;
  snippets: DevBrowserToolsNamespaceState;
  workflowsGenerated: DevBrowserToolsNamespaceState;
  workspaceChrome: DevBrowserToolsNamespaceState;
  workspaceLayout: DevBrowserToolsNamespaceState;
  externalInstructions: DevBrowserToolsNamespaceState;
};

export type DevBrowserToolsRecorder = {
  close: () => Promise<void>;
  recordError: (
    kind: ErrorKind,
    message: string,
    source: string,
    details?: Record<string, unknown>,
    error?: unknown,
  ) => void;
  recordEvent: (eventName: string, payload?: Record<string, unknown>) => void;
  recordLog: (
    level: LogLevel,
    message: string,
    source: string,
    context?: Record<string, unknown>,
  ) => void;
};

export const noopDevBrowserToolsRecorder: DevBrowserToolsRecorder = {
  close: async () => {},
  recordError: () => {},
  recordEvent: () => {},
  recordLog: () => {},
};

type MountDevBrowserToolsBridgeOptions = {
  browserView: typeof BrowserView;
  buildConfig: typeof BuildConfig;
  getDefaultAgentSettings: () => AgentDefaults;
  getActiveWorkspace: () => Promise<WorkspaceInfoResponse | null>;
  getMainWindow: () => BrowserWindow | null;
  getWorkspaceBranch: (cwd: string) => string | undefined;
  readInspectionState: (
    activeWorkspaceId: string | null,
  ) => Promise<DevBrowserToolsInspectionState>;
  getOpenWorkspaces: () => WorkspaceInfoResponse[];
  listProviderAuthSummaries: () => Promise<ProviderAuthInfo[]>;
  listOpenSurfaceReadModels: (
    workspaceId: string,
  ) => Promise<DevBrowserToolsSurfaceReadModelBundle[]>;
  listWorkspaceSessions: (workspaceId: string) => Promise<WorkspaceSessionsState>;
  mainWindow: BrowserWindow;
  requestQuit?: () => void;
};

const PRIVATE_BRIDGE_KEYS = new Set([
  "acceptedarguments",
  "accesstoken",
  "apikey",
  "argv",
  "authorization",
  "command",
  "commandpayload",
  "credential",
  "credentials",
  "generatedsystemprompt",
  "idtoken",
  "oauthcredential",
  "oauthcredentials",
  "rawarguments",
  "rawauth",
  "refreshtoken",
  "secretvalue",
  "stdin",
  "systemprompt",
]);

function safeBridgeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => safeBridgeValue(item, seen));
    seen.delete(value);
    return items;
  }
  const object = Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      PRIVATE_BRIDGE_KEYS.has(key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase())
        ? []
        : [[key, safeBridgeValue(item, seen)]],
    ),
  );
  seen.delete(value);
  return object;
}

export async function mountDevBrowserToolsBridge(
  options: MountDevBrowserToolsBridgeOptions,
): Promise<DevBrowserToolsRecorder & { appId: string; url?: string }> {
  let browserToolsBridge: DevBrowserToolsBridgeInstance | null = null;
  let initialStateCaptured = false;

  function getBridgeContext(): { viewId?: number; windowId?: number } {
    const mainWindow = options.getMainWindow();
    return {
      windowId: mainWindow?.id,
      viewId: mainWindow?.webviewId,
    };
  }

  async function buildState(): Promise<DevBrowserToolsState> {
    if (!initialStateCaptured) {
      console.info("svvy startup phase: dev-browser-tools.state.begin");
    }
    const activeWorkspace = await options.getActiveWorkspace();
    const defaults = options.getDefaultAgentSettings();
    const [inspectionState, sessions, openSurfaceReadModels, providerAuths] = await Promise.all([
      options.readInspectionState(activeWorkspace?.workspaceId ?? null),
      activeWorkspace
        ? options.listWorkspaceSessions(activeWorkspace.workspaceId)
        : Promise.resolve({ sessions: [] }),
      activeWorkspace
        ? options.listOpenSurfaceReadModels(activeWorkspace.workspaceId)
        : Promise.resolve([]),
      options.listProviderAuthSummaries(),
    ]);
    const openWorkspaces = options.getOpenWorkspaces();

    const state = safeBridgeValue({
      workspace: {
        workspaceId: activeWorkspace?.workspaceId ?? null,
        cwd: activeWorkspace?.cwd ?? null,
        label: activeWorkspace?.workspaceLabel ?? null,
        branch: activeWorkspace
          ? (activeWorkspace.branch ?? options.getWorkspaceBranch(activeWorkspace.cwd))
          : null,
        activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
        openWorkspaces,
        total: openWorkspaces.length,
      },
      defaults: {
        ...defaults,
      },
      providers: {
        connected: providerAuths.filter((provider) => provider.hasKey).length,
        items: providerAuths,
        total: providerAuths.length,
      },
      sessions: {
        summaries: sessions.sessions,
        total: sessions.sessions.length,
      },
      surfaces: {
        items: openSurfaceReadModels.map((readModels) => ({
          ...readModels,
          messageCount: readModels.transcript.messages.length,
          queuedMessageCount: readModels.queuedMessages.queuedMessages.length,
        })),
        total: openSurfaceReadModels.length,
      },
      ...inspectionState,
    }) as DevBrowserToolsState;
    if (!initialStateCaptured) {
      initialStateCaptured = true;
      console.info("svvy startup phase: dev-browser-tools.state.ready");
    }
    return state;
  }

  browserToolsBridge = await mountElectrobunToolBridge({
    browserView: options.browserView,
    buildConfig: options.buildConfig,
    mainWindow: options.mainWindow,
    port: 0,
    requestQuit: options.requestQuit,
    state: buildState,
    trustedRuntime: true,
  });

  return {
    appId: browserToolsBridge.appId,
    url: browserToolsBridge.url,
    close: async (): Promise<void> => {
      const bridge = browserToolsBridge;
      browserToolsBridge = null;
      await bridge?.close();
    },
    recordError: (
      kind: ErrorKind,
      message: string,
      source: string,
      details?: Record<string, unknown>,
      error?: unknown,
    ): void => {
      browserToolsBridge?.recordError({
        kind,
        message,
        source,
        details,
        stack: error instanceof Error ? error.stack : undefined,
        ...getBridgeContext(),
      });
    },
    recordEvent: (eventName: string, payload?: Record<string, unknown>): void => {
      browserToolsBridge?.recordEvent({
        eventName,
        payload,
        ...getBridgeContext(),
      });
    },
    recordLog: (
      level: LogLevel,
      message: string,
      source: string,
      context?: Record<string, unknown>,
    ): void => {
      browserToolsBridge?.recordLog({
        level,
        message,
        source,
        context,
        ...getBridgeContext(),
      });
    },
  };
}
