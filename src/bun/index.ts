import { ApplicationMenu, BrowserWindow, Updater, defineElectrobunRPC } from "electrobun/bun";
import { getModel, getModels, getProviders } from "@mariozechner/pi-ai";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  AuthStateResponse,
  ChatRPCSchema,
  ProviderAuthInfo,
  SendPromptRequest,
} from "../mainview/chat-rpc";
import {
  DEFAULT_CHAT_SETTINGS,
  type ChatDefaults,
  type ReasoningEffort,
} from "../mainview/chat-settings";
import {
  getProviderEnvVar,
  removeCredential,
  resolveApiKey,
  resolveAuthState,
  setApiKey as storeApiKey,
} from "./auth-store";
import { refreshIfNeeded, startOAuthLogin, supportsOAuth } from "./oauth-login";
import { WorkspaceSessionCatalog, type SessionDefaults } from "./session-catalog";
import { createSvvyToolBridge } from "./tool-bridge";
import { resolveWorkspaceCwd } from "./workspace-context";

type SessionMutationResponse = {
  ok: boolean;
  sessionId: string;
};

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const DEV_SERVER_WAIT_TIMEOUT_MS = 15_000;
const DEV_SERVER_POLL_INTERVAL_MS = 250;
const DEFAULT_RPC_TIMEOUT_MS = 120000;
const DEFAULT_SYSTEM_PROMPT = [
  "You are svvy, a pragmatic software engineering assistant running inside the svvy desktop app.",
  "Everything you do is a tool call inside one shared execution model.",
  "Use ordinary coding tools for generic work, verification.run for real verification, workflow.start for delegated workflows, and wait for durable user or external waits.",
  "Threads, commands, verification, workflows, and wait state come from real tool execution rather than assistant prose.",
].join(" ");
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
let resolvedDefaults: ChatDefaults | null = null;
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
  const cwd = process.cwd();
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

function resolveSendDefaults(request: SendPromptRequest): ChatDefaults {
  const defaults = getDefaultChatSettings();
  return {
    provider: request.provider || defaults.provider,
    model: request.model || defaults.model,
    reasoningEffort: request.reasoningEffort || defaults.reasoningEffort,
  };
}

function getDefaultChatSettings(): ChatDefaults {
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
      reasoningEffort: DEFAULT_CHAT_SETTINGS.reasoningEffort,
    };
    return resolvedDefaults;
  }

  resolvedDefaults = DEFAULT_CHAT_SETTINGS;
  return resolvedDefaults;
}

function getSessionDefaults(systemPrompt = DEFAULT_SYSTEM_PROMPT): SessionDefaults {
  const defaults = getDefaultChatSettings();
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
  getActiveWorkspaceSession: () => workspaceSessionCatalog.getActiveSession(),
  getDefaultChatSettings,
  getMainWindow: () => mainWindow,
  getWorkspaceCwd: resolveWorkspaceCwd,
  getWorkspaceBranch,
  listProviderAuthSummaries,
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
        return getDefaultChatSettings();
      },
      getProviderAuthState: async ({
        providerId,
      }: {
        providerId?: string;
      }): Promise<AuthStateResponse> => {
        const defaults = getDefaultChatSettings();
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
      getActiveSession: async () => {
        return await workspaceSessionCatalog.getActiveSession();
      },
      getActiveSessionSummary: async () => {
        return await workspaceSessionCatalog.getActiveSessionSummary();
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
          sessionId: session.session.id,
          title: title?.trim() || null,
        });
        recordBridgeLog("info", "Workspace session created.", "bun.session", {
          parentSessionId: parentSessionId ?? null,
          sessionId: session.session.id,
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
          targetSessionId: session.session.id,
          title: title?.trim() || null,
        });
        return session;
      },
      deleteSession: async ({ sessionId }: { sessionId: string }) => {
        const result = await workspaceSessionCatalog.deleteSession(sessionId, getSessionDefaults());
        recordBridgeEvent("session.deleted", { sessionId });
        return result;
      },
      sendPrompt: async (payload: SendPromptRequest): Promise<{ sessionId: string }> => {
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
        let sessionId = payload.sessionId ?? "";

        recordBridgeEvent("prompt.requested", {
          messageCount: payload.messages.length,
          model: model.id,
          provider: resolved.provider,
          requestedSessionId: payload.sessionId ?? null,
        });

        const session = await workspaceSessionCatalog.sendPrompt({
          sessionId: payload.sessionId,
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
                sessionId: sessionId || null,
              });
            } else if (event.type === "done") {
              recordBridgeEvent("prompt.finished", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                sessionId: sessionId || null,
              });
            } else if (event.type === "error") {
              const message =
                event.error.content.find((block) => block.type === "text")?.text ||
                "Prompt failed.";
              recordBridgeEvent("prompt.failed", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                sessionId: sessionId || null,
              });
              recordBridgeError("app", message, "bun.sendPrompt", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                sessionId: sessionId || null,
              });
            }
            rpc.send.sendStreamEvent({ streamId: payload.streamId, event });
          },
        });

        sessionId = session.sessionId;
        recordBridgeLog("info", "Prompt dispatched to pi runtime.", "bun.sendPrompt", {
          model: model.id,
          provider: resolved.provider,
          sessionId,
        });
        return { sessionId };
      },
      cancelPrompt: async ({ sessionId }: { sessionId: string }): Promise<{ ok: boolean }> => {
        await workspaceSessionCatalog.cancelPrompt(sessionId);
        recordBridgeEvent("prompt.cancel.requested", { sessionId });
        return { ok: true };
      },
      setSessionModel: async ({
        sessionId,
        model,
      }: {
        sessionId: string;
        model: string;
      }): Promise<SessionMutationResponse> => {
        const result = await workspaceSessionCatalog.setSessionModel(sessionId, model);
        if (result.ok) {
          recordBridgeEvent("session.model.changed", { model, sessionId });
        } else {
          recordBridgeError(
            "rpc",
            `Session ${sessionId} was not found for model update.`,
            "bun.session",
            {
              model,
              sessionId,
            },
          );
        }
        return { ok: result.ok, sessionId: result.sessionId };
      },
      setSessionThoughtLevel: async ({
        sessionId,
        level,
      }: {
        sessionId: string;
        level: ReasoningEffort;
      }): Promise<SessionMutationResponse> => {
        const result = await workspaceSessionCatalog.setSessionThoughtLevel(sessionId, level);
        if (result.ok) {
          recordBridgeEvent("session.reasoning.changed", { level, sessionId });
        } else {
          recordBridgeError(
            "rpc",
            `Session ${sessionId} was not found for reasoning update.`,
            "bun.session",
            {
              level,
              sessionId,
            },
          );
        }
        return { ok: result.ok, sessionId: result.sessionId };
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
