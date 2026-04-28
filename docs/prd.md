# Product Requirements Document

## Title

Ship `svvy` as an Electrobun desktop coding app with a pi-backed runtime, a visible `svvy` orchestrator, pi-backed delegated handler threads, and Smithers-backed workflow execution.

## Status

- Date: 2026-04-22
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
- authored artifact workflows plus workspace-saved reusable workflow assets and runnable workflow entries
- first-class threads, workflow runs, commands, episodes, artifacts, Project CI, and worktree awareness
- a VS Code-like command palette and quick-open shell surface for discovering product actions without creating a second runtime

The intended feel is closer to Slate than to stock pi:

- one strategic brain
- bounded delegated work instead of persistent role agents
- reusable structured outputs instead of transcript-only memory
- direct inspection of delegated work when needed without bloating the orchestrator by default
- safe pause and resume across handler threads and workflow runs

## Product Goals

The shipped product must let a user:

- open a local repository in a native desktop app and work in long-lived coding sessions
- keep important sessions visible through pinning and move old sessions into a single collapsed archive without deleting their history
- understand what the system is doing without reconstructing state from raw logs
- inspect durable outputs from each meaningful unit of work
- delegate bounded work while keeping top-level strategy and state visible
- talk directly inside delegated thread surfaces when that work needs clarification or follow-up
- configure, run, and interpret Project CI as first-class product behavior
- save a reusable authored workflow into the workspace workflow library and discover it later
- use `Cmd+Shift+P` to discover and execute product actions, and `Cmd+P` as the reserved file quick-open entry point
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

`svvy` does not have separate product execution engines for direct work, delegated work, Project CI, and waiting.

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
- a handler-thread prompt receives `smithers.*`, `request_context`, `thread.handoff`, `wait`, and any allowed generic work surface such as `execute_typescript`, but it does not receive `thread.start` in the default adopted model
- a workflow-task-agent prompt receives only task-local instructions and task-local callable declarations; in the default adopted model it should receive `execute_typescript` and not `thread.start`, `thread.handoff`, `wait`, or `smithers.*`
- a workflow-task-agent runtime must not load ambient pi built-in tools or workspace-discovered extension tools that would widen that callable surface beyond the explicit task-local tool set
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

The shipped app must supervise product-runtime Smithers workflows that work without a source checkout.

That includes:

- runnable saved entries under `.svvy/workflows/entries/`
- short-lived authored artifact workflows under `.svvy/artifacts/workflows/`

It must not depend on repo-local authoring workflows that rely on `workflows/node_modules/.bin/smithers`, `workflows/smithers.db`, or source-relative paths.

That means:

- a short-lived worker is a one-task workflow
- parallel delegated work is a workflow graph authored from saved or artifact-local assets when needed
- Project CI uses the same workflow runtime and explicit structured result model rather than a separate engine
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

- the handler thread decides whether to reuse a saved runnable entry or author a short-lived artifact workflow
- the handler thread starts and resumes workflow runs
- workflow waits, approvals, retries, repairs, and resumptions stay inside that same handler thread instead of escaping back to the orchestrator
- the handler thread receives control back when a workflow run reaches a terminal outcome or another actionable attention state
- the handler thread may repair inputs, inspect workflow state, edit the workflow, start a replacement run, resume when the same run is still resumable, or ask the user for clarification
- the handler thread may call `thread.handoff` only after its current supervised workflow state is terminal or explicitly cancelled; a running or waiting workflow run may not be orphaned under a completed thread
- the orchestrator does not sit in the middle of every workflow pause, retry, or repair step

A handler thread may launch more than one workflow run over its lifetime.

Examples:

- one run to author an artifact workflow, then another run to execute it
- one run that fails, followed by a repaired rerun
- one run that pauses for clarification, then resumes

Within a workflow run, individual Smithers tasks may use a lower-level workflow task agent.

A workflow task agent is:

- not an interactive `svvy` surface
- hosted by Smithers inside one task attempt rather than by `svvy` as a top-level session surface
- configured with the same broad ingredients as other actors: model, reasoning level, system prompt, and tools
- a different actor contract from the orchestrator or handler thread because its owner, lifecycle, retries, and output validation come from Smithers task execution

The adopted direction for task agents is:

- use a PI-backed workflow task agent by default when a workflow task needs an adaptive coding agent
- give that task agent a `svvy` workflow-task system prompt rather than the orchestrator or handler-thread prompt
- expose only a task-local tool surface; the default adopted task-agent tool surface is `execute_typescript`
- keep `thread.start`, `thread.handoff`, `wait`, and `smithers.*` out of the task-agent prompt and tool schema
- keep human approval and hijack as Smithers runtime or operator controls around the task, not as ordinary task-agent tools
- execute the task agent and its task-local `execute_typescript` calls from Smithers' current task root, including the active worktree when the task is worktree-bound
- keep the workflow runtime DB, run ownership, and structured projection workspace-scoped even when the task itself executes in a worktree
- bind the workflow-task-attempt record before any task-local tool call runs by exact persisted resume-handle lookup against the current Smithers attempt row; do not use heuristic recency scans, transcript inference, or multi-stage fallback chains to discover ownership
- preserve structured message history, step boundaries, and usage across retries, schema repair prompts, and hijack handoff instead of flattening continuation state into role-labelled prose
- stream live assistant and tool updates so handler wake-ups, UI activity, and heartbeat freshness reflect real task-agent progress rather than only terminal task text

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

Some actions are not ordinary generic work because they change product-level control flow or handler prompt context.

Those actions stay as `svvy`-native control tools:

- `thread.start`
- `request_context`
- `thread.handoff`
- `wait`

These are still tool calls.

`request_context` is handler-only.

It loads typed `svvy` context packs into the current handler thread when that handler needs optional product knowledge that should not be preloaded by default.

It is not part of the `execute_typescript` `api.*` SDK because it changes the handler's prompt context rather than performing bounded repository work.

The first adopted context key is:

- `ci`

The orchestrator does not receive `request_context`.

Instead, the orchestrator knows the small list of available context keys and may pass them when starting a handler thread:

```ts
thread.start({
  objective: "Define Project CI checks for this repository",
  context: ["ci"],
});
```

That starts a normal handler thread with the default handler runtime shape and the requested context pack preloaded before its first turn.

There is no `thread.start_ci`, no `ci.start`, and no CI-specific orchestrator.

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
- product-specific additions are limited to app-runtime concerns such as implicit current-thread binding, workflow registry lookup, normalized error envelopes, and durable command-fact recording
- `svvy` should expose only the subset of Smithers capabilities it actually wants the agent to use; unexposed Smithers surfaces remain operator-only or future work rather than getting renamed into parallel `svvy` APIs
- the orchestrator should know that `smithers.*` exists as a handler-thread capability, but it should not receive the `smithers.*` generated API block in its own prompt
- a handler thread should know that the orchestrator can delegate and reconcile handoffs, but it should not receive the orchestrator-only `thread.start` generated API block unless nested delegation is explicitly adopted
- a workflow task agent should know only its task-local instructions and task-local tools; approvals and hijack remain Smithers runtime behavior outside the task-agent tool block

The intended use of the native control subset is:

- the orchestrator normally uses `thread.start` to open a delegated handler thread
- the orchestrator may pass `context: ["ci"]` to `thread.start` when the delegated objective clearly needs Project CI authoring context
- a handler thread may call `request_context({ keys: ["ci"] })` when it later discovers that Project CI configuration or modification is required
- a handler thread uses `thread.handoff` to emit a durable handoff episode and mark the current objective span complete without losing direct interactivity in that thread surface, but only after no running or waiting workflow run still belongs to that span
- a successful `thread.handoff` immediately opens a fresh orchestrator reconciliation turn so the orchestrator can act on the latest durable handoff without waiting for another user-authored orchestrator message
- a handler thread normally uses Smithers-native bridge tools such as `smithers.list_workflows`, `smithers.run_workflow`, `smithers.get_run`, `smithers.explain_run`, `smithers.list_pending_approvals`, `smithers.resolve_approval`, `smithers.get_node_detail`, `smithers.list_artifacts`, and `smithers.get_run_events` to supervise Smithers execution
- any interactive surface may use `wait` when it needs user or external input

`smithers.list_workflows` is the runnable-entry discovery surface and should expose each entry's `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, and `launchInputSchema`. Handlers launch or resume through the stable `smithers.run_workflow({ workflowId, input, runId? })` tool.

Project CI is not a separate native control tool in the adopted model.

Project CI is a dedicated product status and result lane over normal Smithers runnable entries that declare `productKind = "project-ci"` and a CI result schema. CI state is recorded only from terminal output that validates against that declared result schema.

The lane is a projection and UI concept, not a setup launcher, CI-specific orchestrator, or custom CI execution surface.

CI authoring knowledge is delivered through the typed `ci` context pack.

It may be preloaded by `thread.start({ context: ["ci"] })` or loaded later by a handler through `request_context({ keys: ["ci"] })`.

### 8. Sessions Contain Many Interactive Surfaces

A session is the durable user-facing container for:

- the main orchestrator conversation
- delegated handler thread conversations
- turns
- command history
- workflow runs
- episodes
- artifacts
- CI run and CI check result records
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
- a handler thread returns control to the orchestrator by explicitly calling `thread.handoff`, which marks the current objective span terminal and emits a handoff episode only after the thread no longer owns a running or waiting workflow run for that span
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

Every pi-backed agent surface should expose its active context-budget usage as a percentage of that surface's active model maximum. This applies separately to orchestrator surfaces, handler-thread surfaces, and workflow task-agent attempts. The UI should make context pressure visible without implying that every model fails at one exact percentage: neutral is below 40%, orange starts at 40%, and red starts at 60%. These warning bands are an operational policy for when the user or agent should compact, summarize, hand off, or start a fresh surface.

In practice that means:

- useful results are compressed into final thread episodes and artifacts instead of dragging full transcripts forward
- workflow runs can pause and resume inside a handler thread without forcing the orchestrator to absorb every internal event
- repeatable structure is pushed into saved definitions, prompts, components, saved runnable entries, and `execute_typescript` instead of repeatedly re-derived in prose
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
- session, turn, thread, workflow-run, command, episode, artifact, Project CI, and wait models
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

When `svvy` needs workflow lifecycle state, the intended seam is write-driven projection from explicit Smithers bridge events, Smithers tool-boundary writes, and official Smithers bootstrap or reconnect control-plane reads that immediately persist workflow-run and thread facts into structured state.

Those lifecycle producers are first-class product behavior, not temporary fallback. Operator inspection reads may observe workflow state, but they must not mutate durable lifecycle state as a side effect.

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

The session container is durable workspace state.

It is not the live runtime slot for whichever surface happens to be open in the UI.

Session navigation metadata is part of durable workspace state.

The adopted navigation model is deliberately small:

- pinned active sessions appear at the top of the session list
- archived sessions move into one Archived group
- the Archived group is the only folder-like grouping and is collapsed by default
- arbitrary user-created session folders are not part of the product model
- archiving hides a session from the active list without deleting pi session data, structured state, artifacts, threads, workflow runs, or episodes

### Surface Identity

The product carries four different identifiers and they are not interchangeable:

- `workspaceSessionId`: the durable top-level session container id used for storage, summaries, navigation, and restart recovery
- `surfacePiSessionId`: the pi session id for the currently addressed interactive surface
- `threadId`: the durable handler-thread record id for the delegated objective; it exists only when the target surface is a handler thread
- `paneId`: the UI layout identity that points at a surface without becoming that surface's runtime identity

Rules:

- backend RPC calls and backend-to-renderer surface payloads must carry an explicit surface target rather than overloading `session.id`
- `session.id` inside session summaries means `workspaceSessionId`
- if the orchestrator surface currently happens to reuse the same string for `workspaceSessionId` and `surfacePiSessionId`, callers must treat that as an implementation detail rather than a shared identity contract
- `paneId` must never be used as a session id, surface id, or thread id

### Live Surface Runtime

Each interactive pi surface is managed as its own live runtime object keyed by `surfacePiSessionId`.

That live runtime owns:

- the live transcript snapshot
- streaming state
- provider, model, and reasoning settings
- the resolved system prompt
- the current prompt execution context
- one prompt lock for that surface

Live surface runtime is separate from both durable workspace state and pane layout state.

### Pane And Layout State

Pane and layout state is UI state.

It owns:

- which pane shows which surface
- a user-driven pane grid with pane geometry
- pane focus
- pane-local scroll and inspector state

Panes are not live runtimes.

If two panes show the same surface, they share one underlying live surface runtime.

Users may split, drag, resize, and close panes as their workspace requires, with the renderer responsible for enforcing practical minimum pane sizes and explicit close behavior.

Pane geometry is proportional. The durable layout stores ordered row and column track percentages plus deterministic pane coordinates, and window resize recomputes pixels from those percentages without changing pane placement.

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
- loaded typed context keys, when optional product context has been preloaded or requested
- zero or more workflow runs
- zero or more handoff episodes

Typed context keys describe optional product knowledge loaded into a handler prompt, such as `ci`.

Session agent settings describe the model, reasoning level, prompt selection, and callable surface used by pi-backed product agents. The `defaultSession` and `quickSession` agents back interactive orchestrator surfaces. The `namer` agent is the same product-agent family as the orchestrator, not a Smithers workflow agent, but it runs as a one-shot non-interactive title-generation surface whose settings prompt is the only title-generation instruction.

The app owns three app-wide session-agent defaults:

- `defaultSession` for ordinary orchestrator sessions
- `quickSession` for short focused sessions created through quick-session actions
- `namer` for one-shot top-level session and handler-thread title generation, seeded to `openai-codex`/`gpt-5.4-mini` with low reasoning effort

Session records persist their mode, the app-wide defaults that were active at creation time, and the default orchestrator prompt selection. A quick session is still a normal pi-backed orchestrator surface with the normal svvy callable surface and durable state; it only starts from the quick-session agent default and quick-session system prompt.

Handler threads may persist a per-thread session-agent override when `thread.start` declares a specific provider, model, reasoning level, or handler prompt suffix for the delegated objective. Typed handler context packs remain separate product knowledge and do not carry model, reasoning, or prompt-selection settings.

The settings surface edits app-wide session-agent defaults, including `namer`, conventional workflow-agent settings, and the user's preferred external editor for opening workspace source files from read-only product surfaces. Agent setting changes save directly from the setting control rather than through a separate save button. Agent model selection is a constrained picker over models from currently connected providers, and reasoning selection is constrained to the levels supported by the selected model, matching the interactive session controls rather than accepting freeform provider, model, or reasoning text. Workflow-agent settings synchronize to `.svvy/workflows/components/agents.ts`, which remains an ordinary saved workflow component that exports `explorer`, `implementer`, and `reviewer`.

Top-level session titles are generated through an explicit durable title-generation flow. When the first real user turn starts in a top-level session, the app records a pending title-generation job and runs the configured `namer` agent concurrently with the orchestrator turn. The orchestrator must not wait for the namer, and the namer must not wait for the orchestrator response. The namer settings prompt is the title-generation instruction; the one-shot user prompt sent to that agent contains only the first user message context to title, not another naming instruction or extracted keyword list. While that job is pending or running, manual session rename is blocked for that session so the generated title and a user rename cannot race. The generated title is persisted once, auto-title generation stops after that first successful generation, and a manual rename permanently freezes future auto-titling for the session. Handler-thread titles are generated by the same configured `namer` agent from the orchestrator-supplied `thread.start` objective; the orchestrator does not receive or supply a separate handler title field. Workflow runs do not have a separate title concept and use workflow identity or entry metadata for labels.

### Workflow Run

A workflow run is one Smithers execution launched from a handler thread.

It has:

- a Smithers run id
- a runnable saved entry or authored artifact entry shape
- status over time
- artifacts, logs, and related command history

One handler thread may own many workflow runs over time.

### Saved Workflow Assets, Runnable Entries, And Artifact Workflows

The delegated workflow library has three layers:

1. generated workflow-authoring contracts plus curated workflow guidance injected into every handler thread
2. workspace-saved reusable workflow assets under `.svvy/workflows/definitions/`, `.svvy/workflows/prompts/`, `.svvy/workflows/components/`, and launchable saved entries under `.svvy/workflows/entries/`
3. short-lived authored artifact workflows under `.svvy/artifacts/workflows/`

The generated workflow-authoring contract is the handler-visible source of truth for runnable entry modules, product lane metadata, grouped asset refs, `createRunnableEntry(...)`, and workflow task agents. The curated guide teaches the Smithers render/task/output model, artifact layout, saved library layout, validation loop, and `AgentLike` task usage without restating generated `api.*` or workflow contract shapes in prose.

Saved workflow assets are reusable source assets.

They include:

- definitions
- prompts
- components
- conventional workflow agents as ordinary component assets, including `.svvy/workflows/components/agents.ts` exports for `explorer`, `implementer`, and `reviewer`

Saved entries are the launchable wrappers in the saved workflow library.

The intended decision order inside a handler thread is:

1. can the task be completed directly in `execute_typescript`?
2. if not, does a saved runnable entry clearly fit?
3. if not, author a short-lived artifact workflow, usually by mixing saved definitions, prompts, and components; when task agents are needed, reuse `.svvy/workflows/components/agents.ts` exports when they fit and define artifact-local agents for one-off needs
4. execute the selected or authored workflow

Artifact workflows are persisted by default under `.svvy/artifacts/workflows/`.

Saving reusable workflow files means the handler writes those files directly into `.svvy/workflows/` through the normal repo write APIs.

Writes under `.svvy/workflows/` automatically surface saved-workflow validation feedback in the enclosing `execute_typescript` result.

The UI should expose:

- a save shortcut that sends a predefined save request prompt to the handler thread
- a read-only saved workflow library surface where the user can inspect saved definitions, prompts, components, entries, and artifact workflow groups without requiring an in-app source editor
- an open-in-editor action that opens selected workflow source files in the user's configured external editor
- delete actions for saved definitions, prompts, components, and entries, while preserving historical artifact workflows that previously referenced them
- later in-app source editing, syntax highlighting, and inline diagnostics only after dedicated editor primitives exist

Handler-thread instructions should treat saving as explicit reuse curation:

- save reusable workflow assets when the user asks for that
- otherwise propose saving when a newly authored workflow looks broadly reusable

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

Artifacts are durable byproducts or evidence files produced by commands, workflow runs, and related execution.

They live under the `svvy` artifact area rather than as normal project source. They are for outputs that should remain inspectable but should not normally be committed into the user's repository tree as product code, source docs, configuration, tests, or assets.

Examples:

- diffs
- logs
- retained test output, JUnit XML, coverage summaries, or other test-run evidence when the output is worth preserving beyond a compact command summary
- submitted `execute_typescript` source snippets, including failed attempts
- screenshots
- generated audit, benchmark, inspection, or workflow reports that are evidence of agent work rather than requested repository files
- exported workflow details

A normal repository file edited by the agent is not automatically an artifact.

If the user asks for a file to be created in the repository, that file is workspace state, not an artifact. If the information is small enough to answer in prose, it belongs in the transcript or command summary, not in an artifact file.

Agents should create artifacts only for durable byproducts, evidence, previews, logs, reports, screenshots, or large payloads that need later inspection and should not normally be placed in the repository.

Artifact projection should show durable work outputs linked to threads, workflow runs, commands, and CI checks before relying on transcript reconstruction.

Artifacts are thread- and command-addressable first.

They may later be surfaced through an episode or another read model, but they should not depend on transcript parsing.

### Project CI

Project CI is a first-class product lane for the repository's repeatable confidence checks.

It is represented as normal Smithers workflow execution plus explicit `svvy` CI projection.

In practice that means:

- reusable Project CI assets, when configured, live in the saved workflow library under `.svvy/workflows/{definitions,prompts,components,entries}/ci/`
- a runnable CI entry is an ordinary saved workflow entry that declares `productKind = "project-ci"` and a `resultSchema`
- the runtime records CI state only from the terminal output of a declared CI entry after that output validates against the entry's `resultSchema`
- CI run and CI check result records summarize build, test, lint, typecheck, integration, docs, manual, or repository-specific checks when the configured CI entry returns them
- the UI exposes a dedicated Project CI status surface or panel for not-configured, configured, running, passed, failed, blocked, and cancelled states
- the workspace shell exposes a compact latest Project CI summary near the focused surface or session status, and inspected handler threads show CI detail only when that thread launched, configured, modified, or otherwise owns the relevant CI run

Project CI deliberately avoids heuristic inference.

The runtime must not parse arbitrary workflow logs, node outputs, final prose, or command names to guess CI results.

The product must not ship, auto-create, or scaffold a fake passing CI entry for repositories that have not configured real checks.

CI authoring context belongs only to handler threads that load the typed `ci` context pack.

Normal handler threads may discover and run configured CI entries without that pack.

If a normal handler needs to configure or modify Project CI, it should call `request_context({ keys: ["ci"] })` rather than relying on default prompt knowledge.

There is no required Project CI setup wizard or launcher.

Configuration happens organically in a normal handler thread when the user asks for it or when an implementation handler discovers that durable Project CI needs to be created or modified.

### Worktree

Worktree awareness remains first-class.

At minimum:

- a handler thread may be associated with a worktree
- a workflow run may execute in a worktree
- a workflow task agent executes from the current Smithers task root or worktree, while `svvy` workflow projection and Smithers runtime storage stay bound to the workspace root
- delegated workflows should default to the current branch and current worktree rather than spawning worktrees automatically
- the UI must make the active worktree legible

## Execution Model

### High-Level Flow

Every user request goes through one orchestrator-controlled product loop:

1. load current workspace, session, thread, workflow-run, episode, artifact, Project CI, and wait context
2. identify the target surface of the message
3. resolve that surface's active system prompt and load it into pi's true `systemPrompt` channel before any transcript reconstruction
4. open a new turn for that surface
5. let that surface choose and persist its top-level turn decision, then decide its next tool call or direct response
6. execute tools through the correct runtime handler
7. record commands, events, workflow-run state, artifacts, and wait state
8. update structured state
9. emit explicit workspace-state updates whenever durable summaries or read models change
10. emit explicit surface-state updates whenever one live surface transcript or runtime snapshot changes
11. render updated workspace and pane surfaces by joining those updates with pane bindings

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
   - include typed context keys such as `context: ["ci"]` only when the objective needs that optional product context from the first handler turn
5. when a handler thread explicitly hands control back, open an orchestrator turn that reconciles the latest handoff from durable state: thread durable state plus the latest handoff episode

### Handler Thread Loop

When the target surface is a handler thread:

1. understand the delegated objective and current thread state
2. decide and persist whether to:
   - reply directly inside the thread
   - use `execute_typescript`
   - request optional product context through `request_context`
   - reuse a saved runnable entry
   - author a short-lived artifact workflow, often by importing saved definitions, prompts, and components
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

Duplicate observation of the same terminal workflow state is legitimate during final stream flushes or later bootstrap or reconnect control-plane reads.

That duplication must be handled as idempotent projection, not as a reason to reopen a thread the handler already handed back.

If a workflow run dies before its own planned finalization path, the bridge must still surface durable failure state back to the supervising handler thread.

## UI And Surface Model

### Session Navigation

The session sidebar is workspace navigation, not a general folder manager.

It should show:

- pinned active sessions first
- remaining active sessions by recency
- one Archived group for archived sessions

The Archived group is collapsed by default, and its collapsed state is persisted per workspace.

Archiving is reversible and non-destructive. It must not delete durable session, thread, workflow-run, episode, artifact, or transcript data.

### Command Palette And Quick Open

`svvy` should expose a VS Code-like command palette model as a first-class shell capability.

`Cmd+Shift+P` opens the all-actions command palette. It should discover and execute product actions, including session creation and switching, session pin/archive actions, opening focused session/thread/workflow/artifact/Project CI surfaces, Project CI run or configuration actions, handler-thread surfaces, workflow-inspector-related surfaces, pane and layout actions when panes exist, settings and agent-setting actions when those features exist, and future product actions as they are added.

`Cmd+P` opens file quick-open. For now, file quick-open is intentionally a no-op or placeholder because file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces are not yet implemented. It must not fabricate file surfaces or introduce an ad hoc file browsing path.

When implemented, the command palette UI should use `cmdk-sv` from `https://www.cmdk-sv.com/` as the Svelte command menu primitive. Its docs describe it as a "fast, composable, unstyled command menu for Svelte." `cmdk-sv` is the renderer menu primitive, not the source of product routing, runtime behavior, or command semantics.

The command palette is a shell/action surface. It is not an alternate execution engine, standalone shell, custom terminal loop, readline loop, alternate TUI stack, or parallel workflow abstraction. Palette actions route into the existing product model: sessions, panes, surfaces, orchestrator and handler turns, Smithers-native tools, Project CI projection, durable state, settings, and agent settings.

When the user types text into `Cmd+Shift+P` and it does not match an existing command or action, pressing Enter creates a new session and uses that typed text as the initial prompt. That prompt enters the normal orchestrator turn model; it does not bypass system prompt loading, prompt history, structured turn state, or live surface runtime ownership.

The default command-palette behavior is defined in pre-pane terms as normal current workspace and session routing. Once pane layout exists, pane-specific placement rules belong to the pane-layout spec: command palette results that open sessions or surfaces default to a new pane, and `Cmd+Enter` opens into the currently focused pane.

### Surface Projection

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

- the backend owns durable workspace projection and live surface runtime ownership
- the renderer owns pane bindings, pane focus, and pane-local view state
- the renderer listens for explicit workspace updates and surface updates, then joins them locally
- the renderer does not poll read APIs, inspect transcript files, or infer lifecycle changes from transcript mutations

Pane and surface semantics are:

- opening a pane attaches that pane to a surface
- closing a pane detaches that pane without deleting durable state
- closing the last owner of a surface releases that live surface runtime cleanly
- more than one pane may attach to the same surface
- duplicated panes share one underlying live surface state but may keep independent scroll position
- split, resize, close, drag/drop placement, focus, bindings, occupancy, row and column percentages, and pane-local state persist across restart
- background workflow attention always targets the owning handler surface, not the currently focused pane

On restart, the workspace shell should restore useful stable UI state:

- pinned and archived session state
- Archived group collapsed state
- open panes and pane-to-surface bindings
- focused pane
- pane-local scroll and display preferences
- selected inspector target per pane when the target still exists

It should not restore transient menus or popovers, unsaved inline edits, composer draft text, selected transcript text, temporary search highlights, or stale live stream and tool-running state.

## Workflow Inspection

The product exposes workflow runs as inspectable pane surfaces without forcing the orchestrator to absorb every internal event.

The workflow inspector lets the user inspect:

- active workflow runs
- completed workflow runs
- workflow node progress through a searchable expandable tree
- workflow launch arguments and node props
- live Smithers DevTools snapshot and event-cursor updates
- selected-node status, objective or label, output, partial output, related artifacts, workflow agent, task attempt, command linkage, worktree, timing, and wait reason
- command, task-agent transcript, output, diff, log, event, and raw node detail tabs when those sources exist
- related artifacts
- worktree and workflow agent context
- related handler-thread, task-agent attempt, command, artifact, and Project CI check surfaces opened into chosen panes
- historical frames without requiring the handler thread or orchestrator to summarize raw workflow history

The inspector is a durable pane binding keyed by the local workflow-run record. Its run header shows normalized `svvy` status beside raw Smithers status, the Smithers run id, workflow label, owning handler thread, timing, heartbeat or latest event, and current frame state. The tree is the primary navigation model: search, expansion state, selected node, live-versus-historical frame mode, and pane placement belong to the inspector surface instead of the orchestrator transcript.

Some workflow categories may justify specialized UI instead of a generic workflow card.

Project CI is the clearest first example because it is backed by declared CI entries and validated CI result records rather than inferred from arbitrary workflow output.

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
