import { ApplicationMenu, BrowserWindow, Updater, defineElectrobunRPC } from "electrobun/bun";
import { getModel, getModels, getProviders } from "@mariozechner/pi-ai";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  AuthStateResponse,
  ChatRPCSchema,
  PromptTarget,
  ProviderAuthInfo,
  SendPromptRequest,
} from "../shared/workspace-contract";
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentDefaults,
  type ReasoningEffort,
} from "../shared/agent-settings";
import {
  getProviderEnvVar,
  removeCredential,
  resolveApiKey,
  resolveAuthState,
  setApiKey as storeApiKey,
} from "./auth-store";
import { refreshIfNeeded, startOAuthLogin, supportsOAuth } from "./oauth-login";
import { DEFAULT_SYSTEM_PROMPT } from "./default-system-prompt";
import { WorkspaceSessionCatalog, type SessionDefaults } from "./session-catalog";
import { createSvvyToolBridge } from "./tool-bridge";
import { resolveWorkspaceCwd } from "./workspace-context";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const DEV_SERVER_WAIT_TIMEOUT_MS = 15_000;
const DEV_SERVER_POLL_INTERVAL_MS = 250;
const DEFAULT_RPC_TIMEOUT_MS = 120000;
const ENV_FILES = [".env.local", ".env"];
const PREFERRED_PROVIDERS = ["zai", "openai", "anthropic", "google"];
const PREFERRED_MODEL_FRAGMENTS = [
  "glm-5-turbo",
  "glm-4.7-flashx",
  "glm-4.7-flash",
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5",
  "gpt-4o",
  "claude-sonnet",
  "gemini-2.5",
  "glm-4.7",
  "glm-4.5",
];
let resolvedDefaults: AgentDefaults | null = null;
let mainWindow: BrowserWindow | null = null;
const workspaceSessionCatalog = new WorkspaceSessionCatalog(resolveWorkspaceCwd());

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  try {
    const content = readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const equalsIndex = line.indexOf("=");
      if (equalsIndex < 0) continue;

      const key = line.slice(0, equalsIndex).trim();
      if (!key || process.env[key] !== undefined) continue;

      let value = line.slice(equalsIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (value) process.env[key] = value;
    }
  } catch {
    // Ignore malformed or unreadable env files.
  }
}

function loadRuntimeEnv(): void {
  const cwd = resolveWorkspaceCwd();
  for (const file of ENV_FILES) {
    loadEnvFile(join(cwd, file));
  }
}

function getRpcRequestTimeoutMs(): number {
  const source =
    process.env.ELECTROBUN_RPC_TIMEOUT_MS ??
    process.env.ELECTROBUN_RPC_REQUEST_TIMEOUT_MS ??
    process.env.VITE_ELECTROBUN_RPC_TIMEOUT_MS;

  const parsed = Number(source);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RPC_TIMEOUT_MS;

  return Math.trunc(parsed);
}

type DevServerMode = "auto" | "wait";

function getDevServerMode(): DevServerMode {
  return process.env.SVVY_VITE_DEV_SERVER === "wait" ? "wait" : "auto";
}

async function isDevServerReady(): Promise<boolean> {
  try {
    const response = await fetch(DEV_SERVER_URL, {
      method: "HEAD",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDevServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isDevServerReady()) {
      return true;
    }
    await Bun.sleep(DEV_SERVER_POLL_INTERVAL_MS);
  }

  return false;
}

function getApiKeyMissingError(provider: string): string {
  const envVar = getProviderEnvVar(provider);
  if (!envVar) {
    return `No API key configured for provider "${provider}".`;
  }
  return `Missing ${envVar} for provider "${provider}". Add one in Provider settings.`;
}

async function getMainViewUrl(channelPromise: Promise<string>): Promise<string> {
  const channel = await channelPromise;
  if (channel === "dev") {
    const mode = getDevServerMode();
    const ready =
      mode === "wait"
        ? await waitForDevServer(DEV_SERVER_WAIT_TIMEOUT_MS)
        : await isDevServerReady();

    if (ready) {
      console.log(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    }

    console.log("Vite dev server not running. Run `bun run dev`.");
  }
  return "views://mainview/index.html";
}

function resolveSendDefaults(request: SendPromptRequest): AgentDefaults {
  const defaults = getDefaultAgentSettings();
  return {
    provider: request.provider || defaults.provider,
    model: request.model || defaults.model,
    reasoningEffort: request.reasoningEffort || defaults.reasoningEffort,
  };
}

function getDefaultAgentSettings(): AgentDefaults {
  if (resolvedDefaults) {
    return resolvedDefaults;
  }

  const providers = getProviders();
  const preferredProviders = PREFERRED_PROVIDERS.filter(
    (provider): provider is (typeof providers)[number] =>
      providers.includes(provider as (typeof providers)[number]),
  );
  const orderedProviders = [
    ...preferredProviders,
    ...providers.filter((provider) => !PREFERRED_PROVIDERS.includes(provider)),
  ];

  for (const provider of orderedProviders) {
    const models = getModels(provider);
    if (models.length === 0) continue;

    const preferredModel =
      PREFERRED_MODEL_FRAGMENTS.flatMap((fragment) =>
        models.filter((model) => model.id.includes(fragment)),
      )[0] ?? models[0];
    if (!preferredModel) continue;

    resolvedDefaults = {
      provider,
      model: preferredModel.id,
      reasoningEffort: DEFAULT_AGENT_SETTINGS.reasoningEffort,
    };
    return resolvedDefaults;
  }

  resolvedDefaults = DEFAULT_AGENT_SETTINGS;
  return resolvedDefaults;
}

function getSessionDefaults(systemPrompt = DEFAULT_SYSTEM_PROMPT): SessionDefaults {
  const defaults = getDefaultAgentSettings();
  return {
    model: defaults.model,
    provider: defaults.provider,
    systemPrompt,
    thinkingLevel: defaults.reasoningEffort,
  };
}

function createAuthState(provider: string): AuthStateResponse {
  const state = resolveAuthState(provider);
  if (!state.connected) {
    return {
      connected: false,
      message: getApiKeyMissingError(provider),
    };
  }

  return {
    connected: true,
    accountId: `${provider}-${state.keyType}`,
  };
}

function getWorkspaceBranch(cwd: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return undefined;
  }

  const branch = result.stdout.trim();
  return branch && branch !== "HEAD" ? branch : undefined;
}

function listProviderAuthSummaries(): ProviderAuthInfo[] {
  return getProviders().map((provider) => {
    const state = resolveAuthState(provider);
    return {
      provider,
      hasKey: state.connected,
      keyType: state.keyType,
      supportsOAuth: supportsOAuth(provider),
    };
  });
}

const svvyToolBridge = createSvvyToolBridge({
  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  getDefaultAgentSettings,
  getMainWindow: () => mainWindow,
  getWorkspaceCwd: resolveWorkspaceCwd,
  getWorkspaceBranch,
  listProviderAuthSummaries,
  listOpenSurfaceSnapshots: () => workspaceSessionCatalog.listOpenSurfaceSnapshots(),
  listWorkspaceSessions: () => workspaceSessionCatalog.listSessions(),
});
const recordBridgeEvent = svvyToolBridge.recordEvent;
const recordBridgeLog = svvyToolBridge.recordLog;
const recordBridgeError = svvyToolBridge.recordError;

const rpc = defineElectrobunRPC<ChatRPCSchema, "bun">("bun", {
  maxRequestTime: getRpcRequestTimeoutMs(),
  handlers: {
    requests: {
      getDefaults: async () => {
        return getDefaultAgentSettings();
      },
      getProviderAuthState: async ({
        providerId,
      }: {
        providerId?: string;
      }): Promise<AuthStateResponse> => {
        const defaults = getDefaultAgentSettings();
        return createAuthState(providerId || defaults.provider);
      },
      getWorkspaceInfo: () => {
        const cwd = resolveWorkspaceCwd();
        return {
          workspaceId: cwd,
          workspaceLabel: basename(cwd),
          branch: getWorkspaceBranch(cwd),
        };
      },
      listSessions: async () => {
        return await workspaceSessionCatalog.listSessions();
      },
      getCommandInspector: async ({
        sessionId,
        commandId,
      }: {
        sessionId: string;
        commandId: string;
      }) => {
        return await workspaceSessionCatalog.getCommandInspector({
          sessionId,
          commandId,
        });
      },
      listHandlerThreads: async ({ sessionId }: { sessionId: string }) => {
        return await workspaceSessionCatalog.listHandlerThreads({ sessionId });
      },
      getHandlerThreadInspector: async ({
        sessionId,
        threadId,
      }: {
        sessionId: string;
        threadId: string;
      }) => {
        return await workspaceSessionCatalog.getHandlerThreadInspector({
          sessionId,
          threadId,
        });
      },
      getWorkflowTaskAttemptInspector: async ({
        sessionId,
        workflowTaskAttemptId,
      }: {
        sessionId: string;
        workflowTaskAttemptId: string;
      }) => {
        return await workspaceSessionCatalog.getWorkflowTaskAttemptInspector({
          sessionId,
          workflowTaskAttemptId,
        });
      },
      getProjectCiStatus: async ({ sessionId }: { sessionId: string }) => {
        return await workspaceSessionCatalog.getProjectCiStatus({ sessionId });
      },
      getArtifactPreview: async ({
        sessionId,
        artifactId,
      }: {
        sessionId: string;
        artifactId: string;
      }) => {
        return await workspaceSessionCatalog.getArtifactPreview({ sessionId, artifactId });
      },
      createSession: async ({
        title,
        parentSessionId,
      }: {
        parentSessionId?: string;
        title?: string;
      }) => {
        const session = await workspaceSessionCatalog.createSession(
          { title, parentSessionId },
          getSessionDefaults(),
        );
        recordBridgeEvent("session.created", {
          parentSessionId: parentSessionId ?? null,
          sessionId: session.target.workspaceSessionId,
          title: title?.trim() || null,
        });
        recordBridgeLog("info", "Workspace session created.", "bun.session", {
          parentSessionId: parentSessionId ?? null,
          sessionId: session.target.workspaceSessionId,
        });
        return session;
      },
      openSession: async ({ sessionId }: { sessionId: string }) => {
        const session = await workspaceSessionCatalog.openSession(sessionId, DEFAULT_SYSTEM_PROMPT);
        recordBridgeEvent("session.opened", {
          sessionId,
        });
        return session;
      },
      recordSessionOpened: async ({ sessionId }: { sessionId: string }) => {
        recordBridgeEvent("session.opened", {
          sessionId,
        });
        return { ok: true };
      },
      openSurface: async ({ target }: { target: PromptTarget }) => {
        const session = await workspaceSessionCatalog.openSurface(target, DEFAULT_SYSTEM_PROMPT);
        recordBridgeEvent("surface.opened", {
          surface: target.surface,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        return session;
      },
      closeSurface: async ({ target }: { target: PromptTarget }) => {
        const result = await workspaceSessionCatalog.closeSurface(target);
        recordBridgeEvent("surface.closed", {
          surface: target.surface,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        return result;
      },
      renameSession: async ({ sessionId, title }: { sessionId: string; title: string }) => {
        const result = await workspaceSessionCatalog.renameSession(sessionId, title);
        recordBridgeEvent("session.renamed", {
          sessionId,
          title,
        });
        return result;
      },
      forkSession: async ({ sessionId, title }: { sessionId: string; title?: string }) => {
        const session = await workspaceSessionCatalog.forkSession(
          { sessionId, title },
          getSessionDefaults(),
        );
        recordBridgeEvent("session.forked", {
          sessionId,
          targetSessionId: session.target.workspaceSessionId,
          title: title?.trim() || null,
        });
        return session;
      },
      deleteSession: async ({ sessionId }: { sessionId: string }) => {
        const result = await workspaceSessionCatalog.deleteSession(sessionId);
        recordBridgeEvent("session.deleted", { sessionId });
        return result;
      },
      pinSession: async ({ sessionId }: { sessionId: string }) => {
        const result = await workspaceSessionCatalog.pinSession(sessionId);
        recordBridgeEvent("session.pinned", { sessionId });
        return result;
      },
      unpinSession: async ({ sessionId }: { sessionId: string }) => {
        const result = await workspaceSessionCatalog.unpinSession(sessionId);
        recordBridgeEvent("session.unpinned", { sessionId });
        return result;
      },
      archiveSession: async ({ sessionId }: { sessionId: string }) => {
        const result = await workspaceSessionCatalog.archiveSession(sessionId);
        recordBridgeEvent("session.archived", { sessionId });
        return result;
      },
      unarchiveSession: async ({ sessionId }: { sessionId: string }) => {
        const result = await workspaceSessionCatalog.unarchiveSession(sessionId);
        recordBridgeEvent("session.unarchived", { sessionId });
        return result;
      },
      setArchivedGroupCollapsed: async ({ collapsed }: { collapsed: boolean }) => {
        const result = await workspaceSessionCatalog.setArchivedGroupCollapsed({ collapsed });
        recordBridgeEvent("session.archived-group.toggled", { collapsed });
        return result;
      },
      sendPrompt: async (payload: SendPromptRequest): Promise<{ target: PromptTarget }> => {
        const resolved = resolveSendDefaults(payload);

        if (supportsOAuth(resolved.provider)) {
          await refreshIfNeeded(resolved.provider);
        }

        const apiKey = resolveApiKey(resolved.provider);
        if (!apiKey) {
          const message = getApiKeyMissingError(resolved.provider);
          recordBridgeError("rpc", message, "bun.sendPrompt", {
            provider: resolved.provider,
          });
          throw new Error(message);
        }

        const model = getModel(
          resolved.provider as Parameters<typeof getModel>[0],
          resolved.model as Parameters<typeof getModel>[1],
        );
        let surfacePiSessionId = payload.target.surfacePiSessionId;

        recordBridgeEvent("prompt.requested", {
          messageCount: payload.messages.length,
          model: model.id,
          provider: resolved.provider,
          requestedSurfacePiSessionId: payload.target.surfacePiSessionId,
          requestedWorkspaceSessionId: payload.target.workspaceSessionId,
          requestedThreadId: payload.target.threadId ?? null,
        });

        const session = await workspaceSessionCatalog.sendPrompt({
          target: payload.target,
          provider: resolved.provider,
          model: model.id,
          thinkingLevel: resolved.reasoningEffort,
          messages: payload.messages,
          systemPrompt: payload.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          onEvent: (event) => {
            if (event.type === "start") {
              recordBridgeEvent("prompt.started", {
                model: model.id,
                provider: resolved.provider,
                surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
            } else if (event.type === "done") {
              recordBridgeEvent("prompt.finished", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
            } else if (event.type === "error") {
              const message =
                event.error.content.find((block) => block.type === "text")?.text ||
                "Prompt failed.";
              recordBridgeEvent("prompt.failed", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
              recordBridgeError("app", message, "bun.sendPrompt", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
            }
            rpc.send.sendStreamEvent({ streamId: payload.streamId, event });
          },
        });

        surfacePiSessionId = session.target.surfacePiSessionId;
        recordBridgeLog("info", "Prompt dispatched to pi runtime.", "bun.sendPrompt", {
          model: model.id,
          provider: resolved.provider,
          surfacePiSessionId,
          workspaceSessionId: session.target.workspaceSessionId,
          threadId: session.target.threadId ?? null,
        });
        return session;
      },
      cancelPrompt: async ({ target }: { target: PromptTarget }): Promise<{ ok: boolean }> => {
        await workspaceSessionCatalog.cancelPrompt(target);
        recordBridgeEvent("prompt.cancel.requested", {
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        return { ok: true };
      },
      setSurfaceModel: async ({
        target,
        provider,
        model,
      }: {
        target: PromptTarget;
        provider: string;
        model: string;
      }) => {
        const result = await workspaceSessionCatalog.setSurfaceModel(target, provider, model);
        if (result.ok) {
          recordBridgeEvent("surface.model.changed", {
            model,
            surfacePiSessionId: target.surfacePiSessionId,
            threadId: target.threadId ?? null,
            workspaceSessionId: target.workspaceSessionId,
          });
        } else {
          recordBridgeError(
            "rpc",
            `Surface pi session ${target.surfacePiSessionId} was not found for model update.`,
            "bun.surface",
            {
              model,
              surfacePiSessionId: target.surfacePiSessionId,
            },
          );
        }
        return result;
      },
      setSurfaceThoughtLevel: async ({
        target,
        level,
      }: {
        target: PromptTarget;
        level: ReasoningEffort;
      }) => {
        const result = await workspaceSessionCatalog.setSurfaceThoughtLevel(target, level);
        if (result.ok) {
          recordBridgeEvent("surface.reasoning.changed", {
            level,
            surfacePiSessionId: target.surfacePiSessionId,
            threadId: target.threadId ?? null,
            workspaceSessionId: target.workspaceSessionId,
          });
        } else {
          recordBridgeError(
            "rpc",
            `Surface pi session ${target.surfacePiSessionId} was not found for reasoning update.`,
            "bun.surface",
            {
              level,
              surfacePiSessionId: target.surfacePiSessionId,
            },
          );
        }
        return result;
      },
      listProviderAuths: async (): Promise<ProviderAuthInfo[]> => listProviderAuthSummaries(),
      setProviderApiKey: async ({
        providerId,
        apiKey,
      }: {
        providerId: string;
        apiKey: string;
      }): Promise<{ ok: boolean }> => {
        storeApiKey(providerId, apiKey);
        recordBridgeEvent("provider.auth.updated", {
          keyType: "apikey",
          providerId,
        });
        return { ok: true };
      },
      startOAuth: async ({
        providerId,
      }: {
        providerId: string;
      }): Promise<{ ok: boolean; error?: string }> => {
        try {
          await startOAuthLogin(providerId);
          recordBridgeEvent("provider.oauth.started", { providerId });
          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          recordBridgeError("rpc", message, "bun.oauth", { providerId }, error);
          return {
            ok: false,
            error: message,
          };
        }
      },
      removeProviderAuth: async ({
        providerId,
      }: {
        providerId: string;
      }): Promise<{ ok: boolean }> => {
        removeCredential(providerId);
        recordBridgeEvent("provider.auth.removed", { providerId });
        return { ok: true };
      },
    },
  },
});

workspaceSessionCatalog.setWorkspaceSyncListener((payload) => {
  rpc.send.sendWorkspaceSync(payload);
});

workspaceSessionCatalog.setSurfaceSyncListener((payload) => {
  rpc.send.sendSurfaceSync(payload);
});

const appMenu: Parameters<typeof ApplicationMenu.setApplicationMenu>[0] = [
  {
    label: "svvy",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide", accelerator: "CommandOrControl+H" },
      { role: "hideOthers", accelerator: "CommandOrControl+Option+H" },
      { role: "showAll" },
      { type: "separator" },
      { role: "quit", accelerator: "CommandOrControl+Q" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo", accelerator: "CommandOrControl+Z" },
      { role: "redo", accelerator: "CommandOrControl+Shift+Z" },
      { type: "separator" },
      { role: "cut", accelerator: "CommandOrControl+X" },
      { role: "copy", accelerator: "CommandOrControl+C" },
      { role: "paste", accelerator: "CommandOrControl+V" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { type: "separator" },
      { role: "selectAll", accelerator: "CommandOrControl+A" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { role: "close" },
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "bringAllToFront" },
    ],
  },
];

const localInfoChannelPromise = Updater.localInfo.channel();

ApplicationMenu.setApplicationMenu(appMenu);

loadRuntimeEnv();

const url = await getMainViewUrl(localInfoChannelPromise);

mainWindow = new BrowserWindow({
  title: "svvy",
  frame: {
    x: 0,
    y: 0,
    width: 1180,
    height: 820,
  },
  titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
  rpc,
});

const mountedToolBridge = await svvyToolBridge.mount(mainWindow);
mainWindow.webview.loadURL(url);

recordBridgeEvent("app.ready", {
  bridgeUrl: mountedToolBridge.url ?? null,
  url,
  workspaceId: resolveWorkspaceCwd(),
});
recordBridgeLog("info", "svvy tool bridge mounted.", "tool-bridge", {
  appId: mountedToolBridge.appId,
  bridgeUrl: mountedToolBridge.url ?? null,
});
console.log(
  `svvy bridge: ${JSON.stringify({
    appId: mountedToolBridge.appId,
    bridgeUrl: mountedToolBridge.url ?? null,
  })}`,
);

void mainWindow;

console.log("svvy desktop app started");
