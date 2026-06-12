import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  watch as nodeWatch,
  type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExternalInstructionsSettings } from "../shared/agent-settings";

export type SourceInvalidationDomain =
  | "agent-settings"
  | "extensions"
  | "external-instructions"
  | "snippets"
  | "workflows";

export interface SourceWatchInput {
  domain: SourceInvalidationDomain;
  path: string;
  kind: "directory" | "file";
  recursive?: boolean;
  includeExtensions?: readonly string[];
  includeBasenames?: readonly string[];
  watchWhenMissing?: boolean;
}

export interface SourceInvalidationEvent {
  domains: SourceInvalidationDomain[];
  reason: string;
  sourceFingerprints: Record<SourceInvalidationDomain, string>;
}

type SourceWatcher = (
  path: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => Pick<FSWatcher, "close">;

export interface SourceInvalidationCoordinator {
  close(): void;
  refreshWatchedInputs(reason?: string): void;
  requestScan(reason: string): void;
}

export function createSourceInvalidationCoordinator(input: {
  debounceMs?: number;
  reconciliationIntervalMs?: number;
  readInputs: () => readonly SourceWatchInput[];
  onDomainsChanged: (event: SourceInvalidationEvent) => void | Promise<void>;
  onWatchError?: (error: unknown, path: string) => void;
  watch?: SourceWatcher;
  watchEnabled?: boolean;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}): SourceInvalidationCoordinator {
  const debounceMs = input.debounceMs ?? 200;
  const reconciliationIntervalMs = input.reconciliationIntervalMs ?? 5_000;
  const watchEnabled = input.watchEnabled ?? true;
  const watch = input.watch ?? defaultWatch;
  const setTimeoutFn = input.setTimeout ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeout ?? globalThis.clearTimeout;
  const setIntervalFn = input.setInterval ?? globalThis.setInterval;
  const clearIntervalFn = input.clearInterval ?? globalThis.clearInterval;
  let closed = false;
  let running = false;
  let rerunReason: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeoutFn> | null = null;
  let reconciliationTimer: ReturnType<typeof setIntervalFn> | null = null;
  let watchers: Array<Pick<FSWatcher, "close">> = [];
  let watchedPaths = new Set<string>();
  let currentInputs = normalizeInputs(input.readInputs());
  let fingerprints = fingerprintDomains(currentInputs);

  const closeWatchers = (): void => {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // Closing a watcher is best-effort during runtime shutdown.
      }
    }
    watchers = [];
    watchedPaths = new Set();
  };

  const installWatchers = (): void => {
    closeWatchers();
    if (!watchEnabled) return;
    const paths = new Set<string>();
    for (const watchInput of currentInputs) {
      for (const path of watchPathsForInput(watchInput)) {
        paths.add(path);
      }
    }
    for (const path of [...paths].toSorted()) {
      try {
        const watcher = watch(path, () => scheduleScan("filesystem_event"));
        watchers.push(watcher);
        watchedPaths.add(path);
      } catch (error) {
        input.onWatchError?.(error, path);
      }
    }
  };

  const scheduleScan = (reason: string): void => {
    if (closed) return;
    if (debounceTimer) {
      clearTimeoutFn(debounceTimer);
    }
    debounceTimer = setTimeoutFn(() => {
      debounceTimer = null;
      void scan(reason);
    }, debounceMs);
  };

  const scan = async (reason: string): Promise<void> => {
    if (closed) return;
    if (running) {
      rerunReason = reason;
      return;
    }
    running = true;
    try {
      const nextInputs = normalizeInputs(input.readInputs());
      const nextWatchPaths = new Set(
        nextInputs.flatMap((watchInput) => watchPathsForInput(watchInput)),
      );
      const watchersChanged =
        nextWatchPaths.size !== watchedPaths.size ||
        [...nextWatchPaths].some((path) => !watchedPaths.has(path));
      currentInputs = nextInputs;
      if (watchersChanged) {
        installWatchers();
      }
      const nextFingerprints = fingerprintDomains(currentInputs);
      const domains = (Object.keys(nextFingerprints) as SourceInvalidationDomain[]).filter(
        (domain) => nextFingerprints[domain] !== fingerprints[domain],
      );
      fingerprints = nextFingerprints;
      if (domains.length > 0) {
        await input.onDomainsChanged({
          domains,
          reason,
          sourceFingerprints: nextFingerprints,
        });
      }
    } finally {
      running = false;
      if (rerunReason && !closed) {
        const nextReason = rerunReason;
        rerunReason = null;
        void scan(nextReason);
      }
    }
  };

  installWatchers();
  if (reconciliationIntervalMs > 0) {
    reconciliationTimer = setIntervalFn(
      () => scheduleScan("periodic_reconciliation"),
      reconciliationIntervalMs,
    );
  }

  return {
    close: () => {
      closed = true;
      if (debounceTimer) {
        clearTimeoutFn(debounceTimer);
      }
      if (reconciliationTimer) {
        clearIntervalFn(reconciliationTimer);
      }
      closeWatchers();
    },
    refreshWatchedInputs: (reason = "watched_inputs_changed") => {
      if (closed) return;
      currentInputs = normalizeInputs(input.readInputs());
      installWatchers();
      scheduleScan(reason);
    },
    requestScan: scheduleScan,
  };
}

export function buildSourceWatchInputs(input: {
  agentDir: string;
  cwdByWorkspaceId: ReadonlyMap<string, string>;
  externalInstructionsByWorkspaceId?: ReadonlyMap<string, ExternalInstructionsSettings>;
  extensionsRoot: string;
  workflowsSourceRoot: string;
}): SourceWatchInput[] {
  const inputs: SourceWatchInput[] = [
    {
      domain: "agent-settings",
      kind: "file",
      path: join(input.agentDir, "agent-settings.json"),
    },
    ...["agents", "prompts", "components", "workflows"].map(
      (directory): SourceWatchInput => ({
        domain: "workflows",
        kind: "directory",
        path: join(input.workflowsSourceRoot, directory),
        recursive: true,
      }),
    ),
    {
      domain: "extensions",
      kind: "directory",
      path: join(input.extensionsRoot, "sources", "user"),
      recursive: true,
    },
    {
      domain: "extensions",
      kind: "directory",
      path: join(input.extensionsRoot, "sources", "builtin-overlays"),
      recursive: true,
    },
    {
      domain: "extensions",
      kind: "file",
      path: join(input.extensionsRoot, "package", "package.json"),
    },
    {
      domain: "snippets",
      kind: "directory",
      path: join(homedir(), ".claude", "commands"),
      recursive: true,
      includeExtensions: [".md"],
    },
    {
      domain: "snippets",
      kind: "directory",
      path: join(homedir(), ".pi", "agent", "prompts"),
      includeExtensions: [".md"],
    },
  ];

  for (const [workspaceId, cwd] of input.cwdByWorkspaceId) {
    const settings = input.externalInstructionsByWorkspaceId?.get(workspaceId);
    inputs.push(
      {
        domain: "snippets",
        kind: "file",
        path: join(workspaceSessionDir(input.agentDir, cwd), "snippets.json"),
      },
      {
        domain: "snippets",
        kind: "directory",
        path: join(cwd, ".claude", "commands"),
        recursive: true,
        includeExtensions: [".md"],
      },
      {
        domain: "snippets",
        kind: "directory",
        path: join(cwd, ".pi", "prompts"),
        includeExtensions: [".md"],
      },
      ...externalInstructionInputs(cwd, settings),
    );
  }

  return inputs;
}

function fingerprintDomains(
  inputs: readonly SourceWatchInput[],
): Record<SourceInvalidationDomain, string> {
  const byDomain: Record<SourceInvalidationDomain, string[]> = {
    "agent-settings": [],
    extensions: [],
    "external-instructions": [],
    snippets: [],
    workflows: [],
  };
  for (const input of inputs) {
    byDomain[input.domain].push(fingerprintInput(input));
  }
  return Object.fromEntries(
    Object.entries(byDomain).map(([domain, parts]) => [domain, hashStrings(parts.toSorted())]),
  ) as Record<SourceInvalidationDomain, string>;
}

function fingerprintInput(input: SourceWatchInput): string {
  if (input.kind === "file") {
    return fingerprintFile(input.path);
  }
  return hashStrings(
    listFingerprintedFiles(input.path, input)
      .map((path) => fingerprintFile(path))
      .toSorted(),
  );
}

function fingerprintFile(path: string): string {
  try {
    if (!existsSync(path)) return `missing:${path}`;
    const stat = statSync(path);
    if (!stat.isFile()) return `not_file:${path}`;
    return `file:${path}:${hashStrings([readFileSync(path, "utf8")])}`;
  } catch (error) {
    return `unreadable:${path}:${error instanceof Error ? error.message : "unknown"}`;
  }
}

function listFingerprintedFiles(root: string, input: SourceWatchInput): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (input.recursive) {
        files.push(...listFingerprintedFiles(path, input));
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (
      input.includeExtensions?.length &&
      !input.includeExtensions.some((ext) => path.endsWith(ext))
    ) {
      continue;
    }
    if (input.includeBasenames?.length && !input.includeBasenames.includes(entry.name)) {
      continue;
    }
    files.push(path);
  }
  return files;
}

function watchPathsForInput(input: SourceWatchInput): string[] {
  if (input.kind === "file" && input.watchWhenMissing === false && !existsSync(input.path)) {
    return [];
  }
  const root = input.kind === "file" ? dirname(input.path) : input.path;
  const watchRoot = nearestExistingDirectory(root);
  if (!watchRoot) return [];
  const paths = new Set([watchRoot]);
  if (input.kind === "directory" && input.recursive && existsSync(input.path)) {
    for (const directory of listDirectories(input.path)) {
      paths.add(directory);
    }
  }
  return [...paths];
}

function listDirectories(root: string): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const directories = [root];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      directories.push(...listDirectories(join(root, entry.name)));
    }
  }
  return directories;
}

function nearestExistingDirectory(path: string): string | null {
  let current = resolve(path);
  while (true) {
    try {
      if (existsSync(current) && statSync(current).isDirectory()) {
        return current;
      }
    } catch {
      return null;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeInputs(inputs: readonly SourceWatchInput[]): SourceWatchInput[] {
  const seen = new Set<string>();
  const normalized: SourceWatchInput[] = [];
  for (const input of inputs) {
    const item = {
      ...input,
      path: resolve(expandHome(input.path)),
      includeBasenames: input.includeBasenames ? [...input.includeBasenames].toSorted() : undefined,
      includeExtensions: input.includeExtensions
        ? [...input.includeExtensions].toSorted()
        : undefined,
    };
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized.toSorted(
    (left, right) => left.domain.localeCompare(right.domain) || left.path.localeCompare(right.path),
  );
}

function externalInstructionInputs(
  cwd: string,
  settings: ExternalInstructionsSettings | undefined,
): SourceWatchInput[] {
  const inputs: SourceWatchInput[] = [];
  const globalRoots = settings?.globalRoots ?? [];
  for (const root of globalRoots) {
    if (!root.enabled) continue;
    inputs.push(...externalInstructionDirectoryInputs(root.path));
  }
  let current = resolve(cwd);
  while (true) {
    inputs.push(...externalInstructionDirectoryInputs(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return inputs;
}

function externalInstructionDirectoryInputs(directory: string): SourceWatchInput[] {
  return ["AGENTS.md", "CLAUDE.md"].map((fileName) => ({
    domain: "external-instructions",
    kind: "file",
    path: join(expandHome(directory), fileName),
    watchWhenMissing: false,
  }));
}

function workspaceSessionDir(agentDir: string, cwd: string): string {
  return join(agentDir, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
}

function hashStrings(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function defaultWatch(
  path: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
): Pick<FSWatcher, "close"> {
  const watcher = nodeWatch(path, listener);
  watcher.on("error", () => {});
  return watcher;
}
