# Live Tool Projection Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines the shared live rendering model for current tool and command execution.

## Core Model

Tool rendering follows Codex-style turn items projected as execution-span cards:

1. show an execution-span card as soon as the tool name is known
2. stream large argument snapshots while the model is still producing arguments
3. hand the accepted call to runtime execution
4. stream runtime output, progress, waits, or child commands
5. settle the span from authoritative final command facts

The transcript card has three semantic levels:

- collapsed: action, target, status, duration, compact counts, useful outcome, inspect/artifact
  actions
- expanded: bounded nearby sections for accepted arguments, command target, file changes,
  diagnostics, progress, grouped stdout/stderr, child commands, and artifacts
- inspector: full trace/debugger for raw events, complete output, facts, snapshots, and artifacts

Once a command reaches a terminal state (`succeeded`, `failed`, or `cancelled`), its terminal
summary, facts, error, and finished timestamp are immutable. Prompt cleanup and late duplicate
callbacks may no-op, but they must not rewrite a completed command into a cancelled command.

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
span may show the submitted command, grouped stdout/stderr summary, exit status, duration, and
retained artifacts. It does not become a workflow-specific renderer.

## Shell And svvyx Commands

Shell projection records:

- command string
- working directory
- sandbox and approval mode
- status
- stdout and stderr deltas
- exit code or signal
- retained output artifact links when needed

Transcript spans group stdout and stderr separately, cap inline output, and route full output to the
command inspector or retained artifacts. Successful low-risk commands should remain compact; failed
commands should surface the first useful failure reason without requiring transcript archaeology.

`svvyx workflows ...` is a command-family Shell surface unless invoked through a generated
`execute_typescript` client.

## Apply Patch

`apply_patch` renders structured file-change previews from patch snapshots rather than requiring
many tiny patch calls. The collapsed span shows changed-file and diff counts. The expanded span shows
the latest file-change list and any patch diagnostics; the inspector keeps raw patch snapshots.

Final facts include changed files, created files, deleted files, and errors.

## Execute TypeScript

`execute_typescript` is one parent command.

Generated extension-client calls inside the snippet are child commands under that parent. Summary
children render as nested child spans inside the expanded parent card; trace-only children stay in
the command inspector and do not create top-level transcript cards.

## Workflows Commands

`svvyx workflows list`, `save`, `build`, and `models list` render as normal command-family work.

Expected display:

- `list`: loading state followed by generated export identity and paths
- `save`: source path, target kind/export, overwrite mode, save result, and build result
- `build`: build phases and diagnostics
- `models list`: provider/model/reasoning choices and auth/configuration status

## Recovery

The recovery source is durable command records, argument snapshots, command events, final command
facts, and retained artifacts.

Renderer code must not reconstruct command lifecycle by parsing transcript prose or rerunning tools.

Transcript execution-span cards are structured command projections. A span shows title, tool name,
target, command id, status, duration, compact metrics, useful outcome, streamed argument snapshots,
bounded output/progress/diagnostic/patch sections, summary child commands, linked artifacts, copy
actions, and an explicit inspect action when backed by a durable command id. It must not flatten
command facts into raw output text, render unbounded logs inline, use tool names as filenames, or
show artifact-open actions unless a real artifact link exists.
