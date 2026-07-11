# Default Workspace And Open Workspace Spec

## Status

- Date: 2026-05-18
- Status: authoritative product spec
- Scope:
  - define the svvy-owned default workspace runtime scope
  - define the `Open Workspace` surface shown inside that default workspace
  - define current-tab and new-tab workspace opening behavior
  - define native app menu actions and shortcuts for workspace tab operations
  - define how default workspace tabs interact with workspace runtime scopes, Dockview layouts, Logs, Agents, Extensions, Workflows, sessions, and restore state

## Purpose

`svvy` should never boot into an empty page that only says `Open Workspace`.

When there is no restored user workspace tab, the app opens a real svvy-owned default workspace. That default workspace is a normal workspace runtime scope inside the single app-owned runtime, with sessions, Logs, Agents, Extensions, Workflows, command palette, app logs, prompt history, provider settings, durable layout slots, and other runtime-facade plus DB/product-state-backed surfaces available. Its initial focused surface is an `Open Workspace` panel that lets the user choose a repository. The default workspace uses the same durable Dockview layout behavior as any other workspace. The only default-workspace layout exception is that opening an empty selected layout slot seeds that slot with a single `Open Workspace` pane instead of leaving the workbench blank.

This keeps the app usable before a user chooses a repository while preserving the product rule that substantive repository work happens inside workspace runtime scopes.

## Source Boundaries

The startup model is:

- startup with no restored tabs opens a default workspace tab
- the default workspace tab shows an `Open Workspace` surface by default
- the open-workspace button opens a user workspace in the current visual tab
- `New Tab` creates another default workspace tab
- `Open Workspace in New Tab` creates a new tab for a selected user workspace

This spec does not change the core product architecture around pi-backed surfaces, handler threads, Smithers workflows, or explicit workspace routing.

## Definitions

### Default Workspace

The default workspace is a svvy-owned workspace root created and managed by the app.

It is a real workspace runtime scope. It is not:

- an empty disabled shell
- a fake workspace
- a process-global cwd fallback
- a hidden staging area for user repositories
- a replacement for user-selected repository workspaces

It exists so app-global, workspace-routed runtime behavior, and DB/product-state-backed read/command facade behavior remain available before a user chooses a repository.

### User Workspace

A user workspace is a local repository or folder selected by the user through an open-workspace picker.

User workspaces keep the existing product meaning:

- local repository context
- workspace cwd
- branch or VCS state
- path index
- sessions
- handler threads
- app-log records and read models owned by `@svvy/state`
- workspace read models served through the state read facade
- generated Workflows export visibility projected from generated-package facts
- discovered external instruction records

### Workspace Tab

A workspace tab is a visual view over a workspace runtime scope.

Every workspace tab must have a stable chrome tab id. The tab id is separate from `workspaceId`.

Use:

- `workspaceId` for the shared `@svvy/runtime` workspace runtime scope
- `workspaceTabId` or equivalent for chrome tab state

Duplicate tabs for the same cwd share one workspace runtime scope. Their durable workspace layouts are also shared by `(workspaceId, layoutId)`; the tab only chooses which layout id is active.

Tabs do not own durable layout documents. A tab stores chrome state such as tab order, selected `workspaceId`, and active layout id. Durable layout snapshots are keyed by `(workspaceId, layoutId)` where `layoutId` is `A`, `B`, or `C`.

### Open Workspace Surface

The `Open Workspace` surface is a normal workbench panel that appears in the default workspace.

It is not a modal and not a standalone page.

It is a first-class panel target in the workspace layout so it can be focused, replaced, restored, and closed according to workspace shell rules.

## Product Model

### Startup

On app startup:

1. Load persisted workspace tab state.
2. Restore every persisted tab that still resolves.
3. If at least one tab restores, focus the persisted active tab when possible.
4. If no tab restores, create one default workspace tab.
5. Ensure the default workspace runtime scope exists.
6. Focus the default workspace tab.
7. Initialize it from the selected durable layout slot, seeding an empty default-workspace layout with exactly one `Open Workspace` pane.

The app must not show a separate centered picker-only page during normal startup.

Startup failure still uses the existing runtime error surface when the app cannot create any usable runtime.

### Default Workspace Location

The default workspace root must live under app-managed support data.

Adopted default:

```text
<svvy app data dir>/default-workspace
```

The svvy app data dir is the app-owned durable state root. Keeping the default workspace there makes it packaged-app safe and avoids writing into arbitrary user repositories while keeping PI-specific session storage under its own `pi/` child directory.

The exact path is created by an app/bootstrap helper rather than hardcoded in renderer code, for
example:

```ts
getDefaultWorkspaceCwd(appDataDir): string
```

Renderer and desktop UI modules receive only the resulting renderer-safe workspace identity and read
model. They do not derive the app data directory, default workspace path, or host path policy.

Rules:

- create the directory on demand
- do not require it to be a git repository
- do not run repository discovery upward from it
- do not infer product runtime architecture from the source checkout
- do not place it under repo-root `workflows/`
- do not place it under a user-selected workspace

The default workspace should have a stable canonical cwd across app restarts.

### Default Workspace Identity

The default workspace must have a stable runtime identity derived from its canonical cwd, using the same runtime-id normalization as other workspaces unless a stronger explicit default id is needed.

`WorkspaceReadModel.workspace` is the canonical payload that lets desktop and non-desktop callers
distinguish the default workspace from a user workspace:

```ts
type WorkspaceKind = "default" | "user";

type WorkspaceReadModel = {
  workspace: {
    workspaceId: string;
    cwd: string;
    workspaceLabel: string;
    branch?: string;
    kind: WorkspaceKind;
  };
};
```

The default workspace label should be `Default Workspace`.

There is no separate workspace-info response. Callers consume `WorkspaceReadModel.workspace` as the
canonical workspace identity payload.

`Open Workspace` names the panel and action that choose a user repository. It should not replace the workspace tab or sidebar footer label, because that makes the workspace identity look like a command.

### Default Workspace Runtime Capabilities

The default workspace supports:

- creating New orchestrator sessions
- unmatched command-mode text from the command palette creating a new orchestrator session
- Agents pane
- Extensions pane
- Logs pane
- Snippets pane
- Settings
- app-global provider auth and product settings
- agent profiles
- command palette
- reserved file quick-open entry point
- app logs
- Dockview panels
- transcript rendering
- artifacts created inside the default workspace runtime scope

The default workspace does not support:

- repository-specific branch switching unless the default workspace is intentionally initialized as a git repository, which is not the adopted direction
- workspace workflow assets under a user repository
- treating default workspace files as user source files
- assuming Smithers saved entries exist

Workflows may be visible in the default workspace because saved Workflows are app-global generated
package facts projected through the Workflows generated read model. The UI must not fabricate
workspace-local Smithers source or runnable entries for the default workspace.

### Open Workspace Surface Behavior

The default workspace's initial active panel is `Open Workspace`.

The panel should look like a normal svvy workbench surface:

- Dockview tab title: `Open Workspace`
- panel content uses the existing graphite workbench design language
- primary action: `Open Workspace`
- secondary action when useful: `Open Workspace in New Tab`
- optional recent workspace list from durable workspace tab history
- no marketing copy
- no centered full-app empty state outside the shell

The primary `Open Workspace` button opens the system folder picker and loads the selected user workspace in the current tab.

Current-tab open behavior:

1. User activates `Open Workspace` from the default workspace panel, native menu, or command palette.
2. App opens the folder picker.
3. If the user cancels, keep the default workspace tab unchanged.
4. If the user selects a cwd, open or acquire the user workspace runtime scope for that cwd.
5. Replace the current visual tab's `workspaceId` with the selected user workspace scope id.
6. Preserve the current visual tab id and tab order.
7. Reinitialize that visual tab from the selected user workspace's active layout id and durable layout slot.
8. Focus the selected user workspace tab.
9. Persist tab state.

Replacing a default workspace tab with a user workspace must not delete default workspace sessions or
logs. It only removes that visual tab's attachment to the default workspace runtime scope. Desktop asks the
bootstrap-provided runtime facade to release the tab's prior owner reference through
`runtime.workspaces.release(...)`; runtime decides retain, idle, drain, or dispose according to owner
scopes, TTL, invalidation, and app shutdown policy.

If the current tab is already a user workspace, `Open Workspace` still opens the selected workspace in the current tab. This is a tab retarget operation, not a new tab operation.

When a current-tab retarget happens from one user workspace to another:

- preserve the visual tab id and tab order
- close the prior visual tab attachment
- call the bootstrap-provided runtime facade to release the prior tab owner reference; do not inspect
  prompt, queue, thread, command, wait, or recovery idleness in renderer code
- initialize the new user workspace view from the tab's active layout id and the selected workspace's durable layout slot when available, otherwise use the selected workspace's default layout
- do not mutate or delete the prior workspace's durable sessions, app logs, generated Workflows export read models, or workspace-routed generated agent-context projections

### New Tab Behavior

`New Tab` creates a new visual workspace tab using the default workspace runtime scope.

The new tab:

- appears after the currently active tab
- becomes active immediately
- has a unique `workspaceTabId`
- uses the default workspace `workspaceId`
- opens the selected default-workspace layout slot
- seeds an empty selected layout slot with exactly one `Open Workspace` pane focused
- shares the default workspace runtime scope, sessions, app logs, prompt history, and workspace-routed generated agent-context projections with other default workspace tabs

Multiple default workspace tabs are allowed. They are separate visual views over the same default workspace runtime scope and shared durable layout slots. Pane changes made inside a default workspace tab persist to that workspace's selected layout slot and are visible to later default workspace tabs using the same slot.

### Open Workspace In New Tab Behavior

`Open Workspace in New Tab` opens the picker and creates a new visual tab for the selected user workspace.

Behavior:

1. User invokes the action.
2. App opens the folder picker.
3. If the user cancels, no tab is created.
4. If the user selects a cwd, open or acquire the user workspace runtime scope for that cwd.
5. Create a new visual tab after the active tab.
6. Bind the tab to the selected workspace runtime scope.
7. Make the new tab active.
8. Initialize its layout from the selected user workspace's active durable layout slot when available, otherwise the selected workspace's default layout.
9. Persist tab state.

Opening an already-open repository in a new tab creates a duplicate visual tab for the same workspace runtime scope. It must not focus the existing tab unless the user explicitly chooses a switch action.

### Tab Close Behavior

Closing a default workspace tab follows normal workspace-tab close behavior.

If closing the last remaining tab:

- immediately create a new default workspace tab
- focus its `Open Workspace` panel
- persist the new tab state

The app should not enter a zero-tab visible state during ordinary user interaction.

If shutdown happens with no user tabs, the persisted state may either record the default tab or record an empty user-tab set. On next launch, startup still creates a default workspace tab.

## Native App Menu

The app menu must expose workspace-opening actions as first-class menu items.

Add or update menu groups so the expected top-level product actions are discoverable:

- `File > Open Workspace...`
- `File > New Tab`
- `File > Open Workspace in New Tab...`
- existing session actions such as `New orchestrator`

Menu item labels should match command palette labels.

Menu clicks should send typed app-menu action ids through the existing app-menu message path. Do not create separate renderer-only event channels for these actions.

The shortcut registry is the source of truth for:

- action ids
- labels
- renderer hotkeys
- native menu accelerators
- compact shortcut labels
- readable shortcut labels
- input policy
- command palette linkage

### Shortcut Actions

Add these shortcut action ids:

```ts
type ShortcutActionId =
  | "workspace.open"
  | "workspace.newTab"
  | "workspace.openInNewTab"
  | ...
```

Include these in `AppMenuAction`.

### Keybindings

Adopted keybindings:

| Action                    | macOS         | Windows/Linux  | Reason                                        |
| ------------------------- | ------------- | -------------- | --------------------------------------------- |
| Open Workspace            | `Cmd+O`       | `Ctrl+O`       | Standard open action, retargets current tab   |
| New Tab                   | `Cmd+T`       | `Ctrl+T`       | Standard tab creation action                  |
| Open Workspace in New Tab | `Cmd+Shift+O` | `Ctrl+Shift+O` | Related to open, explicitly creates a new tab |

Existing keybindings remain:

| Action                           | macOS         | Windows/Linux  |
| -------------------------------- | ------------- | -------------- |
| New orchestrator in Focused Pane | `Cmd+N`       | `Ctrl+N`       |
| New orchestrator in New Pane     | `Cmd+Shift+N` | `Ctrl+Shift+N` |
| Quick Open                       | `Cmd+P`       | `Ctrl+P`       |
| Command Palette                  | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Toggle Sidebar                   | `Cmd+B`       | `Ctrl+B`       |
| Logs                             | `Cmd+Shift+1` | `Ctrl+Shift+1` |
| Agents                           | `Cmd+Shift+2` | `Ctrl+Shift+2` |
| Extensions                       | `Cmd+Shift+3` | `Ctrl+Shift+3` |
| Workflows                        | `Cmd+Shift+4` | `Ctrl+Shift+4` |

The open-workspace shortcuts are product action shortcuts and should fire while text inputs are focused, matching command palette and session creation behavior.

### Command Palette Actions

The command palette must include:

- `Open Workspace`
- `New Tab`
- `Open Workspace in New Tab`

Availability:

- always available when the app has a main window
- available inside default workspace tabs
- available inside user workspace tabs
- available while a prompt is running, because opening a workspace tab should not interrupt a running surface in another tab

Execution targets:

```ts
type CommandExecutionTarget =
  | { kind: "open-workspace"; placement: "current-tab" }
  | { kind: "new-workspace-tab" }
  | { kind: "open-workspace"; placement: "new-tab" }
  | ...
```

Unmatched command-mode text creates a new orchestrator session in the workspace selected by the
active visual tab, passing that tab's explicit `workspaceId` to `@svvy/runtime`; this includes the
default workspace.

## Runtime And Storage Contracts

### Workspace Chrome And Layout State

Workspace chrome persistence keeps durable workspace-runtime identity separate from visual tab
identity. The app-global `workspaceChrome` read model owns tab order, the active tab, known workspace
records, and each tab's selected layout slot. Workspace-scoped `workspaceLayout` read models own the
three durable Dockview slots for one explicit `workspaceId`.

The exact `@svvy/core` chrome contract is:

```ts
type WorkspaceKind = "default" | "user";

type WorkspaceLayoutSlotId = "A" | "B" | "C";

type WorkspaceTabRecord = {
  workspaceTabId: WorkspaceTabId;
  workspaceId: WorkspaceId;
  cwd: AbsolutePath;
  workspaceLabel: string;
  kind: WorkspaceKind;
  openedAt: IsoDateTimeString;
  activeLayoutId: WorkspaceLayoutSlotId;
};

type WorkspaceChromeReadModel = {
  activeWorkspaceTabId: WorkspaceTabId | null;
  tabs: readonly WorkspaceTabRecord[];
  knownWorkspaces: readonly WorkspaceTabRecord[];
};
```

There is no renderer-owned schema version, branch field, file-backed restore document, or combined
chrome-and-layout payload. Branch and other live repository facts are derived separately.

The exact workspace layout shape is:

```ts
type WorkspaceLayoutReadModel = {
  workspaceId: WorkspaceId;
  // Exactly one slot for each id, in the canonical A/B/C set.
  slots: readonly WorkspaceLayoutSlotReadModel[];
};

type WorkspaceLayoutSlotReadModel = {
  workspaceId: WorkspaceId;
  layoutId: WorkspaceLayoutSlotId;
  initialized: boolean;
  dockviewJson: JsonValue | null;
  panes: readonly WorkspacePaneRecord[];
  compactSurfaces: readonly CompactWorkspaceSurface[];
  focusedPaneId: WorkspacePaneId | null;
  updatedAt: IsoDateTimeString;
};

type WorkspacePaneRecord = {
  paneId: WorkspacePaneId;
  target: WorkspacePaneTarget;
  localState: {
    scroll: { transcriptAnchorId: string | null; offsetPx: number } | null;
    timelineDensity: "compact" | "comfortable";
  };
  placement: WorkspacePanePlacement | null;
} & (
  | {
      fallbackChrome: null;
      restore: { kind: "ready" };
    }
  | {
      fallbackChrome: WorkspacePaneFallbackChrome;
      restore: {
        kind: "unavailable";
        reason: string;
        lastKnownLocationLabel: string | null;
      };
    }
);

type CompactWorkspaceSurface = {
  kind: "compact-thread";
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId;
  panelId: WorkspacePaneId | null;
  density: "compact" | "comfortable";
};
```

`WorkspacePaneTarget` is the closed core union for `orchestrator`, `handler`, `command`,
`workflow-task-attempt`, `artifact`, `workflows`, `agents`, `extensions`, `snippets`, `settings`,
`app-logs`, and `open-workspace`. `WorkspacePanePlacement` is the closed core union for `split`,
`tab`, `edge`, `floating`, and `popout`. Healthy pane chrome is derived from the target;
`fallbackChrome` is persisted only for an unavailable restore.

Implementation must keep visual tab identity separate from runtime identity so duplicate same-cwd
tabs and default workspace retargeting remain coherent.

Rules:

- `workspaceTabId` is unique per visual tab
- `workspaceId` points to a shared workspace runtime scope
- duplicate same-cwd tabs have different `workspaceTabId` values and the same `workspaceId`
- retargeting a tab changes `workspaceId`, `cwd`, `workspaceLabel`, and `kind`, but keeps `workspaceTabId`
- tab reorder operates on `workspaceTabId`
- active tab state uses `activeWorkspaceTabId`
- runtime facade routing still uses explicit `workspaceId`
- workspace layout restore state uses `(workspaceId, layoutId)`
- each workspace tab stores only its active `layoutId`; duplicate same-cwd tabs can select different active layout ids but share the same durable slot contents
- default workspace tabs use the same durable layout restore state as user workspace tabs; the only special case is seeding an empty selected default-workspace layout with `Open Workspace`
- the app-global `workspaceChrome` read model is fetched without a `workspaceId`; its committed
  invalidation is app-scoped `{ model: "workspaceChrome" }`
- the `workspaceLayout` read model requires an explicit `workspaceId`; saving a slot emits a
  workspace-scoped `{ model: "workspaceLayout", ids: [layoutId] }` invalidation
- `workspaceChrome.setTabs(...)` atomically replaces the ordered open and known collections;
  `selectTab(...)` and `selectLayoutSlot(...)` mutate only their named chrome selection
- `workspaceLayout.saveSlot(...)` atomically replaces one complete slot's Dockview JSON, panes,
  compact surfaces, and focus; there are no loose pane-update or pane-close persistence commands
- every workspace store materializes exactly one empty `A`, `B`, and `C` row; the first save with a
  bound product pane latches `initialized` to `true`, and later empty full replacements do not clear
  that latch
- the canonical SQLite state file is `structured-session-state-v8.sqlite`; chrome and layout have
  no old-schema import, JSON fallback, migration fixture, compatibility alias, or dual-write path

### Workspace Lifecycle Facade

App bootstrap owns the app `ManagedRuntime` and constructs the bootstrap-provided runtime facade
after `await managedRuntime.context()` and the runtime-owned startup readiness effect have both
completed. Desktop workspace-tab actions call that facade; they do not create a separate workspace
registry or lifecycle host.

Needed runtime facade calls:

```ts
runtime.workspaces.acquire({ cwd: canonicalCwd, owner, openReason: "user-open" | "restore" });
runtime.workspaces.acquireDefault({ owner, openReason: "startup" | "new-tab" });
runtime.workspaces.release({
  workspaceId,
  owner,
  releaseReason: "tab-closed" | "workspace-replaced",
});
```

Duplicate visual tabs share one workspace runtime scope for the same canonical cwd. A generic unique
same-cwd workspace scope API is not part of this product model. Isolated same-cwd workspace scopes
are outside this model and require a distinct workspace identity and state model before adoption.

### Default Workspace Bootstrap

App bootstrap should not rely on source-checkout cwd as the product workspace.

Startup should know:

- initial process cwd
- default workspace cwd
- whether to open initial user workspace from a launch argument or restore state
- whether no restored tabs requires a default workspace tab

`openInitialWorkspace` should be false unless a real user workspace was explicitly requested.

The default workspace should be created by product startup logic, not by treating process cwd as a workspace.

### Open Workspace RPCs

Resolved request shape:

```ts
type OpenWorkspacePlacement = "current-tab" | "new-tab";

type OpenWorkspaceRequest = {
  cwd?: string;
  workspaceTabId?: string;
  placement?: OpenWorkspacePlacement;
};
```

Renderer responsibilities:

- call current-tab open from the `Open Workspace` panel button
- call new-tab open from `Open Workspace in New Tab`
- create default tabs through `New Tab` without invoking the folder picker

App/bootstrap bridge responsibilities:

- resolve picker cwd when `cwd` is absent
- canonicalize cwd
- call bootstrap-provided `runtime.workspaces.acquire(...)`, `runtime.workspaces.acquireDefault(...)`,
  or `runtime.workspaces.release(...)` to acquire or release workspace runtime scope ownership
- submit durable tab/layout state through the `@svvy/state` command facade and refetch workspace read
  models
- return the renderer-safe `WorkspaceReadModel.workspace` identity payload
- fan out renderer-safe workspace notifications after runtime/state receipts
- not decide visual tab placement or own lifecycle policy

The renderer owns the user intent and local chrome projection for visual tab creation,
replacement, ordering, and active-tab selection. Durable tab/layout state is persisted through
`@svvy/state`; workspace scope lifecycle is owned by `@svvy/runtime` through the single app runtime
facade rather than renderer-owned policy.

## UI Requirements

### Default Workspace Tab

The default tab should read as a real workspace, not an error or command.

The tab label is `Default Workspace`.

The Dockview panel title inside that tab may be `Open Workspace` when the open-workspace surface is focused.

Status count badges behave normally. They summarize the default workspace runtime scope just like any other workspace runtime scope.

### Open Workspace Panel

Panel content should be compact and workbench-native.

Required content:

- title: `Open Workspace`
- short body: `Choose a local repository or folder to work in.`
- primary button: `Open Workspace`

Optional content:

- recent workspaces from `knownWorkspaces`
- secondary button: `Open in New Tab`

No full-screen marketing hero, no large decorative art, and no instruction-heavy onboarding copy.

### Sidebar

In the default workspace, sidebar actions are not globally greyed out.

Enabled:

- New orchestrator
- Search
- Command Palette
- Logs
- Agents
- Extensions
- Workflows, as app-global generated Workflows visibility
- Snippets, as managed product-state snippets plus discovered snippet read models without generated
  agent-context changes
- Settings

Disabled or unavailable:

- branch switcher when the default workspace is not a git repository

Session sections show real default-workspace sessions. If no sessions exist, the sections show zero counts.

### Layout Controls

Durable layout slots `A`, `B`, and `C` are a workspace feature keyed by `(workspaceId, layoutId)`.

Default workspace tabs expose and persist the same durable layout slots as user workspace tabs. A default workspace tab opens its selected slot like any other workspace tab. If the selected default-workspace slot is empty, desktop layout initialization seeds exactly one `Open Workspace` pane in that slot.

### Logs

Logs are enabled in the default workspace.

They show logs for the default workspace runtime scope. They do not become app-global logs.

When a user workspace is opened in the current tab, the tab switches to that workspace's app-log read
model from state because the visual tab now carries a different explicit `workspaceId`.

### Extensions

Extensions are enabled in the default workspace.

Agent profiles and extension definitions are app-owned settings persisted through `@svvy/state`.
Extensions are app-global, while generated agent-context previews and external-instruction
projections use explicit `workspaceId`-routed runtime/state read models for workspace-specific
files. Desktop renders those read models; it does not own runtime projection state.

Extensions are available in the default workspace startup state.

### Workflows

Workflows are enabled when the app can serve the generated `@svvyx/workflows` visibility contract.

The default workspace does not imply workspace-local `.smithers/` source. It can still show
app-global generated Workflows exports.

No sample workflows should be fabricated just because the default workspace is open.

## Routing And State Rules

### Current Workspace

The active visual tab determines the current workspace for renderer commands that intentionally operate on the focused workspace.

Runtime facade requests and state read-model requests must still carry explicit `workspaceId`.

Menu and shortcut actions resolve as follows:

- `Open Workspace`: active visual tab, current-tab placement
- `Open Workspace in New Tab`: new visual tab
- `New Tab`: new default workspace visual tab
- `New orchestrator`: active tab's current workspace, including default workspace
- `Logs`: active tab's current workspace logs
- `Agents`: app-global agent profiles, evaluated from the active tab's workspace context when workspace-scoped projections are needed
- `Extensions`: app-global extension records with workspace-routed generated agent-context projections when needed
- `Workflows`: app-global generated `@svvyx/workflows` visibility rendered for the `workspaceId`
  selected by the active visual tab when projection, logs, or source links need workspace context.
  It does not create or use a workspace-specific workflow runtime, does not run `.smithers/`, and
  does not read repo-root `workflows/`.

### Running Work

Opening, replacing, or closing a visual workspace tab must not interrupt running work in another tab.

If current-tab `Open Workspace` retargets a tab whose prior workspace has running prompts or handler threads:

- do not cancel them automatically
- close only the visual attachment and release the tab `ownerRef` through
  `runtime.workspaces.release(...)`
- surface running counts on any remaining tabs for that runtime
- let `@svvy/runtime` retain, drain, idle, invalidate, or dispose the prior runtime according to
  runtime policy; renderer code does not inspect prompt, queue, thread, command, wait, or recovery
  state

The exact background-runtime retention mechanism belongs to runtime implementation, but this spec
requires that tab retargeting is not a destructive operation and is never implemented as
renderer-owned lifecycle policy.

### Recent Workspaces

The app should keep a durable `knownWorkspaces` list for workspace picker affordances and workspace-scoped generated-context projection options.

Rules:

- include user workspaces selected through picker or explicit cwd
- exclude the default workspace from user recent-workspace lists unless a control explicitly asks to show all workspace roots
- preserve cwd and display label
- update recency when a user workspace is opened
- use canonical cwd as the deduplication key for known user workspaces

### Restore

Persisted restore state should not depend on a no-workspace state.

Restore rules:

- restore persisted workspace tabs when possible
- restore persisted default workspace tabs from their selected durable layout slot, seeding an empty selected slot with exactly one `Open Workspace` pane
- if no tabs restore, create one default workspace tab
- if the active tab id cannot be restored, focus the first restored tab
- if a user workspace cwd no longer exists or cannot open, replace that tab with a default workspace tab containing exactly one `Open Workspace` pane and an inline restore error
- do not block the whole app on one failed tab restore

## Error Handling

Picker cancellation:

- no mutation
- no error log
- keep focus in the invoking tab

Selected cwd cannot be opened:

- keep existing current tab binding
- show inline error in the `Open Workspace` panel if invoked there
- append an app-log error through `AppLogWritePort` for the invoking workspace when available,
  otherwise for the default workspace

Default workspace cannot be created:

- show startup failure surface
- emit a bootstrap diagnostic to stderr or bridge log if state app-log persistence is unavailable

Retarget fails after runtime acquisition:

- preserve prior tab binding when possible
- release the newly acquired runtime if no tab uses it
- log the failure

## Testing Requirements

Unit tests:

- default workspace cwd helper returns a stable app-owned path
- startup with empty tab restore creates one default workspace tab
- closing the last tab creates a new default workspace tab
- `New Tab` creates a default workspace tab after the active tab
- current-tab open preserves `workspaceTabId` and changes `workspaceId`
- open in new tab creates a new `workspaceTabId`
- duplicate same-cwd tabs share one workspace runtime scope
- retargeting a tab releases the prior visual `ownerRef`; runtime disposes only when owner scopes,
  TTL, invalidation, and shutdown policy allow it
- known workspaces exclude default workspace from user recents
- shortcut registry exposes correct accelerators for workspace actions
- command palette exposes workspace actions with correct availability

Renderer tests:

- no restored user tabs renders normal app chrome with a default workspace tab
- default workspace sidebar actions are enabled
- default workspace Logs, Agents, Extensions, and Workflows open normally
- open-workspace panel primary button uses current-tab placement
- `Open Workspace in New Tab` leaves the default tab in place and opens the selected workspace beside it
- default workspace tabs show durable layout slots and persist panes across app restart
- empty selected default-workspace layout slots seed one `Open Workspace` pane
- branch footer falls back to workspace label when default workspace is not a git repo

Integration tests:

- app menu `Open Workspace` retargets current tab
- app menu `New Tab` creates a default workspace tab
- app menu `Open Workspace in New Tab` creates a selected user workspace tab
- `Cmd+O`, `Cmd+T`, and `Cmd+Shift+O` dispatch through the shortcut registry and app menu path
- running work in one tab is not cancelled by opening another workspace in a different tab

E2E tests:

- first launch with no restored tabs shows normal svvy shell, not a standalone empty picker
- the first visible panel is `Open Workspace`
- chat can be started in the default workspace before choosing a repository
- choosing a repository from the first panel opens it in that same tab
- opening a repository in a new tab preserves the default tab
- duplicate same-cwd tabs, including default workspace tabs, share sessions, app logs, and durable layout slots keyed by `(workspaceId, layoutId)` while each tab keeps only its active layout choice
- layout restore fixtures seed the authoritative `structured-session-state-v8.sqlite` through the
  state store or exact state commands; they do not write renderer restore JSON or exercise a legacy
  schema migration

Run e2e through the OrbStack machine lane with `bun run test:e2e`.

## Non-Goals

- Do not create a separate no-workspace shell state.
- Do not make Logs app-global.
- Do not fabricate workflow entries in the default workspace.
- Do not route workspace-scoped runtime/state requests through process cwd or an active runtime
  singleton instead of explicit `workspaceId` contracts and facades.
- Do not introduce a standalone terminal, alternate TUI, or shell loop.
- Do not store default workspace state under repo-root `workflows/` or any source-checkout-relative Smithers path.
- Do not focus an already-open user workspace tab when the user requested `Open Workspace in New Tab`.
