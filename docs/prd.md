# Product Requirements Document

## Title

Ship `svvy` as an Electrobun desktop coding app with a pi-backed runtime, a visible `svvy` orchestrator, and Smithers-backed delegated workflows.

## Status

- Date: 2026-04-09
- Status: target product PRD
- Scope: this document defines the intended shipped product, not just the current bootstrap implementation

## Product Summary

`svvy` is a desktop coding agent for working inside real repositories with visible orchestration instead of a single opaque chat loop.

The product combines:

- an Electrobun desktop shell
- a pi-backed interactive runtime and session substrate
- a `svvy` orchestrator that owns routing, reconciliation, and final decisions
- Smithers-backed delegated workflows for bounded subagent work
- first-class episodes, artifacts, verification, and worktree awareness

The result should feel closer to Slate than to stock pi:

- one strategic brain
- bounded delegated work instead of persistent role agents
- reusable structured outputs instead of transcript-only memory
- visible verification and workflow state
- safe resume after interruption

## Product Goals

The shipped product must let a user:

- open a local repository in a native desktop app and work in long-lived coding sessions
- understand what the system is doing without reconstructing state from raw logs
- move fluidly between direct action, delegated workflow execution, verification, and pause states
- inspect durable outputs from each meaningful unit of work
- resume interrupted work safely across app restarts
- keep session context and worktree context aligned
- use the same product model from both the desktop app and headless automation surfaces

## Product Principles

### 1. One Strategic Brain

The main orchestrator owns:

- request interpretation
- path selection
- context loading
- delegated work authoring
- reconciliation
- final user-facing decisions

No worker becomes the source of truth for overall strategy.

### 2. Bounded Work Over Persistent Roles

Subagents are short-lived and task-specific.

The product does not use permanent planner, implementer, or reviewer personas as the default operating model.

### 3. Sessions Are Product Containers, Not Just Transcripts

A session is the durable user-facing container for:

- conversation history
- threads
- episodes
- artifacts
- verification state
- workflow references
- blocked and waiting states

### 4. Episodes Are the Main Reusable Output

Every meaningful work unit produces a structured episode that captures durable value rather than transcript noise.

### 5. Verification Changes What Happens Next

Build, test, lint, integration, and manual checks are first-class product events. They are not cosmetic post-processing.

### 6. Visible State Beats Hidden Mechanics

The user must be able to see:

- what is active
- what finished
- what is blocked
- what was verified
- what needs clarification
- which worktree and session are currently in play

### 7. Context Is a Scarce Resource

The system should preserve strategic context in the orchestrator, spend local context deliberately, and externalize whatever does not need to stay in the active model window.

In practice that means:

- useful results are compressed into episodes and artifacts instead of dragging full transcripts forward
- repeatable structure is scripted rather than repeatedly re-derived in prose
- dynamic composition should move into `execute_typescript` when a short program is clearer and more reliable than many low-level tool calls
- raw model reasoning is reserved for ambiguity, synthesis, prioritization, and recovery

This is the intended middle path between two failure modes:

- transcript-heavy agents that keep too much in context and lose focus
- rigid workflow systems that over-script work and lose adaptability

`svvy` should deliberately interleave agentic reasoning and executable structure:

- use the model where judgment matters
- use code and workflow structure where repetition, composition, or verification matter
- move information across that boundary in compressed, reusable forms

### 8. Layered Workflow Knowledge

Workflow-related prompt and knowledge assets should be layered by who needs them.

In practice that means:

- the orchestrator may load minimal workflow-facing knowledge that fits prompt-scale routing and authoring needs
- richer workflow examples, Smithers-specific guidance, and extended operational context should load only inside the bounded delegated worker or workflow run that needs them
- the exact content and file format of those prompt or knowledge assets may evolve over time, but the separation of concerns should remain stable

This keeps workflow capability available without bloating orchestrator context.

### 9. Full Approvals By Default

`svvy` runs with full approvals by default.

In practice that means:

- the product does not expose approval objects or approval gates as first-class user-facing behavior
- ambiguity is handled through clarification and waiting states rather than approval prompts
- delegated workflows may pause for missing information or resumable waiting conditions, but not for product-level approval requests

## Product Ownership Boundaries

### Electrobun

Electrobun owns:

- the native desktop shell
- windowing
- packaging
- app lifecycle
- OS integration

### pi

`pi` owns:

- the interactive runtime seam
- the base tool loop substrate
- the session substrate
- supported extension and runtime hooks
- core provider-facing agent runtime behavior

`svvy` must extend or project through pi's runtime and extension APIs. It must not replace pi with a second agent shell.

### svvy

`svvy` owns:

- product behavior above the pi seam
- the orchestrator
- thread, episode, artifact, and verification models
- reconciliation
- routing decisions
- desktop UI product semantics
- workflow and verification projection in the app

### Smithers

Smithers owns:

- delegated workflow execution
- durable multi-step runs
- loops, retries, and branches when a delegated workflow needs them
- worktree-isolated execution when delegated work requires it

Smithers is not:

- the top-level product shell
- the top-level session model
- the main source of product strategy

### execute_typescript

`execute_typescript` is an internal execution primitive, not a top-level user path.

It is available to the orchestrator and to delegated work when typed capability composition is the most effective way to complete a bounded task.

## Users and Primary Jobs

The product is for developers who want an agent that can work in a real repository without collapsing into either:

- a transcript-heavy chat bot
- a rigid static automation graph

Primary jobs:

- understand an unfamiliar codebase
- make code and docs changes safely
- run and interpret verification
- delegate bounded work while keeping strategic control visible
- inspect what happened and why
- resume work after interruption without losing state
- automate the same product behavior outside the desktop UI when needed

## Product Model

### Workspace

A workspace is the local repository context the app is attached to.

It includes:

- repository root
- current branch or VCS state
- available worktrees
- repo-local `AGENTS.md` and `.svvy/` configuration
- recent session history for that workspace
- flat folder labels used to organize sessions in the sidebar
- a persisted pane layout for that workspace window

### Session

A session is the top-level user-visible unit of ongoing work inside a workspace.

A session must support:

- creation
- resume
- branch or fork navigation
- durable history
- a stable user-visible title
- structured product state in addition to chat messages
- session-level runtime profile overrides above app-wide defaults
- session-level view of active and completed work

### Thread

A thread is a bounded workstream within a session.

Examples:

- direct answer or small action
- delegated Smithers workflow
- verification run
- clarification or waiting state

Threads must expose:

- objective
- status
- current executor
- related worktree
- related episodes
- blocked or waiting reason when applicable

### Episode

An episode is the main synchronization unit produced by any meaningful work step.

An episode should capture:

- objective
- source
- status
- conclusions
- changed files
- artifacts
- verification outcomes
- unresolved issues
- follow-up suggestions
- provenance

### Artifact

Artifacts are file-addressable outputs referenced by episodes.

Examples:

- diffs
- logs
- test reports
- screenshots
- structured workflow outputs
- exported verification details

### Verification Record

A verification record captures a single meaningful check such as:

- build
- test
- lint
- integration
- manual review checkpoint

It must include status, summary, and linked artifacts.

### Workflow Run

A workflow run is the durable record of delegated Smithers-backed work associated with a thread and its episodes.

## Desktop Experience

The desktop experience is the primary user-facing surface for the product.

### App Shell

The shipped desktop app should present one coherent workspace, not a loose collection of screens.

The default shell includes:

- a left navigation rail for workspace and session navigation
- a main work area for conversation and live orchestration state that can expand into a fixed pane layout up to `3x3`
- a right-side inspector for selected details
- a bottom composer and status strip for prompt entry and current runtime context

### Session UI

The session view is the center of the product.

It must show more than a transcript. The session UI combines:

- the conversation timeline
- visible thread state
- compact subagent cards with a short live headline
- compact workflow cards with a minimal progress overview
- episode summaries
- workflow progress
- verification summaries
- artifact access

The user should be able to understand the current state of work at a glance without opening raw logs.

Workflow runs remain subordinate to the main session model. The primary view should still be threads, episodes, verification, and artifacts, even when a delegated workflow is active.

Subagents and workflows may expand into the right pane or into split panes without becoming separate top-level products views.

### Navigation

Navigation must be session-centric and workspace-aware.

The app must support:

- recent workspace selection
- creating a new orchestrator session
- creating a new quick session
- session switching
- session resume
- grouping sessions with flat manual folder labels in the sidebar
- opening sessions and expanded work surfaces into exact pane slots in a fixed layout up to `3x3`
- opening the same interactive surface in more than one pane slot when the user wants multiple views of it
- exact pane-position indicators in the sidebar for open surfaces, including surfaces that span multiple cells
- session branch or tree navigation
- thread selection within a session
- jumps from messages to episodes, artifacts, verification, and workflow details
- clear indication of current repo and worktree context

### Composer and Runtime Controls

The composer area must support:

- prompt entry
- prompt cancellation while streaming
- `@`-triggered autocomplete over workspace files and folders
- rendering selected file and folder mentions as removable composer chips
- preserving mentions as symbolic context targets with resolved workspace paths rather than pasting raw file contents into the draft
- a visible summary of the current session's main runtime profile
- expandable inspection of per-agent runtime profiles for the session
- per-session override controls for agent runtime profiles rather than raw global model or reasoning selectors
- an explicit context-budget progress bar for the current interactive surface
- explicit context cues for active workspace, session, and worktree

### Inspector Surfaces

The inspector area must support focused inspection of:

- the selected thread
- the selected episode
- verification results
- workflow progress
- artifact previews when available
- unresolved issues and follow-up suggestions

Secondary workflow inspection surfaces may expose deeper live workflow detail without replacing the session-centric main view.

### Dedicated Workflow Inspector

When a delegated workflow needs deeper inspection, the product should expose a dedicated workflow inspector surface for that workflow run.

The day-one workflow inspector is read-only at the workflow-structure level.

It must support:

- a live graph view of the workflow run as a whole
- distinct node types for agent tasks, scripts, verification steps, wait states, retries, and terminal results
- clear active, completed, failed, and waiting visual states
- selecting a node to inspect its current or latest details
- a node detail view showing the node objective, status, latest output, related artifacts, runtime profile, worktree, and model or reasoning details when relevant
- live updates while the workflow is running
- durable inspection of the completed workflow after it finishes
- opening an inspectable child agent or child surface into another pane when deeper drill-down is needed

It must not support:

- editing workflow structure from the inspector
- rewiring graph edges manually
- treating the inspector as a workflow authoring surface

### Expanded Work Surfaces

The product should let the user inspect delegated work without leaving the main session.

It must support:

- opening a selected subagent card in the right pane as a fully interactive surface
- opening a selected workflow in the right pane as a fully interactive workflow inspector surface
- placing a subagent or workflow into a targeted pane slot by drag or explicit split/open actions
- expanded subagent panes behaving like normal interactive session surfaces
- expanded workflow panes representing the workflow as a whole through a live graph view, with drill-down into internal workflow boxes or agents
- allowing the same surface to be opened in more than one pane when the user wants multiple views
- keeping the main session, expanded pane, and multi-pane views aligned as one coherent tree of work

### Pane Layout And Sidebar Organization

The workspace shell should support a persisted fixed pane layout up to `3x3`.

It must support:

- panes occupying one or more cells in that `3x3` layout
- exact pane-position indicators for open surfaces in the sidebar, including multi-cell spans
- a clear focus highlight for the currently active pane
- flat manual folder labels for organizing sessions in the sidebar
- folder membership remaining separate from pane placement
- restoring pane layout and pane occupancy across app restarts

### Context Budget Observability

Context pressure should be visible as explicit percentages against the active model's maximum context window.

The product must support:

- a full-width main-session context bar below the text input
- compact bottom-edge context indicators on collapsed subagent and workflow surfaces
- full-width context bars on expanded subagent and workflow panes
- the same neutral, orange, and red states across all surfaces, driven by explicit percentage thresholds rather than vague heuristics

### Settings and Auth

The app must include settings surfaces for:

- provider authentication
- app-wide default runtime profiles for orchestrator, quick, explorer, implementer, reviewer, and workflow-writer
- local key management and environment-backed credentials
- repo-local product behavior where relevant

## Core Execution Model

Companion diagram: [Execution Model](./execution-model.md)

Every user request goes through one orchestrator-controlled loop:

1. load current workspace, session, thread, episode, artifact, and verification context
2. classify the request
3. choose the next path
4. execute bounded work
5. normalize the output into one or more episodes
6. reconcile product state
7. continue, pause, or finish

The product supports four top-level execution paths.

### Direct Path

Use the direct path for:

- explanation
- small synthesis
- small read-only inspection
- tiny single-step actions

The direct path still produces an episode.

### Delegated Workflow Path

Use the delegated path when work benefits from:

- an explicit bounded subagent
- multi-step structure
- durable resume
- loops or retries
- worktree isolation
- explicit workflow state in the UI

Delegated work should usually be represented as a Smithers workflow, even when the workflow is small.

### Verification Path

Use the verification path when the main next step is to check reality rather than modify it.

Verification results must feed back into routing and reconciliation.

### Clarification or Pause Path

Use the pause path when:

- the user must make a product choice
- the next action is ambiguous
- required information or an external prerequisite is missing
- a delegated workflow is paused on a resumable waiting condition

`svvy` runs with full approvals by default. Waiting is for clarification or resumable pause conditions, not approval gating.

## Slate-Inspired Subagent Model

`svvy` borrows product behavior from public Slate material and from defensible inferences about what makes that behavior effective.

The adopted subagent model is:

- one main orchestrator owns strategy and integration
- delegated work is bounded and short-lived
- subagents return durable outputs instead of long private side conversations
- synchronization happens frequently through episodes
- the system re-enters cheaply after each meaningful unit of work
- the orchestrator keeps only lightweight workflow knowledge while richer workflow context stays local to delegated work
- runtime profiles such as explorer, implementer, reviewer, and workflow-writer are bounded-task presets, not persistent always-on agents
- hidden system agents may exist for narrow product tasks such as one-shot session naming without becoming user-facing persistent roles

This means the product should not optimize for:

- persistent role agents
- stale long-range plans as the main control surface
- transcript replay as the primary memory mechanism

## Feature Requirements

### 1. Desktop Workspace and Repository Lifecycle

The app must support:

- opening a local repository in a native desktop shell
- remembering recent workspaces
- showing repository identity and status in the UI
- preserving workspace-scoped session history
- preserving workspace-scoped pane layout and sidebar organization
- surfacing worktree context clearly

### 2. Provider Authentication and Model Configuration

The app must support:

- provider login and key configuration
- local persistence of auth state
- environment-backed provider keys
- app-wide default runtime profiles for orchestrator, quick, explorer, implementer, reviewer, and workflow-writer
- each runtime profile carrying a provider, model, and reasoning-effort configuration
- per-session overrides of those runtime profiles
- a hidden `namer` system agent seeded initially to `gpt-5.4-mini` with low reasoning effort for one-shot top-level session naming

### 3. Session Lifecycle and Navigation

The app must support:

- creating a new orchestrator session
- creating a new quick session
- resuming an existing session
- one-shot automatic naming of top-level sessions after the first real user turn
- no silent re-titling after the first real user turn has passed or after manual rename
- deterministic task-based titles for delegated subagents and workflows instead of a separate naming pass
- branching or forking session history
- listing and filtering sessions from metadata-first summaries
- grouping sessions with flat folder labels
- restoring persisted pane layout and pane occupancy from durable workspace state
- list, resume, and restore flows are metadata-first and only load transcript or detail state on demand
- preserving durable session state across app restarts
- reconstructing visible product state and session runtime profile overrides from durable session data

### 4. Session-Centric Orchestration UI

The app must show, within a single session surface:

- the conversation
- active and completed threads
- compact subagent and workflow surfaces that can be expanded or split
- dedicated read-only workflow inspector surfaces when deeper workflow inspection is needed
- exact pane placement and focus when the workspace is using a multi-pane layout
- latest episodes
- verification summaries
- blocked or waiting work
- workflow activity
- session-summary and sidebar projections for sessions, threads, episodes, verification, and workflows from structured state and incremental projections, not transcript replay
- the current main runtime profile with expandable per-agent profile detail
- explicit context-budget indicators for the current surface and delegated work surfaces
- current workspace and worktree context

This is a core product requirement, not a stretch goal.

### 5. Orchestrator and Routing

The orchestrator must:

- classify requests against current context
- choose between direct, delegated, verification, and pause paths
- resolve symbolic file and folder mentions from the composer into request context
- author delegated workflow requests when appropriate
- reconcile all path outputs into the same product model
- make final user-facing decisions after delegated work completes or pauses
- support both orchestrator-session and quick-session entry modes, with different main-session prompts and default main runtime profiles
- treat clarification and resumable waiting as the only pause states surfaced by the product

### 6. Delegated Workflows and Smithers Integration

Smithers-backed workflows are the default delegated-work substrate when a request needs explicit subagent boundaries or durable workflow structure.

The product must support:

- short-lived delegated workflows for bounded work
- workflows as small as one explicit bounded agent task
- larger workflows with retries, loops, and worktrees when needed
- durable workflow pause and resume
- workflow progress projected into the desktop UI
- workflow results translated into episodes and artifacts
- structured workflow knowledge assets split between minimal orchestrator-facing summaries and richer worker-facing prompts or examples
- delegated workers loading the rich workflow context they need without expanding orchestrator context to match
- delegated Smithers agents using runtime profiles such as explorer, implementer, reviewer, and workflow-writer when the workflow authoring or execution path requires them
- workflow runs being inspectable as dedicated read-only graph surfaces, with drill-down into internal workflow nodes and child agent surfaces

### 7. Episodes, Artifacts, and Reconciliation

The system must:

- create episodes from direct work, delegated work, and verification
- preserve artifact references durably
- expose changed files and outputs clearly
- retain unresolved issues and follow-up suggestions
- make episodes reusable as inputs to later work

### 8. Verification

Verification is a first-class feature area.

The product must support structured capture and display of:

- build runs
- test runs
- lint runs
- integration checks
- manual verification checkpoints

Verification must influence routing. A failed or incomplete verification result cannot be treated as a cosmetic note.

### 9. Worktree Awareness

The product must treat worktree context as first-class.

At minimum:

- a thread may be associated with a worktree
- a delegated workflow may run in a worktree
- the session UI must show which worktree active work belongs to
- the user must be able to tell when session context and filesystem context are misaligned

### 10. execute_typescript / Code Mode

Companion spec: [execute_typescript / Code Mode](./specs/execute-typescript.spec.md)

The product adopts one internal code-mode primitive:

- tool name: `execute_typescript`
- input shape: `typescriptCode`
- output shape: `{ success, result, logs, error }`
- initial runtime: QuickJS
- capability model: flat async `external_*` bindings generated from the selected host tools

Code mode is available:

- on the direct path
- inside Smithers-backed delegated work

Code mode is used for:

- typed capability composition
- compact scripted transformations
- reducing low-level multi-tool chatter when a short program is the clearer execution unit

Code-mode events and traces must be captured into episodes and artifacts.

Out of scope for the first implementation:

- a code-mode-specific outer sandbox
- a namespaced capability API
- raw unrestricted shell access through code mode

### 11. Repo-Local Workflow Hooks

Companion spec: [Workflow Hooks](./specs/workflow-hooks.spec.md)

The product should support repo-local workflow hooks under a `.svvy/` configuration surface.

Initial required hooks:

- preflight hooks injected at the start of consequential workflows
- validation hooks injected at the end of consequential workflows

Consequential workflows include repo-modifying work, heavy work, and other execution where repo-local policy should apply by default.

These hooks should support repo-specific policy, context gathering, and failure handling without turning the product into a rigid static workflow engine.

### 12. Headless and Automation Surfaces

The product must remain scriptable outside the desktop UI.

Required supporting surfaces:

- headless one-shot execution
- structured workflow input
- structured event or result output
- reuse of the same orchestrator and product model used by the desktop app

The desktop app is primary, but headless execution is a real product surface, not a throwaway test mode.

## Persistence and State Requirements

- pi-backed sessions remain the top-level user-facing session substrate
- `svvy` extends that substrate with structured product state
- session summaries, sidebar rows, navigation state, pane indicators, and restart recovery must come from durable metadata or projections, not transcript replay
- product state must not depend on replaying the raw transcript for every decision
- transcript and detail payloads are loaded lazily when the user opens or expands a surface that needs them
- artifacts may live on disk and be referenced from durable product state
- Smithers may keep its own workflow-run state, but that state is subordinate to the top-level session and episode model

## Quality Requirements

- the user must be able to recover meaningful state after app restart or workflow interruption
- direct work, delegated work, and verification must normalize into one coherent product model
- active, blocked, and completed work must be legible in the UI
- clarification and waiting states must be explicit
- product behavior must stay adaptive rather than collapsing into a rigid workflow tree
- tests for interactive behavior must exercise the real pi-backed runtime seam, not a fake shell presented as the product

## Required v1 Scope

The shipped v1 product includes:

- Electrobun desktop shell
- pi-backed runtime and session substrate
- provider auth and model settings
- session creation, resume, and navigation
- a session-centric UI with conversation, threads, episodes, verification, workflow activity, and artifacts
- one orchestrator with direct, delegated, verification, and pause paths
- Smithers-backed delegated workflows
- first-class episodes and artifact inspection
- first-class verification
- worktree-aware thread and workflow state
- `execute_typescript` on the direct and delegated paths
- repo-local preflight and validation workflow hooks
- headless one-shot execution and structured workflow input or output

## Later, Not v1

- richer multi-model routing beyond practical session-level controls
- advanced collaboration or multi-user features
- a full long-lived server product surface
- remote execution and attachment patterns beyond local-repo-first workflows
- secondary storage backends beyond the primary pi-backed session substrate

## Explicit Non-Goals

The product is not trying to:

- visually clone Slate
- claim private knowledge of Slate internals
- build a standalone custom shell, readline loop, or alternate TUI stack outside pi
- ship a fake shell, stdout snapshot renderer, or demo-only terminal path as the real product
- make Smithers the top-level shell or top-level session model
- force all requests through rigid predeclared workflows
- rely on transcript-only memory
- adopt persistent planner, implementer, and reviewer role stacks as the default model
- turn code mode into a second unrestricted shell

## Ship Criteria

The product is on target when all of the following are true:

- a user can open a real repository in the desktop app, authenticate a provider, and work in durable sessions
- the session UI makes current work legible through threads, episodes, verification, workflow state, and artifacts
- the orchestrator can choose between direct, delegated, verification, and pause paths without breaking the user model
- delegated work is visible, bounded, and resumable
- meaningful work produces reusable episodes
- verification is structured, inspectable, and programmatically relevant
- worktree context is visible and aligned with active work
- the same core product model is usable from both the desktop app and headless execution surfaces
- pi remains the runtime substrate and Smithers remains the delegated workflow engine rather than replacing the product shell

## Design Basis

### Public Slate Facts We Intend to Emulate

The product intentionally borrows these public ideas:

- one central orchestrator owns strategy and integration
- bounded worker threads are the delegation unit
- durable intermediate outputs matter
- synchronization is frequent
- worktrees and structured automation surfaces matter

### Svvy Inferences From Slate

The product also adopts these explicit inferences:

- the quality comes from orchestration discipline more than cosmetic UI similarity
- structured outputs matter more than long prose summaries
- routing by task type improves reliability
- the best balance is adaptive orchestration with bounded synchronization, not transcript sprawl and not rigid workflow bureaucracy

These are `svvy` product choices, not claims about private Slate internals.
