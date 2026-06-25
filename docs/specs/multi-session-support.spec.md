# Multi-Session Support Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines multiple top-level sessions within one acquired workspace context, rendered
through workspace tabs and Dockview panes.

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
- fork from a selected assistant message when available
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

Top-level sessions show a provisional title from the first live composer draft or first real user
message until the durable one-shot namer title lands. The namer starts with the first orchestrator
turn. Manual rename is blocked while title generation is pending or running. A successful generated
title or manual rename freezes the title.

Handler-thread titles use the same durable namer flow over the delegated objective.

## Unread State

Unread state is session-level metadata persisted by `@svvy/state` and projected through session
navigation read models. It appears when assistant work finishes outside the focused pane surface and
clears when a pane for that session receives focus or an explicit state-backed mark-read command
runs.

## Non-Goals

- arbitrary user-created session folders
- deleting archived sessions automatically
