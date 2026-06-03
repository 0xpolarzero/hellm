# Dockview Pane Layout, Surface Ownership, And Expanded Surfaces Spec

## Status

- Date: 2026-05-12
- Status: adopted direction for Section 10 pane layout, Dockview integration, surface ownership, and expanded surfaces
- Scope of this document:
  - define the Dockview-backed workspace layout shell
  - define the ownership boundary between Dockview layout state, svvy panel metadata, durable workspace/session state, and live surface runtime state
  - define open, close, split, resize, drag/drop, floating, popout, edge-group, tab-group, and restore semantics
  - define duplicate-surface behavior when multiple Dockview panels show the same live surface
  - define sidebar panel-location indicators and focused-panel highlighting
  - define compact thread and workflow-run surfaces in the workspace shell timeline
  - define how handler-thread and workflow-inspector-related surfaces open into chosen Dockview targets

## Purpose

Section 10 makes the workspace shell a user-controlled working surface.

`svvy` uses Dockview as the panel and docking layout engine. Dockview owns the interactive layout mechanics: splitters, docking groups, tabs, tab groups, panel and group drag/drop, drop overlays, root-edge docking, floating groups, popout windows, layout serialization, and layout restoration. `svvy` owns product identity, surface binding, runtime ownership, panel-local metadata, workspace read models, and the rules that decide which surfaces may be opened, replaced, duplicated, closed, floated, or popped out.

Users should be able to split, drag, resize, tab, close, float, pop out, and restore surfaces as their task demands, place orchestrator and handler-thread surfaces deliberately, inspect workflow runs and artifacts beside active conversations, and restart the app without losing the useful workspace arrangement.

The Dockview layout is UI state. It must not become a second runtime model, transcript model, workflow execution model, or source of durable product truth.

## Source Boundaries

Public Slate facts and `svvy` product choices must stay separate.

- Public Slate facts may inform the desired feel of visible orchestration and inspectable delegated work.
- PRD inferences define the `svvy` product direction: pi-backed surfaces, one strategic orchestrator, delegated handler threads, and Smithers-backed workflow supervision.
- Dockview defines the layout interaction engine used by `svvy`; it is not evidence about Slate internals.

## Dockview Integration Boundary

`svvy` integrates the vanilla TypeScript Dockview core rather than depending on a React, Vue, or Angular wrapper.

The renderer hosts one Dockview workbench instance for the main workspace pane area. Dockview receives framework renderers that mount Svelte-owned surface hosts into Dockview panel content and tab/header areas. The Dockview instance may use Dockview CSS and theme variables, but the resulting chrome must match the rest of the `svvy` app.

The integration imports Dockview through the core package:

```ts
import { DockviewComponent } from "dockview-core";
import "dockview-core/dist/styles/dockview.css";
```

Dockview owns:

- panel and group docking
- tab strips and tab ordering
- tab groups, group headers, and group movement
- splitters and proportional group sizing
- drag sources and drop targets
- drop overlays and root-edge docking affordances
- floating groups
- browser popout windows when enabled
- serialized Dockview layout JSON
- Dockview layout, panel, group, drag/drop, floating, popout, and tab-group events

`svvy` owns:

- surface ids and bindings
- live runtime registry keyed by `surfacePiSessionId`
- durable session, thread, workflow-run, task-attempt, command, episode, artifact, wait, Project CI, and lifecycle records
- panel-local metadata such as scroll, density, display preferences, and unavailable-target state
- command palette placement semantics
- sidebar open-location indicators
- renderer subscriptions to live surface controllers
- product-specific close, duplicate, replace, restore, and runtime-release rules

Dockview events are input to svvy state updates. Dockview layout state is not allowed to infer or mutate durable session/workflow state except through explicit svvy commands.

## Non-Goals

This section does not implement:

- a standalone terminal, custom shell, readline loop, or alternate TUI stack outside pi
- duplicate live runtimes for duplicated surface views
- transcript parsing to recover layout, focus, panel occupancy, or surface status
- Dockview as a workflow runtime, session runtime, or artifact store
- composer draft restoration
- stale live stream restoration
- workflow run internals, which belong to the workflow inspector surface
- Workflows library browsing behavior, file editing, syntax highlighting, or diagnostics surfaces

## Core Model

The workspace shell owns a Dockview layout plus svvy panel metadata.

Dockview panels are visual containers. `svvy` surface bindings decide what product surface each Dockview panel hosts. Live surface runtimes live outside Dockview and are keyed by `surfacePiSessionId`.

The same product surface may be shown by more than one Dockview panel. Those panels share one live runtime and keep independent panel-local UI state.

On restart, restoring a panel binding uses the same product open path used by an explicit user open. Interactive orchestrator and handler-thread bindings open through the pi-backed surface catalog. Static inspector, artifact, and Project CI bindings remain durable projections and do not create pi runtimes unless their surface kind explicitly requires one. If two restored Dockview panels point at the same `surfacePiSessionId`, the renderer attaches both panels to one shared controller.

## Stored Shape

Each user workspace has three fixed durable layout slots: `A`, `B`, and `C`, keyed by `(workspaceId, layoutId)`. These slots are not user-renamable layouts. They are quick visual arrangements for the workspace and render as compact selectable controls pinned at the far right of the workspace chrome when a user workspace tab is active. Empty slots are visually muted, not disabled. Duplicate same-cwd workspace tabs share the same backend workspace runtime, durable sessions, live surface registry, queues, threads, workflow runs, app logs, workspace read models, and durable layout slots. Each tab stores only its active layout id.

The workspace tab record is chrome state. It chooses a shared runtime and, for user workspaces, the selected layout slot:

```ts
type WorkspaceLayoutSlotId = "A" | "B" | "C";

type WorkspaceTabChromeState = {
  version: 4;
  workspaceTabId: string;
  workspaceId: string;
  activeLayoutId: WorkspaceLayoutSlotId;
};
```

The persisted user workspace layout store is keyed by `workspaceId` and `layoutId`. It owns the durable Dockview layout snapshot for that workspace slot:

```ts
type WorkspaceLayoutStore = {
  version: 5;
  layouts: Record<WorkspaceLayoutSlotId, WorkspaceDockviewLayoutState | null>;
};
```

The workspace layout snapshot inside each slot is durable workspace UI state:

```ts
type WorkspaceDockviewLayoutState = {
  dockview: SerializedDockview | null;
  panels: WorkspaceDockviewPanelState[];
  compactSurfaces: CompactWorkspaceSurfaceState[];
  focusedPanelId: string | null;
  updatedAt: string;
};

type WorkspaceDockviewPanelState = {
  panelId: string;
  binding: PanelSurfaceBinding | null;
  localState: PaneLocalState;
  chrome: DockviewPanelChromeState;
  restore: DockviewPanelRestoreState;
};

type DockviewPanelChromeState = {
  title: string;
  subtitle: string | null;
  icon: string | null;
  kind:
    | "orchestrator"
    | "handler-thread"
    | "workflow-inspector"
    | "artifact"
    | "project-ci"
    | "empty"
    | "unavailable";
  closable: boolean;
  floatable: boolean;
  popoutable: boolean;
};

type DockviewPanelRestoreState = {
  unavailableReason: string | null;
  lastKnownLocationLabel: string | null;
};
```

`dockview` stores Dockview's serialized layout tree, including groups, panels, tabs, split sizes, floating groups, popout groups, edge groups, active group, and active panel data available through Dockview serialization.

`panels` stores svvy product metadata keyed by Dockview panel id. Dockview panel ids must be stable and must not encode transient visual position. Product code must treat Dockview's serialized layout as the layout source of truth and svvy panel metadata as the product binding layer.

If `dockview` is `null` or invalid, the active slot opens a single default Dockview panel bound to the primary orchestrator surface when one exists, or an empty panel otherwise.

A slot is initialized once it has been explicitly selected or saved, even if it currently contains no open panes. Empty slots are muted in the layout switcher but remain selectable. Selecting an empty slot creates an empty layout so the user can build the arrangement from scratch. An uninitialized slot also opens empty; it must not infer a session to display from the workspace catalog. If the user closes every pane in a slot, that empty layout is saved and restored as empty; restart must not reopen the last focused session just because the workspace still has sessions.

## Dockview Panel Identity

A Dockview panel id identifies one visual panel instance in the workspace layout.

Rules:

- panel ids are stable across normal resize, move, drag/drop, tab reorder, float, popout, restore, and focus changes
- duplicating a surface creates a new panel id with a copied binding and fresh panel-local state
- moving a panel preserves its panel id and panel-local state
- replacing a panel's binding keeps its panel id and resets binding-specific panel-local state unless the command explicitly preserves it
- closing a panel removes that visual panel but does not delete the bound durable surface
- Dockview-created panel ids must be reconciled into `WorkspaceDockviewPanelState` before persistence

## Panel Surface Binding

Panel bindings are durable workspace UI state and are separate from live runtime state:

```ts
type PanelSurfaceBinding =
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
      surfacePiSessionId: string | null;
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

`surfacePiSessionId` identifies the pi-backed live runtime when the surface is interactive. Non-interactive durable projections may store `null`.

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

## Panel-Local State

Panel-local state is independent per Dockview panel even when multiple panels show the same surface:

```ts
type PaneLocalState = {
  scroll: null | {
    transcriptAnchorId: string | null;
    offsetPx: number;
  };
  timelineDensity: "compact" | "comfortable";
};
```

Panel-local state is durable workspace layout state inside one `(workspaceId, layoutId)` slot. Scroll and display preferences should persist per panel. Artifact, command, workflow, workflow-task-attempt, Project CI, and other static inspector surfaces restore from explicit pane targets rather than from a panel-local selection or focused/current session. Duplicate same-cwd workspace tabs share panel-local state when they select the same layout slot because they are viewing the same durable layout document; selecting different layout ids gives them different workspace-owned slot state.

## State Ownership

### Dockview Layout State

Dockview layout state owns:

- group and panel arrangement
- tab strips and tab order
- split sizes
- active group and active panel
- floating group positions
- popout group metadata
- edge-group visibility and placement
- group maximization state when used
- Dockview-managed drag, drop, resize, and tab-group behavior

### svvy Panel Metadata

svvy panel metadata owns:

- panel ids as product-visible visual pane ids
- panel surface bindings
- panel-local scroll
- panel-local display preferences such as timeline density
- panel chrome labels and product kind
- unavailable-surface restore state
- sidebar location labels derived from Dockview layout

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

Panel metadata references these records by id. It does not duplicate their lifecycle fields.

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

This registry is shared by Dockview panels. There must be at most one live controller per `surfacePiSessionId` in a renderer process.

## Dockview Renderers

The Dockview core integration must provide renderers for:

- surface content
- default empty panel content
- unavailable-surface content
- tab labels
- group header actions
- optional tab-group chips
- optional watermark or empty-workbench state
- context menu items when enabled

The content renderer mounts the correct Svelte surface host for the panel binding. The renderer must subscribe to the shared live runtime controller only when the binding requires one and must unsubscribe when the panel unmounts, closes, floats, pops out, or changes binding.

Dockview core renderers are DOM-oriented. The Svelte adapter must construct renderer objects around Dockview's renderer lifecycle and mount Svelte components into their `element`.

Renderer objects may implement:

- `element`
- `init`
- `update`
- `layout`
- `focus`
- `toJSON`
- `dispose`
- `onShow`
- `onHide`

The adapter must dispose every mounted Svelte component from the renderer `dispose` path and call `dockview.dispose()` when the workspace Dockview host unmounts.

Renderer behavior:

- hidden inactive tabs must not create duplicate live runtimes
- panel visibility changes may pause expensive viewport work but must not pause the underlying active turn
- panel resize events must notify transcript, inspector, and artifact surfaces that need measurement
- renderer mode must be chosen deliberately for surfaces whose DOM state should remain mounted while hidden

Dockview panel renderer mode is product-significant:

```ts
type DockviewPanelRenderer = "onlyWhenVisible" | "always";
```

Use `onlyWhenVisible` for cheap static projections. Use `always` for live pi-backed surfaces, active transcripts, running task output, terminal-like embedded surfaces, browser/devtools embeds, and any panel where DOM teardown would destroy useful local interaction state. `always` is a rendering persistence policy only; runtime identity still belongs to `surfacePiSessionId`.

## Dockview Drag And Drop

Dockview's built-in drag/drop and overlay system is the canonical pane placement mechanism.

The integration must use Dockview's drop targets and overlay events for:

- moving panels between groups
- moving whole groups
- docking to another group
- docking to the workbench root edges
- merging panels into an existing tab group
- reordering tabs within a group
- accepting external svvy surface drags from sidebar, compact cards, command results, and related-target links

The integration must configure Dockview `dndEdges` so root-edge drop targets support workspace-edge placement. The edge activation and overlay size should be tuned for a desktop coding app:

- edge activation must be discoverable without occupying excessive workspace area
- overlay previews must be visual, not text-label driven
- small panels must degrade to line previews instead of unusable blocks
- invalid drops must suppress overlays through `onWillShowOverlay`

`dndEdges` must be explicit because root-edge docking is product-critical:

```ts
type DroptargetOverlayModel = {
  size?: { value: number; type: "pixels" | "percentage" };
  activationSize?: { value: number; type: "pixels" | "percentage" };
  smallWidthBoundary?: number;
  smallHeightBoundary?: number;
};
```

`activationSize` controls how close the pointer must be to a Dockview target edge before an overlay appears. `size` controls the preview region size. `smallWidthBoundary` and `smallHeightBoundary` switch cramped targets to line-style previews. `dndEdges: false` disables far-edge root overlays and should only be used for focused modes that intentionally lock layout editing.

The integration must listen to Dockview drag/drop events:

- `onWillDragPanel`
- `onWillDragGroup`
- `onWillShowOverlay`
- `onWillDrop`
- `onDidDrop`
- `onUnhandledDragOverEvent`
- panel and group movement events

Use these events to enforce svvy policy before mutation:

- reject drops that target a stale or missing panel
- reject drops into product contexts that cannot host the dragged surface kind
- reject drops that would violate minimum usable size constraints
- reject no-op placement when source and target are the same panel and same position
- reject destructive surface closure through a visual close action unless the command is explicitly destructive
- allow external drags only after the dragged data resolves to a valid svvy surface target

Dockview's overlay is the user-facing drag preview. `svvy` must not maintain a parallel custom pane-hover preview system for the same drag.

## External Surface Drags

Surfaces may be dragged into Dockview from:

- session sidebar rows
- sidebar panel-location indicators
- compact handler-thread cards
- compact workflow-run cards
- workflow inspector related-target links
- artifact links
- Project CI projections
- command palette results when a drag affordance exists

External drags must carry structured svvy data, not transcript text:

```ts
type SurfaceDragPayload = {
  type: "svvy.surface";
  binding: PanelSurfaceBinding;
  duplicate: boolean;
  sourcePanelId: string | null;
};
```

Dockview `onUnhandledDragOverEvent` is responsible for accepting external drags only when the payload is valid and the proposed Dockview target can host the binding. On accepted drop, the integration must create or update a Dockview panel through the normal svvy open/placement path.

Dockview internal transfer metadata may include `viewId`, `groupId`, `panelId`, and `tabGroupId`. `svvy` must use that metadata only to resolve the visual source of a drag. Durable product identity must still come from svvy panel metadata and surface bindings.

## Open Semantics

Opening a surface requires a placement target:

```ts
type DockviewOpenTarget =
  | { kind: "focused-panel" }
  | { kind: "panel"; panelId: string }
  | {
      kind: "split";
      panelId: string;
      direction: "left" | "right" | "above" | "below";
      size?: number;
    }
  | { kind: "tab"; groupId: string; index?: number }
  | { kind: "new-panel"; direction: "right" | "below"; size?: number }
  | { kind: "edge"; direction: "left" | "right" | "above" | "below"; size?: number }
  | { kind: "floating"; box?: { x: number; y: number; width: number; height: number } }
  | { kind: "popout"; box?: { left: number; top: number; width: number; height: number } };
```

Opening into an existing panel replaces that panel's binding and preserves the live surface runtime if another panel still uses it.

Opening via split delegates group creation and sizing to Dockview, then records the created panel metadata. The new panel receives the opened surface binding.

Opening via tab inserts the surface into an existing Dockview group as a tab. The group active tab should become the new panel unless the command explicitly opens inactive.

Opening via edge creates a new root-edge group using Dockview's supported placement.

Opening via floating creates a Dockview floating group with one panel.

Opening via popout creates a Dockview popout group only when popouts are enabled and compatible with the Electrobun window environment. Failed popout creation must leave the source layout unchanged and surface a non-destructive error.

If no Dockview panel exists, opening a surface creates one default group with one panel and focuses it.

Opening a handler-thread surface makes that thread a fully interactive pi-backed surface in the chosen panel. Opening a workflow inspector creates or binds the read-only inspector surface for the selected workflow run in the chosen panel.

## Sidebar Session Placement

Session sidebar rows use Dockview placement semantics directly:

- a normal click opens the session in the currently focused panel
- `Cmd`-click opens the session in a new right-side panel, including when the clicked session is already active in the focused panel
- if no focused panel exists, focused-panel placement falls back to the normal first-panel creation behavior

## Command Palette Placement

The command palette is defined by `docs/specs/command-palette.spec.md` as a shell/action surface. Command palette results that open a session or surface use Dockview placement semantics from this spec.

Default Enter behavior:

- command palette results that open a session or surface open in a new Dockview panel by default
- default Enter must not silently replace the currently focused panel
- if no panel exists, opening the result creates the first panel and focuses it

`Cmd+Enter` behavior:

- `Cmd+Enter` from the command palette is a shortcut-registry action routed through palette selection state into Dockview placement and opens the selected command or result into the currently focused panel
- opening into the focused panel replaces that panel's binding while preserving the opened surface's runtime ownership semantics
- if no focused panel exists, `Cmd+Enter` falls back to the default open behavior

Placement must preserve live runtime ownership:

- opening an existing interactive surface binds the chosen panel to that surface's existing `surfacePiSessionId`
- opening the same surface in multiple panels must not create duplicate live runtime controllers
- opening a New orchestrator session creates a normal durable workspace session and orchestrator surface, then binds the chosen panel to that surface
- opening a handler-thread surface binds to that thread's pi-backed surface
- opening workflow inspector, artifact, or Project CI projection surfaces must preserve their durable state ownership and only create live runtime state when the surface kind requires it

## Close Semantics

Closing a Dockview panel removes one visual panel from the layout.

Close behavior:

- if the layout has one panel, clear that panel's binding instead of deleting the last visual panel
- Dockview may remove now-empty groups as part of its normal layout model
- focus moves according to Dockview active-panel behavior, then svvy records the active panel id
- closing a panel does not close the bound durable session, thread, workflow-run, artifact, or CI record
- closing a panel does not release the live runtime if another panel still binds to the same `surfacePiSessionId`
- closing the last panel bound to a live surface releases the renderer subscription but does not delete durable state
- active turns, waits, and required restoration paths remain owned by the surface runtime and durable state, not by panel presence

Closing a live surface is separate from closing a panel. A surface close command may detach all panels from that surface and release its live runtime only when no active turn, wait, or required restoration path depends on it.

## Split And Resize Semantics

Splitting creates a Dockview panel adjacent to the source panel.

Rules:

- split directions `left`, `right`, `above`, and `below` map to Dockview direction placement
- splitting may duplicate the source binding or create an empty panel, depending on the user command
- default size is an even split unless a command supplies a proportional size that Dockview can express
- a split is rejected if minimum sizes cannot be satisfied
- the new panel becomes focused unless opened inactive by an explicit command
- the resulting Dockview layout JSON, panel metadata, focus, bindings, and panel-local state are persisted

Resize is Dockview splitter movement.

Rules:

- Dockview owns live splitter drag behavior
- minimum size constraints are supplied through Dockview panel or group constraints where available
- resize must not change surface bindings, focus policy beyond normal Dockview active behavior, or live runtime ownership
- persisted Dockview layout state records the committed sizes

Dockview constraints are not the durable source of truth because constraints are not serialized by Dockview and apply at the group level. `svvy` must derive constraints from panel kind, surface content, and product policy, then reapply them after `fromJSON`, group creation, panel movement, floating restore, popout restore, and edge-group creation.

## Minimum Sizes And Collapse

Each panel has a minimum usable size derived from pane chrome, composer controls when present, and the surface's minimum content width and height.

The integration should express minimums through Dockview constraints wherever possible and enforce any product-only minimum through `onWillShowOverlay`, `onWillDrop`, and open/split command validation.

If the viewport becomes too small for the current layout:

- preserve the durable Dockview layout and panel metadata
- keep the focused panel visible and usable where possible
- clamp splitter movement so the user cannot resize panels below their minimum usable size
- allow the workspace pane area to scroll or expose an explicit overflow affordance when the current layout cannot fit
- avoid silently retargeting panels as a side effect of window resize
- restore the same Dockview layout when enough space returns

Collapsible Dockview edge groups may be used for side surfaces only when they preserve the same product surface binding and restore semantics as normal panels.

## Tab Groups

Dockview tab groups may be used to cluster related panels in a group header.

Supported Dockview tab-group operations include:

- create tab group
- dissolve tab group
- add panel to tab group
- remove panel from tab group
- move tab group within a group
- get tab groups for a group
- get the tab group for a panel
- set label
- set color
- set component params
- collapse
- expand
- toggle

The integration should listen to tab-group lifecycle events:

- created
- destroyed
- panel added
- panel removed
- changed
- collapsed or expanded

Supported product uses:

- grouping multiple related handler-thread surfaces under one visual group
- grouping workflow inspector, workflow run detail, and related artifacts
- grouping artifact previews
- grouping Project CI projections with related workflow-run inspectors

Rules:

- tab group labels and colors are UI metadata, not durable product tags
- tab groups may be serialized as part of Dockview layout JSON
- tab group creation, rename, color, collapse, and dissolve actions must not change product state
- closing a tab group closes or detaches visual panels according to explicit Dockview and svvy close policy, without deleting durable records
- group color palette should use svvy theme tokens or Dockview theme variables, not hard-coded unrelated colors

Built-in tab-group context menu affordances such as rename and color picker may be used only when they are framed as visual layout metadata. Custom tab-group chip renderers may be used to show product-aware grouping hints, but they must not make tab groups the source of product lifecycle state.

## Edge Groups

Dockview edge groups may host secondary surfaces that benefit from IDE-like collapsible side placement.

Supported Dockview edge-group operations include:

- add edge group at `top`, `bottom`, `left`, or `right`
- get edge group
- set edge-group visibility
- read edge-group visibility
- remove edge group

Edge-group options include id, initial size, minimum size, maximum size, collapsed size, and collapsed state. Edge groups participate in Dockview serialization.

Allowed edge-group surface classes:

- artifact previews
- Project CI summary
- Workflows library
- related inspector views
- non-primary workflow inspector auxiliaries

Default orchestrator and handler-thread conversation surfaces should open as normal Dockview panels, not hidden edge groups, unless the user explicitly places them there.

Edge-group visibility is layout state. Hiding an edge group must not close the bound durable surface or release a live runtime if another visible panel still uses it.

Edge groups cannot be treated as general floating or popout groups. They are structural workspace regions. Removing all panels from an edge group may collapse it visually, but must not delete the durable product records those panels referenced.

## Floating Groups And Popouts

Dockview floating groups are part of the supported layout model.

Floating rules:

- floating a panel or group preserves panel ids, bindings, and panel-local state
- floating group bounds are persisted through Dockview layout JSON
- floating is disabled for surfaces that cannot render correctly outside the main workspace coordinate context
- focus follows the active floating group or panel

Popout rules:

- popout windows may be enabled only after validating they work in Electrobun with same-origin content, styles, keyboard shortcuts, focus, and renderer subscriptions
- popout windows require a packaged-app-safe same-origin popout route or `popout.html`; no dev-server-only path is acceptable
- popout windows preserve bindings and panel-local state
- popout window position and size are persisted when Dockview provides them
- popout failure must report a non-destructive error and keep the source group in the main layout
- popout content must use the popout window's document for event listeners, measurements, and focus handling when required
- a popout window must not create a second live runtime for a duplicated `surfacePiSessionId`
- popout overlays, tab context menus, and tab-group popovers must render in the popout window's document
- lazily injected app styles must be available to the popout route before popouts are enabled by default

Popouts are useful for multi-monitor inspection, but the main product must work without popouts.

## Duplicate Surface Semantics

Multiple Dockview panels may bind to the same `surfacePiSessionId`.

When that happens:

- transcript updates, turn status, tool activity, model state, and cancellation state come from the shared live runtime
- sending a message from either panel targets the same surface
- cancelling from either panel cancels the shared active turn for that surface
- panel-local scroll and density remain independent
- focus changes only update `focusedPanelId`; they do not create, destroy, or retarget the live runtime

Duplicating a panel is a view operation, not a runtime fork.

Forking a session or handler thread, if supported by another feature, must create a distinct durable surface and therefore a distinct `surfacePiSessionId`.

## Restart Restore

On restart, restore:

- Dockview serialized layout
- Dockview panels, groups, tabs, split sizes, floating groups, popout groups, edge groups, active group, and active panel where supported
- svvy panel ids
- panel occupancy and surface bindings
- focused panel when the panel still exists
- panel-local scroll when its anchor still exists
- panel-local display preferences
- unavailable-surface state for bindings whose durable target no longer exists

On restart, do not restore:

- hover state
- open menus or popovers
- transient drag state
- in-progress composer drafts
- selected transcript text
- stale streaming state
- stale running-tool state

Restore should be lazy. The renderer may restore panel bindings first and hydrate the shared live runtime for a `surfacePiSessionId` only when a bound panel is visible, focused, or otherwise needs live data.

Restored interactive bindings receive fresh surface snapshots from the Bun catalog. Those snapshots carry the current prompt lock, model, reasoning, messages, and resolved system prompt for that surface. The renderer treats the snapshot as authoritative and does not infer busy or waiting state from transcript text.

If a binding target no longer exists, the panel should show a non-destructive unavailable-surface state. The restore process must not delete the panel, delete durable records, or silently retarget the panel.

If Dockview layout JSON is corrupt or incompatible, the renderer should preserve svvy panel metadata where possible, create a simple fallback Dockview layout from the known panel list, mark the restore issue visibly, and avoid deleting durable product records.

## Persistence And Event Flow

The renderer persists layout after meaningful Dockview changes:

- panel added
- panel removed
- panel moved
- group added
- group removed
- group resized
- active panel changed
- active group changed
- layout loaded from JSON
- floating group moved or resized
- popout group moved or resized
- edge-group visibility changed
- tab group created, changed, collapsed, or destroyed
- active `A`/`B`/`C` layout slot changed on a workspace tab

Dockview layout is restored from the active user workspace tab's selected `(workspaceId, layoutId)` slot with `fromJSON`. When existing renderer instances should be reused, the integration should use Dockview's existing-panel reuse path rather than tearing down live Svelte hosts unnecessarily. After `fromJSON`, `svvy` must reconcile the restored Dockview panel ids with svvy panel metadata, reapply constraints, reattach renderer subscriptions, and mark missing product targets as unavailable. Default workspace tabs do not load or persist these slots; they initialize with one `Open Workspace` pane and any later pane changes remain ephemeral.

Persistence should debounce high-frequency layout updates such as splitter movement and floating resize.

The persisted layout update is scoped by the shared runtime `workspaceId` and writes the workspace's `A`/`B`/`C` layout snapshots in one logical workspace layout update so layout and bindings do not drift across duplicate tabs. The workspace tab chrome update stores only the tab id, selected `workspaceId`, and active layout id.

## Sidebar Indicators And Focus Highlight

The sidebar should show exact Dockview-location indicators for surfaces that are open in the current workspace layout.

The indicator should distinguish:

- not open
- open in one panel
- open in multiple panels
- focused in the current panel
- open in a floating group
- open in a popout window
- open in an edge group

The label should be derived from Dockview layout state and should be stable enough for humans, such as `Left`, `Right`, `Top`, `Bottom`, `Tab 2`, `Floating`, `Popout`, `Edge Left`, or a compact group/panel coordinate when the layout is deeper. The label is a UI affordance, not a storage key.

Clicking an open indicator should focus the matching Dockview panel. If a surface is open in multiple panels, the UI should let the user choose a specific panel or cycle through the matching panels predictably.

The focused panel must have a clear visual highlight in Dockview panel chrome. The highlight follows `focusedPanelId`, not global session recency and not the last surface that produced a runtime event.

## Compact Thread And Workflow-Run Surfaces

The workspace shell timeline should include compact surfaces for handler threads and workflow runs so the user can inspect delegated work without immediately opening a full interactive panel.

Compact handler-thread cards should show:

- thread title or objective
- status
- loaded extension ids or generated agent context summary when present
- latest thread episode summary when present
- active or latest workflow-run summary when present
- blocked reason when waiting
- actions to open the handler thread in a chosen Dockview target
- optional drag affordance that opens or duplicates the handler thread through Dockview external DnD

Compact workflow-run cards should show:

- workflow label or entry path
- normalized status
- raw Smithers status when useful for troubleshooting
- latest summary
- wait kind when blocked
- linked artifacts count
- action to open the workflow inspector in a chosen Dockview target
- optional drag affordance that opens the workflow inspector through Dockview external DnD

Compact cards read durable structured state. They must not parse transcript text or raw Smithers logs to infer status.

## Handler Thread And Workflow Inspector Placement

Opening a handler thread from the sidebar, timeline, command result, Dockview context menu, or workflow-related card must use the placement semantics in this spec.

Opening a workflow-inspector-related surface must also use chosen-Dockview-target placement. Examples include:

- latest workflow run for a handler thread
- selected workflow run from a compact card
- selected workflow node drill-down
- related child workflow node
- related thread surface from a workflow inspector
- linked artifact from a workflow node
- related Project CI check

The orchestrator does not absorb raw workflow history just because a workflow inspector is opened. The inspector is a chosen panel surface backed by durable workflow-run state and Smithers-native inspection APIs.

## Context Menus And Header Actions

Dockview tab and group context menus may expose product actions when those actions are valid for the selected panel or group.

Allowed actions include:

- close panel
- close other panels in group
- duplicate panel
- open in new split
- open in floating group
- open in popout when supported
- reveal surface in sidebar
- inspect surface settings
- copy surface reference
- rename visual tab label when the rename is only visual

Destructive product actions such as deleting a session, deleting a workflow entry, or deleting an artifact must stay explicit product commands with confirmation where appropriate. They must not be hidden inside generic Dockview close behavior.

## Accessibility And Keyboard

Dockview keyboard behavior must be integrated with svvy shortcuts without stealing global product commands.

Requirements:

- `Cmd+Shift+P` opens the shared palette with `>` prefilled for command mode
- `Cmd+P` opens the same shared palette without a prefix for file quick-open search mode
- Dockview and pane shortcuts are registered through the product shortcut registry and bound with TanStack Hotkeys in scoped renderer contexts
- focused-pane shortcuts must only affect the active Dockview panel and must not leak into dialogs, inputs, command palette mode, or another focused pane
- Dockview focus movement should be available through product actions
- panel close, duplicate, split, float, and popout commands should be command-palette discoverable
- resize and tab navigation must remain keyboard accessible where Dockview supports it
- drag/drop-only actions must have command-palette or menu alternatives
- popout-specific shortcuts may be enabled only after validating TanStack Hotkeys bindings work correctly inside Electrobun popout windows with the same registry semantics
- focused panel highlight must be visible without relying only on color

## Invariants

- Dockview is the canonical layout interaction engine.
- Dockview serialized layout plus svvy panel metadata is durable user workspace UI layout state inside fixed slots `A`, `B`, and `C` keyed by `(workspaceId, layoutId)`.
- Workspace tabs are chrome state that select `workspaceId` plus active layout id; they do not own durable layout documents.
- Default workspace tabs have no durable layout slots and initialize with exactly one `Open Workspace` pane.
- Panel metadata is separate from durable session/workflow state.
- Panel metadata is separate from live surface runtime state.
- Live runtime controllers are keyed by `surfacePiSessionId`.
- There is at most one live runtime controller per `surfacePiSessionId` in a renderer process.
- Multiple Dockview panels may bind to the same `surfacePiSessionId`.
- Duplicate panels share live runtime state and keep independent panel-local UI state.
- Focus is panel focus, not surface ownership.
- Closing a panel does not delete the durable surface it showed.
- Dockview floating and popout placement do not create duplicate product runtimes.
- Restart restore never relies on transcript parsing.
- Empty layout slots are selectable and muted, not disabled.
- Missing restore targets render unavailable states instead of causing silent deletion.
- Dockview layout changes must not mutate durable workspace/session/workflow records except through explicit product commands.
- `svvy` must not maintain a parallel custom drag-preview system for Dockview-hosted pane movement.

## Relationship To Other Specs

- `docs/prd.md` defines the product-level relationship between Dockview layout state, durable surfaces, and pi-backed runtimes.
- `docs/specs/workspace-navigation-core-projection.spec.md` defines Section 8 navigation, core projection, and earlier restart restore boundaries that this spec expands for Dockview layout.
- `docs/specs/command-palette.spec.md` defines Section 9 command palette and quick-open behavior, including the shell-level action surface whose Dockview-specific placement is defined here.
- `docs/specs/structured-session-state.spec.md` defines canonical session, thread, workflow-run, command, CI, artifact, wait, and lifecycle records that panels reference by id.
- `docs/specs/workflow-supervision.spec.md` defines workflow-run lifecycle and Smithers-native inspection behavior used by workflow inspector panels.
- `docs/specs/workflow-inspector.spec.md` defines the tree-first workflow inspector surface opened inside Dockview panels.
- `docs/specs/project-ci.spec.md` defines Project CI records that compact CI or workflow-run surfaces may reference.

## Product Outcomes

This design is successful when:

- users can split, dock, tab, drag, resize, close, float, and restore panels freely within usable minimum sizes
- Dockview's drop overlays provide clear drag previews for panel, group, root-edge, and external surface drags
- related orchestrator, handler-thread, workflow-run, artifact, and Project CI surfaces can sit side by side or in tabs
- duplicated panels show the same live surface without duplicating runtime controllers
- panel-local UI state remains independent across duplicated views
- restart restores user workspace Dockview layouts, occupancy, focus, durable bindings, and panel-local state without reviving stale transient UI state
- users can switch among fixed user workspace layout slots `A`, `B`, and `C` from the far-right workspace chrome controls; initialized slots look normal and empty slots look muted while remaining selectable
- sidebar indicators make open surface locations obvious across grid, tab, floating, popout, and edge-group placements
- compact timeline cards expose delegated work without forcing the orchestrator to absorb raw workflow detail
