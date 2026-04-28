# Multi-Session And Multi-Surface Workspace Spec

## Status

- Date: 2026-04-21
- Status: adopted direction for workspace navigation, live surface ownership, and pane indirection
- Scope of this document:
  - define how one workspace hosts many durable sessions and many live surfaces at once
  - define the separation between workspace state, live surface state, and pane layout state
  - define the runtime contracts needed for multi-surface open, close, targeting, and rehydration
  - define the pane-to-surface model that later pane-layout UI builds on
  - defer detailed session pin/archive, artifact block, compact CI projection, and restore exclusions to `docs/specs/workspace-navigation-core-projection.spec.md`
  - defer detailed pane-grid layout, placement, duplicate-pane behavior, and expanded pane restore rules to `docs/specs/pane-layout.spec.md`

## Purpose

`svvy` needs real multi-surface workspace behavior, not a singleton runtime that happens to switch targets.

The product must support:

- many durable workspace sessions
- many live pi-backed interactive surfaces open at the same time
- pane layout state that points at surfaces without becoming surface identity
- shared live state when more than one pane shows the same surface
- explicit open and close semantics for each live surface

This spec defines the adopted steady-state architecture for that behavior.

## Adopted Direction

- Keep pi session files as the durable source of transcript history for orchestrator and handler-thread surfaces.
- Keep `svvy` structured state as the durable source of workspace, thread, workflow, command, episode, artifact, Project CI, and wait facts.
- Manage live interactive surfaces separately from durable workspace state.
- Key each live surface runtime by `surfacePiSessionId`.
- Give each live surface its own prompt lock, model state, reasoning state, cancellation state, and transcript snapshot.
- Treat pane layout as UI state that binds panes to surfaces; panes are not runtime identity.
- Allow more than one pane to bind to the same surface at once.
- Close a pane by detaching that pane from its surface.
- Close a surface by releasing its final owner and disposing its live runtime cleanly.
- Route workflow attention to the owning handler surface, never to whichever pane is focused.
- Emit workspace-level updates independently from surface-level transcript and runtime updates.
- Keep the session sidebar to active sessions, pinned active sessions, and one Archived group; arbitrary user-created session folders are out of scope.

## State Layers

The product has three different state layers and they must stay separate.

### 1. Workspace State

Workspace state is durable structured state plus workspace-scoped read models.

It owns:

- workspace metadata
- session summaries
- thread summaries and inspectors
- workflow-run summaries and inspectors
- command summaries and inspectors
- artifact metadata
- Project CI metadata
- wait and status read models

Workspace state is keyed by `workspaceSessionId` where needed and survives app reload or runtime disposal.

Workspace state must not depend on which pane is focused or which surface is currently open.

### 2. Live Surface State

Live surface state is the currently hydrated pi runtime for one interactive surface.

It owns:

- `surfacePiSessionId`
- actor kind
- current transcript messages
- streaming state
- prompt lock
- provider, model, and reasoning settings
- resolved system prompt
- live prompt execution context

Live surface state is keyed only by `surfacePiSessionId`.

If two panes show the same surface, they share this one live surface state.

### 3. Pane And Layout State

Pane state is UI-local layout and focus state.

It owns:

- pane ids
- which surface each pane is showing
- focused pane
- pane-grid geometry and pane occupancy
- pane-local view state such as scroll position or inspector selection

Pane state must not own transcript state, prompt locks, or model settings.

## Identity Model

The workspace uses four non-interchangeable identifiers.

### `workspaceSessionId`

The durable top-level session container id.

Use it for:

- session summaries
- session navigation
- structured session state
- thread and workflow inspectors
- restart recovery

### `surfacePiSessionId`

The pi session id for one interactive surface runtime.

Use it for:

- opening and closing a live surface runtime
- sending prompts
- cancelling prompts
- updating model or reasoning for one surface
- streaming transcript updates

### `threadId`

The durable delegated handler-thread record id.

Use it for:

- structured handler-thread state
- workflow ownership
- thread inspectors
- routing workflow attention

### `paneId`

The UI identity for one pane.

Use it for:

- layout persistence
- focus state
- pane-local projection state

`paneId` must never be reused as a session id or surface id.

## Surface Ownership And Lifecycle

### Opening A Surface

Opening a surface means hydrating or reusing the live surface runtime for one `surfacePiSessionId`.

Opening must be explicit.

The runtime should:

1. validate the requested surface target
2. create or reuse the managed live surface keyed by `surfacePiSessionId`
3. add an owner for that surface
4. return the current live surface snapshot

### Surface Owners

A live surface may have more than one owner.

The initial adopted owners are:

- pane attachments
- temporary runtime-owned background work such as workflow-attention turns

The live surface stays open while at least one owner exists.

### Closing A Pane

Closing a pane means:

- remove that pane's binding to the surface
- preserve the surface if any other owner still exists
- do not mutate workspace state just because one pane detached

### Closing A Surface

Closing a surface means:

- no pane or runtime owner still needs it
- any active prompt on that surface has already settled or has been cancelled intentionally
- the live runtime is disposed

Closing a surface must not delete durable workspace or transcript history.

### Workflow Attention

Workflow attention must target the owning handler surface by its `surfacePiSessionId`.

It must not:

- hijack whichever pane is focused
- retarget another open surface
- depend on a global active surface

If no pane currently owns that handler surface, the runtime may acquire a temporary background owner, run the synthetic handler turn, then release that owner when the turn settles.

## Runtime Contracts

The adopted runtime contract is split into workspace-scoped reads and surface-scoped reads or mutations.

### Workspace-Scoped Operations

Workspace-scoped operations read or mutate durable workspace state.

Examples:

- list session summaries
- inspect a handler thread
- inspect a command
- inspect workflow summaries
- update session title metadata

These operations target `workspaceSessionId` and must work whether or not the relevant surfaces are currently open.

### Surface-Scoped Operations

Surface-scoped operations target one live surface runtime.

Examples:

- open surface
- close surface
- send prompt
- cancel prompt
- update model
- update reasoning level

These operations target `surfacePiSessionId` and must not rely on a global active surface.

## Renderer Sync Model

The renderer must not rely on one monolithic active-session payload.

The adopted sync model has two lanes.

### Workspace Updates

Workspace updates carry durable read models such as:

- session summaries
- thread summaries
- workflow summaries
- command summaries
- workspace status

Workspace updates must not include or imply transcript ownership for one currently active surface.

### Surface Updates

Surface updates carry one live surface snapshot keyed by `surfacePiSessionId`.

They include:

- target identity
- transcript messages
- streaming state
- model and reasoning state
- system prompt state

The renderer joins surface updates with pane bindings locally.

## Frontend Ownership Rules

The frontend runtime should be split into:

- a workspace store for session summaries and structured read models
- a shared surface-controller registry keyed by `surfacePiSessionId`
- a pane/layout store keyed by `paneId`

Rules:

- a pane points at a surface controller; it does not own transcript state
- a surface controller may exist without being focused
- more than one pane may subscribe to the same surface controller
- pane focus chooses where commands such as "open session in focused pane" land, but focus does not redefine surface ownership
- closing the last pane bound to a surface should release that surface cleanly unless a runtime-owned background turn still holds it

## Sidebar And Pane Semantics

The left sidebar is workspace navigation, not runtime identity.

It is also not a general folder manager.

The adopted sidebar grouping is:

- pinned active sessions first
- remaining active sessions by recency
- one collapsed-by-default Archived group

Selecting a session from the sidebar should:

- choose a target pane
- bind that pane to the session's orchestrator surface by default
- leave other open panes and surfaces alone unless the user explicitly changes them

Opening a handler thread from the orchestrator should:

- resolve the thread's `surfacePiSessionId`
- bind the chosen pane to that surface
- reuse the existing live surface if already open elsewhere

## Shared-Surface Behavior

When multiple panes show the same surface:

- transcript content stays shared
- streaming state stays shared
- prompt locks stay shared
- model and reasoning settings stay shared
- pane-local scroll and selection may differ

The product must never duplicate the underlying live surface runtime just because two panes show it.

## Product Outcomes

The design is successful when:

- many surfaces can stay open at once without a global active-surface singleton
- each surface streams, cancels, and updates settings independently
- workspace summaries keep updating even when another surface is focused
- workflow attention always resumes the owning handler surface
- duplicated panes share one underlying live surface state
- closing a pane detaches UI state only
- closing the last owner of a surface disposes the live runtime cleanly without deleting durable state
