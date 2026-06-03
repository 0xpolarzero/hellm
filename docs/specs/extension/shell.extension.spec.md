# Shell Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension index; detailed execution policy remains in `docs/specs/extensions-and-tools.spec.md`
- Scope:
  - define Shell as the shipped native-tool extension for command execution
  - point to the current canonical `exec_command` and `write_stdin` contracts

## Extension Record

```json
{
  "id": "shell",
  "category": "shipped",
  "interface": "native_tool",
  "title": "Shell",
  "description": "Codex-like shell command execution and long-running command continuation.",
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

The Shell extension exposes exactly:

```ts
exec_command(input)
write_stdin(input)
```

Current detailed behavior is defined in:

- `docs/specs/extensions-and-tools.spec.md`, "Shell And Patch Work"
- `docs/specs/extensions-and-tools.spec.md`, "`exec_command` Source And Lifecycle"
- `docs/specs/extensions-and-tools.spec.md`, "`write_stdin`"
- `docs/specs/extensions-and-tools.spec.md`, "Execution Policy"
- `docs/specs/live-tool-projection.spec.md`, "Command Execution Projection"

## Notes

- `svvyx ...`, `git ...`, `gh ...`, `cx ...`, and `tinyfish ...` are ordinary shell commands when
  their corresponding instruction extensions tell an actor to use them.
- Shell does not own file editing. File edits belong to the Apply Patch extension.
- Shell does not own extension lifecycle, Git semantics, GitHub semantics, Web semantics, or workflow
  semantics.
