import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import { RuntimeContractError, StateContractError } from "@svvy/core";
import type {
  AbsolutePath,
  RecordRuntimeSourceScanInput,
  RuntimeSourceStatePortService,
  SourceDomain,
  SourceInvalidationHint,
  SourceInvalidationScope,
  StateInvalidationDescriptor,
} from "@svvy/core";

export type SourceInvalidationDomain = SourceDomain;

export interface SourceWatchInput {
  domain: SourceInvalidationDomain;
  path: string;
  kind: "directory" | "file";
  fingerprintChildDirectories?: boolean;
  recursive?: boolean;
  includeExtensions?: readonly string[];
  includeBasenames?: readonly string[];
  watchWhenMissing?: boolean;
}

export interface SourceInvalidationEvent {
  readonly domains: readonly SourceInvalidationDomain[];
  readonly reason: string;
  readonly sourceFingerprints: Readonly<Record<SourceInvalidationDomain, string>>;
  readonly afterCommit: readonly StateInvalidationDescriptor[];
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
    realPath(path: string): string | null;
  };
  hashStrings(parts: readonly string[]): string;
  watch: SourceWatcher;
}

export type SourceWatcher = (
  path: string,
  listener: (eventType: string, filename: string | Buffer | null) => Effect.Effect<void>,
) => { close(): void };

export type SourceInvalidationHintClassification = "scan" | "scan-parent-domain" | "ignore";

export interface SourceInvalidationScanRequest {
  readonly domains?: readonly SourceInvalidationDomain[];
  readonly reason: string;
}

export interface SourceInvalidationCoordinator {
  classifyHint(
    input: SourceInvalidationHint,
  ): Effect.Effect<SourceInvalidationHintClassification, RuntimeContractError>;
  close(): Effect.Effect<void>;
  reconcile(input: {
    domains?: readonly SourceInvalidationDomain[];
    reason: string;
  }): Effect.Effect<SourceInvalidationEvent | null>;
  refreshWatchedInputs(reason?: string): Effect.Effect<void>;
  requestScan(input: string | SourceInvalidationScanRequest): Effect.Effect<void>;
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
  maxCoalescingLatencyMs?: number;
  reconciliationIntervalMs?: number;
  readInputs: () => readonly SourceWatchInput[];
  onDomainsChanged: (event: SourceInvalidationEvent) => Effect.Effect<void>;
  onWatchError?: (error: unknown, path: string) => void;
  retryInitialDelayMs?: number;
  retryMaxAttempts?: number;
  retryMaxDelayMs?: number;
  sourceScanRecorder?: {
    scope: SourceInvalidationScope;
    statePort: Pick<RuntimeSourceStatePortService, "recordSourceScan">;
  };
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
  return Effect.gen(function* () {
    const parentScope = yield* Scope.Scope;
    const timerScope = yield* Scope.fork(parentScope, "sequential");
    return yield* Effect.acquireRelease(
      Effect.sync(() => createSourceInvalidationCoordinator({ ...options, timerScope })).pipe(
        Effect.tap((coordinator) => coordinator.start()),
      ),
      (coordinator) => coordinator.close(),
    );
  });
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
  input: SourceInvalidationCoordinatorOptions & { timerScope: Scope.Scope },
): SourceInvalidationCoordinator {
  const debounceMs = input.debounceMs ?? 250;
  const maxCoalescingLatencyMs = input.maxCoalescingLatencyMs ?? 2_000;
  const reconciliationIntervalMs = input.reconciliationIntervalMs ?? 60_000;
  const retryInitialDelayMs = input.retryInitialDelayMs ?? 500;
  const retryMaxDelayMs = input.retryMaxDelayMs ?? 10_000;
  const retryMaxAttempts = input.retryMaxAttempts ?? 5;
  const watchEnabled = input.watchEnabled ?? true;
  const host = input.host;
  let closed = false;
  let running = false;
  let rerunReason: string | null = null;
  let debounceVersion = 0;
  let pendingScan: ({ id: number } & SourceInvalidationScanRequest) | null = null;
  let pendingScanId = 0;
  let watchers: Array<{ close(): void }> = [];
  let watchedPaths = new Set<string>();
  let currentInputs = normalizeInputs(input.readInputs(), host);
  let fingerprints = startupSourceFingerprints(currentInputs, host);
  const timerScope = input.timerScope;

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
        const watcher = host.watch(path, (_eventType, filename) => {
          const reason = watcherEventScanReason(path, filename, currentInputs, host);
          return reason ? scheduleScan(reason) : Effect.void;
        });
        watchers.push(watcher);
        watchedPaths.add(path);
      } catch (error) {
        input.onWatchError?.(error, path);
      }
    }
  };

  const scheduleScan = Effect.fn("@svvy/runtime/sourceInvalidation.scheduleScan")(function* (
    requestInput: string | SourceInvalidationScanRequest,
  ): Effect.fn.Return<void> {
    if (closed) {
      return;
    }
    const request =
      typeof requestInput === "string"
        ? { reason: requestInput }
        : normalizeScanRequest(requestInput);
    if (!pendingScan) {
      pendingScan = { id: ++pendingScanId, ...request };
      const pendingId = pendingScan.id;
      yield* Effect.sleep(maxCoalescingLatencyMs).pipe(
        Effect.flatMap(() =>
          pendingScan?.id === pendingId ? flushPendingScan(pendingScan) : Effect.void,
        ),
        Effect.forkIn(timerScope),
        Effect.asVoid,
      );
    } else {
      pendingScan = mergePendingScanRequest(pendingScan, request);
    }
    const timerVersion = ++debounceVersion;
    const pendingId = pendingScan.id;
    yield* Effect.sleep(debounceMs).pipe(
      Effect.flatMap(() =>
        pendingScan?.id === pendingId && timerVersion === debounceVersion
          ? flushPendingScan(pendingScan)
          : Effect.void,
      ),
      Effect.forkIn(timerScope),
      Effect.asVoid,
    );
  });

  const flushPendingScan = Effect.fn("@svvy/runtime/sourceInvalidation.flushPendingScan")(
    function* (request: SourceInvalidationScanRequest): Effect.fn.Return<void> {
      if (!pendingScan || closed) {
        return;
      }
      pendingScan = null;
      debounceVersion += 1;
      yield* scan(request.reason, request.domains ? { domains: request.domains } : {});
    },
  );

  const scan = Effect.fn("@svvy/runtime/sourceInvalidation.scan")(function* (
    reason: string,
    options: {
      readonly domains?: readonly SourceInvalidationDomain[];
      readonly notify?: boolean;
    } = {},
  ): Effect.fn.Return<SourceInvalidationEvent | null> {
    if (closed) {
      return null;
    }
    if (running) {
      rerunReason = reason;
      return null;
    }
    running = true;
    try {
      const requestedDomains = options.domains ? new Set(options.domains) : null;
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
      const nextSourceRoots = fingerprintSourceRoots(currentInputs, host);
      const domains = (Object.keys(nextFingerprints) as SourceInvalidationDomain[]).filter(
        (domain) =>
          (!requestedDomains || requestedDomains.has(domain)) &&
          nextFingerprints[domain] !== fingerprints[domain],
      );
      if (domains.length > 0) {
        const afterCommit: StateInvalidationDescriptor[] = [];
        const acceptedDomains: SourceInvalidationDomain[] = [];
        for (const domain of domains) {
          let scanCommitted = true;
          if (input.sourceScanRecorder) {
            const scannedAt = DateTime.formatIso(yield* DateTime.now);
            const recordSourceScan = input.sourceScanRecorder.statePort.recordSourceScan({
              scope: input.sourceScanRecorder.scope,
              domain,
              sourceFingerprint: nextFingerprints[domain],
              sourceRoots: nextSourceRoots[domain],
              diagnostics: [],
              scannedAt: scannedAt as RecordRuntimeSourceScanInput["scannedAt"],
            });
            const retriedRecordSourceScan =
              retryMaxAttempts > 0
                ? recordSourceScan.pipe(
                    Effect.retry({
                      times: retryMaxAttempts,
                      while: isRetryableSourceScanStateError,
                      schedule: Schedule.exponential(retryInitialDelayMs).pipe(
                        Schedule.modifyDelay((_, delay) =>
                          Effect.succeed(Duration.min(delay, Duration.millis(retryMaxDelayMs))),
                        ),
                      ),
                    }),
                  )
                : recordSourceScan;
            const result = yield* retriedRecordSourceScan.pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  input.onWatchError?.(error, `source-scan:${domain}`);
                  return null;
                }),
              ),
            );
            if (result) {
              afterCommit.push(...result.afterCommit);
            } else {
              scanCommitted = false;
            }
          }
          if (scanCommitted) {
            acceptedDomains.push(domain);
          }
        }
        if (acceptedDomains.length === 0) {
          return null;
        }
        const event = {
          domains: acceptedDomains,
          reason,
          sourceFingerprints: nextFingerprints,
          afterCommit,
        } satisfies SourceInvalidationEvent;
        if (options.notify ?? true) {
          const notified = yield* input.onDomainsChanged(event).pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                input.onWatchError?.(
                  Cause.squash(cause),
                  `source-notification:${acceptedDomains.join(",")}`,
                );
                return false;
              }),
            ),
          );
          if (!notified) {
            return null;
          }
        }
        fingerprints = requestedDomains
          ? {
              ...fingerprints,
              ...Object.fromEntries(
                acceptedDomains.map((domain) => [domain, nextFingerprints[domain]]),
              ),
            }
          : {
              ...fingerprints,
              ...Object.fromEntries(
                acceptedDomains.map((domain) => [domain, nextFingerprints[domain]]),
              ),
            };
        return event;
      }
      fingerprints = requestedDomains
        ? {
            ...fingerprints,
            ...Object.fromEntries(
              [...requestedDomains].map((domain) => [domain, nextFingerprints[domain]]),
            ),
          }
        : nextFingerprints;
      return null;
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
      yield* scan("periodic_reconciliation");
    }
  });

  installWatchers();

  return {
    classifyHint: (hint) =>
      Effect.try({
        try: () => classifySourceInvalidationHint(hint, currentInputs, host),
        catch: (cause) =>
          cause instanceof RuntimeContractError
            ? cause
            : new RuntimeContractError({
                operation: "runtime.sourceInvalidation.hint",
                reason: "state-conflict",
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Source invalidation hint classification failed.",
                cause,
              }),
      }),
    close: () =>
      Effect.gen(function* () {
        closed = true;
        closeWatchers();
        yield* Scope.close(timerScope, Exit.void).pipe(Effect.ignore);
      }),
    reconcile: (request) =>
      scan(request.reason, {
        ...(request.domains ? { domains: request.domains } : {}),
        notify: false,
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

function isRetryableSourceScanStateError(error: StateContractError): boolean {
  return (
    error.reason === "transaction-failed" ||
    error.reason === "conflict" ||
    error.reason === "stale-state" ||
    error.reason === "claim-conflict"
  );
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

function fingerprintSourceRoots(
  inputs: readonly SourceWatchInput[],
  host: SourceInvalidationHost,
): Record<SourceInvalidationDomain, NonNullable<RecordRuntimeSourceScanInput["sourceRoots"]>> {
  type SourceRootFingerprint = NonNullable<RecordRuntimeSourceScanInput["sourceRoots"]>[number];
  const byDomain: Record<SourceInvalidationDomain, SourceRootFingerprint[]> = {
    extensions: [],
    external_instructions: [],
    host_snippets: [],
    workflows: [],
  };
  for (const input of inputs) {
    const rootInputs = input.fingerprintChildDirectories
      ? childDirectorySourceRootInputs(input, host)
      : [input];
    for (const rootInput of rootInputs) {
      byDomain[input.domain].push({
        sourceRoot: rootInput.path as AbsolutePath,
        rootFingerprint: sourceRootBuildFingerprint(rootInput.path, host),
      });
    }
  }
  return {
    extensions: byDomain.extensions.toSorted((left, right) =>
      left.sourceRoot.localeCompare(right.sourceRoot),
    ),
    external_instructions: byDomain.external_instructions.toSorted((left, right) =>
      left.sourceRoot.localeCompare(right.sourceRoot),
    ),
    host_snippets: byDomain.host_snippets.toSorted((left, right) =>
      left.sourceRoot.localeCompare(right.sourceRoot),
    ),
    workflows: byDomain.workflows.toSorted((left, right) =>
      left.sourceRoot.localeCompare(right.sourceRoot),
    ),
  };
}

function childDirectorySourceRootInputs(
  input: SourceWatchInput,
  host: SourceInvalidationHost,
): SourceWatchInput[] {
  if (input.kind !== "directory" || !host.fileSystem.exists(input.path)) {
    return [];
  }
  let entries: readonly SourceInvalidationDirectoryEntry[];
  try {
    entries = host.fileSystem.readDirectory(input.path);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.kind === "directory")
    .map((entry) => ({
      ...input,
      fingerprintChildDirectories: false,
      path: host.path.join(input.path, entry.name),
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function sourceRootBuildFingerprint(sourceRoot: string, host: SourceInvalidationHost): string {
  const files = listFingerprintedFiles(
    sourceRoot,
    { domain: "extensions", kind: "directory", path: sourceRoot, recursive: true },
    host,
  );
  const parts: string[] = [];
  for (const file of files.toSorted((left, right) => left.localeCompare(right))) {
    parts.push(file.slice(sourceRoot.length + 1));
    parts.push(host.fileSystem.readFileString(file));
  }
  return host.hashStrings(parts);
}

function startupSourceFingerprints(
  inputs: readonly SourceWatchInput[],
  host: SourceInvalidationHost,
): Record<SourceInvalidationDomain, string> {
  const fingerprints = fingerprintDomains([], host);
  for (const input of inputs) {
    fingerprints[input.domain] = "startup_unknown";
  }
  return fingerprints;
}

function normalizeScanRequest(input: SourceInvalidationScanRequest): SourceInvalidationScanRequest {
  return {
    ...(input.domains ? { domains: [...new Set(input.domains)] } : {}),
    reason: input.reason,
  };
}

function mergePendingScanRequest(
  pending: { id: number } & SourceInvalidationScanRequest,
  next: SourceInvalidationScanRequest,
): { id: number } & SourceInvalidationScanRequest {
  const domains =
    pending.domains || next.domains
      ? [...new Set([...(pending.domains ?? []), ...(next.domains ?? [])])]
      : undefined;
  return {
    id: pending.id,
    ...(domains ? { domains } : {}),
    reason: next.reason,
  };
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
    if (entry.name === ".svvy") {
      continue;
    }
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

function classifySourceInvalidationHint(
  hint: SourceInvalidationHint,
  inputs: readonly SourceWatchInput[],
  host: SourceInvalidationHost,
): SourceInvalidationHintClassification {
  const canonicalPath = canonicalSourcePath(hint.path, host);
  const domainInputs = inputs.filter((input) => input.domain === hint.domain);
  const matchesAllowedRoot = domainInputs.some((input) =>
    sourceInputContainsPath(input, canonicalPath, host),
  );
  if (!matchesAllowedRoot) {
    throw new RuntimeContractError({
      operation: "runtime.sourceInvalidation.hint",
      reason: "invalid-input",
      message: `Source invalidation hint path is outside configured ${hint.scope.kind}/${hint.domain} source roots.`,
      issues: [
        {
          path: ["path"],
          message: "Path is outside the configured source roots for the hinted source domain.",
        },
      ],
    });
  }
  if (isIgnoredSourceHintPath(canonicalPath)) {
    return domainInputs.some(
      (input) => input.kind === "directory" && sourceInputContainsPath(input, canonicalPath, host),
    )
      ? "scan-parent-domain"
      : "ignore";
  }
  return "scan";
}

function watcherEventScanReason(
  watchRoot: string,
  filename: string | Buffer | null,
  inputs: readonly SourceWatchInput[],
  host: SourceInvalidationHost,
): string | null {
  if (!filename) {
    return "filesystem_event";
  }
  const eventPath = watcherEventPath(watchRoot, filename, host);
  const canonicalPath = canonicalSourcePath(eventPath, host);
  const matchingInputs = inputs.filter((input) =>
    sourceInputContainsPath(input, canonicalPath, host),
  );
  if (matchingInputs.length === 0) {
    return null;
  }
  if (isIgnoredSourceHintPath(canonicalPath)) {
    return matchingInputs.some((input) => input.kind === "directory")
      ? "ignored-path-parent-domain-scan"
      : null;
  }
  return "filesystem_event";
}

function watcherEventPath(
  watchRoot: string,
  filename: string | Buffer,
  host: SourceInvalidationHost,
): string {
  const rawPath = String(filename).replace(/\\/g, "/");
  const resolved = host.path.resolve(rawPath);
  return resolved === rawPath ? resolved : host.path.resolve(host.path.join(watchRoot, rawPath));
}

function sourceInputContainsPath(
  input: SourceWatchInput,
  canonicalPath: string,
  host: SourceInvalidationHost,
): boolean {
  const root = canonicalSourcePath(input.path, host);
  return input.kind === "file"
    ? canonicalPath === root
    : canonicalPath === root || canonicalPath.startsWith(`${root}/`);
}

function canonicalSourcePath(path: string, host: SourceInvalidationHost): string {
  const resolved = host.path.resolve(path);
  const realPath = host.fileSystem.realPath(resolved);
  if (realPath) {
    return host.path.resolve(realPath);
  }
  const existingParent = nearestExistingDirectory(resolved, host);
  if (!existingParent) {
    return resolved;
  }
  const realParent = host.fileSystem.realPath(existingParent) ?? existingParent;
  const suffix = resolved.slice(existingParent.length).replace(/^\/+/, "");
  return suffix
    ? host.path.resolve(host.path.join(realParent, suffix))
    : host.path.resolve(realParent);
}

function isIgnoredSourceHintPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (
    basename.endsWith("~") ||
    basename.endsWith(".tmp") ||
    basename.endsWith(".swp") ||
    basename.endsWith(".swx") ||
    basename.startsWith(".#") ||
    (basename.startsWith(".") && basename.endsWith(".swp"))
  ) {
    return true;
  }
  return (
    normalized.includes("/.Trash/") ||
    normalized.includes("/.trash/") ||
    normalized.includes("/snapshots/") ||
    normalized.includes("/.snapshots/") ||
    normalized.includes("/node_modules/.") ||
    normalized.includes("/.smithers/node_modules/@svvyx/") ||
    normalized.includes("/.svvy/generated/") ||
    normalized.includes("/extensions/generated/") ||
    normalized.includes("/extensions/builds/")
  );
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
    if (input.fingerprintChildDirectories !== undefined) {
      item.fingerprintChildDirectories = input.fingerprintChildDirectories;
    }
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
