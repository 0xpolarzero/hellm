# Product Requirements Document

## Title

Ship `svvy` as an Electrobun desktop coding app with a pi-backed runtime, a visible `svvy` orchestrator, pi-backed delegated handler threads, and Smithers-backed workflow execution.

## Status

- Date: 2026-04-19
- Status: target product PRD
- Scope: this document defines the intended shipped product, not just the current bootstrap implementation

## Product Summary

`svvy` is a desktop coding agent for working inside real repositories with visible orchestration instead of one opaque chat loop.

The product combines:

- an Electrobun desktop shell
- a pi-backed interactive runtime and session substrate
- a `svvy` orchestrator that owns strategy, routing, and final decisions
- pi-backed delegated handler threads for bounded delegated objectives
- Smithers-backed workflow runs executed under those handler threads
- first-class threads, workflow runs, commands, episodes, artifacts, verification, and worktree awareness

The intended feel is closer to Slate than to stock pi:

- one strategic brain
- bounded delegated work instead of persistent role agents
- reusable structured outputs instead of transcript-only memory
- direct inspection of delegated work when needed without bloating the orchestrator by default
- safe pause and resume across handler threads and workflow runs

## Product Goals

The shipped product must let a user:

- open a local repository in a native desktop app and work in long-lived coding sessions
- understand what the system is doing without reconstructing state from raw logs
- inspect durable outputs from each meaningful unit of work
- delegate bounded work while keeping top-level strategy and state visible
- talk directly inside delegated thread surfaces when that work needs clarification or follow-up
- run and interpret verification as first-class product behavior
- pause and resume safely when user input or an external prerequisite is required
- keep session context and worktree context aligned
- use the same execution model from both the desktop app and headless automation surfaces

## Product Principles

### 1. One Strategic Brain

The main orchestrator owns:

- request interpretation
- context loading
- deciding whether work can be answered locally or needs delegation
- spawning delegated handler threads
- reconciling final thread outcomes
- final user-facing decisions in the main orchestrator surface

No worker, handler thread, or workflow run becomes the source of truth for overall strategy.

### 2. One Execution Model

`svvy` does not have separate product execution engines for direct work, delegated work, verification, and waiting.

It has one shared execution model:

```text
message -> target surface -> turn -> tool call -> command -> handler -> events -> structured state -> UI
```

The target surface may be:

- the main orchestrator surface
- a delegated handler thread surface

Everything the agent does is still driven through turns, tools, runtime handlers, and durable state.

Before any target surface runs a turn through pi:

- `svvy` must load that surface's resolved instructions through pi's real `systemPrompt` channel
- synthesized prompt bodies may include durable surface context plus user, assistant, and tool transcript material when reconstruction is required, but they must not flatten the system prompt into `System:` transcript text
- the UI should project the active system prompt as expandable surface metadata rather than as inline transcript prose
- each surface must receive only the generated tool declarations and SDK blocks that are callable from that surface
- each surface may receive compact knowledge about what another surface can do, but it must not receive that other surface's full callable API block just for awareness

The actor-specific capability split is:

- the orchestrator prompt knows that handler threads can supervise Smithers workflows, but it does not receive the `smithers.*` tool declarations; if it wants workflow action, it must delegate by calling `thread.start`
- a handler-thread prompt receives `smithers.*`, `thread.handoff`, `wait`, and any allowed generic work surface such as `execute_typescript`, but it does not receive `thread.start` in the default adopted model
- a workflow-task-agent prompt receives only task-local instructions and task-local callable declarations; in the default adopted model it should receive `execute_typescript` and not `thread.start`, `thread.handoff`, `wait`, or `smithers.*`
- if `svvy` later adopts nested delegation or additional actor classes, those capabilities must be added explicitly rather than leaked through one shared global prompt surface

### 3. Handler Threads Are The Delegation Unit

The orchestrator does not delegate directly to raw Smithers runs.

It delegates to a pi-backed handler thread.

A handler thread is:

- a normal interactive conversation surface
- backed by its own pi session/runtime state
- responsible for one delegated objective
- allowed to receive direct user messages just like the main orchestrator surface
- responsible for supervising the entire workflow lifecycle for that objective

The orchestrator usually talks to the user about:

- why a handler thread was created
- what objective it owns
- the final outcome returned by that thread

The detailed clarification and repair loop for that delegated objective normally happens inside the handler thread itself.

### 4. Smithers Workflows Are The Delegated Execution Substrate

All substantive delegated execution should go through Smithers workflow runs.

The repo-root `workflows/` package is not the shipped product workflow runtime.

It is an authoring workspace used to build and maintain `svvy` itself.

The shipped app must supervise product-owned Smithers workflows that are bundled with the app under an app-owned runtime area such as `src/bun/smithers-runtime/` and work without a source checkout, not repo-local authoring workflows that depend on `workflows/node_modules/.bin/smithers`, `workflows/smithers.db`, or source-relative paths.

That means:

- a short-lived worker is a one-task workflow
- parallel delegated work is a workflow template
- verification is a workflow template or preset
- a custom delegated plan is authored as a workflow and then executed

The handler thread is not the heavy execution engine.

It is the supervisor of one delegated objective.

The handler thread itself is not a Smithers workflow run.

It is a pi-backed interactive surface that calls workflow tools and supervises the resulting workflow runs.

Inside that handler thread, Smithers owns:

- actual workflow execution
- task scheduling
- retries, loops, and internal branches
- workflow-run pause and resume
- worktree-isolated execution when needed

### 5. Workflow Runs Stay Inside The Handler Thread Lifecycle

The orchestrator gives control of the delegated objective to the handler thread for the full duration of that objective.

That means:

- the handler thread decides whether to reuse a template, use a preset, or author a custom workflow
- the handler thread starts and resumes workflow runs
- the handler thread receives control back when a workflow run reaches a terminal outcome or another actionable attention state
- the handler thread may repair inputs, inspect workflow state, edit the workflow, start a replacement run, resume when the same run is still resumable, or ask the user for clarification
- the orchestrator does not sit in the middle of every workflow pause, retry, or repair step

A handler thread may launch more than one workflow run over its lifetime.

Examples:

- one run to author a custom workflow, then another run to execute it
- one run that fails, followed by a repaired rerun
- one run that pauses for clarification, then resumes

Within a workflow run, individual Smithers tasks may use a lower-level workflow task agent.

A workflow task agent is:

- not an interactive `svvy` surface
- hosted by Smithers inside one task attempt rather than by `svvy` as a top-level session surface
- configured with the same broad ingredients as other actors: model, reasoning level, system prompt, and tools
- a different actor contract from the orchestrator or handler thread because its owner, lifecycle, retries, and output validation come from Smithers task execution

The adopted direction for task agents is:

- use a PI-backed task-agent profile by default when a workflow task needs an adaptive coding agent
- give that task agent a `svvy` workflow-task system prompt rather than the orchestrator or handler-thread prompt
- expose only a task-local tool surface; the default adopted task-agent tool surface is `execute_typescript`
- keep `thread.start`, `thread.handoff`, `wait`, and `smithers.*` out of the task-agent prompt and tool schema
- keep human approval and hijack as Smithers runtime or operator controls around the task, not as ordinary task-agent tools

This lets `svvy` reuse the same general PI-based agent recipe at three different layers without conflating their responsibilities:

- orchestrator
- handler thread
- workflow task agent

### 6. `execute_typescript` Is The Default Generic Work Surface

`execute_typescript` remains the default generic work surface for bounded repository work.

That includes:

- reading files
- searching text
- inspecting git state
- generating artifacts
- performing web lookups
- composing several small tool calls into one bounded program
- handling multi-step semantic work across more than one turn when that is the right unit of work

Inside `execute_typescript`, the runtime injects `api.*` as a host SDK.

`api.*` is the observable capability surface for external effects and facts, not a hard permission boundary.

The SDK includes explicit `api.exec.run` for command execution.

Every submitted snippet is persisted as a file-backed artifact in the workspace artifact directory, and the runtime must compile or typecheck the snippet before execution.

Structured diagnostics must be produced, and invalid snippets must not run.

### 7. Native Control Tools Stay Small And Explicit

Some actions are not ordinary generic work because they change product-level control flow.

Those actions stay as `svvy`-native control tools:

- `thread.start`
- `thread.handoff`
- `wait`

These are still tool calls.

Workflow supervision is different.

`svvy` should not invent a parallel product-specific `workflow.*` abstraction layer just to hide Smithers.

Instead, the shipped app should register Smithers-native semantic tools through the Bun-owned bridge, using Smithers' own operation names where the docs already define them and Smithers' own nouns and verbs for the remaining adopted bridge surfaces.

That Smithers-native tool surface is a product runtime API over bundled in-app Smithers workflows, not a thin wrapper around the repo authoring workspace under `workflows/`.

More precisely, this means:

- the agent does not receive a raw Smithers runtime object, raw HTTP client, raw MCP server, or CLI access
- `svvy` registers first-party agent tools in its own tool registry under a `smithers.*` namespace
- each `smithers.*` tool is a thin Bun-side adapter around one Smithers operation or one Smithers-aligned control-plane surface
- when Smithers already publishes a semantic tool name, `svvy` should keep that name and expose it as `smithers.<same_name>`
- when Smithers exposes only a server route or Gateway method, `svvy` may wrap it, but it should preserve Smithers' nouns and verbs instead of inventing a competing `workflow.*` vocabulary
- product-specific additions are limited to app-runtime concerns such as implicit current-thread binding, bundled workflow registry lookup, normalized error envelopes, and durable command-fact recording
- `svvy` should expose only the subset of Smithers capabilities it actually wants the agent to use; unexposed Smithers surfaces remain operator-only or future work rather than getting renamed into parallel `svvy` APIs
- the orchestrator should know that `smithers.*` exists as a handler-thread capability, but it should not receive the `smithers.*` generated API block in its own prompt
- a handler thread should know that the orchestrator can delegate and reconcile handoffs, but it should not receive the orchestrator-only `thread.start` generated API block unless nested delegation is explicitly adopted
- a workflow task agent should know only its task-local instructions and task-local tools; approvals and hijack remain Smithers runtime behavior outside the task-agent tool block

The intended use of the native control subset is:

- the orchestrator normally uses `thread.start` to open a delegated handler thread
- a handler thread uses `thread.handoff` to emit a durable handoff episode and mark the current objective span complete without losing direct interactivity in that thread surface
- a successful `thread.handoff` immediately opens a fresh orchestrator reconciliation turn so the orchestrator can act on the latest durable handoff without waiting for another user-authored orchestrator message
- a handler thread normally uses Smithers-native bridge tools such as `smithers.list_workflows`, `smithers.run_workflow`, `smithers.get_run`, `smithers.explain_run`, `smithers.list_pending_approvals`, `smithers.resolve_approval`, `smithers.get_node_detail`, `smithers.list_artifacts`, and `smithers.get_run_events` to supervise Smithers execution
- any interactive surface may use `wait` when it needs user or external input

Verification is not a separate native control tool in the adopted model.

Verification is delegated work expressed through workflow templates and presets.

### 8. Sessions Contain Many Interactive Surfaces

A session is the durable user-facing container for:

- the main orchestrator conversation
- delegated handler thread conversations
- turns
- command history
- workflow runs
- episodes
- artifacts
- verification records
- wait state

The main orchestrator surface and a handler thread surface are intentionally similar interaction surfaces:

- both can receive direct user messages
- both can stream model responses
- both can call tools
- both can be opened in panes

The difference is responsibility, not UI class:

- the orchestrator owns strategy
- a handler thread owns one delegated objective

### 9. Handoff Episodes And Persistent Thread Surfaces

Episodes are the main reusable semantic outputs.

In the adopted delegated model:

- a handler thread may run through many internal workflow runs
- a handler thread may wait, resume, rerun, and repair internally
- ordinary handler-thread replies stay inside the thread and do not emit handoff episodes
- a handler thread returns control to the orchestrator by explicitly calling `thread.handoff`, which marks the current objective span terminal and emits a handoff episode
- the thread surface remains open for later inspection, direct follow-up chat, and resumed work on that same objective

That handoff is the thread's terminal durable state plus the latest handoff episode it emits.

Tool calls may still produce command summaries, traces, and artifacts.

Those are not episodes.

The episode should be:

- durable
- human-readable
- compact enough to reuse later
- semantically richer than raw logs

The machine-readable lifecycle state that drives routing and supervision belongs in turn, thread, and workflow-run records, not in a large bespoke episode schema.

### 10. Workflow Internals Stay Available But Not Default

The orchestrator should normally reason from:

- the handler thread objective
- the thread's terminal durable state
- durable workflow-run state
- the latest handoff episode emitted by that thread

It must still be able to inspect the underlying handler thread, artifacts, and command traces when needed.

That is an escape hatch, not the default reconciliation path.

### 11. Context Is A Scarce Resource

The system should preserve strategic context in the orchestrator, spend local context deliberately inside handler threads, and externalize whatever does not need to stay in the active model window.

In practice that means:

- useful results are compressed into final thread episodes and artifacts instead of dragging full transcripts forward
- workflow runs can pause and resume inside a handler thread without forcing the orchestrator to absorb every internal event
- repeatable structure is pushed into workflow templates, presets, and `execute_typescript` instead of repeatedly re-derived in prose
- raw model reasoning is reserved for ambiguity, synthesis, prioritization, and recovery

### 12. Full Approvals By Default

`svvy` runs with full approvals by default.

In practice that means:

- the product does not expose approval objects or approval gates as first-class user-facing behavior
- ambiguity is handled through clarification and waiting states rather than approval prompts
- delegated handler threads may pause for missing information or resumable waiting conditions, but not for product-level approval requests

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
- the backing conversation runtime for both the main orchestrator surface and delegated handler thread surfaces

`svvy` must extend or project through pi's runtime and extension APIs.

It must not replace pi with a second agent shell.

### svvy

`svvy` owns:

- product behavior above the pi seam
- the orchestrator
- delegated handler thread creation and supervision policy
- session, turn, thread, workflow-run, command, episode, artifact, verification, and wait models
- reconciliation
- desktop UI product semantics
- read models and selectors that drive the app

### Smithers

Smithers owns:

- workflow execution under a handler thread
- durable multi-step workflow runs
- retries, loops, branches, and internal workflow state
- worktree-isolated execution when delegated work requires it

Smithers is not:

- the top-level product shell
- the orchestrator
- the main conversation substrate
- the owner of session-level routing decisions

When `svvy` needs workflow lifecycle state, the intended seam is explicit Smithers bridge events plus official Smithers control-plane reads that write workflow-run and thread facts into structured state.

Until those bridge events exist for a lifecycle transition, `svvy` may rely on explicit tool-boundary projections already emitted during Smithers bridge tool calls that launch, resume, inspect, or mutate runs, plus official Smithers reads used for bootstrap, reconnect, or operator inspection.

Read paths must not repair workflow state heuristically from transcript replay, ad hoc refresh loops, or renderer polling.

## Product Model

### Workspace

A workspace is the local repository context the app is attached to.

It includes:

- repository root
- current branch or VCS state
- available worktrees
- repo-local `AGENTS.md`

### Session Container

A session is the top-level durable product container for one orchestrator-led line of work.

It contains:

- one main orchestrator surface
- zero or more delegated handler thread surfaces
- durable state across those surfaces

### Surface Identity

The product carries three different identifiers and they are not interchangeable:

- `workspaceSessionId`: the durable top-level session container id used for storage, summaries, navigation, and restart recovery
- `surfacePiSessionId`: the pi session id for the currently addressed interactive surface
- `threadId`: the durable handler-thread record id for the delegated objective; it exists only when the target surface is a handler thread

Rules:

- backend RPC calls and backend-to-renderer session-sync payloads must carry an explicit surface target rather than overloading `session.id`
- `session.id` inside session summaries means `workspaceSessionId`
- if the orchestrator surface currently happens to reuse the same string for `workspaceSessionId` and `surfacePiSessionId`, callers must treat that as an implementation detail rather than a shared identity contract

### Orchestrator Surface

The main orchestrator surface is the default conversation the user starts in.

It is responsible for:

- understanding the user's objective
- deciding whether local action is enough or a handler thread should be spawned
- tracking which delegated objectives exist
- receiving handoffs from handler threads when they return control
- deciding what to say next in the main conversation

### Handler Thread

A handler thread is a delegated interactive surface backed by pi.

It owns:

- one delegated objective
- the workflow selection or authoring path for that objective
- the internal clarification loop for that objective
- workflow run supervision
- zero or more handoffs returned to the orchestrator over that thread's lifetime

Each handler thread should have:

- a title
- an objective
- its own direct conversation history
- durable lifecycle status
- zero or more workflow runs
- zero or more handoff episodes

### Workflow Run

A workflow run is one Smithers execution launched from a handler thread.

It has:

- a Smithers run id
- a workflow template or authored workflow shape
- status over time
- artifacts, logs, and related command history

One handler thread may own many workflow runs over time.

### Workflow Templates, Presets, And Custom Workflows

The delegated workflow library has three layers:

1. structural templates:
   - `single_task`
   - `sequential_pipeline`
   - `fanout_join`
   - `verification_run`
2. presets that fill or partially fill one of those templates for a recurring pattern
3. one-off custom workflows authored on demand when no existing template or preset is a good fit

The intended decision order inside a handler thread is:

1. can an existing structural template handle this objective?
2. if yes, is there a reusable preset that already fits or mostly fits?
3. if not, author a custom workflow
4. execute the chosen workflow

### Turn

A turn is one request boundary inside one interactive surface.

That means:

- the main orchestrator surface has turns
- each handler thread surface has its own turns

Turns exist because a user or system message opened a real unit of work in one surface.

Each turn should also persist that surface's top-level turn decision so session-level routing and delegated supervision do not need to be reconstructed from transcript prose or low-level command sequences.

### Episode

An episode is the durable semantic output reused later by the orchestrator or shown to the user.

For delegated handler threads, a handoff episode should capture:

- the delegated objective
- what was concluded or delivered
- what mattered semantically
- enough detail for the orchestrator to continue without reopening full logs by default

It is created when the handler thread explicitly calls `thread.handoff`.

Artifacts and detailed traces do not need to be flattened into the episode body.

They remain inspectable through durable links and thread history.

### Artifact

Artifacts are durable outputs produced by commands, workflow runs, and related execution.

Examples:

- diffs
- logs
- test reports
- submitted `execute_typescript` source snippets, including failed attempts
- screenshots
- generated files
- exported workflow details

Artifacts are thread- and command-addressable first.

They may later be surfaced through an episode or another read model, but they should not depend on transcript parsing.

### Verification

Verification is a first-class feature area, but it is represented as delegated workflow execution rather than as a separate native execution subsystem.

In practice that means:

- build, test, lint, integration, and manual verification may be expressed as workflow presets
- verification outcomes still need structured records for summary, routing, and UI
- verification-specific UI is allowed where it improves clarity

### Worktree

Worktree awareness remains first-class.

At minimum:

- a handler thread may be associated with a worktree
- a workflow run may execute in a worktree
- delegated workflows should default to the current branch and current worktree rather than spawning worktrees automatically
- the UI must make the active worktree legible

## Execution Model

### High-Level Flow

Every user request goes through one orchestrator-controlled product loop:

1. load current workspace, session, thread, workflow-run, episode, artifact, verification, and wait context
2. identify the target surface of the message
3. resolve that surface's active system prompt and load it into pi's true `systemPrompt` channel before any transcript reconstruction
4. open a new turn for that surface
5. let that surface choose and persist its top-level turn decision, then decide its next tool call or direct response
6. execute tools through the correct runtime handler
7. record commands, events, workflow-run state, artifacts, and wait state
8. update structured state
9. emit explicit session-sync events that carry the active surface target plus rehydration data whenever prompt settlement or background reconciliation changes what the UI should project
10. render updated session and pane surfaces from those events plus durable state

Read APIs and renderer code must not compensate for missing lifecycle writes with polling, transcript parsing, or inferred repair logic.

### Main Orchestrator Loop

When the target surface is the main orchestrator:

1. understand the new request in the context of existing durable state
2. decide and persist whether the request can be handled locally or needs delegation
3. if local:
   - answer directly
   - or use `execute_typescript`
   - or ask for clarification
4. if delegated:
   - call `thread.start`
   - hand off the delegated objective to a handler thread
5. when a handler thread explicitly hands control back, open an orchestrator turn that reconciles the latest handoff from durable state: thread durable state plus the latest handoff episode

### Handler Thread Loop

When the target surface is a handler thread:

1. understand the delegated objective and current thread state
2. decide and persist whether to:
   - reply directly inside the thread
   - use `execute_typescript`
   - reuse a workflow template
   - reuse or complete a preset
   - author a custom workflow
   - inspect workflow state through Smithers-native bridge tools such as `smithers.get_run`, `smithers.explain_run`, `smithers.get_node_detail`, and `smithers.get_run_events`
   - resume an existing paused workflow run through the Smithers bridge when Smithers still considers that run resumable
   - start a replacement workflow run
   - ask the user for clarification
   - enter wait
   - hand control back with `thread.handoff`
3. run or resume workflow execution as needed
4. regain control when the workflow run reaches a terminal outcome or another actionable attention state
5. continue supervising until the objective is truly finished
6. when appropriate, return control to the orchestrator by explicitly calling `thread.handoff`

When `thread.handoff` succeeds, the owning orchestrator surface should regain control through a fresh orchestrator turn rather than waiting for the user to manually poke the orchestrator again.

If a thread already handed control back earlier:

- a direct follow-up question may be answered inside that same thread without reopening the orchestrator loop
- resumed objective work may move the thread back to an active running state
- a later return to the orchestrator should produce another handoff episode

### Clarification And Waiting

Waiting is a lifecycle status, not a separate product subsystem.

Two common cases matter:

- the main orchestrator surface needs clarification before it can decide how to proceed
- a handler thread needs clarification while supervising a delegated objective

In the adopted delegated model:

- if a handler thread needs clarification, it asks inside that thread
- the user's reply goes back to that same thread surface
- the orchestrator does not need to intermediate that clarification by default

There is no separate "wait episode" for delegated handler threads.

The wait belongs in thread and workflow-run state until the handler thread eventually reaches another handoff point.

### Failures And Recovery

Workflow failure does not immediately return control to the orchestrator unless the handler thread decides it cannot repair the delegated objective confidently.

The intended behavior is:

- a workflow run fails or is cancelled
- the handler thread enters troubleshooting
- the handler thread may inspect artifacts, inspect workflow state through Smithers-native bridge tools, edit the workflow, repair inputs, start a replacement run, resume only when Smithers resume preconditions still hold, ask the user, or explicitly close the objective
- only the handler thread's handoff is returned to the orchestrator: terminal thread state plus the latest handoff episode

If a workflow run dies before its own planned finalization path, the bridge must still surface durable failure state back to the supervising handler thread.

## UI And Surface Model

`svvy` uses a multi-pane desktop layout where:

- the main orchestrator surface can be opened in a pane
- a handler thread surface can be opened in a pane
- a workflow inspector surface can be opened in a pane

The main orchestrator surface and a handler thread surface should use the same core interactive UI model:

- transcript
- composer
- tool activity
- artifacts
- status

Message targeting is simple:

- sending a message from a pane sends it to the surface shown in that pane
- if the pane shows the orchestrator, the message goes to the orchestrator
- if the pane shows a handler thread, the message goes to that handler thread

This is shared surface behavior, not a thread-specific exception.

Projection ownership is equally simple:

- the backend owns active surface targeting and session summary projection
- the renderer listens for explicit session-sync payloads and rehydrates from that target plus durable state
- the renderer does not poll read APIs, inspect transcript files, or infer lifecycle changes from transcript mutations

## Workflow Inspection

The product should expose workflow runs as inspectable history without forcing the orchestrator to absorb every internal event.

The workflow inspector should let the user inspect:

- active workflow runs
- completed workflow runs
- workflow node progress
- related artifacts
- worktree and runtime profile context

Some workflow templates may justify specialized UI instead of a generic workflow card.

Verification is the clearest first example.

## Product Outcomes

The design is successful when:

- the orchestrator remains strategically informed without being bloated by workflow internals
- delegated work happens inside handler threads that feel like real interactive surfaces
- all substantive delegated execution flows through Smithers workflows
- handler threads can repair, clarify, and rerun internally before returning control
- handed-back threads remain open for follow-up chat and resumed work on the same objective
- the user can understand the current state of the session, threads, and workflows from durable state
- meaningful delegated work terminates in reusable episodes instead of transcript archaeology
- pi remains the runtime substrate and Smithers remains the delegated workflow engine rather than replacing the product shell
