import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";

import {
  type AbsolutePath,
  type BuildLaunchPolicyInput,
  type SandboxLaunchFacts,
  SandboxPolicyError,
  type SandboxPolicySnapshot,
  SandboxPolicySource,
  type SandboxPolicySourceService,
} from "@svvy/core";

import {
  buildMacOsSeatbeltProfile,
  canReadFileSystemPath,
  canWriteFileSystemPath,
  type FileSystemSandboxPolicy,
  protectedMetadataNames,
  unrestrictedFileSystemPolicy,
} from "./filesystem-sandbox-policy";
import { buildSandboxHelperArgs } from "./sandbox-helper-args";

export type CheckPathAccessInput = {
  path: AbsolutePath;
  operation: "read" | "write" | "execute" | "create" | "delete";
  followSymlinks: boolean;
  cwd: AbsolutePath;
};

export type PathAccessDecision =
  | {
      status: "allowed";
      access: "read" | "write" | "execute";
      matchedRuleId: string;
      canonicalPath?: AbsolutePath;
      canonicalParentPath?: AbsolutePath;
      resolvedCandidatePath?: AbsolutePath;
    }
  | {
      status: "denied";
      reason:
        | "outside-readable-roots"
        | "outside-writable-roots"
        | "blocked-root"
        | "protected-metadata"
        | "generated-output"
        | "immutable-artifact"
        | "symlink-escape"
        | "invalid-path";
      matchedRuleId?: string;
      canonicalPath?: AbsolutePath;
      canonicalParentPath?: AbsolutePath;
      resolvedCandidatePath?: AbsolutePath;
    };

export type RedactedOutputExcerpt = {
  text: string;
  originalBytes: number;
  omittedBytes: number;
  redactionApplied: boolean;
};

export type SandboxDenialInput = {
  command: readonly string[];
  cwd: AbsolutePath;
  exitCode: number | null;
  signal: string | null;
  stdoutExcerpt: RedactedOutputExcerpt;
  stderrExcerpt: RedactedOutputExcerpt;
  sandboxMode: "managed" | "omitted_full_access";
};

export type SandboxDenialReason =
  | "seatbelt-denied-file-read"
  | "seatbelt-denied-file-write"
  | "seatbelt-denied-network"
  | "helper-setup-failed"
  | "invalid-profile";

export type SandboxDenial =
  | {
      denied: true;
      reason: SandboxDenialReason;
      evidence: readonly string[];
    }
  | { denied: false };

export type SandboxHelperCandidatesSnapshot = {
  candidates: readonly {
    path: AbsolutePath;
    platform: "darwin";
    arch: "arm64" | "x64";
    expectedDigest: string;
  }[];
  allowedRoots: readonly AbsolutePath[];
};

export type HostProcessReferenceSnapshot = {
  platform: "darwin";
  arch: "arm64" | "x64";
  appBundleRoot: AbsolutePath;
  appSupportRoot: AbsolutePath;
  tempRoot: AbsolutePath;
};

export interface SandboxHelperCandidatesPort {
  readonly _tag: "SandboxHelperCandidatesPort";
}

export interface SandboxHelperCandidatesPortService {
  readonly getSnapshot: () => Effect.Effect<SandboxHelperCandidatesSnapshot, SandboxPolicyError>;
}

export const SandboxHelperCandidatesPort = Context.Service<
  SandboxHelperCandidatesPort,
  SandboxHelperCandidatesPortService
>("@svvy/sandbox/SandboxHelperCandidatesPort");

export interface HostProcessReferencePort {
  readonly _tag: "HostProcessReferencePort";
}

export interface HostProcessReferencePortService {
  readonly getSnapshot: () => Effect.Effect<HostProcessReferenceSnapshot, SandboxPolicyError>;
}

export const HostProcessReferencePort = Context.Service<
  HostProcessReferencePort,
  HostProcessReferencePortService
>("@svvy/sandbox/HostProcessReferencePort");

export class Sandbox extends Context.Service<
  Sandbox,
  {
    readonly checkPathAccess: (
      input: CheckPathAccessInput & { snapshot: SandboxPolicySnapshot },
    ) => PathAccessDecision;
    readonly resolvePathAccess: (
      input: CheckPathAccessInput & { snapshot: SandboxPolicySnapshot },
    ) => Effect.Effect<PathAccessDecision, SandboxPolicyError>;
    readonly buildLaunchPolicy: (
      input: BuildLaunchPolicyInput,
    ) => Effect.Effect<SandboxLaunchFacts, SandboxPolicyError, Scope.Scope>;
    readonly classifyDenial: (
      input: SandboxDenialInput,
    ) => Effect.Effect<SandboxDenial, SandboxPolicyError>;
  }
>()("@svvy/sandbox/Sandbox") {}

const makeSandbox = Effect.gen(function* () {
  const policySource = yield* SandboxPolicySource;
  const helperCandidates = yield* SandboxHelperCandidatesPort;
  const hostProcess = yield* HostProcessReferencePort;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return Sandbox.of({
    checkPathAccess(input) {
      return checkPathAccess(input);
    },
    resolvePathAccess(input) {
      return resolvePathAccess(input, { fileSystem, path });
    },
    buildLaunchPolicy: (input) =>
      buildLaunchPolicy(input, {
        policySource,
        helperCandidates,
        hostProcess,
        crypto,
        fileSystem,
      }),
    classifyDenial(input) {
      return Effect.succeed(classifyDenial(input));
    },
  });
});

export const layer: Layer.Layer<
  Sandbox,
  never,
  | SandboxPolicySource
  | SandboxHelperCandidatesPort
  | HostProcessReferencePort
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
> = Layer.effect(Sandbox, makeSandbox);

export function checkSandboxPathAccess(
  input: CheckPathAccessInput & { snapshot: SandboxPolicySnapshot },
): PathAccessDecision {
  return checkPathAccess(input);
}

function checkPathAccess(
  input: CheckPathAccessInput & { snapshot: SandboxPolicySnapshot },
): PathAccessDecision {
  const policy = toLaunchFileSystemPolicy(input.snapshot);
  const allowed =
    input.operation === "read" || input.operation === "execute"
      ? canReadFileSystemPath(policy, input.path, input.cwd)
      : canWriteFileSystemPath(policy, input.path, input.cwd);
  if (allowed) {
    return {
      status: "allowed",
      access:
        input.operation === "read" ? "read" : input.operation === "execute" ? "execute" : "write",
      matchedRuleId: "filesystemPolicy",
    };
  }
  return {
    status: "denied",
    reason:
      input.operation === "read" || input.operation === "execute"
        ? "outside-readable-roots"
        : "outside-writable-roots",
    matchedRuleId: "filesystemPolicy",
  };
}

function resolvePathAccess(
  input: CheckPathAccessInput & { snapshot: SandboxPolicySnapshot },
  dependencies: {
    fileSystem: FileSystem.FileSystem;
    path: Path.Path;
  },
): Effect.Effect<PathAccessDecision, SandboxPolicyError> {
  return Effect.gen(function* () {
    const absolutePath = normalizeAbsolutePath(dependencies.path, input.path, input.cwd);
    if (!absolutePath) {
      return invalidPathDecision();
    }

    const lexicalInput = {
      ...input,
      path: absolutePath,
    };
    const targetExists = yield* existsPath(dependencies.fileSystem, absolutePath);

    if (targetExists) {
      const canonicalPath = yield* canonicalizeExistingPath({
        fileSystem: dependencies.fileSystem,
        followSymlinks: input.followSymlinks,
        path: absolutePath,
      });
      const canonicalInput = {
        ...input,
        path: canonicalPath,
      };
      const decision = checkCanonicalPathAccess({
        canonicalDecision: checkPathAccess(canonicalInput),
        canonicalPath,
        lexicalDecision: checkPathAccess(lexicalInput),
      });
      if (decision.status === "denied" || input.operation !== "execute") {
        return decision;
      }

      const executable = yield* isExecutableFile(dependencies.fileSystem, canonicalPath);
      return executable
        ? decision
        : invalidPathDecision({
            canonicalPath,
            matchedRuleId: decision.matchedRuleId,
          });
    }

    if (
      input.operation !== "write" &&
      input.operation !== "create" &&
      input.operation !== "delete"
    ) {
      return invalidPathDecision({
        matchedRuleId: "filesystemPolicy",
        resolvedCandidatePath: absolutePath,
      });
    }

    const parent = yield* nearestExistingParent({
      fileSystem: dependencies.fileSystem,
      path: dependencies.path,
      targetPath: absolutePath,
    });
    if (!parent) {
      return invalidPathDecision({
        matchedRuleId: "filesystemPolicy",
        resolvedCandidatePath: absolutePath,
      });
    }

    const parentIsDirectory = yield* isDirectory(dependencies.fileSystem, parent);
    if (!parentIsDirectory) {
      return invalidPathDecision({
        matchedRuleId: "filesystemPolicy",
        canonicalParentPath: parent,
        resolvedCandidatePath: absolutePath,
      });
    }

    const canonicalParentPath = yield* canonicalizeExistingPath({
      fileSystem: dependencies.fileSystem,
      followSymlinks: input.followSymlinks,
      path: parent,
    });
    const relativeCandidate = dependencies.path.relative(parent, absolutePath);
    const resolvedCandidatePath = dependencies.path.normalize(
      dependencies.path.join(canonicalParentPath, relativeCandidate),
    ) as AbsolutePath;
    const canonicalInput = {
      ...input,
      path: resolvedCandidatePath,
    };

    return checkCanonicalPathAccess({
      canonicalDecision: checkPathAccess(canonicalInput),
      canonicalParentPath,
      lexicalDecision: checkPathAccess(lexicalInput),
      resolvedCandidatePath,
    });
  }).pipe(Effect.catch(() => Effect.succeed(invalidPathDecision())));
}

function invalidPathDecision(
  input: {
    canonicalPath?: AbsolutePath;
    canonicalParentPath?: AbsolutePath;
    matchedRuleId?: string;
    resolvedCandidatePath?: AbsolutePath;
  } = {},
): PathAccessDecision {
  return {
    status: "denied",
    reason: "invalid-path",
    ...input,
  };
}

function normalizeAbsolutePath(
  path: Path.Path,
  rawPath: AbsolutePath,
  cwd: AbsolutePath,
): AbsolutePath | null {
  const resolved = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(cwd, rawPath);
  const normalized = path.normalize(resolved);
  return path.isAbsolute(normalized) ? (normalized as AbsolutePath) : null;
}

function existsPath(
  fileSystem: FileSystem.FileSystem,
  path: AbsolutePath,
): Effect.Effect<boolean, never> {
  return fileSystem.exists(path).pipe(Effect.catch(() => Effect.succeed(false)));
}

function canonicalizeExistingPath(input: {
  fileSystem: FileSystem.FileSystem;
  followSymlinks: boolean;
  path: AbsolutePath;
}): Effect.Effect<AbsolutePath, unknown> {
  return input.followSymlinks
    ? input.fileSystem.realPath(input.path).pipe(Effect.map((path) => path as AbsolutePath))
    : Effect.succeed(input.path);
}

function nearestExistingParent(input: {
  fileSystem: FileSystem.FileSystem;
  path: Path.Path;
  targetPath: AbsolutePath;
}): Effect.Effect<AbsolutePath | null, never> {
  return Effect.gen(function* () {
    let current = input.path.dirname(input.targetPath) as AbsolutePath;
    while (current !== input.path.dirname(current)) {
      if (yield* existsPath(input.fileSystem, current)) {
        return current;
      }
      current = input.path.dirname(current) as AbsolutePath;
    }
    return (yield* existsPath(input.fileSystem, current)) ? current : null;
  });
}

function isDirectory(
  fileSystem: FileSystem.FileSystem,
  path: AbsolutePath,
): Effect.Effect<boolean, never> {
  return fileSystem.stat(path).pipe(
    Effect.map((stat) => stat.type === "Directory"),
    Effect.catch(() => Effect.succeed(false)),
  );
}

function isExecutableFile(
  fileSystem: FileSystem.FileSystem,
  path: AbsolutePath,
): Effect.Effect<boolean, never> {
  return fileSystem.stat(path).pipe(
    Effect.map((stat) => stat.type === "File" && (stat.mode & 0o111) !== 0),
    Effect.catch(() => Effect.succeed(false)),
  );
}

function checkCanonicalPathAccess(input: {
  canonicalDecision: PathAccessDecision;
  canonicalPath?: AbsolutePath;
  canonicalParentPath?: AbsolutePath;
  lexicalDecision: PathAccessDecision;
  resolvedCandidatePath?: AbsolutePath;
}): PathAccessDecision {
  if (input.canonicalDecision.status === "allowed") {
    return {
      ...input.canonicalDecision,
      ...(input.canonicalPath ? { canonicalPath: input.canonicalPath } : {}),
      ...(input.canonicalParentPath ? { canonicalParentPath: input.canonicalParentPath } : {}),
      ...(input.resolvedCandidatePath
        ? { resolvedCandidatePath: input.resolvedCandidatePath }
        : {}),
    };
  }

  const symlinkEscape =
    input.lexicalDecision.status === "allowed" &&
    (input.canonicalPath !== undefined || input.resolvedCandidatePath !== undefined);
  return {
    ...input.canonicalDecision,
    reason: symlinkEscape ? "symlink-escape" : input.canonicalDecision.reason,
    ...(input.canonicalPath ? { canonicalPath: input.canonicalPath } : {}),
    ...(input.canonicalParentPath ? { canonicalParentPath: input.canonicalParentPath } : {}),
    ...(input.resolvedCandidatePath ? { resolvedCandidatePath: input.resolvedCandidatePath } : {}),
  };
}

function buildLaunchPolicy(
  input: BuildLaunchPolicyInput,
  dependencies: {
    policySource: SandboxPolicySourceService;
    helperCandidates: SandboxHelperCandidatesPortService;
    hostProcess: HostProcessReferencePortService;
    crypto: Crypto.Crypto;
    fileSystem: FileSystem.FileSystem;
  },
): Effect.Effect<SandboxLaunchFacts, SandboxPolicyError, Scope.Scope> {
  return Effect.gen(function* () {
    const canonicalCwd = yield* canonicalizeLaunchCwd(input.cwd, dependencies.fileSystem);
    const launchInput = {
      ...input,
      cwd: canonicalCwd,
    };
    const snapshot =
      launchInput.snapshot ??
      (yield* dependencies.policySource.snapshot({
        scope: launchInput.scope,
        ...(launchInput.surfacePiSessionId
          ? { surfacePiSessionId: launchInput.surfacePiSessionId }
          : {}),
        commandId: launchInput.commandId,
        launchKind: launchInput.launchKind,
        cwd: launchInput.cwd,
      }));

    if (!snapshotMatchesLaunchInput(launchInput, snapshot)) {
      return yield* Effect.fail(
        new SandboxPolicyError({
          operation: "Sandbox.buildLaunchPolicy",
          reason: "snapshot-mismatch",
          message: "Caller-provided sandbox policy snapshot does not match launch input.",
        }),
      );
    }

    if (!launchInput.command[0]) {
      return yield* Effect.fail(
        new SandboxPolicyError({
          operation: "Sandbox.buildLaunchPolicy",
          reason: "invalid-policy",
          message: "Launch command must include an executable.",
        }),
      );
    }

    if (snapshot.sandboxMode === "omitted_full_access") {
      return {
        mode: "omitted_full_access",
        spawn: spawnFacts(launchInput),
        policySnapshot: snapshot,
      };
    }

    const hostSnapshot = yield* dependencies.hostProcess.getSnapshot();
    const helperSnapshot = yield* dependencies.helperCandidates.getSnapshot();
    const helperPath = yield* resolveSandboxHelperPathWithServices({
      allowedRoots: helperSnapshot.allowedRoots,
      candidates: helperSnapshot.candidates,
      fileSystem: dependencies.fileSystem,
      crypto: dependencies.crypto,
      host: hostSnapshot,
    });
    const helperArgs = buildSandboxHelperArgs({
      command: launchInput.command,
      cwd: launchInput.cwd,
      fileSystemPolicy: toLaunchFileSystemPolicy(snapshot),
      networkAccess: snapshot.networkPolicy === "allow",
    });
    const profileDigest = yield* generatedProfileDigest({
      crypto: dependencies.crypto,
      cwd: launchInput.cwd,
      fileSystemPolicy: toLaunchFileSystemPolicy(snapshot),
      networkAccess: snapshot.networkPolicy === "allow",
    });
    if (snapshot.profileDigest && snapshot.profileDigest !== profileDigest) {
      return yield* Effect.fail(
        new SandboxPolicyError({
          operation: "Sandbox.buildLaunchPolicy",
          reason: "snapshot-mismatch",
          message: "Caller-provided sandbox profile digest does not match generated profile.",
        }),
      );
    }

    return {
      mode: "managed",
      spawn: {
        executable: helperPath as AbsolutePath,
        args: helperArgs,
        cwd: launchInput.cwd,
        envFacts: launchInput.envFacts,
      },
      helperPath: helperPath as AbsolutePath,
      helperArgs,
      policySnapshot: { ...snapshot, profileDigest },
    };
  });
}

function canonicalizeLaunchCwd(
  cwd: AbsolutePath,
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<AbsolutePath, SandboxPolicyError> {
  return fileSystem.realPath(cwd).pipe(
    Effect.map((path) => path as AbsolutePath),
    Effect.mapError(
      (cause) =>
        new SandboxPolicyError({
          operation: "Sandbox.buildLaunchPolicy.cwd",
          reason: "invalid-policy",
          message: "Launch cwd must exist and resolve to a canonical path.",
          cause,
        }),
    ),
  );
}

function snapshotMatchesLaunchInput(
  input: BuildLaunchPolicyInput,
  snapshot: SandboxPolicySnapshot,
): boolean {
  return (
    stableJson(snapshot.scope) === stableJson(input.scope) &&
    snapshot.surfacePiSessionId === input.surfacePiSessionId &&
    snapshot.commandId === input.commandId &&
    snapshot.launchKind === input.launchKind &&
    snapshot.cwd === input.cwd
  );
}

function generatedProfileDigest(input: {
  crypto: Crypto.Crypto;
  cwd: AbsolutePath;
  fileSystemPolicy: FileSystemSandboxPolicy;
  networkAccess: boolean;
}): Effect.Effect<string, SandboxPolicyError> {
  return Effect.gen(function* () {
    const profile = buildMacOsSeatbeltProfile(input.fileSystemPolicy, input.cwd, {
      networkAccess: input.networkAccess,
    });
    const digestBytes = yield* input.crypto.digest(
      "SHA-256",
      new TextEncoder().encode(stableJson(profile)),
    );
    return hexDigest(digestBytes);
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SandboxPolicyError({
          operation: "Sandbox.buildLaunchPolicy.profileDigest",
          reason: "invalid-policy",
          message: cause instanceof Error ? cause.message : "Unable to digest sandbox profile.",
          cause,
        }),
    ),
  );
}

function resolveSandboxHelperPathWithServices(input: {
  candidates: SandboxHelperCandidatesSnapshot["candidates"];
  allowedRoots: readonly AbsolutePath[];
  fileSystem: FileSystem.FileSystem;
  crypto: Crypto.Crypto;
  host: Pick<HostProcessReferenceSnapshot, "platform" | "arch">;
}): Effect.Effect<string, SandboxPolicyError> {
  return Effect.gen(function* () {
    for (const candidate of input.candidates) {
      const usable = yield* isUsableHelperCandidate({
        allowedRoots: input.allowedRoots,
        candidate,
        crypto: input.crypto,
        fileSystem: input.fileSystem,
        host: input.host,
      });
      if (usable) {
        return candidate.path;
      }
    }

    return yield* Effect.fail(
      new SandboxPolicyError({
        operation: "Sandbox.buildLaunchPolicy.resolveHelperPath",
        reason: "helper-unavailable",
        message: "Managed sandboxing requires packaged svvy-sandbox-helper.",
      }),
    );
  });
}

function isUsableHelperCandidate(input: {
  allowedRoots: readonly AbsolutePath[];
  candidate: SandboxHelperCandidatesSnapshot["candidates"][number];
  crypto: Crypto.Crypto;
  fileSystem: FileSystem.FileSystem;
  host: Pick<HostProcessReferenceSnapshot, "platform" | "arch">;
}): Effect.Effect<boolean, never> {
  return Effect.gen(function* () {
    if (
      input.candidate.platform !== input.host.platform ||
      input.candidate.arch !== input.host.arch
    ) {
      return false;
    }
    if (!isAbsolutePath(input.candidate.path)) {
      return false;
    }
    if (!isPathInsideAnyRoot(input.candidate.path, input.allowedRoots)) {
      return false;
    }
    const stat = yield* input.fileSystem.stat(input.candidate.path);
    if (stat.type !== "File") {
      return false;
    }
    if ((stat.mode & 0o111) === 0) {
      return false;
    }
    yield* input.fileSystem.access(input.candidate.path, { ok: true });
    const bytes = yield* input.fileSystem.readFile(input.candidate.path);
    const digestBytes = yield* input.crypto.digest("SHA-256", bytes);
    return hexDigest(digestBytes) === input.candidate.expectedDigest;
  }).pipe(Effect.catch(() => Effect.succeed(false)));
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function isPathInsideAnyRoot(path: AbsolutePath, roots: readonly AbsolutePath[]): boolean {
  return roots.some((root) => isPathInsideRoot(path, root));
}

function isPathInsideRoot(path: AbsolutePath, root: AbsolutePath): boolean {
  const normalizedPath = trimTrailingSlashes(path);
  const normalizedRoot = trimTrailingSlashes(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function trimTrailingSlashes(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function spawnFacts(input: BuildLaunchPolicyInput): SandboxLaunchFacts["spawn"] {
  const [executable, ...args] = input.command;
  return {
    executable: executable! as AbsolutePath,
    args,
    cwd: input.cwd,
    envFacts: input.envFacts,
  };
}

function classifyDenial(input: SandboxDenialInput): SandboxDenial {
  if (
    input.sandboxMode === "omitted_full_access" ||
    input.exitCode === 0 ||
    input.exitCode === 127
  ) {
    return { denied: false };
  }

  const combined = joinExcerptText(input);
  const normalized = combined.toLowerCase();
  if (/\b(command not found|parse error|syntax error)\b/.test(normalized)) {
    return { denied: false };
  }

  const reason = classifyDenialReason(normalized);
  if (!reason) {
    return { denied: false };
  }

  return {
    denied: true,
    reason,
    evidence: compactEvidence(input),
  };
}

function classifyDenialReason(normalizedOutput: string): SandboxDenialReason | null {
  if (/\bdeny\([^)]*\)\s+(?:network|system-network|network-)/.test(normalizedOutput)) {
    return "seatbelt-denied-network";
  }
  if (/\bdeny\([^)]*\)\s+file-read/.test(normalizedOutput)) {
    return "seatbelt-denied-file-read";
  }
  if (normalizedOutput.includes("sandbox-exec: sandbox_apply:")) {
    return "helper-setup-failed";
  }
  if (normalizedOutput.includes("invalid profile")) {
    return "invalid-profile";
  }
  if (
    /\bdeny\([^)]*\)\s+file-write/.test(normalizedOutput) ||
    normalizedOutput.includes("operation not permitted") ||
    normalizedOutput.includes("permission denied") ||
    normalizedOutput.includes("read-only file system") ||
    normalizedOutput.includes("failed to write file")
  ) {
    return "seatbelt-denied-file-write";
  }
  return null;
}

function compactEvidence(input: SandboxDenialInput): readonly string[] {
  return [input.stderrExcerpt.text, input.stdoutExcerpt.text]
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

function joinExcerptText(input: SandboxDenialInput): string {
  return `${input.stdoutExcerpt.text}\n${input.stderrExcerpt.text}`;
}

function hexDigest(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toLaunchFileSystemPolicy(snapshot: SandboxPolicySnapshot): FileSystemSandboxPolicy {
  if (snapshot.sandboxMode === "omitted_full_access") {
    return unrestrictedFileSystemPolicy();
  }
  return {
    kind: "restricted",
    entries: [
      ...(snapshot.filesystemPolicy.defaultAccess === "read"
        ? [{ path: "/", access: "read" as const, recursive: true }]
        : []),
      ...snapshot.filesystemPolicy.entries.map((entry) => ({
        path: entry.path,
        access: entry.access,
        recursive: entry.recursive,
        source: entry.source,
        ...(entry.access === "write" && entry.source !== "protected-metadata"
          ? { protectedMetadataNames: protectedMetadataNames() }
          : {}),
      })),
    ],
  };
}
