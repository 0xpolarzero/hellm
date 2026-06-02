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
- first-class workspace app logs for structured, redacted, live product observability
- a VS Code-like shared palette shell where `>` switches quick-open search into command/action mode without creating a second runtime

The intended feel is closer to Slate than to stock pi:

- one strategic brain
- bounded delegated work instead of persistent role agents
- reusable structured outputs instead of transcript-only memory
- direct inspection of delegated work when needed without bloating the orchestrator by default
- safe pause and resume across handler threads and workflow runs

## Product Goals

The shipped product must let a user:

- open a local repository in a native desktop app and work in long-lived coding sessions
- keep important sessions visible through pinning, move old sessions into a single collapsed archive without deleting their history, and expose a confirmed hard-delete action only from the session row context menu
- understand what the system is doing without reconstructing state from raw logs
- inspect structured app logs with unread counts, filters, virtualized long-scroll browsing, explicit Live/Frozen tail behavior, redacted details, normalized errors, and related product links when app behavior needs attention
- inspect durable outputs from each meaningful unit of work
- delegate bounded work while keeping top-level strategy and state visible
- talk directly inside delegated thread surfaces when that work needs clarification or follow-up
- queue follow-up user messages against a running orchestrator or handler-thread surface without creating a concurrent turn, losing the prompt, or retargeting it to another surface
- copy or edit any committed user message in an orchestrator or handler-thread transcript, see which committed message is currently being edited, receive a warning before replacing an existing composer draft, then send the revised text by moving the same pi surface back to that message's parent state and continuing normally from the edited message
- configure, run, and interpret Project CI as first-class product behavior
- save a reusable authored workflow into the workspace workflow library and discover it later
- use `Cmd+Shift+P` to open the shared palette with `>` prefilled for product actions, and `Cmd+P` to open the same palette as the reserved file quick-open entry point
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

- `svvy` must compose that surface's actor prompt from the current generated agent context and load the resulting instructions through pi's real `systemPrompt` channel
- `svvy` must ignore pi prompt replacement and append files such as `.pi/SYSTEM.md` and `APPEND_SYSTEM.md`, while preserving discovered `AGENTS.md` and `CLAUDE.md` files as read-only `external_instruction` extension records in the actual prompt path
- the submitted prompt body is the real new user message for that surface; `svvy` does not repair or advance a surface by flattening prior messages into role-labelled transcript prose
- committed conversation history stays in pi's session history, while runtime, thread, handoff, and workflow state stays in structured state and targeted tools
- the UI should project the active system prompt as expandable surface metadata rather than as inline transcript prose, and should warn when a surface is bound to an older prompt revision than current settings
- each surface must receive only the generated tool declarations and SDK blocks that are callable from that surface
- each surface may receive compact knowledge about what another surface can do, but it must not receive that other surface's full callable API block just for awareness

Ambient coding-agent resources are default-off unless explicitly enabled through `svvy` settings. This applies to pi resources such as extensions, skills, prompt templates, themes, packages, slash commands, hooks, provider adapters, credentials, and execution-policy settings, and to equivalent resources exposed by other coding-agent hosts. This default-off rule applies to imported or host-ambient resources, not to app-owned shipped extensions whose actor-specific default usage is explicitly defined in product specs. The current shipped prompt-only exceptions are Git, which is default-loaded for all adopted actor kinds, and GitHub, which is default-loaded for orchestrators and handler threads while remaining available for workflow task agents. `svvy` preserves plain external instruction files such as discovered `AGENTS.md` and `CLAUDE.md` as visible generated agent context through read-only extension records, but behavior-changing ambient resources must be enabled by category, source, host, workspace, and actor class before they can affect prompts, tools, commands, UI, provider behavior, auth, or execution policy. Enabled callable resources must still appear in the actor-specific generated API block for the exact actor that may call them.

Extension env values are app-managed per extension in v1. Secret values are keyed by `(extensionId, envName)`, entered only through user-owned app UI, stored encrypted by the app or OS keychain, injected only into the specific trusted extension runtime invocation that needs them, and never exposed to agents through prompts, generated docs, tool output, logs, artifacts, transcripts, global pi env, global shell env, or `execute_typescript` snippet env. Agent-facing extension inspection may report only declaration metadata and missing/configured readiness. Workspace-scoped extension env values and egress-proxy credential boundaries are not part of v1.

Agents and Extensions are the user-facing source of reusable prompt material and capability composition. Agent profiles contain base instructions, actor kind, model/reasoning, and extension usage selections. Extensions contain shipped, user, and external_instruction records with full loaded instructions, minimal loading hints, generated previews, and category-specific reset/delete behavior. External instruction records show discovered files such as `AGENTS.md` and `CLAUDE.md` as read-only generated-context inputs with open-external-file controls. New orchestrator sessions, handler threads, and workflow task agents bind to the latest ready generated agent context. Existing surfaces store the generated agent context fingerprint they received and automatically update to the latest ready generated agent context at the next safe boundary when that fingerprint changes.

The actor-specific capability split is:

- the orchestrator prompt knows that handler threads can supervise Smithers workflows, but it does not receive the `smithers_*` tool declarations; if it wants workflow action, it must delegate by calling `thread_start`
- a handler-thread prompt receives `smithers_*`, `load_extension`, `list_extensions`, `thread_handoff`, `thread_current`, `wait`, direct tools, and `execute_typescript` for typed composition, but it does not receive `thread_start` in the default adopted model
- orchestrator and handler prompts receive `runtime_current`, `thread_list`, and `thread_handoffs` so runtime binding, delegated-thread state, and durable handoff episodes are read through focused tools instead of prompt stuffing
- a workflow-task-agent prompt receives only task-local instructions and task-local callable declarations; in the default adopted model it receives task-local direct tools plus `execute_typescript`, and not `thread_start`, `thread_handoff`, `wait`, `load_extension`, Extension Managing, or `smithers_*`
- a workflow-task-agent runtime must not load ambient pi built-in tools, extensions, skills, prompt templates, themes, commands, hooks, provider adapters, or equivalent host resources that would widen that callable or prompt surface beyond the explicit task-local contract unless the user enables that exact resource category and source for workflow task agents
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
- the handler thread may call `thread_handoff` only after its current supervised workflow state is terminal or explicitly cancelled; a running or waiting workflow run may not be orphaned under a completed thread
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
- give that task agent a minimal `svvy` workflow-task system prompt rather than the orchestrator or handler-thread prompt
- expose a task-local generated capability set plus `execute_typescript` for typed composition
- keep `thread_start`, `thread_handoff`, `wait`, and `smithers_*` out of the task-agent runtime and tool schema instead of teaching unavailable controls in prompt prose
- keep human approval and hijack as Smithers runtime or operator controls around the task, not as ordinary task-agent tools
- execute the task agent and its task-local tool calls from Smithers' current task root, including the active worktree when the task is worktree-bound
- keep the workflow runtime DB, run ownership, and structured projection workspace-scoped even when the task itself executes in a worktree
- bind the workflow-task-attempt record before any task-local tool call runs by the exact Smithers task-attempt identity `(runId, nodeId, iteration, attempt)` supplied by the current Smithers context; do not use resume-handle lookup, heuristic recency scans, transcript inference, or multi-stage fallback chains to discover ownership
- preserve structured message history, step boundaries, and usage across retries, schema repair prompts, and hijack handoff instead of flattening continuation state into role-labelled prose
- stream live assistant and tool updates so handler wake-ups, UI activity, and heartbeat freshness reflect real task-agent progress rather than only terminal task text

This lets `svvy` reuse the same general PI-based agent recipe at three different layers without conflating their responsibilities:

- orchestrator
- handler thread
- workflow task agent

### 6. Direct Tools And `execute_typescript`

Direct tools are the default coding-agent work surface for bounded repository work.

Direct tools cover:

- semantic code navigation through the prompt-only `cx` CLI extension, using `exec_command` to run
  official `cx` commands
- file inspection and text search through `exec_command`
- visual inspection of local image files through the image-capable file inspection path when enabled
- inspecting repository and git state
- generating artifacts
- running bounded host commands through `exec_command`
- continuing long-running host commands through `write_stdin`
- editing files through `apply_patch`
- handler-owned discovery of workflow assets and workflow-authoring models
- listing the currently callable actor-specific capability set

When a model needs several independent tool results, the prompt should tell it to issue those tool calls together so pi's parallel tool execution can run them concurrently. Sequential tool calls should be reserved for cases where the later call depends on the earlier result.

The prompt-only `cx` extension is the preferred code-navigation guidance when the language is
supported. It does not add native `cx_*` tools, `svvyx cx`, or generated TypeScript clients. Agents
run the official CLI through `exec_command`. The normal inspection ladder is:

```text
cx overview -> cx symbols -> cx definition / cx references -> exec_command with rg/sed/cat/ls/find
```

The shipped cx instructions are default-loaded for orchestrators, handler threads, and workflow task
agents. If the `cx` binary is missing, `svvy` handles installation through the app-managed trusted
CLI dependency confirmation flow; agents must not run package-manager install commands for cx.

`execute_typescript` is available when typed control flow is the right unit of work.

That includes:

- batching direct-tool calls
- looping over many results
- filtering and aggregating search output
- producing durable artifact evidence from composed results

Inside `execute_typescript`, the runtime exposes actor-specific generated TypeScript clients.

Generated clients expose only loaded `svvy` and extension capabilities that are useful inside
TypeScript composition and callable by the current actor. They are generated from the same source
contracts as the runtime tools or extension commands. They do not preserve a broad hand-written
helper surface for ordinary repository primitives.

The orchestrator does not receive workflow discovery, Smithers runtime control, or any `workflow` or `smithers` namespace through `execute_typescript`. Workflow action from the orchestrator goes through `thread_start` into a handler thread.

Workflow task agents receive only task-local generated clients through `execute_typescript`. They do
not receive workflow discovery, Smithers runtime control, or handler/orchestrator control clients.

File edits use `apply_patch`.

Every submitted snippet is persisted as a file-backed artifact in the workspace artifact directory, and the runtime must compile or typecheck the snippet before execution.

Structured diagnostics must be produced, and invalid snippets must not run.

### 7. Native Control Tools Stay Small And Explicit

Some actions are not ordinary generic work because they change product-level control flow or the
current actor's generated extension binding.

Those actions stay as `svvy`-native control tools:

- `thread_start`
- `load_extension`
- `list_extensions`
- `thread_handoff`
- `wait`

These are still tool calls.

`list_extensions` is a native read-only actor-local inspection tool. It reports only the current
actor's loaded and available extension records and never exposes unavailable extension details,
secret values, generated context fingerprints, aggregate cache keys, or global profile usage state.

`load_extension` is a native control tool. It loads an available, ready extension into the current
actor session, refreshes the same-turn tool declarations, mounted `svvyx` namespace, generated
TypeScript declarations, and generated agent context binding, and records an `Agent context updated`
product event. It does not build extensions, request dependency approval, configure env values, or
mutate agent profile defaults.

Prompt-only Web guidance is different from a native Web tool surface.

The shipped Web extension is a default-loaded prompt-only extension that teaches agents to use the
official TinyFish CLI through ordinary shell commands. It does not add `web_search`, `web_fetch`,
`svvyx web`, generated Web TypeScript clients, or app-owned Web Provider settings. TinyFish owns CLI
install, auth, search, fetch, browser-backed research, and command output behavior. `svvy` only owns
whether the Web instructions are included in the actor's generated agent context.

The orchestrator may provide handler creation-time extension overrides when the delegated objective
should begin with a non-default extension already loaded:

```ts
thread_start({
  objective: "Define Project CI checks for this repository",
  extensions: {
    "project-ci": "default_loaded",
  },
});
```

That starts a normal handler thread with the default handler runtime shape and the requested extension
binding before its first turn. The override is session-local and does not mutate the handler profile.

There is no `thread_start_ci`, no `ci.start`, and no CI-specific orchestrator.

Workflow supervision is different.

`svvy` should not invent a parallel product-specific `workflow_*` abstraction layer just to hide Smithers.

Instead, the shipped app should register Smithers-native semantic tools through the Bun-owned bridge, using Smithers' own operation names where the docs already define them and Smithers' own nouns and verbs for the remaining adopted bridge surfaces.

That Smithers-native capability set is a product runtime API over configured saved and artifact Smithers workflow entries, not a thin wrapper around the repo authoring workspace under `workflows/`.

More precisely, this means:

- the agent does not receive a raw Smithers runtime object, raw HTTP client, raw MCP server, or CLI access
- `svvy` registers first-party agent tools in its own tool registry under a `smithers_*` namespace
- each `smithers_*` tool is a thin Bun-side adapter around one Smithers operation or one Smithers-aligned control-plane surface
- when Smithers already publishes a semantic tool name, `svvy` should keep that name and expose it as `smithers_<same_name>`
- when Smithers exposes only a server route or Gateway method, `svvy` may wrap it, but it should preserve Smithers' nouns and verbs instead of inventing a competing `workflow_*` vocabulary
- product-specific additions are limited to app-runtime concerns such as implicit current-thread binding, workflow registry lookup, normalized error envelopes, and durable command-fact recording
- `svvy` should expose only the subset of Smithers capabilities it actually wants the agent to use; unexposed Smithers surfaces remain operator-only or future work rather than getting renamed into parallel `svvy` APIs
- the orchestrator should know that `smithers_*` exists as a handler-thread capability, but it should not receive the `smithers_*` generated API block in its own prompt
- a handler thread should know that the orchestrator can delegate and reconcile handoffs, but it should not receive the orchestrator-only `thread_start` generated API block unless nested delegation is explicitly adopted
- a workflow task agent should know only its task-local instructions and task-local tools; approvals and hijack remain Smithers runtime behavior outside the task-agent tool block

The intended use of the native control subset is:

- the orchestrator normally uses `thread_start` to open a delegated handler thread
- the orchestrator uses `thread_resume` when a completed handler thread already has the right delegated context for follow-up work on the same objective
- the orchestrator may pass a `project-ci` extension override to `thread_start` when the delegated objective clearly needs Project CI authoring guidance from the first handler turn
- a handler thread may call `load_extension({ extensionId: "project-ci" })` when it later discovers that Project CI configuration or modification is required
- a handler thread uses `thread_handoff` to transfer back to the orchestrator only after no running or waiting workflow run still belongs to that span; the tool call succeeds when `svvy` records the durable handoff episode and marks the current objective span complete
- after a durable handoff is recorded, `svvy` creates a typed orchestrator queue item so the orchestrator can reconcile the recorded handoff in surface-queue order; cancelling or deleting that notification does not roll back the handoff episode or return a tool error to the handler
- a handler thread normally uses Smithers-native bridge tools such as `smithers_list_workflows`, `smithers_run_workflow`, `smithers_get_run`, `smithers_explain_run`, `smithers_list_pending_approvals`, `smithers_resolve_approval`, `smithers_get_node_detail`, `smithers_list_artifacts`, and `smithers_get_run_events` to supervise Smithers execution
- any interactive surface may use `wait` when it needs user or external input

`smithers_list_workflows` is the runnable-entry discovery surface and should expose each entry's `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, and `launchInputSchema`. Handlers launch or explicitly resume through the stable `smithers_run_workflow({ workflowId, input, runId? })` tool: supplied `runId` resumes exactly that run, omitted `runId` requests a fresh launch, omitted `runId` is rejected when the same handler already owns a nonterminal run with the same `workflowId`, and different `workflowId` values can run concurrently under one handler.

Project CI is not a separate native control tool in the adopted model.

Project CI is a dedicated product status and result lane over normal Smithers runnable entries that declare `productKind = "project-ci"` and a CI result schema. CI state is recorded only from terminal output that validates against that declared result schema.

The lane is a projection and UI concept, not a setup launcher, CI-specific orchestrator, or custom CI execution surface.

CI authoring knowledge is delivered through the optional `project-ci` extension.

It may be preloaded by `thread_start` extension overrides or loaded later by a handler through
`load_extension({ extensionId: "project-ci" })`.

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
- a handler thread may be idle between turns while still remaining open, owned, and ready for direct follow-up
- a handler thread returns control to the orchestrator by explicitly calling `thread_handoff`, which marks the current objective span terminal and emits a handoff episode only after the thread no longer owns a running or waiting workflow run for that span
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

### 12. Auto-Reviewed Approval Boundaries

`svvy` uses Codex-like approval boundaries with automatic review by default.

In practice that means:

- normal trusted local coding work proceeds without turning every command into a user approval prompt
- actions that cross a configured approval boundary are reviewed by `auto_review`
- dependency installation remains an explicit user-confirmation flow because it can download and execute third-party code
- ambiguity is handled through clarification and waiting states when the agent needs user intent, not through hidden approval gates
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
- session, turn, queued-message, thread, workflow-run, command, episode, artifact, Project CI, and wait models
- reconciliation
- workspace-runtime restart and crash recovery coordination for `svvy`-owned product work
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

When `svvy` needs workflow lifecycle state, the intended seam is write-driven projection from explicit Smithers bridge events, Smithers tool-boundary writes, and official Smithers bootstrap or reconnect control-plane reads that immediately persist workflow-run and thread facts into structured state. Restart recovery must use that same seam: Smithers remains the source of workflow execution, wait, approval, timer, output, transcript, event, artifact, and task-attempt facts, while `svvy` recovers only its product bindings, monitor cursors, attention delivery, Project CI projection, and UI/read-model facts.

Those lifecycle producers are first-class product behavior, not temporary fallback. Operator inspection reads may observe workflow state, but they must not mutate durable lifecycle state as a side effect.

Read paths must not repair workflow state heuristically from transcript replay, ad hoc refresh loops, or renderer polling.

## Product Model

### Workspace

A workspace is the local repository context the app is attached to.

It includes:

- repository root
- current branch or VCS state
- available worktrees
- discovered `AGENTS.md` and `CLAUDE.md` external instruction sources

The desktop shell presents open workspaces as compact tabs inside the app chrome, integrated with the sidebar and workspace control row rather than as a separate top toolbar. Workspace tabs are left-aligned at the start of the main workspace chrome, scroll horizontally when the open tab set exceeds the available space, and can be dragged to reorder them. Workspace tab order is durable workspace-shell chrome state and restores across app restart. A workspace tab is a visual selector for one workspace runtime and one active layout slot id. The canonical workspace runtime, durable workspace state, and durable user workspace layouts belong to the workspace context, not to the visual tab: the session catalog, path index, app logs, live surface registry, pi sessions, structured state, prompt queues, handler threads, workflow runs, workspace read models, and initialized `A`/`B`/`C` layout snapshots are shared by duplicate tabs for the same canonical cwd. Duplicate same-cwd tabs may choose different active layout ids, but they do not own separate durable layout documents or separate panel-local restore state for the same `(workspaceId, layoutId)`. Opening the app with no restored user workspace tabs creates a real svvy-owned default workspace tab whose first focused surface is exactly one `Open Workspace` pane, so normal chat, Context, Logs, command palette, and sessions remain usable before a user chooses a repository. Default workspace tabs have no durable layout slots; any pane changes made inside a default workspace tab are ephemeral and are not restored as workspace layout state. `Open Workspace` retargets the current visual tab to the chosen user workspace, `New Tab` creates another default workspace tab with exactly one `Open Workspace` pane, and `Open Workspace in New Tab` creates a new visual tab for the chosen user workspace. Opening an already-open repository in a new tab creates a separate visual workspace tab for the same cwd instead of focusing the existing tab, without creating an independent workspace runtime, independent session catalog, isolated durable workspace state, or another durable layout owner.

Each workspace tab summarizes that workspace's session-level running, unread, waiting, and error counts from the shared durable workspace read models for its cwd. Count badges render only when their value is greater than zero, stay in the stable running, unread, waiting, error order, use status color instead of icons, and expose title or tooltip context on hover. Workspace open and close controls are compact icon controls with accessible labels. Workspace-scoped backend requests and renderer sync events carry an explicit `workspaceId` for the shared workspace runtime and, when layout state is involved, an explicit `layoutId` chosen by the tab. The backend must not route user work through a process-global active cwd, treat cwd alone as the runtime id, or treat duplicate same-cwd tabs as separate durable workspaces or separate durable layout owners.

The sidebar footer shows the current checked-out branch with a branch icon when the workspace is inside a git repository. That branch affordance opens a compact local-branch menu and switches branches through a workspace-scoped Bun RPC using normal git semantics. If the workspace is not a git repository or no branch is checked out, the footer falls back to the workspace label with the workspace icon and does not expose a branch switcher.

Each user workspace has three fixed durable layout slots: `A`, `B`, and `C`, keyed by `(workspaceId, layoutId)`. These are not user-named layouts. The slots render as compact controls pinned at the far right of the same chrome row as the workspace tabs and status controls. Selecting a layout slot changes the active layout id on the current tab and swaps to that workspace's durable Dockview layout snapshot for the selected slot. Empty slots remain selectable and render muted, not disabled, so the user can start a new layout from scratch. Duplicate same-cwd tabs share the same three durable layout slots while each tab records only its selected active layout id; changing slot `A` in one tab changes the same `(workspaceId, "A")` layout that another tab would see when it selects `A`.

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

- pinned sessions, regular Sessions, and archived sessions appear as three fixed sidebar groups between the orchestrator actions and Logs, Agents, Extensions, and Workflows
- each group is collapsible, independently scrollable, vertically resizable, and persists its collapsed state and size per workspace
- archived sessions move into one Archived group, and Archived is collapsed by default
- the Archived group is the only archive-style grouping
- arbitrary user-created session folders are not part of the product model
- archiving hides a session from the active list without deleting pi session data, structured state, artifacts, threads, workflow runs, or episodes
- sessions track durable unread state when an assistant turn finishes outside the currently focused pane surface, show that state as a small dot in place of the session timestamp in the sidebar, and clear it when a pane for that session receives focus
- normal session-row clicks open the session in the focused Dockview panel, while `Cmd`-click opens the session in a new pane even when the clicked session is already active
- session rows expose a context menu with Mark as Unread, Pin or Unpin, Rename, and Archive or Unarchive actions while keeping normal row selection as the primary navigation behavior
- each top-level session row represents the orchestrator layer only; child handler and workflow state must not make the session row appear running, waiting, or broken
- delegated handler threads appear as nested rows under their parent session, and workflow runs appear as nested rows under their owning handler thread
- sidebar subtitles are row-local relevance signals: orchestrator rows show orchestrator-local waits, commands, turns, or explicit handoff summaries; handler rows show handler-local waits and active workflow supervision; workflow rows show workflow-local running and waiting state; workflow troubleshooting is muted because it is handler-owned repair work, while `error` is reserved for row-local unrecoverable state that needs user action

### Surface Identity

The product carries four different identifiers and they are not interchangeable:

- `workspaceSessionId`: the durable top-level session container id used for storage, summaries, navigation, and restart recovery
- `surfacePiSessionId`: the pi session id for the currently addressed interactive surface
- `threadId`: the durable handler-thread record id for the delegated objective; it exists only when the target surface is a handler thread
- `panelId`: the Dockview panel identity that points at a surface without becoming that surface's runtime identity

Rules:

- backend RPC calls and backend-to-renderer surface payloads must carry an explicit surface target rather than overloading `session.id`
- `session.id` inside session summaries means `workspaceSessionId`
- if the orchestrator surface currently happens to reuse the same string for `workspaceSessionId` and `surfacePiSessionId`, callers must treat that as an implementation detail rather than a shared identity contract
- `panelId` must never be used as a session id, surface id, or thread id

### Live Surface Runtime

Each interactive pi surface is managed as its own live runtime object keyed by `surfacePiSessionId`.

That live runtime owns:

- the live transcript snapshot
- streaming state
- provider, model, and reasoning settings
- the resolved system prompt
- the current prompt execution context
- one prompt lock for that surface
- a surface-local durable queue manager for prompt-bearing and control work, with blocked follow-ups waiting for the prompt lock to release

Live surface runtime is separate from both durable workspace state and Dockview layout state.

Streaming state belongs to the live surface runtime, not to a Dockview panel or renderer prompt
request. A surface may keep streaming with zero, one, or many attached panels, and a panel opened
mid-stream renders the committed transcript, pending user message, and current assistant stream from
the surface snapshot.

Queued surface work is structured product state, not committed transcript history until a prompt-bearing item is delivered as the next real user message for the same `surfacePiSessionId`. If the user submits from a composer while the target surface is idle, `svvy` still durably enqueues the message, but the queue manager atomically claims it before publishing renderer-visible queued state, so the first visible state is pending or active work. If the target surface is already running, `svvy` queues that message for the same surface, keeps the active turn undisturbed, and starts the next normal turn only after the current turn settles or is cancelled. Ordinary composer submit is queue-managed delivery; the explicit queued-row `Steer` action is the separate control for pi/Codex-style steering at the next safe active-turn boundary. A steered row remains visible in a locked state until pi accepts it into the active turn or `svvy` restores it after rejection. Handler handoffs and agent-context refresh control work use the same surface queue so they are ordered with user messages. An `agent_context_refresh` row labelled `Update agent context` updates the surface's generated agent context binding before later prompt-bearing items run, without creating transcript content or prompt history. Queued work survives panel changes and duplicated panel views because it belongs to the surface, not to a Dockview panel.

### Dockview Panel And Layout State

Dockview panel and layout state is UI state.

It owns:

- which Dockview panel shows which surface
- the Dockview layout document, including groups, tabs, split sizes, edge groups, floating groups, and popout groups
- panel focus
- panel-local scroll and inspector state
- svvy panel metadata keyed by Dockview panel id

Dockview panels are not live runtimes.

If two Dockview panels show the same surface, they share one underlying live surface runtime.

Users may split, dock, tab, drag, resize, close, float, and pop out panels as their workspace requires. Dockview owns the layout interaction mechanics, including drag/drop overlays and splitter behavior. The renderer is responsible for applying svvy product policy, practical minimum panel sizes, and explicit close behavior around Dockview events.

The durable layout stores Dockview serialized layout state plus svvy panel metadata. Window resize preserves the Dockview layout intent without changing surface bindings or live runtime ownership.

User workspace layout persistence is slot-based and keyed by `(workspaceId, layoutId)`. Slots `A`, `B`, and `C` each store their own Dockview serialized layout, panel metadata, focused panel, compact surface state, and panel-local state. The selected slot autosaves after meaningful pane changes. A slot is considered initialized once it contains a bound product surface; uninitialized slots are shown with muted chrome but remain fully selectable. Workspace tabs store only chrome state such as tab order, selected `workspaceId`, and active layout id. Default workspace tabs do not persist Dockview layout slots; a newly created default workspace tab always starts with one `Open Workspace` pane, and any later pane changes in that tab are ephemeral.

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
- loaded and available extension ids, when specialized product guidance or capability has been preloaded or loaded during the session
- zero or more workflow runs
- zero or more handoff episodes

Context-pack keys describe reusable product knowledge loaded into actor prompts by default or requested on demand, such as `Project CI`.

The current handler objective, wait state, generated agent context binding, active workflow run ids, and latest handoff metadata are exposed to the handler through `thread_current`. The orchestrator and handlers inspect delegated thread rows through `thread_list`, and exact durable handoff episode bodies through `thread_handoffs`. These read tools do not include transcripts, workflow summaries, or Smithers internals; handlers use active workflow run ids with `smithers_*` tools when workflow details matter.

Agent profiles describe the provider, model, reasoning level, base instructions, extension usage selections, and callable policy used by pi-backed product agents. The Agents pane is the product-owned profile surface. It appears in the sidebar between Logs and Extensions, and owns orchestrator profiles plus the special handler-thread profile rather than burying model behavior in general settings.

The app owns these app-wide agent profile settings:

- the default orchestrator profile for normal New orchestrator creation; it is locked, non-draggable, non-deletable, and always present in the picker
- `threadHandler` for delegated handler-thread surfaces created by `thread_start`

The app also owns internal title-naming settings for one-shot top-level session and handler-thread title generation, seeded to `openai-codex`/`gpt-5.4-mini` with low reasoning effort. Those settings are not exposed as a special Agents-pane profile.

User-created orchestrator profiles are ordered in the Agents pane. That order drives the New orchestrator picker order and visible profile badges on created orchestrator surfaces. The default orchestrator profile remains first and cannot be reordered, deleted, or converted into a user profile. Deleting a user-created profile uses an inline single-confirm action that cancels on outside click or Escape. All top-level session creation uses orchestrator profiles, with no separate session mode switch in the product model.

Session records persist the orchestrator profile selected at creation time, the profile snapshot that was active at creation time, and the generated agent context fingerprint used by the orchestrator surface. All top-level sessions are orchestrator sessions created through New orchestrator or equivalent command-palette prompt fallback.

Handler threads use the `threadHandler` special profile unless `thread_start` declares a specific provider, model, reasoning level, or handler prompt suffix for the delegated objective. Extensions remain separate product knowledge and capability records; they do not carry model, reasoning, or prompt-selection settings.

The Agents pane edits app-global agent profiles, including orchestrator profiles and `threadHandler`. General settings edit app-global model provider credentials, app appearance (`system`, `light`, or `dark` with `system` as the default), and the user's preferred external editor for opening workspace source files from read-only product surfaces. Provider rows use icon-only key, OAuth, and remove controls with explanatory tooltips; remove uses an inline single-confirm action. Web-specific TinyFish CLI auth is owned by TinyFish CLI commands such as `tinyfish auth login`, `tinyfish auth set`, and `tinyfish auth status`, not by `svvy` General settings. Extension definitions, extension instructions, external instruction controls, and generated context previews are edited or inspected in the Extensions pane rather than buried in general settings. Complex settings and configuration editors use TanStack Form for renderer form state where they need validation, dirty state, field-level errors, submit pending state, reset/cancel behavior, and async save errors, while Bun-side settings validation and normalization remain authoritative. Agent profile changes save directly from the setting control rather than through a separate save button. Agent model selection is a constrained picker over models from currently connected providers, and reasoning selection is constrained to the levels supported by the selected model, matching the interactive session controls rather than accepting freeform provider, model, or reasoning text. An orchestrator profile may either keep composer model and reasoning changes local to each session or let sessions using that profile save those composer changes back to the profile for future sessions. The source of truth for provider/model capability metadata is pi's normalized model registry and runtime APIs: `svvy` does not maintain separate provider-specific reasoning tables, Codex reasoning special cases, or request-shape mappings. Visible reasoning output is whatever pi normalizes into assistant `thinking` blocks; for providers such as OpenAI Codex this is a reasoning summary when the provider streams one, not raw chain-of-thought, and encrypted continuation-only reasoning with no visible summary must be labelled unavailable rather than redacted.

Workflow-agent configuration under `.svvy/workflows/components/agents.ts` is future work owned by the Workflows library and packaged Smithers runtime direction. It remains an ordinary workspace saved-workflow component when adopted, must route by explicit `workspaceId`, and must not imply that repo-root `workflows/` is the shipped product workflow runtime.

### Agents And Extensions

Agents and Extensions are the app-owned prompt and capability configuration surface for orchestrator, handler-thread, and workflow task-agent prompts.

Agents own:

- profile display name
- actor kind
- provider/model and reasoning defaults
- base instructions
- per-extension usage state: `default_loaded`, `available`, or `unavailable`
- generated context and generated runtime-surface previews for that profile

Extensions own:

- shipped, user, and external_instruction categories
- full loaded instructions
- minimal available instructions
- native tool, svvyx, or instructions-only interface
- generated TypeScript client declarations when enabled
- env and dependency readiness
- category-appropriate reset/delete behavior
- read-only usage views showing which agents use the extension

External instruction records represent files such as `AGENTS.md` and `CLAUDE.md`. They appear in the Extensions pane as a distinct read-only category, use the same per-agent usage states as other extensions, show path/content/order in generated-context previews, and provide an open-external-file action. Resetting an external instruction record changes only `svvy` settings or metadata overlays; it never overwrites the external file.

Generated agent context bindings store loaded extension ids, available extension ids, external instruction content/order, native tool declarations, loaded svvyx guidance, generated TypeScript client declarations, aggregate cache key, and generated agent context fingerprint for sessions, handler threads, and workflow task-agent attempts.

New top-level sessions, handler threads, and workflow task agents always use the latest ready generated agent context from Agents, Extensions, generated contracts, and current external instructions. Existing surfaces store the generated agent context fingerprint they received. When the current ready generated context fingerprint differs from the bound fingerprint, `svvy` automatically queues or applies `agent_context_refresh` work labelled `Update agent context`. If the surface is idle, the update is claimed before the next prompt-bearing item runs. If the surface is active, the update is visible in the queue until it applies at the next safe `refreshRunContext` boundary or before the next prompt-bearing item. On success, the affected session records `Agent context updated` with details of what changed. The visible surface identity and transcript stay continuous even if the internal managed pi runtime must be recreated to load the fresh `systemPrompt`.

Top-level session titles are generated through an explicit durable title-generation flow. Before the first turn is submitted, the visible default session title follows the beginning of the live composer draft for that session's orchestrator surface. When the first real user turn starts in a top-level session, the app records a pending title-generation job and runs the configured `namer` agent concurrently with the orchestrator turn; until that generated title lands, the visible title continues to use the first user message summary. The orchestrator must not wait for the namer, and the namer must not wait for the orchestrator response. The namer settings prompt is the title-generation instruction; the one-shot user prompt sent to that agent contains only the first user message context to title, not another naming instruction or extracted keyword list. While that job is pending or running, manual session rename is blocked for that session so the generated title and a user rename cannot race. The generated title is persisted once, auto-title generation stops after that first successful generation, and a manual rename permanently freezes future auto-titling for the session. Handler-thread titles are generated by the same configured `namer` agent from the orchestrator-supplied `thread_start` objective; the orchestrator does not receive or supply a separate handler title field. Workflow runs do not have a separate title concept and use workflow identity or entry metadata for labels.

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

The generated workflow-authoring contract is the handler-visible source of truth for runnable entry modules, product lane metadata, grouped asset refs, `createRunnableEntry(...)`, and workflow task agents. The curated guide teaches the Smithers render/task/output model, artifact layout, saved library layout, validation loop, and `AgentLike` task usage without restating generated `execute_typescript` client or workflow contract shapes in prose.

Saved workflow assets are reusable source assets.

They include:

- definitions
- prompts
- components
- future workflow-agent component assets, when adopted as packaged-app-safe saved workflow components rather than repo-root `workflows/` runtime state

Saved entries are the launchable wrappers in the saved workflow library.

The intended decision order inside a handler thread is:

1. can the task be completed directly with direct tools?
2. if not, does a saved runnable entry clearly fit?
3. if not, author a short-lived artifact workflow, usually by mixing saved definitions, prompts, and components; future workflow-agent component reuse belongs to packaged-app-safe Workflows assets rather than repo-root `workflows/` runtime state
4. execute the selected or authored workflow

Artifact workflows are persisted by default under `.svvy/artifacts/workflows/`.

Saving reusable workflow files means the handler writes those files directly into `.svvy/workflows/` through `apply_patch`.

Writes under `.svvy/workflows/` automatically surface saved-workflow validation feedback in structured tool output.

Workflows library reads, source previews, validation refreshes, delete actions, open-in-editor actions, save-shortcut routing, and future workflow-agent component operations are workspace-affecting operations. Each request must carry the target `workspaceId` and resolve the workspace runtime from that id, not from the active workspace tab.

The UI should expose:

- a save shortcut that sends a predefined save request prompt to the handler thread
- a read-only Workflows surface where the user can inspect saved definitions, prompts, components, entries, and artifact workflow groups without requiring an in-app source editor
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

It is created when the handler thread explicitly calls `thread_handoff`.

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

Visible HTML artifact previews must render inside sandboxed iframes. Script-capable previews may grant `allow-scripts`, but the sandbox policy must not include `allow-same-origin`, top navigation, popups, form submission, or other parent/app escape permissions.

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

CI authoring guidance belongs only to handler threads that load the optional `project-ci` extension.

Normal handler threads may discover and run configured CI entries without that pack.

If a normal handler needs to configure or modify Project CI, it should call `load_extension({ extensionId: "project-ci" })` rather than relying on default prompt knowledge.

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

Every user request that can start immediately goes through one orchestrator-controlled product loop:

1. load current workspace, session, thread, workflow-run, episode, artifact, Project CI, and wait context
2. identify the target surface of the message
3. drain any earlier queued `agent_context_refresh` control item for the target surface, refreshing the generated agent context binding before prompt-bearing work
4. compose that surface's actor prompt from its bound generated agent context, including agent base instructions, loaded extension instructions, available extension loading hints, external instruction files, native tool declarations, loaded svvyx guidance, and generated TypeScript client declarations, then load it into pi's true `systemPrompt` channel before sending the new user message
5. open a new turn for that surface
6. let that surface choose and persist its top-level turn decision, then decide its next tool call or direct response
7. execute tools through the correct runtime handler
8. record commands, events, workflow-run state, artifacts, and wait state
9. update structured state
10. emit explicit workspace-state updates whenever durable summaries or read models change
11. emit explicit surface-state updates whenever one live surface transcript or runtime snapshot changes
12. render updated workspace and Dockview panel surfaces by joining those updates with panel bindings

Read APIs and renderer code must not compensate for missing lifecycle writes with polling, transcript parsing, or inferred repair logic.

If the target surface already has an active prompt lock, the composer submit does not enter this flow immediately. It creates a surface-local queued-message record and waits for the same `surfacePiSessionId` to become available. Delivery of that queued message then enters the normal flow as a real user message and normal turn for that surface.

Committed user transcript messages expose a copy action for their visible text and a separate edit action. When the user edits a committed user transcript message, the selected transcript message stays visibly marked while its text is loaded into the composer. If the composer already contains text or attachments, `svvy` opens an app dialog warning that the edit will replace the current draft and includes a `TODO:` note pointing toward preserving it through the planned backlog flow before continuing. The edited send targets the same `surfacePiSessionId` and uses pi's session tree semantics to move the active surface leaf to the parent of the original user message before submitting the revised user message. The old branch remains historical session data, but the visible live surface continues from the new edited branch. This is not a fork, queued-message restore, transcript rewrite, or hidden prose reconstruction.

### Main Orchestrator Loop

When the target surface is the main orchestrator:

1. understand the new request in the context of existing durable state
2. decide and persist whether the request can be handled locally or needs delegation
3. if local:
   - answer directly
   - or use `execute_typescript`
   - or ask for clarification
4. if delegated:
   - call `thread_start`
   - hand off the delegated objective to a handler thread
   - include handler extension overrides such as loading `project-ci` only when the objective needs that product guidance from the first handler turn
5. when a handler thread explicitly hands control back, reconcile the typed handoff notification against durable state: thread durable state plus the latest handoff episode
6. if later work belongs in the same delegated context, call `thread_resume` with the completed thread id and a new message instead of starting an unrelated replacement thread

### Handler Thread Loop

When the target surface is a handler thread:

1. understand the delegated objective and current thread state
2. decide and persist whether to:
   - reply directly inside the thread
   - use `execute_typescript`
   - request optional product guidance or capability through `load_extension`
   - reuse a saved runnable entry
   - author a short-lived artifact workflow, often by importing saved definitions, prompts, and components
   - inspect workflow state through Smithers-native bridge tools such as `smithers_get_run`, `smithers_explain_run`, `smithers_get_node_detail`, and `smithers_get_run_events`
   - resume an existing paused workflow run through the Smithers bridge when Smithers still considers that run resumable
   - start a replacement workflow run
   - ask the user for clarification
   - enter wait
   - hand control back with `thread_handoff`
3. run or resume workflow execution as needed
4. regain control when the workflow run reaches a terminal outcome or another actionable attention state
5. continue supervising until the objective is truly finished
6. when appropriate, return control to the orchestrator by explicitly calling `thread_handoff`

When `thread_handoff` succeeds, the handoff has crossed the clear ownership boundary because the durable handoff episode and completed objective span have been recorded. The orchestrator receives a typed notification in its ordered surface queue and should reconcile that recorded state in a fresh orchestrator turn. If the orchestrator is already active, the notification waits in the same ordered surface queue as user follow-up messages.

If a thread already handed control back earlier:

- a direct follow-up question may be answered inside that same thread without reopening the orchestrator loop
- explicit orchestrator re-engagement through `thread_resume` may move the completed thread back to an active running state for a new objective span
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

- pinned sessions first
- remaining sessions by recency under Sessions
- one Archived group for archived sessions
- handler thread rows nested under the session that owns them
- workflow run rows nested under the handler thread that owns them

Pinned, Sessions, and Archived use the same accordion header treatment. Each group owns a scrollable, vertically resizable space. The Archived group is collapsed by default, and group collapsed state and sizes are persisted per workspace.

Archiving is reversible and non-destructive. It must not delete durable session, thread, workflow-run, episode, artifact, or transcript data.

Session sidebar state is layered. A handler thread in `waiting`, `running-workflow`, or `troubleshooting` does not automatically change the parent session row's status or subtitle. A workflow run in `running`, `waiting`, `failed`, or `cancelled` does not automatically change the owning handler's parent session row. `troubleshooting` means the handler is working through workflow repair locally and is rendered as muted workflow state, not as parent-session error. `error` is reserved for row-local unrecoverable state that needs user action. The orchestrator row updates from explicit orchestrator-owned state and explicit handoff/reconciliation events such as `thread_handoff`.

Active row subtitles blink only for agent or workflow work that is currently running, not for waiting or error rows. If a row is doing agent work but has no useful subtitle to surface, it shows only a compact blinking ellipsis. Rows that are open in Dockview use local border/background treatment instead of a text badge, and that treatment follows the row's waiting or error tone. Open orchestrator and handler rows also show a compact context-budget rail along the bottom of the row.

### Command Palette And Quick Open

`svvy` should expose a VS Code-like shared palette model as a first-class shell capability.

The palette has one shell, one input, and one result interaction model. The leading `>` input prefix selects command mode. `Cmd+Shift+P` opens the shared palette with `>` already inserted, and command mode discovers and executes product actions, including New orchestrator creation and session switching, session pin/archive actions, opening focused session/thread/workflow/artifact/Project CI surfaces, Project CI run or configuration actions, handler-thread surfaces, workflow-inspector-related surfaces, pane and layout actions when panes exist, settings and Agents profile actions when those features exist, and future product actions as they are added.

`Cmd+P` opens the same shared palette with an empty input for file quick-open search mode. For now, file quick-open is intentionally a no-op or placeholder because file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces are not yet implemented. It must not fabricate file surfaces or introduce an ad hoc file browsing path. Typing `>` into the quick-open input switches the already-open palette into command mode, and deleting the prefix switches it back to quick-open behavior.

When implemented, the command palette UI should use `cmdk-sv` from `https://www.cmdk-sv.com/` as the Svelte command menu primitive. Its docs describe it as a "fast, composable, unstyled command menu for Svelte." `cmdk-sv` is the renderer menu primitive, not the source of product routing, runtime behavior, or command semantics.

The command palette is a prefix-driven shell/action surface within the shared palette. It is not an alternate execution engine, standalone shell, custom terminal loop, readline loop, alternate TUI stack, or parallel workflow abstraction. Palette actions route into the existing product model: sessions, panes, surfaces, orchestrator and handler turns, Smithers-native tools, Project CI projection, durable state, settings, and Agents profiles.

Shell action controls that expose command-palette, quick-open, New orchestrator, sidebar, or pane actions use the product shortcut registry for user feedback and dispatch metadata. The registry owns stable shortcut action ids, labels, platform chords, compact and readable display strings, scope, input-typing policy, availability, and command routing metadata. TanStack Hotkeys is the renderer binding primitive that subscribes scoped shortcuts and applies the registry input policy; it is not the source of product command semantics. App launcher and shell command chords such as `Cmd+Shift+P`, `Cmd+P`, `Cmd+N` for New orchestrator in the focused pane, `Cmd+Shift+N` for New orchestrator in a new pane, sidebar toggle, `Cmd+Shift+1` for Logs, `Cmd+Shift+2` for Agents, `Cmd+Shift+3` for Context, and `Cmd+Shift+4` for Workflows remain available while workspace text inputs such as the composer are focused. Explicit labeled sidebar actions reveal compact in-button shortcuts immediately on hover or focus; the New orchestrator control also shows a delayed tooltip that explains click, `Cmd+N`, `Cmd`-click, `Cmd+Shift+N` placement, and profile-picker behavior. Icon-only or ambiguous controls may show explanatory action tooltips after 500 ms and include the readable shortcut when one exists. Native browser `title` tooltips are not the product feedback layer for these controls. Command palette and quick-open launchers live in the sidebar rather than duplicated in the top-right workspace chrome.

When the shared palette is in command mode and the text after `>` does not match an existing command or action, pressing Enter creates a New orchestrator session and uses the text after `>` as the initial prompt. That prompt enters the normal orchestrator turn model; it does not bypass system prompt loading, prompt history, structured turn state, or live surface runtime ownership. Text entered without the leading `>` remains quick-open search text and must not create prompt sessions while file quick-open is still a placeholder.

The default command-palette behavior is defined before choosing a Dockview target as normal current workspace and session routing. Once Dockview layout exists, placement rules belong to the pane-layout spec: command palette results that open sessions or surfaces default to a new Dockview panel, and `Cmd+Enter` opens into the currently focused panel.

### Surface Projection

`svvy` uses a Dockview-backed multi-pane desktop layout where:

- the main orchestrator surface can be opened in a Dockview panel
- a handler thread surface can be opened in a Dockview panel
- a workflow inspector surface can be opened in a Dockview panel
- artifact, Project CI, Workflows, Context, and related inspector surfaces can be opened in Dockview panels, tab groups, edge groups, floating groups, or popout groups when valid

The main orchestrator surface and a handler thread surface should use the same core interactive UI model:

- transcript
- composer
- tool activity
- artifacts
- status

Assistant transcript messages render Markdown suitable for coding-agent output, including compact prose, lists, tables, fenced code with syntax highlighting and copy actions, inline and block math, Mermaid diagrams, and escaped raw HTML rather than executable HTML. Long transcript surfaces use TanStack Virtual over system metadata, semantic projection cards, durable messages, tool rows, and active streaming rows so variable-height content preserves pane-local scroll anchors while following the bottom only when the user is pinned there. Live assistant output preserves each provider/runtime stream packet as a visible update, but the bridge sends compact ordered stream patches instead of full surface snapshots for every packet; full snapshots remain the baseline, recovery, and settled-state mechanism.

Message targeting is simple:

- sending a message from a panel sends it to the surface shown in that panel
- if the panel shows the orchestrator, the message goes to the orchestrator
- if the panel shows a handler thread, the message goes to that handler thread

This is shared surface behavior, not a thread-specific exception.

Projection ownership is equally simple:

- the backend owns durable workspace projection and live surface runtime ownership
- Dockview owns layout mechanics and serialized layout state
- the renderer owns panel bindings, panel focus projection, and panel-local view state
- the renderer listens for explicit workspace updates and surface updates, then joins them locally
- the renderer does not poll read APIs, inspect transcript files, or infer lifecycle changes from transcript mutations
- workspace-scoped backend requests and sync events route by explicit `workspaceId`, never by active workspace, focused panel, or current tab

Panel and surface semantics are:

- opening a Dockview panel attaches that panel to a surface
- closing a panel detaches that panel without deleting durable state
- closing the last owner of a surface releases that live surface runtime cleanly
- more than one panel may attach to the same surface
- duplicated panels share one underlying live surface state but may keep independent scroll position
- split, resize, close, tab reorder, panel/group drag/drop placement, Dockview focus, bindings, Dockview layout JSON, edge-group state, floating/popout state, and panel-local state persist across restart
- user workspace active layout choices and all initialized `A`/`B`/`C` layout snapshots keyed by `(workspaceId, layoutId)` persist across restart
- background workflow attention always targets the owning handler surface, not the currently focused panel

On restart, the workspace shell should restore useful stable UI state:

- pinned and archived session state
- Archived group collapsed state
- open Dockview panels and panel-to-surface bindings
- focused panel
- panel-local scroll and display preferences
- explicit static inspector pane targets when the target still exists

It should not restore transient menus or popovers, unsaved inline edits outside the composer, selected transcript text, temporary search highlights, or stale live stream and tool-running state.

Composer draft text and chip-only attachments are durable surface state rather than transient UI restore state. They are saved live against the owning `surfacePiSessionId`, survive closing the surface and restarting the app, and clear only when submitted or explicitly emptied.

Backend recovery is separate from workspace shell UI restore. Each acquired workspace runtime owns one durable recovery coordinator for that workspace's sessions, pi surfaces, queues, initial handler starts, handoff notification delivery, waits, title jobs, Smithers monitor reconnect, workflow attention, Project CI projection, and recovery observability. The coordinator uses durable owner scopes, idempotency keys, and transactional claims rather than active workspace, focused tab, focused panel, process cwd, or renderer state. App-global startup and workspace-tab restore decide which runtimes exist; they do not drain workspace queues or repair workspace product work directly.

## Workflow Inspection

The product exposes workflow runs as inspectable Dockview panel surfaces without forcing the orchestrator to absorb every internal event.

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
- related handler-thread, task-agent attempt, command, artifact, and Project CI check surfaces opened into chosen Dockview panels
- historical frames without requiring the handler thread or orchestrator to summarize raw workflow history

The inspector is a durable panel binding keyed by the local workflow-run record. Its run header shows normalized `svvy` status beside raw Smithers status, the Smithers run id, workflow label, owning handler thread, timing, heartbeat or latest event, and current frame state. The tree is the primary navigation model: search, expansion state, selected node, live-versus-historical frame mode, and Dockview placement belong to the inspector surface instead of the orchestrator transcript.

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
