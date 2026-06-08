# Workspace Navigation And Core Projection Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines workspace navigation, session rows, handler-thread rows, artifact links, and
read-only Workflows pane placement.

## Sidebar Groups

The session sidebar contains:

- pinned sessions
- regular Sessions
- Archived sessions

Each group is collapsible, independently scrollable, vertically resizable, and persists collapsed
state and size per workspace. Archived is collapsed by default.

Session row context menu actions:

- Mark Read / Mark Unread
- Pin / Unpin
- Rename
- Archive / Unarchive
- Confirm Delete

Archive is reversible and non-destructive.

## Rows

Top-level session rows represent orchestrator state only.

Handler-thread rows appear under their parent session.

Handler-local waits, active handler turns, and handler repair work do not automatically change the
parent session row's status.

## Artifacts

Artifact links are shown from durable artifact records linked to sessions, threads, and commands.

Transcript links may still exist, but artifact projection should prefer structured artifact records.

## Workflows Pane

The Workflows sidebar entry opens the read-only Workflows pane.

The pane surfaces generated `@svvy/workflows` exports:

- `Agents`
- `Components`
- `Prompts`
- `Workflows`

Each row links to generated code and source code. Agent rows also link to the Agents pane for human
customization.

The Workflows pane is read-only generated-source visibility. It is not a source editor or workflow
runner.

## Restart Restore

Workspace shell restore includes:

- pinned and archived session state
- group collapsed and size state
- open Dockview panels and panel-to-surface bindings
- focused panel
- panel-local scroll and display preferences
- Workflows pane open state when present
- composer drafts and attachments

It does not restore transient menus, popovers, selected transcript text, temporary search
highlights, or stale stream state.

## Related Specs

- `docs/prd.md`
- `docs/specs/structured-session-state.spec.md`
- `docs/specs/workflow-library.spec.md`
- `docs/specs/pane-layout.spec.md`
