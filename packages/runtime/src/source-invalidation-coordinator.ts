import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type { SourceDomain } from "@svvy/core";

export type SourceInvalidationDomain = SourceDomain;

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

export interface SourceInvalidationDirectoryEntry {
  name: string;
  kind: "directory" | "file" | "other";
}

export interface SourceInvalidationHost {
  homeDir: string;
  path: {
    dirname(path: string): string;
    join(...parts: string[]): string;
    resolve(path: string): string;
  };
  fileSystem: {
    exists(path: string): boolean;
    isDirectory(path: string): boolean;
    isFile(path: string): boolean;
    readDirectory(path: string): readonly SourceInvalidationDirectoryEntry[];
    readFileString(path: string): string;
  };
  hashStrings(parts: readonly string[]): string;
  watch: SourceWatcher;
}

export type SourceWatcher = (
  path: string,
  listener: (eventType: string, filename: string | Buffer | null) => Effect.Effect<void>,
) => { close(): void };

export interface SourceInvalidationCoordinator {
  close(): Effect.Effect<void>;
  refreshWatchedInputs(reason?: string): Effect.Effect<void>;
  requestScan(reason: string): Effect.Effect<void>;
  start(): Effect.Effect<void>;
}

export interface ExternalInstructionRootInput {
  enabled: boolean;
  path: string;
}

export interface ExternalInstructionsWatchSettings {
  globalRoots?: readonly ExternalInstructionRootInput[];
}

export interface SourceInvalidationCoordinatorOptions {
  debounceMs?: number;
  host: SourceInvalidationHost;
  reconciliationIntervalMs?: number;
  readInputs: () => readonly SourceWatchInput[];
  onDomainsChanged: (event: SourceInvalidationEvent) => Effect.Effect<void>;
  onWatchError?: (error: unknown, path: string) => void;
  watchEnabled?: boolean;
}

export type RuntimeSourceInvalidationCoordinatorService = SourceInvalidationCoordinator;

export class RuntimeSourceInvalidationCoordinator extends Context.Service<
  RuntimeSourceInvalidationCoordinator,
  RuntimeSourceInvalidationCoordinatorService
>()("@svvy/runtime/RuntimeSourceInvalidationCoordinator") {}

export function makeRuntimeSourceInvalidationCoordinator(
  options: SourceInvalidationCoordinatorOptions,
) {
  return Effect.acquireRelease(
    Effect.sync(() => createSourceInvalidationCoordinator(options)).pipe(
      Effect.tap((coordinator) => coordinator.start()),
    ),
    (coordinator) => coordinator.close(),
  );
}

export function layerRuntimeSourceInvalidationCoordinator(
  options: SourceInvalidationCoordinatorOptions,
) {
  return Layer.effect(
    RuntimeSourceInvalidationCoordinator,
    makeRuntimeSourceInvalidationCoordinator(options),
  );
}

export function createSourceInvalidationCoordinator(
  input: SourceInvalidationCoordinatorOptions,
): SourceInvalidationCoordinator {
  const debounceMs = input.debounceMs ?? 200;
  const reconciliationIntervalMs = input.reconciliationIntervalMs ?? 5_000;
  const watchEnabled = input.watchEnabled ?? true;
  const host = input.host;
  let closed = false;
  let running = false;
  let rerunReason: string | null = null;
  let debounceVersion = 0;
  let watchers: Array<{ close(): void }> = [];
  let watchedPaths = new Set<string>();
  let currentInputs = normalizeInputs(input.readInputs(), host);
  let fingerprints = fingerprintDomains(currentInputs, host);
  const timerScope = Scope.makeUnsafe("sequential");

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
      for (const path of watchPathsForInput(watchInput, host)) {
        paths.add(path);
      }
    }
    for (const path of [...paths].toSorted()) {
      try {
        const watcher = host.watch(path, () => scheduleScan("filesystem_event"));
        watchers.push(watcher);
        watchedPaths.add(path);
      } catch (error) {
        input.onWatchError?.(error, path);
      }
    }
  };

  const scheduleScan = Effect.fn("@svvy/runtime/sourceInvalidation.scheduleScan")(function* (
    reason: string,
  ): Effect.fn.Return<void> {
    if (closed) {
      return;
    }
    const timerVersion = ++debounceVersion;
    yield* Effect.sleep(debounceMs).pipe(
      Effect.flatMap(() => (timerVersion === debounceVersion ? scan(reason) : Effect.void)),
      Effect.forkIn(timerScope),
      Effect.asVoid,
    );
  });

  const scan = Effect.fn("@svvy/runtime/sourceInvalidation.scan")(function* (
    reason: string,
  ): Effect.fn.Return<void> {
    if (closed) {
      return;
    }
    if (running) {
      rerunReason = reason;
      return;
    }
    running = true;
    try {
      const nextInputs = normalizeInputs(input.readInputs(), host);
      const nextWatchPaths = new Set(
        nextInputs.flatMap((watchInput) => watchPathsForInput(watchInput, host)),
      );
      const watchersChanged =
        nextWatchPaths.size !== watchedPaths.size ||
        [...nextWatchPaths].some((path) => !watchedPaths.has(path));
      currentInputs = nextInputs;
      if (watchersChanged) {
        installWatchers();
      }
      const nextFingerprints = fingerprintDomains(currentInputs, host);
      const domains = (Object.keys(nextFingerprints) as SourceInvalidationDomain[]).filter(
        (domain) => nextFingerprints[domain] !== fingerprints[domain],
      );
      fingerprints = nextFingerprints;
      if (domains.length > 0) {
        yield* input.onDomainsChanged({
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
        yield* scan(nextReason);
      }
    }
  });

  const runPeriodicReconciliation = Effect.fn(
    "@svvy/runtime/sourceInvalidation.periodicReconciliation",
  )(function* (): Effect.fn.Return<void> {
    if (reconciliationIntervalMs <= 0) {
      return;
    }
    while (true) {
      if (closed) {
        return;
      }
      yield* Effect.sleep(reconciliationIntervalMs);
      if (closed) {
        return;
      }
      yield* scheduleScan("periodic_reconciliation");
    }
  });

  installWatchers();

  return {
    close: () =>
      Effect.gen(function* () {
        closed = true;
        closeWatchers();
        yield* Scope.close(timerScope, Exit.void).pipe(Effect.ignore);
      }),
    refreshWatchedInputs: (reason = "watched_inputs_changed") =>
      Effect.gen(function* () {
        if (closed) return;
        currentInputs = normalizeInputs(input.readInputs(), host);
        installWatchers();
        yield* scheduleScan(reason);
      }),
    requestScan: scheduleScan,
    start: () =>
      Effect.gen(function* () {
        yield* scan("startup_reconcile");
        if (reconciliationIntervalMs > 0) {
          yield* runPeriodicReconciliation().pipe(Effect.forkIn(timerScope), Effect.asVoid);
        }
      }),
  };
}

export function buildAppGlobalSourceWatchInputs(input: {
  extensionsRoot: string;
  host: Pick<SourceInvalidationHost, "path">;
  workflowsSourceRoot: string;
}): SourceWatchInput[] {
  const { host } = input;
  return [
    ...["agents", "prompts", "components", "workflows"].map(
      (directory): SourceWatchInput => ({
        domain: "workflows",
        kind: "directory",
        path: host.path.join(input.workflowsSourceRoot, directory),
        recursive: true,
      }),
    ),
    {
      domain: "extensions",
      kind: "directory",
      path: host.path.join(input.extensionsRoot, "sources", "user"),
      recursive: true,
    },
    {
      domain: "extensions",
      kind: "directory",
      path: host.path.join(input.extensionsRoot, "sources", "builtin"),
      recursive: true,
    },
    {
      domain: "extensions",
      kind: "file",
      path: host.path.join(input.extensionsRoot, "package", "package.json"),
    },
  ];
}

export function buildWorkspaceSourceWatchInputs(input: {
  cwd: string;
  externalInstructions?: ExternalInstructionsWatchSettings;
  host: Pick<SourceInvalidationHost, "homeDir" | "path">;
}): SourceWatchInput[] {
  const { host } = input;
  return [
    {
      domain: "host_snippets",
      kind: "directory",
      path: host.path.join(host.homeDir, ".claude", "commands"),
      recursive: true,
      includeExtensions: [".md"],
    },
    {
      domain: "host_snippets",
      kind: "directory",
      path: host.path.join(host.homeDir, ".pi", "agent", "prompts"),
      includeExtensions: [".md"],
    },
    {
      domain: "host_snippets",
      kind: "directory",
      path: host.path.join(input.cwd, ".claude", "commands"),
      recursive: true,
      includeExtensions: [".md"],
    },
    {
      domain: "host_snippets",
      kind: "directory",
      path: host.path.join(input.cwd, ".pi", "prompts"),
      includeExtensions: [".md"],
    },
    ...externalInstructionInputs(input.cwd, input.externalInstructions, host),
  ];
}

function fingerprintDomains(
  inputs: readonly SourceWatchInput[],
  host: SourceInvalidationHost,
): Record<SourceInvalidationDomain, string> {
  const byDomain: Record<SourceInvalidationDomain, string[]> = {
    extensions: [],
    external_instructions: [],
    host_snippets: [],
    workflows: [],
  };
  for (const input of inputs) {
    byDomain[input.domain].push(fingerprintInput(input, host));
  }
  return Object.fromEntries(
    Object.entries(byDomain).map(([domain, parts]) => [domain, host.hashStrings(parts.toSorted())]),
  ) as Record<SourceInvalidationDomain, string>;
}

function fingerprintInput(input: SourceWatchInput, host: SourceInvalidationHost): string {
  if (input.kind === "file") {
    return fingerprintFile(input.path, host);
  }
  return host.hashStrings(
    listFingerprintedFiles(input.path, input, host)
      .map((path) => fingerprintFile(path, host))
      .toSorted(),
  );
}

function fingerprintFile(path: string, host: SourceInvalidationHost): string {
  try {
    if (!host.fileSystem.exists(path)) return `missing:${path}`;
    if (!host.fileSystem.isFile(path)) return `not_file:${path}`;
    return `file:${path}:${host.hashStrings([host.fileSystem.readFileString(path)])}`;
  } catch (error) {
    return `unreadable:${path}:${error instanceof Error ? error.message : "unknown"}`;
  }
}

function listFingerprintedFiles(
  root: string,
  input: SourceWatchInput,
  host: SourceInvalidationHost,
): string[] {
  let entries;
  try {
    entries = host.fileSystem.readDirectory(root);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = host.path.join(root, entry.name);
    if (entry.kind === "directory") {
      if (input.recursive) {
        files.push(...listFingerprintedFiles(path, input, host));
      }
      continue;
    }
    if (entry.kind !== "file") continue;
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

function watchPathsForInput(input: SourceWatchInput, host: SourceInvalidationHost): string[] {
  if (
    input.kind === "file" &&
    input.watchWhenMissing === false &&
    !host.fileSystem.exists(input.path)
  ) {
    return [];
  }
  const root = input.kind === "file" ? host.path.dirname(input.path) : input.path;
  const watchRoot = nearestExistingDirectory(root, host);
  if (!watchRoot) return [];
  const paths = new Set([watchRoot]);
  if (input.kind === "directory" && input.recursive && host.fileSystem.exists(input.path)) {
    for (const directory of listDirectories(input.path, host)) {
      paths.add(directory);
    }
  }
  return [...paths];
}

function listDirectories(root: string, host: SourceInvalidationHost): string[] {
  let entries;
  try {
    entries = host.fileSystem.readDirectory(root);
  } catch {
    return [];
  }
  const directories = [root];
  for (const entry of entries) {
    if (entry.kind === "directory") {
      directories.push(...listDirectories(host.path.join(root, entry.name), host));
    }
  }
  return directories;
}

function nearestExistingDirectory(path: string, host: SourceInvalidationHost): string | null {
  let current = host.path.resolve(path);
  while (true) {
    try {
      if (host.fileSystem.exists(current) && host.fileSystem.isDirectory(current)) {
        return current;
      }
    } catch {
      return null;
    }
    const parent = host.path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeInputs(
  inputs: readonly SourceWatchInput[],
  host: Pick<SourceInvalidationHost, "homeDir" | "path">,
): SourceWatchInput[] {
  const seen = new Set<string>();
  const normalized: SourceWatchInput[] = [];
  for (const input of inputs) {
    const item: SourceWatchInput = {
      domain: input.domain,
      kind: input.kind,
      path: host.path.resolve(expandHome(input.path, host)),
    };
    if (input.recursive !== undefined) item.recursive = input.recursive;
    if (input.watchWhenMissing !== undefined) item.watchWhenMissing = input.watchWhenMissing;
    if (input.includeBasenames) item.includeBasenames = [...input.includeBasenames].toSorted();
    if (input.includeExtensions) item.includeExtensions = [...input.includeExtensions].toSorted();
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
  settings: ExternalInstructionsWatchSettings | undefined,
  host: Pick<SourceInvalidationHost, "homeDir" | "path">,
): SourceWatchInput[] {
  const inputs: SourceWatchInput[] = [];
  const globalRoots = settings?.globalRoots ?? [];
  for (const root of globalRoots) {
    if (!root.enabled) continue;
    inputs.push(...externalInstructionDirectoryInputs(root.path, host));
  }
  let current = host.path.resolve(cwd);
  while (true) {
    inputs.push(...externalInstructionDirectoryInputs(current, host));
    const parent = host.path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return inputs;
}

function externalInstructionDirectoryInputs(
  directory: string,
  host: Pick<SourceInvalidationHost, "homeDir" | "path">,
): SourceWatchInput[] {
  return ["AGENTS.md", "CLAUDE.md"].map((fileName) => ({
    domain: "external_instructions",
    kind: "file",
    path: host.path.join(expandHome(directory, host), fileName),
    watchWhenMissing: false,
  }));
}

function expandHome(path: string, host: Pick<SourceInvalidationHost, "homeDir" | "path">): string {
  return path === "~" || path.startsWith("~/") ? host.path.join(host.homeDir, path.slice(2)) : path;
}
