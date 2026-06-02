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
        ThreadStart["thread_start"]
        ListExtensions["list_extensions"]
        LoadExtension["load_extension"]
        ThreadHandoff["thread_handoff"]
        SmithersTools["Smithers-native workflow tools (`smithers_*`)"]
        Wait["wait"]
        DirectReply["Direct reply"]
    end

    subgraph GenericExec["Generic Execution"]
        Compile["Compile or typecheck snippet against api.* types"]
        Run["Run valid TypeScript program"]
        Api["Injected generated TypeScript clients"]
        ApiSvvy["generated svvy clients"]
        ApiExtensions["generated loaded-extension clients"]
    end

    subgraph Runtime["Runtime Handlers"]
        RuntimeHandler["svvy runtime handles execute_typescript, thread_start, load_extension, thread_handoff, and wait"]
        SmithersBridge["Bun-owned Smithers bridge handles Smithers-native workflow tools"]
        ResumeHandler["Runtime resumes the supervising handler thread when a workflow run changes state"]
    end

    subgraph Facts["Durable Facts"]
        Commands["Record commands and parent-child linkage"]
        Events["Append lifecycle events"]
        Artifacts["Persist file-backed artifacts and SQLite metadata"]
        State["Update turns, commands, threads, generated agent context bindings, workflow runs, CI run/check result records, artifacts, wait state, and any episodes emitted by thread_handoff"]
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
    Decide --> ThreadStart
    Decide --> ListExtensions
    Decide --> LoadExtension
    Decide --> ThreadHandoff
    Decide --> SmithersTools
    Decide --> Wait
    Decide --> DirectReply

    Generic --> Compile
    Compile --> Run
    Run --> Api
    Api --> ApiSvvy
    Api --> ApiExtensions
    Api --> RuntimeHandler

    ThreadStart --> RuntimeHandler
    ListExtensions --> RuntimeHandler
    LoadExtension --> RuntimeHandler
    ThreadHandoff --> RuntimeHandler
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
- `thread_start`
- `wait`

It normally does **not** supervise every workflow pause, rerun, and repair step itself.

The orchestrator prompt should know that handler threads can use Smithers workflow tools, but it should not receive the `smithers_*` callable schema in its own generated prompt block.

Instead, it opens a handler thread for that delegated objective.

### 3. A Handler Thread Supervises Workflow Execution

Inside a handler thread, the normal choices are:

- direct reply
- cx CLI guidance through `exec_command` plus direct tools
- `execute_typescript`
- `thread_handoff`
- `list_extensions` and `load_extension`
- `workflow_list_models` when authoring a fresh workflow task-agent configuration
- Smithers-native workflow tools such as `smithers_list_workflows`, `smithers_run_workflow`, `smithers_get_run`, `smithers_explain_run`, and `smithers_resolve_approval`
- `wait`

The workflow runtime capability set should mirror Smithers semantics rather than a svvy-defined `workflow_*` alias layer. Runnable entry discovery belongs to `smithers_list_workflows({ workflowId? })`, which returns each entry's `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, and `launchInputSchema`. Fresh launch and explicit resume belong to the stable `smithers_run_workflow({ workflowId, input, runId? })` tool, with `input` validated against the workflow's real TypeScript or Zod launch schema rather than handwritten prompt prose or repo inspection. Supplying `runId` resumes exactly that run; omitting `runId` requests a fresh launch, never silently resumes, and is rejected when the same handler already owns a nonterminal run with the same `workflowId`. Different `workflowId` values can run concurrently under one handler thread. `workflow_list_models` is the narrow authoring-time exception for provider/model/reasoning discovery; it does not launch, inspect, resume, or supervise workflows. Smithers-native commands are supervision helpers inside the handler-thread lifecycle, not evidence that the repo-root `workflows/` authoring package is the shipped product runtime.

The agent does not get raw Smithers internals, a raw Smithers HTTP client, a raw Smithers MCP server,
or raw Smithers CLI access. It gets `svvy`-registered `smithers_*` tools and, when the Smithers
extension is loaded, actor-scoped `svvyx smithers ...` commands that call the Bun-owned Smithers
bridge.

The handler-thread prompt may know that the orchestrator can delegate and reconcile work, but it should not receive orchestrator-only tool declarations such as `thread_start` unless nested delegation is explicitly adopted later.

The handler thread may:

- reuse a saved runnable entry
- author a short-lived artifact workflow
- import saved definitions, prompts, and components while authoring that workflow
- rerun after repair
- resume after clarification
- stay in normal multi-turn chat for ordinary replies
- call `thread_handoff` when it wants to return control to the orchestrator with a durable episode

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
- do not expose `thread_start`, `thread_handoff`, `wait`, or `smithers_*` to workflow task agents or mention those unavailable controls in their base prompt
- do not load ambient pi built-in tools or workspace-discovered extension tools into workflow task agents
- execute workflow task agents from Smithers' current task root or worktree rather than from the workspace runtime DB root
- preserve structured message history, step boundaries, and usage across retries and hijack handoff instead of flattening task-agent continuation into plain text

Approvals and hijack are not ordinary task-agent tools:

- approval belongs to Smithers workflow controls such as approval nodes or task approval gates
- hijack belongs to Smithers runtime or operator controls around the underlying task agent session

### 5. Workflow State Returns To The Handler Thread, Not The Orchestrator

When a Smithers run:

- completes
- fails
- pauses in an actionable way

the runtime resumes the supervising handler thread with the structured run result.

After a handler thread launches or resumes a Smithers run through the Bun bridge, the runtime parks that handler thread while Smithers executes.

The handler thread then decides what to do next.

The orchestrator only receives delegated handoff results when the handler thread explicitly emits them through `thread_handoff`.

When that happens, `thread_handoff` first records the durable handoff episode and closes the current objective span. The runtime then queues a typed orchestrator notification to reconcile the latest durable handoff instead of waiting for another user-authored orchestrator message.

### 6. Explicit Handoff Episodes

The supervising handler thread may manage:

- multiple workflow runs
- multiple reruns
- multiple clarification cycles
- many ordinary direct chat turns

Ordinary replies inside the thread do not emit episodes and do not close the delegated objective.

When the handler thread wants to hand control back, it calls `thread_handoff`.

Each `thread_handoff` emits one ordered handoff episode and marks the current objective span terminal, while the thread surface itself stays interactive for later follow-up.

If the orchestrator later needs more help from the same delegated context, it should use `thread_resume` to re-engage the completed handler thread for a new active span instead of creating an unrelated replacement thread by default.

That explicit handoff is the default reconciliation unit.

### 7. Waiting Is A Lifecycle Status

`wait` is still a native control tool because wait changes product-level state.

But waiting is not a separate execution subsystem.

Any interactive surface may enter wait when it needs:

- user clarification
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

The orchestrator can preload an extension for a delegated objective:

```ts
thread_start({
  objective: "Define Project CI checks for this repository",
  extensions: {
    "project-ci": "default_loaded",
  },
});
```

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
- generated `execute_typescript` clients are derived from loaded native tools and loaded extensions; broad hand-written `api.read`, `api.bash`, and `api.workflow_*` helper families are not part of the resolved model.
- `thread_start`, `load_extension`, `thread_handoff`, and `wait` remain `svvy`-native control tools.
- workflow supervision should use Smithers-native bridge tools such as `smithers_run_workflow`, `smithers_get_run`, and `smithers_resolve_approval`.
- the Smithers-native capability set targets product-runtime runnable workflows rather than the repo authoring workspace under `workflows/`.
- capability declarations are actor-specific: the orchestrator gets only orchestrator-callable tools, and handler threads get only handler-callable tools.
- workflow task agents are another actor class below handler threads and should receive only task-local cx CLI instructions, direct tools, and `execute_typescript`, with no ambient pi extension-tool leakage.
- runtime handlers and bridges write durable facts from real execution; agents do not mutate product state through arbitrary write tools.
- child `api.*` calls remain nested command facts under a parent `execute_typescript` command.
- tool-run summaries stay on command records and artifacts; ordinary handler replies do not emit episodes.
- workflow runs are durable execution records under a handler thread.
- episodes are the main reusable semantic outputs returned to the orchestrator.
