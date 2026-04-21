import type { BrowserWindow } from "electrobun/bun";
import { mountElectrobunToolBridge } from "electrobun-browser-tools/bridge";
import { basename } from "node:path";
import type { ProviderAuthInfo } from "../mainview/chat-rpc";
import type { ChatDefaults } from "../mainview/chat-settings";

type LogLevel = "debug" | "info" | "warn" | "error";
type ErrorKind = "app" | "rpc";
type ToolBridgeInstance = {
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

type ToolBridgeState = Record<string, Record<string, unknown>>;

type CreateSvvyToolBridgeOptions = {
  defaultSystemPrompt: string;
  getDefaultChatSettings: () => ChatDefaults;
  getMainWindow: () => BrowserWindow | null;
  getWorkspaceCwd: () => string;
  getWorkspaceBranch: (cwd: string) => string | undefined;
  listProviderAuthSummaries: () => ProviderAuthInfo[];
  listOpenSurfaceSnapshots: () => Promise<OpenSurfaceSnapshot[]>;
  listWorkspaceSessions: () => Promise<WorkspaceSessionsState>;
};

const TOOL_BRIDGE_PORT_BASE = 59_000;
const TOOL_BRIDGE_PORT_RANGE = 1_000;

function getPreferredToolBridgePort(): number {
  return TOOL_BRIDGE_PORT_BASE + (process.pid % TOOL_BRIDGE_PORT_RANGE);
}

export function createSvvyToolBridge(options: CreateSvvyToolBridgeOptions) {
  let toolBridge: ToolBridgeInstance | null = null;

  function getBridgeContext(): { viewId?: number; windowId?: number } {
    const mainWindow = options.getMainWindow();
    return {
      windowId: mainWindow?.id,
      viewId: mainWindow?.webviewId,
    };
  }

  async function buildState(): Promise<ToolBridgeState> {
    const cwd = options.getWorkspaceCwd();
    const defaults = options.getDefaultChatSettings();
    const sessions = await options.listWorkspaceSessions();
    const openSurfaces = await options.listOpenSurfaceSnapshots();
    const providerAuths = options.listProviderAuthSummaries();

    return {
      workspace: {
        workspaceId: cwd,
        cwd,
        label: basename(cwd),
        branch: options.getWorkspaceBranch(cwd),
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

  return {
    async mount(mainWindow: BrowserWindow): Promise<{ appId: string; url?: string }> {
      const mountedToolBridge = await mountElectrobunToolBridge({
        mainWindow,
        port: getPreferredToolBridgePort(),
        state: buildState,
      });
      toolBridge = mountedToolBridge;
      return {
        appId: mountedToolBridge.appId,
        url: mountedToolBridge.url,
      };
    },
    recordError(
      kind: ErrorKind,
      message: string,
      source: string,
      details?: Record<string, unknown>,
      error?: unknown,
    ): void {
      toolBridge?.recordError({
        kind,
        message,
        source,
        details,
        stack: error instanceof Error ? error.stack : undefined,
        ...getBridgeContext(),
      });
    },
    recordEvent(eventName: string, payload?: Record<string, unknown>): void {
      toolBridge?.recordEvent({
        eventName,
        payload,
        ...getBridgeContext(),
      });
    },
    recordLog(
      level: LogLevel,
      message: string,
      source: string,
      context?: Record<string, unknown>,
    ): void {
      toolBridge?.recordLog({
        level,
        message,
        source,
        context,
        ...getBridgeContext(),
      });
    },
  };
}
