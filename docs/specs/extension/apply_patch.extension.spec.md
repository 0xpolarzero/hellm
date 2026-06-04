# Apply Patch Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension index; detailed patch policy remains in `docs/specs/extensions-and-tools.spec.md`
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

| Actor kind | State |
| --- | --- |
| Orchestrator | `default_loaded` |
| Handler thread | `default_loaded` |
| Workflow task agent | `default_loaded` |

## Tool Surface

The Apply Patch extension exposes exactly:

```ts
apply_patch(patch)
```

Current detailed behavior is defined in:

- `docs/specs/extensions-and-tools.spec.md`, "Shell And Patch Work"
- `docs/specs/extensions-and-tools.spec.md`, "Apply Patch Source And Policy"
- `docs/specs/extensions-and-tools.spec.md`, "Execution Policy"
- `docs/specs/live-tool-projection.spec.md`, "File Change Projection"

## Notes

- Apply Patch is the editing surface for ordinary source files and editable extension source files.
- Apply Patch is not a shell, cannot run commands, and does not continue running processes.
- Command execution and long-running command continuation belong to the Shell extension.
