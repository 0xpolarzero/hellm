# Pane Layout, Surface Ownership, And Expanded Surfaces Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines Dockview layout ownership and surface placement.

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
- in-memory layout projection
- the serialized layout format consumed by product state

`@svvy/runtime` owns:

- live surface lifecycle keyed by `surfacePiSessionId`
- surface attach/release effects, live-surface disposal decisions, and recovery semantics

Dockview and the renderer own:

- transient Dockview projection
- focus, drag/drop, and scroll state
- user placement intent before it is submitted through product commands

`@svvy/state` owns durable layout records and restored layout read models. The renderer saves
durable layout changes through app/bootstrap-injected state command facades and refetches restored
layout state through app/bootstrap-injected state read facades.

`@svvy/state` owns durable layout records, panel metadata, panel-to-surface bindings, and their read
models. The renderer submits attach, detach, and layout-save requests through bootstrap-provided
facades and renders from refreshed read models. Renderer-local Dockview state is a projection of
those records and is not product truth.

Live pi surfaces are keyed by `surfacePiSessionId`, not by panel id.

## Surface Kinds

Dockview-bindable surface kinds:

- orchestrator surface
- handler-thread surface
- workflow task-agent attempt surface
- artifact inspector
- command inspector
- Logs pane
- Agents pane
- Extensions pane
- Workflows pane
- Snippets pane
- Settings pane
- Open Workspace pane

## Workflows Pane

The Workflows pane is read-only generated `@svvyx/workflows` visibility.

It can be opened in Dockview like any other static pane. It does not create a live pi surface.

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

Multiple panels may attach to the same live surface identity. `@svvy/runtime` owns live-surface
lifecycle; desktop only observes state/read-model updates, sends facade requests, and keeps
independent panel-local scroll state.

Closing the final panel binding submits a detach request through a bootstrap-provided facade.
Runtime release happens only through explicit runtime-owned surface/workspace owner scopes;
`@svvy/runtime` decides live-surface disposal from owner scopes, idle TTL, invalidation, or app
shutdown.
