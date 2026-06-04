# Execution Model

This document is a companion to the [PRD](./prd.md).

It describes the intended product-level request flow for `svvy`.

It is a behavioral model, not a package layout or implementation call graph.

## Core Shape

The adopted model is one shared command system:

```text
message -> target surface -> turn -> tool call -> command -> handler -> events -> structured state -> UI
```

The target surface may be:

- the main orchestrator surface
- a delegated handler thread surface

The orchestrator remains the strategic brain.

Handler threads own one delegated objective at a time.

Smithers owns workflow execution under those handler threads.

## End-To-End Flow

```mermaid
flowchart TD
    subgraph Entry["Entry Surfaces"]
        OrchestratorPane["Orchestrator surface"]
        ThreadPane["Handler thread surface"]
        Headless["Headless input"]
    end

    subgraph Load["Context Load"]
        LoadState["Load workspace, session, threads, workflow runs, episodes, artifacts, Project CI, waits, pi-discovered AGENTS.md/CLAUDE.md runtime standards, svvy app state, svvy pi runtime state, and workspace .svvy config"]
    end

    subgraph Surface["Target Surface"]
        OpenTurn["Open turn on the target surface"]
        Decide["Surface decides next action"]
    end

    subgraph Tools["Generated Capability Set"]
        DirectTools["PI-backed direct tools"]
        Generic["execute_typescript"]
        ThreadControls["Thread Orchestration / Thread Handling native controls"]
        ListExtensions["list_extensions"]
        LoadExtension["load_extension"]
        SmithersTools["Smithers-native workflow tools (`smithers_*`)"]
        RequestInput["request_user_input"]
        DirectReply["Direct reply"]
    end

    subgraph GenericExec["Generic Execution"]
        ApproveTs["Classify execute_typescript approval boundary"]
        Compile["Compile or typecheck snippet against generated extensions types"]
        Run["Run valid TypeScript program"]
        Api["Generated extensions object"]
        ApiExtensions["loaded svvyx clients under extensions[<id>]"]
    end

    subgraph Runtime["Runtime Handlers"]
        RuntimeHandler["svvy runtime handles execute_typescript, thread controls, load_extension, request_user_input, and durable wait state"]
        SmithersBridge["Bun-owned Smithers bridge handles Smithers-native workflow tools"]
        ResumeHandler["Runtime resumes the supervising handler thread when a workflow run changes state"]
    end

    subgraph Facts["Durable Facts"]
        Commands["Record commands and parent-child linkage"]
        Events["Append lifecycle events"]
        Artifacts["Persist file-backed artifacts and SQLite metadata"]
        State["Update turns, commands, threads, report requests, generated agent context bindings, workflow runs, CI run/check result records, artifacts, wait state, and any episodes emitted by thread_report"]
    end

    subgraph ReadModels["Read Models"]
        Selectors["Build metadata-first selectors and summaries"]
        UI["Render orchestrator surface, handler threads, workflow runs, artifacts, and waits"]
    end

    OrchestratorPane --> LoadState
    ThreadPane --> LoadState
    Headless --> LoadState

    LoadState --> OpenTurn
    OpenTurn --> Decide

    Decide --> Generic
    Decide --> ThreadControls
    Decide --> ListExtensions
    Decide --> LoadExtension
    Decide --> SmithersTools
    Decide --> Wait
    Decide --> DirectReply

    Generic --> ApproveTs
    ApproveTs --> Compile
    Compile --> Run
    Run --> Api
    Api --> ApiExtensions
    Api --> RuntimeHandler

    ThreadControls --> RuntimeHandler
    ListExtensions --> RuntimeHandler
    LoadExtension --> RuntimeHandler
    SmithersTools --> SmithersBridge
    Wait --> RuntimeHandler
    DirectReply --> State

    SmithersBridge --> ResumeHandler
    ResumeHandler --> State

    RuntimeHandler --> Commands
    SmithersBridge --> Commands
    Commands --> Events
    Events --> Artifacts
    Artifacts --> State
    Events --> State
    State --> Selectors
    Selectors --> UI
```

## Practical Interpretation

### 1. Messages Target A Surface

Every send goes to one interactive surface.

That means:

- a message sent in the orchestrator pane goes to the orchestrator surface
- a message sent in a handler thread pane goes to that handler thread surface

This is shared surface behavior, not special logic for waiting threads only.

### 2. The Orchestrator Delegates Objectives, Not Raw Workflow Runs

The orchestrator typically chooses among:

- direct reply
- cx CLI guidance through `exec_command` plus direct tools
- `execute_typescript`
- Thread Orchestration tools: `thread_start`, `thread_followup`, `thread_list`, `thread_episodes`,
  and `thread_request_report`
- `request_user_input` when user clarification is needed

It normally does **not** supervise every workflow pause, rerun, and repair step itself.

The orchestrator prompt should know that handler threads can use Smithers workflow tools, but it should not receive the `smithers_*` callable schema in its own generated prompt block.

Instead, it opens a handler thread for that delegated objective.

### 3. A Handler Thread Supervises Workflow Execution

Inside a handler thread, the normal choices are:

- direct reply
- cx CLI guidance through `exec_command` plus direct tools
- `execute_typescript`
- `thread_current`
- `thread_group`
- `thread_report`
- `thread_episodes`
- `list_extensions` and `load_extension`
- `workflow_list_models` when authoring a fresh workflow task-agent configuration
- Smithers-native workflow tools such as `smithers_list_workflows`, `smithers_run_workflow`, `smithers_get_run`, `smithers_explain_run`, and `smithers_resolve_approval`
- `request_user_input` when user clarification is needed

The workflow runtime capability set should mirror Smithers semantics rather than a svvy-defined `workflow_*` alias layer. Runnable entry discovery belongs to `smithers_list_workflows({ workflowId? })`, which returns each entry's `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, and `launchInputSchema`. Fresh launch and explicit resume belong to the stable `smithers_run_workflow({ workflowId, input, runId? })` tool, with `input` validated against the workflow's real TypeScript or Zod launch schema rather than handwritten prompt prose or repo inspection. Supplying `runId` resumes exactly that run; omitting `runId` requests a fresh launch, never silently resumes, and is rejected when the same handler already owns a nonterminal run with the same `workflowId`. Different `workflowId` values can run concurrently under one handler thread. `workflow_list_models` is the narrow authoring-time exception for provider/model/reasoning discovery; it does not launch, inspect, resume, or supervise workflows. Smithers-native commands are supervision helpers inside the handler-thread lifecycle, not evidence that the repo-root `workflows/` authoring package is the shipped product runtime.

The agent does not get raw Smithers internals, a raw Smithers HTTP client, a raw Smithers MCP server,
a raw Smithers CLI, or any Incur-backed Smithers facade. It gets `svvy`-registered `smithers_*`
tools through the Bun-owned Smithers bridge when the Smithers extension is loaded.

The handler-thread prompt may know that the orchestrator can delegate and reconcile work, but it should not receive orchestrator-only tool declarations such as `thread_start` unless nested delegation is explicitly adopted later.

The handler thread may:

- reuse a saved runnable entry
- author a short-lived artifact workflow
- import saved definitions, prompts, and components while authoring that workflow
- inspect its current thread group and sibling objective summaries through `thread_group` when that
  context materially helps the current objective
- rerun after repair
- resume after clarification
- stay in normal multi-turn chat for ordinary replies
- call `thread_report` without `outcome` when it wants to emit an important intermediate update to the orchestrator
- call `thread_report` without `outcome` when it needs the orchestrator to decide whether a
  correction or finding should be forwarded to sibling threads
- call `thread_report` with `outcome` when it wants to conclude the current objective and return control to the orchestrator with a durable conclusion episode

### 4. Workflow Task Agents Are Lower-Level Workers

Inside a Smithers workflow, a task may itself run a lower-level workflow task agent.

That actor is:

- hosted by Smithers inside a task attempt, not by `svvy` as an interactive surface
- configured with the same broad ingredients as the orchestrator and handler thread: model, reasoning, system prompt, and tools
- a different contract because Smithers owns the task lifecycle, output validation, retries, approvals, and hijack behavior

The adopted direction is:

- use a PI-backed workflow task agent by default when a workflow task needs an adaptive agent
- give that workflow task agent a minimal `svvy` workflow-task prompt rather than the orchestrator or handler-thread prompt
- expose task-local direct tools plus `execute_typescript` for typed composition
- run task-local shell, patch, network, parent `execute_typescript`, and generated loaded-extension
  client boundaries through the same `svvy` execution policy as orchestrators and handler threads,
  including Codex-like macOS sandboxing, `networkAccess`, and approval modes, scoped to the exact
  Smithers task attempt
- do not expose `thread_start`, `thread_followup`, `thread_list`, `thread_current`,
  `thread_group`, `thread_report`, `thread_request_report`, `thread_episodes`,
  `request_user_input`, or `smithers_*` to workflow task agents or mention those unavailable
  controls in their base prompt
- do not load ambient pi built-in tools or workspace-discovered extension tools into workflow task agents
- execute workflow task agents from Smithers' current task root or worktree rather than from the workspace runtime DB root
- preserve structured message history, step boundaries, and usage across retries and hijack handoff instead of flattening task-agent continuation into plain text

Smithers workflow approvals and hijack are not ordinary task-agent tools:

- workflow approval belongs to Smithers workflow controls such as approval nodes or task
  approval gates
- hijack belongs to Smithers runtime or operator controls around the underlying task agent session

Shell, filesystem, network, and generated-client permission approvals raised by a workflow task
agent's direct tools are different. Those use the same `svvy` execution-permission flow as
orchestrator and handler-thread direct tools, scoped to the exact Smithers task attempt that owns the
blocked call. They must not be routed through Smithers workflow approval tools such as
`smithers_list_pending_approvals` or `smithers_resolve_approval`.

### 5. Workflow State Returns To The Handler Thread, Not The Orchestrator

When a Smithers run:

- completes
- fails
- pauses in an actionable way

the runtime resumes the supervising handler thread with the structured run result.

After a handler thread launches or resumes a Smithers run through the Bun bridge, the runtime parks that handler thread while Smithers executes.

The handler thread then decides what to do next.

The orchestrator receives delegated thread results only when the handler thread explicitly emits them through `thread_report`, or when the orchestrator asks for an update with `thread_request_report` and the handler answers with `thread_report`.

When that happens, `thread_report` first records the durable episode, optionally resolves a report request, and optionally concludes the current objective. The runtime then queues a typed orchestrator notification to reconcile the latest durable episode instead of waiting for another user-authored orchestrator message.

### 6. Explicit Thread Episodes

The supervising handler thread may manage:

- multiple workflow runs
- multiple reruns
- multiple clarification cycles
- many ordinary direct chat turns

Ordinary replies inside the thread do not emit episodes and do not close the delegated objective.

When the handler thread wants to give the orchestrator an important update, it calls `thread_report`
without `outcome`.

When the handler thread wants to hand control back, it calls `thread_report` with `outcome`.

Each `thread_report` emits one ordered episode. Reports with `outcome` also mark the current
objective concluded, while the thread surface itself stays interactive for later follow-up.

If the orchestrator later needs more help from the same delegated context, it should use
`thread_followup({ activate: true })` to re-engage the concluded handler objective with a new
objective instead of creating an unrelated replacement thread by default.

That explicit episode is the default reconciliation unit.

### 7. Waiting Is A Lifecycle Status

There is no shipped model-facing `wait` tool.

Waiting is a lifecycle state recorded by request-user-input, execution approval, workflow attention,
signal, timer, and other durable product records. It is not a separate execution subsystem.

Any interactive surface may enter wait when it needs:

- user clarification through `request_user_input`
- an external prerequisite

The difference is where the wait lives:

- orchestrator wait lives in the main orchestrator surface
- delegated clarification usually lives in the handler thread surface

### 8. Optional Capability Loading Uses Extensions

Optional product knowledge should be loaded as available extensions instead of being injected into
every handler prompt.

The Project CI authoring extension id is `project-ci`.

Prompt-only Git guidance is default-loaded for all actor kinds because ordinary repository work
usually needs git context. Prompt-only GitHub guidance is default-loaded for orchestrators and handler
threads, and available for workflow task agents only when the task objective explicitly requires
GitHub issues, pull requests, review comments, Actions, or other GitHub work.

The orchestrator can preload inherited history or an extension for a delegated objective:

Use `thread_start.threads[].extensions` to apply creation-time handler extension overrides. The exact
Thread Orchestration and Thread Handling APIs live in `docs/specs/extension/thread_managing.extension.spec.md`.

Use `thread_start.threads[].history` only when deviating from the default. The default is
`"forked"`: the handler starts as its own handler actor, then receives product-filtered inherited
orchestrator conversation context before the delegated objective. Use `"isolated"` when durable
files, specs, tests, or the objective itself fully specify the work, when prior chat is noisy, stale,
speculative, or likely to bias an independent review, or when context minimization is materially
more important than inherited discussion.

A handler can load the extension later:

```ts
load_extension({ extensionId: "project-ci" });
```

`load_extension` is a native control tool, not part of the `execute_typescript` generated client
surface.

### 9. Project CI Is A Dedicated Workflow Lane

Project CI remains first-class in product behavior and UI, but it is modeled through declared Smithers runnable entries rather than a separate native execution engine.

That means build, test, lint, typecheck, integration, docs, manual, and repository-specific checks can still have structured CI run and CI check result records while execution stays consistent with the workflow model.

Project CI state is recorded only from terminal output of entries declaring `productKind = "project-ci"` after that output validates against the declared result schema.

No runtime path infers CI from arbitrary workflow output, command names, logs, or final prose.

## Key Guarantees

- Direct tools are the default coding-agent work surface.
- cx prompt-only CLI guidance is part of generated actor context and is the preferred first step for supported code navigation when the cx extension is loaded; agents run official `cx` commands through `exec_command`.
- ordinary repository inspection uses `exec_command` with shell tools such as `rg`, `sed`, `cat`, `ls`, `find`, `git show`, `nl`, and `wc`.
- generated `execute_typescript` extension clients are derived from loaded TypeScript-enabled
  `svvyx` extensions; broad hand-written `api.read`, `api.bash`, and `api.workflow_*` helper
  families, as well as a global `svvy` client, are not part of the resolved model.
- Thread Orchestration controls, Thread Handling controls, `load_extension`, `list_extensions`, and
  `request_user_input` remain `svvy`-native control tools.
- workflow supervision should use Smithers-native bridge tools such as `smithers_run_workflow`, `smithers_get_run`, and `smithers_resolve_approval`.
- the Smithers-native capability set targets product-runtime runnable workflows rather than the repo authoring workspace under `workflows/`.
- capability declarations are actor-specific: the orchestrator gets only orchestrator-callable tools, and handler threads get only handler-callable tools.
- workflow task agents are another actor class below handler threads and should receive only task-local cx CLI instructions, direct tools, and `execute_typescript`, with no ambient pi extension-tool leakage.
- runtime handlers and bridges write durable facts from real execution; agents do not mutate product state through arbitrary write tools.
- generated `extensions["<id>"].run(...)` calls remain nested command facts under a parent
  `execute_typescript` command.
- tool-run summaries stay on command records and artifacts; ordinary handler replies do not emit episodes.
- workflow runs are durable execution records under a handler thread.
- episodes are the main reusable semantic outputs returned to the orchestrator.
