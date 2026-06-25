# `@svvy/sandbox` Package Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Package: `@svvy/sandbox`

## Purpose

`@svvy/sandbox` owns interpretation of resolved filesystem/network sandbox policy snapshots and
turns those snapshots into concrete launch constraints.

It builds launch constraints for direct execution surfaces: Shell, `svvyx` shell commands, Apply
Patch file effects, Execute TypeScript runtime, and extension facade child commands where
applicable.

`@svvy/sandbox` is an Effect-native package for effectful policy resolution and launch-policy
construction. Pure access checks operate only on explicit immutable snapshots.

## Owns

- Filesystem access model: `Read`, `Write`, `None`.
- Most-specific path precedence.
- Equal-specificity precedence: `None > Write > Read`.
- Writable roots with read-only subpaths.
- Protected metadata carveouts.
- Generated-output read-only boundaries.
- Immutable artifact boundaries.
- Network allow/deny policy.
- Full-access sandbox omission.
- Sandbox profile generation.
- Native helper path resolution and invocation arguments.
- Sandbox-denial classification.
- Validation that launch policy generation uses one immutable policy snapshot.

## Does Not Own

- Approval decisions.
- Command lifecycle.
- Shell subprocess management.
- State persistence.
- Extension readiness.
- UI rendering.

## Public API Shape

Effect-native service surface:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import {
  SandboxPolicyError,
  type BuildLaunchPolicyInput,
  type SandboxLaunchFacts,
  type SandboxPolicySnapshot,
  type SandboxPolicySource,
} from "@svvy/core";

export class Sandbox extends Context.Service<
  Sandbox,
  {
    checkPathAccess(
      input: CheckPathAccessInput & { snapshot: SandboxPolicySnapshot },
    ): PathAccessDecision;
    resolvePathAccess(
      input: CheckPathAccessInput & { snapshot: SandboxPolicySnapshot },
    ): Effect.Effect<PathAccessDecision, SandboxPolicyError>;
    buildLaunchPolicy(
      input: BuildLaunchPolicyInput,
    ): Effect.Effect<SandboxLaunchFacts, SandboxPolicyError, Scope.Scope>;
    classifyDenial(input: SandboxDenialInput): Effect.Effect<SandboxDenial, SandboxPolicyError>;
  }
>()("@svvy/sandbox/Sandbox") {}

export const layer: Layer.Layer<
  Sandbox,
  SandboxPolicyError,
  | SandboxPolicySource
  | SandboxHelperCandidatesPort
  | HostProcessReferencePort
  | FileSystem.FileSystem
  | Path.Path
> = Layer.effect(Sandbox, makeSandbox);
```

`SandboxPolicySource` is the core-owned live service tag for immutable policy snapshots.
The live product implementation is state-backed: `@svvy/state` owns persisted policy facts and
exposes the source through a layer composed by app/bootstrap. App/bootstrap may provide host roots
and helper facts through separate host-support ports, but it must not synthesize sandbox policy
snapshots or own policy semantics. `@svvy/sandbox` consumes the tag without importing
`@svvy/state` or app modules.

The snapshot input, output, and error schemas live with the core-owned sandbox policy contracts:
`SandboxPolicySnapshotInput`, `SandboxPolicySnapshot`, and `SandboxPolicyError`.
`@svvy/sandbox` uses exactly one immutable snapshot per launch, either supplied on
`BuildLaunchPolicyInput` or resolved through `SandboxPolicySource`. Runtime/state resolve approval
mode into `sandboxMode` inside that snapshot before launch-policy construction: `full-access`
produces `sandboxMode: "omitted_full_access"`, while managed modes carry filesystem and network
limits. Sandbox never reads approval settings, renderer state, command rows, or provider auth
directly.
`SandboxPolicySource` and the immutable launch-policy input/output contracts are core-owned.
Sandbox-only contracts such as `CheckPathAccessInput`, `PathAccessDecision`, `SandboxDenialInput`,
`SandboxDenial`, `SandboxHelperCandidatesPort`, and `HostProcessReferencePort` are exported by
`@svvy/sandbox`, because they are consumed only by sandbox internals, sandbox tests, or explicit
sandbox diagnostics.
`SandboxHelperCandidatesPort` and `HostProcessReferencePort` are sandbox-owned host-support service
tags implemented by app/bootstrap. They live in `@svvy/sandbox` because app/bootstrap provides their
live layers while only `@svvy/sandbox` consumes them. If a second public package needs either port,
promote that contract to `@svvy/core` in the same change. `@svvy/sandbox` consumes them through
Effect layers and never reads `process.*`, `import.meta.dir`, source-checkout-relative paths, or
repo-local helper locations directly.

The sandbox-owned host support service tags and diagnostic data contracts are:

```ts
type CheckPathAccessInput = {
  path: AbsolutePath;
  operation: "read" | "write" | "execute" | "create" | "delete";
  followSymlinks: boolean;
  cwd?: AbsolutePath;
};

type PathAccessDecision =
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

type SandboxDenialInput = {
  command: readonly string[];
  cwd: AbsolutePath;
  exitCode: number | null;
  signal: string | null;
  stdoutExcerpt: RedactedOutputExcerpt;
  stderrExcerpt: RedactedOutputExcerpt;
  sandboxMode: "managed" | "omitted_full_access";
};

type RedactedOutputExcerpt = {
  text: string;
  originalBytes: number;
  omittedBytes: number;
  redactionApplied: boolean;
};

type SandboxDenial = {
  denied: boolean;
  reason?:
    | "seatbelt-denied-file-read"
    | "seatbelt-denied-file-write"
    | "seatbelt-denied-network"
    | "helper-setup-failed"
    | "invalid-profile";
  evidence?: readonly string[];
};

type SandboxHelperCandidatesSnapshot = {
  candidates: readonly {
    path: AbsolutePath;
    platform: "darwin";
    arch: "arm64" | "x64";
    expectedDigest: string;
  }[];
  allowedRoots: readonly AbsolutePath[];
};

type HostProcessReferenceSnapshot = {
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
```

`checkPathAccess(...)` is pure and can only evaluate the explicit path string against the supplied
immutable snapshot. It does not canonicalize paths, follow symlinks, inspect executable metadata, or
read the host filesystem. Effectful canonicalization, symlink resolution, and executable metadata
checks happen in `resolvePathAccess(...)` through sandbox-owned injected platform services. Callers
of the `Sandbox` service do not provide filesystem/path dependencies per call because those
dependencies are consumed by the root `layer` export.

`CheckPathAccessInput`, `PathAccessDecision`, `SandboxDenialInput`, `SandboxDenial`,
`SandboxHelperCandidatesSnapshot`, `HostProcessReferenceSnapshot`, `SandboxHelperCandidatesPort`,
and `HostProcessReferencePort` are sandbox-owned contracts. App/bootstrap implements the live
host-support services from packaged app paths and host facts, then provides them to `@svvy/sandbox`.
`SandboxHelperCandidatesPort` and `HostProcessReferencePort` are package-local data-only host/config
tags using the approved function-syntax `Context.Service<PortIdentifier, PortService>(id)` pattern
from `effect-v4.spec.md`; they are not behavior-bearing `Sandbox` implementation classes. Runtime
receives core-owned `SandboxLaunchFacts` only as a scoped in-process launch receipt. Command facts
persist only the approved redacted/fingerprint subset and sandbox-denial facts that the runtime
command lifecycle chooses to persist. `@svvy/sandbox` maps host/platform failures into
`SandboxPolicyError`.
The live providers are named `SandboxHelperCandidatesPort.layerLive(snapshot)` and
`HostProcessReferencePort.layerLive(snapshot)`. They are app/bootstrap immutable host snapshots for
the packaged app process. They must not read repo-root authoring paths, source-checkout-relative
helpers, mutable environment variables, or product state at call time.

`execute` is a derived check operation, not a persisted fourth filesystem permission. It requires
the resolved path to be readable under the immutable policy snapshot and executable according to host
file metadata or an explicit allowed executable rule. Persisted filesystem policy remains the
`Read` / `Write` / `None` style policy defined by the sandbox contracts.

Snapshot input:

- `scope: SandboxLaunchScope`
- optional `surfacePiSessionId`
- `commandId: CommandId`
- `launchKind`
- optional `cwd`

Snapshot output:

- workspace roots and active worktree roots
- default read-only roots
- mutable roots, including active artifact mutable directories, `/tmp`, and `$TMPDIR`
- writable/read-only/blocked path rules
- generated-output roots, including generated package roots, generated extension build roots,
  workspace `.svvy/generated`, and workspace `.smithers/node_modules/@svvyx/*` links
- immutable artifact roots
- protected metadata roots
- network allow/deny policy
- managed sandbox mode: `managed` or `omitted_full_access`

The sandbox package receives approval-derived sandbox mode only as resolved policy. It does not ask
for approval, inspect approval prompts, or read product settings directly.

`@svvy/sandbox` exposes no non-Effect facade. Path-access diagnostics and denial classification are
Effect-native package service calls. Adding a diagnostics subpath requires exact methods, redacted
payloads, and package-boundary tests. Product execution reaches sandbox only through `@svvy/runtime`
command lifecycle services. Package-to-package callers use the Effect service. Full-access mode,
approval-derived execution mode, managed sandbox enablement, and network allow/deny policy come from
the immutable `SandboxPolicySnapshot`, not from ad hoc facade arguments.

Concrete launch-policy fact input and output are pi-free data contracts exported by `@svvy/core`.
`@svvy/sandbox` owns their interpretation, validation, and concrete managed/full-access launch
wrapping; it does not own the cross-package type names. Core-exported facts must never carry raw
environment values. Runtime-private trusted launch data may carry raw env or
`Redacted.Redacted<string>` values, but that object is process-local, non-persisted, and
non-encoded.

```ts
type EnvironmentFact = {
  key: string;
  valueFingerprint?: string;
  redactionLabel?: string;
};

type BuildLaunchPolicyInput = {
  scope:
    | { kind: "workspace"; workspaceId: WorkspaceId }
    | { kind: "app-global-extension-dependency"; originWorkspaceId?: WorkspaceId }
    | {
        kind: "app-global-generated-package";
        packageName: GeneratedPackageName;
        originWorkspaceId?: WorkspaceId;
      }
    | {
        kind: "workspace-generated-package-link";
        workspaceId: WorkspaceId;
        packageName: GeneratedPackageName;
      };
  surfacePiSessionId?: SurfacePiSessionId;
  commandId: CommandId;
  launchKind:
    | "direct_shell"
    | "direct_apply_patch"
    | "execute_typescript_runtime"
    | "extension_facade_child"
    | "app_owned_generated_package_build"
    | "workspace_generated_package_link_repair"
    | "extension_dependency_action";
  command: readonly string[];
  cwd: AbsolutePath;
  envFacts: readonly EnvironmentFact[];
  snapshot?: SandboxPolicySnapshot;
};

type SandboxPolicySnapshot = {
  snapshotId: string;
  fingerprint: string;
  resolvedAt: IsoDateTimeString;
  scope:
    | { kind: "workspace"; workspaceId: WorkspaceId }
    | { kind: "app-global-extension-dependency"; originWorkspaceId?: WorkspaceId }
    | {
        kind: "app-global-generated-package";
        packageName: GeneratedPackageName;
        originWorkspaceId?: WorkspaceId;
      }
    | {
        kind: "workspace-generated-package-link";
        workspaceId: WorkspaceId;
        packageName: GeneratedPackageName;
      };
  surfacePiSessionId?: SurfacePiSessionId;
  commandId: CommandId;
  launchKind:
    | "direct_shell"
    | "direct_apply_patch"
    | "execute_typescript_runtime"
    | "extension_facade_child"
    | "app_owned_generated_package_build"
    | "workspace_generated_package_link_repair"
    | "extension_dependency_action";
  cwd: AbsolutePath;
  sandboxMode: "managed" | "omitted_full_access";
  networkPolicy: "allow" | "deny";
  filesystemPolicy: FileSystemSandboxPolicy;
  profileDigest?: string;
};

type SandboxLaunchFacts =
  | {
      mode: "managed";
      originalCommand: readonly string[];
      spawn: {
        executable: AbsolutePath;
        args: readonly string[];
        cwd: AbsolutePath;
        envFacts: readonly EnvironmentFact[];
      };
      envFacts: readonly EnvironmentFact[];
      helperPath: AbsolutePath;
      helperArgs: readonly string[];
      profilePath?: AbsolutePath;
      policySnapshot: SandboxPolicySnapshot;
    }
  | {
      mode: "omitted_full_access";
      originalCommand: readonly string[];
      spawn: {
        executable: AbsolutePath;
        args: readonly string[];
        cwd: AbsolutePath;
        envFacts: readonly EnvironmentFact[];
      };
      envFacts: readonly EnvironmentFact[];
      policySnapshot: SandboxPolicySnapshot & { sandboxMode: "omitted_full_access" };
    };

type TrustedSandboxLaunchFacts = SandboxLaunchFacts & {
  rawEnv: Readonly<Record<string, Redacted.Redacted<string>>>;
};
```

Snippets using `Redacted.Redacted<T>` assume `import type * as Redacted from "effect/Redacted"`.
Secret-bearing local types stay process-local. Persisted state, RPC contracts, generated package
files, read models, diagnostics, and app logs expose only presence, non-secret labels, key names, or
fingerprints.
`SandboxLaunchFacts` is a scope-bound in-process receipt from `@svvy/sandbox` to `@svvy/runtime`,
not a persistence payload. Runtime may use `spawn`, `helperPath`, `helperArgs`, and `profilePath`
only inside the command scope that owns the child process. Runtime may persist or publish only
redacted/fingerprint facts derived from the receipt: policy snapshot id/fingerprint, profile digest,
helper identity digest, original command family, env key presence, sandbox mode, network policy,
and failure/denial facts. It must not persist, log, emit, or expose `spawn.executable`,
`spawn.args`, `spawn.cwd`, `helperPath`, `helperArgs`, `profilePath`, raw env, or temporary profile
contents.
`TrustedSandboxLaunchFacts` is a runtime-owned local construction type, not a core/public DTO,
state payload, facade payload, generated package contract, or extension handler result. Runtime
constructs it only after receiving scoped `SandboxLaunchFacts` and resolving the raw redacted env
inside the same command scope that owns the child process. Only redacted denial/failure facts and
the approved persisted fingerprint subset may cross persistence, runtime-event, app-log, or renderer
boundaries.

`BuildLaunchPolicyInput.command`, `cwd`, and `envFacts` are supplied only by `@svvy/runtime` after it
validates an accepted native tool call, `RuntimeEffectRequest`, or immutable
`ExtensionExecutionPlan`. Extension handlers may describe desired work through those closed
contracts, but they never call `buildLaunchPolicy(...)`, assemble helper argv, inject raw env, own
subprocesses, or start child processes. The trusted process-launch object carrying raw env is
assembled only inside the runtime-owned command scope and is never persisted, encoded, or returned
through public facades. `@svvy/sandbox` does not decide what command to run and does not inject
product secrets.
When `snapshot` is absent, the sandbox service resolves one immutable snapshot from
`SandboxPolicySource` using `scope`, `surfacePiSessionId`, `commandId`, `launchKind`, and
`cwd`; when `snapshot` is present, the service validates and uses that exact snapshot. The returned
`SandboxLaunchFacts` preserves the command plan as `originalCommand` and provides the final
`spawn.executable` plus `spawn.args`. Runtime spawns exactly `spawn.executable` with `spawn.args`,
`spawn.cwd`, and the raw env corresponding to `spawn.envFacts`. Runtime must not append, prepend,
reparse, or reinterpret helper arguments from `helperPath`, `helperArgs`, `profilePath`, or
`originalCommand`.
`direct_apply_patch` sandbox launch facts model a file-effect intent, not an agent-facing shell command.
They wrap a runtime-owned apply-patch worker command plan. App bootstrap may provide only the
packaged worker path through a narrow host adapter; it does not choose patch semantics, target
paths, command ids, or sandbox permissions. The Apply Patch extension records semantic patch command
facts; sandbox only builds the immutable launch facts for the worker that applies those file
effects.

```ts
await sandbox.buildLaunchPolicy({
  scope: { kind: "workspace", workspaceId },
  commandId,
  launchKind: "direct_apply_patch",
  command: [applyPatchWorkerPath, "--command-id", commandId],
  cwd,
  envFacts,
});
```

`launchKind: "app_owned_generated_package_build"` is narrowly authorized for runtime-scheduled
app-global generated-package refresh operations over state-known `@svvyx/*` generated package
roots. It is not a general extension subprocess lane, not a Shell command kind, not a
workspace-link repair kind, and not a way for agents or renderer code to grant broader filesystem
access.
Its scope must be `{ kind: "app-global-generated-package", packageName }`; optional
`originWorkspaceId` is lineage for command links only.

`launchKind: "workspace_generated_package_link_repair"` is narrowly authorized for runtime-owned
workspace link repair after an app-global generated-package build has produced ready manifest
evidence and `@svvy/extensions` has returned an immutable
`GeneratedPackageWorkspaceLinkRepairPlan`. Its scope must be
`{ kind: "workspace-generated-package-link", workspaceId, packageName }`. The generated profile may
write only the exact workspace `.smithers/node_modules/@svvyx/<package>` link path and the minimum
parent directory entries needed to create or replace that link. It may read the app-owned generated
package root named by the link plan. It must not write app-owned generated package roots, arbitrary
workspace files, workflow source files, Smithers run state, extension sources, or package manager
state.

`launchKind: "extension_dependency_action"` is narrowly authorized for user-clicked Extensions UI
install/update commands over the app-owned extension package/install root. Its scope must be
`{ kind: "app-global-extension-dependency" }`; optional `originWorkspaceId` is lineage for command
links only. The generated profile may write only the extension package install root and app-owned
package-manager temp/cache roots required for that immutable command plan. It may not write any
workspace root, workspace `.smithers/`, generated package link, artifact directory, app
implementation source tree, developer-checkout-relative path, or renderer-selected path. It is not
an agent-callable shell lane and not a way to run arbitrary extension subprocesses.

Snapshot validation invariants:

- `scope`, `surfacePiSessionId`, `commandId`, and canonical `cwd` in the snapshot must match
  the launch input.
- `cwd` is canonicalized before fingerprinting and profile generation.
- `fingerprint` covers scope, optional surface id, command id, canonical cwd, filesystem policy,
  network policy, sandbox mode, launch kind, and generated-output/immutable-artifact roots.
- `profileDigest` covers the generated managed sandbox profile when `sandboxMode` is `"managed"`.
- Mismatches fail before process launch with a typed `SandboxPolicyError` reason
  `"snapshot-mismatch"`.
- `commandId` is required on `BuildLaunchPolicyInput`, `SandboxPolicySnapshotInput`, and
  `SandboxPolicySnapshot` for every runtime-owned launch kind. Preflight diagnostics without a
  command row must use a separate non-launch diagnostic input and cannot be used to start a
  subprocess or write command facts.
- The final `SandboxLaunchFacts` carries the exact `SandboxPolicySnapshot` used for launch so runtime can
  persist the snapshot fingerprint/profile digest on command facts and app logs without duplicating
  the whole policy in renderer payloads.
- `launchKind` is fingerprinted and must match between input and snapshot. Generated package roots,
  generated extension build roots, workspace `.svvy/generated`, and workspace
  `.smithers/node_modules/@svvyx/*` are read-only for `direct_shell`, `direct_apply_patch`,
  `execute_typescript_runtime`, ordinary `extension_facade_child`, and
  `extension_dependency_action` launches. Write access to
  generated roots is allowed only through an explicit app-owned generated-package build snapshot
  produced by runtime/state policy, never by command-string inspection.

`unrestrictedFileSystemPolicy()` is a pure access-helper/testing primitive. It is not the
full-access launch path. Full-access command execution uses `mode: "omitted_full_access"` and skips
managed OS sandbox helper/profile enforcement.

The package entrypoint exposes only the sandbox Effect service, the root layer, and sandbox-owned
contracts consumed by runtime/app bootstrap or sandbox diagnostics:

```ts
import {
  type CheckPathAccessInput,
  type HostProcessReferencePort,
  type HostProcessReferenceSnapshot,
  type PathAccessDecision,
  Sandbox,
  type SandboxDenial,
  type SandboxDenialInput,
  type SandboxHelperCandidatesPort,
  type SandboxHelperCandidatesSnapshot,
  layer,
} from "@svvy/sandbox";
```

Pure filesystem policy helpers, native helper lookup helpers, helper argv construction, and
helper-specific launch builders are package-private implementation details. If focused unit tests
need them, they may be exported from an explicit `@svvy/sandbox/testing` subpath only; they are not
part of the product package root. Runtime launch paths call `Sandbox.buildLaunchPolicy(...)` with a
`launchKind`; they do not call helper-specific builders such as
`buildDirectToolLaunchPolicy`, `buildExecuteTypescriptLaunchPolicy`, or `buildSvvyxLaunchPolicy`.
Runtime, Shell, Apply Patch, Execute TypeScript, extensions, desktop, browser tools, and app bridge
RPC handlers must not import helper path resolution, helper argv construction, sandbox profile
builders, or helper-specific launch builders from `@svvy/sandbox`.

Helper path resolution and helper argument construction are package-private implementation details
returned only as part of scoped `SandboxLaunchFacts`; runtime, Shell, Apply Patch, and Execute
TypeScript callers must not assemble helper argv themselves.

## Effect Resource And Error Model

- `buildLaunchPolicy(...)` resolves one immutable `SandboxPolicySnapshot` through
  `SandboxPolicySource.snapshot(...)` and is scoped:
  `Effect.Effect<SandboxLaunchFacts, SandboxPolicyError, Scope.Scope>`.
- Native helper path resolution and sandbox profile generation return typed `SandboxPolicyError`
  failures.
- Profile generation writes temporary profile artifacts through scoped effects when files are
  required and removes them through finalizers when the launch policy scope closes.
- Runtime command/session services acquire the launch policy, start the subprocess through the
  injected `ChildProcessSpawner.ChildProcessSpawner` service inside the same command scope, and
  close that scope only after process exit, cancellation, or terminal command fact recording. This
  applies to Shell, Apply Patch worker, Execute TypeScript, Shell-launched `svvyx ...`,
  generated-package build/link repair, extension dependency actions, and extension facade
  child-command launches when they require a subprocess. Scoped profile/helper artifacts must remain
  valid for the whole subprocess lifetime.
- Fail-closed behavior is represented as typed failure, not as a permissive launch policy.
- Sandbox does not own child process lifetime. It returns launch constraints and scoped
  helper/profile artifacts to runtime-owned command/session services, which own subprocess scopes,
  stdin/stdout/stderr, cancellation, terminal facts, retries, and recovery.

Runtime must acquire `Sandbox.buildLaunchPolicy(...)` inside the same runtime command scope that
owns `ChildProcessSpawner`. Managed `SandboxLaunchFacts` are scope-bound: helper/profile paths may
be used only while that scope is open, must remain valid for the whole child-process lifetime, and
must not be cached beyond persisted fingerprint/digest facts. Closing the command scope after child
exit, cancellation, or terminal fact recording releases sandbox temporary artifacts.

- Platform-specific inputs such as host environment, executable paths, app bundle paths,
  `sandbox-exec` helper availability, temporary profile file creation, and filesystem existence
  checks are injected through Effect platform/helper services. Product package code does not read
  `process.env`, `process.cwd()`, `process.execPath`, `import.meta.dir`, or raw `fs` directly except
  inside those platform adapters.
- Native helper lookup is deterministic and fail-closed. The sandbox package receives an injected
  ordered list of packaged helper candidates from app bootstrap, canonicalizes each candidate with
  the injected filesystem/path services, verifies that the selected path exists, is a regular
  executable file for the current platform, and is inside an app-owned packaged helper root or an
  explicitly configured test helper root. Source-checkout-relative fallback paths are not part of
  shipped product behavior. If no candidate passes validation, `buildLaunchPolicy(...)` fails before
  process launch; it does not fall back to unsandboxed execution, a permissive profile, or ad hoc
  TypeScript path validation.
- Helper validation and temporary profile creation happen inside the same launch-policy scope whose
  lifetime covers the subprocess using those artifacts. Closing that scope removes scoped temporary
  profile files and invalidates helper artifacts that were created for that launch.
- For path checks that may create a new file, containment is resolved against the nearest existing
  parent directory, not the nonexistent candidate path. The decision records both
  `canonicalParentPath` and `resolvedCandidatePath`; `canonicalPath` is used only when the target
  itself already exists. Symlink traversal, missing-parent chains, generated roots, protected
  metadata, and immutable artifact paths fail closed when the nearest existing parent cannot prove
  containment inside the allowed write root.

| Resource                           | Owner package/service                                                                           | Backing kind            | Lifetime kind     | Acquired by                                                                                       | Released by                                                                         | Reused across calls                                        | Interruption behavior                                                          | Required receipts/tests                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Sandbox policy snapshot            | `@svvy/state` `SandboxPolicySource` implementation; `@svvy/sandbox` consumes one immutable copy | DB/product-state-backed | `operationScoped` | `SandboxPolicySource.snapshot(...)` inside `buildLaunchPolicy`                                    | operation completion; persisted policy facts remain owned by state                  | no, each sandbox launch build reads one immutable snapshot | interruption cancels policy construction before returning sandbox launch facts | immutable snapshot test, fail-closed missing-policy test                 |
| Temporary sandbox profile file     | `@svvy/sandbox` launch-policy builder                                                           | file-backed             | `operationScoped` | scoped profile generation through injected `FileSystem.FileSystem` / `Path.Path`                  | sandbox launch scope close after subprocess exit/cancellation                       | no                                                         | interruption closes the scope and removes the temp profile                     | temp profile cleanup test, profile remains until subprocess scope closes |
| Helper artifact/path resolution    | `@svvy/sandbox` launch-policy builder                                                           | host resource           | `operationScoped` | helper candidate resolution while building `SandboxLaunchFacts`                                   | launch policy scope close; no process-global helper cache unless separately specced | no                                                         | interruption cancels resolution and releases any scoped helper artifact        | helper resolution typed-error test, no caller-built argv test            |
| Trusted launch object with raw env | runtime-private sandbox caller, not public core contract                                        | process-local           | `operationScoped` | runtime maps redacted/env-bearing trusted launch data from sandbox facts inside the command scope | command scope close or subprocess terminal fact                                     | no                                                         | interruption cancels the command scope; raw env is never persisted or encoded  | no-raw-env-in-facts test, redaction/fingerprint test                     |

Manual child scopes for sandbox launch-policy construction, temporary profile files, helper
artifact resolution, and trusted launch objects use `Scope.fork(parent, "sequential")` by default.
A row may use parallel finalization only when the package spec names independent resources and tests
prove no release-order dependency, no temp-file leak, and no raw-env/fact race.

## Sandbox Rules

- Approval is not the sandbox.
- Approval decides whether a tool action may start.
- Sandbox policy constrains filesystem and network effects after execution begins.
- Full-access mode omits sandboxing by policy; it is not represented as a permissive sandbox
  profile.
- Generated packages, generated extension builds, workspace generated package links, immutable
  artifacts, and protected metadata are read-only to ordinary command execution.
- TypeScript-only validation must not be described as filesystem or network sandbox enforcement.
- Sandbox setup must fail closed.
- Pure `checkPathAccess(...)` never reads state. It accepts a fully resolved immutable snapshot.
- Effectful launch policy construction may use `Effect`, `Layer`, and scoped temporary artifacts.
- Desktop/UI code may display sandbox facts from command and read models, but it must not call
  sandbox services to decide whether execution is allowed.
- `classifyDenial(...)` classifies observed helper/subprocess denial output. It does not decide
  retry, escalation, approval, fallback-to-unsandboxed execution, or command terminal status by
  itself.
- `classifyDenial(...)` never requests state ports, runtime ports, extension ports, approval ports,
  or UI callbacks, directly or indirectly. It is a policy/fact classifier, not a command lifecycle
  service.
- When `SandboxDenialInput.sandboxMode` is `"omitted_full_access"`, `classifyDenial(...)` returns
  `{ denied: false }`. Full-access launches have no managed helper/profile layer, so ordinary
  subprocess failures in that mode must not be reported as sandbox denial.
- Host-specific filesystem, path, temporary-file, executable-validation, and helper-candidate
  discovery are injected through platform/helper services. `@svvy/sandbox` provides deterministic
  `layerTest` fixtures with fake filesystem/path/helper services for policy, denial, and scoped
  profile tests.
- Boundary tests must assert `@svvy/sandbox` exports no retry/escalation helper and that denial
  classification returns only typed denial facts. Any full-access retry is a new runtime/approval
  decision outside `@svvy/sandbox`, not a same-call fallback recommended by the classifier.

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on Effect v4.
- May receive packaged native helper artifacts through app/bootstrap-provided
  `SandboxHelperCandidatesPort` snapshots.
- Must not depend on `@svvy/runtime`, `@svvy/extensions`, `@svvy/state`, `@svvy/desktop`, or UI
  packages.

## Product Source Ownership

Target package paths:

- `packages/sandbox/src/**`
- `src/native/svvy-sandbox-helper/**` for the packaged native helper artifact source

`packages/sandbox/src/**` owns filesystem sandbox policy construction, path-access decisions, macOS
seatbelt profile generation, packaged native helper discovery contracts, helper argument
construction, launch facts, and denial classification. The native helper artifact source is built
and packaged as an app-owned host artifact, but `@svvy/sandbox` owns the product contract used to
locate that artifact and describe its invocation. Runtime owns process launch and command lifecycle.

## Acceptance Criteria

- `@svvy/sandbox` builds launch policy from one immutable actor/workspace sandbox snapshot resolved
  before process launch.
- Full-access execution omits the managed sandbox layer entirely; it does not use permissive allow-all
  sandbox profiles.
- Sandbox setup fails closed before the process starts when required roots, helper binaries, or policy
  compilation are invalid.
- Sandbox denial classification reports typed facts for runtime/state/app-log handling, but does not
  decide approval, retry, turn status, or UI behavior.
- `@svvy/sandbox` imports no runtime, state, desktop, or extension implementation modules.
- Test layers preserve scoped temporary-file cleanup, helper lookup failure, canonical path behavior,
  and typed error mapping rather than bypassing the sandbox service with plain object mocks.

## Tests

- Filesystem precedence tests.
- `@effect/vitest` service/layer tests.
- Immutable snapshot tests proving pure checks do not read mutable state.
- Generated-output denial tests.
- Network allow/deny tests.
- Full-access omission tests.
- Native helper argument tests.
- Launch-policy seam tests proving runtime launch kinds use `Sandbox.buildLaunchPolicy(...)` and no
  public helper-specific launch builder is imported outside sandbox internals/tests.
- Shell string-to-launch-plan tests proving command strings are parsed before sandbox launch-policy
  construction and no raw shell string crosses the sandbox boundary.
- Boundary tests proving `@svvy/sandbox` imports no child-process, PTY, stdin/stdout,
  command-session, retry, or recovery adapters.
- Pipe-backed command session tests for `write_stdin`, backpressure, and closed-stdin behavior live
  with `@svvy/runtime` / Shell command-session tests, not in `@svvy/sandbox`.
- New-file containment tests covering nearest existing parent, `canonicalParentPath`,
  `resolvedCandidatePath`, missing parents, symlinks, generated roots, and immutable artifacts.
- Generated-root write-denial tests by `launchKind`, including ordinary Shell, Apply Patch, Execute
  TypeScript, extension child commands, and extension dependency actions.
- Command-id fingerprint tests proving snapshots without `commandId` cannot launch.
- Managed child-process network policy tests proving `networkPolicy: "deny"` produces egress-deny
  launch constraints for Shell, Apply Patch worker, Execute TypeScript, extension child commands,
  generated-package builds, and extension dependency actions.
- App HTTP policy wrapper tests live with app/bootstrap or the network-policy HTTP layer, not in
  `@svvy/sandbox`.
- `layerTest` fake filesystem/path/helper tests.
- Scoped temporary profile cleanup tests.
- Fail-closed typed error tests.
- Sandbox-denial classification tests.
