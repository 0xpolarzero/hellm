# Command Palette And Quick Open Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines the shared command palette and quick-open shell.

## Product Boundary

The palette invokes existing product behavior. It must not become an alternate execution engine,
standalone shell, custom terminal loop, readline loop, or parallel workflow abstraction.

Palette actions route into:

- sessions
- orchestrator and handler-thread surfaces
- Dockview panel placement
- settings
- Agents
- Extensions
- read-only Workflows generated visibility
- generated agent-context preview actions
- future product actions once those actions have their own specs

Smithers execution remains ordinary Shell work inside an agent surface. The palette does not expose
Smithers-specific actions as product commands.

## Launching

- `Cmd+Shift+P` opens the shared palette with `>` prefilled.
- `Cmd+P` opens the same input with no prefix for file quick-open mode.
- Typing `>` as the first character switches the open palette into command mode.
- Removing the leading `>` switches back to quick-open mode.

The launcher chords remain available while text inputs are focused because they are command chords,
not text editing shortcuts.

## Command Mode

Command mode discovers product actions such as:

- New orchestrator
- open session
- pin or unpin session
- archive or unarchive session
- open handler thread
- open Logs
- open Agents
- open Extensions
- open Workflows
- open Settings
- Dockview placement actions when panes exist
- generated agent-context preview actions

Unmatched non-empty command-mode text creates a normal New orchestrator session using the text after
the `>` as the initial prompt.

That prompt enters the normal orchestrator turn model. It must not bypass system prompt loading,
prompt history, structured turn state, or live surface runtime ownership.

## Quick Open Mode

Unprefixed `Cmd+P` is reserved for file quick-open.

Until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist, file
quick-open is a placeholder or no-op. It must not fabricate file surfaces or introduce an ad hoc
file browsing path.

## Shortcut Registry

The product owns stable shortcut action ids, labels, platform chords, compact and readable display
strings, scope, input policy, availability, and routing metadata.

TanStack Hotkeys is the renderer binding primitive. It is not the source of product command
semantics.

Current sidebar shortcut order:

- `Cmd+Shift+1`: Logs
- `Cmd+Shift+2`: Agents
- `Cmd+Shift+3`: Extensions
- `Cmd+Shift+4`: Workflows

## Workflows Action

The Workflows command opens the read-only Workflows pane.

It shows the latest successful generated `@svvy/workflows` package.

## Related Specs

- `docs/prd.md`
- `docs/specs/workflow-library.spec.md`
- `docs/specs/extension/workflows.extension.spec.md`
- `docs/specs/extensions-and-tools.spec.md`
- `docs/specs/structured-session-state.spec.md`
