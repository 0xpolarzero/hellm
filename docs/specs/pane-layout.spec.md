# Pane Layout, Surface Ownership, And Expanded Surfaces Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines Dockview layout ownership and current surface placement.

## Dockview Ownership

Dockview owns:

- panels
- groups
- tabs
- splitters
- drag/drop overlays
- edge groups
- floating groups
- popouts
- serialized layout restore

`svvy` owns:

- panel-to-surface bindings
- panel-local metadata
- product placement policy
- surface open/close semantics

Live pi surfaces are keyed by `surfacePiSessionId`, not by panel id.

## Current Surface Kinds

Current Dockview-bindable surface kinds:

- orchestrator surface
- handler-thread surface
- artifact inspector
- command inspector
- Logs pane
- Agents pane
- Extensions pane
- Workflows pane
- Settings pane
- Open Workspace pane

## Workflows Pane

The Workflows pane is read-only generated `@svvy/workflows` visibility.

It can be opened in Dockview like any other static pane. It does not create a live pi runtime.

## Layout Slots

Each workspace has three durable layout slots:

- `A`
- `B`
- `C`

Slots are keyed by `(workspaceId, layoutId)`.

The default workspace uses the same durable layout slots as user workspaces. Its only layout-specific exception is that opening an empty selected default-workspace slot creates one `Open Workspace` pane.

## Restore

Restore includes:

- Dockview serialized layout
- panel-to-surface bindings
- focused panel
- panel-local scroll/display preferences
- static pane targets that still exist

Restore does not recreate transient menus, selections, or stale live stream state.

## Placement

Opening a session or handler thread defaults to a new Dockview panel unless a command explicitly
targets the focused panel.

Opening Logs, Agents, Extensions, Workflows, Settings, artifacts, and command inspectors follows the
same placement policy.

Closing a panel detaches the panel. It does not delete durable session, thread, command, artifact,
or Workflows source state.

Multiple panels may attach to the same live surface. They share one backend live surface controller
and keep independent panel-local scroll state.
