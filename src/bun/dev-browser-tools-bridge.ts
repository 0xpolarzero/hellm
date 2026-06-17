import type { BrowserWindow } from "electrobun/bun";
import { mountElectrobunToolBridge } from "electrobun-browser-tools/bridge";
import type { AgentDefaults } from "../shared/agent-settings";
import type { ProviderAuthInfo, WorkspaceInfoResponse } from "../shared/workspace-contract";

type LogLevel = "debug" | "info" | "warn" | "error";
type ErrorKind = "app" | "rpc";
type DevBrowserToolsBridgeInstance = {
  appId: string;
  url?: string;
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

type OpenSurfaceSnapshot = {
  messages: unknown[];
  model: string;
  provider: string;
  reasoningEffort: string;
  systemPrompt: string;
  promptStatus: string;
  target: unknown;
};

type WorkspaceSessionsState = {
  sessions: unknown[];
};

type DevBrowserToolsState = Record<string, Record<string, unknown>>;

export type DevBrowserToolsRecorder = {
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
  recordError: () => {},
  recordEvent: () => {},
  recordLog: () => {},
};

type MountDevBrowserToolsBridgeOptions = {
  defaultSystemPrompt: string;
  getDefaultAgentSettings: () => AgentDefaults;
  getActiveWorkspace: () => WorkspaceInfoResponse | null;
  getMainWindow: () => BrowserWindow | null;
  getWorkspaceBranch: (cwd: string) => string | undefined;
  getOpenWorkspaces: () => WorkspaceInfoResponse[];
  listProviderAuthSummaries: () => Promise<ProviderAuthInfo[]>;
  listOpenSurfaceSnapshots: () => Promise<OpenSurfaceSnapshot[]>;
  listWorkspaceSessions: () => Promise<WorkspaceSessionsState>;
  mainWindow: BrowserWindow;
};

const DEV_BROWSER_TOOLS_PORT_BASE = 59_000;
const DEV_BROWSER_TOOLS_PORT_RANGE = 1_000;

function getPreferredDevBrowserToolsPort(): number {
  return DEV_BROWSER_TOOLS_PORT_BASE + (process.pid % DEV_BROWSER_TOOLS_PORT_RANGE);
}

export async function mountDevBrowserToolsBridge(
  options: MountDevBrowserToolsBridgeOptions,
): Promise<DevBrowserToolsRecorder & { appId: string; url?: string }> {
  let browserToolsBridge: DevBrowserToolsBridgeInstance | null = null;

  function getBridgeContext(): { viewId?: number; windowId?: number } {
    const mainWindow = options.getMainWindow();
    return {
      windowId: mainWindow?.id,
      viewId: mainWindow?.webviewId,
    };
  }

  async function buildState(): Promise<DevBrowserToolsState> {
    const activeWorkspace = options.getActiveWorkspace();
    const defaults = options.getDefaultAgentSettings();
    const sessions = activeWorkspace ? await options.listWorkspaceSessions() : { sessions: [] };
    const openSurfaces = activeWorkspace ? await options.listOpenSurfaceSnapshots() : [];
    const providerAuths = await options.listProviderAuthSummaries();
    const openWorkspaces = options.getOpenWorkspaces();

    return {
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
        systemPrompt: options.defaultSystemPrompt,
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
        items: openSurfaces.map((surface) => ({
          messageCount: surface.messages.length,
          model: surface.model,
          promptStatus: surface.promptStatus,
          provider: surface.provider,
          reasoningEffort: surface.reasoningEffort,
          systemPrompt: surface.systemPrompt,
          target: surface.target,
        })),
        total: openSurfaces.length,
      },
    };
  }

  browserToolsBridge = await mountElectrobunToolBridge({
    mainWindow: options.mainWindow,
    port: getPreferredDevBrowserToolsPort(),
    state: buildState,
  });

  return {
    appId: browserToolsBridge.appId,
    url: browserToolsBridge.url,
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
