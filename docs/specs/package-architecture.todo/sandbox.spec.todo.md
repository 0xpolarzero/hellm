# `@svvy/sandbox` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/sandbox`

## Purpose

`@svvy/sandbox` owns filesystem and network execution policy.

It turns a resolved `SandboxPolicySnapshot` into concrete filesystem and network constraints used by
extension command execution.

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

Expected surface:

```ts
import { createSandbox } from "@svvy/sandbox";

const sandbox = createSandbox({ policySource });

const pathDecision = sandbox.checkPathAccess({ path, effect: "write" });
const launchPolicy = sandbox.buildLaunchPolicy({ workspaceId, cwd, networkAccess });
```

`policySource` must implement the `SandboxPolicySource` contract from `@svvy/contracts`.

Snapshot input:

- `workspaceId`
- optional `surfaceId`
- optional `commandId`
- optional `cwd`

Snapshot output:

- workspace roots and active worktree roots
- writable/read-only/blocked path rules
- generated-output roots
- immutable artifact roots
- protected metadata roots
- network allow/deny policy
- managed sandbox mode: `managed` or `omitted_full_access`

The sandbox package receives approval-derived sandbox mode only as resolved policy. It does not ask
for approval, inspect approval prompts, or read product settings directly.

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

## Dependency Rules

- Depends on `@svvy/contracts`.
- May depend on native helper artifacts.
- Must not depend on `@svvy/runtime`, `@svvy/extensions`, `@svvy/state`, `@svvy/desktop`, or UI
  packages.

## Migration Sources

Initial extraction candidates:

- `src/bun/filesystem-sandbox-policy.ts`
- `src/bun/sandbox-helper.ts`
- `src/native/svvy-sandbox-helper/`

## Tests

- Filesystem precedence tests.
- Generated-output denial tests.
- Network allow/deny tests.
- Full-access omission tests.
- Native helper argument tests.
- Sandbox-denial classification tests.
