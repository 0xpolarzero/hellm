# Multi-Session Support Spec

## Status

- Date: 2026-06-08
- Status: adopted direction

## Scope

This spec defines multiple top-level sessions in one workspace window.

## Session Groups

The sidebar groups are:

- Pinned
- Sessions
- Archived

Archived is collapsed by default. Archive is reversible and does not delete session data.

## Session Actions

Session rows support:

- open in focused pane
- `Cmd`-click open in new pane
- mark read/unread
- pin/unpin
- rename
- archive/unarchive
- confirmed delete from the context menu

## Handler Threads

Handler-thread rows belong under their owning session.

Handler rows are interactive surfaces. Opening a handler row attaches that handler's
`surfacePiSessionId` to a Dockview panel.

Handler-local running/waiting/error state is row-local and must not automatically change the parent
session row.

## Titles

Top-level sessions use the durable title-generation flow from the first real user message.

Handler-thread titles are generated from the delegated objective.

## Unread State

Unread state is session-level metadata. It appears when assistant work finishes outside the focused
pane surface and clears when a pane for that session receives focus or an explicit mark-read action
runs.

## Non-Goals

- arbitrary user-created session folders
- deleting archived sessions automatically
