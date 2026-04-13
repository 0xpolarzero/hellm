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

type ActiveWorkspaceSession = {
  messages: unknown[];
  model: string;
  provider: string;
  reasoningEffort: string;
  session: unknown;
  systemPrompt: string;
} | null;

type WorkspaceSessionsState = {
  activeSessionId?: string | null;
  sessions: unknown[];
};

type ToolBridgeState = Record<string, Record<string, unknown>>;

type CreateHellmToolBridgeOptions = {
  defaultSystemPrompt: string;
  getActiveWorkspaceSession: () => Promise<ActiveWorkspaceSession>;
  getDefaultChatSettings: () => ChatDefaults;
  getMainWindow: () => BrowserWindow | null;
  getWorkspaceCwd: () => string;
  getWorkspaceBranch: (cwd: string) => string | undefined;
  listProviderAuthSummaries: () => ProviderAuthInfo[];
  listWorkspaceSessions: () => Promise<WorkspaceSessionsState>;
};

export function createHellmToolBridge(options: CreateHellmToolBridgeOptions) {
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
    const activeSession = await options.getActiveWorkspaceSession();
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
        active: activeSession
          ? {
              messageCount: activeSession.messages.length,
              model: activeSession.model,
              provider: activeSession.provider,
              reasoningEffort: activeSession.reasoningEffort,
              session: activeSession.session,
              systemPrompt: activeSession.systemPrompt,
            }
          : null,
        activeSessionId: sessions.activeSessionId ?? null,
        summaries: sessions.sessions,
        total: sessions.sessions.length,
      },
    };
  }

  return {
    async mount(mainWindow: BrowserWindow): Promise<{ appId: string; url?: string }> {
      const mountedToolBridge = await mountElectrobunToolBridge({
        mainWindow,
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
