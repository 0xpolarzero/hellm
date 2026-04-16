# Product Requirements Document

## Title

Ship `svvy` as an Electrobun desktop coding app with a pi-backed runtime, a visible `svvy` orchestrator, and Smithers-backed delegated workflows.

## Status

- Date: 2026-04-15
- Status: target product PRD
- Scope: this document defines the intended shipped product, not just the current bootstrap implementation

## Product Summary

`svvy` is a desktop coding agent for working inside real repositories with visible orchestration instead of a single opaque chat loop.

The product combines:

- an Electrobun desktop shell
- a pi-backed interactive runtime and session substrate
- a `svvy` orchestrator that owns routing, reconciliation, and final decisions
- Smithers-backed delegated workflows for bounded subagent work
- first-class threads, commands, episodes, artifacts, verification, and worktree awareness

The intended feel is closer to Slate than to stock pi:

- one strategic brain
- bounded delegated work instead of persistent role agents
- reusable structured outputs instead of transcript-only memory
- visible workflow and verification state without turning the app into a rigid workflow builder
- safe resume after interruption

## Product Goals

The shipped product must let a user:

- open a local repository in a native desktop app and work in long-lived coding sessions
- understand what the system is doing without reconstructing state from raw logs
- inspect durable outputs from each meaningful unit of work
- delegate bounded work while keeping top-level strategy and state visible
- run and interpret verification as first-class product behavior
- pause and resume safely when user input or an external prerequisite is required
- keep session context and worktree context aligned
- use the same execution model from both the desktop app and headless automation surfaces

## Product Principles

### 1. One Strategic Brain

The main orchestrator owns:

- request interpretation
- context loading
- tool selection
- delegated workflow authoring
- reconciliation
- final user-facing decisions

No worker becomes the source of truth for overall strategy.

### 2. One Execution Model

`svvy` does not have separate execution engines for direct work, workflow work, verification work, and waiting.

It has one execution model:

```text
tool call -> command -> handler -> events -> structured state -> UI
```

Everything the agent does is a tool call.

The differences between ordinary work, delegated work, verification, and waiting come from which tool is called and which runtime component handles it, not from four separate product subsystems.

### 3. `execute_typescript` Is The Default Generic Work Surface

Generic work should default to `execute_typescript`.

That includes:

- reading files
- searching text
- inspecting git state
- generating artifacts
- performing web lookups
- composing several small tool calls into one bounded program
- handling multi-step semantic work across more than one turn when that is the right unit of work

The goal is consistency and lower conceptual overhead. Generic work should not splinter into many unrelated ad hoc surfaces when a single typed TypeScript tool can do the job more clearly. It also should not pretend that one deterministic script can summarize unseen text or replace normal orchestrator back-and-forth when the task needs a sequence of observations and decisions.

Inside `execute_typescript`, the runtime injects `api.*` as a host SDK. `api.*` is the observable capability surface for external effects and facts, not a hard permission boundary. The SDK includes explicit `api.exec.run` for command execution. The full SDK declaration should be generated from the same source-of-truth contract used by the runtime and embedded verbatim in the default system prompt so the orchestrator sees the exact callable surface, including relevant JSDoc guidance, before it writes a snippet. Nested `api.*` calls produce child command facts for traceability, while the enclosing `execute_typescript` attempt remains the main semantic unit. Every submitted snippet is persisted as a file-backed artifact in the workspace artifact directory, and the runtime must compile or typecheck the snippet before execution. Structured diagnostics must be produced, and invalid snippets must not run.

### 4. Native Control Tools Stay Small And Explicit

Some actions are not ordinary generic work because they change product-level control flow.

Those actions stay as native control tools:

- `workflow.start`
- `workflow.resume`
- `verification.run`
- `wait`

These are still tool calls.

They remain special only because they are handled by runtime integrations that own workflow, verification, and waiting semantics. They move the product-level execution frontier, so they stay native instead of being wrapped as generic SDK calls.

### 5. Sessions Are Product Containers, Not Just Transcripts

A session is the durable user-facing container for:

- conversation history
- turns
- all threads
- command history
- episodes
- artifacts
- verification records
- workflow records
- wait state

Session summaries, sidebar rows, and recovery views must be read models derived from structured state and artifact metadata, not from transcript reconstruction.

`svvy` treats the structured session SQLite store as current-schema-only local state. Incompatible persisted layouts are discarded and rebuilt instead of being migrated forward.

### 6. Commands Are Requests, Events Are Facts

The system must keep these roles separate:

- commands are requests to do work
- events are facts about what happened
- structured state is the current durable product view
- the transcript is conversation history, not product truth

The UI must read structured state and selectors, not reconstruct core product behavior from assistant prose.

### 7. Episodes Are The Main Reusable Output

Every meaningful unit of work should produce a durable episode rather than leaving durable value trapped inside transcript text.

Episodes are what later orchestrator turns should reuse first.

### 8. Visible State Beats Hidden Mechanics

The user must be able to see:

- what is active
- what finished
- what failed
- what is waiting on the user
- what is only waiting on another internal work item
- what was verified
- which workflow is in flight
- which worktree and session are currently in play

### 9. Context Is A Scarce Resource

The system should preserve strategic context in the orchestrator, spend local context deliberately, and externalize whatever does not need to stay in the active model window.

In practice that means:

- useful results are compressed into episodes and artifacts instead of dragging full transcripts forward
- repeatable structure is pushed into `execute_typescript` or workflow definitions instead of repeatedly re-derived in prose
- raw model reasoning is reserved for ambiguity, synthesis, prioritization, and recovery

### 10. Full Approvals By Default

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
- session, turn, thread, command, episode, artifact, verification, workflow, and wait models
- reconciliation
- desktop UI product semantics
- read models and selectors that drive the app

### Smithers

Smithers owns:

- delegated workflow execution
- durable multi-step runs
- retries, loops, branches, and internal workflow state
- worktree-isolated execution when delegated work requires it

Smithers is not:

- the top-level product shell
- the top-level session model
- the main source of product strategy

### `execute_typescript`

`execute_typescript` is the default generic work surface used by the orchestrator and delegated workers when typed capability composition is the clearest way to complete a bounded task.

It is not a separate top-level product mode.

The runtime inside `execute_typescript` exposes observable `api.*` host capabilities.

## Users And Primary Jobs

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

### Turn

A turn is one top-level user request handled by the orchestrator.

A turn is the main correlation root for:

- the triggering user request
- the threads created while handling that request
- the commands issued during that request
- the final response or wait state produced by that request

### Thread

A thread is a visible bounded work item inside a session.

Thread kinds are:

- `task`
- `workflow`
- `verification`

A thread may:

- run directly under the orchestrator
- represent a delegated workflow started by the orchestrator
- represent a verification run started by the orchestrator
- wait on child thread completion
- wait on user or external input

Waiting is a thread or session status, not a separate thread kind.

### Command

A command is the durable record of one tool call.

Every tool call should become a command record with:

- the tool name
- executor ownership
- status
- parent-child linkage when commands nest
- trace versus surfaced visibility
- timestamps

Commands are the universal execution primitive in the product model.

### Episode

An episode is the main synchronization unit produced by any meaningful unit of work.

An episode should capture:

- objective
- source thread
- source command where relevant
- status or outcome
- conclusions
- changed files
- artifacts
- verification outcomes
- unresolved issues
- follow-up suggestions
- provenance

### Artifact

Artifacts are durable outputs referenced by episodes.

Examples:

- diffs
- logs
- test reports
- submitted `execute_typescript` source snippets, including failed attempts
- screenshots
- generated files
- exported workflow details

### Verification Record

A verification record captures a real verification outcome such as:

- build
- test
- lint
- integration
- manual review checkpoint

It must include status, summary, and linked evidence.

### Workflow Record

A workflow record is the `svvy`-side durable record of a delegated Smithers run.

It is not a copy of Smithers internals.

It exists so the session model can expose:

- which workflow was started
- which Smithers run it maps to
- its current top-level status
- a legible top-level summary

## Tool Model

### Model-Facing Tool Surface

The adopted top-level tool surface is intentionally small:

- `execute_typescript`
- `workflow.start`
- `workflow.resume`
- `verification.run`
- `wait`

This is the product-facing execution surface the orchestrator reasons about.

### Generic Capability Surface Inside `execute_typescript`

Inside `execute_typescript`, the runtime should expose a typed object API as observable `api.*` host capabilities.

The exact capability list may evolve, but the shape should look like:

```ts
await api.repo.readFile({ path });
await api.repo.readFiles({ paths });
await api.repo.grep({ pattern, glob });
await api.repo.glob({ pattern });
await api.git.status({});
await api.git.diff({});
await api.git.log({});
await api.git.show({});
await api.git.branch({});
await api.git.mergeBase({});
await api.web.search({ query });
await api.artifact.writeText({ name, text });
await api.exec.run({ command, cwd });
```

This is the adopted direction for consistency. Every submitted snippet is persisted as a file-backed artifact in the workspace artifact directory, with path metadata that can be indexed by SQLite. Before any run, the runtime must typecheck or compile the snippet, emit structured diagnostics, and block execution when the snippet is invalid.

The concrete day-one `api.*` inventory is defined in the `execute_typescript` companion spec. It should stay function-first, namespace-based, and generic where useful rather than drifting into class-based clients or hidden control-flow helpers. The repo namespace should read like workspace fs and search utilities with singular and plural reads, and the git namespace should use curated command-shaped names such as `status`, `diff`, `log`, `show`, `branch`, `mergeBase`, `fetch`, `pull`, `push`, `add`, `commit`, `switch`, `checkout`, `restore`, `rebase`, `cherryPick`, `stash`, and `tag`.

### Native Control Tool Boundaries

Control tools are native because they change product-owned execution state:

- `workflow.start` starts a real Smithers workflow and creates a workflow thread and workflow record
- `workflow.resume` resumes a paused workflow from durable state
- `verification.run` launches real verification and creates a verification thread and verification record
- `wait` marks the current thread as waiting and may place the whole session into wait state when no runnable work remains

These tools request real work.

They do not directly write arbitrary product state. Runtime handlers and bridges own the resulting facts.

## Desktop Experience

The desktop experience is the primary user-facing surface for the product.

### App Shell

The shipped desktop app should present one coherent workspace, not a loose collection of screens.

The default shell includes:

- a left navigation rail for workspace and session navigation
- a main work area for conversation and visible orchestration state that can expand into a fixed pane layout up to `3x3`
- a right-side inspector for selected details
- a bottom composer and status strip for prompt entry and current runtime context

### Session UI

The session view is the center of the product.

It must show more than a transcript. The session UI combines:

- the conversation timeline
- thread state for all threads
- compact workflow and verification cards when those threads exist
- episode summaries
- workflow state
- verification summaries
- artifact access
- inline visibility into submitted `execute_typescript` bodies on transcript tool-call cards
- explicit wait state
- session summaries and navigation metadata derived from structured state and artifact metadata, not transcript reconstruction

The user should be able to understand the current state of work at a glance without opening raw logs.

Low-level generic commands such as file reads or text searches should be durably recorded, but they should normally remain trace-level details rather than top-level UI clutter.

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

### Composer And Runtime Controls

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
- workflow status
- artifact previews when available
- unresolved issues and follow-up suggestions

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

- opening a selected workflow or verification surface in the right pane
- placing a surface into a targeted pane slot by drag or explicit split or open actions
- expanded panes behaving like normal inspectable session surfaces
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
- compact bottom-edge context indicators on collapsed delegated-work surfaces
- full-width context bars on expanded delegated-work panes
- the same neutral, orange, and red states across all surfaces, driven by explicit percentage thresholds rather than vague heuristics

### Settings And Auth

The app must include settings surfaces for:

- provider authentication
- app-wide default runtime profiles for orchestrator, quick, explorer, implementer, reviewer, and workflow-writer
- local key management and environment-backed credentials
- repo-local product behavior where relevant

## Core Execution Model

Companion diagram: [Execution Model](./execution-model.md)

Every user request goes through one orchestrator-controlled loop:

1. load current workspace, session, thread, episode, artifact, verification, workflow, and wait context
2. open a new turn
3. choose the next tool call
4. execute that tool through the correct handler
5. record command and event facts
6. update structured state
7. continue, wait, or finish

The orchestrator does not choose between four separate product paths.

It chooses the next tool call inside one shared command system.

### Ordinary Generic Work

Ordinary generic work should usually happen through `execute_typescript`.

Use it when the work is:

- mostly generic repo or web inspection
- small bounded file or data transformation
- easier to express as a short typed program than as many low-level tool calls

### Delegated Workflow Work

Use `workflow.start` when work benefits from:

- an explicit bounded delegated worker
- multi-step structure
- durable workflow state
- retries, loops, or pause and resume
- isolated worktree execution when the orchestrator decides isolation is worth the cost

Delegated Smithers workflows remain milestone-based by default, not loose todo lists.

### Verification Work

Use `verification.run` when the main next step is to check reality rather than modify it.

Verification results must feed back into routing and reconciliation.

### Waiting

Use `wait` when:

- the user must make a product choice
- the next action is ambiguous
- required information is missing
- an external prerequisite is missing
- a delegated workflow reaches a durable pause condition that blocks the active frontier

Waiting is a status in the shared model, not a separate product path.

Internal waits on child threads or parallel subwork are not whole-session waiting. They remain thread-level dependency state while the session itself stays `running`.

## Slate-Inspired Subagent Model

`svvy` borrows product behavior from public Slate material and from defensible inferences about what makes that behavior effective.

The adopted subagent model is:

- one main orchestrator owns strategy and integration
- delegated work is bounded and short-lived
- subagents return durable outputs instead of long private side conversations
- synchronization happens frequently through episodes
- runtime state is written from real command handlers and bridge events rather than transcript inference
- the orchestrator keeps only lightweight workflow knowledge while richer workflow context stays local to delegated work
- runtime profiles such as explorer, implementer, reviewer, and workflow-writer are bounded-task presets, not persistent always-on agents
- hidden system agents may exist for narrow product tasks such as one-shot session naming without becoming user-facing persistent roles

This means the product should not optimize for:

- persistent role agents
- stale long-range plans as the main control surface
- transcript replay as the primary memory mechanism

## Feature Requirements

### 1. Desktop Workspace And Repository Lifecycle

The app must support:

- opening a local repository in a native desktop shell
- remembering recent workspaces
- showing repository identity and status in the UI
- preserving workspace-scoped session history
- preserving workspace-scoped pane layout and sidebar organization
- surfacing worktree context clearly

### 2. Provider Authentication And Runtime Profiles

The app must support:

- provider login and key configuration
- local persistence of auth state
- environment-backed provider keys
- app-wide default runtime profiles for orchestrator, quick, explorer, implementer, reviewer, and workflow-writer
- each runtime profile carrying a provider, model, and reasoning-effort configuration
- per-session overrides of those runtime profiles
- a hidden `namer` system agent seeded initially to `gpt-5.4-mini` with low reasoning effort for one-shot top-level session naming

### 3. Session Lifecycle And Navigation

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
- list, resume, and restore flows being metadata-first and loading transcript or detail state only on demand
- preserving durable session state across app restarts
- reconstructing visible product state, session runtime profile overrides, and session summaries from durable structured data without transcript replay

### 4. Session-Centric Orchestration UI

The app must show, within a single session surface:

- the conversation
- active and completed threads
- compact workflow and verification surfaces that can be expanded or split
- dedicated read-only workflow inspector surfaces when deeper workflow inspection is needed
- exact pane placement and focus when the workspace is using a multi-pane layout
- latest episodes
- verification summaries
- blocked or waiting work
- workflow activity
- metadata-first read models for sessions, threads, episodes, verification, workflows, and wait state
- the current main runtime profile with expandable per-agent profile detail
- explicit context-budget indicators for the current surface and delegated work surfaces
- current workspace and worktree context

This is a core product requirement, not a stretch goal.

### 5. Orchestrator And Tool Routing

The orchestrator must:

- classify requests against current context
- resolve symbolic file and folder mentions from the composer into request context
- choose the next tool call instead of choosing among unrelated execution engines
- prefer `execute_typescript` for ordinary generic work
- call `workflow.start`, `workflow.resume`, `verification.run`, and `wait` only when product-level control flow requires them
- author delegated workflows when appropriate
- reconcile all command outcomes into the same product model
- make final user-facing decisions after delegated work completes or pauses
- support both orchestrator-session and quick-session entry modes, with different main-session prompts and default main runtime profiles

### 6. Delegated Workflows And Smithers Integration

Smithers-backed workflows are the default delegated-work substrate when a request needs explicit subagent boundaries or durable workflow structure.

The product must support:

- short-lived delegated workflows for bounded work
- workflows as small as one explicit bounded agent task
- milestone-based workflows with explicit milestone objectives, completion criteria, agent tasks, and verification boundaries
- larger workflows with retries, loops, and worktrees when needed
- same-branch parallel agents as the default execution mode for milestone tasks
- explicit write scopes for same-branch parallel agents so peer-style collaboration stays coordinated
- same-branch parallel agents assuming that other agents may edit nearby code and must not revert unrelated changes
- milestone-level join barriers before milestone verification runs
- verification after each milestone boundary before later milestones can unlock
- failed milestone verification keeping the milestone open until remediation succeeds
- workflow graph evolution through Smithers hot reload when milestone evidence shows the plan should change
- orchestrator-only ownership of workflow graph evolution and milestone unlock decisions
- worktree isolation only when the orchestrator judges same-branch execution too risky or too collision-prone
- durable workflow pause and resume
- workflow state projected into the desktop UI
- workflow results translated into episodes and artifacts
- structured workflow knowledge assets split between minimal orchestrator-facing summaries and richer worker-facing prompts or examples
- delegated workers loading the rich workflow context they need without expanding orchestrator context to match
- delegated Smithers agents using runtime profiles such as explorer, implementer, reviewer, and workflow-writer when the workflow authoring or execution path requires them
- workflow runs being inspectable as dedicated read-only graph surfaces, with drill-down into internal workflow nodes and child agent surfaces

### 7. Commands, Episodes, Artifacts, And Reconciliation

The system must:

- record every tool call as a command
- preserve parent-child command relationships when commands nest
- preserve command visibility so low-level trace work does not overwhelm the UI
- create episodes from meaningful completed work
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
- delegated workflows should default to the current branch and current worktree rather than spawning worktrees automatically
- worktrees should be used only when the orchestrator explicitly decides isolation is necessary
- the session UI must show which worktree active work belongs to
- the user must be able to tell when session context and filesystem context are misaligned

### 10. `execute_typescript`

Companion spec: [execute_typescript / Code Mode](./specs/execute-typescript.spec.md)

The product adopts one default generic execution tool:

- tool name: `execute_typescript`
- input shape: `typescriptCode`
- output shape: `{ success, result, logs, error }`
- capability model: typed observable `api.*` host capabilities injected by the runtime
- `api.exec.run` is part of the SDK and is the explicit command-execution path
- every attempted snippet is persisted as a file-backed artifact in `.svvy/artifacts/<sessionId>/<artifactId>-<slug>` so the UI can inspect it, including failed attempts
- invalid snippets must be typechecked or compiled first, emit structured diagnostics, and not run
- `execute_typescript` is a deterministic host-SDK execution surface; meaningful semantic synthesis may span more than one tool call or turn when the active agent needs to inspect, reason, then write
- nested `api.*` calls remain child command facts under the parent `execute_typescript` attempt, so UI rollups can stay parent-first while trace inspectors expose the detailed chain of calls

Code mode is available:

- in ordinary orchestrator work
- inside delegated Smithers work when generic typed capability composition is useful there too

Code mode is used for:

- typed capability composition
- compact scripted transformations
- reducing low-level multi-tool chatter when a short program is the clearer execution unit

Out of scope for the first implementation:

- product-visible sandbox controls
- nested model calls hidden inside `execute_typescript`
- a second unrestricted shell hidden behind code mode

### 11. Repo-Local Workflow Hooks

Companion spec: [Workflow Hooks](./specs/workflow-hooks.spec.md)

The product should support repo-local workflow hooks under a `.svvy/` configuration surface.

Initial required hooks:

- preflight hooks injected at the start of consequential workflows
- validation hooks injected at the end of consequential workflows

Consequential workflows include repo-modifying work, heavy work, and other execution where repo-local policy should apply by default.

These hooks should support repo-specific policy, context gathering, and failure handling without turning the product into a rigid static workflow engine.

### 12. Headless And Automation Surfaces

The product must remain scriptable outside the desktop UI.

Required supporting surfaces:

- headless one-shot execution
- structured workflow input
- structured event or result output
- reuse of the same orchestrator and product model used by the desktop app

The desktop app is primary, but headless execution is a real product surface, not a throwaway test mode.

## Persistence And State Requirements

- pi-backed sessions remain the top-level user-facing session substrate
- `svvy` extends that substrate with structured product state
- the transcript is canonical only for transcript history
- commands, episodes, verification, workflow, wait, and navigation state must come from durable structured records, not transcript replay
- session summaries and navigation read models must be derived from structured records and artifact metadata rather than transcript reconstruction
- product state must not depend on replaying the raw transcript for every decision
- runtime handlers and bridges must emit durable facts from real execution, not prompt-text inference
- the agent must not be given arbitrary state-write tools for mutating product records directly
- transcript and detail payloads are loaded lazily when the user opens or expands a surface that needs them
- artifacts are file-backed in a dedicated workspace artifact directory and referenced from durable product state through metadata/path indexing
- submitted `execute_typescript` snippets are persisted as file-backed artifacts for every attempt, including failed attempts
- Smithers may keep its own workflow-run state, but that state is subordinate to the top-level session and thread model

## Quality Requirements

- the user must be able to recover meaningful state after app restart or workflow interruption
- task work, workflow work, and verification work must normalize into one coherent product model
- active, waiting, failed, and completed work must be legible in the UI
- whole-session waiting and thread-local dependency waiting must be modeled distinctly
- product behavior must stay adaptive rather than collapsing into a rigid workflow tree
- tests for interactive behavior must exercise the real pi-backed runtime seam, not a fake shell presented as the product

## Required v1 Scope

The shipped v1 product includes:

- Electrobun desktop shell
- pi-backed runtime and session substrate
- provider auth and model settings
- session creation, resume, and navigation
- a session-centric UI with conversation, threads, episodes, verification, workflow state, wait state, and artifacts
- one orchestrator using one command model
- `execute_typescript` as the default generic work surface
- native control tools for workflow start or resume, verification, and wait
- Smithers-backed delegated workflows
- first-class episodes and artifact inspection
- first-class verification
- worktree-aware thread and workflow state
- repo-local preflight and validation workflow hooks
- headless one-shot execution and structured workflow input or output

## Later, Not v1

- product-visible sandbox controls around generic capability execution
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
- expose arbitrary state-write tools as the agent contract
- turn code mode into a second unrestricted shell

## Ship Criteria

The product is on target when all of the following are true:

- a user can open a real repository in the desktop app, authenticate a provider, and work in durable sessions
- the session UI makes current work legible through threads, episodes, verification, workflow state, wait state, and artifacts
- the orchestrator chooses the next tool call coherently inside one execution model
- ordinary generic work usually goes through `execute_typescript`
- delegated work is visible, bounded, and resumable
- meaningful work produces reusable episodes
- verification is structured, inspectable, and programmatically relevant
- worktree context is visible and aligned with active work
- the same core product model is usable from both the desktop app and headless execution surfaces
- pi remains the runtime substrate and Smithers remains the delegated workflow engine rather than replacing the product shell

## Design Basis

### Public Slate Facts We Intend To Emulate

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
- routing by next action is more reliable than proliferating execution modes
- the best balance is adaptive orchestration with bounded synchronization, not transcript sprawl and not rigid workflow bureaucracy

These are `svvy` product choices, not claims about private Slate internals.
