# Multi-Session Support Spec

## Status

- Date: 2026-04-10
- Status: proposed implementation plan for multi-session desktop support
- Scope of this document:
  - define the intended `hellm` product behavior for multiple sessions in one workspace window
  - specify the backend and frontend architecture needed to support session creation, listing, switching, and branching
  - recommend a phased implementation plan that stays aligned with the current pi-backed runtime seam
  - identify what is in scope for v1 versus what should be deferred

## Purpose

`hellm` currently behaves like a single open chat surface with one active runtime and a static left sidebar.

That is below the product bar set by the PRD.

The product needs a real session model where:

- a workspace can contain many durable sessions
- the left side of the app is true session navigation rather than a decorative shell
- users can create, switch, resume, fork, and inspect sessions without losing their place
- session persistence continues to flow through pi's session substrate instead of a second `hellm`-owned transcript system

This document defines the recommended implementation direction.

## Product Fit

The PRD already establishes the core product shape:

- sessions are durable user-facing containers, not just transcripts
- the desktop shell includes a left navigation rail for workspace and session navigation
- the app must support session creation, switching, resume, and branch or fork navigation
- visible state matters as much as raw conversation history

Sources:

- `docs/prd.md`
- `docs/execution-model.md`
- `docs/specs/prompt-history.spec.md`

The current implementation only partially satisfies that model:

- `src/mainview/ChatWorkspace.svelte` renders a single-session workspace shell
- `src/mainview/chat-runtime.ts` exposes one active `Agent`
- `src/bun/pi-host.ts` persists through pi's session substrate, but only exposes prompt-oriented RPC operations

The gap is not that pi lacks sessions.

The gap is that `hellm` does not yet project those sessions into desktop product behavior.

## Problem Statement

The current product has four related limitations:

1. there is no session index visible in the desktop UI
2. there is no user-facing session switching or resume flow
3. the frontend does not distinguish durable session metadata from the currently hydrated runtime
4. the backend RPC surface is built around "send a prompt to the current session" rather than "manage many sessions in one workspace"

The result is a mismatch between:

- the PRD's session-centric product model
- pi's actual session capabilities
- the desktop app's current behavior

## Adopted Direction

The adopted direction for multi-session support is:

- keep pi session files as the durable source of truth for session history
- keep one fully hydrated, interactive session runtime active in the main pane at a time
- add a session catalog layer that projects lightweight metadata for all sessions in the current workspace
- turn the left sidebar into a real session navigator
- support session creation, switching, resume, rename, fork, and delete before adding more advanced library features
- keep workspace-scoped prompt history exactly as already defined in `docs/specs/prompt-history.spec.md`
- avoid storing full conversation copies in frontend IndexedDB
- keep `hellm` above the pi seam rather than replacing pi's runtime or session model

Nothing below should be read as recommending a second transcript engine or a custom shell outside pi.

## Reading Rules

This document uses three labels:

- `Fact`: directly supported by local source references in this repo
- `Decision`: adopted implementation direction for `hellm`
- `Deferred`: intentionally not in the first implementation slice

## Ground Truth and Ownership

## pi Session Substrate

### Fact

pi already provides durable session primitives that `hellm` should build on:

- `SessionManager` persists append-only session trees as JSONL files
- `SessionManager.list()` returns workspace-scoped session metadata
- `SessionManager` supports persisted session IDs, parent sessions, and branching
- `AgentSessionRuntime` supports switching, new session creation, and forking

Sources:

- `docs/references/pi-mono/packages/coding-agent/src/core/session-manager.ts`
- `docs/references/pi-mono/packages/coding-agent/src/core/agent-session-runtime.ts`

### Decision

`hellm` should treat pi session files and pi session runtime APIs as the source of truth for:

- conversation persistence
- session identity
- session branching lineage
- restored model and thinking state

`hellm` should add product projection and navigation around those primitives, not replace them.

## Current `hellm` Storage Split

### Fact

The current frontend storage in `src/mainview/chat-storage.ts` stores:

- provider keys
- custom providers
- workspace-scoped prompt history

It does not currently store durable session data.

### Decision

That remains the right boundary.

Frontend storage may hold cached session metadata or UI-local preferences later, but it should not become the primary store of full session transcripts.

## UX Model

## Window and Workspace Assumption

### Decision

The first implementation should preserve the current mental model:

- one desktop window is attached to one workspace
- that workspace can contain many sessions
- one session is selected at a time
- the selected session owns the main pane, composer, artifacts pane, and right-side detail projection

This is simpler and better aligned with the current app than copying a multi-project icon rail immediately.

## Left Navigation Structure

### Decision

The left side of the app should become a true session navigation panel with this structure:

- workspace header
- primary session action
- session list
- compact workspace/runtime context

Recommended layout:

- workspace header:
  - repo or workspace label
  - current branch or worktree indicator
  - optional workspace status
- primary action:
  - `New Session`
- session list:
  - one flat list sorted by recency
- utility footer:
  - settings entry
  - optional session search trigger later

Branch relationships can still be indicated within the row itself, but they do not need a dedicated section in v1.

## Session Row Design

### Decision

Each session row in v1 should show:

- title
- one-line preview
- relative updated time
- status badge

Optional but recommended fields:

- model shorthand
- branch marker when the session has a parent
- waiting indicator when the session is blocked on input

The row should not try to show thread and episode detail in full.

That detail belongs in the main pane and inspector once the session is selected.

## Session Row Actions

### Decision

Each session row should support:

- single click: open session
- context menu or overflow:
  - rename
  - fork
  - delete

Keyboard support should include:

- arrow navigation within the session list
- `Enter` to open
- a rename shortcut later if a dedicated list interaction layer exists

## Main Pane Behavior

### Decision

When a session is selected:

- the main conversation timeline rehydrates from that session
- artifacts are reconstructed from that session's message history
- model and reasoning controls reflect that session's current state
- the composer targets that session
- any currently visible session-specific badges, waiting state, or inspector content swap with the selection

The user should not need to reload the app or open a modal just to resume an existing session.

## Mobile and Narrow Width Behavior

### Decision

At narrow widths, the left nav should collapse into a drawer or overlay panel.

The current stacked sidebar layout in `ChatWorkspace.svelte` can be a transitional basis, but the session list must remain accessible as navigation, not be demoted to a static metrics panel.

## Session Status Model

### Decision

For v1, `hellm` should project sessions into one of these UI states:

- `idle`
- `running`
- `waiting`
- `error`

Guidelines:

- `running`: currently selected session with an active prompt stream
- `waiting`: session explicitly blocked on user input, clarification, or another resumable waiting condition
- `error`: last terminal result was an error and there is no newer successful activity
- `idle`: default stable state

Only the selected session needs fully live status in v1.

For non-selected sessions, status may be derived from durable metadata and the last known projected state.

## Architecture Direction

## Core Principle

### Decision

`hellm` should split session handling into two layers:

- durable session truth in pi-managed session files and runtime
- lightweight desktop session projection for navigation and selection

This yields a clean boundary:

- pi owns persisted session history and resume semantics
- `hellm` owns desktop navigation, metadata projection, and active-session coordination

## Recommended Backend Shape

### Decision

Add a dedicated backend session catalog layer in the Bun process.

Recommended responsibilities:

- enumerate sessions for the current workspace
- derive lightweight session metadata for UI consumption
- open or switch the active runtime to a selected session
- create new sessions
- rename and fork sessions
- manage delete policy

This should be implemented as an explicit module instead of scattering session operations across RPC handlers.

Recommended module names:

- `src/bun/session-catalog.ts`
- `src/bun/session-projection.ts`

Names can vary, but the separation should exist.

## Active Runtime Model

### Decision

The Bun process should own one active runtime per desktop window and expose operations to swap its underlying session.

The current `ManagedSession` map in `src/bun/pi-host.ts` is useful for prompt streaming, but it is not yet a good product-level session controller.

Recommended evolution:

- introduce a single active workspace runtime wrapper around pi's `AgentSessionRuntime`
- use pi runtime methods for:
  - `newSession`
  - `switchSession`
  - `fork`
- keep existing prompt streaming behavior, but bind it to the currently selected session runtime

This is the cleanest path to session switching without inventing manual state replay logic.

## Session Catalog Metadata Shape

### Decision

The left nav should consume a lightweight session metadata shape similar to:

```ts
type WorkspaceSessionSummary = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  status: "idle" | "running" | "waiting" | "error";
  sessionFile?: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  modelId?: string;
  provider?: string;
  thinkingLevel?: string;
};
```

Notes:

- `id` is the user-facing stable identifier
- `sessionFile` may remain backend-only if the UI only needs `id`

## Delete Policy

### Decision

Delete is the only destructive list-management action in v1.

- `delete`:
  - destructive removal with confirmation
  - only allowed when the session is not actively streaming

Archive or hide semantics are deferred until pi or `hellm` has a durable product need for them.

## RPC Plan

### Decision

Extend `src/mainview/chat-rpc.ts` and `src/bun/index.ts` with a session-management RPC surface.

Recommended requests:

- `listSessions`
- `getActiveSession`
- `createSession`
- `openSession`
- `renameSession`
- `forkSession`
- `deleteSession`

Recommended payload ideas:

```ts
type ListSessionsResponse = {
  activeSessionId?: string;
  sessions: WorkspaceSessionSummary[];
};

type CreateSessionRequest = {
  title?: string;
  parentSessionId?: string;
};

type OpenSessionRequest = {
  sessionId: string;
};

type RenameSessionRequest = {
  sessionId: string;
  title: string;
};

type ForkSessionRequest = {
  sessionId: string;
  entryId?: string;
};
```

### Decision

`openSession` should return enough state for the main pane to render immediately after a switch.

That response should include:

- selected session metadata
- restored model and thinking level
- message history for the selected session

This avoids forcing the frontend to immediately make a second read call after every selection.

## Frontend Runtime Plan

### Decision

`src/mainview/chat-runtime.ts` should evolve from a single-purpose prompt wrapper into a session-aware runtime controller.

Recommended responsibilities:

- hold the current active session ID
- expose `listSessions()`
- expose `createSession()`
- expose `openSession()`
- expose `renameSession()`
- expose `forkSession()`
- expose delete operation
- update the active `Agent` state when a session switch occurs

This can still wrap a single `Agent` instance in the main view if that keeps the frontend simple.

The important change is not "many agents in the frontend".

The important change is "one frontend controller that understands many durable sessions and one selected session".

## Message Hydration Strategy

### Decision

When the user opens a session:

- the backend should load that session through pi
- the frontend should replace its active message set with the selected session's messages
- the artifacts controller should reconstruct from the selected message list

The frontend should not attempt to merge message arrays from two sessions.

Session switching is a full selection change, not an append operation.

## UI Component Plan

### Decision

Refactor `src/mainview/ChatWorkspace.svelte` so the left sidebar is no longer hardcoded session shell copy.

Recommended component split:

- `SessionSidebar.svelte`
- `SessionList.svelte`
- `SessionListItem.svelte`
- existing `ChatTranscript.svelte`
- existing `ChatComposer.svelte`
- existing `ArtifactsPanel.svelte`

Potential supporting state modules:

- `src/mainview/session-state.ts`
- `src/mainview/session-format.ts`

The exact file names are flexible, but the left nav should become a first-class UI module instead of being embedded as static copy in `ChatWorkspace.svelte`.

## Session Title Strategy

### Decision

The first implementation should support both:

- explicit rename by the user
- a default generated title when no explicit title exists

Recommended default title priority:

1. stored session name from pi session info
2. first user message truncated
3. fallback `"New Session"`

Rename should update durable session info through pi-compatible session metadata rather than frontend-only state.

## Branch and Fork Behavior

### Decision

Forking should be supported in the multi-session design, but its first implementation can be simple:

- fork from the current session root or current leaf if that is what pi runtime already exposes cheaply
- show forked sessions in the nav as branched children or with a branch badge

`Deferred`:

- arbitrary entry-point fork selection from the full transcript UI

That richer fork UI can come later once transcript-to-entry mapping is surfaced cleanly in the desktop app.

## Implementation Phases

## Phase 0: Prerequisites and Documentation

Goal:

- make the repo ready for a multi-session implementation series

Tasks:

- add or restore `docs/features.ts`
- add a multi-session feature inventory entry
- land this spec
- confirm desired naming for session states and left-nav sections

Exit criteria:

- docs are internally consistent
- implementation work has an agreed vocabulary

## Phase 1: Backend Session Catalog

Goal:

- expose durable session listing and selection through Bun RPC

Tasks:

- add session summary projection from pi session files
- add RPC handlers for `listSessions`, `createSession`, and `openSession`
- return selected session messages and settings on open
- keep current prompt send path working against the selected session

Files likely touched:

- `src/mainview/chat-rpc.ts`
- `src/bun/index.ts`
- `src/bun/pi-host.ts`
- new backend session catalog module(s)

Exit criteria:

- the app can enumerate many sessions for the workspace
- the app can create a new session
- the app can open an older session and continue from it

## Phase 2: Left Navigation UI

Goal:

- replace the current static sidebar with true session navigation

Tasks:

- build session list components
- show session summaries and active state
- wire `New Session`
- wire row selection to `openSession`
- preserve artifacts and composer behavior when switching

Files likely touched:

- `src/mainview/ChatWorkspace.svelte`
- `src/mainview/chat-runtime.ts`
- new session sidebar components

Exit criteria:

- the left nav is session-centric
- switching sessions updates the main pane correctly
- no full-page reset is needed

## Phase 3: Session Mutation Operations

Goal:

- support session rename, fork, and delete

Tasks:

- add rename flow
- add fork flow
- add delete flow with confirmation

Exit criteria:

- users can maintain a clean session list
- branch relationships are preserved

## Phase 4: Polishing and Product Projection

Goal:

- make the session navigator feel like a product surface rather than a file picker

Tasks:

- improve status badges
- add search or filter
- add empty states
- add better narrow-screen behavior
- optionally add alternate views beyond the default flat recency sort

`Deferred`:

- background concurrent active streams in multiple sessions
- multi-workspace rail
- session pinning
- unread counters beyond basic selected-state behavior

## Testing Plan

## Unit Coverage

### Decision

Add unit coverage for:

- session summary projection from pi session files
- recency sorting logic
- session title fallback rules
- RPC request and response validation
- frontend session selection state updates

## Integration Coverage

### Decision

Add integration tests for the full happy path:

1. create session
2. send prompt
3. create second session
4. switch back to first session
5. confirm messages, model, and thinking level restore correctly

Also cover:

- rename
- fork
- delete blocked while streaming
- persistence across app restart

## Regression Coverage

### Decision

Specifically protect these regressions:

- switching sessions drops or duplicates messages
- the composer sends a prompt to the wrong session
- artifacts panel continues showing artifacts from the previously selected session
- prompt history loses its workspace-scoped behavior
- model or thinking controls drift out of sync with the selected session

## UX Checks

### Decision

Manual QA should include:

- narrow width drawer behavior
- empty workspace with no sessions
- many sessions with long titles
- sessions with no assistant reply yet
- session switch during artifact overlay open
- error recovery when opening a corrupted or missing session file

## Risks and Mitigations

## Risk: Two Session Systems

If `hellm` stores transcripts separately from pi, the product will drift into double persistence and unreliable resume behavior.

### Mitigation

Use pi session files as the transcript source of truth and limit `hellm` overlays to UI-only metadata.

## Risk: Manual Runtime Replay Logic

If session switching is implemented by manually replaying frontend messages into a fresh runtime, restored behavior may diverge from pi's actual session semantics.

### Mitigation

Prefer pi runtime session switching or direct session-manager-backed runtime creation over ad hoc transcript replay.

## Risk: Nav Becomes a Chat List and Nothing More

If the left nav is designed as a plain recent-chat list, it will not scale to waiting states, branching, verification, and later thread-aware projection.

### Mitigation

Adopt a session summary shape that is intentionally extensible for:

- waiting state
- verification state
- branch lineage
- unresolved work indicators

## Risk: Overbuilding v1

Trying to ship search, pins, background concurrency, and branch trees in one pass will slow delivery and increase regression risk.

### Mitigation

Ship in phases and keep v1 focused on:

- list
- create
- open
- resume
- rename
- fork

## Deferred Work

The following should not block the first multi-session release:

- multiple simultaneously streaming sessions in one window
- cross-workspace navigation in one shell
- session pinning
- session search with full-text indexing
- arbitrary transcript-entry fork UI
- unread counts and notification badges
- deep branch-tree visualization beyond a simple parent or badge model

## Recommended First PR Breakdown

### Decision

The implementation should be split into small reviewable pull requests:

1. session RPC and backend catalog
2. frontend session runtime controller
3. left-nav UI replacement
4. rename and fork flows
5. delete flow
6. polish and responsive cleanup

This sequencing keeps the system debuggable while the product surface changes.

## Summary

The recommended plan is straightforward:

- keep pi in charge of durable sessions
- give `hellm` a real session catalog and session-aware RPC surface
- replace the static left sidebar with workspace-scoped session navigation
- keep one selected interactive session in the main pane
- add mutation operations in phases instead of shipping an overbuilt chat library all at once

That gets `hellm` to the PRD's session-centric product model without violating the pi runtime boundary.
