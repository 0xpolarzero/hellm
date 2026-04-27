# Pane Layout, Surface Ownership, And Expanded Surfaces Spec

## Status

- Date: 2026-04-27
- Status: adopted direction for Section 10 pane layout, surface ownership, and expanded surfaces
- Scope of this document:
  - define the durable user-driven pane grid layout
  - define the ownership boundary between pane layout state, durable workspace/session state, and live surface runtime state
  - define open, close, split, resize, and drag/drop placement semantics
  - define duplicate-pane behavior when multiple panes show the same live surface
  - define restart restore behavior for pane grid, occupancy, focus, and bindings
  - define sidebar pane-location indicators and focused-pane highlighting
  - define compact thread and workflow-run surfaces in the workspace shell timeline
  - define how handler-thread and workflow-inspector-related surfaces open into chosen panes

## Purpose

Section 10 makes the workspace shell a user-controlled working surface.

Users should be able to split, drag, resize, and close panes as their task demands, place surfaces deliberately, inspect related handler threads and workflow runs side by side, and restart the app without losing the useful workspace arrangement. The model is a flexible rectangular pane grid with independently sized rows and columns, constrained by practical minimum pane sizes and explicit close behavior.

The pane layout is UI state. It must not become a second runtime model, a transcript model, or a workflow execution model.

## Source Boundaries

Public Slate facts and `svvy` product choices must stay separate.

- Public Slate facts may inform the desired feel of visible orchestration and inspectable delegated work.
- PRD inferences define the `svvy` product direction: pi-backed surfaces, one strategic orchestrator, delegated handler threads, and Smithers-backed workflow supervision.
- This spec defines `svvy` implementation-level product choices for pane layout and surface binding. It is not evidence about Slate internals.

## Non-Goals

This section does not implement:

- a standalone terminal, custom shell, readline loop, or alternate TUI stack outside pi
- duplicate live runtimes for duplicated panes
- transcript parsing to recover layout, focus, or pane occupancy
- composer draft restoration
- stale live stream restoration
- workflow graph internals, which belong to the workflow inspector surface
- saved workflow library browsing, file editing, syntax highlighting, or diagnostics surfaces

## Core Model

The workspace shell owns a pane grid.

Rows and columns define deterministic layout tracks. Each track stores the percentage of available workspace width or height that it occupies. Panes occupy rectangular regions over those tracks. Pane records bind to surfaces or remain empty. Live surface runtimes live outside the grid and are keyed by `surfacePiSessionId`.

The same surface may be shown by more than one pane. Those panes share one live runtime and keep independent pane-local UI state.

## Stored Shape

The pane layout snapshot is durable workspace UI state:

```ts
type WorkspacePaneLayoutState = {
  columns: PaneGridTrack[];
  rows: PaneGridTrack[];
  panes: PaneGridPane[];
  focusedPaneId: string | null;
  updatedAt: string;
};

type PaneGridTrack = {
  id: string;
  percent: number;
};

type PaneGridPane = {
  paneId: string;
  columnStart: number;
  columnEnd: number;
  rowStart: number;
  rowEnd: number;
  binding: PaneSurfaceBinding | null;
  localState: PaneLocalState;
};
```

`columns` and `rows` are independent proportional tracks. They do not need to have the same count or percentages.

Track `percent` stores a percentage-like proportional size, not pixels. Column percentages normalize across all columns to represent the workspace width. Row percentages normalize across all rows to represent the workspace height. The renderer may repair small floating-point drift while preserving user intent.

Pane coordinates are deterministic half-open grid-line indexes. A pane covers columns `[columnStart, columnEnd)` and rows `[rowStart, rowEnd)`. This gives each pane a stable location while letting it span multiple tracks in either axis without requiring square cells.

Geometry is derived from the grid tracks, pane coordinates, available viewport, chrome, and enforced minimum sizes. Window resize must keep the same proportional layout by applying the stored column percentages to the available width and the stored row percentages to the available height.

The product should not persist independent per-pane pixel rectangles as the source of truth. Independent rectangles make shared edges harder to keep aligned and can create overlap or gaps after resize. The grid track model keeps shared edges shared.

## Proportional Layout Contract

The durable layout source of truth is:

- the ordered column track list
- the ordered row track list
- each pane's deterministic grid coordinates

Each pane's effective width percentage is the sum of the column percentages from `columnStart` up to, but not including, `columnEnd`.

Each pane's effective height percentage is the sum of the row percentages from `rowStart` up to, but not including, `rowEnd`.

Each pane's deterministic location is the pair of grid-line ranges:

- columns `[columnStart, columnEnd)`
- rows `[rowStart, rowEnd)`

For example, a pane with `columnStart: 1`, `columnEnd: 3`, `rowStart: 0`, and `rowEnd: 1` occupies columns 1 and 2 on row 0. Its width is the sum of column 1 and column 2 percentages. Its height is the row 0 percentage.

The renderer must treat these percentages and coordinates as the persisted layout. It must not persist the computed pixel rectangle as the durable layout identity.

When the app window or workspace pane area resizes:

- keep the same row and column percentages
- recompute pixel geometry from the new available width and height
- keep pane coordinates unchanged
- keep shared edges aligned because adjacent panes reference the same row or column boundaries
- do not create, remove, reorder, hide, collapse, or retarget panes as a side effect of resize

Only explicit user layout actions may change the durable layout:

- split
- close
- drag/drop placement
- divider resize
- explicit focus change

## Pane Surface Binding

Pane bindings are durable workspace UI state and are separate from live runtime state:

```ts
type PaneSurfaceBinding =
  | {
      kind: "orchestrator";
      workspaceSessionId: string;
      surfacePiSessionId: string;
    }
  | {
      kind: "handler-thread";
      workspaceSessionId: string;
      threadId: string;
      surfacePiSessionId: string;
    }
  | {
      kind: "workflow-inspector";
      workspaceSessionId: string;
      threadId: string;
      workflowRunId: string;
      surfacePiSessionId: string;
    }
  | {
      kind: "artifact";
      workspaceSessionId: string;
      artifactId: string;
      surfacePiSessionId: string | null;
    }
  | {
      kind: "project-ci";
      workspaceSessionId: string;
      ciRunId: string | null;
      surfacePiSessionId: string | null;
    };
```

`surfacePiSessionId` identifies the pi-backed live runtime when the surface is interactive. Non-interactive durable projections may not need a pi runtime and may store `null`.

A pane binding does not own:

- transcript history
- turns
- prompt locks
- model or reasoning state
- handler-thread lifecycle
- workflow-run lifecycle
- command state
- artifact records

Those belong to durable workspace/session state or live runtime state.

## Pane-Local State

Pane-local state is independent per pane even when panes show the same surface:

```ts
type PaneLocalState = {
  scroll: null | {
    transcriptAnchorId: string | null;
    offsetPx: number;
  };
  inspectorSelection:
    | null
    | { kind: "thread"; threadId: string }
    | { kind: "workflow-run"; workflowRunId: string }
    | { kind: "workflow-node"; workflowRunId: string; nodeId: string }
    | { kind: "artifact"; artifactId: string }
    | { kind: "ci-run"; ciRunId: string };
  timelineDensity: "compact" | "comfortable";
};
```

Pane-local state is durable workspace UI state. Scroll, inspector selection, and display preferences should persist per pane and restore when their referenced targets still exist.

## State Ownership

### Pane Layout State

Pane layout state owns:

- row and column track structure
- proportional track percentages
- pane ids
- pane grid coordinates
- pane surface bindings
- focused pane id
- pane-local scroll
- pane-local inspector selection
- pane-local display preferences such as timeline density

### Durable Workspace And Session State

Durable workspace/session state owns:

- workspace sessions
- orchestrator surfaces
- handler-thread records
- workflow-run records
- workflow-task-attempt records
- turns
- commands
- episodes
- waits
- Project CI records
- artifacts
- navigation metadata

Pane layout state references these records by id. It does not duplicate their lifecycle fields.

### Live Surface Runtime State

Live surface runtime state owns the process-local runtime controller keyed by `surfacePiSessionId`:

```ts
type LiveSurfaceRuntime = {
  surfacePiSessionId: string;
  workspaceSessionId: string;
  threadId: string | null;
  status: "idle" | "running" | "waiting" | "error";
  promptLock: unknown;
  modelState: unknown;
  reasoningState: unknown;
  cancellationState: unknown;
};
```

This registry is shared by panes. There must be at most one live controller per `surfacePiSessionId` in a renderer process.

## Duplicate Pane Semantics

Multiple panes may bind to the same `surfacePiSessionId`.

When that happens:

- transcript updates, turn status, tool activity, model state, and cancellation state come from the shared live runtime
- sending a message from either pane targets the same surface
- cancelling from either pane cancels the shared active turn for that surface
- pane-local scroll, inspector selection, and density remain independent
- focus changes only update `focusedPaneId`; they do not create, destroy, or retarget the live runtime

Duplicating a pane is a view operation, not a runtime fork.

Forking a session or handler thread, if supported by another feature, must create a distinct durable surface and therefore a distinct `surfacePiSessionId`.

## Minimum Sizes And Collapse

The pane grid is conceptually unbounded, but the renderer must enforce practical limits.

Each pane has a minimum usable size derived from pane chrome, composer controls when present, and the surface's minimum content width and height. The renderer must prevent splits and resizes that make any visible pane unusable.

If the viewport becomes too small for the current grid:

- preserve the durable grid, pane coordinates, track percentages, and bindings
- keep the focused pane visible and usable
- clamp divider movement so the user cannot resize panes below their minimum usable size
- allow the workspace pane area to scroll or expose an explicit overflow affordance when the current layout cannot fit
- avoid silently rearranging, hiding, or collapsing panes as a side effect of window resize
- restore the same proportional grid when enough space returns

Closing a pane must not delete the bound durable surface. It removes that pane from the grid unless the user explicitly chooses a destructive surface/session action elsewhere.

## Open Semantics

Opening a surface requires a placement target.

Supported open targets are:

```ts
type PaneOpenTarget =
  | { kind: "focused-pane" }
  | { kind: "pane"; paneId: string }
  | { kind: "split"; paneId: string; direction: "left" | "right" | "above" | "below"; size?: number }
  | { kind: "new-pane"; direction: "right" | "below"; size?: number };
```

Opening into an existing pane replaces that pane's binding and preserves the live surface runtime if another pane still uses it.

Opening via split inserts or reuses a row or column track adjacent to the targeted pane. The new pane receives the opened surface binding.

If no pane exists, opening a surface creates one column, one row, a single pane covering that region, and focuses it.

Opening a handler-thread surface makes that thread a fully interactive pi-backed surface in the chosen pane. Opening a workflow inspector creates or binds the read-only inspector surface for the selected workflow run in the chosen pane.

## Command Palette Placement

The command palette is defined by `docs/specs/command-palette.spec.md` as a shell/action surface. Once pane layout exists, command palette results that open a session or surface use pane placement semantics from this spec.

Default Enter behavior:

- command palette results that open a session or surface open in a new pane by default
- default Enter must not silently replace the currently focused pane
- if no pane exists, opening the result creates the first pane and focuses it

`Cmd+Enter` behavior:

- `Cmd+Enter` from the command palette opens the selected command or result into the currently focused pane
- opening into the focused pane replaces that pane's binding while preserving the opened surface's runtime ownership semantics
- if no focused pane exists, `Cmd+Enter` falls back to the default open behavior

Placement must preserve live runtime ownership:

- opening an existing interactive surface binds the chosen pane to that surface's existing `surfacePiSessionId`
- opening the same surface in multiple panes must not create duplicate live runtime controllers
- opening a new session creates a normal durable workspace session and orchestrator surface, then binds the chosen pane to that surface
- opening a handler-thread surface binds to that thread's pi-backed surface
- opening workflow inspector, artifact, or Project CI projection surfaces must preserve their durable state ownership and only create live runtime state when the surface kind requires it

## Close Semantics

Closing a pane removes one pane from the grid.

Close behavior:

- if the grid has one pane, clear that pane's binding instead of deleting the last pane
- remove empty row or column tracks when doing so does not change another pane's intended rectangle
- preserve proportional percentages for surviving tracks, then renormalize
- move focus to the nearest visible pane or the first visible pane
- do not close the live runtime if another pane still binds to the same `surfacePiSessionId`
- do not delete durable session, thread, workflow-run, artifact, or CI records

Closing a live surface is separate from closing a pane. A surface close command may detach all panes from that surface and release its live runtime only when no active turn, wait, or required restoration path depends on it.

## Split Semantics

Splitting a pane creates a new pane adjacent to the source pane.

Rules:

- split directions `left` and `right` insert or reuse a column track
- split directions `above` and `below` insert or reuse a row track
- splitting may duplicate the source binding or create an empty pane, depending on the user command
- default size is `0.5` for an even split unless a command supplies a proportional size
- a split is rejected if minimum sizes cannot be satisfied
- the new pane becomes focused
- the resulting grid tracks, pane coordinates, pane ids, surface bindings, focus, and track percentages are persisted

A split may adjust adjacent panes on the same row or column span so the final layout remains a non-overlapping rectangular tiling.

## Resize Semantics

Resize changes row or column track percentages.

Rules:

- dragging a column divider changes adjacent column percentages
- dragging a row divider changes adjacent row percentages
- percentages are persisted after the user commits a drag or keyboard resize
- minimum pane sizes clamp resize movement
- clamped sizes must still renormalize across the affected track set
- resize must not change surface bindings, focus, or live runtime ownership

The renderer may store pointer-level drag state outside durable layout while the resize is in progress. The committed resize is persisted.

## Drag And Drop Placement

Dragging a surface or pane over another pane should expose explicit placement zones:

- replace
- split left
- split right
- split above
- split below

Dropping a surface on `replace` binds the target pane to that surface.

Dropping a pane on a split zone moves that pane when the source is unique, or duplicates the binding when the command is explicitly a duplicate action. Moving a pane should preserve its pane-local state when the pane id moves with the pane.

Successful drag/drop placement persists the resulting grid tracks, pane coordinates, pane ids, surface bindings, focus, track percentages, and pane-local state.

Invalid drops must be rejected before mutation:

- drop would violate minimum sizes
- source and target are the same no-op placement
- target record no longer exists
- surface kind cannot be hosted in that pane context

## Restart Restore

On restart, restore:

- row and column tracks
- proportional track percentages
- pane ids
- pane grid coordinates
- pane occupancy and surface bindings
- focused pane when the pane still exists
- pane-local scroll when its anchor still exists
- pane-local inspector selection when the selected target still exists
- pane-local display preferences

On restart, do not restore:

- hover state
- open menus or popovers
- transient drag state
- in-progress composer drafts
- selected transcript text
- stale streaming state
- stale running-tool state

Restore should be lazy. The renderer may restore pane bindings first and hydrate the shared live runtime for a `surfacePiSessionId` only when a bound pane is visible, focused, or otherwise needs live data.

If a binding target no longer exists, the pane should show a non-destructive unavailable-surface state. The restore process must not delete the pane, delete durable records, or silently retarget the pane.

## Sidebar Indicators And Focus Highlight

The sidebar should show exact pane-location indicators for surfaces that are open in the current workspace layout.

The indicator should distinguish:

- not open
- open in one pane
- open in multiple panes
- focused in the current pane

The indicator should identify pane location using stable layout-derived labels such as `Left`, `Right`, `Top`, `Bottom`, or a compact row/column coordinate when the grid is deeper. The label is a UI affordance, not a storage key.

Clicking an open indicator should focus the matching pane. If a surface is open in multiple panes, the UI should let the user choose a specific pane or cycle through the matching panes predictably.

The focused pane must have a clear visual highlight in pane chrome. The highlight follows `focusedPaneId`, not global session recency and not the last surface that produced a runtime event.

## Compact Thread And Workflow-Run Surfaces

The workspace shell timeline should include compact surfaces for handler threads and workflow runs so the user can inspect delegated work without immediately opening a full interactive pane.

Compact handler-thread cards should show:

- thread title or objective
- status
- loaded context keys when present
- latest handoff summary when present
- active or latest workflow-run summary when present
- blocked reason when waiting
- actions to open the handler thread in a chosen pane

Compact workflow-run cards should show:

- workflow label or entry path
- normalized status
- raw Smithers status when useful for troubleshooting
- latest summary
- wait kind when blocked
- linked artifacts count
- action to open the workflow inspector in a chosen pane

Compact cards read durable structured state. They must not parse transcript text or raw Smithers logs to infer status.

## Handler Thread And Workflow Inspector Placement

Opening a handler thread from the sidebar, timeline, command result, or workflow-related card must use the pane placement semantics in this spec.

Opening a workflow-inspector-related surface must also use chosen-pane placement. Examples include:

- latest workflow run for a handler thread
- selected workflow run from a compact card
- selected workflow node drill-down
- related child workflow node
- related thread surface from a workflow inspector

The orchestrator does not absorb raw workflow history just because a workflow inspector is opened. The inspector is a chosen pane surface backed by durable workflow-run state and Smithers-native inspection APIs.

## Invariants

- The layout is a flexible pane grid.
- Rows and columns are independent proportional tracks that represent the pane area's width and height percentages.
- Panes occupy rectangular regions over those tracks.
- Panes store pane ids, grid coordinates, and surface bindings.
- A pane's effective width and height percentages are derived from the row and column tracks it spans.
- Window resize preserves the stored proportional layout.
- Pane ids are stable across normal resize, split, restore, and drag/move operations.
- Split, resize, close, drag/drop placement, focus, bindings, occupancy, track percentages, and pane-local state are persisted.
- Pane layout state is separate from durable session/workflow state.
- Pane layout state is separate from live surface runtime state.
- Live runtime controllers are keyed by `surfacePiSessionId`.
- There is at most one live runtime controller per `surfacePiSessionId` in a renderer process.
- Multiple panes may bind to the same `surfacePiSessionId`.
- Duplicate panes share live runtime state and keep independent pane-local UI state.
- Focus is pane focus, not surface ownership.
- Closing a pane does not delete the durable surface it showed.
- Restart restore never relies on transcript parsing.
- Missing restore targets render unavailable states instead of causing silent deletion.

## Relationship To Other Specs

- `docs/prd.md` defines the product-level relationship between pane layout state, durable surfaces, and pi-backed runtimes.
- `docs/specs/workspace-navigation-core-projection.spec.md` defines Section 8 navigation, core projection, and earlier restart restore boundaries that this spec expands for pane-grid layout.
- `docs/specs/command-palette.spec.md` defines Section 9 command palette and quick-open behavior, including the shell-level action surface whose pane-specific placement is defined here.
- `docs/specs/structured-session-state.spec.md` defines canonical session, thread, workflow-run, command, CI, artifact, wait, and lifecycle records that panes reference by id.
- `docs/specs/workflow-supervision.spec.md` defines workflow-run lifecycle and Smithers-native inspection behavior used by workflow inspector panes.
- `docs/specs/project-ci.spec.md` defines Project CI records that compact CI or workflow-run surfaces may reference.

## Product Outcomes

This design is successful when:

- users can split, drag, resize, and close panes freely within usable minimum pane sizes
- related orchestrator, handler-thread, workflow-run, and artifact surfaces can sit side by side
- duplicated panes show the same live surface without duplicating runtime controllers
- pane-local UI state remains independent across duplicated views
- restart restores the user's layout, occupancy, focus, durable bindings, and pane-local state without reviving stale transient UI state
- sidebar indicators make open surface locations obvious
- compact timeline cards expose delegated work without forcing the orchestrator to absorb raw workflow detail
