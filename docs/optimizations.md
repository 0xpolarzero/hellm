# Optimizations

## Purpose

This document tracks the highest-leverage performance and scaling work for `svvy`.

It covers:

- current hotspots in the shipped codebase
- architectural reasons those hotspots exist
- PRD-driven future optimization requirements for intended features
- an execution order for optimization work

This document should be read alongside:

- `docs/prd.md`
- `docs/features.ts`

## Core Rule

The most important optimization constraint already exists in the PRD:

- product state must not depend on replaying the raw transcript for every decision
- session summaries and list views must never depend on transcript replay

The current code still pays that cost in several places. The future product surface in `docs/prd.md` expands threads, episodes, artifacts, verification, workflow inspection, pane layouts, worktrees, and headless execution. If those surfaces are implemented by repeatedly re-reading whole transcripts, whole workflow logs, or whole session branches, the app will degrade quickly as real workspace history accumulates.

The optimization direction should therefore be:

- append-only event capture
- incremental derived state
- durable secondary indexes
- metadata-first list views
- lazy detail loading
- delta transport between Bun and renderer
- viewport-aware rendering

## Current Hotspots By Impact

### 1. Full-history work during streaming and transcript updates

Impact: very high

Relevant code:

- `src/mainview/ChatWorkspace.svelte:175`
- `src/mainview/ChatWorkspace.svelte:96`
- `src/mainview/ChatTranscript.svelte:59`
- `src/mainview/ChatTranscript.svelte:95`
- `src/mainview/artifacts.ts:623`

What is happening:

- `syncAgentState()` copies the full committed message array every time runtime state updates.
- Several derived values then rescan the message history to compute usage, message counts, tool-call counts, and last activity.
- The transcript rebuilds visible message helpers from the full message list.
- Artifact helper maps are also rebuilt from the full message list.

Why it is expensive:

- During streaming, only a small amount of state changes, but the renderer still does work proportional to total transcript size.
- Long sessions increase GC churn, render cost, and UI latency even when only one partial assistant block changed.

What to do instead:

- keep committed transcript state stable while streaming state is updated separately
- append new committed messages instead of replacing the full array
- maintain incremental counters and indexes for usage, tool calls, and latest activity
- virtualize transcript rendering
- avoid rescanning the entire transcript for helper maps on every update

### 2. Session sidebar summaries rebuild full session context for inactive sessions

Impact: very high

Relevant code:

- `src/bun/session-catalog.ts:110`
- `src/bun/session-catalog.ts:505`
- `src/bun/session-projection.ts:32`
- `docs/references/pi-mono/packages/coding-agent/src/core/session-manager.ts:1044`
- `docs/references/pi-mono/packages/coding-agent/src/core/session-manager.ts:1360`

What is happening:

- `SessionManager.list()` gives session metadata.
- `svvy` then opens each inactive session and calls `buildSessionContext()`.
- The resulting message list is walked again to derive title, preview, status, and timestamps.

Why it is expensive:

- Session listing scales with both session count and transcript size.
- Workspace history growth makes the sidebar itself more expensive.
- This cost is paid repeatedly for navigation and refresh flows.

What to do instead:

- persist lightweight session summary metadata alongside session writes
- update title, preview, status, message counts, model info, and latest activity incrementally
- make sidebar listing metadata-first
- load full session context only when opening a session or when deeper inspection is required

### 3. Full active-session clones across the Bun-to-renderer boundary

Impact: high

Relevant code:

- `src/bun/session-catalog.ts:526`
- `src/mainview/chat-runtime.ts:166`
- `src/mainview/chat-runtime.ts:278`
- `src/mainview/chat-runtime.ts:431`

What is happening:

- Active session sync deep-clones the full message history on the Bun side.
- The renderer then replaces the agent transcript with the full cloned history.
- This occurs during bootstrap, prompt completion, and sync paths.

Why it is expensive:

- Larger sessions mean larger IPC payloads and more memory churn.
- Most sync operations do not actually require shipping all messages again.

What to do instead:

- transport transcript deltas instead of full snapshots
- keep a stable session snapshot ID plus incremental append operations
- lazy-load older transcript segments
- separate list-view metadata from detail-view transcript payloads

### 4. Artifact state is rebuilt by replaying the full transcript

Impact: high

Relevant code:

- `src/mainview/artifacts.ts:215`
- `src/mainview/ChatWorkspace.svelte:203`
- `src/mainview/ChatWorkspace.svelte:373`

What is happening:

- Artifact reconstruction scans the full transcript to rebuild tool-call maps and artifact operations.
- Runtime and session refresh paths trigger reconstruction even when only a small amount of state changed.

Why it is expensive:

- Artifact cost grows with total transcript length rather than artifact delta.
- This becomes worse once episodes, verification records, screenshots, logs, and workflow outputs are first-class artifacts.

What to do instead:

- maintain an incremental artifact projection keyed by processed message offset or tool-call ID
- persist durable artifact metadata rather than reconstructing from transcript every time
- keep logs and previews independently addressable from the session transcript

### 5. Prompt construction and sync checks rebuild and serialize transcripts

Impact: medium-high

Relevant code:

- `src/bun/session-catalog.ts:1185`
- `src/bun/session-catalog.ts:1215`

What is happening:

- When append-only sync cannot be assumed, the prompt path rebuilds the entire transcript as plain text.
- Sync safety checks compare prior messages with `JSON.stringify`.

Why it is expensive:

- Pre-send work scales with transcript size.
- Tool-heavy sessions make deep serialization more expensive.
- These costs compound with longer-lived sessions and more workflow handoff boundaries.

What to do instead:

- assign stable IDs or hashes to visible messages
- track a synced boundary cursor instead of rechecking whole histories
- cache flattened prompt state or transcript segments
- only materialize full prompt text when absolutely required

### 6. Refresh flows duplicate expensive session work

Impact: medium

Relevant code:

- `src/mainview/chat-runtime.ts:249`
- `src/mainview/chat-runtime.ts:258`
- `src/mainview/chat-runtime.ts:272`
- `src/mainview/chat-runtime.ts:278`
- `src/mainview/chat-runtime.ts:431`

What is happening:

- Session list refreshes are triggered after operations that already returned enough information to update local state.
- Bootstrap also requests session state multiple times.

Why it is expensive:

- Extra refreshes amplify the cost of sidebar summary reconstruction and active-session cloning.

What to do instead:

- return active-session delta plus updated summaries in a single RPC when possible
- apply optimistic local updates for simple mutations
- debounce background reconciliation

### 7. Session defaults and metadata recovery rely on full session context

Impact: medium

Relevant code:

- `src/bun/session-catalog.ts:928`

What is happening:

- Restored defaults such as provider, model, and thinking level are derived from `buildSessionContext()`.

Why it is expensive:

- Metadata reads depend on full context reconstruction.
- This makes common operations pay transcript-scale cost.

What to do instead:

- persist runtime-profile metadata separately from transcript materialization
- treat full session context as a detail load, not a metadata prerequisite

## Why These Costs Exist

Most of the current hotspots are not caused by TypeScript, Svelte, or Electrobun by themselves. They come from a repeated structural pattern:

- the transcript is treated as the source of truth for many derived surfaces
- derived product state is reconstructed by replaying that source of truth
- metadata views depend on detail-level materialization
- transport sends snapshots instead of deltas

That pattern is already misaligned with the PRD. The PRD explicitly says `svvy` should not rely on transcript-only memory and should not replay raw transcript for every decision. The future product surface increases the penalty of keeping the current pattern.

## PRD-Driven Future Optimization Areas

The sections below cover optimization requirements implied by the intended product, not just the current shipped code.

### 1. Session, thread, episode, artifact, and verification state

PRD pressure:

- sessions contain structured product state beyond chat messages
- threads are bounded workstreams
- episodes are the main reusable outputs
- verification records are first-class
- artifacts are durable and file-addressable

Optimization requirement:

- model these as first-class durable entities with their own indexes and projections

Do not:

- reconstruct threads, episodes, artifacts, or verification purely by replaying raw transcript

Preferred direction:

- append-only event log plus normalized state tables
- secondary indexes by session, thread, episode, artifact, workflow run, and worktree
- direct lookup for latest summaries and statuses

### 2. Session-centric UI with multiple live surfaces

PRD pressure:

- the main session view must show conversation, threads, workflow activity, episodes, verification, and artifacts together
- the shell supports fixed pane layouts up to `3x3`
- the same surface may be open in multiple panes

Optimization requirement:

- one canonical backing state per surface, many lightweight views

Do not:

- duplicate transcript parsing, artifact reconstruction, or workflow graph derivation per pane

Preferred direction:

- shared immutable backing stores
- pane-local viewport state only
- memoized selectors by surface ID
- virtualization and culling for long timelines and inspectors

### 3. Workflow inspector and delegated workflow projection

PRD pressure:

- workflow runs get a dedicated read-only graph inspector
- graph nodes update live
- node drill-down exposes outputs, artifacts, runtime profile, worktree, and model details

Optimization requirement:

- workflow state must be represented as a durable graph model plus delta stream

Do not:

- rebuild the entire workflow graph on every event
- flatten workflow runs into transcript-only render data

Preferred direction:

- graph snapshot plus node-level event patches
- node caches keyed by workflow run and node ID
- viewport-aware graph rendering
- lazy loading of deep node details and logs

### 4. Context-budget observability

PRD pressure:

- context percentages must be visible across main session, collapsed delegated surfaces, and expanded panes

Optimization requirement:

- maintain incremental token-accounting state per surface and runtime profile

Do not:

- recalculate token pressure from full message history every render

Preferred direction:

- running token counters
- cached context budgets keyed by surface and model
- invalidation only on transcript mutation or profile change

### 5. Composer file mentions and workspace-aware autocomplete

PRD pressure:

- `@` mentions must autocomplete files and folders
- mentions stay symbolic rather than inlining file contents

Optimization requirement:

- repository discovery and mention resolution must be indexed

Do not:

- scan the workspace tree on each keypress

Preferred direction:

- workspace file index with incremental invalidation
- fuzzy-search cache
- symbolic mention storage keyed by workspace-relative path or durable file identity

### 6. Runtime profiles and per-session overrides

PRD pressure:

- app-wide runtime profiles exist for orchestrator, quick, explorer, implementer, reviewer, workflow-writer, and namer
- sessions can override those profiles
- handler threads and workflow tasks inherit bounded task defaults

Optimization requirement:

- runtime-profile resolution should be metadata-driven and cheap

Do not:

- derive runtime-profile state by replaying sessions or rebuilding large config objects on every routing step

Preferred direction:

- versioned profile registry
- session-level override records
- pre-resolved effective profile objects cached by session and worker type

### 7. Worktree awareness

PRD pressure:

- threads and workflows can be associated with worktrees
- UI must show worktree alignment clearly

Optimization requirement:

- worktree state must be first-class indexed metadata

Do not:

- rediscover worktree relationships by recomputing from arbitrary workflow or transcript text

Preferred direction:

- explicit worktree registry
- thread-to-worktree and workflow-to-worktree links
- fast mismatch detection between active session context and filesystem context

### 8. Verification as a first-class feature

PRD pressure:

- build, test, lint, integration, and manual checkpoints all become structured verification records

Optimization requirement:

- verification records need independent persistence and summary indexes

Do not:

- store verification purely as transcript prose and reparse it later

Preferred direction:

- normalized verification records with status, timestamps, summaries, and artifact links
- aggregate status per thread, session, and workflow run
- incremental rollups for "latest verification" and "blocking failures"

### 9. Workflow setup and validation

PRD pressure:

- consequential workflows may still need setup and validation behavior, but that behavior should be modeled as explicit workflow steps rather than as a separate hook layer

Optimization requirement:

- those explicit workflow steps must be bounded, cached where safe, and projected as structured outputs

Do not:

- rerun expensive context gathering or repo scans when cached repo state would suffice

Preferred direction:

- step result caching keyed by repo state where valid
- structured hook artifacts
- explicit hook timing and failure attribution

### 10. `execute_typescript` / code mode

PRD pressure:

- code mode is available on both direct and delegated paths
- code-mode events and traces must be captured as command records, command summaries, trace facts, and artifacts; only the supervising surface may later produce a terminal episode

Optimization requirement:

- execution environments and trace capture must avoid unnecessary cold starts and oversized payloads

Do not:

- treat each small code-mode action as a fresh full-system bootstrap when pooling or caching is possible

Preferred direction:

- reusable runtime pools where safety allows
- compact structured trace events
- artifactized logs instead of embedding large traces into hot UI state

### 11. Headless and automation surfaces

PRD pressure:

- desktop and headless surfaces share the same orchestrator and product model

Optimization requirement:

- the core state model must be UI-independent and streamable as structured deltas

Do not:

- make headless execution depend on desktop-only projections
- make desktop performance depend on headless-oriented transcript replay

Preferred direction:

- one canonical core event model
- separate projection layers for desktop, inspector, and headless outputs
- transport contracts that support snapshot plus delta replay

### 12. Resume after interruption and durable reconstruction

PRD pressure:

- sessions and workflows must resume safely after restart
- state must be durable and legible without replaying the entire transcript for every view

Optimization requirement:

- restart recovery should restore coarse state from durable projections first, then load fine detail on demand

Do not:

- require full transcript, full workflow log, and full artifact replay before the shell becomes usable

Preferred direction:

- startup loads workspace summary, session summaries, active session metadata, pane layout, and pending work first
- transcript segments, artifacts, and deep workflow details stream in lazily

## Recommended Architecture Direction

The following architecture direction best matches both the current hotspots and the PRD.

### 1. Canonical append-only event model

Capture durable events for:

- transcript mutations
- thread lifecycle changes
- episode creation and reconciliation
- artifact creation and updates
- verification records
- workflow run updates
- worktree associations
- runtime-profile changes

### 2. Normalized product-state store

Maintain explicit stores for:

- workspaces
- sessions
- threads
- episodes
- artifacts
- verification records
- workflow runs
- workflow graph nodes
- pane layouts
- worktrees

### 3. Incremental projections

Build projections incrementally for:

- session sidebar summaries
- current session timeline
- artifact panel
- verification rollups
- workflow graph summaries
- context-budget indicators

### 4. Snapshot plus delta transport

Between Bun and renderer:

- send compact snapshots at bootstrap
- send deltas afterward
- avoid shipping full transcript history unless a detail surface explicitly requests it

### 5. Viewport-aware UI

For transcript, graph, artifact, and inspector surfaces:

- virtualize long lists
- cull offscreen nodes
- keep pane-local state lightweight

## Suggested Optimization Order

### Phase 1: highest ROI on current code

- virtualize transcript rendering and stop cloning full message history on every stream update
- make artifact projection incremental
- persist and serve session sidebar summaries without building full inactive-session context

### Phase 2: fix transport and projection boundaries

- replace full active-session sync with snapshot plus delta transport
- remove full-history `JSON.stringify` sync checks
- cache flattened prompt state and transcript metadata

### Phase 3: build the PRD-ready data model

- introduce first-class thread, episode, artifact, verification, workflow, and worktree stores
- make startup metadata-first and detail-lazy
- make workflow inspector and multi-pane UI consume shared projections instead of transcript replay

## Practical Litmus Test

Before implementing a new feature from the PRD, ask:

1. Can this surface render from indexed product state instead of replaying transcript?
2. Can session summaries and list views load from persisted metadata without materializing full detail?
3. Can updates arrive as deltas instead of full snapshots?
4. Can multiple panes share one canonical backing state?
5. Can restart recovery show useful state before deep history is loaded?

If the answer is "no", the implementation is likely building more transcript-replay debt.
