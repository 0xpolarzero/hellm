import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as pty from "node-pty";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { detectAvailableAgents } from "@smithers-orchestrator/cli/agent-detection";
import * as ts from "typescript";
import { discoverPromptInputs, renderPromptPreview } from "../src/promptInputs";
import type { WorkspaceBackendRequest, WorkspaceBackendResponse, WorkspaceStatus } from "../src/workspaceProtocol";

const SMITHERS_DB_QUERY_SCRIPT = fileURLToPath(new URL("./queries/querySmithersDb.mjs", import.meta.url));
const PROMPT_EXTENSIONS = new Set([".md", ".mdx"]);
const WORKFLOW_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const WORKFLOW_IMPORT_EXTENSIONS = new Set([...WORKFLOW_SOURCE_EXTENSIONS, ...PROMPT_EXTENSIONS]);
const LOG_EXTENSIONS = new Set([".log"]);
const LOG_LEVELS = new Set(["debug", "info", "warning", "error"]);
const LOG_CATEGORIES = new Set(["network", "ui", "lifecycle", "performance", "error", "agent", "codex", "terminal", "state"]);
const MAX_LOG_READ_BYTES = 5_000_000;
const BROWSER_SEARCH_ENGINES = new Set(["duckduckgo", "google", "bing"]);
const COMMON_SHELL_PATHS = [
  "/bin/zsh",
  "/bin/bash",
  "/bin/sh",
  "/opt/homebrew/bin/fish",
  "/usr/local/bin/fish",
  "/opt/homebrew/bin/nu",
  "/usr/local/bin/nu",
];
const COMMON_NEOVIM_PATHS = [
  "/opt/homebrew/bin/nvim",
  "/usr/local/bin/nvim",
  "/usr/bin/nvim",
];
const STUDIO_APP_VERSION = "0.21.0";
const MIN_SMITHERS_VERSION = "0.16.0";
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const SKIPPED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const TERMINAL_SESSION_EVENT_LIMIT = 1_000;
const TERMINAL_SESSION_OUTPUT_LIMIT = 1_000_000;
// Completed terminal sessions retain their child handle + up to ~2MB of
// captured output. Evict them so the Map cannot grow unbounded: drop finished
// sessions older than this TTL, and cap the number of retained finished
// sessions (LRU by completion time) regardless of age.
const TERMINAL_SESSION_COMPLETED_TTL_MS = 10 * 60 * 1000;
const TERMINAL_SESSION_COMPLETED_LIMIT = 50;
// How long to wait after SIGTERM before escalating to SIGKILL on stop.
const TERMINAL_SESSION_KILL_GRACE_MS = 2_000;
const MAX_OPERATOR_SCREENSHOT_BYTES = 20_000_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const terminalSessions = new Map<string, WorkspaceTerminalSessionRecord>();

type AgentAvailability = {
  id: string;
  displayName: string;
  binary: string;
  hasAuthSignal: boolean;
  hasApiKeySignal: boolean;
  status: string;
  usable: boolean;
  checks: string[];
  unusableReasons: string[];
};

type WorkspaceChange = {
  changeID: string;
  commitID: string | null;
  description: string | null;
  author: {
    name: string | null;
    email: string | null;
  } | null;
  timestamp: string | null;
  bookmarks: string[];
  isEmpty: boolean | null;
  isWorkingCopy: boolean | null;
};

type CloudWorkspace = {
  id: string;
  name: string;
  status: string | null;
  createdAt: string | null;
};

type CloudWorkspaceSnapshot = {
  id: string;
  workspaceId: string;
  name: string | null;
  createdAt: string | null;
};

type JjhubAuthStatus = {
  loggedIn: boolean;
  tokenSet: boolean;
  tokenSource: string | null;
  apiUrl: string | null;
  user: string | null;
  email: string | null;
};

type JjhubIssue = {
  id: string;
  number: number | null;
  title: string;
  body: string | null;
  state: string | null;
  labels: string[] | null;
  assignees: string[] | null;
  commentCount: number | null;
};

type JjhubLanding = {
  id: string;
  number: number | null;
  title: string;
  description: string | null;
  state: string | null;
  targetBranch: string | null;
  author: string | null;
  createdAt: string | null;
  reviewStatus: string | null;
};

type JjhubLandingConflict = {
  changeID: string | null;
  filePath: string;
  conflictType: string | null;
  resolved: boolean | null;
  resolutionStatus: string | null;
};

type JjhubLandingConflicts = {
  conflictStatus: string | null;
  hasConflicts: boolean;
  conflicts: JjhubLandingConflict[];
};

type JjhubWorkflow = {
  id: number;
  repositoryID: number | null;
  name: string;
  path: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type JjhubWorkflowRun = {
  id: number | null;
  workflowDefinitionID: number | null;
  status: string | null;
  triggerEvent: string | null;
  triggerRef: string | null;
  triggerCommitSHA: string | null;
  startedAt: string | null;
  completedAt: string | null;
  sessionID: string | null;
  steps: string[] | null;
};

type WorkspaceLogEntry = {
  id: string;
  timestamp: string | null;
  level: string;
  category: string;
  message: string;
  metadata: Record<string, string> | null;
  sourcePath: string;
  raw: string | null;
};

type WorkspaceLogSource = {
  path: string;
  sizeBytes: number;
  entryCount: number;
};

type WorkspaceLogPayload = {
  entries: WorkspaceLogEntry[];
  stats: {
    entryCount: number;
    sizeBytes: number;
    errorCount: number;
    warningCount: number;
    categories: Array<{ category: string; count: number }>;
    sources: WorkspaceLogSource[];
  };
};

type WorkspaceTerminalExecution = {
  id: string;
  command: string;
  cwd: string;
  shellPath: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};

type WorkspaceTerminalSessionEvent = {
  seq: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
  at: string;
};

type WorkspaceTerminalSessionRecord = {
  id: string;
  workspaceRoot: string;
  command: string;
  cwd: string;
  shellPath: string;
  startedAtMs: number;
  startedAt: string;
  completedAtMs: number | null;
  completedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  running: boolean;
  child: { kind: "pty"; process: pty.IPty } | { kind: "process"; process: ChildProcessWithoutNullStreams };
  nextSeq: number;
  events: WorkspaceTerminalSessionEvent[];
  rows: number;
  cols: number;
  stdout: string;
  stderr: string;
};

type WorkspaceBrowserResolution = {
  raw: string;
  url: string;
  engine: string;
};

type LocalWorkspaceRecent = {
  path: string;
  displayName: string;
  lastOpenedAt: string;
  exists: boolean;
  hasSmithers: boolean;
  smithersPath: string | null;
};

type StudioStateRecent = {
  path: string;
  lastOpenedAt: string;
};

type StudioState = {
  recentLocalWorkspaces: StudioStateRecent[];
};

type WorkspaceDebugRow = {
  label: string;
  value: string;
  tone: "normal" | "good" | "warning" | "danger";
};

type WorkspaceDebugEvent = {
  id: string;
  timestamp: string | null;
  level: string;
  name: string;
  source: string;
  detail: string;
};

type WorkspaceDebugPayload = {
  capturedAt: string;
  runtimeRows: WorkspaceDebugRow[];
  workspaceRows: WorkspaceDebugRow[];
  logRows: WorkspaceDebugRow[];
  metricRows: WorkspaceDebugRow[];
  events: WorkspaceDebugEvent[];
  logs: WorkspaceLogEntry[];
};

const AGENT_ROLES: Record<string, string[]> = {
  claude: ["coding", "review", "spec"],
  codex: ["coding", "implement"],
  antigravity: ["coding", "research", "plan"],
  gemini: ["coding", "research"],
  pi: ["coding", "chat"],
  opencode: ["coding", "implement", "review"],
  kimi: ["research", "plan"],
  amp: ["coding", "validate"],
};

const AGENT_MODELS: Record<string, Array<{ id: string; label: string }>> = {
  claude: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  ],
  codex: [
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { id: "gpt-5.4-codex", label: "GPT-5.4 Codex" },
  ],
  antigravity: [
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  ],
  gemini: [
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  pi: [
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  ],
  opencode: [
    { id: "anthropic/claude-opus-4-20250514", label: "Claude Opus via OpenCode" },
    { id: "github-copilot/claude-sonnet-4.6", label: "Claude Sonnet via Copilot" },
    { id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex via OpenCode" },
  ],
  kimi: [
    { id: "kimi-latest", label: "Kimi Latest" },
  ],
};

type WorkspaceSettingsPreferences = {
  vimModeEnabled: boolean;
  developerToolsEnabled: boolean;
  smithersGUIControlSidebarEnabled: boolean;
  externalAgentUnsafeFlagsEnabled: boolean;
  shortcutCheatSheetFooterEnabled: boolean;
  shortcutOverrides: Record<string, string>;
  browserSearchEngine: string;
  defaultShellPath: string;
};

type WorkspaceEditorTargetKind = "smithers" | "ticket";

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsPreferences = {
  vimModeEnabled: false,
  developerToolsEnabled: false,
  smithersGUIControlSidebarEnabled: false,
  externalAgentUnsafeFlagsEnabled: false,
  shortcutCheatSheetFooterEnabled: false,
  shortcutOverrides: {},
  browserSearchEngine: "duckduckgo",
  defaultShellPath: "",
};

export class WorkspaceHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const JJHUB_REPOSITORY_NOT_FOUND_MESSAGE =
  "JJHub repository not found. Connect this workspace to a JJHub repository or check repository access.";

function jjhubErrorFromOutput(output: string) {
  if (/API\s+404:\s+repository not found/i.test(output)) {
    return new WorkspaceHttpError(404, JJHUB_REPOSITORY_NOT_FOUND_MESSAGE);
  }
  return new WorkspaceHttpError(500, output || "jjhub command failed.");
}

function findWorkspaceRoot(start: string) {
  let current = resolve(start);
  while (true) {
    const smithersPath = join(current, ".smithers");
    if (existsSync(smithersPath)) {
      return {
        root: current,
        smithersPath,
        workflowsPath: join(smithersPath, "workflows"),
        workflowsPathExists: existsSync(join(smithersPath, "workflows")),
      };
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

type WorkspaceRoot = NonNullable<ReturnType<typeof findWorkspaceRoot>>;

export function loadWorkspaceStatus(start = process.env.SMITHERS_STUDIO_WORKSPACE ?? process.cwd()): WorkspaceStatus {
  const cwd = resolve(start);
  const workspace = findWorkspaceRoot(cwd);
  const status = {
    cwd,
    root: workspace?.root ?? null,
    hasSmithers: Boolean(workspace),
    smithersPath: workspace?.smithersPath ?? null,
    workflowsPath: workspace?.workflowsPathExists ? workspace.workflowsPath : null,
  };
  if (workspace?.root) {
    try {
      upsertLocalWorkspaceRecent(workspace.root);
    } catch {
      // Workspace probing should not fail just because the recent list is unavailable.
    }
  }
  return status;
}

function currentWorkspace() {
  const cwd = resolve(process.env.SMITHERS_STUDIO_WORKSPACE ?? process.cwd());
  const workspace = findWorkspaceRoot(cwd);
  if (!workspace) {
    throw new WorkspaceHttpError(404, `.smithers not found from ${cwd}`);
  }
  return { cwd, workspace };
}

function findSmithersDb(workspace: WorkspaceRoot) {
  const candidates = [
    process.env.SMITHERS_STUDIO_DB_PATH,
    join(workspace.root, "smithers.db"),
    join(workspace.smithersPath, "smithers.db"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const dbPath = candidates.map((candidate) => resolve(candidate)).find((candidate) => existsSync(candidate));
  if (!dbPath) {
    throw new WorkspaceHttpError(404, `No smithers.db found for ${workspace.root}.`);
  }
  return dbPath;
}

function resolveExecutable(command: string, env: NodeJS.ProcessEnv) {
  const pathEntries = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const pathEntry of pathEntries) {
    const candidate = resolve(pathEntry, command);
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) {
        return candidate;
      }
    } catch {
      // Keep looking through PATH.
    }
  }
  return "";
}

function isExecutableFile(path: string) {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function normalizeAbsolutePath(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const expanded = trimmed === "~"
    ? process.env.HOME ?? trimmed
    : trimmed.startsWith("~/")
    ? join(process.env.HOME ?? "", trimmed.slice(2))
    : trimmed;
  return expanded.startsWith(sep) ? expanded : "";
}

function studioStatePath() {
  const configured = normalizeAbsolutePath(process.env.SMITHERS_STUDIO_STATE_PATH);
  if (configured) {
    return configured;
  }
  const home = normalizeAbsolutePath(process.env.HOME);
  return home ? join(home, ".smithers", "studio-state.json") : join(process.cwd(), ".smithers", "studio-state.json");
}

function coerceStudioState(value: unknown): StudioState {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const recentValues = Array.isArray(source.recentLocalWorkspaces) ? source.recentLocalWorkspaces : [];
  const seen = new Set<string>();
  const recentLocalWorkspaces: StudioStateRecent[] = [];
  for (const entry of recentValues) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const path = normalizeAbsolutePath(record.path);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    recentLocalWorkspaces.push({
      path,
      lastOpenedAt: typeof record.lastOpenedAt === "string" && record.lastOpenedAt.trim()
        ? record.lastOpenedAt
        : new Date(0).toISOString(),
    });
  }
  return { recentLocalWorkspaces: recentLocalWorkspaces.slice(0, 20) };
}

function readStudioState(): StudioState {
  const path = studioStatePath();
  if (!existsSync(path)) {
    return { recentLocalWorkspaces: [] };
  }
  try {
    return coerceStudioState(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    throw new WorkspaceHttpError(400, `Invalid Studio state file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeStudioState(state: StudioState) {
  const path = studioStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(coerceStudioState(state), null, 2) + "\n");
}

function localWorkspaceRecentFromState(entry: StudioStateRecent): LocalWorkspaceRecent {
  const workspace = findWorkspaceRoot(entry.path);
  let exists = false;
  try {
    exists = statSync(entry.path).isDirectory();
  } catch {
    exists = false;
  }
  return {
    path: entry.path,
    displayName: basename(entry.path) || entry.path,
    lastOpenedAt: entry.lastOpenedAt,
    exists,
    hasSmithers: Boolean(workspace),
    smithersPath: workspace?.smithersPath ?? null,
  };
}

function listLocalWorkspaceRecents() {
  return readStudioState().recentLocalWorkspaces.map(localWorkspaceRecentFromState);
}

function upsertLocalWorkspaceRecent(path: string) {
  const resolved = resolve(path);
  const state = readStudioState();
  const recentLocalWorkspaces = [
    { path: resolved, lastOpenedAt: new Date().toISOString() },
    ...state.recentLocalWorkspaces.filter((entry) => entry.path !== resolved),
  ].slice(0, 20);
  writeStudioState({ ...state, recentLocalWorkspaces });
}

function removeLocalWorkspaceRecent(path: string) {
  const resolved = resolve(path);
  const state = readStudioState();
  writeStudioState({
    ...state,
    recentLocalWorkspaces: state.recentLocalWorkspaces.filter((entry) => entry.path !== resolved),
  });
}

function openLocalWorkspace(path: string) {
  const resolved = resolve(path);
  try {
    if (!statSync(resolved).isDirectory()) {
      throw new WorkspaceHttpError(400, `Local workspace is not a directory: ${resolved}`);
    }
  } catch (error) {
    if (error instanceof WorkspaceHttpError) {
      throw error;
    }
    throw new WorkspaceHttpError(404, `Local workspace does not exist: ${resolved}`);
  }
  process.env.SMITHERS_STUDIO_WORKSPACE = resolved;
  return loadWorkspaceStatus(resolved);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function coerceShortcutOverrides(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, shortcut] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || typeof shortcut !== "string") {
      continue;
    }
    const trimmed = shortcut.trim();
    if (trimmed && trimmed.length <= 80) {
      result[key] = trimmed;
    }
  }
  return result;
}

function workspaceSettingsPath(workspace: WorkspaceRoot) {
  return join(workspace.smithersPath, "studio-settings.json");
}

function coerceWorkspaceSettings(value: unknown): WorkspaceSettingsPreferences {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const preferences = "preferences" in source && source.preferences &&
    typeof source.preferences === "object" && !Array.isArray(source.preferences)
    ? source.preferences as Record<string, unknown>
    : source;
  const browserSearchEngine = typeof preferences.browserSearchEngine === "string" &&
    BROWSER_SEARCH_ENGINES.has(preferences.browserSearchEngine)
    ? preferences.browserSearchEngine
    : DEFAULT_WORKSPACE_SETTINGS.browserSearchEngine;
  return {
    vimModeEnabled: Boolean(preferences.vimModeEnabled),
    developerToolsEnabled: Boolean(preferences.developerToolsEnabled),
    smithersGUIControlSidebarEnabled: Boolean(preferences.smithersGUIControlSidebarEnabled),
    externalAgentUnsafeFlagsEnabled: Boolean(preferences.externalAgentUnsafeFlagsEnabled),
    shortcutCheatSheetFooterEnabled: Boolean(preferences.shortcutCheatSheetFooterEnabled),
    shortcutOverrides: coerceShortcutOverrides(preferences.shortcutOverrides),
    browserSearchEngine,
    defaultShellPath: normalizeAbsolutePath(preferences.defaultShellPath),
  };
}

function readWorkspaceSettings(workspace: WorkspaceRoot) {
  const path = workspaceSettingsPath(workspace);
  if (!existsSync(path)) {
    return { ...DEFAULT_WORKSPACE_SETTINGS };
  }
  try {
    return coerceWorkspaceSettings(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    throw new WorkspaceHttpError(400, `Invalid settings file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function availableShellPaths(preferences: WorkspaceSettingsPreferences) {
  return uniqueStrings([
    normalizeAbsolutePath(preferences.defaultShellPath),
    normalizeAbsolutePath(process.env.SHELL),
    ...COMMON_SHELL_PATHS,
  ]).filter(isExecutableFile);
}

function detectNeovimPath() {
  return uniqueStrings([
    resolveExecutable("nvim", process.env),
    ...COMMON_NEOVIM_PATHS,
  ]).find(isExecutableFile) ?? null;
}

function workspaceSettingsPayload(workspace: WorkspaceRoot) {
  const preferences = readWorkspaceSettings(workspace);
  const shellCandidates = availableShellPaths(preferences);
  const neovimPath = detectNeovimPath();
  return {
    preferences: {
      ...preferences,
      vimModeEnabled: preferences.vimModeEnabled && Boolean(neovimPath),
    },
    detections: {
      settingsPath: workspaceSettingsPath(workspace),
      shellCandidates,
      resolvedShellPath: shellCandidates[0] ?? null,
      neovimPath,
      neovimAvailable: Boolean(neovimPath),
    },
  };
}

function saveWorkspaceSettings(workspace: WorkspaceRoot, body: Record<string, unknown>) {
  const current = readWorkspaceSettings(workspace);
  const incoming = coerceWorkspaceSettings({ ...current, ...bodyRecord(body.preferences ?? body) });
  const neovimPath = detectNeovimPath();
  if (incoming.defaultShellPath && !isExecutableFile(incoming.defaultShellPath)) {
    throw new WorkspaceHttpError(400, `Default shell is not executable: ${incoming.defaultShellPath}`);
  }
  const preferences: WorkspaceSettingsPreferences = {
    ...incoming,
    vimModeEnabled: incoming.vimModeEnabled && Boolean(neovimPath),
  };
  mkdirSync(workspace.smithersPath, { recursive: true });
  writeFileSync(
    workspaceSettingsPath(workspace),
    `${JSON.stringify({ preferences }, null, 2)}\n`,
  );
  return workspaceSettingsPayload(workspace);
}

function workspaceShellPath(workspace: WorkspaceRoot) {
  const shell = availableShellPaths(readWorkspaceSettings(workspace))[0];
  if (!shell) {
    throw new WorkspaceHttpError(404, "No executable shell found for terminal sessions.");
  }
  return shell;
}

function terminalWorkingDirectory(workspace: WorkspaceRoot, value: unknown) {
  const raw = normalizedText(value);
  const candidate = raw
    ? raw.startsWith(sep) ? resolve(raw) : resolve(workspace.root, raw)
    : workspace.root;
  if (candidate !== workspace.root && !candidate.startsWith(`${workspace.root}${sep}`)) {
    throw new WorkspaceHttpError(400, "Terminal working directory must stay inside the workspace.");
  }
  try {
    if (!statSync(candidate).isDirectory()) {
      throw new WorkspaceHttpError(400, "Terminal working directory must be a directory.");
    }
  } catch (error) {
    if (error instanceof WorkspaceHttpError) {
      throw error;
    }
    throw new WorkspaceHttpError(404, `Terminal working directory not found: ${candidate}`);
  }
  return candidate;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function workspaceEditorSmithersPath(workspace: WorkspaceRoot, pathValue: unknown) {
  const raw = normalizedText(pathValue);
  if (!raw) {
    throw new WorkspaceHttpError(400, "path is required.");
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const relativePath = normalized.startsWith(".smithers/")
    ? normalized
    : `.smithers/${normalized}`;
  if (!isSafeRelativePath(relativePath) || !relativePath.startsWith(".smithers/")) {
    throw new WorkspaceHttpError(400, "path must be a safe .smithers relative path.");
  }
  const absolutePath = resolve(workspace.root, relativePath);
  const workspaceRoot = resolve(workspace.root);
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${sep}`)) {
    throw new WorkspaceHttpError(400, "path must stay inside the workspace.");
  }
  if (!TEXT_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
    throw new WorkspaceHttpError(400, "path must be a text file supported by Smithers Studio.");
  }
  try {
    if (!statSync(absolutePath).isFile()) {
      throw new WorkspaceHttpError(400, "path must be a file.");
    }
  } catch (error) {
    if (error instanceof WorkspaceHttpError) {
      throw error;
    }
    throw new WorkspaceHttpError(404, `File not found: ${relativePath}`);
  }
  return {
    path: relativePath,
    absolutePath,
  };
}

function workspaceEditorTicketPath(workspace: WorkspaceRoot, ticketId: unknown) {
  const absolutePath = ticketPathForId(workspace, ticketId);
  try {
    if (!statSync(absolutePath).isFile()) {
      throw new WorkspaceHttpError(400, "ticket must be backed by a file.");
    }
  } catch (error) {
    if (error instanceof WorkspaceHttpError) {
      throw error;
    }
    throw new WorkspaceHttpError(404, `Ticket ${String(ticketId ?? "")} not found.`);
  }
  return {
    path: workspaceRelativePath(workspace, absolutePath),
    absolutePath,
  };
}

function workspaceEditorTarget(workspace: WorkspaceRoot, query: WorkspaceBackendRequest["query"]) {
  const kind = queryParam(query, "kind") as WorkspaceEditorTargetKind | null;
  if (kind !== "ticket" && kind !== "smithers") {
    throw new WorkspaceHttpError(400, "kind must be smithers or ticket.");
  }
  const target = kind === "ticket"
    ? workspaceEditorTicketPath(workspace, queryParam(query, "ticketId"))
    : workspaceEditorSmithersPath(workspace, queryParam(query, "path"));
  const settings = workspaceSettingsPayload(workspace);
  const neovimPath = settings.detections.neovimPath;
  const vimModeEnabled = settings.preferences.vimModeEnabled && Boolean(neovimPath);
  return {
    kind,
    path: target.path,
    absolutePath: target.absolutePath,
    cwd: dirname(target.absolutePath),
    vimModeEnabled,
    neovimAvailable: settings.detections.neovimAvailable,
    neovimPath,
    neovimCommand: vimModeEnabled && neovimPath
      ? `${shellQuote(neovimPath)} ${shellQuote(target.absolutePath)}`
      : null,
  };
}

const TERMINAL_EXECUTE_TIMEOUT_MS = 30_000;

function terminalExecuteTimeoutMs(body: Record<string, unknown>) {
  const value = body.timeoutMs;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return TERMINAL_EXECUTE_TIMEOUT_MS;
  }
  return Math.max(50, Math.min(TERMINAL_EXECUTE_TIMEOUT_MS, Math.floor(value)));
}

function killProcessTree(child: ChildProcessWithoutNullStreams) {
  if (child.pid == null) {
    return;
  }
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Process may already have exited.
    }
  }
}

async function executeTerminalCommand(workspace: WorkspaceRoot, body: Record<string, unknown>): Promise<WorkspaceTerminalExecution> {
  const command = normalizedText(body.command);
  if (!command) {
    throw new WorkspaceHttpError(400, "command is required.");
  }
  if (command.length > 20_000) {
    throw new WorkspaceHttpError(400, "command is too long.");
  }
  const cwd = terminalWorkingDirectory(workspace, body.cwd);
  const shellPath = workspaceShellPath(workspace);
  const timeoutMs = terminalExecuteTimeoutMs(body);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const child = spawn(shellPath, ["-lc", command], {
    cwd,
    detached: process.platform !== "win32",
    env: process.env,
    stdio: "pipe",
  }) as ChildProcessWithoutNullStreams;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + String(chunk)).slice(-2_000_000);
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2_000_000);
  });

  const result = await new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      stderr = `${stderr}${stderr ? "\n" : ""}Command timed out after ${timeoutMs}ms.`;
      const processGroupPid = child.pid;
      killProcessTree(child);
      setTimeout(() => {
        try {
          if (process.platform === "win32") {
            child.kill("SIGKILL");
          } else if (processGroupPid != null) {
            process.kill(-processGroupPid, "SIGKILL");
          }
        } catch {
          // Process group may already have exited.
        }
      }, 500).unref();
    }, timeoutMs);
    timer.unref();
    child.on("error", (error) => {
      clearTimeout(timer);
      stderr = `${stderr}${stderr ? "\n" : ""}${error.message}`;
      resolve({ exitCode: null, signal: null });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? null : code,
        signal: timedOut ? "TIMEOUT" : signal,
      });
    });
  });
  const completedAtMs = Date.now();
  return {
    id: `${startedAtMs}:${Math.random().toString(36).slice(2)}`,
    command,
    cwd: workspaceLogDisplayPath(workspace, cwd),
    shellPath,
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout,
    stderr,
  };
}

function terminalSessionDuration(record: WorkspaceTerminalSessionRecord) {
  return record.completedAtMs === null ? null : record.completedAtMs - record.startedAtMs;
}

function appendTerminalSessionEvent(
  record: WorkspaceTerminalSessionRecord,
  stream: WorkspaceTerminalSessionEvent["stream"],
  text: string,
) {
  if (!text) {
    return;
  }
  record.events.push({
    seq: record.nextSeq,
    stream,
    text,
    at: new Date().toISOString(),
  });
  record.nextSeq += 1;
  if (stream === "stdout") {
    record.stdout = (record.stdout + text).slice(-TERMINAL_SESSION_OUTPUT_LIMIT);
  } else if (stream === "stderr") {
    record.stderr = (record.stderr + text).slice(-TERMINAL_SESSION_OUTPUT_LIMIT);
  }
  if (record.events.length > TERMINAL_SESSION_EVENT_LIMIT) {
    record.events.splice(0, record.events.length - TERMINAL_SESSION_EVENT_LIMIT);
  }
}

function terminalSessionSnapshot(workspace: WorkspaceRoot, record: WorkspaceTerminalSessionRecord) {
  return {
    id: record.id,
    command: record.command,
    cwd: workspaceLogDisplayPath(workspace, record.cwd),
    shellPath: record.shellPath,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    durationMs: terminalSessionDuration(record),
    exitCode: record.exitCode,
    signal: record.signal,
    running: record.running,
    events: record.events,
    stdout: record.stdout,
    stderr: record.stderr,
  };
}

function terminalSessionRecord(workspace: WorkspaceRoot, id: string | null) {
  if (!id) {
    throw new WorkspaceHttpError(400, "session id is required.");
  }
  const record = terminalSessions.get(id);
  if (!record || record.workspaceRoot !== workspace.root) {
    throw new WorkspaceHttpError(404, `Terminal session not found: ${id}`);
  }
  return record;
}

/**
 * Evict finished terminal sessions so the in-memory Map cannot grow unbounded.
 * Each completed record still pins a child handle and up to ~2MB of captured
 * output, so we drop finished sessions past the TTL and cap the retained
 * finished count (LRU by completion time). Running sessions are never evicted.
 */
function sweepCompletedTerminalSessions(): void {
  const now = Date.now();
  const completed: WorkspaceTerminalSessionRecord[] = [];
  for (const record of terminalSessions.values()) {
    if (record.running || record.completedAtMs === null) {
      continue;
    }
    if (now - record.completedAtMs > TERMINAL_SESSION_COMPLETED_TTL_MS) {
      terminalSessions.delete(record.id);
    } else {
      completed.push(record);
    }
  }
  if (completed.length > TERMINAL_SESSION_COMPLETED_LIMIT) {
    completed.sort((a, b) => (a.completedAtMs ?? 0) - (b.completedAtMs ?? 0));
    const overflow = completed.length - TERMINAL_SESSION_COMPLETED_LIMIT;
    for (let i = 0; i < overflow; i += 1) {
      terminalSessions.delete(completed[i]!.id);
    }
  }
}

/** Best-effort SIGTERM of a terminal session's child (whole process group for
 * detached non-pty children), then escalate to SIGKILL after a grace period. */
function killTerminalChild(record: WorkspaceTerminalSessionRecord): void {
  const child = record.child;
  if (child.kind === "pty") {
    try {
      child.process.kill("SIGTERM");
    } catch {
      // Already exited.
    }
    setTimeout(() => {
      if (record.running) {
        try {
          child.process.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }
    }, TERMINAL_SESSION_KILL_GRACE_MS).unref();
    return;
  }
  const pid = child.process.pid;
  const killGroup = (signal: NodeJS.Signals) => {
    if (process.platform === "win32") {
      if (pid != null) {
        execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
      }
      return;
    }
    try {
      if (pid != null) {
        process.kill(-pid, signal);
      }
    } catch {
      try {
        child.process.kill(signal);
      } catch {
        // Already exited.
      }
    }
  };
  killGroup("SIGTERM");
  setTimeout(() => {
    if (record.running) {
      killGroup("SIGKILL");
    }
  }, TERMINAL_SESSION_KILL_GRACE_MS).unref();
}

function startTerminalSession(workspace: WorkspaceRoot, body: Record<string, unknown>) {
  sweepCompletedTerminalSessions();
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (command.length > 20_000) {
    throw new WorkspaceHttpError(400, "command is too long.");
  }
  const cwd = terminalWorkingDirectory(workspace, body.cwd);
  const shellPath = workspaceShellPath(workspace);
  const rows = typeof body.rows === "number" ? Math.max(1, Math.min(200, body.rows)) : 24;
  const cols = typeof body.cols === "number" ? Math.max(1, Math.min(500, body.cols)) : 80;
  const startedAtMs = Date.now();
  const id = `${startedAtMs}:${Math.random().toString(36).slice(2)}`;

  let child: WorkspaceTerminalSessionRecord["child"];
  try {
    const ptyProcess = pty.spawn(shellPath, command ? ["-lc", command] : [], {
      name: "xterm-color",
      cols,
      rows,
      cwd,
      env: process.env,
    });
    child = { kind: "pty", process: ptyProcess };
  } catch {
    const processChild = spawn(shellPath, command ? ["-lc", command] : [], {
      cwd,
      // Detach into its own process group (POSIX) so stop can SIGTERM/SIGKILL
      // the whole tree, not just the shell.
      detached: process.platform !== "win32",
      env: process.env,
      stdio: "pipe",
    }) as ChildProcessWithoutNullStreams;
    child = { kind: "process", process: processChild };
  }

  const record: WorkspaceTerminalSessionRecord = {
    id,
    workspaceRoot: workspace.root,
    command: command || shellPath,
    cwd,
    shellPath,
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAtMs: null,
    completedAt: null,
    exitCode: null,
    signal: null,
    running: true,
    child,
    nextSeq: 1,
    events: [],
    stdout: "",
    stderr: "",
    rows,
    cols,
  };
  terminalSessions.set(id, record);
  appendTerminalSessionEvent(record, "system", `Started ${record.command}\n`);

  if (child.kind === "pty") {
    // PTY combines stdout/stderr into a single data stream.
    child.process.onData((data) => appendTerminalSessionEvent(record, "stdout", data));
    child.process.onExit(({ exitCode, signal }) => {
      record.running = false;
      record.completedAtMs = Date.now();
      record.completedAt = new Date(record.completedAtMs).toISOString();
      record.exitCode = exitCode;
      record.signal = signal ? String(signal) : null;
      appendTerminalSessionEvent(record, "system", signal ? `Signal ${signal}\n` : `Exit ${exitCode ?? "unknown"}\n`);
      sweepCompletedTerminalSessions();
    });
  } else {
    child.process.stdout.on("data", (chunk) => appendTerminalSessionEvent(record, "stdout", String(chunk)));
    child.process.stderr.on("data", (chunk) => appendTerminalSessionEvent(record, "stderr", String(chunk)));
    child.process.on("error", (error) => appendTerminalSessionEvent(record, "stderr", `${error.message}\n`));
    child.process.on("exit", (code, signal) => {
      record.running = false;
      record.completedAtMs = Date.now();
      record.completedAt = new Date(record.completedAtMs).toISOString();
      record.exitCode = code;
      record.signal = signal;
      appendTerminalSessionEvent(record, "system", signal ? `Signal ${signal}\n` : `Exit ${code ?? "unknown"}\n`);
      sweepCompletedTerminalSessions();
    });
  }

  return terminalSessionSnapshot(workspace, record);
}

function sendTerminalSessionInput(workspace: WorkspaceRoot, id: string | null, body: Record<string, unknown>) {
  const record = terminalSessionRecord(workspace, id);
  if (!record.running) {
    throw new WorkspaceHttpError(400, "Terminal session is not running.");
  }
  const input = body.input == null ? "" : String(body.input);
  if (input.length > 100_000) {
    throw new WorkspaceHttpError(400, "input is too long.");
  }
  if (record.child.kind === "pty") {
    record.child.process.write(input);
  } else {
    record.child.process.stdin.write(input);
  }
  return terminalSessionSnapshot(workspace, record);
}

function resizeTerminalSession(workspace: WorkspaceRoot, id: string | null, body: Record<string, unknown>) {
  const record = terminalSessionRecord(workspace, id);
  if (!record.running) {
    throw new WorkspaceHttpError(400, "Terminal session is not running.");
  }
  const rows = typeof body.rows === "number" ? Math.max(1, Math.min(200, body.rows)) : record.rows;
  const cols = typeof body.cols === "number" ? Math.max(1, Math.min(500, body.cols)) : record.cols;

  if (rows !== record.rows || cols !== record.cols) {
    record.rows = rows;
    record.cols = cols;
    if (record.child.kind === "pty") {
      record.child.process.resize(cols, rows);
    }
  }
  return terminalSessionSnapshot(workspace, record);
}

function stopTerminalSession(workspace: WorkspaceRoot, id: string | null) {
  const record = terminalSessionRecord(workspace, id);
  if (record.running) {
    // Don't fabricate a "completed" state here: signal the real child and let
    // its exit handler set running=false / exitCode / signal from the actual
    // termination. We escalate SIGTERM -> SIGKILL so a process that ignores
    // SIGTERM (or a non-pty process group) is still reaped.
    appendTerminalSessionEvent(record, "system", "Stop requested.\n");
    killTerminalChild(record);
  } else {
    // Already finished: explicit stop should free the retained child handle +
    // captured output immediately rather than waiting for the TTL sweep.
    terminalSessions.delete(record.id);
  }
  return terminalSessionSnapshot(workspace, record);
}

function browserSearchBase(engine: string) {
  if (engine === "google") {
    return "https://www.google.com/search";
  }
  if (engine === "bing") {
    return "https://www.bing.com/search";
  }
  return "https://duckduckgo.com/";
}

function resolveBrowserURL(workspace: WorkspaceRoot, value: unknown): WorkspaceBrowserResolution {
  const raw = assertBodyString({ value }, "value");
  const engine = readWorkspaceSettings(workspace).browserSearchEngine;
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new WorkspaceHttpError(400, "value is required.");
  }
  try {
    const parsed = new URL(trimmed);
    return { raw: trimmed, url: parsed.toString(), engine };
  } catch {
    // Continue with app-style address resolution.
  }
  const lowercased = trimmed.toLowerCase();
  if (lowercased.startsWith("localhost") || lowercased.startsWith("127.0.0.1") || trimmed.includes(":")) {
    return { raw: trimmed, url: new URL(`http://${trimmed}`).toString(), engine };
  }
  if (trimmed.includes(".")) {
    return { raw: trimmed, url: new URL(`https://${trimmed}`).toString(), engine };
  }
  const url = new URL(browserSearchBase(engine));
  url.searchParams.set("q", trimmed);
  return { raw: trimmed, url: url.toString(), engine };
}

function defaultOperatorScreenshotFileName() {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `smithers-app-screenshot-${timestamp}-${suffix}.png`;
}

function operatorScreenshotFileName(value: unknown) {
  const raw = normalizedText(value);
  const candidate = raw ? basename(raw.replace(/\\/g, "/")) : defaultOperatorScreenshotFileName();
  const cleaned = candidate.replace(/[^A-Za-z0-9_.-]/g, "-");
  const withExtension = cleaned.toLowerCase().endsWith(".png") ? cleaned : `${cleaned}.png`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/i.test(withExtension)) {
    return defaultOperatorScreenshotFileName();
  }
  return withExtension;
}

function optionalPositiveInteger(value: unknown) {
  const parsed = numberValue(value);
  return parsed && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeOperatorScreenshotPng(body: Record<string, unknown>) {
  const raw = assertBodyString(body, "pngBase64").replace(/^data:image\/png;base64,/, "");
  const compact = raw.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new WorkspaceHttpError(400, "pngBase64 must be base64-encoded PNG data.");
  }
  const data = Buffer.from(compact, "base64");
  if (data.length === 0) {
    throw new WorkspaceHttpError(400, "pngBase64 is empty.");
  }
  if (data.length > MAX_OPERATOR_SCREENSHOT_BYTES) {
    throw new WorkspaceHttpError(413, "Screenshot PNG is too large.");
  }
  if (!PNG_SIGNATURE.every((byte, index) => data[index] === byte)) {
    throw new WorkspaceHttpError(400, "Screenshot must be a PNG image.");
  }
  return data;
}

function saveOperatorScreenshot(workspace: WorkspaceRoot, body: Record<string, unknown>) {
  const data = decodeOperatorScreenshotPng(body);
  const fileName = operatorScreenshotFileName(body.fileName);
  const screenshotsDir = resolve(workspace.smithersPath, "studio-screenshots");
  const filePath = resolve(screenshotsDir, fileName);
  if (filePath !== screenshotsDir && !filePath.startsWith(`${screenshotsDir}${sep}`)) {
    throw new WorkspaceHttpError(400, "Screenshot path must stay inside the workspace.");
  }
  mkdirSync(screenshotsDir, { recursive: true });
  writeFileSync(filePath, data, { mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort: some filesystems do not support POSIX chmod.
  }
  return {
    path: filePath,
    relativePath: workspaceRelativePath(workspace, filePath),
    fileName,
    bytes: data.length,
    width: optionalPositiveInteger(body.width),
    height: optionalPositiveInteger(body.height),
    capturedAt: new Date().toISOString(),
  };
}

function debugRow(label: string, value: unknown, tone: WorkspaceDebugRow["tone"] = "normal"): WorkspaceDebugRow {
  return { label, value: String(value ?? ""), tone };
}

function countFiles(path: string, extensions: Set<string>) {
  return walkFiles(path, extensions, 10_000).filter((filePath) => basename(filePath) !== ".gitkeep").length;
}

function developerDebugDbRows(workspace: WorkspaceRoot) {
  try {
    const payload = querySmithersDb<{ tables: Array<unknown>; dbPath: string }>(workspace, "sqlTables", {});
    return [
      debugRow("Database", payload.dbPath, "good"),
      debugRow("Tables", payload.tables.length, payload.tables.length > 0 ? "good" : "warning"),
    ];
  } catch (error) {
    return [
      debugRow("Database", error instanceof Error ? error.message : String(error), "warning"),
      debugRow("Tables", 0, "warning"),
    ];
  }
}

function developerDebugPayload(workspace: WorkspaceRoot): WorkspaceDebugPayload {
  const capturedAt = new Date().toISOString();
  const settings = workspaceSettingsPayload(workspace);
  const logs = workspaceLogsPayload(workspace, { limit: "300" });
  const memory = process.memoryUsage();
  const versions = process.versions as Record<string, string | undefined>;
  const agents = listAgents(workspace);
  const workflowCount = countFiles(workspace.workflowsPath, WORKFLOW_SOURCE_EXTENSIONS);
  const promptCount = countFiles(join(workspace.smithersPath, "prompts"), PROMPT_EXTENSIONS);
  const ticketCount = countFiles(join(workspace.smithersPath, "tickets"), new Set([".md"]));
  const runtimeRows = [
    debugRow("Captured", capturedAt),
    debugRow("Platform", `${process.platform} ${process.arch}`),
    debugRow("Process", `pid ${process.pid}`),
    debugRow("Node.js", process.version),
    debugRow("Bun", versions.bun ?? "not active"),
    debugRow("Uptime", `${Math.round(process.uptime())}s`),
    debugRow("Developer debug", "enabled", "good"),
  ];
  const workspaceRows = [
    debugRow(".smithers", "detected", "good"),
    debugRow("Working directory", workspace.root),
    debugRow("Workflows path", existsSync(workspace.workflowsPath) ? workspace.workflowsPath : "missing", existsSync(workspace.workflowsPath) ? "good" : "warning"),
    debugRow("Settings file", settings.detections.settingsPath),
    debugRow("Shell", settings.detections.resolvedShellPath ?? "missing", settings.detections.resolvedShellPath ? "good" : "warning"),
    debugRow("Workflows", workflowCount, workflowCount > 0 ? "good" : "warning"),
    debugRow("Prompts", promptCount),
    debugRow("Tickets", ticketCount),
    debugRow("Agents", `${agents.filter((agent) => agent.usable).length}/${agents.length} usable`, agents.some((agent) => agent.usable) ? "good" : "warning"),
    ...developerDebugDbRows(workspace),
  ];
  const logRows = [
    debugRow("Entries", logs.stats.entryCount),
    debugRow("Size", logs.stats.sizeBytes),
    debugRow("Errors", logs.stats.errorCount, logs.stats.errorCount > 0 ? "danger" : "normal"),
    debugRow("Warnings", logs.stats.warningCount, logs.stats.warningCount > 0 ? "warning" : "normal"),
    debugRow("Sources", logs.stats.sources.length, logs.stats.sources.length > 0 ? "good" : "warning"),
  ];
  const metricRows = [
    debugRow("RSS", memory.rss),
    debugRow("Heap used", memory.heapUsed),
    debugRow("Heap total", memory.heapTotal),
    debugRow("External", memory.external),
    debugRow("Array buffers", memory.arrayBuffers),
  ];
  const events = logs.entries.slice(-100).reverse().map((entry) => ({
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    name: `${entry.category}.${entry.level}`,
    source: entry.sourcePath,
    detail: entry.message,
  }));
  return {
    capturedAt,
    runtimeRows,
    workspaceRows,
    logRows,
    metricRows,
    events,
    logs: logs.entries,
  };
}

function appLogPath() {
  return process.env.HOME ? join(process.env.HOME, "Library", "Logs", "SmithersGUI", "app.log") : "";
}

function workspaceLogSourcePaths(workspace: WorkspaceRoot) {
  const candidates = [
    join(workspace.smithersPath, "studio-app.log"),
    join(workspace.smithersPath, "app.log"),
    appLogPath(),
    ...walkFiles(join(workspace.smithersPath, "logs"), LOG_EXTENSIONS, 500),
    ...walkFiles(workspace.workflowsPath, LOG_EXTENSIONS, 1_000),
  ];
  return uniqueStrings(candidates.map((candidate) => resolve(candidate))).filter((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function clearableLogPaths(workspace: WorkspaceRoot) {
  return uniqueStrings([
    join(workspace.smithersPath, "studio-app.log"),
    join(workspace.smithersPath, "app.log"),
    appLogPath(),
  ].map((candidate) => resolve(candidate))).filter((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function workspaceLogDisplayPath(workspace: WorkspaceRoot, path: string) {
  const resolved = resolve(path);
  if (resolved === workspace.root || resolved.startsWith(`${workspace.root}${sep}`)) {
    return toPosixPath(relative(workspace.root, resolved));
  }
  return resolved;
}

function readLogText(path: string, sizeBytes: number) {
  if (sizeBytes <= MAX_LOG_READ_BYTES) {
    return readFileSync(path, "utf8");
  }
  const file = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_LOG_READ_BYTES);
    const bytesRead = readSync(file, buffer, 0, MAX_LOG_READ_BYTES, sizeBytes - MAX_LOG_READ_BYTES);
    return buffer.subarray(0, bytesRead).toString("utf8").replace(/^[^\n]*\n?/, "");
  } finally {
    closeSync(file);
  }
}

function logTimestamp(value: unknown, baseTimestamp: string) {
  const text = normalizedText(value);
  if (!text) {
    return baseTimestamp;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function logLevel(value: unknown, line: string) {
  const candidate = normalizedText(value)?.toLowerCase();
  if (candidate && LOG_LEVELS.has(candidate)) {
    return candidate;
  }
  const text = `${candidate ?? ""} ${line}`.toLowerCase();
  if (/\b(error|fatal|failed|failure)\b/.test(text)) {
    return "error";
  }
  if (/\b(warn|warning)\b/.test(text)) {
    return "warning";
  }
  if (/\b(debug|trace)\b/.test(text)) {
    return "debug";
  }
  return "info";
}

function logCategory(value: unknown, sourcePath: string, line: string) {
  const candidate = normalizedText(value)?.toLowerCase();
  if (candidate && LOG_CATEGORIES.has(candidate)) {
    return candidate;
  }
  const text = `${sourcePath} ${line}`.toLowerCase();
  for (const category of LOG_CATEGORIES) {
    if (text.includes(category)) {
      return category;
    }
  }
  return sourcePath.includes(".smithers/workflows/") ? "agent" : "lifecycle";
}

function logMetadata(value: unknown) {
  const object = objectEntries(value);
  const entries = Object.entries(object)
    .map(([key, entryValue]) => [key, normalizedText(entryValue)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
  return entries.length ? Object.fromEntries(entries) : null;
}

function logEntryFromLine(sourcePath: string, line: string, lineNumber: number, baseTimestamp: string): WorkspaceLogEntry {
  try {
    const parsed = JSON.parse(line) as unknown;
    const object = objectEntries(parsed);
    if (Object.keys(object).length) {
      const message = normalizedText(object.message) ?? normalizedText(object.renderedMessage) ?? line;
      return {
        id: normalizedText(object.id) ?? `${sourcePath}:${lineNumber}`,
        timestamp: logTimestamp(object.timestamp ?? object.time ?? object.createdAt, baseTimestamp),
        level: logLevel(object.level, line),
        category: logCategory(object.category, sourcePath, line),
        message,
        metadata: logMetadata(object.metadata ?? object.meta),
        sourcePath,
        raw: line,
      };
    }
  } catch {
    // Non-JSON log lines are still useful operational records.
  }
  return {
    id: `${sourcePath}:${lineNumber}`,
    timestamp: baseTimestamp,
    level: logLevel(null, line),
    category: logCategory(null, sourcePath, line),
    message: line,
    metadata: null,
    sourcePath,
    raw: line,
  };
}

function readWorkspaceLogSource(workspace: WorkspaceRoot, path: string) {
  const stat = statSync(path);
  const sourcePath = workspaceLogDisplayPath(workspace, path);
  const baseTimestamp = stat.mtime.toISOString();
  const lines = readLogText(path, stat.size)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    source: {
      path: sourcePath,
      sizeBytes: stat.size,
      entryCount: lines.length,
    },
    entries: lines.map((line, index) => logEntryFromLine(sourcePath, line, index + 1, baseTimestamp)),
  };
}

function logSortTime(entry: WorkspaceLogEntry) {
  if (!entry.timestamp) {
    return 0;
  }
  const ms = new Date(entry.timestamp).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function logMatches(entry: WorkspaceLogEntry, level: string | null, category: string | null, search: string) {
  if (level && entry.level !== level) {
    return false;
  }
  if (category && entry.category !== category) {
    return false;
  }
  if (!search) {
    return true;
  }
  const metadata = entry.metadata ? JSON.stringify(entry.metadata) : "";
  return `${entry.timestamp ?? ""} ${entry.level} ${entry.category} ${entry.message} ${metadata} ${entry.sourcePath}`
    .toLowerCase()
    .includes(search);
}

function workspaceLogsPayload(workspace: WorkspaceRoot, query: WorkspaceBackendRequest["query"]): WorkspaceLogPayload {
  const sources: WorkspaceLogSource[] = [];
  const entries: WorkspaceLogEntry[] = [];
  for (const path of workspaceLogSourcePaths(workspace)) {
    try {
      const result = readWorkspaceLogSource(workspace, path);
      sources.push(result.source);
      entries.push(...result.entries);
    } catch {
      // The file may have rotated between discovery and reading.
    }
  }

  const categoryCounts = new Map<string, number>();
  for (const entry of entries) {
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);
  }

  const level = queryParam(query, "level");
  const category = queryParam(query, "category");
  const search = (queryParam(query, "query") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(1_000, Number(queryParam(query, "limit") ?? 1_000) || 1_000));
  const filtered = entries
    .sort((left, right) => logSortTime(left) - logSortTime(right) || left.id.localeCompare(right.id))
    .filter((entry) => logMatches(entry, level, category, search))
    .slice(-limit);

  return {
    entries: filtered,
    stats: {
      entryCount: entries.length,
      sizeBytes: sources.reduce((total, source) => total + source.sizeBytes, 0),
      errorCount: entries.filter((entry) => entry.level === "error").length,
      warningCount: entries.filter((entry) => entry.level === "warning").length,
      categories: [...categoryCounts.entries()]
        .map(([categoryName, count]) => ({ category: categoryName, count }))
        .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category)),
      sources,
    },
  };
}

function exportWorkspaceLogsPayload(workspace: WorkspaceRoot, query: WorkspaceBackendRequest["query"]) {
  const payload = workspaceLogsPayload(workspace, query);
  const content = payload.entries.map((entry) => JSON.stringify(entry)).join("\n");
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    fileName: `smithers-studio-logs-${suffix}.jsonl`,
    content: content ? `${content}\n` : "",
    count: payload.entries.length,
  };
}

function clearWorkspaceLogs(workspace: WorkspaceRoot) {
  const cleared: string[] = [];
  for (const path of clearableLogPaths(workspace)) {
    writeFileSync(path, "");
    cleared.push(workspaceLogDisplayPath(workspace, path));
  }
  return cleared;
}

function revealWorkspaceLogs(workspace: WorkspaceRoot) {
  const paths = workspaceLogSourcePaths(workspace);
  const firstPath = paths[0];
  if (firstPath && process.platform === "darwin") {
    execFileSync("open", ["-R", firstPath], { timeout: 5_000 });
  }
  return paths.map((path) => workspaceLogDisplayPath(workspace, path));
}

function listAgents(workspace: WorkspaceRoot) {
  return (detectAvailableAgents(process.env, { cwd: workspace.root }) as AgentAvailability[]).map((agent) => {
    const binaryPath = resolveExecutable(agent.binary, process.env);
    const modelOptions = AGENT_MODELS[agent.id] ?? [];
    return {
      id: agent.id,
      name: agent.displayName,
      command: agent.binary,
      binaryPath,
      status: agent.status,
      hasAuth: agent.hasAuthSignal,
      hasAPIKey: agent.hasApiKeySignal,
      usable: agent.usable,
      roles: AGENT_ROLES[agent.id] ?? [],
      version: agent.usable && binaryPath ? readCliVersion(binaryPath, workspace.root) : null,
      defaultModel: modelOptions[0]?.id ?? null,
      modelOptions,
      authExpired: null,
      checks: agent.checks,
      unusableReasons: agent.unusableReasons,
    };
  });
}

function readCliVersion(command: string, cwd: string) {
  try {
    const output = execFileSync(command, ["--version"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
      maxBuffer: 256 * 1024,
      timeout: 2_500,
    });
    const firstLine = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return firstLine || null;
  } catch {
    return null;
  }
}

function smithersCliCommand() {
  return process.env.SMITHERS_STUDIO_SMITHERS_BIN ?? "smithers";
}

function parseVersionParts(value: string | null) {
  if (!value) {
    return null;
  }
  const match = value.trim().match(/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return [match[1], match[2] ?? "0", match[3] ?? "0"].map((part) => Number(part));
}

function versionAtLeast(version: string | null, minimum: string) {
  const current = parseVersionParts(version);
  const required = parseVersionParts(minimum);
  if (!current || !required) {
    return null;
  }
  for (let index = 0; index < required.length; index += 1) {
    if (current[index] !== required[index]) {
      return current[index] > required[index];
    }
  }
  return true;
}

function workspaceVersions(workspace: WorkspaceRoot) {
  const smithersVersion = readCliVersion(smithersCliCommand(), workspace.root);
  return {
    appVersion: STUDIO_APP_VERSION,
    smithersVersion,
    smithersMinimumVersion: MIN_SMITHERS_VERSION,
    smithersMeetsMinimum: versionAtLeast(smithersVersion, MIN_SMITHERS_VERSION),
  };
}

function querySmithersDb<T>(workspace: WorkspaceRoot, operation: string, payload: Record<string, unknown>) {
  const dbPath = findSmithersDb(workspace);
  let output: string;
  try {
    output = execFileSync("bun", [
      SMITHERS_DB_QUERY_SCRIPT,
      dbPath,
      operation,
      JSON.stringify(payload),
    ], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error: unknown) {
    // The query script reports an operation failure (e.g. a rejected non-SELECT
    // statement or an invalid SQL query) as a `{ error }` envelope on stdout
    // with exit code 1. Surface that as a clean 400 instead of a 500 stack.
    const stdout = processOutput((error as { stdout?: unknown }).stdout);
    const parsed = stdout ? safeJsonObject(stdout) : null;
    if (parsed && typeof parsed.error === "string") {
      throw new WorkspaceHttpError(400, parsed.error);
    }
    const stderr = processOutput((error as { stderr?: unknown }).stderr);
    throw new WorkspaceHttpError(
      500,
      stderr || stdout || (error instanceof Error ? error.message : String(error)),
    );
  }
  return JSON.parse(output) as T;
}

function safeJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function processOutput(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return value.toString().trim();
  }
  return "";
}

function runJj(workspace: WorkspaceRoot, args: string[], notFoundMessage = "This workspace is not a jj repository.") {
  try {
    return execFileSync("jj", ["--no-pager", "--color=never", ...args], {
      cwd: workspace.root,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const output = [
      processOutput((error as { stderr?: unknown }).stderr),
      processOutput((error as { stdout?: unknown }).stdout),
      error instanceof Error ? error.message : String(error),
    ].filter(Boolean).join("\n");
    const status = (error as { status?: unknown }).status === 1 ? 404 : 500;
    const message = output || notFoundMessage;
    throw new WorkspaceHttpError(status, message);
  }
}

function runJjhubInCwd(cwd: string, args: string[]) {
  try {
    return execFileSync("jjhub", [...args, "--json"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const output = [
      processOutput((error as { stderr?: unknown }).stderr),
      processOutput((error as { stdout?: unknown }).stdout),
      error instanceof Error ? error.message : String(error),
    ].filter(Boolean).join("\n");
    throw jjhubErrorFromOutput(output);
  }
}

function runJjhub(workspace: WorkspaceRoot, args: string[]) {
  return runJjhubInCwd(workspace.root, args);
}

function runJjhubText(workspace: WorkspaceRoot, args: string[]) {
  try {
    return execFileSync("jjhub", args, {
      cwd: workspace.root,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const output = [
      processOutput((error as { stderr?: unknown }).stderr),
      processOutput((error as { stdout?: unknown }).stdout),
      error instanceof Error ? error.message : String(error),
    ].filter(Boolean).join("\n");
    throw jjhubErrorFromOutput(output);
  }
}

function parseJjhubJsonOutput(output: string) {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new WorkspaceHttpError(502, `jjhub returned non-JSON output: ${trimmed.slice(0, 500)}`);
  }
}

function parseJjhubJson(workspace: WorkspaceRoot, args: string[]) {
  return parseJjhubJsonOutput(runJjhub(workspace, args));
}

function objectEntries(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function payloadArray(value: unknown, keys: string[]) {
  if (Array.isArray(value)) {
    return value;
  }
  const object = objectEntries(value);
  for (const key of keys) {
    const nested = object[key];
    if (Array.isArray(nested)) {
      return nested;
    }
  }
  return [];
}

function payloadObject(value: unknown, keys: string[]) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const key of keys) {
      const nested = object[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
    }
    return object;
  }
  return {};
}

function normalizedText(value: unknown) {
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

function cloudWorkspaceFromValue(value: unknown): CloudWorkspace | null {
  const object = objectEntries(value);
  const id = normalizedText(object.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: normalizedText(object.name) ?? normalizedText(object.displayName) ?? id,
    status: normalizedText(object.status) ?? normalizedText(object.state),
    createdAt: normalizedText(object.createdAt) ?? normalizedText(object.created_at),
  };
}

function cloudSnapshotFromValue(value: unknown): CloudWorkspaceSnapshot | null {
  const object = objectEntries(value);
  const id = normalizedText(object.id);
  const workspaceId = normalizedText(object.workspaceId) ?? normalizedText(object.workspace_id);
  if (!id || !workspaceId) {
    return null;
  }
  return {
    id,
    workspaceId,
    name: normalizedText(object.name),
    createdAt: normalizedText(object.createdAt) ?? normalizedText(object.created_at),
  };
}

function jjhubAuthStatusFromValue(value: unknown): JjhubAuthStatus {
  const rootObject = objectEntries(value);
  const object = payloadObject(value, ["auth", "status", "session"]);
  const userObject = objectEntries(object.user);
  const field = (...keys: string[]) => {
    for (const key of keys) {
      if (object[key] != null) {
        return object[key];
      }
      if (rootObject[key] != null) {
        return rootObject[key];
      }
    }
    return null;
  };
  const loggedIn = optionalBoolean(field("loggedIn", "logged_in", "authenticated", "is_authenticated")) ??
    false;
  const tokenSet = optionalBoolean(field("tokenSet", "token_set", "hasToken", "has_token")) ??
    loggedIn;
  return {
    loggedIn,
    tokenSet,
    tokenSource: normalizedText(field("tokenSource", "token_source")),
    apiUrl: normalizedText(field("apiUrl", "api_url", "baseUrl", "base_url")),
    user: normalizedText(userObject.username) ??
      normalizedText(userObject.login) ??
      normalizedText(userObject.name) ??
      normalizedText(field("user", "username", "login", "name")),
    email: normalizedText(field("email")) ?? normalizedText(userObject.email),
  };
}

function jjhubAuthStatusPayload() {
  const configuredCwd = normalizeAbsolutePath(process.env.SMITHERS_STUDIO_WORKSPACE);
  const cwd = configuredCwd && existsSync(configuredCwd)
    ? configuredCwd
    : process.cwd();
  return jjhubAuthStatusFromValue(parseJjhubJsonOutput(runJjhubInCwd(cwd, ["auth", "status"])));
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nameList(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  const names = value
    .map((entry) => {
      if (typeof entry === "string") {
        return normalizedText(entry);
      }
      const object = objectEntries(entry);
      return normalizedText(object.name) ?? normalizedText(object.login) ?? normalizedText(object.username);
    })
    .filter((entry): entry is string => Boolean(entry));
  return names.length ? names : null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  const strings = value
    .map((entry) => normalizedText(entry))
    .filter((entry): entry is string => Boolean(entry));
  return strings.length ? strings : null;
}

function jjhubIssueFromValue(value: unknown): JjhubIssue | null {
  const object = objectEntries(value);
  const number = numberValue(object.number);
  const id = normalizedText(object.id) ?? (number == null ? null : `issue-${number}`);
  if (!id) {
    return null;
  }
  return {
    id,
    number,
    title: normalizedText(object.title) ?? "",
    body: normalizedText(object.body) ?? normalizedText(object.description),
    state: normalizedText(object.state) ?? normalizedText(object.status),
    labels: nameList(object.labels),
    assignees: nameList(object.assignees),
    commentCount: numberValue(object.commentCount) ??
      numberValue(object.comments) ??
      numberValue(object.comment_count) ??
      numberValue(object.comments_count),
  };
}

function authorName(value: unknown) {
  if (typeof value === "string") {
    return normalizedText(value);
  }
  const object = objectEntries(value);
  return normalizedText(object.login) ?? normalizedText(object.name) ?? normalizedText(object.email);
}

function jjhubLandingFromValue(value: unknown): JjhubLanding | null {
  const object = objectEntries(value);
  const number = numberValue(object.number);
  const id = normalizedText(object.id) ?? (number == null ? null : `landing-${number}`);
  if (!id) {
    return null;
  }
  return {
    id,
    number,
    title: normalizedText(object.title) ?? "",
    description: normalizedText(object.description) ?? normalizedText(object.body),
    state: normalizedText(object.state) ?? normalizedText(object.status),
    targetBranch: normalizedText(object.targetBranch) ??
      normalizedText(object.targetBookmark) ??
      normalizedText(object.target_bookmark),
    author: authorName(object.author),
    createdAt: normalizedText(object.createdAt) ?? normalizedText(object.created_at),
    reviewStatus: normalizedText(object.reviewStatus) ?? normalizedText(object.review_status),
  };
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "active", "enabled", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "0", "inactive", "disabled", "off"].includes(normalized)) {
      return false;
    }
  }
  return false;
}

function optionalBoolean(value: unknown) {
  if (value == null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "active", "enabled", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "0", "inactive", "disabled", "off"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function jjhubWorkflowFromValue(value: unknown): JjhubWorkflow | null {
  const object = objectEntries(value);
  const id = numberValue(object.id);
  if (id == null) {
    return null;
  }
  return {
    id,
    repositoryID: numberValue(object.repositoryID) ?? numberValue(object.repository_id),
    name: normalizedText(object.name) ?? `Workflow ${id}`,
    path: normalizedText(object.path) ?? "",
    isActive: booleanValue(object.isActive ?? object.is_active ?? object.active ?? object.enabled),
    createdAt: normalizedText(object.createdAt) ?? normalizedText(object.created_at),
    updatedAt: normalizedText(object.updatedAt) ?? normalizedText(object.updated_at),
  };
}

function jjhubWorkflowRunFromValue(value: unknown): JjhubWorkflowRun {
  const object = objectEntries(value);
  return {
    id: numberValue(object.id),
    workflowDefinitionID: numberValue(object.workflowDefinitionID) ?? numberValue(object.workflow_definition_id),
    status: normalizedText(object.status),
    triggerEvent: normalizedText(object.triggerEvent) ?? normalizedText(object.trigger_event),
    triggerRef: normalizedText(object.triggerRef) ?? normalizedText(object.trigger_ref),
    triggerCommitSHA: normalizedText(object.triggerCommitSHA) ?? normalizedText(object.trigger_commit_sha),
    startedAt: normalizedText(object.startedAt) ?? normalizedText(object.started_at),
    completedAt: normalizedText(object.completedAt) ?? normalizedText(object.completed_at),
    sessionID: normalizedText(object.sessionID) ?? normalizedText(object.session_id),
    steps: stringList(object.steps),
  };
}

function jjhubRepoPayload(workspace: WorkspaceRoot) {
  const object = payloadObject(parseJjhubJson(workspace, ["repo", "view"]), ["repo"]);
  const id = numberValue(object.id) ?? normalizedText(object.id);
  return {
    id,
    name: normalizedText(object.name),
    fullName: normalizedText(object.fullName) ?? normalizedText(object.full_name),
    owner: normalizedText(object.owner),
    description: normalizedText(object.description),
    defaultBookmark: normalizedText(object.defaultBookmark) ?? normalizedText(object.default_bookmark),
    root: null,
    isPublic: optionalBoolean(object.isPublic ?? object.is_public),
    isArchived: optionalBoolean(object.isArchived ?? object.is_archived),
    numIssues: numberValue(object.numIssues) ?? numberValue(object.num_issues),
    numStars: numberValue(object.numStars) ?? numberValue(object.num_stars),
    createdAt: normalizedText(object.createdAt) ?? normalizedText(object.created_at),
    updatedAt: normalizedText(object.updatedAt) ?? normalizedText(object.updated_at),
  };
}

function cloudWorkspacePayload(workspace: WorkspaceRoot, args: string[]) {
  const payload = payloadObject(parseJjhubJson(workspace, args), ["workspace"]);
  const parsed = cloudWorkspaceFromValue(payload);
  if (!parsed) {
    throw new WorkspaceHttpError(502, "jjhub workspace response did not include a workspace id.");
  }
  return parsed;
}

function cloudSnapshotPayload(workspace: WorkspaceRoot, args: string[]) {
  const payload = payloadObject(parseJjhubJson(workspace, args), ["snapshot"]);
  const parsed = cloudSnapshotFromValue(payload);
  if (!parsed) {
    throw new WorkspaceHttpError(502, "jjhub snapshot response did not include a snapshot id and workspace id.");
  }
  return parsed;
}

function listCloudWorkspaces(workspace: WorkspaceRoot) {
  return payloadArray(parseJjhubJson(workspace, ["workspace", "list"]), ["workspaces", "items", "results"])
    .map(cloudWorkspaceFromValue)
    .filter((entry): entry is CloudWorkspace => Boolean(entry));
}

function listCloudWorkspaceSnapshots(workspace: WorkspaceRoot) {
  return payloadArray(parseJjhubJson(workspace, ["workspace", "snapshot", "list"]), ["snapshots", "items", "results"])
    .map(cloudSnapshotFromValue)
    .filter((entry): entry is CloudWorkspaceSnapshot => Boolean(entry));
}

function jjhubIssuePayload(workspace: WorkspaceRoot, args: string[]) {
  const payload = payloadObject(parseJjhubJson(workspace, args), ["issue"]);
  const parsed = jjhubIssueFromValue(payload);
  if (!parsed) {
    throw new WorkspaceHttpError(502, "jjhub issue response did not include an issue id or number.");
  }
  return parsed;
}

function listJjhubIssues(workspace: WorkspaceRoot, state: string | null) {
  const args = ["issue", "list"];
  if (state) {
    args.push("--state", state);
  }
  return payloadArray(parseJjhubJson(workspace, args), ["issues", "items", "results"])
    .map(jjhubIssueFromValue)
    .filter((entry): entry is JjhubIssue => Boolean(entry));
}

function jjhubLandingPayload(workspace: WorkspaceRoot, args: string[]) {
  const payload = payloadObject(parseJjhubJson(workspace, args), ["landing"]);
  const parsed = jjhubLandingFromValue(payload);
  if (!parsed) {
    throw new WorkspaceHttpError(502, "jjhub landing response did not include a landing id or number.");
  }
  return parsed;
}

function listJjhubLandings(workspace: WorkspaceRoot, state: string | null, limit: number) {
  const args = ["land", "list", "--limit", String(limit)];
  if (state) {
    args.push("--state", state);
  }
  return payloadArray(parseJjhubJson(workspace, args), ["landings", "items", "results"])
    .map(jjhubLandingFromValue)
    .filter((entry): entry is JjhubLanding => Boolean(entry));
}

function jjhubLandingConflictFromValue(value: unknown, fallbackChangeID: string | null): JjhubLandingConflict | null {
  if (typeof value === "string") {
    const filePath = value.trim();
    return filePath
      ? {
          changeID: fallbackChangeID,
          filePath,
          conflictType: null,
          resolved: null,
          resolutionStatus: null,
        }
      : null;
  }
  const object = objectEntries(value);
  const filePath = normalizedText(object.filePath) ??
    normalizedText(object.file_path) ??
    normalizedText(object.path) ??
    normalizedText(object.file);
  if (!filePath) {
    return null;
  }
  return {
    changeID: normalizedText(object.changeID) ??
      normalizedText(object.changeId) ??
      normalizedText(object.change_id) ??
      fallbackChangeID,
    filePath,
    conflictType: normalizedText(object.conflictType) ??
      normalizedText(object.conflict_type) ??
      normalizedText(object.type),
    resolved: optionalBoolean(object.resolved),
    resolutionStatus: normalizedText(object.resolutionStatus) ??
      normalizedText(object.resolution_status) ??
      normalizedText(object.status),
  };
}

function jjhubLandingConflictsFromValue(value: unknown): JjhubLandingConflicts {
  const payload = payloadObject(value, ["conflicts"]);
  const conflictRows: JjhubLandingConflict[] = [];
  const arrayRows = payloadArray(payload, ["conflicts", "items", "results"]);
  for (const entry of arrayRows) {
    const parsed = jjhubLandingConflictFromValue(entry, null);
    if (parsed) {
      conflictRows.push(parsed);
    }
  }

  const byChange = objectEntries(
    objectEntries(payload).conflictsByChange ??
    objectEntries(payload).conflicts_by_change,
  );
  for (const [changeID, entries] of Object.entries(byChange)) {
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const parsed = jjhubLandingConflictFromValue(entry, changeID);
        if (parsed) {
          conflictRows.push(parsed);
        }
      }
    }
  }

  return {
    conflictStatus: normalizedText(payload.conflictStatus) ??
      normalizedText(payload.conflict_status) ??
      normalizedText(payload.status),
    hasConflicts: optionalBoolean(payload.hasConflicts ?? payload.has_conflicts) ?? (conflictRows.length > 0),
    conflicts: conflictRows,
  };
}

function jjhubLandingConflictsPayload(workspace: WorkspaceRoot, number: string) {
  return jjhubLandingConflictsFromValue(parseJjhubJson(workspace, ["land", "conflicts", number]));
}

function landingDiffText(workspace: WorkspaceRoot, number: string) {
  try {
    return runJjhubText(workspace, ["land", "diff", number]);
  } catch (error) {
    return `Landing diff unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function listJjhubWorkflows(workspace: WorkspaceRoot, limit: number) {
  return payloadArray(parseJjhubJson(workspace, ["workflow", "list", "--limit", String(limit)]), ["workflows", "items", "results"])
    .map(jjhubWorkflowFromValue)
    .filter((entry): entry is JjhubWorkflow => Boolean(entry));
}

function jjhubWorkflowRunPayload(workspace: WorkspaceRoot, workflowID: string, ref: string) {
  const payload = payloadObject(parseJjhubJson(workspace, ["workflow", "run", workflowID, "--ref", ref]), ["run"]);
  return jjhubWorkflowRunFromValue(payload);
}

function assertPositiveInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new WorkspaceHttpError(400, `${label} must be a positive integer.`);
  }
  return String(parsed);
}

function assertBodyString(body: Record<string, unknown>, key: string) {
  const value = normalizedText(body[key]);
  if (!value) {
    throw new WorkspaceHttpError(400, `${key} is required.`);
  }
  return value;
}

function jjRoot(workspace: WorkspaceRoot) {
  return runJj(workspace, ["root"]).trim();
}

function currentJjRepo(workspace: WorkspaceRoot) {
  const root = jjRoot(workspace);
  const name = basename(root);
  return {
    id: root,
    name,
    fullName: name,
    owner: null,
    description: null,
    defaultBookmark: null,
    root,
    isPublic: null,
    isArchived: null,
    numIssues: null,
    numStars: null,
    createdAt: null,
    updatedAt: null,
  };
}

const JJ_CHANGE_TEMPLATE = [
  "json(change_id)",
  "json(commit_id)",
  "json(description.first_line())",
  "json(author.name())",
  "json(author.email())",
  "json(author.timestamp())",
  "json(bookmarks)",
  "json(empty)",
  "json(current_working_copy)",
].join(" ++ \"\\t\" ++ ") + " ++ \"\\n\"";

function parseJjTemplateField<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseJjBookmarks(raw: string) {
  const parsed = parseJjTemplateField<unknown>(raw, []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((bookmark) => {
      if (typeof bookmark === "string") {
        return bookmark;
      }
      if (bookmark && typeof bookmark === "object" && "name" in bookmark && typeof bookmark.name === "string") {
        return bookmark.name;
      }
      return "";
    })
    .map((bookmark) => bookmark.trim())
    .filter(Boolean);
}

function parseJjChange(line: string): WorkspaceChange | null {
  const fields = line.split("\t");
  if (fields.length < 9) {
    return null;
  }
  const changeID = parseJjTemplateField<string>(fields[0] ?? "\"\"", "").trim();
  const commitID = parseJjTemplateField<string>(fields[1] ?? "\"\"", "").trim();
  if (!changeID || commitID === "0000000000000000000000000000000000000000") {
    return null;
  }

  const authorName = parseJjTemplateField<string>(fields[3] ?? "\"\"", "").trim();
  const authorEmail = parseJjTemplateField<string>(fields[4] ?? "\"\"", "").trim();
  const author = authorName || authorEmail
    ? { name: authorName || null, email: authorEmail || null }
    : null;

  return {
    changeID,
    commitID: commitID || null,
    description: parseJjTemplateField<string>(fields[2] ?? "\"\"", "") || null,
    author,
    timestamp: parseJjTemplateField<string>(fields[5] ?? "\"\"", "") || null,
    bookmarks: parseJjBookmarks(fields[6] ?? "[]"),
    isEmpty: parseJjTemplateField<boolean | null>(fields[7] ?? "null", null),
    isWorkingCopy: parseJjTemplateField<boolean | null>(fields[8] ?? "null", null),
  };
}

function listJjChanges(workspace: WorkspaceRoot, limit: number) {
  const output = runJj(workspace, [
    "log",
    "--no-graph",
    "-r",
    "all()",
    "-T",
    JJ_CHANGE_TEMPLATE,
  ]);
  return output.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJjChange)
    .filter((change): change is WorkspaceChange => change !== null)
    .slice(0, limit);
}

function findJjChange(workspace: WorkspaceRoot, changeID: string) {
  const normalized = changeID.trim();
  const change = listJjChanges(workspace, 500).find((candidate) =>
    candidate.changeID === normalized ||
    candidate.changeID.startsWith(normalized) ||
    normalized.startsWith(candidate.changeID),
  );
  if (!change) {
    throw new WorkspaceHttpError(404, `Change ${changeID} not found.`);
  }
  return change;
}

function jjChangeDiff(workspace: WorkspaceRoot, changeID: string | null) {
  const args = changeID?.trim()
    ? ["diff", "-r", changeID.trim(), "--git"]
    : ["diff", "--git"];
  return runJj(workspace, args);
}

function createJjBookmark(workspace: WorkspaceRoot, name: string, changeID: string) {
  const bookmark = name.trim();
  const target = changeID.trim();
  if (!bookmark) {
    throw new WorkspaceHttpError(400, "Bookmark name is required.");
  }
  if (!target) {
    throw new WorkspaceHttpError(400, "Change id is required.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(bookmark) || bookmark.includes("..")) {
    throw new WorkspaceHttpError(400, "Bookmark names may contain letters, numbers, dots, dashes, underscores, and slashes.");
  }
  runJj(workspace, ["bookmark", "create", "--revision", target, bookmark]);
  return {
    name: bookmark,
    targetChangeID: findJjChange(workspace, target).changeID,
    targetCommitID: findJjChange(workspace, target).commitID,
    isTrackingRemote: false,
  };
}

function deleteJjBookmark(workspace: WorkspaceRoot, name: string) {
  const bookmark = name.trim();
  if (!bookmark) {
    throw new WorkspaceHttpError(400, "Bookmark name is required.");
  }
  runJj(workspace, ["bookmark", "delete", bookmark]);
}

function toPosixPath(path: string) {
  return path.split(sep).join("/");
}

function isSafeRelativePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return Boolean(normalized) &&
    !normalized.includes("\0") &&
    !normalized.startsWith("/") &&
    !normalized.split("/").includes("..");
}

function assertSafeTicketId(ticketId: unknown) {
  if (typeof ticketId !== "string") {
    throw new WorkspaceHttpError(400, "ticketId must be a string.");
  }
  const normalized = ticketId.trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized.includes("\0")) {
    throw new WorkspaceHttpError(400, "ticketId must be a filename, not a path.");
  }
  const withExtension = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/.test(withExtension)) {
    throw new WorkspaceHttpError(400, "ticketId may contain letters, numbers, dots, dashes, and underscores.");
  }
  return withExtension;
}

function walkFiles(root: string, extensions?: Set<string>, maxFiles = 5_000) {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const visit = (dir: string) => {
    if (files.length >= maxFiles) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= maxFiles) {
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".smithers") {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) {
          visit(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!extensions || extensions.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  };
  visit(root);
  return files;
}

function promptIdFromRelative(relativePath: string) {
  const extension = extname(relativePath);
  return extension ? relativePath.slice(0, -extension.length) : relativePath;
}

function promptFromPath(workspace: WorkspaceRoot, promptPath: string) {
  const promptsPath = join(workspace.smithersPath, "prompts");
  const relativePrompt = toPosixPath(relative(promptsPath, promptPath));
  const source = readFileSync(promptPath, "utf8");
  return {
    id: promptIdFromRelative(relativePrompt),
    entryFile: `prompts/${relativePrompt}`,
    source,
    inputs: discoverPromptInputs(source),
  };
}

function listPrompts(workspace: WorkspaceRoot) {
  const promptsPath = join(workspace.smithersPath, "prompts");
  return walkFiles(promptsPath, PROMPT_EXTENSIONS)
    .map((promptPath) => promptFromPath(workspace, promptPath))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function workflowKeyFromPath(workspace: WorkspaceRoot, workflowPath: string) {
  const workflowsPath = workspace.workflowsPath;
  const relativeWorkflow = toPosixPath(relative(workflowsPath, workflowPath));
  const extension = extname(relativeWorkflow);

  // Try to extract key from filename first
  const baseKey = extension ? relativeWorkflow.slice(0, -extension.length) : relativeWorkflow;

  // Read source to check for explicit name
  try {
    const source = readFileSync(workflowPath, "utf8");
    const namePatterns = [
      /\bname\s*=\s*["']([^"']+)["']/,
      /\bname\s*:\s*["']([^"']+)["']/,
      /\bregister\(\s*["']([^"']+)["']/,
    ];

    for (const pattern of namePatterns) {
      const match = pattern.exec(source);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // Fall back to filename-based key if reading fails
  }

  return baseKey;
}

function workflowFromPath(workspace: WorkspaceRoot, workflowPath: string) {
  const workflowKey = workflowKeyFromPath(workspace, workflowPath);
  const relativePath = workspaceRelativePath(workspace, workflowPath);

  return {
    workflowKey,
    path: relativePath,
    name: workflowKey,
  };
}

function listWorkflows(workspace: WorkspaceRoot) {
  if (!workspace.workflowsPathExists) {
    return [];
  }

  return walkFiles(workspace.workflowsPath, WORKFLOW_SOURCE_EXTENSIONS)
    .map((workflowPath) => workflowFromPath(workspace, workflowPath))
    .sort((left, right) => left.workflowKey.localeCompare(right.workflowKey));
}

function findPromptPath(workspace: WorkspaceRoot, promptId: string) {
  if (!isSafeRelativePath(promptId)) {
    throw new WorkspaceHttpError(400, "promptId must be a safe relative path.");
  }
  const promptsPath = join(workspace.smithersPath, "prompts");
  const prompt = walkFiles(promptsPath, PROMPT_EXTENSIONS).find((filePath) => {
    const relativePrompt = toPosixPath(relative(promptsPath, filePath));
    return promptIdFromRelative(relativePrompt) === promptId || relativePrompt === promptId;
  });
  if (!prompt) {
    throw new WorkspaceHttpError(404, `Prompt ${promptId} not found.`);
  }
  return prompt;
}

type WorkspaceWorkflowImport = {
  id: string;
  name: string;
  path: string;
  kind: "component" | "prompt";
  source: string;
};

type WorkspaceWorkflowGraphTask = {
  nodeId: string;
  ordinal: number | null;
  outputTableName: string | null;
  needsApproval: boolean | null;
  waitAsync: boolean | null;
};

type WorkspaceWorkflowGraphEdge = {
  from: string;
  to: string;
};

type WorkspaceWorkflowLaunchField = {
  name: string;
  key: string;
  type: string | null;
  defaultValue: string | null;
  required: boolean;
};

type WorkspaceWorkflowFrontendManifest = {
  version: number;
  id: string;
  name: string;
  framework: string | null;
  entry: string;
  apiBasePath: string | null;
  defaultPath: string | null;
};

type WorkspaceWorkflowFrontendDescriptor = {
  manifest: WorkspaceWorkflowFrontendManifest;
  manifestPath: string;
  frontendDirectoryPath: string;
  serverScriptPath: string | null;
  entryPath: string | null;
  routePath: string;
};

type WorkflowFrontendServer = {
  process: ReturnType<typeof spawn>;
  url: string | null;
  errors: string[];
  ready: Promise<string>;
};

type WorkspaceWorkflowDoctorIssue = {
  severity: "ok" | "warning" | "error";
  check: string;
  message: string;
};

const workflowFrontendServers = new Map<string, WorkflowFrontendServer>();

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function workspaceRelativePath(workspace: WorkspaceRoot, filePath: string) {
  return toPosixPath(relative(workspace.root, filePath));
}

function assertWorkspaceSourcePath(workspace: WorkspaceRoot, relativePath: string) {
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!isSafeRelativePath(normalized) || !normalized.startsWith(".smithers/")) {
    throw new WorkspaceHttpError(400, "path must be a safe .smithers relative path.");
  }
  const absolutePath = resolve(workspace.root, normalized);
  const workspaceRoot = resolve(workspace.root);
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${sep}`)) {
    throw new WorkspaceHttpError(400, "path must stay inside the workspace.");
  }
  if (!WORKFLOW_IMPORT_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
    throw new WorkspaceHttpError(400, "path must be a supported workflow source or import file.");
  }
  return absolutePath;
}

function normalizeWorkspaceRelativePath(workspace: WorkspaceRoot, candidatePath: string) {
  const absolutePath = resolve(workspace.root, candidatePath);
  const workspaceRoot = resolve(workspace.root);
  if (absolutePath === workspaceRoot || !absolutePath.startsWith(`${workspaceRoot}${sep}`)) {
    return null;
  }
  const relativePath = workspaceRelativePath(workspace, absolutePath);
  return relativePath.startsWith(".smithers/") && isSafeRelativePath(relativePath) ? relativePath : null;
}

function resolveExistingWorkflowImport(workspace: WorkspaceRoot, relativePath: string) {
  const normalized = normalizeWorkspaceRelativePath(workspace, relativePath);
  if (!normalized) {
    return null;
  }
  const directPath = resolve(workspace.root, normalized);
  const directExtension = extname(directPath).toLowerCase();
  if (directExtension && WORKFLOW_IMPORT_EXTENSIONS.has(directExtension) && existsSync(directPath) && statSync(directPath).isFile()) {
    return workspaceRelativePath(workspace, directPath);
  }
  if (directExtension) {
    return null;
  }
  for (const extension of WORKFLOW_IMPORT_EXTENSIONS) {
    const candidatePath = `${directPath}${extension}`;
    if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
      return workspaceRelativePath(workspace, candidatePath);
    }
  }
  for (const extension of WORKFLOW_SOURCE_EXTENSIONS) {
    const candidatePath = join(directPath, `index${extension}`);
    if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
      return workspaceRelativePath(workspace, candidatePath);
    }
  }
  return null;
}

function cleanImportPath(importPath: string) {
  return importPath.trim().split(/[?#]/, 1)[0] ?? "";
}

function extractImportPath(line: string) {
  return /\bimport\s*\(\s*["']([^"']+)["']/.exec(line)?.[1] ??
    /\bfrom\s*["']([^"']+)["']/.exec(line)?.[1] ??
    /^\s*import\s*["']([^"']+)["']/.exec(line)?.[1] ??
    null;
}

function workflowImportKind(relativePath: string): WorkspaceWorkflowImport["kind"] | null {
  const lowerPath = relativePath.toLowerCase();
  const extension = extname(lowerPath);
  if (PROMPT_EXTENSIONS.has(extension) || lowerPath.includes("/prompts/") || lowerPath.includes("prompt")) {
    return "prompt";
  }
  if (WORKFLOW_SOURCE_EXTENSIONS.has(extension) || lowerPath.includes("/components/") || lowerPath.includes("component")) {
    return "component";
  }
  return null;
}

function importIdentifierName(line: string, importPath: string, kind: WorkspaceWorkflowImport["kind"]) {
  const named = /\bimport\s+(?:type\s+)?\{([^}]+)\}/.exec(line)?.[1]
    ?.split(",")
    .map((entry) => entry.trim().split(/\s+as\s+/i).pop()?.trim() ?? "")
    .filter(Boolean);
  if (named?.length) {
    return named.join(", ");
  }
  const defaultImport = /^\s*import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|\s+from\b)/.exec(line)?.[1];
  if (defaultImport) {
    return defaultImport;
  }
  const baseName = basename(cleanImportPath(importPath), extname(cleanImportPath(importPath))).trim();
  return baseName || (kind === "prompt" ? "prompt" : "component");
}

function resolveWorkflowImportPath(workspace: WorkspaceRoot, importPath: string, importerPath: string) {
  const cleaned = cleanImportPath(importPath);
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith(".")) {
    return resolveExistingWorkflowImport(workspace, join(dirname(importerPath), cleaned));
  }
  if (cleaned.startsWith(".smithers/")) {
    return resolveExistingWorkflowImport(workspace, cleaned);
  }
  if (cleaned.startsWith("workflows/") || cleaned.startsWith("prompts/")) {
    return resolveExistingWorkflowImport(workspace, `.smithers/${cleaned}`);
  }
  return null;
}

function parseWorkflowImports(workspace: WorkspaceRoot, source: string, workflowPath: string) {
  const imports: WorkspaceWorkflowImport[] = [];
  const seen = new Set<string>();

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }
    const importPath = extractImportPath(trimmed);
    if (!importPath) {
      continue;
    }
    const resolvedPath = resolveWorkflowImportPath(workspace, importPath, workflowPath);
    if (!resolvedPath || seen.has(resolvedPath)) {
      continue;
    }
    const kind = workflowImportKind(resolvedPath);
    if (!kind) {
      continue;
    }
    const absolutePath = assertWorkspaceSourcePath(workspace, resolvedPath);
    const sourceText = readFileSync(absolutePath, "utf8");
    seen.add(resolvedPath);
    imports.push({
      id: `${kind}:${resolvedPath}`,
      name: importIdentifierName(trimmed, importPath, kind),
      path: resolvedPath,
      kind,
      source: sourceText,
    });
  }

  return imports.sort((left, right) => left.path.localeCompare(right.path));
}

function findWorkflowSourcePath(workspace: WorkspaceRoot, workflowKey: string) {
  const normalizedKey = workflowKey.trim();
  if (!normalizedKey) {
    throw new WorkspaceHttpError(400, "workflow key is required.");
  }
  if (!workspace.workflowsPathExists) {
    throw new WorkspaceHttpError(404, ".smithers/workflows does not exist.");
  }

  if (isSafeRelativePath(normalizedKey)) {
    for (const extension of WORKFLOW_SOURCE_EXTENSIONS) {
      const directPath = join(workspace.workflowsPath, `${normalizedKey}${extension}`);
      if (existsSync(directPath) && statSync(directPath).isFile()) {
        return directPath;
      }
    }
  }

  const escapedKey = escapeRegExp(normalizedKey);
  const workflowPatterns = [
    new RegExp(`\\bname\\s*=\\s*["']${escapedKey}["']`),
    new RegExp(`\\bname\\s*:\\s*["']${escapedKey}["']`),
    new RegExp(`\\bregister\\(\\s*["']${escapedKey}["']`),
  ];
  for (const filePath of walkFiles(workspace.workflowsPath, WORKFLOW_SOURCE_EXTENSIONS)) {
    const source = readFileSync(filePath, "utf8");
    if (workflowPatterns.some((pattern) => pattern.test(source))) {
      return filePath;
    }
  }

  throw new WorkspaceHttpError(404, `Workflow source for ${workflowKey} was not found in .smithers/workflows.`);
}

function workflowSourcePayload(workspace: WorkspaceRoot, workflowKey: string) {
  const workflowPath = findWorkflowSourcePath(workspace, workflowKey);
  const relativeWorkflowPath = workspaceRelativePath(workspace, workflowPath);
  const source = readFileSync(workflowPath, "utf8");
  return {
    workflowKey,
    path: relativeWorkflowPath,
    source,
    imports: parseWorkflowImports(workspace, source, relativeWorkflowPath),
  };
}

function nullableManifestString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function manifestString(record: Record<string, unknown>, key: string) {
  const value = nullableManifestString(record, key);
  if (!value) {
    throw new WorkspaceHttpError(400, `frontend manifest ${key} must be a string.`);
  }
  return value;
}

function parseWorkflowFrontendManifest(value: unknown): WorkspaceWorkflowFrontendManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceHttpError(400, "frontend manifest must be an object.");
  }
  const record = value as Record<string, unknown>;
  const version = typeof record.version === "number" && Number.isInteger(record.version)
    ? record.version
    : null;
  if (!version) {
    throw new WorkspaceHttpError(400, "frontend manifest version must be an integer.");
  }
  return {
    version,
    id: manifestString(record, "id"),
    name: manifestString(record, "name"),
    framework: nullableManifestString(record, "framework"),
    entry: manifestString(record, "entry"),
    apiBasePath: nullableManifestString(record, "apiBasePath"),
    defaultPath: nullableManifestString(record, "defaultPath"),
  };
}

function normalizeFrontendRoutePath(path: string | null) {
  const trimmed = path?.trim() ?? "";
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function resolveInsideWorkspace(workspace: WorkspaceRoot, candidatePath: string) {
  const absolutePath = resolve(workspace.root, candidatePath);
  const workspaceRoot = resolve(workspace.root);
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${sep}`)) {
    throw new WorkspaceHttpError(400, "path must stay inside the workspace.");
  }
  return absolutePath;
}

function resolveInsideDirectory(root: string, candidatePath: string) {
  const absolutePath = resolve(root, candidatePath);
  const absoluteRoot = resolve(root);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    throw new WorkspaceHttpError(400, "frontend manifest paths must stay inside the frontend directory.");
  }
  return absolutePath;
}

function workflowFrontendDescriptor(workspace: WorkspaceRoot, workflowKey: string): WorkspaceWorkflowFrontendDescriptor | null {
  const workflowPath = findWorkflowSourcePath(workspace, workflowKey);
  const workflowBase = basename(workflowPath, extname(workflowPath));
  const frontendDirectory = join(dirname(workflowPath), `${workflowBase}.frontend`);
  const manifestPath = join(frontendDirectory, "manifest.json");
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    return null;
  }
  const manifest = parseWorkflowFrontendManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
  const entryPath = resolveInsideDirectory(frontendDirectory, manifest.entry);
  const serverPath = join(frontendDirectory, "server.ts");
  const resolvedServerPath = existsSync(serverPath) && statSync(serverPath).isFile()
    ? serverPath
    : null;
  return {
    manifest,
    manifestPath: workspaceRelativePath(workspace, manifestPath),
    frontendDirectoryPath: workspaceRelativePath(workspace, frontendDirectory),
    serverScriptPath: resolvedServerPath ? workspaceRelativePath(workspace, resolvedServerPath) : null,
    entryPath: existsSync(entryPath) && statSync(entryPath).isFile() ? workspaceRelativePath(workspace, entryPath) : null,
    routePath: normalizeFrontendRoutePath(manifest.defaultPath),
  };
}

function workflowFrontendServerKey(workspace: WorkspaceRoot, descriptor: WorkspaceWorkflowFrontendDescriptor) {
  if (!descriptor.serverScriptPath) {
    return null;
  }
  return resolveInsideWorkspace(workspace, descriptor.serverScriptPath);
}

function frontendProcessStillRunning(state: WorkflowFrontendServer) {
  return !state.process.killed && state.process.exitCode === null;
}

function startFrontendServerProcess(
  workspace: WorkspaceRoot,
  descriptor: WorkspaceWorkflowFrontendDescriptor,
  serverPath: string,
) {
  const existing = workflowFrontendServers.get(serverPath);
  if (existing && frontendProcessStillRunning(existing)) {
    return existing;
  }

  const child = spawn("bun", [serverPath, "--port", "0"], {
    cwd: workspace.root,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state: WorkflowFrontendServer = {
    process: child,
    url: null,
    errors: [],
    ready: Promise.resolve(""),
  };

  state.ready = new Promise<string>((resolveReady, rejectReady) => {
    let outputBuffer = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const readyUrl = (port: number) => `http://127.0.0.1:${port}${descriptor.routePath}`;
    const consumeOutput = (chunk: Buffer) => {
      outputBuffer += chunk.toString("utf8");
      const lines = outputBuffer.split(/\r?\n/);
      outputBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const event = JSON.parse(trimmed) as unknown;
          if (
            event &&
            typeof event === "object" &&
            !Array.isArray(event) &&
            (event as { type?: unknown }).type === "ready" &&
            typeof (event as { port?: unknown }).port === "number"
          ) {
            const url = readyUrl((event as { port: number }).port);
            state.url = url;
            finish(() => resolveReady(url));
            return;
          }
        } catch {
          state.errors.push(trimmed);
        }
      }
    };
    const consumeError = (chunk: Buffer) => {
      state.errors.push(...chunk.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      state.errors = state.errors.slice(-20);
    };
    const timer = setTimeout(() => {
      finish(() => {
        rejectReady(new WorkspaceHttpError(504, state.errors.join("\n") || "frontend server did not become ready."));
      });
    }, 5_000);

    child.stdout.on("data", consumeOutput);
    child.stderr.on("data", consumeError);
    child.on("error", (error) => {
      finish(() => rejectReady(new WorkspaceHttpError(502, error.message)));
    });
    child.on("exit", (code) => {
      workflowFrontendServers.delete(serverPath);
      if (!settled) {
        finish(() => rejectReady(new WorkspaceHttpError(
          502,
          state.errors.join("\n") || `frontend server exited with status ${code ?? "unknown"}.`,
        )));
      }
    });
  });

  workflowFrontendServers.set(serverPath, state);
  return state;
}

async function startWorkflowFrontend(workspace: WorkspaceRoot, workflowKey: string) {
  const descriptor = workflowFrontendDescriptor(workspace, workflowKey);
  if (!descriptor) {
    throw new WorkspaceHttpError(404, `Workflow frontend for ${workflowKey} was not found.`);
  }

  const serverPath = workflowFrontendServerKey(workspace, descriptor);
  if (serverPath) {
    const server = startFrontendServerProcess(workspace, descriptor, serverPath);
    const url = server.url ?? await server.ready;
    return {
      descriptor,
      phase: "ready",
      url,
      html: null,
      message: `Frontend server ready at ${url}.`,
    };
  }

  if (!descriptor.entryPath) {
    throw new WorkspaceHttpError(404, `Frontend entry for ${workflowKey} was not found.`);
  }

  const entryPath = resolveInsideWorkspace(workspace, descriptor.entryPath);
  return {
    descriptor,
    phase: "static",
    url: null,
    html: readFileSync(entryPath, "utf8"),
    message: `Loaded ${descriptor.entryPath}.`,
  };
}

function parseCliJsonOutput(output: string) {
  const trimmed = output.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new WorkspaceHttpError(502, "Smithers CLI did not return JSON output.");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

function runSmithersCliJson(workspace: WorkspaceRoot, args: string[], maxBuffer = 16 * 1024 * 1024) {
  const command = smithersCliCommand();
  try {
    const output = execFileSync(command, args, {
      cwd: workspace.root,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
      maxBuffer,
    });
    return parseCliJsonOutput(output);
  } catch (error: unknown) {
    const output = [
      processOutput((error as { stdout?: unknown }).stdout),
      processOutput((error as { stderr?: unknown }).stderr),
      error instanceof Error ? error.message : String(error),
    ].filter(Boolean).join("\n");
    throw new WorkspaceHttpError(502, output || `${command} ${args.join(" ")} failed.`);
  }
}

function stringProperty(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function numberProperty(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function booleanProperty(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function valueForKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function textInputDefault(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function canonicalLaunchFieldType(value: unknown): string | null {
  const raw = normalizedText(value)?.toLowerCase();
  if (!raw) {
    return null;
  }
  if (["string", "text"].includes(raw)) {
    return "string";
  }
  if (["number", "integer", "int", "float", "double", "bigint"].includes(raw)) {
    return "number";
  }
  if (["boolean", "bool"].includes(raw)) {
    return "boolean";
  }
  if (["object", "record"].includes(raw)) {
    return "object";
  }
  if (["array", "list", "tuple"].includes(raw)) {
    return "array";
  }
  if (["json", "any", "unknown"].includes(raw)) {
    return "json";
  }
  if (raw !== "null" && raw !== "undefined") {
    return "string";
  }
  return null;
}

function typeFromDefaultValue(value: unknown): string | null {
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (jsonRecord(value)) {
    return "object";
  }
  return null;
}

function launchFieldTypeFromSchema(schema: unknown): string | null {
  const record = jsonRecord(schema);
  if (!record) {
    return canonicalLaunchFieldType(schema) ?? typeFromDefaultValue(schema);
  }
  const directType = valueForKeys(record, ["type"]);
  if (Array.isArray(directType)) {
    const types = directType.map(canonicalLaunchFieldType).filter((type): type is string => Boolean(type));
    return types.find((type) => type !== "null") ?? null;
  }
  const explicitType = canonicalLaunchFieldType(directType);
  if (explicitType) {
    return explicitType;
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const candidates = record[key];
    if (!Array.isArray(candidates)) {
      continue;
    }
    const types = candidates.map(launchFieldTypeFromSchema).filter((type): type is string => Boolean(type));
    const nonNullTypes = [...new Set(types.filter((type) => type !== "null"))];
    if (nonNullTypes.length === 1) {
      return nonNullTypes[0] ?? null;
    }
    if (nonNullTypes.length > 1) {
      return "json";
    }
  }
  if (jsonRecord(record.properties) || record.additionalProperties !== undefined) {
    return "object";
  }
  if (record.items !== undefined || record.prefixItems !== undefined) {
    return "array";
  }
  return typeFromDefaultValue(record.default);
}

function launchFieldDefaultFromSchema(schema: unknown): string | null {
  const record = jsonRecord(schema);
  if (!record) {
    return null;
  }
  if ("default" in record) {
    return textInputDefault(record.default);
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const candidates = record[key];
    if (!Array.isArray(candidates)) {
      continue;
    }
    for (const candidate of candidates) {
      const defaultValue = launchFieldDefaultFromSchema(candidate);
      if (defaultValue !== null) {
        return defaultValue;
      }
    }
  }
  return launchFieldDefaultFromSchema(record.schema);
}

function launchFieldRequiredFromSchema(schema: unknown): boolean | null {
  const record = jsonRecord(schema);
  if (!record) {
    return null;
  }
  const required = valueForKeys(record, ["required", "isRequired"]);
  if (typeof required === "boolean") {
    return required;
  }
  const optional = record.optional;
  if (typeof optional === "boolean") {
    return !optional;
  }
  return null;
}

function displayNameFromSchema(key: string, schema: unknown) {
  const record = jsonRecord(schema);
  return normalizedText(record?.title) ??
    normalizedText(record?.label) ??
    normalizedText(record?.name) ??
    key;
}

function requiredKeySet(value: unknown) {
  return new Set(Array.isArray(value) ? value.map(normalizedText).filter((entry): entry is string => Boolean(entry)) : []);
}

function workflowLaunchFieldsFromInputSchema(schema: unknown, depth = 0): WorkspaceWorkflowLaunchField[] {
  const record = jsonRecord(schema);
  if (!record || depth > 3) {
    return [];
  }
  const properties = jsonRecord(record.properties) ?? jsonRecord(record.shape);
  if (properties) {
    const requiredKeys = requiredKeySet(record.required);
    return Object.keys(properties).sort().map((key) => {
      const propertySchema = properties[key];
      const defaultValue = launchFieldDefaultFromSchema(propertySchema);
      return {
        name: displayNameFromSchema(key, propertySchema),
        key,
        type: launchFieldTypeFromSchema(propertySchema) ?? typeFromDefaultValue(defaultValue) ?? "string",
        defaultValue,
        required: requiredKeys.has(key) || (launchFieldRequiredFromSchema(propertySchema) ?? false),
      };
    });
  }
  for (const key of ["inputSchema", "input_schema", "schema", "input"]) {
    const fields = workflowLaunchFieldsFromInputSchema(record[key], depth + 1);
    if (fields.length) {
      return fields;
    }
  }
  return [];
}

function workflowLaunchFieldFromValue(value: unknown): WorkspaceWorkflowLaunchField | null {
  const record = jsonRecord(value);
  if (!record) {
    return null;
  }
  const schema = valueForKeys(record, ["schema", "inputSchema", "jsonSchema"]);
  const key = normalizedText(valueForKeys(record, ["key", "id"])) ??
    normalizedText(valueForKeys(record, ["name", "label", "title"]));
  if (!key) {
    return null;
  }
  const defaultValue = "default" in record
    ? textInputDefault(record.default)
    : launchFieldDefaultFromSchema(schema);
  const explicitRequired = valueForKeys(record, ["required", "isRequired"]);
  const explicitOptional = record.optional;
  const required = typeof explicitRequired === "boolean"
    ? explicitRequired
    : typeof explicitOptional === "boolean"
      ? !explicitOptional
      : launchFieldRequiredFromSchema(schema) ?? false;
  return {
    key,
    name: normalizedText(valueForKeys(record, ["name", "label", "title"])) ?? key,
    type: canonicalLaunchFieldType(record.type) ??
      launchFieldTypeFromSchema(schema) ??
      typeFromDefaultValue(defaultValue) ??
      null,
    defaultValue,
    required,
  };
}

function workflowLaunchFieldsFromList(value: unknown): WorkspaceWorkflowLaunchField[] {
  return Array.isArray(value)
    ? value.map(workflowLaunchFieldFromValue).filter((field): field is WorkspaceWorkflowLaunchField => field !== null)
    : [];
}

function mergeWorkflowLaunchFields(
  explicitFields: WorkspaceWorkflowLaunchField[],
  inferredFields: WorkspaceWorkflowLaunchField[],
) {
  const inferredByKey = new Map(inferredFields.map((field) => [field.key, field]));
  const merged: WorkspaceWorkflowLaunchField[] = [];
  const seen = new Set<string>();

  for (const field of explicitFields) {
    if (seen.has(field.key)) {
      continue;
    }
    seen.add(field.key);
    const inferred = inferredByKey.get(field.key);
    merged.push({
      name: field.name === field.key && inferred?.name !== inferred?.key ? inferred?.name ?? field.name : field.name,
      key: field.key,
      type: field.type ?? inferred?.type ?? null,
      defaultValue: field.defaultValue ?? inferred?.defaultValue ?? null,
      required: field.required || inferred?.required === true,
    });
  }

  for (const field of inferredFields) {
    if (!seen.has(field.key)) {
      seen.add(field.key);
      merged.push(field);
    }
  }

  return merged;
}

function workflowLaunchFieldsFromGraphRecord(record: Record<string, unknown>) {
  const graphRecord = jsonRecord(record.graph) ?? jsonRecord(record.dag);
  const records = graphRecord ? [record, graphRecord] : [record];
  const explicit = records.flatMap((candidate) =>
    workflowLaunchFieldsFromList(candidate.fields).length
      ? workflowLaunchFieldsFromList(candidate.fields)
      : [
          ...workflowLaunchFieldsFromList(candidate.launchFields),
          ...workflowLaunchFieldsFromList(candidate.inputFields),
        ]
  );
  const schema = records
    .map((candidate) => valueForKeys(candidate, ["inputSchema", "input_schema", "input", "schema"]))
    .find((candidate) => workflowLaunchFieldsFromInputSchema(candidate).length);
  return mergeWorkflowLaunchFields(explicit, workflowLaunchFieldsFromInputSchema(schema));
}

function tsPropertyNameText(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return null;
}

function tsExpressionDefaultText(expression: ts.Expression, sourceFile: ts.SourceFile) {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) {
    return expression.text;
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return "true";
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return "false";
  }
  return expression.getText(sourceFile);
}

type ZodLaunchFieldInfo = {
  type: string | null;
  defaultValue: string | null;
  optional: boolean;
  objectFields: WorkspaceWorkflowLaunchField[];
};

function zodLaunchFieldInfo(expression: ts.Expression, sourceFile: ts.SourceFile): ZodLaunchFieldInfo {
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return { type: null, defaultValue: null, optional: false, objectFields: [] };
  }

  const method = expression.expression.name.text;
  const target = expression.expression.expression;
  const inner = zodLaunchFieldInfo(target, sourceFile);

  if (["optional", "nullish"].includes(method)) {
    return { ...inner, optional: true };
  }
  if (method === "default") {
    return {
      ...inner,
      defaultValue: expression.arguments[0] ? tsExpressionDefaultText(expression.arguments[0], sourceFile) : inner.defaultValue,
      optional: true,
    };
  }
  if (["describe", "brand", "readonly", "nullable"].includes(method)) {
    return inner;
  }
  if (method === "array") {
    return { ...inner, type: "array" };
  }

  const directType = canonicalLaunchFieldType(method);
  if (directType === "object") {
    const objectFields = ts.isObjectLiteralExpression(expression.arguments[0])
      ? workflowLaunchFieldsFromZodObject(expression.arguments[0], sourceFile)
      : [];
    return { type: "object", defaultValue: inner.defaultValue, optional: inner.optional, objectFields };
  }
  if (directType) {
    return { type: directType, defaultValue: inner.defaultValue, optional: inner.optional, objectFields: [] };
  }
  if (["enum", "literal"].includes(method)) {
    return { type: "string", defaultValue: inner.defaultValue, optional: inner.optional, objectFields: [] };
  }
  return inner;
}

function workflowLaunchFieldsFromZodObject(
  objectLiteral: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): WorkspaceWorkflowLaunchField[] {
  const fields: WorkspaceWorkflowLaunchField[] = [];
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const key = tsPropertyNameText(property.name);
    if (!key) {
      continue;
    }
    const info = zodLaunchFieldInfo(property.initializer, sourceFile);
    fields.push({
      name: key,
      key,
      type: info.type ?? "string",
      defaultValue: info.defaultValue,
      required: !info.optional && info.defaultValue === null,
    });
  }
  return fields;
}

function workflowLaunchFieldsFromSource(source: string, fileName: string): WorkspaceWorkflowLaunchField[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const discovered: WorkspaceWorkflowLaunchField[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      const config = node.arguments[0];
      if (calleeName === "createSmithers" && ts.isObjectLiteralExpression(config)) {
        for (const property of config.properties) {
          if (!ts.isPropertyAssignment(property) || tsPropertyNameText(property.name) !== "input") {
            continue;
          }
          const info = zodLaunchFieldInfo(property.initializer, sourceFile);
          discovered.push(...info.objectFields);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return mergeWorkflowLaunchFields(discovered, []);
}

function workflowGraphTask(value: unknown): WorkspaceWorkflowGraphTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const nodeId = stringProperty(record, ["nodeId", "id", "node_id", "taskId"]);
  if (!nodeId) {
    return null;
  }
  return {
    nodeId,
    ordinal: numberProperty(record, ["ordinal", "index"]),
    outputTableName: stringProperty(record, ["outputTableName", "outputTable", "output_table_name"]),
    needsApproval: booleanProperty(record, ["needsApproval", "approval", "requiresApproval"]),
    waitAsync: booleanProperty(record, ["waitAsync"]),
  };
}

function workflowGraphEdge(value: unknown): WorkspaceWorkflowGraphEdge | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const from = stringProperty(record, ["from", "source", "sourceId"]);
  const to = stringProperty(record, ["to", "target", "targetId"]);
  return from && to ? { from, to } : null;
}

function collectXmlTaskIds(node: unknown): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return [];
  }
  const record = node as Record<string, unknown>;
  const props = record.props && typeof record.props === "object" && !Array.isArray(record.props)
    ? record.props as Record<string, unknown>
    : {};
  const tag = typeof record.tag === "string" ? record.tag : "";
  const children = Array.isArray(record.children) ? record.children : [];
  const childTaskIds = children.flatMap(collectXmlTaskIds);
  const nodeId = typeof props.id === "string" && props.id.trim()
    ? props.id.trim()
    : null;
  return tag.endsWith(":task") || tag === "Task" || tag.toLowerCase().includes("task")
    ? [nodeId ?? `task-${childTaskIds.length}`, ...childTaskIds]
    : childTaskIds;
}

function sequentialEdgesForTasks(tasks: WorkspaceWorkflowGraphTask[]) {
  return tasks
    .slice(0, -1)
    .map((task, index) => ({ from: task.nodeId, to: tasks[index + 1].nodeId }));
}

function uniqueGraphEdges(edges: WorkspaceWorkflowGraphEdge[], validNodeIds: Set<string>) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (!validNodeIds.has(edge.from) || !validNodeIds.has(edge.to) || edge.from === edge.to) {
      return false;
    }
    const key = `${edge.from}\n${edge.to}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function workflowGraphPayload(workspace: WorkspaceRoot, workflowKey: string) {
  const workflowPath = findWorkflowSourcePath(workspace, workflowKey);
  const raw = runSmithersCliJson(workspace, [
    "graph",
    workflowPath,
    "--format",
    "json",
  ]);

  const graphRecord = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const graphFields = workflowLaunchFieldsFromGraphRecord(graphRecord);
  const sourceFields = graphFields.length
    ? []
    : workflowLaunchFieldsFromSource(readFileSync(workflowPath, "utf8"), workflowPath);
  const tasks = (Array.isArray(graphRecord.tasks) ? graphRecord.tasks : [])
    .map(workflowGraphTask)
    .filter((task): task is WorkspaceWorkflowGraphTask => task !== null)
    .sort((left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0));
  const validNodeIds = new Set(tasks.map((task) => task.nodeId));
  const explicitEdges = [
    ...(Array.isArray(graphRecord.edges) ? graphRecord.edges : []),
    ...(Array.isArray(graphRecord.graphEdges) ? graphRecord.graphEdges : []),
    ...(Array.isArray(graphRecord.links) ? graphRecord.links : []),
  ].map(workflowGraphEdge).filter((edge): edge is WorkspaceWorkflowGraphEdge => edge !== null);
  const xmlTaskIds = collectXmlTaskIds(graphRecord.xml);
  const xmlTasks = xmlTaskIds
    .map((nodeId, ordinal) => ({ nodeId, ordinal, outputTableName: null, needsApproval: null, waitAsync: null }));
  const resolvedTasks = tasks.length ? tasks : xmlTasks;
  const resolvedNodeIds = new Set(resolvedTasks.map((task) => task.nodeId));
  const resolvedExplicitEdges = uniqueGraphEdges(explicitEdges, resolvedNodeIds);

  return {
    workflowKey,
    path: workspaceRelativePath(workspace, workflowPath),
    mode: graphRecord.mode && typeof graphRecord.mode === "string" ? graphRecord.mode : "rendered",
    message: graphRecord.message && typeof graphRecord.message === "string" ? graphRecord.message : null,
    tasks: resolvedTasks,
    edges: resolvedExplicitEdges.length ? resolvedExplicitEdges : sequentialEdgesForTasks(resolvedTasks),
    fields: graphFields.length ? graphFields : sourceFields,
    entryTask: stringProperty(graphRecord, ["entryTaskId", "entry_task_id", "entryTask", "entry_task"]) ?? resolvedTasks[0]?.nodeId ?? null,
    raw,
  };
}

function objectProperty(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayProperty(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function doctorWorkflowIdForPath(workspace: WorkspaceRoot, workflowPath: string) {
  const relativeWorkflowPath = workspaceRelativePath(workspace, workflowPath);
  const workflowRootRelativePath = toPosixPath(relative(workspace.workflowsPath, workflowPath));
  if (!workflowRootRelativePath.includes("/") && extname(workflowRootRelativePath) === ".tsx") {
    return basename(workflowRootRelativePath, ".tsx");
  }
  return basename(relativeWorkflowPath, extname(relativeWorkflowPath));
}

function workflowDoctorIssues(
  workspace: WorkspaceRoot,
  workflowKey: string,
  workflowPath: string,
  raw: unknown,
): WorkspaceWorkflowDoctorIssue[] {
  const issues: WorkspaceWorkflowDoctorIssue[] = [];
  const doctor = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const workflows = arrayProperty(doctor, "workflows");
  const relativeWorkflowPath = workspaceRelativePath(workspace, workflowPath);
  const workflowId = doctorWorkflowIdForPath(workspace, workflowPath);
  const discovered = workflows.find((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    const id = stringProperty(record, ["id"]);
    const path = stringProperty(record, ["path", "entryFile"]);
    return id === workflowId ||
      id === workflowKey ||
      (path ? workspaceRelativePath(workspace, path) === relativeWorkflowPath : false);
  });

  issues.push(discovered ? {
    severity: "ok",
    check: "workflow-discovery",
    message: `Discovered ${workflowId} at ${relativeWorkflowPath}.`,
  } : {
    severity: "error",
    check: "workflow-discovery",
    message: `Smithers CLI did not discover ${workflowId} from .smithers/workflows.`,
  });

  const preload = objectProperty(doctor, "preload");
  const preloadExists = preload?.exists === true;
  const preloadPath = preload ? stringProperty(preload, ["path", "file", "entryFile"]) : null;
  issues.push({
    severity: preloadExists ? "ok" : "warning",
    check: "preload",
    message: preloadExists
      ? `Workflow preload file exists at ${preloadPath ?? ".smithers/preload.ts"}.`
      : "No .smithers/preload.ts file is configured.",
  });

  const bunfig = objectProperty(doctor, "bunfig");
  const bunfigExists = bunfig?.exists === true;
  issues.push({
    severity: bunfigExists ? "ok" : "warning",
    check: "bunfig",
    message: bunfigExists
      ? "Workflow bunfig file exists."
      : "No .smithers/bunfig.toml file is configured.",
  });

  const agents = arrayProperty(doctor, "agents");
  const usableAgents = agents.filter((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).usable === true,
  );
  issues.push({
    severity: usableAgents.length > 0 ? "ok" : "error",
    check: "agents",
    message: usableAgents.length > 0
      ? `${usableAgents.length} usable agent${usableAgents.length === 1 ? "" : "s"} detected.`
      : "No usable Smithers agents were detected.",
  });

  return issues;
}

function workflowDoctorPayload(workspace: WorkspaceRoot, workflowKey: string) {
  const workflowPath = findWorkflowSourcePath(workspace, workflowKey);
  const workflowId = doctorWorkflowIdForPath(workspace, workflowPath);
  const raw = runSmithersCliJson(workspace, [
    "workflow",
    "doctor",
    workflowId,
    "--format",
    "json",
  ]);
  const doctor = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return {
    workflowKey,
    path: workspaceRelativePath(workspace, workflowPath),
    workflowRoot: stringProperty(doctor, ["workflowRoot"]),
    issues: workflowDoctorIssues(workspace, workflowKey, workflowPath, raw),
    raw,
  };
}

function saveWorkflowSourceFile(workspace: WorkspaceRoot, sourcePath: unknown, source: unknown) {
  if (typeof sourcePath !== "string" || typeof source !== "string") {
    throw new WorkspaceHttpError(400, "path and source must be strings.");
  }
  const absolutePath = assertWorkspaceSourcePath(workspace, sourcePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new WorkspaceHttpError(404, `Workflow source file ${sourcePath} was not found.`);
  }
  writeFileSync(absolutePath, source);
  return workspaceRelativePath(workspace, absolutePath);
}

function ticketStatus(content: string) {
  const frontmatter = /^---\n([\s\S]*?)\n(?:---|\.\.\.)/.exec(content)?.[1];
  const statusSource = frontmatter ?? content.slice(0, 800);
  return /^status:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/im.exec(statusSource)?.[1] ?? null;
}

function ticketFromPath(ticketsPath: string, ticketPath: string) {
  const stat = statSync(ticketPath);
  const content = readFileSync(ticketPath, "utf8");
  return {
    id: toPosixPath(relative(ticketsPath, ticketPath)),
    content,
    status: ticketStatus(content),
    createdAtMs: Math.round(stat.birthtimeMs || stat.ctimeMs),
    updatedAtMs: Math.round(stat.mtimeMs),
  };
}

function listTickets(workspace: WorkspaceRoot, query = "") {
  const ticketsPath = join(workspace.smithersPath, "tickets");
  const normalizedQuery = query.trim().toLowerCase();
  return walkFiles(ticketsPath, new Set([".md"]))
    .filter((ticketPath) => basename(ticketPath) !== ".gitkeep")
    .map((ticketPath) => ticketFromPath(ticketsPath, ticketPath))
    .filter((ticket) => {
      if (!normalizedQuery) {
        return true;
      }
      return ticket.id.toLowerCase().includes(normalizedQuery) ||
        (ticket.content ?? "").toLowerCase().includes(normalizedQuery) ||
        (ticket.status ?? "").toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0));
}

function ticketPathForId(workspace: WorkspaceRoot, ticketId: unknown) {
  const safeId = assertSafeTicketId(ticketId);
  return join(workspace.smithersPath, "tickets", safeId);
}

function snippetForLine(lines: string[], lineIndex: number) {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 2);
  return {
    content: lines.slice(start, end).join("\n"),
    startLine: start + 1,
  };
}

function searchCode(workspace: WorkspaceRoot, query: string, limit: number) {
  const normalizedQuery = query.toLowerCase();
  const results = [];
  const skippedResults = [];
  for (const filePath of walkFiles(workspace.root, TEXT_EXTENSIONS, 10_000)) {
    if (results.length >= limit) {
      break;
    }
    const fileRelativePath = toPosixPath(relative(workspace.root, filePath));
    const fileExtension = extname(filePath).toLowerCase() || null;
    let source = "";
    let fileSize = 0;
    try {
      const stats = statSync(filePath);
      fileSize = stats.size;
      if (fileSize > 512_000) {
        if (fileRelativePath.toLowerCase().includes(normalizedQuery)) {
          skippedResults.push({
            id: `code:${fileRelativePath}:large`,
            title: fileRelativePath,
            description: `Large file (${Math.round(fileSize / 1024)}KB > 512KB limit)`,
            snippet: null,
            filePath: fileRelativePath,
            lineNumber: null,
            lineNumbers: [],
            kind: "code-skipped",
            snippetRanges: [],
            fileSize,
            fileExtension,
            skipReason: "large-file",
          });
        }
        continue;
      }
      source = readFileSync(filePath, "utf8");
    } catch (error) {
      if (fileRelativePath.toLowerCase().includes(normalizedQuery)) {
        skippedResults.push({
          id: `code:${fileRelativePath}:error`,
          title: fileRelativePath,
          description: error instanceof Error ? error.message : "Read error",
          snippet: null,
          filePath: fileRelativePath,
          lineNumber: null,
          lineNumbers: [],
          kind: "code-error",
          snippetRanges: [],
          fileSize,
          fileExtension,
          skipReason: "read-error",
        });
      }
      continue;
    }
    if (source.includes("\0")) {
      if (fileRelativePath.toLowerCase().includes(normalizedQuery)) {
        skippedResults.push({
          id: `code:${fileRelativePath}:binary`,
          title: fileRelativePath,
          description: "Binary file detected.",
          snippet: null,
          filePath: fileRelativePath,
          lineNumber: null,
          lineNumbers: [],
          kind: "code-binary",
          snippetRanges: [],
          fileSize,
          fileExtension,
          skipReason: "binary-file",
        });
      }
      continue;
    }
    if (!source.toLowerCase().includes(normalizedQuery)) {
      continue;
    }
    const lines = source.split("\n");
    const matchIndexes = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      matchIndexes.push(index);
    }
    if (matchIndexes.length === 0) {
      continue;
    }
    const snippetRanges = matchIndexes.slice(0, 8).map((index) => snippetForLine(lines, index));
    const lineNumbers = matchIndexes.map((index) => index + 1);
    results.push({
      id: `code:${fileRelativePath}:${lineNumbers.slice(0, 12).join(",")}`,
      title: fileRelativePath,
      description: `${lineNumbers.length} workspace file match${lineNumbers.length === 1 ? "" : "es"}`,
      snippet: snippetRanges.map((snippet) => snippet.content).join("\n---\n"),
      filePath: fileRelativePath,
      lineNumber: lineNumbers[0],
      lineNumbers,
      kind: "code",
      snippetRanges,
      fileSize,
      fileExtension,
      skipReason: null,
    });
  }
  return [...results, ...skippedResults].slice(0, limit);
}

function searchIssues(workspace: WorkspaceRoot, query: string, issueState: string | null, limit: number) {
  return listTickets(workspace, query)
    .filter((ticket) => !issueState || ticket.status === issueState)
    .slice(0, limit)
    .map((ticket) => {
      const lines = (ticket.content ?? "").split("\n");
      const matchIndex = lines.findIndex((line) => line.toLowerCase().includes(query.toLowerCase()));
      const snippet = snippetForLine(lines, Math.max(0, matchIndex));
      return {
        id: `issue:${ticket.id}`,
        title: ticket.id,
        description: ticket.status ? `status: ${ticket.status}` : "Workspace ticket",
        snippet: snippet.content,
        filePath: `.smithers/tickets/${ticket.id}`,
        lineNumber: snippet.startLine,
        kind: "issue",
        snippetRanges: [snippet],
      };
    });
}

function searchRepos(workspace: WorkspaceRoot, query: string, limit: number) {
  const normalizedQuery = query.toLowerCase();
  let packageName: string | null = null;
  try {
    const packageJson = JSON.parse(readFileSync(join(workspace.root, "package.json"), "utf8")) as unknown;
    if (packageJson && typeof packageJson === "object" && "name" in packageJson) {
      packageName = String((packageJson as { name: unknown }).name);
    }
  } catch {
    packageName = null;
  }
  const title = packageName ?? basename(workspace.root);
  const haystack = `${title}\n${workspace.root}`.toLowerCase();
  if (!haystack.includes(normalizedQuery)) {
    return [];
  }
  return [{
    id: `repo:${workspace.root}`,
    title,
    description: workspace.root,
    snippet: workspace.smithersPath,
    filePath: workspace.root,
    lineNumber: null,
    kind: "repo",
    snippetRanges: null,
  }].slice(0, limit);
}

function queryParam(query: WorkspaceBackendRequest["query"], key: string) {
  const value = query?.[key];
  return value == null ? null : value;
}

function queryLimit(query: WorkspaceBackendRequest["query"], defaultLimit: number) {
  return Math.max(1, Math.min(100, Number(queryParam(query, "limit") ?? defaultLimit) || defaultLimit));
}

function searchWorkspace(workspace: WorkspaceRoot, query: WorkspaceBackendRequest["query"]) {
  const search = queryParam(query, "query")?.trim() ?? "";
  if (!search) {
    return [];
  }
  const limit = queryLimit(query, 20);
  const scope = queryParam(query, "scope") ?? "code";
  if (scope === "issues") {
    return searchIssues(workspace, search, queryParam(query, "issueState"), limit);
  }
  if (scope === "repos") {
    return searchRepos(workspace, search, limit);
  }
  if (scope === "transcripts") {
    try {
      return querySmithersDb<{ results: ReturnType<typeof searchCode> }>(workspace, "transcriptSearch", {
        query: search,
        limit,
      }).results;
    } catch (error) {
      if (error instanceof WorkspaceHttpError && error.status === 404) {
        return [];
      }
      throw error;
    }
  }
  return searchCode(workspace, search, limit);
}

function listWorkspaceFiles(workspace: WorkspaceRoot, query: WorkspaceBackendRequest["query"]) {
  const search = (queryParam(query, "query") ?? "").trim().toLowerCase();
  const limit = queryLimit(query, 80);
  const files = [];
  for (const filePath of walkFiles(workspace.root, undefined, 10_000)) {
    const relativePath = workspaceRelativePath(workspace, filePath);
    if (search && !relativePath.toLowerCase().includes(search)) {
      continue;
    }
    const extension = extname(filePath).toLowerCase();
    files.push({
      path: relativePath,
      name: basename(filePath),
      extension: extension || null,
      size: statSync(filePath).size,
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path)).slice(0, limit);
}

function workspaceFilePath(workspace: WorkspaceRoot, value: unknown) {
  const raw = normalizedText(value);
  if (!raw) {
    throw new WorkspaceHttpError(400, "path is required.");
  }
  const candidate = raw.startsWith(sep) ? resolve(raw) : resolve(workspace.root, raw);
  if (candidate !== workspace.root && !candidate.startsWith(`${workspace.root}${sep}`)) {
    throw new WorkspaceHttpError(400, "File path must stay inside the workspace.");
  }
  try {
    if (!statSync(candidate).isFile()) {
      throw new WorkspaceHttpError(400, "File path must point to a file.");
    }
  } catch (error) {
    if (error instanceof WorkspaceHttpError) {
      throw error;
    }
    throw new WorkspaceHttpError(404, `File not found: ${raw}`);
  }
  return candidate;
}

function readWorkspaceFile(workspace: WorkspaceRoot, value: unknown) {
  const filePath = workspaceFilePath(workspace, value);
  const extension = extname(filePath).toLowerCase();
  return {
    path: workspaceRelativePath(workspace, filePath),
    name: basename(filePath),
    extension: extension || null,
    size: statSync(filePath).size,
    content: readFileSync(filePath, "utf8"),
  };
}

function bodyRecord(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

function routeFromPath(path: string) {
  const trimmed = path.replace(/^\/__smithers_studio\/api\/?/, "").replace(/^\/+/, "");
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export async function handleWorkspaceBackendRequest(
  request: WorkspaceBackendRequest,
): Promise<WorkspaceBackendResponse> {
  const route = routeFromPath(request.path);
  const method = request.method?.toUpperCase() ?? "GET";
  const query = request.query ?? {};

  if (method === "GET" && route === "local-workspaces") {
    return { status: 200, payload: { recents: listLocalWorkspaceRecents() } };
  }

  if (method === "POST" && route === "local-workspaces/open") {
    const body = bodyRecord(request.body);
    return { status: 200, payload: { workspace: openLocalWorkspace(assertBodyString(body, "path")) } };
  }

  if (method === "DELETE" && route === "local-workspaces") {
    const body = bodyRecord(request.body);
    removeLocalWorkspaceRecent(assertBodyString(body, "path"));
    return { status: 200, payload: { recents: listLocalWorkspaceRecents() } };
  }

  if (method === "GET" && route === "auth/status") {
    return { status: 200, payload: { auth: jjhubAuthStatusPayload() } };
  }

  const { workspace } = currentWorkspace();

  if (method === "GET" && route === "versions") {
    return { status: 200, payload: { versions: workspaceVersions(workspace) } };
  }

  const workflowFrontendStartMatch = /^workflow-frontends\/(.+)\/start$/.exec(route);
  if (method === "POST" && workflowFrontendStartMatch) {
    return { status: 200, payload: { frontend: await startWorkflowFrontend(workspace, workflowFrontendStartMatch[1]) } };
  }

  const workflowFrontendMatch = /^workflow-frontends\/(.+)$/.exec(route);
  if (method === "GET" && workflowFrontendMatch) {
    return { status: 200, payload: { frontend: workflowFrontendDescriptor(workspace, workflowFrontendMatch[1]) } };
  }

  const workflowGraphMatch = /^workflow-sources\/(.+)\/graph$/.exec(route);
  if (method === "GET" && workflowGraphMatch) {
    return { status: 200, payload: { graph: workflowGraphPayload(workspace, workflowGraphMatch[1]) } };
  }

  const workflowDoctorMatch = /^workflow-sources\/(.+)\/doctor$/.exec(route);
  if (method === "GET" && workflowDoctorMatch) {
    return { status: 200, payload: { doctor: workflowDoctorPayload(workspace, workflowDoctorMatch[1]) } };
  }

  const workflowSourceMatch = /^workflow-sources\/(.+)$/.exec(route);
  if (method === "GET" && workflowSourceMatch) {
    return { status: 200, payload: { workflow: workflowSourcePayload(workspace, workflowSourceMatch[1]) } };
  }

  if (method === "PUT" && route === "workflow-sources") {
    const body = bodyRecord(request.body);
    return {
      status: 200,
      payload: { path: saveWorkflowSourceFile(workspace, body.path, body.source) },
    };
  }

  if (method === "GET" && route === "prompts") {
    return { status: 200, payload: { prompts: listPrompts(workspace) } };
  }

  if (method === "GET" && route === "workflows") {
    return { status: 200, payload: { workflows: listWorkflows(workspace) } };
  }

  const promptPreviewMatch = /^prompts\/(.+)\/preview$/.exec(route);
  if (method === "POST" && promptPreviewMatch) {
    const body = bodyRecord(request.body);
    const source = typeof body.source === "string"
      ? body.source
      : readFileSync(findPromptPath(workspace, promptPreviewMatch[1]), "utf8");
    const input = body.input && typeof body.input === "object" && !Array.isArray(body.input)
      ? Object.fromEntries(Object.entries(body.input).map(([key, value]) => [key, String(value ?? "")]))
      : {};
    return { status: 200, payload: { preview: renderPromptPreview(source, input) } };
  }

  const promptMatch = /^prompts\/(.+)$/.exec(route);
  if (promptMatch) {
    const promptPath = findPromptPath(workspace, promptMatch[1]);
    if (method === "GET") {
      return { status: 200, payload: { prompt: promptFromPath(workspace, promptPath) } };
    }
    if (method === "PUT") {
      const body = bodyRecord(request.body);
      if (typeof body.source !== "string") {
        throw new WorkspaceHttpError(400, "source must be a string.");
      }
      writeFileSync(promptPath, body.source);
      return { status: 200, payload: { prompt: promptFromPath(workspace, promptPath) } };
    }
  }

  if (method === "GET" && route === "tickets") {
    return { status: 200, payload: { tickets: listTickets(workspace, queryParam(query, "query") ?? "") } };
  }

  if (method === "GET" && route === "agents") {
    return { status: 200, payload: { agents: listAgents(workspace) } };
  }

  if (method === "GET" && route === "files/content") {
    return { status: 200, payload: { file: readWorkspaceFile(workspace, queryParam(query, "path")) } };
  }

  if (method === "GET" && route === "files") {
    return { status: 200, payload: { files: listWorkspaceFiles(workspace, query) } };
  }

  if (method === "POST" && route === "terminal/execute") {
    return { status: 200, payload: { execution: await executeTerminalCommand(workspace, bodyRecord(request.body)) } };
  }

  if (method === "POST" && route === "terminal/sessions") {
    return { status: 200, payload: { session: startTerminalSession(workspace, bodyRecord(request.body)) } };
  }

  const terminalSessionMatch = /^terminal\/sessions\/([^/]+)$/.exec(route);
  if (terminalSessionMatch) {
    if (method === "GET") {
      return { status: 200, payload: { session: terminalSessionSnapshot(workspace, terminalSessionRecord(workspace, terminalSessionMatch[1])) } };
    }
    if (method === "POST") {
      return { status: 200, payload: { session: sendTerminalSessionInput(workspace, terminalSessionMatch[1], bodyRecord(request.body)) } };
    }
    if (method === "PUT") {
      return { status: 200, payload: { session: resizeTerminalSession(workspace, terminalSessionMatch[1], bodyRecord(request.body)) } };
    }
    if (method === "DELETE") {
      return { status: 200, payload: { session: stopTerminalSession(workspace, terminalSessionMatch[1]) } };
    }
  }

  if (method === "GET" && route === "browser/resolve") {
    return { status: 200, payload: { browser: resolveBrowserURL(workspace, queryParam(query, "value")) } };
  }

  if (method === "POST" && route === "operator/screenshot") {
    return { status: 200, payload: { screenshot: saveOperatorScreenshot(workspace, bodyRecord(request.body)) } };
  }

  if (method === "GET" && route === "debug") {
    return { status: 200, payload: { debug: developerDebugPayload(workspace) } };
  }

  if (method === "GET" && route === "logs/export") {
    return { status: 200, payload: exportWorkspaceLogsPayload(workspace, query) };
  }

  if (method === "POST" && route === "logs/reveal") {
    return { status: 200, payload: { paths: revealWorkspaceLogs(workspace) } };
  }

  if (method === "DELETE" && route === "logs") {
    return { status: 200, payload: { cleared: clearWorkspaceLogs(workspace) } };
  }

  if (method === "GET" && route === "logs") {
    return { status: 200, payload: workspaceLogsPayload(workspace, query) };
  }

  if (method === "GET" && route === "settings") {
    return { status: 200, payload: { settings: workspaceSettingsPayload(workspace) } };
  }

  if (method === "PUT" && route === "settings") {
    return { status: 200, payload: { settings: saveWorkspaceSettings(workspace, bodyRecord(request.body)) } };
  }

  if (method === "GET" && route === "editor/target") {
    return { status: 200, payload: { target: workspaceEditorTarget(workspace, query) } };
  }

  if (method === "GET" && route === "landings") {
    return {
      status: 200,
      payload: { landings: listJjhubLandings(workspace, queryParam(query, "state"), queryLimit(query, 100)) },
    };
  }

  if (method === "POST" && route === "landings") {
    const body = bodyRecord(request.body);
    const args = ["land", "create", "--title", assertBodyString(body, "title")];
    const bodyText = normalizedText(body.body);
    const target = normalizedText(body.target);
    if (bodyText) {
      args.push("--body", bodyText);
    }
    if (target) {
      args.push("--target", target);
    }
    if (body.stack !== false) {
      args.push("--stack");
    }
    return { status: 201, payload: { landing: jjhubLandingPayload(workspace, args) } };
  }

  const landingDiffMatch = /^landings\/([^/]+)\/diff$/.exec(route);
  if (method === "GET" && landingDiffMatch) {
    return {
      status: 200,
      payload: { diff: landingDiffText(workspace, assertPositiveInteger(landingDiffMatch[1], "landing number")) },
    };
  }

  const landingChecksMatch = /^landings\/([^/]+)\/checks$/.exec(route);
  if (method === "GET" && landingChecksMatch) {
    return {
      status: 200,
      payload: { checks: runJjhubText(workspace, ["land", "checks", assertPositiveInteger(landingChecksMatch[1], "landing number")]) },
    };
  }

  const landingConflictsMatch = /^landings\/([^/]+)\/conflicts$/.exec(route);
  if (method === "GET" && landingConflictsMatch) {
    return {
      status: 200,
      payload: { conflicts: jjhubLandingConflictsPayload(workspace, assertPositiveInteger(landingConflictsMatch[1], "landing number")) },
    };
  }

  const landingReviewMatch = /^landings\/([^/]+)\/review$/.exec(route);
  if (method === "POST" && landingReviewMatch) {
    const body = bodyRecord(request.body);
    const number = assertPositiveInteger(landingReviewMatch[1], "landing number");
    const action = normalizedText(body.action);
    const args = ["land", "review", number];
    if (action === "approve") {
      args.push("--approve");
    } else if (action === "request_changes") {
      args.push("--request-changes");
    } else if (action === "comment") {
      args.push("--comment");
    } else {
      throw new WorkspaceHttpError(400, "action must be approve, request_changes, or comment.");
    }
    const bodyText = normalizedText(body.body);
    if (bodyText) {
      args.push("--body", bodyText);
    }
    runJjhub(workspace, args);
    return { status: 200, payload: { landing: jjhubLandingPayload(workspace, ["land", "view", number]) } };
  }

  const landingLandMatch = /^landings\/([^/]+)\/land$/.exec(route);
  if (method === "POST" && landingLandMatch) {
    const number = assertPositiveInteger(landingLandMatch[1], "landing number");
    const payload = payloadObject(parseJjhubJson(workspace, ["land", "land", number]), ["landing"]);
    const parsed = jjhubLandingFromValue(payload) ?? jjhubLandingPayload(workspace, ["land", "view", number]);
    return { status: 200, payload: { landing: parsed } };
  }

  const landingMatch = /^landings\/([^/]+)$/.exec(route);
  if (method === "GET" && landingMatch) {
    return {
      status: 200,
      payload: { landing: jjhubLandingPayload(workspace, ["land", "view", assertPositiveInteger(landingMatch[1], "landing number")]) },
    };
  }

  if (method === "GET" && route === "issues") {
    return { status: 200, payload: { issues: listJjhubIssues(workspace, queryParam(query, "state")) } };
  }

  if (method === "POST" && route === "issues") {
    const body = bodyRecord(request.body);
    const args = ["issue", "create", "--title", assertBodyString(body, "title")];
    const bodyText = normalizedText(body.body);
    if (bodyText) {
      args.push("--body", bodyText);
    }
    return { status: 201, payload: { issue: jjhubIssuePayload(workspace, args) } };
  }

  const issueCloseMatch = /^issues\/([^/]+)\/close$/.exec(route);
  if (method === "POST" && issueCloseMatch) {
    const body = bodyRecord(request.body);
    const args = ["issue", "close", assertPositiveInteger(issueCloseMatch[1], "issue number")];
    const comment = normalizedText(body.comment);
    if (comment) {
      args.push("--comment", comment);
    }
    return { status: 200, payload: { issue: jjhubIssuePayload(workspace, args) } };
  }

  const issueReopenMatch = /^issues\/([^/]+)\/reopen$/.exec(route);
  if (method === "POST" && issueReopenMatch) {
    return {
      status: 200,
      payload: {
        issue: jjhubIssuePayload(workspace, ["issue", "reopen", assertPositiveInteger(issueReopenMatch[1], "issue number")]),
      },
    };
  }

  const issueMatch = /^issues\/([^/]+)$/.exec(route);
  if (method === "GET" && issueMatch) {
    return {
      status: 200,
      payload: {
        issue: jjhubIssuePayload(workspace, ["issue", "view", assertPositiveInteger(issueMatch[1], "issue number")]),
      },
    };
  }

  if (method === "GET" && route === "jjhub-workflows") {
    return { status: 200, payload: { workflows: listJjhubWorkflows(workspace, queryLimit(query, 100)) } };
  }

  if (method === "GET" && route === "jjhub-repo") {
    return { status: 200, payload: { repo: jjhubRepoPayload(workspace) } };
  }

  if (method === "POST" && route === "jjhub-workflows/run") {
    const body = bodyRecord(request.body);
    const workflowID = assertPositiveInteger(String(body.workflowID ?? ""), "workflowID");
    const ref = normalizedText(body.ref) ?? "main";
    return { status: 200, payload: { run: jjhubWorkflowRunPayload(workspace, workflowID, ref) } };
  }

  if (method === "GET" && route === "workspaces") {
    return { status: 200, payload: { workspaces: listCloudWorkspaces(workspace) } };
  }

  if (method === "POST" && route === "workspaces") {
    const body = bodyRecord(request.body);
    const name = assertBodyString(body, "name");
    const args = ["workspace", "create", "--name", name];
    const snapshotId = normalizedText(body.snapshotId);
    if (snapshotId) {
      args.push("--snapshot", snapshotId);
    }
    return { status: 201, payload: { workspace: cloudWorkspacePayload(workspace, args) } };
  }

  if (method === "GET" && route === "workspaces/snapshots") {
    return { status: 200, payload: { snapshots: listCloudWorkspaceSnapshots(workspace) } };
  }

  if (method === "POST" && route === "workspaces/snapshots") {
    const body = bodyRecord(request.body);
    const workspaceId = assertBodyString(body, "workspaceId");
    const name = assertBodyString(body, "name");
    return {
      status: 201,
      payload: { snapshot: cloudSnapshotPayload(workspace, ["workspace", "snapshot", "create", workspaceId, "--name", name]) },
    };
  }

  const workspaceSnapshotMatch = /^workspaces\/snapshots\/(.+)$/.exec(route);
  if (workspaceSnapshotMatch) {
    const snapshotId = workspaceSnapshotMatch[1];
    if (method === "DELETE") {
      runJjhub(workspace, ["workspace", "snapshot", "delete", snapshotId]);
      return { status: 200, payload: { ok: true } };
    }
  }

  const workspaceForkMatch = /^workspaces\/(.+)\/fork$/.exec(route);
  if (method === "POST" && workspaceForkMatch) {
    const body = bodyRecord(request.body);
    const args = ["workspace", "fork", workspaceForkMatch[1]];
    const name = normalizedText(body.name);
    if (name) {
      args.push("--name", name);
    }
    return { status: 200, payload: { workspace: cloudWorkspacePayload(workspace, args) } };
  }

  const workspaceActionMatch = /^workspaces\/(.+)\/(suspend|resume)$/.exec(route);
  if (method === "POST" && workspaceActionMatch) {
    runJjhub(workspace, ["workspace", workspaceActionMatch[2], workspaceActionMatch[1]]);
    return { status: 200, payload: { ok: true } };
  }

  const cloudWorkspaceMatch = /^workspaces\/(.+)$/.exec(route);
  if (cloudWorkspaceMatch) {
    const workspaceId = cloudWorkspaceMatch[1];
    if (method === "GET") {
      return { status: 200, payload: { workspace: cloudWorkspacePayload(workspace, ["workspace", "view", workspaceId]) } };
    }
    if (method === "DELETE") {
      runJjhub(workspace, ["workspace", "delete", workspaceId]);
      return { status: 200, payload: { ok: true } };
    }
  }

  if (method === "GET" && route === "changes/repo") {
    return { status: 200, payload: { repo: currentJjRepo(workspace) } };
  }

  if (method === "GET" && route === "changes") {
    return { status: 200, payload: { changes: listJjChanges(workspace, queryLimit(query, 50)) } };
  }

  if (method === "GET" && route === "changes/status") {
    return { status: 200, payload: { status: runJj(workspace, ["status"]) } };
  }

  if (method === "GET" && route === "changes/diff") {
    return { status: 200, payload: { diff: jjChangeDiff(workspace, queryParam(query, "changeId")) } };
  }

  if (method === "POST" && route === "changes/bookmarks") {
    const body = bodyRecord(request.body);
    if (typeof body.name !== "string" || typeof body.changeID !== "string") {
      throw new WorkspaceHttpError(400, "name and changeID must be strings.");
    }
    return { status: 201, payload: { bookmark: createJjBookmark(workspace, body.name, body.changeID) } };
  }

  if (method === "DELETE" && route === "changes/bookmarks") {
    const body = bodyRecord(request.body);
    if (typeof body.name !== "string") {
      throw new WorkspaceHttpError(400, "name must be a string.");
    }
    deleteJjBookmark(workspace, body.name);
    return { status: 200, payload: { ok: true } };
  }

  const changeMatch = /^changes\/(.+)$/.exec(route);
  if (method === "GET" && changeMatch) {
    return { status: 200, payload: { change: findJjChange(workspace, changeMatch[1]) } };
  }

  if (method === "POST" && route === "tickets") {
    const body = bodyRecord(request.body);
    const ticketPath = ticketPathForId(workspace, body.ticketId);
    if (existsSync(ticketPath)) {
      throw new WorkspaceHttpError(409, `Ticket ${body.ticketId} already exists.`);
    }
    mkdirSync(dirname(ticketPath), { recursive: true });
    writeFileSync(ticketPath, typeof body.content === "string" ? body.content : "");
    return {
      status: 201,
      payload: { ticket: ticketFromPath(join(workspace.smithersPath, "tickets"), ticketPath) },
    };
  }

  const ticketMatch = /^tickets\/(.+)$/.exec(route);
  if (ticketMatch) {
    const ticketPath = ticketPathForId(workspace, ticketMatch[1]);
    if (!existsSync(ticketPath)) {
      throw new WorkspaceHttpError(404, `Ticket ${ticketMatch[1]} not found.`);
    }
    if (method === "PUT") {
      const body = bodyRecord(request.body);
      if (typeof body.content !== "string") {
        throw new WorkspaceHttpError(400, "content must be a string.");
      }
      writeFileSync(ticketPath, body.content);
      return { status: 200, payload: { ticket: ticketFromPath(join(workspace.smithersPath, "tickets"), ticketPath) } };
    }
    if (method === "DELETE") {
      rmSync(ticketPath, { force: true });
      return { status: 200, payload: { ok: true } };
    }
  }

  if (method === "GET" && route === "search") {
    return { status: 200, payload: { results: searchWorkspace(workspace, query) } };
  }

  if (method === "GET" && route === "approvals/history") {
    return {
      status: 200,
      payload: querySmithersDb(workspace, "approvalHistory", {
        limit: queryParam(query, "limit"),
      }),
    };
  }

  if (method === "GET" && route === "memory") {
    return {
      status: 200,
      payload: querySmithersDb(workspace, "memoryFacts", {
        namespace: queryParam(query, "namespace"),
        query: queryParam(query, "query"),
        limit: queryParam(query, "limit"),
      }),
    };
  }

  if (method === "GET" && route === "memory/recall") {
    return {
      status: 200,
      payload: querySmithersDb(workspace, "recallMemory", {
        namespace: queryParam(query, "namespace"),
        query: queryParam(query, "query"),
        topK: queryParam(query, "topK"),
      }),
    };
  }

  if (method === "GET" && route === "scores") {
    return {
      status: 200,
      payload: querySmithersDb(workspace, "scores", {
        runId: queryParam(query, "runId"),
        limit: queryParam(query, "limit"),
      }),
    };
  }

  if (method === "GET" && route === "sql/tables") {
    return { status: 200, payload: querySmithersDb(workspace, "sqlTables", {}) };
  }

  if (method === "GET" && route === "sql/schema") {
    return {
      status: 200,
      payload: querySmithersDb(workspace, "sqlSchema", {
        tableName: queryParam(query, "tableName"),
      }),
    };
  }

  if (method === "POST" && route === "sql/query") {
    const body = bodyRecord(request.body);
    return {
      status: 200,
      payload: querySmithersDb(workspace, "sqlQuery", {
        query: typeof body.query === "string" ? body.query : "",
        limit: typeof body.limit === "number" ? body.limit : 500,
      }),
    };
  }

  throw new WorkspaceHttpError(404, `Unknown workspace API route: ${method} ${route}`);
}
