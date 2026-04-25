# Workspace Navigation And Core Projection Spec

## Status

- Date: 2026-04-25
- Status: adopted direction for Section 8 workspace navigation, artifact projection, Project CI projection, and restart restore
- Scope of this document:
  - define pinned and archived session navigation
  - define the core artifact projection shown on thread and workflow-run surfaces
  - define where compact Project CI state appears in the workspace shell
  - define the UI state that should and should not restore after restart
  - keep saved workflow library browsing out of this section until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist

## Purpose

Section 8 exists to make the workspace shell reflect durable product state clearly.

- sessions can be pinned or archived
- handler threads and workflow runs can show their linked artifacts directly
- Project CI status can be seen without opening a dedicated deep inspector first
- pane bindings and inspector selections can survive app restart

The renderer must still join durable workspace read models, live surface state, and pane state locally. It must not infer these projections from transcript text.

## Non-Goals

This section does not implement:

- arbitrary session folders
- nested session folders
- saved workflow library browsing
- source editor, syntax highlighting, typecheck, or diagnostics surfaces
- full workflow graph inspection
- pane grid creation, pane geometry editing, or expanded split-pane workflows beyond the restore rules listed here
- scroll restoration
- composer draft recovery
- transient UI recovery

Saved workflow library browsing belongs to a later saved workflow library surface after the file-tree and editor primitives exist.

## Session Navigation

### Adopted Model

The sidebar has only two navigation concepts beyond the normal active session list:

- pinned active sessions
- one Archived group

There is no user-created folder model.

Pinning keeps a session visible at the top of the active sessions list. Archiving removes a session from the active sessions list and places it inside the single Archived group.

### Stored Shape

Session navigation metadata should be durable workspace state:

```ts
type SessionNavigationMetadata = {
  workspaceSessionId: string;
  pinnedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
};
```

The workspace shell should also persist the collapsed state of the Archived group:

```ts
type WorkspaceSidebarState = {
  archivedGroupCollapsed: boolean;
  updatedAt: string;
};
```

`archivedGroupCollapsed` defaults to `true`.

### Pin Rules

Pinning a session:

- sets `pinnedAt`
- keeps `archivedAt` as `null`
- places the session in the pinned active area

Unpinning a session:

- clears `pinnedAt`
- leaves the session active

Pinned active sessions sort above unpinned active sessions.

Pinned active sessions should sort by `pinnedAt` descending so the most recently pinned session appears first.

Unpinned active sessions should sort by normal session recency, using the existing session summary update time.

### Archive Rules

Archiving a session:

- sets `archivedAt`
- clears `pinnedAt`
- removes the session from the active sessions list
- places the session inside the Archived group

Unarchiving a session:

- clears `archivedAt`
- leaves `pinnedAt` as `null`
- returns the session to the unpinned active sessions list

Archived sessions should sort by `archivedAt` descending so the most recently archived session appears first.

The Archived group should be collapsed by default in new workspaces and whenever no persisted sidebar state exists.

### Sidebar Actions

Active unpinned session rows should expose:

- Pin
- Archive

Active pinned session rows should expose:

- Unpin
- Archive

Archived session rows should expose:

- Unarchive

Existing destructive session actions, such as delete, may remain available where they already exist, but archive is not delete. Archiving must not remove pi session data, structured state, artifacts, threads, workflow runs, or episodes.

### Sidebar Read Model

The sidebar read model should return enough data for the renderer to render navigation without re-sorting from raw tables:

```ts
type WorkspaceSessionNavigationReadModel = {
  pinnedSessions: SessionSummary[];
  activeSessions: SessionSummary[];
  archived: {
    collapsed: boolean;
    sessions: SessionSummary[];
  };
};
```

`SessionSummary` should include at least:

```ts
type SessionSummaryNavigationFields = {
  isPinned: boolean;
  pinnedAt: string | null;
  isArchived: boolean;
  archivedAt: string | null;
};
```

The renderer may still group the data visually, but the backend selector owns the semantic grouping and ordering.

## Artifact Projection

### What Counts As An Artifact

An artifact is a durable byproduct or evidence file produced by work the app performed.

Artifacts live under the `svvy` artifact area, not as normal project source. They are for outputs that should remain inspectable but should not normally be committed into the user's repository tree as product code, source docs, configuration, tests, or assets.

Examples include:

- submitted `execute_typescript` source snippets, including failed attempts
- command logs and traces
- retained test output, JUnit XML, coverage summaries, or other test-run evidence when the output is worth preserving beyond a compact command summary
- generated audit, benchmark, inspection, or workflow reports that are evidence of agent work rather than requested repository files
- screenshots
- workflow run exports
- CI logs or check artifacts

A normal repository file edited by the agent is not automatically an artifact. If the agent edits `src/example.ts`, that file is workspace state. If the user asks for `docs/report.md` to be created in the repo, that file is workspace state. If the runtime saves a log, snippet, temporary report, screenshot, trace, or exported output as evidence of work, that saved output is an artifact.

Artifacts should remain file-backed durable records with stable ids and links to the session, thread, workflow run, command, or CI check that produced them.

### Artifact Creation Rules

The app should create artifact records in these cases:

1. Automatically, for mandatory runtime evidence such as every submitted `execute_typescript` snippet.
2. Automatically, when a runtime needs to retain a large stdout, stderr, diagnostics, trace, screenshot, workflow export, or other execution payload that is too bulky for command facts or transcript text.
3. Explicitly, through `api.artifact.*`, when an agent creates a durable byproduct that should be inspectable later but should not normally live in the repository.
4. Explicitly, through `api.artifact.attachFile(...)`, when an existing generated file should be retained as evidence without treating that file as a normal workspace deliverable.

The app should not create artifact records for:

- ordinary source edits
- ordinary repository docs, tests, config, or assets that the user asked to add or change
- small explanations that fit naturally in the assistant response or command summary
- raw command output when normalized command facts and a compact summary are enough
- files under `.svvy/workflows/...`, which are saved reusable workflow assets rather than execution artifacts

### Agent Guidance

Agent-facing prompts and generated API docs should teach this decision rule:

- use `api.repo.writeFile(...)` or `api.repo.writeJson(...)` when the file is part of the workspace the user is asking to change
- answer in prose when the information is small and only needs to appear in the transcript
- use `api.artifact.writeText(...)`, `api.artifact.writeJson(...)`, or `api.artifact.attachFile(...)` only for durable byproducts, evidence, previews, logs, reports, screenshots, or large payloads that should be inspectable later but should not normally be placed in the repository

This keeps artifacts from becoming a confusing second filesystem for normal project files.

### Projection Goals

Artifact projection should let the user see work outputs without reading transcript prose.

Thread and workflow-run surfaces should show linked artifact records before falling back to transcript reconstruction. Transcript links may still exist, but they are secondary.

### Thread Artifact Block

A handler-thread surface should show a compact Artifacts block near the thread metadata and latest handoff area.

The block should include artifacts linked directly to the thread plus artifacts linked to workflow runs owned by that thread.

The compact row should show:

- artifact name
- artifact kind
- producing workflow run or command when known
- created time
- missing-file warning when the file no longer exists

### Workflow-Run Artifact Block

A workflow-run summary or workflow-run detail surface should show artifacts grouped under that run's status and summary area.

Workflow-run artifact groups should prefer this order:

1. newest workflow-run artifacts first
2. within a run, newest command or task artifacts first
3. within a command or task, creation order

### Preview Behavior

Clicking an artifact should open the existing artifact panel or inspector.

Small text, JSON, log, and image artifacts may show inline previews or thumbnails, but Section 8 should not build a new full artifact viewer.

Missing artifact files should still render a stale artifact row using retained metadata. The row should show that the file is missing rather than disappearing silently.

## Project CI Projection

Project CI remains the product's CI lane over declared Smithers workflow entries with `productKind = "project-ci"`.

Section 8 adds compact placement rules for the latest Project CI state.

### Focused Surface Summary

The workspace shell should show a compact latest Project CI summary near the focused surface or session status area.

The compact summary should show:

- current CI state
- latest run summary
- check counts by status
- link to inspect the latest run when it exists

The supported compact states are:

- `not-configured`
- `configured`
- `running`
- `passed`
- `failed`
- `blocked`
- `cancelled`

### Handler Thread Summary

An inspected handler thread should show Project CI detail only when that thread launched, configured, modified, or otherwise owns the latest relevant Project CI run.

The thread-local CI block should show:

- CI state
- entry label
- owning workflow run
- check list summary
- linked artifacts and logs

If the thread did not participate in the latest CI state, the thread should not duplicate global CI detail just because it is currently focused.

### Actions

The compact CI projection may expose:

- Run CI
- Configure CI
- Inspect latest run

Run and configure actions must route through normal orchestrator or handler-thread work. They must not create a CI-specific runtime, setup wizard, or special CI orchestrator.

### No Heuristic CI

The UI must only render Project CI result state from declared CI records.

It must not infer Project CI status from arbitrary command names, logs, transcript text, test output, or workflow final prose.

## Restart Restore

The product should restore as much workspace UI state as is useful and stable.

### Restore Targets

The app should restore:

- pinned and archived session state
- Archived group collapsed state
- open panes
- pane-to-surface bindings
- focused pane
- selected inspector target per pane, when the target still exists
- open surface structure
- model and reasoning state that belongs to the live surface runtime when it has durable backing

Pane restoration should be lazy. On app load, the renderer can restore pane bindings first and hydrate live surfaces as their panes become visible or active.

### Persisted Restore Shape

The restore snapshot should be versioned:

```ts
type WorkspaceUiRestoreState = {
  version: 1;
  focusedPaneId: string | null;
  panes: Array<{
    paneId: string;
    surfacePiSessionId: string | null;
    workspaceSessionId: string | null;
    threadId: string | null;
    inspectorSelection:
      | null
      | { kind: "thread"; threadId: string }
      | { kind: "workflow-run"; workflowRunId: string }
      | { kind: "artifact"; artifactId: string }
      | { kind: "ci-run"; ciRunId: string };
  }>;
  updatedAt: string;
};
```

Pane geometry and multi-cell spans are owned by the pane-layout work. If they are present, they should live beside this shape under the same versioning approach, but Section 8 does not need to solve expanded pane-grid editing.

### Restore Rules

On restart:

- restore pane bindings whose target surface still exists
- restore the focused pane if it still exists
- otherwise focus the first visible pane
- restore inspector selection if the selected target still exists
- otherwise clear that pane's inspector selection
- show a non-destructive unavailable-surface state if a pane binding points at a deleted or missing surface
- never delete durable state just because a restore target is missing

### What Not To Restore

The app should not restore:

- scroll position
- hover state
- open context menus
- temporary popovers
- unsaved inline edit state
- in-progress composer draft text
- selected transcript text
- temporary transcript search highlights
- stale live stream state
- stale tool-running state

Live stream and tool-running state should come only from real durable runtime state after reconnect or bootstrap. The restore snapshot must not pretend an old stream is still alive.

## Relationship To Other Specs

- `docs/specs/multi-session-support.spec.md` defines the state-layer split, live surface ownership, and pane indirection.
- `docs/specs/structured-session-state.spec.md` defines canonical session, thread, workflow-run, command, CI, artifact, and wait records.
- `docs/specs/project-ci.spec.md` defines Project CI record creation and result semantics.
- `docs/specs/workflow-library.spec.md` defines workflow library storage, but saved workflow library browsing is intentionally deferred from this Section 8 scope.

## Product Outcomes

This design is successful when:

- important active sessions can stay visible through pinning
- old sessions can be hidden without being deleted
- thread and workflow outputs are visible through artifact links instead of transcript archaeology
- latest Project CI status is legible from the workspace shell
- restart brings back the user's workspace layout and inspected targets without reviving stale transient UI state
