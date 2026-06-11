import {
  ApplicationMenu,
  BrowserWindow,
  Updater,
  Utils,
  defineElectrobunRPC,
} from "electrobun/bun";
import { getModel, getModels, getProviders } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type {
  AuthStateResponse,
  ChatRPCSchema,
  ComposerAttachment,
  ComposerMentionKind,
  ImportComposerAttachmentInput,
  OpenWorkspaceRequest,
  ProviderAuthInfo,
  SendPromptRequest,
  SendPromptResponse,
  SwitchWorkspaceBranchResponse,
} from "../shared/workspace-contract";
import {
  getShortcut,
  getShortcutAccelerator,
  isAppMenuAction,
  type AppMenuAction,
} from "../shared/shortcut-registry";
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  DEFAULT_WORKFLOW_AGENT_SETTINGS,
  type AgentDefaults,
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
import { getSvvyAgentDir, type SessionDefaults } from "./session-catalog";
import {
  buildWorkflowsGeneratedPackage,
  getWorkflowsSourceRoot,
  readWorkflowsGeneratedReadModel,
} from "./smithers-runtime/workflow-library";
import { assertAgentModelSelection, readDefaultModelCatalog } from "./svvyx-workflows-command";
import { resolveWorkspaceCwd } from "./workspace-context";
import { positionNativeTrafficLights } from "./native-window-controls";
import { WorkspaceRuntimeRegistry, type WorkspaceRuntime } from "./workspace-runtime-registry";
import { createAppWorkspaceTabsStore } from "./app-workspace-tabs-store";
import { createAppWorkspaceUiRestoreStore } from "./app-workspace-ui-restore-store";
import { getWorkspaceRuntimeForRequest, stripWorkspaceId } from "./workspace-rpc-routing";
import {
  assertExtensionEnvOverrideTarget,
  assertExtensionEnvSecretTarget,
  assertExtensionEnvWriteValue,
  readBuiltinExtensionsInventory,
  runSvvyxExtensionsCommand,
} from "./svvyx-extensions-command";
import { mapAppRuntimeLogSource } from "./app-runtime-log-source";
import { createMacOsKeychainExtensionEnvSecretStore } from "./extension-env-secret-store";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const DEV_SERVER_WAIT_TIMEOUT_MS = 15_000;
const extensionEnvSecretStore = createMacOsKeychainExtensionEnvSecretStore();
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
const startupWorkspaceCwd = resolveWorkspaceCwd();
const appWorkspaceTabsStore = createAppWorkspaceTabsStore({
  agentDir: getSvvyAgentDir(),
});
const appWorkspaceUiRestoreStore = createAppWorkspaceUiRestoreStore({
  agentDir: getSvvyAgentDir(),
});

const NATIVE_TRAFFIC_LIGHT_POSITION = {
  leading: 18,
  top: 13,
} as const;

function workflowsBuildFailedError(diagnostics: unknown[]): Error {
  const error = new Error("Workflows build failed.") as Error & {
    code: "build_failed";
    diagnostics: unknown[];
  };
  error.code = "build_failed";
  error.diagnostics = diagnostics;
  return error;
}

function appMenuItem(action: AppMenuAction): {
  label: string;
  action: string;
  accelerator: string;
} {
  return {
    label: getShortcut(action).label,
    action,
    accelerator: getShortcutAccelerator(action) ?? "",
  };
}

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

function quoteSvvyxCommandArg(value: string): string {
  return JSON.stringify(value);
}

async function readWorkspaceExtensionsInventory(runtime: WorkspaceRuntime) {
  return readBuiltinExtensionsInventory({
    agentSettingsStore: runtime.agentSettingsStore,
    envSecretStore: extensionEnvSecretStore,
    extensionsRoot: runtime.catalog.getExtensionsRoot(),
    externalInstructionSources: await runtime.catalog.getGeneratedAgentContextExternalSources(),
    includeUserExtensions: true,
  });
}

async function runWorkspaceExtensionsCommand(runtime: WorkspaceRuntime, command: string) {
  return runSvvyxExtensionsCommand({
    agentSettingsStore: runtime.agentSettingsStore,
    command,
    envSecretStore: extensionEnvSecretStore,
    extensionsRoot: runtime.catalog.getExtensionsRoot(),
    structuredSessionStore: runtime.catalog.getStructuredSessionStore(),
  });
}

type DevBrowserToolsRecorder = {
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

function resolveSendDefaults(runtime: WorkspaceRuntime, request: SendPromptRequest): AgentDefaults {
  const defaults = getDefaultAgentSettings(runtime);
  return {
    provider: request.provider || defaults.provider,
    model: request.model || defaults.model,
    reasoningEffort: request.reasoningEffort || defaults.reasoningEffort,
  };
}

function getDefaultAgentSettings(runtime?: WorkspaceRuntime): AgentDefaults {
  if (runtime) {
    const savedDefault =
      runtime.agentSettingsStore
        .getState()
        .agents.orchestrators.find((agent) => agent.id === DEFAULT_ORCHESTRATOR_PROFILE_ID) ??
      runtime.agentSettingsStore.getState().agents.orchestrators[0];
    if (savedDefault?.provider && savedDefault.model) {
      return {
        provider: savedDefault.provider,
        model: savedDefault.model,
        reasoningEffort: savedDefault.reasoningEffort,
      };
    }
  }
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

function getSessionDefaults(
  runtime: WorkspaceRuntime,
  profileId = DEFAULT_ORCHESTRATOR_PROFILE_ID,
): SessionDefaults {
  const agentSettings = runtime.agentSettingsStore
    .getState()
    .agents.orchestrators.find((agent) => agent.id === profileId);
  if (!agentSettings) {
    throw new Error(`Unknown orchestrator agent profile: ${profileId}`);
  }
  const defaults =
    agentSettings.provider && agentSettings.model
      ? agentSettings
      : getDefaultAgentSettings(runtime);
  return {
    model: defaults.model,
    provider: defaults.provider,
    thinkingLevel: defaults.reasoningEffort,
    agentProfileId: agentSettings.id,
    agentProfileSettings: agentSettings,
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

function getWorkspaceBranches(cwd: string): string[] {
  const result = spawnSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((branch) => branch.trim())
    .filter(Boolean);
}

function switchWorkspaceBranch(
  runtime: WorkspaceRuntime,
  branch: string,
): SwitchWorkspaceBranchResponse {
  const nextBranch = branch.trim();
  const branches = getWorkspaceBranches(runtime.cwd);
  if (!nextBranch || !branches.includes(nextBranch)) {
    return {
      ok: false,
      workspace: addWorkspaceBranch(runtime.getInfo()),
      error: "Branch is not available in this workspace.",
    };
  }

  if (getWorkspaceBranch(runtime.cwd) === nextBranch) {
    return { ok: true, workspace: addWorkspaceBranch(runtime.getInfo()) };
  }

  const result = spawnSync("git", ["switch", nextBranch], {
    cwd: runtime.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout).trim() || "Unable to switch branch.";
    return {
      ok: false,
      workspace: addWorkspaceBranch(runtime.getInfo()),
      error: message,
    };
  }

  runtime.pathIndex.refresh();
  runtime.appLog.info("workspace", "Workspace branch switched.", {
    workspaceId: runtime.workspaceId,
    branch: nextBranch,
  });
  recordDevBrowserToolsEvent("workspace.branch-switched", {
    workspaceId: runtime.workspaceId,
    branch: nextBranch,
  });
  return { ok: true, workspace: addWorkspaceBranch(runtime.getInfo()) };
}

function resolveSafeWorkspacePath(
  runtime: WorkspaceRuntime,
  workspaceRelativePath: string,
): string | null {
  const cwd = runtime.cwd;
  const normalizedRelativePath = workspaceRelativePath.trim().replace(/\\/g, "/").replace(/^@/, "");
  if (
    !normalizedRelativePath ||
    normalizedRelativePath.startsWith("/") ||
    normalizedRelativePath.includes("\0") ||
    normalizedRelativePath.split("/").includes("..")
  ) {
    return null;
  }

  const absolutePath = resolve(cwd, normalizedRelativePath);
  const root = resolve(cwd);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) return null;
  return absolutePath;
}

function resolveSafeWorkspaceOrWorkflowsPath(
  runtime: WorkspaceRuntime,
  inputPath: string,
): string | null {
  const normalizedPath = inputPath.trim();
  if (!normalizedPath) return null;
  if (!normalizedPath.startsWith("/")) {
    return resolveSafeWorkspacePath(runtime, normalizedPath);
  }

  const absolutePath = resolve(normalizedPath);
  const workflowsRoot = resolve(getWorkflowsSourceRoot());
  if (absolutePath !== workflowsRoot && !absolutePath.startsWith(`${workflowsRoot}${sep}`)) {
    return null;
  }
  return absolutePath;
}

function getWorkspacePathKind(absolutePath: string): ComposerMentionKind | "missing" {
  try {
    const stats = statSync(absolutePath);
    return stats.isDirectory() ? "folder" : "file";
  } catch {
    return "missing";
  }
}

function sanitizeAttachmentName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "attachment";
}

function imageMimeTypeFromPath(path: string): string | null {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  return null;
}

function importedAttachmentPath(
  cwd: string,
  name: string,
): { absolutePath: string; workspaceRelativePath: string } {
  const attachmentId = randomUUID();
  const relativePath = join(
    ".svvy",
    "attachments",
    "user-input",
    `${attachmentId}-${sanitizeAttachmentName(name)}`,
  );
  const absolutePath = resolve(cwd, relativePath);
  mkdirSync(join(cwd, ".svvy", "attachments", "user-input"), { recursive: true });
  return { absolutePath, workspaceRelativePath: relativePath.split(sep).join("/") };
}

function createComposerAttachmentFromPath(
  cwd: string,
  selectedPath: string,
): ComposerAttachment | null {
  const absolutePath = resolve(selectedPath);
  const kind = getWorkspacePathKind(absolutePath);
  if (kind === "missing") return null;

  const workspaceRelativePath = relative(cwd, absolutePath);
  const isWorkspacePath =
    workspaceRelativePath !== "" &&
    !workspaceRelativePath.startsWith("..") &&
    !workspaceRelativePath.includes(`..${sep}`) &&
    resolve(cwd, workspaceRelativePath) === absolutePath;
  const normalizedPath = (isWorkspacePath ? workspaceRelativePath : absolutePath)
    .split(sep)
    .join("/");
  const stats = statSync(absolutePath);
  const mimeType = kind === "file" ? imageMimeTypeFromPath(absolutePath) : null;

  if (kind === "file" && !isWorkspacePath) {
    const imported = importedAttachmentPath(cwd, basename(absolutePath));
    copyFileSync(absolutePath, imported.absolutePath);
    const importedMimeType = mimeType ?? imageMimeTypeFromPath(imported.absolutePath);
    return {
      id: `attachment:${imported.workspaceRelativePath}`,
      kind: importedMimeType?.startsWith("image/") ? "image" : "file",
      name: basename(absolutePath),
      path: imported.workspaceRelativePath,
      workspaceRelativePath: imported.workspaceRelativePath,
      mimeType: importedMimeType ?? undefined,
      sizeBytes: stats.size,
      dataBase64: importedMimeType?.startsWith("image/")
        ? readFileSync(imported.absolutePath).toString("base64")
        : undefined,
    };
  }

  return {
    id: `${kind}:${normalizedPath}`,
    kind: mimeType?.startsWith("image/") ? "image" : kind,
    name: basename(absolutePath),
    path: normalizedPath,
    workspaceRelativePath: isWorkspacePath ? workspaceRelativePath.split(sep).join("/") : undefined,
    mimeType: mimeType ?? undefined,
    sizeBytes: kind === "file" ? stats.size : undefined,
    dataBase64: mimeType?.startsWith("image/")
      ? readFileSync(absolutePath).toString("base64")
      : undefined,
  };
}

function createImportedComposerAttachment(
  cwd: string,
  input: ImportComposerAttachmentInput,
): ComposerAttachment {
  const name = sanitizeAttachmentName(input.name || "attachment");
  const imported = importedAttachmentPath(cwd, name);
  const bytes = Buffer.from(input.dataBase64, "base64");
  writeFileSync(imported.absolutePath, bytes);
  const mimeType = input.mimeType || imageMimeTypeFromPath(name) || "application/octet-stream";
  return {
    id: `attachment:${imported.workspaceRelativePath}`,
    kind: mimeType.startsWith("image/") ? "image" : "file",
    name,
    path: imported.workspaceRelativePath,
    workspaceRelativePath: imported.workspaceRelativePath,
    mimeType,
    sizeBytes: bytes.byteLength,
    dataBase64: mimeType.startsWith("image/") ? input.dataBase64 : undefined,
  };
}

function openPathInPreferredEditor(
  runtime: WorkspaceRuntime,
  path: string,
): { opened: boolean; editor: string } {
  const preferences = runtime.agentSettingsStore.getState().appPreferences;
  const editor = preferences.preferredExternalEditor;
  if (editor === "system") {
    return { opened: Utils.openPath(path), editor };
  }

  const appNameByEditor = {
    code: "Visual Studio Code",
    cursor: "Cursor",
    zed: "Zed",
    sublime: "Sublime Text",
  } satisfies Record<Exclude<typeof editor, "system" | "custom">, string>;
  if (editor !== "custom") {
    try {
      const child = spawn("/usr/bin/open", ["-a", appNameByEditor[editor], path], {
        cwd: runtime.cwd,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { opened: true, editor };
    } catch (error) {
      runtime.appLog.warning("external-editor", "External editor app launch failed.", {
        editor,
        path,
        message: error instanceof Error ? error.message : String(error),
      });
      return { opened: false, editor };
    }
  }

  const configuredCommand = preferences.customExternalEditorCommand;
  const [command, ...baseArgs] = configuredCommand.split(/\s+/).filter(Boolean);
  if (!command) {
    runtime.appLog.warning("external-editor", "Custom external editor command is empty.", { path });
    return { opened: false, editor };
  }

  try {
    const child = spawn(command, [...baseArgs, path], {
      cwd: runtime.cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { opened: true, editor };
  } catch (error) {
    runtime.appLog.warning("external-editor", "Custom external editor command failed.", {
      command,
      path,
      message: error instanceof Error ? error.message : String(error),
    });
    return { opened: false, editor };
  }
}

function listProviderAuthSummaries(): ProviderAuthInfo[] {
  const providerIds = getProviders();
  return providerIds.map((provider) => {
    const state = resolveAuthState(provider);
    return {
      provider,
      hasKey: state.connected,
      keyType: state.keyType,
      supportsOAuth: supportsOAuth(provider),
    };
  });
}

let devBrowserToolsRecorder: DevBrowserToolsRecorder = {
  recordError: () => {},
  recordEvent: () => {},
  recordLog: () => {},
};

const recordDevBrowserToolsEvent: DevBrowserToolsRecorder["recordEvent"] = (...args) =>
  devBrowserToolsRecorder.recordEvent(...args);
const recordDevBrowserToolsLog: DevBrowserToolsRecorder["recordLog"] = (...args) =>
  devBrowserToolsRecorder.recordLog(...args);
const recordDevBrowserToolsError: DevBrowserToolsRecorder["recordError"] = (...args) =>
  devBrowserToolsRecorder.recordError(...args);

const workspaceRuntimeRegistry = new WorkspaceRuntimeRegistry({
  initialCwd: startupWorkspaceCwd,
  openInitialWorkspace: !!process.env.SVVY_WORKSPACE_CWD,
  forwardBridgeLog: (level, message, source, details, error) => {
    if (level === "error") {
      recordDevBrowserToolsError("app", message, source, details, error);
      return;
    }
    recordDevBrowserToolsLog(level, message, source, details);
  },
  onAppLogUpdate: (workspaceId, payload) => {
    try {
      rpc.send.sendAppLogUpdate({
        ...payload,
        workspaceId,
      });
    } catch (error) {
      recordDevBrowserToolsError(
        "rpc",
        "Unable to send app log update to the main view.",
        "rpc",
        { workspaceId },
        error,
      );
    }
  },
  onWorkspaceSync: (_workspaceId, payload) => {
    try {
      rpc.send.sendWorkspaceSync(payload);
    } catch (error) {
      recordDevBrowserToolsError(
        "rpc",
        "Unable to send workspace sync to the main view.",
        "rpc",
        {},
        error,
      );
    }
  },
  onSurfaceSync: (_workspaceId, payload) => {
    try {
      rpc.send.sendSurfaceSync(payload);
    } catch (error) {
      recordDevBrowserToolsError(
        "rpc",
        "Unable to send surface sync to the main view.",
        "rpc",
        {},
        error,
      );
    }
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

function addWorkspaceBranch<T extends { cwd: string }>(info: T): T & { branch?: string } {
  const branch = getWorkspaceBranch(info.cwd);
  return {
    ...info,
    ...(branch ? { branch } : {}),
  };
}

const rpc = defineElectrobunRPC<ChatRPCSchema, "bun">("bun", {
  maxRequestTime: getRpcRequestTimeoutMs(),
  handlers: {
    requests: {
      getDefaults: async () => {
        return getDefaultAgentSettings();
      },
      getAgentSettings: async (input) => {
        return getWorkspaceRuntime(input).agentSettingsStore.getState();
      },
      getAgentContextPreview: async (input) => {
        return getWorkspaceRuntime(input).catalog.getAgentContextPreview(stripWorkspaceId(input));
      },
      getAgentModelChoices: async () => {
        return {
          items: readDefaultModelCatalog().map((choice) => ({
            providerId: choice.providerId,
            modelId: choice.modelId,
            providerAuthenticated: choice.providerAuthenticated,
            authSource: choice.authSource,
            supportedReasoning: choice.supportedReasoning,
            capabilities: choice.capabilities,
          })),
        };
      },
      getExtensionsInventory: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        return readWorkspaceExtensionsInventory(runtime);
      },
      revertExtensionChange: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        if (!/^chg_[a-z0-9]+_[a-f0-9-]+$/i.test(input.changeId)) {
          throw new Error(`Invalid extension change id: ${input.changeId}`);
        }
        const result = await runWorkspaceExtensionsCommand(
          runtime,
          `svvyx extensions revert ${input.changeId} --json`,
        );
        const output = result.output as {
          changeId?: unknown;
          result?: {
            autoBuild?: { status?: unknown } | null;
            extensionId?: unknown;
            kind?: unknown;
          };
        };
        const revertChangeId = typeof output.changeId === "string" ? output.changeId : null;
        const extensionId =
          typeof output.result?.extensionId === "string" ? output.result.extensionId : null;
        const resultKind = typeof output.result?.kind === "string" ? output.result.kind : null;
        const autoBuildStatus =
          typeof output.result?.autoBuild?.status === "string"
            ? output.result.autoBuild.status
            : null;
        const recordedConversationEvent = input.owningSurface
          ? await runtime.catalog.recordExtensionRevertProductEvent({
              target: input.owningSurface,
              changeId: input.changeId,
              revertChangeId,
              extensionId,
              resultKind,
              autoBuildStatus,
            })
          : false;
        runtime.appLog.info("settings", "Extension change reverted from UI.", {
          changeId: input.changeId,
          revertChangeId,
          extensionId,
          resultKind,
          autoBuildStatus,
          recordedConversationEvent,
        });
        return readWorkspaceExtensionsInventory(runtime);
      },
      saveExtensionSnapshot: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const name = input.name.trim();
        if (!name) {
          throw new Error("Snapshot name cannot be empty.");
        }
        const result = await runWorkspaceExtensionsCommand(
          runtime,
          `svvyx extensions snapshots save --name ${quoteSvvyxCommandArg(name)} --json`,
        );
        const snapshotId =
          typeof (result.output as { snapshot?: { id?: unknown } }).snapshot?.id === "string"
            ? (result.output as { snapshot: { id: string } }).snapshot.id
            : null;
        runtime.appLog.info("settings", "Extension snapshot saved from UI.", {
          snapshotId,
          name,
        });
        return readWorkspaceExtensionsInventory(runtime);
      },
      renameExtensionSnapshot: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const name = input.name.trim();
        if (!name) {
          throw new Error("Snapshot name cannot be empty.");
        }
        await runWorkspaceExtensionsCommand(
          runtime,
          `svvyx extensions snapshots rename ${quoteSvvyxCommandArg(input.snapshotId)} --name ${quoteSvvyxCommandArg(name)} --json`,
        );
        runtime.appLog.info("settings", "Extension snapshot renamed from UI.", {
          snapshotId: input.snapshotId,
          name,
        });
        return readWorkspaceExtensionsInventory(runtime);
      },
      deleteExtensionSnapshot: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        await runWorkspaceExtensionsCommand(
          runtime,
          `svvyx extensions snapshots delete ${quoteSvvyxCommandArg(input.snapshotId)} --json`,
        );
        runtime.appLog.info("settings", "Extension snapshot deleted from UI.", {
          snapshotId: input.snapshotId,
        });
        return readWorkspaceExtensionsInventory(runtime);
      },
      loadExtensionSnapshot: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        await runWorkspaceExtensionsCommand(
          runtime,
          `svvyx extensions snapshots load ${quoteSvvyxCommandArg(input.snapshotId)} --json`,
        );
        runtime.appLog.info("settings", "Extension snapshot loaded from UI.", {
          snapshotId: input.snapshotId,
        });
        return readWorkspaceExtensionsInventory(runtime);
      },
      setExtensionEnvSecret: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { extensionId, name, value } = input;
        assertExtensionEnvSecretTarget({ extensionId, name });
        assertExtensionEnvWriteValue(value);
        extensionEnvSecretStore.set({ extensionId, name }, value);
        runtime.appLog.info("settings", "Extension env secret updated.", {
          extensionId,
          envName: name,
        });
        return readBuiltinExtensionsInventory({
          agentSettingsStore: runtime.agentSettingsStore,
          envSecretStore: extensionEnvSecretStore,
          extensionsRoot: runtime.catalog.getExtensionsRoot(),
          externalInstructionSources:
            await runtime.catalog.getGeneratedAgentContextExternalSources(),
          includeUserExtensions: true,
        });
      },
      removeExtensionEnvSecret: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { extensionId, name } = input;
        assertExtensionEnvSecretTarget({ extensionId, name });
        extensionEnvSecretStore.remove({ extensionId, name });
        runtime.appLog.info("settings", "Extension env secret removed.", {
          extensionId,
          envName: name,
        });
        return readBuiltinExtensionsInventory({
          agentSettingsStore: runtime.agentSettingsStore,
          envSecretStore: extensionEnvSecretStore,
          extensionsRoot: runtime.catalog.getExtensionsRoot(),
          externalInstructionSources:
            await runtime.catalog.getGeneratedAgentContextExternalSources(),
          includeUserExtensions: true,
        });
      },
      setExtensionEnvOverride: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { extensionId, name, value } = input;
        assertExtensionEnvOverrideTarget({ extensionId, name });
        assertExtensionEnvWriteValue(value);
        const current = runtime.agentSettingsStore.getState().extensionEnv.nonSecretOverrides;
        runtime.agentSettingsStore.setExtensionEnv({
          nonSecretOverrides: {
            ...current,
            [extensionId]: {
              ...current[extensionId],
              [name]: value,
            },
          },
        });
        runtime.appLog.info("settings", "Extension env override updated.", {
          extensionId,
          envName: name,
        });
        return readBuiltinExtensionsInventory({
          agentSettingsStore: runtime.agentSettingsStore,
          envSecretStore: extensionEnvSecretStore,
          extensionsRoot: runtime.catalog.getExtensionsRoot(),
          externalInstructionSources:
            await runtime.catalog.getGeneratedAgentContextExternalSources(),
          includeUserExtensions: true,
        });
      },
      removeExtensionEnvOverride: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { extensionId, name } = input;
        assertExtensionEnvOverrideTarget({ extensionId, name });
        const current = runtime.agentSettingsStore.getState().extensionEnv.nonSecretOverrides;
        const extensionOverrides = { ...current[extensionId] };
        delete extensionOverrides[name];
        const next = { ...current, [extensionId]: extensionOverrides };
        if (Object.keys(extensionOverrides).length === 0) {
          delete next[extensionId];
        }
        runtime.agentSettingsStore.setExtensionEnv({ nonSecretOverrides: next });
        runtime.appLog.info("settings", "Extension env override removed.", {
          extensionId,
          envName: name,
        });
        return readBuiltinExtensionsInventory({
          agentSettingsStore: runtime.agentSettingsStore,
          envSecretStore: extensionEnvSecretStore,
          extensionsRoot: runtime.catalog.getExtensionsRoot(),
          externalInstructionSources:
            await runtime.catalog.getGeneratedAgentContextExternalSources(),
          includeUserExtensions: true,
        });
      },
      getAppPreferences: async () => {
        return workspaceRuntimeRegistry.getDefaultWorkspace().agentSettingsStore.getState()
          .appPreferences;
      },
      getGeneratedAgentContext: async (input) => {
        return getWorkspaceRuntime(input).catalog.getGeneratedAgentContextState();
      },
      getGeneratedAgentContextDefaults: async (input) => {
        return getWorkspaceRuntime(input).catalog.getDefaultGeneratedAgentContextState();
      },
      updateGeneratedAgentContext: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { state } = input;
        const next = runtime.catalog.updateGeneratedAgentContextState(state);
        runtime.appLog.info("settings", "Generated agent context updated.", {
          revision: next.revision,
        });
        return next;
      },
      resetGeneratedAgentContext: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const next = runtime.catalog.resetGeneratedAgentContextState();
        runtime.appLog.info("settings", "Generated agent context reset.", {
          revision: next.revision,
        });
        return next;
      },
      listGeneratedAgentContextSnapshots: async (input) => {
        return getWorkspaceRuntime(input).catalog.listGeneratedAgentContextSnapshots();
      },
      createGeneratedAgentContextSnapshot: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { name } = input;
        const snapshot = runtime.catalog.createGeneratedAgentContextSnapshot(name);
        runtime.appLog.info("settings", "Generated agent context snapshot created.", {
          snapshotId: snapshot.id,
          name: snapshot.name,
        });
        return snapshot;
      },
      renameGeneratedAgentContextSnapshot: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { snapshotId, name } = input;
        const snapshot = runtime.catalog.renameGeneratedAgentContextSnapshot(snapshotId, name);
        runtime.appLog.info("settings", "Generated agent context snapshot renamed.", {
          snapshotId: snapshot.id,
          name: snapshot.name,
        });
        return snapshot;
      },
      restoreGeneratedAgentContextSnapshot: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { snapshotId } = input;
        const next = runtime.catalog.restoreGeneratedAgentContextSnapshot(snapshotId);
        runtime.appLog.info("settings", "Generated agent context snapshot loaded.", {
          snapshotId,
          revision: next.revision,
        });
        return next;
      },
      getGeneratedAgentContextEntries: async (input) => {
        return getWorkspaceRuntime(input).catalog.getGeneratedAgentContextEntries();
      },
      getGeneratedAgentContextExternalSources: async (input) => {
        return getWorkspaceRuntime(input).catalog.getGeneratedAgentContextExternalSources();
      },
      getSnippets: async (input) => {
        return getWorkspaceRuntime(input).catalog.getSnippets();
      },
      createManagedSnippet: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const snippet = runtime.catalog.createManagedSnippet(input);
        runtime.appLog.info("settings", "Snippet created.", {
          snippetId: snippet.id,
          title: snippet.title,
        });
        return snippet;
      },
      updateManagedSnippet: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const snippet = runtime.catalog.updateManagedSnippet(input);
        runtime.appLog.info("settings", "Snippet updated.", {
          snippetId: snippet.id,
          title: snippet.title,
        });
        return snippet;
      },
      deleteManagedSnippet: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        runtime.catalog.deleteManagedSnippet(input);
        runtime.appLog.info("settings", "Snippet deleted.", {
          snippetId: input.snippetId,
        });
        return { ok: true as const };
      },
      openSnippetExternalSourceInEditor: (input) => {
        const runtime = getWorkspaceRuntime(input);
        const snippet = runtime.catalog
          .getSnippets()
          .discovered.find((candidate) => candidate.path === input.path);
        if (!snippet) {
          runtime.appLog.warning("external-editor", "Snippet source file is not discoverable.", {
            path: input.path,
          });
          throw new Error(`Snippet source file is not discoverable: ${input.path}`);
        }
        const result = openPathInPreferredEditor(runtime, snippet.path);
        runtime.appLog.info("external-editor", "Snippet source opened in external editor.", {
          path: snippet.path,
          editor: result.editor,
          opened: result.opened,
        });
        return { ...result, path: snippet.path };
      },
      updateAgentProfile: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { profile } = input;
        assertAgentModelSelection(
          {
            providerId: profile.provider,
            modelId: profile.model,
            reasoningEffort: profile.reasoningEffort,
          },
          readDefaultModelCatalog(),
        );
        resolvedDefaults = null;
        runtime.appLog.info("settings", "Agent profile updated.", { profileId: profile.id });
        return runtime.agentSettingsStore.setAgentProfile(profile);
      },
      deleteAgentProfile: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { id } = input;
        runtime.appLog.info("settings", "Agent profile deleted.", { profileId: id });
        return runtime.agentSettingsStore.deleteAgentProfile(id);
      },
      reorderOrchestratorAgents: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { ids } = input;
        runtime.appLog.info("settings", "Orchestrator agents reordered.", { count: ids.length });
        return runtime.agentSettingsStore.reorderOrchestratorProfiles(ids);
      },
      updateWorkflowAgent: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { key, settings } = input;
        const modelCatalog = readDefaultModelCatalog();
        assertAgentModelSelection(
          {
            providerId: settings.provider,
            modelId: settings.model,
            reasoningEffort: settings.reasoningEffort,
          },
          modelCatalog,
        );
        const previous = runtime.agentSettingsStore.getState().workflowAgents[key] ?? null;
        const next = runtime.agentSettingsStore.setWorkflowAgent(key, settings);
        runtime.appLog.info("settings", "Workflow agent settings updated.", { key });
        try {
          const build = await buildWorkflowsGeneratedPackage({
            modelCatalog,
            workspaceCwds: workspaceRuntimeRegistry
              .listOpenWorkspaces()
              .map((workspace) => workspace.cwd),
          });
          if (build.ok) {
            runtime.appLog.info("workflow.library", "Generated Workflows package rebuilt.", {
              reason: "workflow-agent-settings",
              workflowDiagnosticCount: build.diagnostics.length,
              workflowExportCount: build.items.length,
              workflowLinkedWorkspaceCount: build.linkedWorkspaces.length,
            });
          } else {
            runtime.appLog.warning(
              "workflow.library",
              "Workflow agent settings rejected because Workflows build failed.",
              {
                reason: "workflow-agent-settings",
                workflowDiagnosticCount: build.diagnostics.length,
              },
            );
            if (previous) {
              runtime.agentSettingsStore.setWorkflowAgent(key, previous);
            } else {
              runtime.agentSettingsStore.deleteWorkflowAgent(key);
            }
            throw workflowsBuildFailedError(build.diagnostics);
          }
        } catch (error) {
          if ((error as { code?: string }).code === "build_failed") {
            throw error;
          }
          if (previous) {
            runtime.agentSettingsStore.setWorkflowAgent(key, previous);
          } else {
            runtime.agentSettingsStore.deleteWorkflowAgent(key);
          }
          runtime.appLog.error(
            "workflow.library",
            "Workflow agent settings rejected because Workflows build errored.",
            error,
            { reason: "workflow-agent-settings" },
          );
          throw error;
        }
        return next;
      },
      deleteWorkflowAgent: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { key } = input;
        if (Object.prototype.hasOwnProperty.call(DEFAULT_WORKFLOW_AGENT_SETTINGS, key)) {
          throw new Error(`Default workflow agent cannot be deleted: ${key}`);
        }
        const previous = runtime.agentSettingsStore.getState().workflowAgents[key] ?? null;
        if (!previous) {
          return runtime.agentSettingsStore.getState();
        }
        const next = runtime.agentSettingsStore.deleteWorkflowAgent(key);
        runtime.appLog.info("settings", "Workflow agent deleted.", { key });
        try {
          const build = await buildWorkflowsGeneratedPackage({
            modelCatalog: readDefaultModelCatalog(),
            workspaceCwds: workspaceRuntimeRegistry
              .listOpenWorkspaces()
              .map((workspace) => workspace.cwd),
          });
          if (!build.ok) {
            runtime.agentSettingsStore.setWorkflowAgent(key, previous);
            throw workflowsBuildFailedError(build.diagnostics);
          }
        } catch (error) {
          if ((error as { code?: string }).code !== "build_failed") {
            runtime.appLog.error(
              "workflow.library",
              "Workflow agent delete rejected because Workflows build errored.",
              error,
              { reason: "workflow-agent-delete" },
            );
          }
          runtime.agentSettingsStore.setWorkflowAgent(key, previous);
          throw error;
        }
        return next;
      },
      openWorkflowAgentSourceInEditor: (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { key } = input;
        const agent = runtime.agentSettingsStore.getState().workflowAgents[key];
        if (!agent) {
          throw new Error(`Workflow agent not found: ${key}`);
        }
        const path = join(getWorkflowsSourceRoot(), "agents", `${key}.agent.json`);
        const result = openPathInPreferredEditor(runtime, path);
        runtime.appLog.info("external-editor", "Workflow agent source opened in external editor.", {
          path,
          editor: result.editor,
          opened: result.opened,
        });
        return { ...result, path };
      },
      setAgentProfileExtensionUsage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = runtime.catalog.setExtensionUsage({
          agentProfile: input.agentProfile,
          extensionId: input.extensionId,
          state: input.state,
        });
        runtime.appLog.info("settings", "Agent profile extension usage updated.", {
          agentProfile: input.agentProfile,
          extensionId: input.extensionId,
          state: input.state,
          actor: result.actor,
        });
        return result.settings;
      },
      updateAppPreferences: async (preferences) => {
        const runtime = workspaceRuntimeRegistry.getActiveRuntimeOrNull();
        runtime?.appLog.info("settings", "App preferences updated.", {
          appAppearance: preferences.appAppearance,
          preferredExternalEditor: preferences.preferredExternalEditor,
        });
        const defaultRuntime = workspaceRuntimeRegistry.getDefaultWorkspace();
        const next = defaultRuntime.catalog.updateAppPreferences(preferences);
        for (const workspace of workspaceRuntimeRegistry.listOpenWorkspaces()) {
          if (workspace.workspaceId === defaultRuntime.workspaceId) {
            continue;
          }
          await workspaceRuntimeRegistry
            .getRuntime(workspace.workspaceId)
            .catalog.notifyAppPreferencesChanged();
        }
        return next;
      },
      updateRequestUserInputSettings: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const settings = stripWorkspaceId(input);
        runtime.appLog.info("settings", "Request User Input settings updated.", {
          mode: settings.mode,
          timeoutEnabled: settings.blockingTimeout.enabled,
          timeoutDurationMs: settings.blockingTimeout.durationMs,
        });
        return runtime.catalog.updateRequestUserInputSettings(settings);
      },
      getProviderAuthState: async ({
        providerId,
      }: {
        providerId?: string;
      }): Promise<AuthStateResponse> => {
        const defaults = getDefaultAgentSettings();
        return createAuthState(providerId || defaults.provider);
      },
      openWorkspace: async (input: OpenWorkspaceRequest = {}) => {
        const { cwd } = input;
        const selectedCwd =
          cwd ??
          (
            await Utils.openFileDialog({
              startingFolder:
                workspaceRuntimeRegistry.getActiveRuntimeOrNull()?.cwd ??
                workspaceRuntimeRegistry.getInitialCwd(),
              allowedFileTypes: "*",
              canChooseFiles: false,
              canChooseDirectory: true,
              allowsMultipleSelection: false,
            })
          )[0];
        if (!selectedCwd) return { workspace: null };
        const runtime = workspaceRuntimeRegistry.acquireWorkspace(selectedCwd);
        runtime.appLog.info("workspace", "Workspace opened.", { workspaceId: runtime.workspaceId });
        recordDevBrowserToolsEvent("workspace.opened", { workspaceId: runtime.workspaceId });
        return { workspace: addWorkspaceBranch(runtime.getInfo()) };
      },
      getOpenWorkspaces: async () => {
        return workspaceRuntimeRegistry.listOpenWorkspaces().map(addWorkspaceBranch);
      },
      getDefaultWorkspace: async () => {
        return addWorkspaceBranch(workspaceRuntimeRegistry.getDefaultWorkspace().getInfo());
      },
      getAppWorkspaceTabs: async () => {
        return appWorkspaceTabsStore.getState();
      },
      setAppWorkspaceTabs: async (state) => {
        appWorkspaceTabsStore.setState(state);
        return { ok: true };
      },
      getWorkspaceUiRestore: async ({ workspaceId }) => {
        const runtime = getWorkspaceRuntime({ workspaceId });
        if (runtime.kind === "default") {
          return null;
        }
        return appWorkspaceUiRestoreStore.getState(workspaceId);
      },
      setWorkspaceUiRestore: async ({ workspaceId, state }) => {
        const runtime = getWorkspaceRuntime({ workspaceId });
        if (runtime.kind !== "default") {
          appWorkspaceUiRestoreStore.setState(workspaceId, state);
        }
        return { ok: true };
      },
      setActiveWorkspace: async ({ workspaceId }) => {
        const runtime = workspaceRuntimeRegistry.setActiveWorkspace(workspaceId);
        runtime.appLog.info("workspace", "Active workspace changed.", {
          workspaceId: runtime.workspaceId,
        });
        recordDevBrowserToolsEvent("workspace.activated", { workspaceId: runtime.workspaceId });
        return { ok: true };
      },
      closeWorkspace: async ({ workspaceId }) => {
        const closed = await workspaceRuntimeRegistry.closeWorkspace(workspaceId);
        recordDevBrowserToolsEvent("workspace.closed", { workspaceId, closed });
        return { ok: closed };
      },
      getWorkspaceInfo: (input) => {
        return addWorkspaceBranch(getWorkspaceRuntime(input).getInfo());
      },
      listWorkspaceBranches: (input) => {
        const runtime = getWorkspaceRuntime(input);
        const currentBranch = getWorkspaceBranch(runtime.cwd);
        return {
          currentBranch,
          branches: getWorkspaceBranches(runtime.cwd).map((branch) => ({
            name: branch,
            current: branch === currentBranch,
          })),
        };
      },
      switchWorkspaceBranch: (input) => {
        return switchWorkspaceBranch(getWorkspaceRuntime(input), input.branch);
      },
      getAppLogs: (query) => {
        return getWorkspaceRuntime(query).appLogStore.query(stripWorkspaceId(query));
      },
      getAppLogSummary: (input) => getWorkspaceRuntime(input).appLogStore.summary(),
      markAppLogsSeen: ({ workspaceId, throughSeq }) =>
        workspaceRuntimeRegistry.getRuntime(workspaceId).appLogStore.markSeen(throughSeq),
      writeClipboardText: ({ text }) => {
        Utils.clipboardWriteText(text);
        return { ok: true };
      },
      listWorkspacePaths: (input) => {
        const runtime = getWorkspaceRuntime(input);
        return input.refresh ? runtime.pathIndex.refresh() : runtime.pathIndex.list();
      },
      pickWorkspaceAttachments: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const cwd = runtime.cwd;
        const selectedPaths = await Utils.openFileDialog({
          startingFolder: cwd,
          allowedFileTypes: "*",
          canChooseFiles: true,
          canChooseDirectory: true,
          allowsMultipleSelection: true,
        });
        const attachments = [];
        const skippedPaths = [];

        for (const selectedPath of selectedPaths) {
          if (!selectedPath) continue;
          const attachment = createComposerAttachmentFromPath(cwd, selectedPath);
          if (!attachment) {
            skippedPaths.push(selectedPath);
            continue;
          }
          attachments.push(attachment);
        }

        return { attachments, skippedPaths };
      },
      importComposerAttachments: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const attachments = [];
        const skippedPaths = [];
        for (const attachment of input.attachments) {
          try {
            attachments.push(createImportedComposerAttachment(runtime.cwd, attachment));
          } catch {
            skippedPaths.push(attachment.name);
          }
        }
        return { attachments, skippedPaths };
      },
      openWorkspacePath: (input) => {
        const runtime = getWorkspaceRuntime(input);
        const absolutePath = resolveSafeWorkspacePath(runtime, input.workspaceRelativePath);
        if (!absolutePath) return { opened: false, kind: "missing" };

        const kind = getWorkspacePathKind(absolutePath);
        if (kind === "missing") return { opened: false, kind };

        const opened = kind === "folder" ? Utils.openPath(absolutePath) : true;
        if (kind === "file") {
          Utils.showItemInFolder(absolutePath);
        }
        return { opened, kind };
      },
      getWorkflowsGenerated: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        runtime.appLog.info("workflow.library", "Generated Workflows metadata read.");
        return await readWorkflowsGeneratedReadModel();
      },
      openWorkspaceSourceInEditor: (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { path } = input;
        const absolutePath = resolveSafeWorkspaceOrWorkflowsPath(runtime, path);
        if (!absolutePath || getWorkspacePathKind(absolutePath) === "missing") {
          runtime.appLog.warning("external-editor", "Workspace source file does not exist.", {
            path,
          });
          throw new Error(`Workspace source file does not exist: ${path}`);
        }
        const result = openPathInPreferredEditor(runtime, absolutePath);
        runtime.appLog.info("external-editor", "Workspace source opened in external editor.", {
          path,
          editor: result.editor,
          opened: result.opened,
        });
        return { ...result, path };
      },
      openGeneratedAgentContextExternalSourceInEditor: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const sources = await runtime.catalog.getGeneratedAgentContextExternalSources();
        const source = sources.find((candidate) => candidate.path === input.path);
        if (!source || getWorkspacePathKind(source.path) === "missing") {
          runtime.appLog.warning("external-editor", "Prompt standards source does not exist.", {
            path: input.path,
          });
          throw new Error(`Prompt standards source does not exist: ${input.path}`);
        }
        const result = openPathInPreferredEditor(runtime, source.path);
        runtime.appLog.info(
          "external-editor",
          "Prompt standards source opened in external editor.",
          {
            path: source.path,
            editor: result.editor,
            opened: result.opened,
          },
        );
        return { ...result, path: source.path };
      },
      listSessions: async (input) => {
        return await getWorkspaceRuntime(input).catalog.listSessions();
      },
      getCommandInspector: async (input) => {
        const { sessionId, commandId } = input;
        return await getWorkspaceRuntime(input).catalog.getCommandInspector({
          sessionId,
          commandId,
        });
      },
      listHandlerThreads: async (input) => {
        return await getWorkspaceRuntime(input).catalog.listHandlerThreads({
          sessionId: input.sessionId,
        });
      },
      getHandlerThreadInspector: async (input) => {
        const { sessionId, threadId } = input;
        return await getWorkspaceRuntime(input).catalog.getHandlerThreadInspector({
          sessionId,
          threadId,
        });
      },
      getWorkflowTaskAttemptInspector: async (input) => {
        const { sessionId, workflowTaskAttemptId } = input;
        return await getWorkspaceRuntime(input).catalog.getWorkflowTaskAttemptInspector({
          sessionId,
          workflowTaskAttemptId,
        });
      },
      getArtifactPreview: async (input) => {
        const { sessionId, artifactId } = input;
        return await getWorkspaceRuntime(input).catalog.getArtifactPreview({
          sessionId,
          artifactId,
        });
      },
      createSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { title, parentSessionId, agentProfileId } = input;
        const session = await runtime.catalog.createSession(
          { title, parentSessionId, agentProfileId },
          getSessionDefaults(runtime, agentProfileId),
        );
        recordDevBrowserToolsEvent("session.created", {
          parentSessionId: parentSessionId ?? null,
          sessionId: session.target.workspaceSessionId,
          title: title?.trim() || null,
        });
        runtime.appLog.info("session", "Workspace session created.", {
          parentSessionId: parentSessionId ?? null,
          workspaceSessionId: session.target.workspaceSessionId,
        });
        return session;
      },
      openSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        const session = await runtime.catalog.openSession(sessionId);
        recordDevBrowserToolsEvent("session.opened", {
          sessionId,
        });
        runtime.appLog.info("session", "Workspace session opened.", {
          workspaceSessionId: sessionId,
        });
        return session;
      },
      recordSessionOpened: async (input) => {
        getWorkspaceRuntime(input);
        const { sessionId } = input;
        recordDevBrowserToolsEvent("session.opened", {
          sessionId,
        });
        return { ok: true };
      },
      openSurface: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { target } = input;
        const session = await runtime.catalog.openSurface(target);
        recordDevBrowserToolsEvent("surface.opened", {
          surface: target.surface,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        runtime.appLog.info("surface", "Surface opened.", {
          surface: target.surface,
          workspaceSessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId,
        });
        return session;
      },
      closeSurface: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { target } = input;
        const result = await runtime.catalog.closeSurface(target);
        recordDevBrowserToolsEvent("surface.closed", {
          surface: target.surface,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        runtime.appLog.info("surface", "Surface closed.", {
          surface: target.surface,
          workspaceSessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId,
        });
        return result;
      },
      renameSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId, title } = input;
        const result = await runtime.catalog.renameSession(sessionId, title);
        recordDevBrowserToolsEvent("session.renamed", {
          sessionId,
          title,
        });
        runtime.appLog.info("session", "Workspace session renamed.", {
          workspaceSessionId: sessionId,
          title,
        });
        return result;
      },
      forkSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId, title, messageTimestamp } = input;
        const session = await runtime.catalog.forkSession(
          { sessionId, title, messageTimestamp },
          getSessionDefaults(runtime),
        );
        recordDevBrowserToolsEvent("session.forked", {
          sessionId,
          targetSessionId: session.target.workspaceSessionId,
          messageTimestamp: messageTimestamp ?? null,
          title: title?.trim() || null,
        });
        return session;
      },
      deleteSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        const result = await runtime.catalog.deleteSession(sessionId);
        recordDevBrowserToolsEvent("session.deleted", { sessionId });
        runtime.appLog.info("session", "Workspace session deleted.", {
          workspaceSessionId: sessionId,
        });
        return result;
      },
      pinSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        const result = await runtime.catalog.pinSession(sessionId);
        recordDevBrowserToolsEvent("session.pinned", { sessionId });
        runtime.appLog.info("session", "Workspace session pinned.", {
          workspaceSessionId: sessionId,
        });
        return result;
      },
      unpinSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        const result = await runtime.catalog.unpinSession(sessionId);
        recordDevBrowserToolsEvent("session.unpinned", { sessionId });
        runtime.appLog.info("session", "Workspace session unpinned.", {
          workspaceSessionId: sessionId,
        });
        return result;
      },
      archiveSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        const result = await runtime.catalog.archiveSession(sessionId);
        recordDevBrowserToolsEvent("session.archived", { sessionId });
        runtime.appLog.info("session", "Workspace session archived.", {
          workspaceSessionId: sessionId,
        });
        return result;
      },
      unarchiveSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        const result = await runtime.catalog.unarchiveSession(sessionId);
        recordDevBrowserToolsEvent("session.unarchived", { sessionId });
        runtime.appLog.info("session", "Workspace session unarchived.", {
          workspaceSessionId: sessionId,
        });
        return result;
      },
      markSessionUnread: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        const result = await runtime.catalog.markSessionUnread(sessionId);
        recordDevBrowserToolsEvent("session.marked-unread", { sessionId });
        runtime.appLog.info("session", "Workspace session marked unread.", {
          workspaceSessionId: sessionId,
        });
        return result;
      },
      markSessionRead: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId } = input;
        const result = await runtime.catalog.markSessionRead(sessionId);
        recordDevBrowserToolsEvent("session.marked-read", { sessionId });
        runtime.appLog.info("session", "Workspace session marked read.", {
          workspaceSessionId: sessionId,
        });
        return result;
      },
      recordFocusedSession: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { sessionId, surfacePiSessionId } = input;
        const result = await runtime.catalog.recordFocusedSession({
          sessionId,
          surfacePiSessionId,
        });
        if (sessionId) {
          recordDevBrowserToolsEvent("session.focused", { sessionId });
        }
        return result;
      },
      setArchivedGroupCollapsed: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { collapsed } = input;
        const result = await runtime.catalog.setArchivedGroupCollapsed({ collapsed });
        recordDevBrowserToolsEvent("session.archived-group.toggled", { collapsed });
        return result;
      },
      setSessionNavigationSectionState: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { section, collapsed, sizePx } = input;
        const result = await runtime.catalog.setSessionNavigationSectionState({
          section,
          collapsed,
          sizePx,
        });
        recordDevBrowserToolsEvent("session.navigation-section.updated", {
          section,
          collapsed,
          sizePx,
        });
        return result;
      },
      sendPrompt: async (payload): Promise<SendPromptResponse> => {
        const runtime = getWorkspaceRuntime(payload);
        const resolved = resolveSendDefaults(runtime, payload);

        if (supportsOAuth(resolved.provider)) {
          await refreshIfNeeded(resolved.provider);
        }

        const apiKey = resolveApiKey(resolved.provider);
        if (!apiKey) {
          const message = getApiKeyMissingError(resolved.provider);
          runtime.appLog.warning(
            "auth.provider",
            "Configured provider is not connected for prompt.",
            {
              provider: resolved.provider,
              workspaceSessionId: payload.target.workspaceSessionId,
              surfacePiSessionId: payload.target.surfacePiSessionId,
              threadId: payload.target.threadId,
            },
          );
          throw new Error(message);
        }

        const model = getModel(
          resolved.provider as Parameters<typeof getModel>[0],
          resolved.model as Parameters<typeof getModel>[1],
        );
        let surfacePiSessionId = payload.target.surfacePiSessionId;

        recordDevBrowserToolsEvent("prompt.requested", {
          messageCount: payload.messages.length,
          model: model.id,
          provider: resolved.provider,
          requestedSurfacePiSessionId: payload.target.surfacePiSessionId,
          requestedWorkspaceSessionId: payload.target.workspaceSessionId,
          requestedThreadId: payload.target.threadId ?? null,
        });
        runtime.appLog.info("prompt", "Prompt requested.", {
          messageCount: payload.messages.length,
          model: model.id,
          provider: resolved.provider,
          workspaceSessionId: payload.target.workspaceSessionId,
          surfacePiSessionId: payload.target.surfacePiSessionId,
          threadId: payload.target.threadId,
        });

        const session = await runtime.catalog.sendPrompt({
          target: payload.target,
          provider: resolved.provider,
          model: model.id,
          thinkingLevel: resolved.reasoningEffort,
          messages: payload.messages,
          queueOnly: payload.queueOnly ?? false,
          onEvent: (event) => {
            if (event.type === "start") {
              recordDevBrowserToolsEvent("prompt.started", {
                model: model.id,
                provider: resolved.provider,
                surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
              runtime.appLog.info("prompt", "Prompt started.", {
                model: model.id,
                provider: resolved.provider,
                workspaceSessionId: payload.target.workspaceSessionId,
                surfacePiSessionId,
                threadId: payload.target.threadId,
              });
            } else if (event.type === "done") {
              recordDevBrowserToolsEvent("prompt.finished", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
              runtime.appLog.info("prompt", "Prompt finished.", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                workspaceSessionId: payload.target.workspaceSessionId,
                surfacePiSessionId,
                threadId: payload.target.threadId,
              });
            } else if (event.type === "error") {
              const message =
                event.error.content.find((block) => block.type === "text")?.text ||
                "Prompt failed.";
              recordDevBrowserToolsEvent("prompt.failed", {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
              runtime.appLog.error("prompt", message, {
                model: model.id,
                provider: resolved.provider,
                reason: event.reason,
                surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
            }
          },
        });

        surfacePiSessionId = session.target.surfacePiSessionId;
        runtime.appLog.info(
          "prompt",
          session.queued ? "Prompt queued for active surface." : "Prompt dispatched to pi runtime.",
          {
            model: model.id,
            provider: resolved.provider,
            queued: session.queued ?? false,
            surfacePiSessionId,
            workspaceSessionId: session.target.workspaceSessionId,
            threadId: session.target.threadId,
          },
        );
        return session;
      },
      steerPrompt: async (payload): Promise<SendPromptResponse> => {
        const runtime = getWorkspaceRuntime(payload);
        const resolved = resolveSendDefaults(runtime, payload);

        if (supportsOAuth(resolved.provider)) {
          await refreshIfNeeded(resolved.provider);
        }

        const apiKey = resolveApiKey(resolved.provider);
        if (!apiKey) {
          const message = getApiKeyMissingError(resolved.provider);
          runtime.appLog.warning(
            "auth.provider",
            "Configured provider is not connected for prompt steering.",
            {
              provider: resolved.provider,
              workspaceSessionId: payload.target.workspaceSessionId,
              surfacePiSessionId: payload.target.surfacePiSessionId,
              threadId: payload.target.threadId,
            },
          );
          throw new Error(message);
        }

        const model = getModel(
          resolved.provider as Parameters<typeof getModel>[0],
          resolved.model as Parameters<typeof getModel>[1],
        );
        recordDevBrowserToolsEvent("prompt.steer.requested", {
          messageCount: payload.messages.length,
          model: model.id,
          provider: resolved.provider,
          requestedSurfacePiSessionId: payload.target.surfacePiSessionId,
          requestedWorkspaceSessionId: payload.target.workspaceSessionId,
          requestedThreadId: payload.target.threadId ?? null,
        });
        runtime.appLog.info("prompt", "Prompt steer requested.", {
          messageCount: payload.messages.length,
          model: model.id,
          provider: resolved.provider,
          workspaceSessionId: payload.target.workspaceSessionId,
          surfacePiSessionId: payload.target.surfacePiSessionId,
          threadId: payload.target.threadId,
        });

        const session = await runtime.catalog.steerPrompt({
          target: payload.target,
          provider: resolved.provider,
          model: model.id,
          thinkingLevel: resolved.reasoningEffort,
          messages: payload.messages,
        });

        runtime.appLog.info("prompt", "Prompt steer dispatched to pi runtime.", {
          model: model.id,
          provider: resolved.provider,
          surfacePiSessionId: session.target.surfacePiSessionId,
          workspaceSessionId: session.target.workspaceSessionId,
          threadId: session.target.threadId,
        });
        return session;
      },
      updateComposerDraft: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        return await runtime.catalog.updateComposerDraft(input);
      },
      editCommittedUserMessage: async (payload): Promise<SendPromptResponse> => {
        const runtime = getWorkspaceRuntime(payload);
        const session = await runtime.catalog.editCommittedUserMessage({
          target: payload.target,
          messageTimestamp: payload.messageTimestamp,
          message: payload.message,
          onEvent: (event) => {
            if (event.type === "start") {
              recordDevBrowserToolsEvent("prompt.started", {
                surfacePiSessionId: payload.target.surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
            } else if (event.type === "done") {
              recordDevBrowserToolsEvent("prompt.finished", {
                reason: event.reason,
                surfacePiSessionId: payload.target.surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
            } else if (event.type === "error") {
              recordDevBrowserToolsEvent("prompt.failed", {
                reason: event.reason,
                error: event.error.errorMessage ?? "",
                surfacePiSessionId: payload.target.surfacePiSessionId,
                workspaceSessionId: payload.target.workspaceSessionId,
                threadId: payload.target.threadId ?? null,
              });
            }
          },
        });
        runtime.appLog.info("prompt", "Committed user message edited.", {
          workspaceSessionId: payload.target.workspaceSessionId,
          surfacePiSessionId: payload.target.surfacePiSessionId,
          threadId: payload.target.threadId,
          messageTimestamp: String(payload.messageTimestamp),
        });
        return session;
      },
      deleteQueuedSurfaceMessage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await runtime.catalog.deleteQueuedSurfaceMessage(input);
        runtime.appLog.info("prompt", "Queued surface message deleted.", {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
          queuedMessageId: input.queuedMessageId,
        });
        return result;
      },
      editQueuedSurfaceMessage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await runtime.catalog.editQueuedSurfaceMessage(input);
        runtime.appLog.info("prompt", "Queued surface message restored to composer.", {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
          queuedMessageId: input.queuedMessageId,
        });
        return result;
      },
      reorderQueuedSurfaceMessage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await runtime.catalog.reorderQueuedSurfaceMessage(input);
        runtime.appLog.info("prompt", "Queued surface messages reordered.", {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
          queuedMessageId: input.queuedMessageId,
          beforeQueuedMessageId: input.beforeQueuedMessageId ?? null,
        });
        return result;
      },
      steerQueuedSurfaceMessage: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await runtime.catalog.steerQueuedSurfaceMessage(input);
        runtime.appLog.info("prompt", "Queued surface message steered.", {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
          queuedMessageId: input.queuedMessageId,
        });
        return result;
      },
      answerRequestUserInput: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await runtime.catalog.answerRequestUserInput(input);
        runtime.appLog.info("prompt", "Request user input answered.", {
          surfacePiSessionId: input.surfacePiSessionId,
          requestId: input.requestId,
          questionId: input.questionId,
          delivery: input.delivery,
        });
        return result;
      },
      answerRuntimeApprovalRequest: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await runtime.catalog.answerRuntimeApprovalRequest(input);
        runtime.appLog.info("direct-tool", "Runtime approval request answered.", {
          requestId: input.requestId,
          approved: input.approved,
        });
        return result;
      },
      setRequestUserInputTimerPaused: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await runtime.catalog.setRequestUserInputTimerPaused(input);
        runtime.appLog.info("prompt", "Request user input timer updated.", {
          surfacePiSessionId: input.surfacePiSessionId,
          requestId: input.requestId,
          paused: input.paused,
        });
        return result;
      },
      queuePromptRefresh: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const result = await runtime.catalog.queuePromptRefresh(input);
        runtime.appLog.info("prompt", "Queued surface context update.", {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
        });
        return result;
      },
      cancelPrompt: async (input): Promise<{ ok: boolean }> => {
        const runtime = getWorkspaceRuntime(input);
        const { target } = input;
        await runtime.catalog.cancelPrompt(target);
        recordDevBrowserToolsEvent("prompt.cancel.requested", {
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId ?? null,
          workspaceSessionId: target.workspaceSessionId,
        });
        runtime.appLog.info("prompt", "Prompt cancellation requested.", {
          workspaceSessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: target.threadId,
        });
        return { ok: true };
      },
      setSurfaceModel: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { target, provider, model } = input;
        const result = await runtime.catalog.setSurfaceModel(target, provider, model);
        if (result.ok) {
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
        } else {
          runtime.appLog.error(
            "surface",
            `Surface pi session ${target.surfacePiSessionId} was not found for model update.`,
            {
              model,
              surfacePiSessionId: target.surfacePiSessionId,
            },
          );
        }
        return result;
      },
      setSurfaceThoughtLevel: async (input) => {
        const runtime = getWorkspaceRuntime(input);
        const { target, level } = input;
        const result = await runtime.catalog.setSurfaceThoughtLevel(target, level);
        if (result.ok) {
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
        } else {
          runtime.appLog.error(
            "surface",
            `Surface pi session ${target.surfacePiSessionId} was not found for reasoning update.`,
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
    label: "File",
    submenu: [
      appMenuItem("workspace.open"),
      appMenuItem("workspace.newTab"),
      appMenuItem("workspace.openInNewTab"),
      { type: "separator" },
      appMenuItem("session.new"),
      appMenuItem("session.newPane"),
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
    label: "View",
    submenu: [
      appMenuItem("commandPalette.open"),
      appMenuItem("quickOpen.open"),
      { type: "separator" },
      appMenuItem("sidebar.toggle"),
      { type: "separator" },
      appMenuItem("surface.logs.open"),
      appMenuItem("surface.agents.open"),
      appMenuItem("surface.extensions.open"),
      appMenuItem("surface.workflows.open"),
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
ApplicationMenu.on("application-menu-clicked", (event) => {
  const action = (event as { data?: { action?: unknown } }).data?.action;
  if (!isAppMenuAction(action)) {
    return;
  }
  rpc.send.sendAppMenuAction({ action });
});

loadRuntimeEnv(startupWorkspaceCwd);

const appChannel = await localInfoChannelPromise;
const url = await getMainViewUrl(appChannel);

mainWindow = new BrowserWindow({
  title: "svvy",
  frame: {
    x: 0,
    y: 0,
    width: 1180,
    height: 820,
  },
  titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
  hidden: process.platform === "darwin",
  rpc,
});

if (appChannel === "dev") {
  const { mountDevBrowserToolsBridge } = await import("./dev-browser-tools-bridge");
  const mountedDevBrowserToolsBridge = await mountDevBrowserToolsBridge({
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    getDefaultAgentSettings,
    getMainWindow: () => mainWindow,
    getActiveWorkspace: () => workspaceRuntimeRegistry.getActiveRuntimeOrNull()?.getInfo() ?? null,
    getOpenWorkspaces: () => workspaceRuntimeRegistry.listOpenWorkspaces(),
    getWorkspaceBranch,
    listProviderAuthSummaries,
    listOpenSurfaceSnapshots: async () =>
      (await workspaceRuntimeRegistry
        .getActiveRuntimeOrNull()
        ?.catalog.listOpenSurfaceSnapshots()) ?? [],
    listWorkspaceSessions: async () =>
      (await workspaceRuntimeRegistry.getActiveRuntimeOrNull()?.catalog.listSessions()) ?? {
        sessions: [],
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

  recordDevBrowserToolsEvent("app.ready", {
    bridgeUrl: mountedDevBrowserToolsBridge.url ?? null,
    url,
    workspaceId: workspaceRuntimeRegistry.getActiveWorkspaceId(),
  });
  recordAppRuntimeLog("info", "svvy dev browser tools bridge mounted.", "dev-browser-tools", {
    appId: mountedDevBrowserToolsBridge.appId,
    bridgeUrl: mountedDevBrowserToolsBridge.url ?? null,
  });
  console.log(
    `svvy bridge: ${JSON.stringify({
      appId: mountedDevBrowserToolsBridge.appId,
      bridgeUrl: mountedDevBrowserToolsBridge.url ?? null,
    })}`,
  );
}

mainWindow.webview.loadURL(url);
positionNativeTrafficLights(mainWindow.ptr, NATIVE_TRAFFIC_LIGHT_POSITION);
mainWindow.show();

void mainWindow;

console.log("svvy desktop app started");
