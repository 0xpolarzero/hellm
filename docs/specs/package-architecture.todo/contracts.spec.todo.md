# `@svvy/contracts` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/contracts`

## Purpose

`@svvy/contracts` owns shared public TypeScript contracts.

It is the bottom package in the graph. It contains ids, schemas, discriminated unions, public event
types, read-model types, and versioned payload contracts. It contains no runtime behavior.

## Owns

- Actor kinds: orchestrator, handler thread, workflow task agent.
- Workspace, worktree, layout, session, surface, thread, group, turn, message, queue, command,
  episode, artifact, request-input, snippet, provider, model, extension, workflow, generated
  package, log, and title-job ids.
- Command lifecycle and command fact envelopes.
- Tool-call and native-control command contracts.
- Runtime event payloads.
- Extension record, usage, env declaration, dependency, readiness, and generated-client metadata
  contracts.
- Generated package read-model contracts for `@svvyx/workflows` and `@svvyx/extensions`.
- Artifact metadata contracts.
- App log and normalized error contracts.
- Workspace/session/surface read models.
- Worktree context contracts and read models.
- Settings and provider/auth status payload contracts.
- Sandbox policy source and policy snapshot contracts.
- Persistence schema version markers and migration payload contracts.

## Does Not Own

- Persistence.
- Runtime execution.
- pi integration.
- Extension building or invocation.
- Sandbox policy generation.
- UI rendering.
- File IO, database IO, or keychain IO.

## Public API Shape

The package should expose grouped modules:

```ts
import {
  Actors,
  Artifacts,
  Commands,
  Extensions,
  GeneratedPackages,
  Logs,
  Providers,
  Requests,
  RuntimeEvents,
  Sessions,
  Settings,
  Snippets,
  Threads,
  Titles,
  Workflows,
  Workspaces,
  Worktrees,
} from "@svvy/contracts";
```

The exact module names may change during implementation, but all exported contracts must be stable,
documented, and free of package-internal implementation objects.

## Sandbox Policy Port

`@svvy/contracts` defines the state-to-sandbox port shape so `@svvy/sandbox` can stay independent of
`@svvy/state`:

```ts
type SandboxPolicySource = {
  snapshot(input: SandboxPolicySnapshotInput): Promise<SandboxPolicySnapshot>;
};

type SandboxPolicySnapshotInput = {
  workspaceId: WorkspaceId;
  surfaceId?: SurfaceId;
  commandId?: CommandId;
  cwd?: AbsolutePath;
};
```

The snapshot must be resolved before launch policy generation and must be immutable for that launch.
It includes workspace roots, worktree roots, generated-output roots, immutable artifact roots,
protected metadata roots, network policy, and whether managed sandboxing is enabled or omitted for
full-access execution. It does not expose raw approval prompts or mutable state-store handles.

## Dependency Rules

- Must not depend on any other `@svvy/*` package.
- Must not depend on pi, Electrobun, Svelte, Incur, Smithers, filesystem APIs, database APIs, or
  native helper APIs.
- May depend on a schema library only if that dependency is accepted as part of the public contract.

## Versioning Rules

- Breaking public contract changes require a package major version bump once published.
- Persisted schema changes require explicit schema version handling.
- Additive read-model fields are preferred over replacement fields.
- This future design does not require compatibility aliases for removed generated package names.

## Migration Sources

Initial extraction candidates:

- `src/shared/workspace-contract.ts`
- `src/shared/extensions.ts`
- `src/shared/agent-settings.ts`
- `src/shared/generated-agent-context.ts`
- type sections of `src/bun/structured-session-state.ts`
- generated API declaration contracts under `generated/`

## Tests

- Compile-time public import tests.
- Schema validation tests.
- Event/read-model fixture tests.
- Persistence payload version tests.
