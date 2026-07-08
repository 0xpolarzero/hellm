# Apply Patch Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension index; detailed patch policy is owned by the package architecture,
  runtime, sandbox, and Effect specs named below
- Scope:
  - define Apply Patch as the builtin native-tool extension for structured file edits
  - point to the current canonical `apply_patch` contract

## Extension Record

```json
{
  "id": "apply-patch",
  "category": "builtin",
  "interface": "native_tool",
  "title": "Apply Patch",
  "description": "Codex-like structured patch editing for repository and allowed extension files.",
  "typescriptApiEnabled": false
}
```

Default usage:

| Actor kind          | State    |
| ------------------- | -------- |
| Orchestrator        | `loaded` |
| Handler thread      | `loaded` |
| Workflow task agent | `loaded` |

## Tool Surface

The Apply Patch extension exposes exactly:

```ts
apply_patch(patch);
```

Detailed behavior and package ownership are defined across:

- `docs/specs/package-architecture/extensions.spec.md`, "Apply Patch"
- `docs/specs/package-architecture/runtime.spec.md`, "BuildLaunchPolicyInput" and runtime-owned
  accepted native-tool execution
- `docs/specs/package-architecture/sandbox.spec.md`
- `docs/specs/package-architecture/effect-v4.spec.md`, "File, Path, Database, And Watcher Rules"
- `docs/specs/live-tool-projection.spec.md`, "File Change Projection"

## Notes

- Apply Patch is the editing surface for ordinary source files and editable extension source files.
- Apply Patch is not a shell, cannot run commands, and does not continue running processes.
- Command execution and long-running command continuation belong to the Shell extension.
- The extension owns the model-facing native tool contract. `@svvy/runtime` owns accepted execution,
  command facts, approval, atomic file-effect application, and committed diagnostics.
  `@svvy/sandbox` owns policy-to-launch/file-effect constraints. `@svvy/extensions` does not execute
  runtime-owned file work.
