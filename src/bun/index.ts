import { Updater, Utils } from "electrobun/bun";
import { getModels, getProviders } from "@mariozechner/pi-ai";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { IsoDateTimeStringSchema, normalizeDesktopBridgeErrorContract } from "@svvy/core";
import { createDesktopApp, type DesktopApp } from "@svvy/desktop";
import type {
  AbortPromptInput,
  ExtensionId,
  PromptTarget,
  ProviderAuthHealth,
  ProviderAuthStatus,
  ProviderId,
  RequestInputOptionId,
  RequestInputQuestionId,
  RequestInputRequestId,
  RuntimeApprovalId,
  RuntimeClientRequestId,
  RuntimeClientSubmissionSource,
  RuntimeSurfaceTarget,
  RequestUserInputAnswer,
  SteerQueuedMessageInput,
  SurfacePiSessionId,
  WorkspaceId,
  WorkspaceSessionId,
} from "@svvy/core";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  OpenWorkspaceRequest,
  ProviderAuthInfo,
  StateReadModelBaseline as DesktopStateReadModelBaseline,
  StateReadModelResult as DesktopStateReadModelResult,
  EditCommittedUserMessageResponse,
  SendPromptResponse,
  WorkspaceInfoResponse,
} from "../shared/workspace-contract";
import { DEFAULT_AGENT_SETTINGS, type AgentDefaults } from "../shared/agent-settings";
import {
  getCredential,
  getProviderEnvVar,
  removeCredential,
  resolveApiKey,
  resolveAuthState,
  setApiKey as storeApiKey,
} from "./auth-store";
import {
  getOAuthRefreshError,
  refreshIfNeeded,
  startOAuthLogin,
  supportsOAuth,
} from "./oauth-login";
import { decodePromptClientSubmissionToRuntimeInput } from "./session-catalog";
import { assertAgentModelSelection } from "./svvyx-workflows-command";
import { resolveWorkspaceCwd } from "./workspace-context";
import { WorkspaceRuntimeRegistry, type WorkspaceRuntime } from "./workspace-runtime-registry";
import { createPackagedSandboxHostSupportServices } from "./runtime-service-adapter";
import { RuntimeLayerConfigFromEnv } from "@svvy/runtime/bootstrap";
import { getWorkspaceRuntimeForRequest, stripWorkspaceId } from "./workspace-rpc-routing";
import {
  normalizeDesktopBridgeHandlers,
  submitPromptFromDesktop,
  writeCommandStdinFromDesktop,
} from "./desktop-bridge-requests";
import { createDesktopNotificationBridge } from "./desktop-notification-bridge";
import {
  createElectrobunDesktopHostAdapter,
  type ElectrobunDesktopHostAdapter,
  type ElectrobunRendererApiInput,
  type ElectrobunRpcHandlers,
} from "./electrobun-desktop-host";
import { runDesktopBootstrap } from "./desktop-bootstrap";
import { showStartupFailureSurface } from "./startup-failure-surface";
import {
  assertExtensionEnvSecretTarget,
  assertExtensionEnvWriteValue,
} from "./svvyx-extensions-command";
import { mapAppRuntimeLogSource } from "./app-runtime-log-source";
import { createExtensionCliRequirementProbeService } from "./extension-cli-requirement-probe";
import { createExtensionBuildProcessService } from "./extension-build-process";
import { createMacOsKeychainSecretStoreServices } from "./extension-env-secret-store";
import type {
  ProviderAuthReadModel,
  StateReadModelBaseline,
  StateReadModelRequest,
  StateReadModelResult,
} from "@svvy/state";

const DEV_SERVER_PORT = 5173;

const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const DEV_SERVER_WAIT_TIMEOUT_MS = 15_000;
const extensionSecretStoreServices = createMacOsKeychainSecretStoreServices();
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
let desktopHost: ElectrobunDesktopHostAdapter | null = null;
const startupWorkspaceCwd = resolveWorkspaceCwd();

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

function loadRuntimeEnv(cwd: string): void {
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

type DevBrowserToolsRecorder = {
  close: () => Promise<void>;
  recordError: (
    kind: "app" | "rpc",
    message: string,
    source: string,
    details?: Record<string, unknown>,
    error?: unknown,
  ) => void;
  recordEvent: (eventName: string, payload?: Record<string, unknown>) => void;
  recordLog: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    source: string,
    context?: Record<string, unknown>,
  ) => void;
};

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

async function getMainViewUrl(channel: string): Promise<string> {
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

function getWorkspacePathKind(absolutePath: string): "file" | "folder" | "missing" {
  try {
    return statSync(absolutePath).isDirectory() ? "folder" : "file";
  } catch {
    return "missing";
  }
}

async function openPathInPreferredEditor(
  runtime: WorkspaceRuntime,
  hostActions: ElectrobunRendererApiInput["hostActions"],
  path: string,
): Promise<{ opened: boolean; editor: string }> {
  const preferences = runtime.agentSettingsStore.getState().appPreferences;
  const result = await hostActions.editor.open({
    path,
    cwd: runtime.cwd,
    editor: preferences.preferredExternalEditor,
    customCommand: preferences.customExternalEditorCommand,
  });
  if (result.failure?.kind === "app-launch") {
    runtime.appLog.warning("external-editor", "External editor app launch failed.", {
      editor: result.editor,
      path,
      message: result.failure.message,
    });
  } else if (result.failure?.kind === "custom-command-empty") {
    runtime.appLog.warning("external-editor", "Custom external editor command is empty.", { path });
  } else if (result.failure?.kind === "custom-command-launch") {
    runtime.appLog.warning("external-editor", "Custom external editor command failed.", {
      command: result.failure.command,
      path,
      message: result.failure.message,
    });
  }
  return { opened: result.opened, editor: result.editor };
}

function providerOAuthExpiresAt(provider: string): string | null | undefined {
  const credential = getCredential(provider);
  if (!credential || credential.type !== "oauth") return undefined;
  return new Date(credential.credentials.expires).toISOString();
}

async function ensureUsableProviderAuth(provider: string): Promise<string | undefined> {
  if (supportsOAuth(provider)) {
    const credential = getCredential(provider);
    if (credential?.type === "oauth" && credential.credentials.expires <= Date.now()) {
      const refreshed = await refreshIfNeeded(provider);
      return refreshed;
    }
  }
  return resolveApiKey(provider);
}

function getProviderAuthUnavailableMessage(provider: string): string {
  const state = resolveAuthState(provider);
  if (state.keyType === "oauth") {
    const reason = state.refreshFailure?.message ?? getOAuthRefreshError(provider);
    if (state.refreshFailure) {
      return `OAuth credentials for ${provider} expired and could not be refreshed. ${reason}`;
    }
    return `OAuth credentials for ${provider} are expired. Reconnect the provider in Settings.`;
  }
  return getApiKeyMissingError(provider);
}

async function listProviderAuthSummaries(
  options: { refreshOAuth?: boolean } = {},
): Promise<ProviderAuthInfo[]> {
  const providerIds = getProviders();
  return Promise.all(
    providerIds.map(async (provider) => {
      const state = resolveAuthState(provider);
      let authHealth: ProviderAuthInfo["authHealth"] = state.usable ? "available" : "missing";
      let expiresAt = providerOAuthExpiresAt(provider);
      let authError: string | undefined;
      let authFailedAt: string | undefined;

      if (state.keyType === "oauth") {
        const credential = getCredential(provider);
        const expired = Boolean(
          credential?.type === "oauth" && credential.credentials.expires <= Date.now(),
        );
        if (state.refreshFailure) {
          authHealth = "oauth-refresh-failed";
          authError = state.refreshFailure.message;
          authFailedAt = state.refreshFailure.occurredAt;
        } else if (expired) {
          authHealth = "oauth-expired";
          if (options.refreshOAuth) {
            const refreshed = await refreshIfNeeded(provider);
            if (refreshed) {
              authHealth = "available";
              expiresAt = providerOAuthExpiresAt(provider);
            } else {
              authHealth = "oauth-refresh-failed";
              const refreshedState = resolveAuthState(provider);
              authError =
                refreshedState.refreshFailure?.message ??
                getOAuthRefreshError(provider) ??
                "OAuth refresh failed.";
              authFailedAt = refreshedState.refreshFailure?.occurredAt ?? undefined;
            }
          }
        }
      }

      return {
        provider,
        hasKey: state.connected,
        keyType: state.keyType,
        supportsOAuth: supportsOAuth(provider),
        authHealth,
        expiresAt: expiresAt ?? null,
        ...(authError ? { authError } : {}),
        ...(authFailedAt ? { authFailedAt } : {}),
      };
    }),
  );
}

let devBrowserToolsRecorder: DevBrowserToolsRecorder = {
  close: async () => {},
  recordError: () => {},
  recordEvent: () => {},
  recordLog: () => {},
};
let devBrowserToolsMetadata: { appId: string; url?: string } | null = null;

const recordDevBrowserToolsEvent: DevBrowserToolsRecorder["recordEvent"] = (...args) =>
  devBrowserToolsRecorder.recordEvent(...args);
const recordDevBrowserToolsLog: DevBrowserToolsRecorder["recordLog"] = (...args) =>
  devBrowserToolsRecorder.recordLog(...args);
const recordDevBrowserToolsError: DevBrowserToolsRecorder["recordError"] = (...args) =>
  devBrowserToolsRecorder.recordError(...args);

loadRuntimeEnv(startupWorkspaceCwd);

const runtimeConfigEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const runtimeLayerConfig = Effect.runSync(
  RuntimeLayerConfigFromEnv.parse(ConfigProvider.fromEnv({ env: runtimeConfigEnv })),
);
const extensionCliRequirementProbe = createExtensionCliRequirementProbeService({
  executableSearchPath: runtimeConfigEnv.PATH ?? "",
});
const extensionBuildProcess = createExtensionBuildProcessService({
  executable: process.execPath,
  env: {},
});

const workspaceRuntimeRegistry = new WorkspaceRuntimeRegistry({
  initialCwd: startupWorkspaceCwd,
  openInitialWorkspace: !!process.env.SVVY_WORKSPACE_CWD,
  runtimeLayerConfig,
  sandboxHostSupport: createPackagedSandboxHostSupportServices(),
  extensionCliRequirementProbe,
  extensionBuildProcess,
  secretStore: extensionSecretStoreServices.secretStore,
  secretStoreMutation: extensionSecretStoreServices.secretStoreMutation,
  forwardBridgeLog: (level, message, source, details, error) => {
    if (level === "error") {
      recordDevBrowserToolsError("app", message, source, details, error);
      return;
    }
    recordDevBrowserToolsLog(level, message, source, details);
  },
  runtimeDependencies: {
    ensureUsableProviderAuth,
    getProviderAuthUnavailableMessage,
  },
});

function recordAppRuntimeLog(
  level: "info" | "warning",
  message: string,
  source: string,
  details?: Record<string, unknown>,
): void {
  const runtime = workspaceRuntimeRegistry.getActiveRuntimeOrNull();
  if (!runtime) {
    recordDevBrowserToolsLog(level === "warning" ? "warn" : level, message, source, details);
    return;
  }
  runtime.appLog[level](mapAppRuntimeLogSource(source), message, details);
}

function recordAppRuntimeError(
  kind: string,
  message: string,
  source: string,
  details?: Record<string, unknown>,
  error?: unknown,
): void {
  const runtime = workspaceRuntimeRegistry.getActiveRuntimeOrNull();
  if (!runtime) {
    recordDevBrowserToolsError(kind === "rpc" ? "rpc" : "app", message, source, details, error);
    return;
  }
  runtime.appLog.error(
    mapAppRuntimeLogSource(source, kind === "rpc" ? "rpc" : "app"),
    message,
    error,
    details,
  );
}

function getWorkspaceRuntime(input: Parameters<typeof getWorkspaceRuntimeForRequest>[1]) {
  return getWorkspaceRuntimeForRequest(workspaceRuntimeRegistry, input);
}

function nowIso(): typeof IsoDateTimeStringSchema.Type {
  return new Date().toISOString() as typeof IsoDateTimeStringSchema.Type;
}

function rpcClientSubmission(operation: string) {
  return {
    clientRequestId: `${operation}:${randomUUID()}` as RuntimeClientRequestId,
    source: "renderer-rpc" as RuntimeClientSubmissionSource,
  };
}

function requireStateReadModel<Kind extends StateReadModelResult["kind"]>(
  result: StateReadModelResult,
  kind: Kind,
): Extract<StateReadModelResult, { kind: Kind }> {
  if (result.kind !== kind) {
    throw new Error(`Expected state read model ${kind}; received ${result.kind}.`);
  }
  return result as Extract<StateReadModelResult, { kind: Kind }>;
}

function desktopStateReadModelResult(result: StateReadModelResult): DesktopStateReadModelResult {
  if (result.kind !== "workflowsGenerated") {
    return result as DesktopStateReadModelResult;
  }
  return {
    kind: "workflowsGenerated",
    value: {
      packageName: "@svvyx/workflows",
      facts: result.value.facts.flatMap((fact) =>
        fact.packageName === "@svvyx/workflows"
          ? [
              {
                packageName: "@svvyx/workflows" as const,
                status: fact.status,
                buildId: fact.buildId,
                manifestPath: fact.manifestPath,
                diagnostics: fact.diagnostics,
                refreshNeededReason: fact.refreshNeededReason,
                updatedAt: fact.updatedAt,
              },
            ]
          : [],
      ),
      exports: result.value.exports,
    },
  };
}

async function readActiveWorkspaceFromState(): Promise<WorkspaceInfoResponse | null> {
  const state = await workspaceRuntimeRegistry.getRendererStateFacade();
  const result = requireStateReadModel(
    await state.readModels.fetch({ kind: "workspaceChrome" }),
    "workspaceChrome",
  );
  const activeTab = result.value.tabs.find(
    (tab) => tab.workspaceTabId === result.value.activeWorkspaceTabId,
  );
  if (!activeTab) {
    return null;
  }
  return addWorkspaceBranch({
    workspaceId: activeTab.workspaceId,
    cwd: activeTab.cwd,
    workspaceLabel: activeTab.workspaceLabel,
    kind: activeTab.kind,
  });
}

function desktopStateReadModelBaseline(
  baseline: StateReadModelBaseline,
): DesktopStateReadModelBaseline {
  return {
    app: baseline.app.map(desktopStateReadModelResult),
    workspaces: baseline.workspaces.map(desktopStateReadModelResult),
    revision: baseline.revision,
  };
}

function providerHealthFromInfo(info: ProviderAuthInfo): ProviderAuthHealth {
  switch (info.authHealth) {
    case "available":
      return "usable";
    case "oauth-expired":
      return "expired";
    case "oauth-refresh-failed":
      return "refresh_failed";
    case "missing":
      return "missing";
  }
}

function providerInfoFromStatus(
  status: ProviderAuthStatus,
  fallback: ProviderAuthInfo | undefined,
): ProviderAuthInfo {
  const authHealth =
    status.health === "usable"
      ? "available"
      : status.health === "expired"
        ? "oauth-expired"
        : status.health === "refresh_failed"
          ? "oauth-refresh-failed"
          : "missing";
  return {
    provider: status.providerId,
    hasKey: status.health !== "missing",
    keyType: fallback?.keyType ?? (status.health === "missing" ? "none" : "apikey"),
    supportsOAuth: fallback?.supportsOAuth ?? supportsOAuth(status.providerId),
    authHealth,
    expiresAt: status.expiresAt ?? fallback?.expiresAt ?? null,
    ...(status.issue
      ? { authError: status.issue }
      : fallback?.authError
        ? { authError: fallback.authError }
        : {}),
    ...(fallback?.authFailedAt ? { authFailedAt: fallback.authFailedAt } : {}),
  };
}

async function syncProviderAuthStatusesWithState(input: {
  refreshOAuth: boolean;
  source: "startup_scan" | "user_action";
  stateCommands?: ElectrobunRendererApiInput["commands"]["state"];
}): Promise<ProviderAuthInfo[]> {
  const summaries = await listProviderAuthSummaries({ refreshOAuth: input.refreshOAuth });
  const stateCommands =
    input.stateCommands ?? (await workspaceRuntimeRegistry.getStateCommandsFacade());
  const observedAt = nowIso();
  await Promise.all(
    summaries.map((summary) =>
      stateCommands.providerAuth.recordStatus({
        status: {
          providerId: summary.provider as ProviderId,
          health: providerHealthFromInfo(summary),
          ...(summary.expiresAt
            ? { expiresAt: summary.expiresAt as typeof IsoDateTimeStringSchema.Type }
            : {}),
          ...(summary.authError ? { issue: summary.authError } : {}),
        },
        observedAt,
        source: input.source,
        clientSubmission: rpcClientSubmission(`provider-auth:${summary.provider}`),
      }),
    ),
  );
  return summaries;
}

function providerAuthInfosFromReadModel(
  readModel: ProviderAuthReadModel,
  fallbacks: readonly ProviderAuthInfo[],
): ProviderAuthInfo[] {
  const byProvider = new Map(fallbacks.map((info) => [info.provider, info]));
  return readModel.providers.map((status) =>
    providerInfoFromStatus(status, byProvider.get(status.providerId)),
  );
}

function addWorkspaceBranch<T extends { cwd: string }>(info: T): T & { branch?: string } {
  const branch = getWorkspaceBranch(info.cwd);
  return {
    ...info,
    ...(branch ? { branch } : {}),
  };
}

function buildDesktopRpcHandlers(
  facades: ElectrobunRendererApiInput,
  lifecycle: { readonly rendererReady: () => void },
): ElectrobunRpcHandlers {
  const fetchStateReadModel = (request: StateReadModelRequest): Promise<StateReadModelResult> =>
    facades.state.readModels.fetch(request);
  const fetchDesktopStateReadModel = (
    request: StateReadModelRequest,
  ): Promise<DesktopStateReadModelResult> =>
    fetchStateReadModel(request).then(desktopStateReadModelResult);
  const validateAgentProfileModel = async (
    workspaceId: string,
    profile: {
      providerId: string;
      modelId: string;
      reasoning?: { effort: AgentDefaults["reasoningEffort"] };
    },
  ): Promise<void> => {
    const metadata = await facades.modelMetadata.list({
      workspaceId: workspaceId as WorkspaceId,
      providerId: profile.providerId as ProviderId,
    });
    const selected = metadata.find(
      (model) => model.providerId === profile.providerId && model.modelId === profile.modelId,
    );
    assertAgentModelSelection(
      {
        providerId: profile.providerId,
        modelId: profile.modelId,
        reasoningEffort:
          profile.reasoning?.effort ??
          selected?.supportedReasoning[0] ??
          DEFAULT_AGENT_SETTINGS.reasoningEffort,
      },
      metadata.map((model) => ({
        providerId: model.providerId,
        modelId: model.modelId,
        providerAuthenticated: model.authStatus.health === "usable",
        authSource: model.authStatus.health === "usable" ? "apikey" : "missing",
        supportedReasoning: [...model.supportedReasoning],
        capabilities: {
          reasoning: model.supportsReasoning,
          vision: model.inputModalities.includes("image"),
          toolCalling: true,
        },
      })),
    );
  };

  return normalizeDesktopBridgeHandlers<ElectrobunRpcHandlers>({
    requests: {
      rendererReady: async () => {
        lifecycle.rendererReady();
        return { ok: true };
      },
      previewGeneratedContext: (input) => facades.runtime.generatedContext.preview(input),
      listModelMetadata: (input) => facades.modelMetadata.list(input),
      getExtensionSnapshots: (input) => facades.runtime.extensions.snapshots.list(input),
      saveExtensionSnapshot: (input) => facades.runtime.extensions.snapshots.save(input),
      renameExtensionSnapshot: (input) => facades.runtime.extensions.snapshots.rename(input),
      deleteExtensionSnapshot: (input) => facades.runtime.extensions.snapshots.delete(input),
      loadExtensionSnapshot: (input) => facades.runtime.extensions.snapshots.load(input),
      createExtension: (input) => facades.runtime.extensions.create(input),
      duplicateExtension: (input) => facades.runtime.extensions.duplicate(input),
      deleteExtension: (input) => facades.runtime.extensions.delete(input),
      configureExtensionTypescriptApi: (input) =>
        facades.runtime.sourceEdits.configureTypescriptApi(input),
      resetExtension: (input) => facades.runtime.extensions.reset(input),
      buildExtension: (input) => facades.runtime.extensions.build(input),
      addExtensionInstructionFile: (input) => facades.runtime.extensions.addInstruction(input),
      removeExtensionInstructionFile: (input) =>
        facades.runtime.extensions.removeInstruction(input),
      configureExtensionInstructionFile: (input) =>
        facades.runtime.extensions.configureInstruction(input),
      stateExtensionEnvSetSecret: async (input) => {
        getWorkspaceRuntime(input);
        const { extensionId, envName, value } = input;
        assertExtensionEnvSecretTarget({ extensionId, envName });
        assertExtensionEnvWriteValue(value);
        const stateCommands = await workspaceRuntimeRegistry.getStateCommandsFacade();
        return stateCommands.extensionEnv.setSecret({
          extensionId,
          envName,
          secretValue: Redacted.make(value, { label: "extension-env-secret" }),
          clientSubmission: rpcClientSubmission(
            `extension-env:set-secret:${extensionId}:${envName}`,
          ),
        } as never);
      },
      stateExtensionEnvRemoveSecret: async (input) => {
        getWorkspaceRuntime(input);
        const { extensionId, envName } = input;
        assertExtensionEnvSecretTarget({ extensionId, envName });
        const stateCommands = await workspaceRuntimeRegistry.getStateCommandsFacade();
        return stateCommands.extensionEnv.removeSecret({
          extensionId,
          envName,
          clientSubmission: rpcClientSubmission(
            `extension-env:remove-secret:${extensionId}:${envName}`,
          ),
        } as never);
      },
      stateExtensionEnvSetOverride: (input) =>
        facades.commands.state.extensionEnv.setOverride(stripWorkspaceId(input) as never),
      stateExtensionEnvRemoveOverride: (input) =>
        facades.commands.state.extensionEnv.removeOverride(stripWorkspaceId(input) as never),
      fetchStateReadModel: fetchDesktopStateReadModel,
      refetchStateReadModels: async (request) =>
        Promise.all(
          request.requests.map((readModelRequest) => fetchDesktopStateReadModel(readModelRequest)),
        ),
      refetchStateReadModelInvalidation: async (request) =>
        (await facades.state.readModels.refetchInvalidation(request)).map(
          desktopStateReadModelResult,
        ),
      rebaselineStateReadModels: async (request) =>
        desktopStateReadModelBaseline(await facades.state.readModels.rebaseline(request)),
      stateAppLogsMarkRead: (request) => facades.commands.state.appLogs.markRead(request),
      stateSessionNavigationSetPinned: async (request) =>
        (await workspaceRuntimeRegistry.getStateCommandsFacade()).sessionNavigation.setPinned(
          request,
        ),
      stateSessionNavigationSetArchived: async (request) =>
        (await workspaceRuntimeRegistry.getStateCommandsFacade()).sessionNavigation.setArchived(
          request,
        ),
      stateSessionNavigationMarkRead: async (request) =>
        (await workspaceRuntimeRegistry.getStateCommandsFacade()).sessionNavigation.markRead(
          request,
        ),
      stateSessionNavigationMarkUnread: async (request) =>
        (await workspaceRuntimeRegistry.getStateCommandsFacade()).sessionNavigation.markUnread(
          request,
        ),
      stateSessionNavigationSetSectionState: async (request) =>
        (await workspaceRuntimeRegistry.getStateCommandsFacade()).sessionNavigation.setSectionState(
          request,
        ),
      stateAppPreferencesUpdate: async (request) => {
        const runtime = workspaceRuntimeRegistry.getActiveRuntimeOrNull();
        runtime?.appLog.info("settings", "App preferences updated.", {
          appearance: request.patch.appearance,
          externalEditor: request.patch.externalEditor,
        });
        const result = await facades.commands.state.appPreferences.update(request);
        await workspaceRuntimeRegistry.hydrateStateOwnedAppPreferencesFromStateRows();
        await workspaceRuntimeRegistry.refreshExternalInstructionSourceInputs(
          "app-preferences:external-instructions-updated",
        );
        const defaultRuntime = await workspaceRuntimeRegistry.getDefaultWorkspace();
        for (const workspace of workspaceRuntimeRegistry.listOpenWorkspaces()) {
          if (workspace.workspaceId === defaultRuntime.workspaceId) continue;
          await workspaceRuntimeRegistry
            .getRuntime(workspace.workspaceId)
            .catalog.notifyAppPreferencesChanged();
        }
        await defaultRuntime.catalog.notifyAppPreferencesChanged();
        return result;
      },
      stateAgentProfilesUpdateOrchestrator: async (request) => {
        await validateAgentProfileModel(request.workspaceId, request.profile);
        return facades.commands.state.agentProfiles.updateOrchestrator(stripWorkspaceId(request));
      },
      stateAgentProfilesUpdateThreadHandler: async (request) => {
        await validateAgentProfileModel(request.workspaceId, request.profile);
        return facades.commands.state.agentProfiles.updateThreadHandler(stripWorkspaceId(request));
      },
      stateAgentProfilesDeleteOrchestrator: (request) =>
        facades.commands.state.agentProfiles.deleteOrchestrator(stripWorkspaceId(request)),
      stateAgentProfilesReorderOrchestrators: (request) =>
        facades.commands.state.agentProfiles.reorderOrchestrators(stripWorkspaceId(request)),
      stateAgentProfilesSetExtensionUsage: (request) =>
        facades.commands.state.agentProfiles.setProfileExtensionUsage(stripWorkspaceId(request)),
      stateAgentProfilesPromoteExtensionDefault: (request) =>
        facades.commands.state.agentProfiles.promoteExtensionDefault(stripWorkspaceId(request)),
      stateAgentProfilesResetExtensionDefaults: (request) =>
        facades.commands.state.agentProfiles.resetActorExtensionDefaults(stripWorkspaceId(request)),
      stateAgentProfilesSetExternalInstructionUsage: (request) =>
        facades.commands.state.agentProfiles.setExternalInstructionActorUsage(
          stripWorkspaceId(request),
        ),
      stateSnippetsCreateManaged: (request) =>
        facades.commands.state.snippets.createManaged(request),
      stateSnippetsUpdateManaged: (request) =>
        facades.commands.state.snippets.updateManaged(request),
      stateSnippetsDeleteManaged: (request) =>
        facades.commands.state.snippets.deleteManaged(request),
      stateSnippetsSetEnabled: (request) => facades.commands.state.snippets.setEnabled(request),
      openSnippetSourceInEditor: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const readModelResult = await facades.state.readModels.fetch({
          kind: "snippets",
          workspaceId: input.workspaceId,
          snippetId: input.snippetId,
        });
        if (readModelResult.kind !== "snippets") {
          throw new Error(`Expected state read model snippets; received ${readModelResult.kind}.`);
        }
        const snippet = readModelResult.value.snippets.find(
          (candidate) => candidate.id === input.snippetId,
        );
        if (!snippet || snippet.source === "svvy" || snippet.path === null) {
          runtime.appLog.warning("external-editor", "Snippet source file is not discoverable.", {
            snippetId: input.snippetId,
          });
          throw new Error(`Discovered snippet source is not available: ${input.snippetId}`);
        }
        const result = await openPathInPreferredEditor(runtime, facades.hostActions, snippet.path);
        runtime.appLog.info("external-editor", "Snippet source opened in external editor.", {
          snippetId: snippet.id,
          path: snippet.path,
          editor: result.editor,
          opened: result.opened,
        });
        return { ...result, path: snippet.path };
      },
      openSourceEdit: (input) => facades.runtime.sourceEdits.open(input),
      saveSourceEdit: (input) => facades.runtime.sourceEdits.save(input),
      createWorkflowAgentSource: (input) => facades.runtime.sourceEdits.createWorkflowAgent(input),
      duplicateWorkflowAgentSource: (input) =>
        facades.runtime.sourceEdits.duplicateWorkflowAgent(input),
      deleteWorkflowAgentSource: (input) => facades.runtime.sourceEdits.deleteWorkflowAgent(input),
      openSourceInEditor: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const session = await facades.runtime.sourceEdits.open(stripWorkspaceId(input));
        const result = await openPathInPreferredEditor(runtime, facades.hostActions, session.path);
        runtime.appLog.info("external-editor", "Source opened in external editor.", {
          sourceKind: session.sourceKind,
          sourceId: session.sourceId,
          path: session.path,
          editor: result.editor,
          opened: result.opened,
        });
        return { ...result, path: session.path };
      },
      setRequestInputVariant: (input) => facades.runtime.requestInput.setVariant(input),
      setRequestInputBlockingTimeout: (input) =>
        facades.runtime.requestInput.setBlockingTimeout(input),
      openWorkspace: async (input: OpenWorkspaceRequest = {}) => {
        const { cwd } = input;
        let startingFolder = workspaceRuntimeRegistry.getInitialCwd();
        if (!cwd) {
          try {
            startingFolder = (await readActiveWorkspaceFromState())?.cwd ?? startingFolder;
          } catch (error) {
            recordDevBrowserToolsError(
              "app",
              "Unable to resolve the selected workspace for the folder picker.",
              "workspace.chrome",
              {},
              error,
            );
          }
        }
        const selectedCwd =
          cwd ??
          (await facades.hostActions.dialogs.pickFolder({ startingFolder })).selectedPaths[0];
        if (!selectedCwd) return { workspace: null };
        const workspace = await facades.appActions.workspaces.acquireByCwd({ cwd: selectedCwd });
        recordDevBrowserToolsEvent("workspace.opened", { workspaceId: workspace.workspaceId });
        return { workspace: addWorkspaceBranch(workspace) };
      },
      getDefaultWorkspace: async () => {
        return addWorkspaceBranch(await facades.appActions.workspaces.acquireDefault());
      },
      stateWorkspaceChromeSetTabs: (request) =>
        facades.commands.state.workspaceChrome.setTabs(request),
      stateWorkspaceChromeSelectTab: (request) =>
        facades.commands.state.workspaceChrome.selectTab(request),
      stateWorkspaceChromeSelectLayoutSlot: (request) =>
        facades.commands.state.workspaceChrome.selectLayoutSlot(request),
      stateWorkspaceLayoutSaveSlot: (request) =>
        facades.commands.state.workspaceLayout.saveSlot(request),
      closeWorkspace: async ({ workspaceId }) => {
        const { released } = await facades.appActions.workspaces.releaseVisual({ workspaceId });
        recordDevBrowserToolsEvent("workspace.closed", { workspaceId, closed: released });
        return { ok: released };
      },
      listWorkspaceBranches: async (input) => {
        const result = await facades.appActions.git.listBranches(input);
        return {
          ...(result.currentBranch ? { currentBranch: result.currentBranch } : {}),
          branches: result.branches.map((branch) => ({ ...branch })),
        };
      },
      switchWorkspaceBranch: async (input) => {
        const result = await facades.appActions.git.switchBranch(input);
        if (result.ok && result.switched) {
          recordDevBrowserToolsEvent("workspace.branch-switched", {
            workspaceId: input.workspaceId,
            branch: input.branch.trim(),
          });
        }
        return result.ok
          ? { ok: true, workspace: result.workspace }
          : { ok: false, workspace: result.workspace, error: result.error };
      },
      writeClipboardText: (input) => facades.hostActions.clipboard.writeText(input),
      listWorkspacePaths: async (input) =>
        (await facades.appActions.workspaceFiles.listPaths(input)).map((entry) => ({ ...entry })),
      pickWorkspaceAttachments: async (input) => {
        const { cwd } = await facades.appActions.workspaceFiles.getRoot(input);
        const { selectedPaths } = await facades.hostActions.dialogs.pickFilesAndFolders({
          startingFolder: cwd,
        });
        const result = await facades.appActions.workspaceFiles.materializeSelectedAttachments({
          workspaceId: input.workspaceId,
          selectedPaths,
        });
        return { attachments: [...result.attachments], skippedPaths: [...result.skippedPaths] };
      },
      importComposerAttachments: async (input) => {
        const result = await facades.appActions.workspaceFiles.importComposerAttachments(input);
        return { attachments: [...result.attachments], skippedPaths: [...result.skippedPaths] };
      },
      openWorkspacePath: async (input) => {
        const target = await facades.appActions.workspaceFiles.resolvePathTarget(input);
        if (target.kind === "missing") return { opened: false, kind: target.kind };
        if (target.kind === "file") {
          await facades.hostActions.paths.reveal({ path: target.absolutePath });
          return { opened: true, kind: target.kind };
        }
        const { opened } = await facades.hostActions.paths.open({ path: target.absolutePath });
        return { opened, kind: target.kind };
      },
      openWorkflowsGeneratedExportInEditor: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const readModelResult = await facades.state.readModels.fetch({
          kind: "workflowsGenerated",
        });
        if (readModelResult.kind !== "workflowsGenerated") {
          throw new Error(
            `Expected state read model workflowsGenerated; received ${readModelResult.kind}.`,
          );
        }
        const generatedExport = readModelResult.value.exports.find(
          (candidate) => candidate.qualifiedName === input.qualifiedName,
        );
        const path =
          input.target === "source" ? generatedExport?.sourcePath : generatedExport?.generatedPath;
        if (!generatedExport || !path || getWorkspacePathKind(path) === "missing") {
          runtime.appLog.warning("external-editor", "Workflows export file does not exist.", {
            qualifiedName: input.qualifiedName,
            target: input.target,
          });
          throw new Error(
            `Workflows export ${input.target} file does not exist: ${input.qualifiedName}`,
          );
        }
        const result = await openPathInPreferredEditor(runtime, facades.hostActions, path);
        runtime.appLog.info("external-editor", "Workflows export opened in external editor.", {
          qualifiedName: generatedExport.qualifiedName,
          target: input.target,
          path,
          editor: result.editor,
          opened: result.opened,
        });
        return { ...result, path };
      },
      openExternalInstructionSourceInEditor: async (input) => {
        const target = await facades.appActions.externalInstructions.resolveEditorTarget(input);
        const result = await facades.hostActions.editor.open({
          path: target.path,
          cwd: target.cwd,
          editor: target.editor,
          customCommand: target.customCommand,
        });
        await facades.appActions.externalInstructions.recordEditorResult({
          workspaceId: input.workspaceId,
          sourceId: target.sourceId,
          path: target.path,
          opened: result.opened,
          editor: result.editor,
          ...(result.failure ? { failure: result.failure } : {}),
        });
        return { opened: result.opened, editor: result.editor, path: target.path };
      },
      writeCommandStdin: async (input) => {
        return await writeCommandStdinFromDesktop({
          operation: "desktop.writeCommandStdin",
          payload: stripWorkspaceId(input),
          runtimeCommands: facades.commands.runtime,
        });
      },
      getArtifactPreview: async (input) => {
        return await facades.appActions.artifacts.preview({
          workspaceId: input.workspaceId,
          workspaceSessionId: input.sessionId,
          artifactId: input.artifactId,
        });
      },
      createOrchestratorSurface: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { title, agentProfileId } = input;
        const session = await facades.runtime.surfaces.createOrchestrator({
          workspaceId: input.workspaceId as WorkspaceId,
          ...(title === undefined ? {} : { title }),
          ...(agentProfileId === undefined ? {} : { profileId: agentProfileId as never }),
        });
        recordDevBrowserToolsEvent("session.created", {
          sessionId: session.workspaceSessionId,
          title: title?.trim() || null,
        });
        runtime.appLog.info("session", "Workspace session created.", {
          workspaceSessionId: session.workspaceSessionId,
        });
        return session;
      },
      openSurface: async (input) => {
        const { target } = input;
        const opened = await facades.runtime.surfaces.open({
          workspaceId: input.workspaceId as WorkspaceId,
          target: target as RuntimeSurfaceTarget,
        });
        recordDevBrowserToolsEvent("surface.opened", {
          surface: target.surface,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        return { target: opened.target as typeof target };
      },
      closeSurface: async (input) => {
        const { target } = input;
        const result = await facades.runtime.surfaces.close({
          workspaceId: input.workspaceId as WorkspaceId,
          target: target as RuntimeSurfaceTarget,
          closeReason: "pane-closed",
        });
        recordDevBrowserToolsEvent("surface.closed", {
          surface: target.surface,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        return {
          target: result.target as typeof target,
          lifecycle: result.lifecycle,
        };
      },
      renameSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId, title } = input;
        await facades.runtime.surfaces.renameOrchestrator({
          workspaceId: input.workspaceId as WorkspaceId,
          workspaceSessionId: sessionId as WorkspaceSessionId,
          title,
        });
        recordDevBrowserToolsEvent("session.renamed", {
          sessionId,
          title,
        });
        runtime.appLog.info("session", "Workspace session renamed.", {
          workspaceSessionId: sessionId,
          title,
        });
        return { ok: true };
      },
      forkSession: async (input) => {
        const { sessionId, title, messageTimestamp } = input;
        const session = await facades.runtime.surfaces.forkOrchestrator({
          workspaceId: input.workspaceId as WorkspaceId,
          workspaceSessionId: sessionId as WorkspaceSessionId,
          ...(title !== undefined ? { title } : {}),
          ...(messageTimestamp !== undefined ? { messageTimestamp } : {}),
        });
        recordDevBrowserToolsEvent("session.forked", {
          sessionId,
          targetSessionId: session.target.workspaceSessionId,
          messageTimestamp: messageTimestamp ?? null,
          title: title?.trim() || null,
        });
        return { target: session.target as PromptTarget };
      },
      deleteSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        await facades.runtime.surfaces.deleteOrchestrator({
          workspaceId: input.workspaceId as WorkspaceId,
          workspaceSessionId: sessionId as WorkspaceSessionId,
        });
        recordDevBrowserToolsEvent("session.deleted", { sessionId });
        runtime.appLog.info("session", "Workspace session deleted.", {
          workspaceSessionId: sessionId,
        });
        return { ok: true };
      },
      sendPrompt: async (payload): Promise<SendPromptResponse> => {
        return await submitPromptFromDesktop({
          operation: "desktop.sendPrompt",
          payload: stripWorkspaceId(payload),
          workspaceId: payload.workspaceId as WorkspaceId,
          fetchStateReadModel,
          runtimeMessages: facades.runtime.messages,
        });
      },
      recordRendererTelemetry: async (payload) => {
        const level = payload.level ?? "debug";
        const details = {
          eventName: payload.eventName,
          correlationId: payload.correlationId ?? null,
          panelId: payload.panelId ?? null,
          ...payload.details,
          workspaceSessionId: payload.target?.workspaceSessionId,
          surfacePiSessionId: payload.target?.surfacePiSessionId,
          surface: payload.target?.surface,
          threadId: payload.target?.threadId,
        };
        recordDevBrowserToolsEvent(`renderer.${payload.eventName}`, {
          level,
          ...details,
          errorName: payload.error?.name,
          errorMessage: payload.error?.message,
        });
        return facades.appActions.telemetry.recordRenderer(payload);
      },
      updateComposerDraft: async (input) => {
        const result = await facades.runtime.messages.updateDraft({
          target: input.target as Parameters<
            typeof facades.runtime.messages.updateDraft
          >[0]["target"],
          draft: input.draft,
        });
        return { ok: true, target: result.target };
      },
      editCommittedUserMessage: async (payload): Promise<EditCommittedUserMessageResponse> => {
        const runtime = getWorkspaceRuntime(payload);
        const result = await facades.runtime.messages.editCommitted({
          workspaceId: payload.workspaceId as never,
          target: payload.target as never,
          messageId: payload.messageId as never,
          messageTimestamp: payload.messageTimestamp,
          message: payload.message,
          clientSubmission: payload.clientSubmission as never,
        });
        runtime.appLog.info("prompt", "Committed user message edited.", {
          workspaceSessionId: payload.target.workspaceSessionId,
          surfacePiSessionId: payload.target.surfacePiSessionId,
          threadId: payload.target.threadId,
          messageTimestamp: String(payload.messageTimestamp),
        });
        return { target: result.target };
      },
      deleteQueuedSurfaceMessage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const abortInput = {
          target: input.target as AbortPromptInput["target"],
          mode: "queued",
          queuedMessageId: input.queuedMessageId as Extract<
            AbortPromptInput,
            { readonly mode: "queued" }
          >["queuedMessageId"],
          reason: "Deleted queued surface message.",
        } satisfies AbortPromptInput;
        await facades.runtime.messages.abort(abortInput);
        runtime.appLog.info("prompt", "Queued surface message deleted.", {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
          queuedMessageId: input.queuedMessageId,
        });
        return { ok: true, target: input.target };
      },
      editQueuedSurfaceMessage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await facades.runtime.queues.restoreToComposer({
          target: input.target as Parameters<
            typeof facades.runtime.queues.restoreToComposer
          >[0]["target"],
          queuedMessageId: input.queuedMessageId as Parameters<
            typeof facades.runtime.queues.restoreToComposer
          >[0]["queuedMessageId"],
        });
        runtime.appLog.info("prompt", "Queued surface message restored to composer.", {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
          queuedMessageId: input.queuedMessageId,
        });
        return { ok: true, text: result.text };
      },
      reorderQueuedSurfaceMessage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await facades.runtime.queues.reorder({
          target: input.target as Parameters<typeof facades.runtime.queues.reorder>[0]["target"],
          queuedMessageId: input.queuedMessageId as Parameters<
            typeof facades.runtime.queues.reorder
          >[0]["queuedMessageId"],
          beforeQueuedMessageId: input.beforeQueuedMessageId as Parameters<
            typeof facades.runtime.queues.reorder
          >[0]["beforeQueuedMessageId"],
        });
        runtime.appLog.info("prompt", "Queued surface messages reordered.", {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
          queuedMessageId: input.queuedMessageId,
          beforeQueuedMessageId: input.beforeQueuedMessageId ?? null,
        });
        return { ok: true, target: result.target };
      },
      steerQueuedSurfaceMessage: async (input) => {
        await facades.runtime.queues.steer({
          target: input.target as SteerQueuedMessageInput["target"],
          queuedMessageId: input.queuedMessageId as SteerQueuedMessageInput["queuedMessageId"],
        });
        return { ok: true, target: input.target };
      },
      answerRequestUserInput: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const answerResult = await facades.runtime.requestInput.answer({
          surfacePiSessionId: input.surfacePiSessionId as SurfacePiSessionId,
          requestId: input.requestId as RequestInputRequestId,
          questionId: input.questionId as RequestInputQuestionId,
          answer:
            input.answer.kind === "option"
              ? {
                  kind: "option",
                  optionId: input.answer.optionId as RequestInputOptionId,
                }
              : ({ kind: "custom", text: input.answer.text } satisfies RequestUserInputAnswer),
          delivery: input.delivery,
          ...(input.clientSubmission
            ? {
                clientSubmission: decodePromptClientSubmissionToRuntimeInput(
                  input.clientSubmission,
                ),
              }
            : {}),
        });
        runtime.appLog.info("prompt", "Request user input answered.", {
          surfacePiSessionId: input.surfacePiSessionId,
          requestId: input.requestId,
          questionId: input.questionId,
          delivery: input.delivery,
          queuedItemId: answerResult.delivery.queuedItemId,
          answerStatus: answerResult.status,
          answerDeliveryKind: answerResult.delivery.kind,
        });
        return answerResult;
      },
      answerRuntimeApprovalRequest: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const answerResult = await facades.runtime.approvals.answer({
          approvalId: input.requestId as RuntimeApprovalId,
          decision: input.approved ? "approved" : "denied",
          ...(input.reason === undefined ? {} : { reason: input.reason ?? "" }),
        });
        runtime.appLog.info("direct-tool", "Runtime approval request answered.", {
          requestId: input.requestId,
          approved: input.approved,
        });
        return answerResult;
      },
      setRequestUserInputTimerPaused: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await facades.runtime.requestInput.setTimerPaused({
          surfacePiSessionId: input.surfacePiSessionId as SurfacePiSessionId,
          requestId: input.requestId as RequestInputRequestId,
          paused: input.paused,
          ...(input.clientSubmission
            ? {
                clientSubmission: decodePromptClientSubmissionToRuntimeInput(
                  input.clientSubmission,
                ),
              }
            : {}),
        });
        runtime.appLog.info("prompt", "Request user input timer updated.", {
          surfacePiSessionId: input.surfacePiSessionId,
          requestId: input.requestId,
          paused: input.paused,
        });
        return result;
      },
      cancelPrompt: async (input): Promise<{ ok: boolean }> => {
        await facades.runtime.messages.abort({
          target: input.target as AbortPromptInput["target"],
          mode: "all-for-surface",
        });
        return { ok: true };
      },
      setSurfaceModel: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { target, provider, model } = input;
        const result = await facades.runtime.surfaces.updateModel({
          workspaceId: input.workspaceId as WorkspaceId,
          target: target as PromptTarget,
          provider,
          model,
        });
        recordDevBrowserToolsEvent("surface.model.changed", {
          model,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        runtime.appLog.info("surface", "Surface model changed.", {
          model,
          provider,
          workspaceSessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId,
        });
        return { ok: true, target: result.target };
      },
      setSurfaceThoughtLevel: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { target, level } = input;
        const result = await facades.runtime.surfaces.updateReasoning({
          workspaceId: input.workspaceId as WorkspaceId,
          target: target as PromptTarget,
          reasoningEffort: level,
        });
        recordDevBrowserToolsEvent("surface.reasoning.changed", {
          level,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        runtime.appLog.info("surface", "Surface reasoning changed.", {
          level,
          workspaceSessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId,
        });
        return { ok: true, target: result.target };
      },
      setSurfaceExtensionUsage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { target, extensionId, state } = input;
        const result = await facades.runtime.surfaces.updateExtensionUsage({
          workspaceId: input.workspaceId as WorkspaceId,
          target: target as PromptTarget,
          extensionId: extensionId as ExtensionId,
          usage: state,
        });
        recordDevBrowserToolsEvent("surface.extension.changed", {
          extensionId,
          state,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        runtime.appLog.info("surface", "Surface extension usage changed.", {
          extensionId,
          state,
          workspaceSessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId,
        });
        return { ok: true, target: result.target };
      },
      listProviderAuths: async (): Promise<ProviderAuthInfo[]> => {
        const fallbacks = await listProviderAuthSummaries({ refreshOAuth: false });
        const result = requireStateReadModel(
          await facades.state.readModels.fetch({ kind: "providerAuth" }),
          "providerAuth",
        );
        return providerAuthInfosFromReadModel(result.value, fallbacks);
      },
      setProviderApiKey: async ({
        providerId,
        apiKey,
      }: {
        providerId: string;
        apiKey: string;
      }): Promise<{ ok: boolean }> => {
        storeApiKey(providerId, apiKey);
        recordDevBrowserToolsEvent("provider.auth.updated", {
          keyType: "apikey",
          providerId,
        });
        workspaceRuntimeRegistry
          .getActiveRuntimeOrNull()
          ?.appLog.info("auth.provider", "Provider auth updated.", {
            providerId,
            keyType: "apikey",
          });
        await syncProviderAuthStatusesWithState({
          refreshOAuth: false,
          source: "user_action",
          stateCommands: facades.commands.state,
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
          recordDevBrowserToolsEvent("provider.oauth.started", { providerId });
          workspaceRuntimeRegistry
            .getActiveRuntimeOrNull()
            ?.appLog.info("auth.provider", "Provider OAuth started.", { providerId });
          await syncProviderAuthStatusesWithState({
            refreshOAuth: false,
            source: "user_action",
            stateCommands: facades.commands.state,
          });
          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          workspaceRuntimeRegistry
            .getActiveRuntimeOrNull()
            ?.appLog.warning("auth.provider", "Provider OAuth failed.", { providerId, message });
          recordAppRuntimeError("rpc", message, "bun.oauth", { providerId }, error);
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
        recordDevBrowserToolsEvent("provider.auth.removed", { providerId });
        workspaceRuntimeRegistry
          .getActiveRuntimeOrNull()
          ?.appLog.info("auth.provider", "Provider auth removed.", { providerId });
        await syncProviderAuthStatusesWithState({
          refreshOAuth: false,
          source: "user_action",
          stateCommands: facades.commands.state,
        });
        return { ok: true };
      },
    },
  });
}

let desktopApp: DesktopApp | null = null;
let desktopShutdownPromise: Promise<void> | null = null;
let desktopShutdownReason: "app-shutdown" | "startup-failure" | null = null;
let rendererCallsClosed = false;

function rejectRendererCalls(error: ReturnType<typeof normalizeDesktopBridgeErrorContract>): void {
  rendererCallsClosed = true;
  desktopHost?.rejectRendererCalls(error);
}

function shutdownDesktopApp(
  reason: "app-shutdown" | "startup-failure" = "app-shutdown",
): Promise<void> {
  if (desktopShutdownPromise) {
    return desktopShutdownPromise;
  }
  desktopShutdownReason = reason;
  desktopShutdownPromise = (async () => {
    const errors: unknown[] = [];
    if (!rendererCallsClosed) {
      rejectRendererCalls(
        normalizeDesktopBridgeErrorContract({
          operation: "desktop.shutdown",
          reason: "desktop-shutdown",
          message: "The desktop app is shutting down.",
        }),
      );
    }
    try {
      await devBrowserToolsRecorder.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await desktopApp?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await workspaceRuntimeRegistry.shutdownApp(reason);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "The desktop app did not shut down cleanly.");
    }
  })();
  return desktopShutdownPromise;
}

const appChannelPromise = Updater.localInfo.channel();
desktopHost = createElectrobunDesktopHostAdapter({
  maxRequestTime: getRpcRequestTimeoutMs(),
  buildRpcHandlers: buildDesktopRpcHandlers,
  resolveMainWindowUrl: async () => getMainViewUrl(await appChannelPromise),
  prepareMainWindow: async (mainWindow) => {
    if ((await appChannelPromise) !== "dev") {
      return;
    }
    const { mountDevBrowserToolsBridge } = await import("./dev-browser-tools-bridge");
    const mountedDevBrowserToolsBridge = await mountDevBrowserToolsBridge({
      getDefaultAgentSettings,
      getMainWindow: () => mainWindow,
      getActiveWorkspace: readActiveWorkspaceFromState,
      getOpenWorkspaces: () => workspaceRuntimeRegistry.listOpenWorkspaces(),
      getWorkspaceBranch,
      listProviderAuthSummaries,
      listOpenSurfaceReadModels: async (workspaceId) => {
        if (!workspaceRuntimeRegistry.getRuntimeOrNull(workspaceId)) {
          return [];
        }
        const state = await workspaceRuntimeRegistry.getRendererStateFacade();
        const navigation = requireStateReadModel(
          await state.readModels.fetch({
            kind: "sessionNavigation",
            workspaceId: workspaceId as WorkspaceId,
          }),
          "sessionNavigation",
        ).value;
        const sessions = [
          ...navigation.pinnedSessions,
          ...navigation.activeSessions,
          ...navigation.archived.sessions,
        ];
        const targets = sessions.flatMap((session) => [
          {
            workspaceSessionId: session.id,
            surface: "orchestrator",
            surfacePiSessionId: session.id,
          } as RuntimeSurfaceTarget,
          ...(session.sidebarThreads ?? []).map(
            (thread) =>
              ({
                workspaceSessionId: session.id,
                surface: "handler",
                surfacePiSessionId: thread.surfacePiSessionId,
                threadId: thread.threadId,
              }) as RuntimeSurfaceTarget,
          ),
        ]);

        return Promise.all(
          targets.map(async (target) => {
            const [transcript, summary, composer, queuedMessages] = await Promise.all([
              state.readModels.fetch({ kind: "surfaceTranscript", target }),
              state.readModels.fetch({ kind: "surfaceSummary", target }),
              state.readModels.fetch({ kind: "surfaceComposer", target }),
              state.readModels.fetch({ kind: "surfaceQueuedMessages", target }),
            ]);
            return {
              transcript: requireStateReadModel(transcript, "surfaceTranscript").value,
              summary: requireStateReadModel(summary, "surfaceSummary").value,
              composer: requireStateReadModel(composer, "surfaceComposer").value,
              queuedMessages: requireStateReadModel(queuedMessages, "surfaceQueuedMessages").value,
            };
          }),
        );
      },
      listWorkspaceSessions: async (workspaceId) => {
        if (!workspaceRuntimeRegistry.getRuntimeOrNull(workspaceId)) {
          return { sessions: [] };
        }
        const state = await workspaceRuntimeRegistry.getRendererStateFacade();
        const result = requireStateReadModel(
          await state.readModels.fetch({
            kind: "sessionNavigation",
            workspaceId: workspaceId as WorkspaceId,
          }),
          "sessionNavigation",
        );
        return {
          sessions: [
            ...result.value.pinnedSessions,
            ...result.value.activeSessions,
            ...result.value.archived.sessions,
          ],
        };
      },
      mainWindow,
    }).catch((error) => {
      recordAppRuntimeError(
        "app",
        "svvy dev browser tools bridge failed to mount.",
        "dev-browser-tools",
        {},
        error,
      );
      throw error;
    });
    devBrowserToolsRecorder = mountedDevBrowserToolsBridge;
    devBrowserToolsMetadata = {
      appId: mountedDevBrowserToolsBridge.appId,
      ...(mountedDevBrowserToolsBridge.url ? { url: mountedDevBrowserToolsBridge.url } : {}),
    };
  },
  includeSettingsMenuItem: true,
  onBeforeQuit: shutdownDesktopApp,
  onError: (error, context) => {
    recordDevBrowserToolsError(
      "app",
      "Electrobun desktop host operation failed.",
      context,
      {},
      error,
    );
  },
});

await runDesktopBootstrap({
  awaitReadiness: async () => {
    desktopHost!.lifecycle.start();
    await workspaceRuntimeRegistry.ready();
  },
  acquireFacades: () => workspaceRuntimeRegistry.acquireDesktopAppFacades(),
  startDesktop: async (facades) => {
    const appChannel = await appChannelPromise;
    const url = await getMainViewUrl(appChannel);
    const host = desktopHost!;

    await syncProviderAuthStatusesWithState({
      refreshOAuth: true,
      source: "startup_scan",
      stateCommands: facades.rendererStateCommands,
    });

    const notifications = createDesktopNotificationBridge({
      runtimeEvents: facades.runtimeEvents,
      state: {
        readModels: {
          fetch: (request) =>
            facades.rendererState.readModels.fetch(request).then(desktopStateReadModelResult),
          rebaseline: async (request) =>
            desktopStateReadModelBaseline(
              await facades.rendererState.readModels.rebaseline(request),
            ),
        },
      },
      rendererEmit: (notification) => host.bridge.sendToRenderer(notification),
      onError: (error, context) => {
        recordDevBrowserToolsError(
          "rpc",
          "Desktop notification bridge failed.",
          context,
          {},
          error,
        );
      },
    });

    desktopApp = createDesktopApp({
      runtime: facades.runtimeActions,
      appActions: facades.appActions,
      modelMetadata: facades.modelMetadata,
      state: facades.rendererState,
      commands: {
        runtime: facades.runtimeCommands,
        state: facades.rendererStateCommands,
      },
      notifications,
      host,
    });
    await desktopApp.start();

    const mainWindow = host.getMainWindow();
    if (!mainWindow) {
      throw new Error("The desktop app started without an Electrobun main window.");
    }

    if (devBrowserToolsMetadata) {
      const activeWorkspace = await readActiveWorkspaceFromState();
      recordDevBrowserToolsEvent("app.ready", {
        bridgeUrl: devBrowserToolsMetadata.url ?? null,
        url,
        workspaceId: activeWorkspace?.workspaceId ?? null,
      });
      recordAppRuntimeLog("info", "svvy dev browser tools bridge mounted.", "dev-browser-tools", {
        appId: devBrowserToolsMetadata.appId,
        bridgeUrl: devBrowserToolsMetadata.url ?? null,
      });
      console.log(
        `svvy bridge: ${JSON.stringify({
          appId: devBrowserToolsMetadata.appId,
          bridgeUrl: devBrowserToolsMetadata.url ?? null,
        })}`,
      );
    }

    console.log("svvy desktop app started");
  },
  rejectRendererCalls,
  cleanup: (reason) => shutdownDesktopApp(reason),
  showStartupFailure: async (cause) => {
    if (desktopShutdownReason === "app-shutdown") {
      return;
    }
    await showStartupFailureSurface({
      cause,
      host: {
        showStartupFailure: async ({ title, message }) => {
          await Utils.showMessageBox({
            type: "error",
            title,
            message,
            buttons: ["Close"],
            defaultId: 0,
            cancelId: 0,
          });
        },
      },
    });
  },
  finalizeFailure: () => desktopHost!.lifecycle.finishQuit(),
  onAuxiliaryFailure: (error, phase) => {
    recordDevBrowserToolsError(
      "app",
      phase === "cleanup"
        ? "Desktop startup cleanup failed."
        : phase === "failure-surface"
          ? "Desktop startup failure surface could not be shown."
          : phase === "finalization"
            ? "Desktop startup failure finalization failed."
            : "Desktop renderer rejection failed during startup cleanup.",
      "desktop.startup",
      {},
      error,
    );
  },
});
