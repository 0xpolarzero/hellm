import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
  canReadFileSystemPath,
  canWriteFileSystemPath,
  type FileSystemSandboxPolicy,
  unrestrictedFileSystemPolicy,
} from "./filesystem-sandbox-policy";
import { buildSandboxHelperArgs, resolveSandboxHelperPath } from "./sandbox-helper";
import {
  isSandboxDenialOutput,
  type SandboxDenialInput as LegacySandboxDenialInput,
} from "./sandbox-denial";

export type CheckPathAccessInput = {
  path: AbsolutePath;
  operation: "read" | "write" | "execute" | "create" | "delete";
  followSymlinks: boolean;
  cwd?: AbsolutePath;
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

export type SandboxDenial =
  | {
      denied: true;
      reason: "macos-seatbelt-denial";
      sandboxEngine: "macos-seatbelt";
      evidence: readonly string[];
    }
  | { denied: false };

export type SandboxHelperCandidatesSnapshot = {
  candidates: readonly AbsolutePath[];
  allowedRoots: readonly AbsolutePath[];
  expectedDigest?: string;
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
    ) => Effect.Effect<SandboxLaunchFacts, SandboxPolicyError>;
    readonly classifyDenial: (
      input: LegacySandboxDenialInput,
    ) => Effect.Effect<SandboxDenial, SandboxPolicyError>;
  }
>()("@svvy/sandbox/Sandbox") {}

export const makeSandbox = Effect.gen(function* () {
  const policySource = yield* SandboxPolicySource;
  const helperCandidates = yield* SandboxHelperCandidatesPort;
  const hostProcess = yield* HostProcessReferencePort;

  return Sandbox.of({
    checkPathAccess(input) {
      return checkPathAccess(input);
    },
    resolvePathAccess(input) {
      return Effect.succeed(checkPathAccess(input));
    },
    buildLaunchPolicy: (input) =>
      buildLaunchPolicy(input, {
        policySource,
        helperCandidates,
        hostProcess,
      }),
    classifyDenial(input) {
      return Effect.succeed(classifyDenial(input));
    },
  });
});

export const layer: Layer.Layer<
  Sandbox,
  SandboxPolicyError,
  SandboxPolicySource | SandboxHelperCandidatesPort | HostProcessReferencePort
> = Layer.effect(Sandbox, makeSandbox);

function checkPathAccess(
  input: CheckPathAccessInput & { snapshot: SandboxPolicySnapshot },
): PathAccessDecision {
  const policy = toLaunchFileSystemPolicy(input.snapshot);
  const cwd = input.cwd ?? input.snapshot.cwd;
  const allowed =
    input.operation === "read" || input.operation === "execute"
      ? canReadFileSystemPath(policy, input.path, cwd)
      : canWriteFileSystemPath(policy, input.path, cwd);
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

function buildLaunchPolicy(
  input: BuildLaunchPolicyInput,
  dependencies: {
    policySource: SandboxPolicySourceService;
    helperCandidates: SandboxHelperCandidatesPortService;
    hostProcess: HostProcessReferencePortService;
  },
): Effect.Effect<SandboxLaunchFacts, SandboxPolicyError> {
  return Effect.gen(function* () {
    const snapshot =
      input.snapshot ??
      (yield* dependencies.policySource.snapshot({
        scope: input.scope,
        ...(input.surfacePiSessionId ? { surfacePiSessionId: input.surfacePiSessionId } : {}),
        commandId: input.commandId,
        launchKind: input.launchKind,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      }));

    if (snapshot.sandboxMode === "omitted_full_access") {
      return {
        mode: "omitted_full_access",
        command: input.command,
        cwd: input.cwd,
        envFacts: input.envFacts,
        policySnapshot: snapshot,
      };
    }

    const hostSnapshot = yield* dependencies.hostProcess.getSnapshot();
    const helperSnapshot = yield* dependencies.helperCandidates.getSnapshot();
    const helperPath = yield* Effect.try({
      try: () =>
        resolveSandboxHelperPath({
          executablePath: `${hostSnapshot.appBundleRoot}/Contents/MacOS/svvy`,
          candidatePaths: helperSnapshot.candidates,
        }),
      catch: (cause) =>
        new SandboxPolicyError({
          operation: "Sandbox.buildLaunchPolicy",
          reason: "helper-unavailable",
          message: cause instanceof Error ? cause.message : "Managed sandbox helper unavailable.",
          cause,
        }),
    });
    const helperArgs = buildSandboxHelperArgs({
      command: input.command,
      cwd: input.cwd,
      fileSystemPolicy: toLaunchFileSystemPolicy(snapshot),
      networkAccess: snapshot.networkPolicy === "allow",
    });

    return {
      mode: "managed",
      command: input.command,
      cwd: input.cwd,
      envFacts: input.envFacts,
      helperPath: helperPath as AbsolutePath,
      helperArgs,
      policySnapshot: snapshot,
    };
  });
}

function classifyDenial(input: LegacySandboxDenialInput): SandboxDenial {
  if (!isSandboxDenialOutput(input)) {
    return { denied: false };
  }
  return {
    denied: true,
    reason: "macos-seatbelt-denial",
    sandboxEngine: "macos-seatbelt",
    evidence: compactEvidence(input),
  };
}

function compactEvidence(input: LegacySandboxDenialInput): readonly string[] {
  return [input.stderr, input.stdout]
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

function toLaunchFileSystemPolicy(snapshot: SandboxPolicySnapshot): FileSystemSandboxPolicy {
  if (snapshot.sandboxMode === "omitted_full_access") {
    return unrestrictedFileSystemPolicy();
  }
  return {
    kind: "restricted",
    entries: [
      ...(snapshot.filesystemPolicy.defaultAccess === "read"
        ? [{ path: "/", access: "read" as const }]
        : []),
      ...snapshot.filesystemPolicy.entries.map((entry) => ({
        path: entry.path,
        access: entry.access,
      })),
    ],
  };
}
