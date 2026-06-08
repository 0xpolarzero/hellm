# Live Tool Projection Spec

## Status

- Date: 2026-06-08
- Status: adopted direction

## Scope

This spec defines the shared live rendering model for current tool and command execution.

## Core Model

Tool rendering follows Codex-style turn items:

1. show a tool card as soon as the tool name is known
2. stream large argument snapshots while the model is still producing arguments
3. hand the accepted call to runtime execution
4. stream runtime output, progress, waits, or child commands
5. settle the card from authoritative final command facts

This model applies to:

- Shell commands through `exec_command`
- long-running shell sessions through `write_stdin`
- `apply_patch`
- `execute_typescript`
- generated `svvyx` extension-client child commands inside `execute_typescript`
- thread-control tools
- extension loading and inspection
- request-user-input

Prompt-only CLIs such as Smithers are projected as ordinary Shell command execution. The command
card may show the submitted command, output, exit status, and retained artifacts. It does not become
a workflow-specific renderer.

## Shell And svvyx Commands

Shell projection records:

- command string
- working directory
- sandbox and approval mode
- status
- stdout and stderr deltas
- exit code or signal
- retained output artifact links when needed

`svvyx workflows ...` is a command-family Shell surface unless invoked through a generated
`execute_typescript` client.

## Apply Patch

`apply_patch` renders structured file-change previews from patch snapshots rather than requiring
many tiny patch calls.

Final facts include changed files, created files, deleted files, and errors.

## Execute TypeScript

`execute_typescript` is one parent command.

Generated extension-client calls inside the snippet are child commands under that parent. Child
commands do not become top-level transcript cards unless a later UX decision explicitly promotes
them.

## Workflows Commands

`svvyx workflows list`, `save`, `build`, and `models list` render as normal command-family work.

Expected display:

- `list`: loading state followed by generated export identity and paths
- `save`: source path, target kind/export, overwrite mode, save result, and build result
- `build`: build phases and diagnostics
- `models list`: provider/model/reasoning choices and auth/configuration status

## Recovery

The recovery source is durable command facts plus retained artifacts.

Renderer code must not reconstruct command lifecycle by parsing transcript prose or rerunning tools.
