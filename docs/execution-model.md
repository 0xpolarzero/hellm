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
        LoadState["Load workspace, session, threads, workflow runs, episodes, artifacts, verification, waits, AGENTS.md, and .svvy config"]
    end

    subgraph Surface["Target Surface"]
        OpenTurn["Open turn on the target surface"]
        Decide["Surface decides next action"]
    end

    subgraph Tools["Tool Surface"]
        Generic["execute_typescript"]
        ThreadStart["thread.start"]
        ThreadHandoff["thread.handoff"]
        WorkflowStart["workflow.start"]
        WorkflowResume["workflow.resume"]
        Wait["wait"]
        DirectReply["Direct reply"]
    end

    subgraph GenericExec["Generic Execution"]
        Compile["Compile or typecheck snippet against api.* types"]
        Run["Run valid TypeScript program"]
        Api["Injected api.* SDK"]
        ApiRepo["api.repo.*"]
        ApiGit["api.git.*"]
        ApiWeb["api.web.*"]
        ApiArtifact["api.artifact.*"]
        ApiExec["api.exec.run"]
    end

    subgraph Runtime["Runtime Handlers"]
        RuntimeHandler["svvy runtime handles execute_typescript, thread.start, thread.handoff, and wait"]
        SmithersBridge["Smithers bridge handles workflow.start and workflow.resume"]
        ResumeHandler["Runtime resumes the supervising handler thread when a workflow run changes state"]
    end

    subgraph Facts["Durable Facts"]
        Commands["Record commands and parent-child linkage"]
        Events["Append lifecycle events"]
        Artifacts["Persist file-backed artifacts and SQLite metadata"]
        State["Update turns, commands, threads, workflow runs, verification records, artifacts, wait state, and any episodes emitted by thread.handoff"]
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
    Decide --> ThreadHandoff
    Decide --> WorkflowStart
    Decide --> WorkflowResume
    Decide --> Wait
    Decide --> DirectReply

    Generic --> Compile
    Compile --> Run
    Run --> Api
    Api --> ApiRepo
    Api --> ApiGit
    Api --> ApiWeb
    Api --> ApiArtifact
    Api --> ApiExec
    Api --> RuntimeHandler

    ThreadStart --> RuntimeHandler
    ThreadHandoff --> RuntimeHandler
    WorkflowStart --> SmithersBridge
    WorkflowResume --> SmithersBridge
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
- `execute_typescript`
- `thread.start`
- `wait`

It normally does **not** supervise every workflow pause, rerun, and repair step itself.

Instead, it opens a handler thread for that delegated objective.

### 3. A Handler Thread Supervises Workflow Execution

Inside a handler thread, the normal choices are:

- direct reply
- `execute_typescript`
- `thread.handoff`
- `workflow.start`
- `workflow.resume`
- `wait`

The handler thread may:

- reuse a workflow template
- fill a preset
- author a custom workflow
- rerun after repair
- resume after clarification
- stay in normal multi-turn chat for ordinary replies
- call `thread.handoff` when it wants to return control to the orchestrator with a durable episode

### 4. Workflow State Returns To The Handler Thread, Not The Orchestrator

When a Smithers run:

- completes
- fails
- pauses

the runtime resumes the supervising handler thread with the structured run result.

After `workflow.start` or `workflow.resume`, the runtime parks that handler thread while Smithers executes.

The handler thread then decides what to do next.

The orchestrator only receives delegated handoff results when the handler thread explicitly emits them through `thread.handoff`.

When that happens, the runtime should open an orchestrator turn to reconcile the latest durable handoff instead of waiting for another user-authored orchestrator message.

### 5. Explicit Handoff Episodes

The supervising handler thread may manage:

- multiple workflow runs
- multiple reruns
- multiple clarification cycles
- many ordinary direct chat turns

Ordinary replies inside the thread do not emit episodes and do not close the delegated objective.

When the handler thread wants to hand control back, it calls `thread.handoff`.

Each `thread.handoff` emits one ordered handoff episode and marks the current objective span terminal, while the thread surface itself stays interactive for later follow-up.

That explicit handoff is the default reconciliation unit.

### 6. Waiting Is A Lifecycle Status

`wait` is still a native control tool because wait changes product-level state.

But waiting is not a separate execution subsystem.

Any interactive surface may enter wait when it needs:

- user clarification
- an external prerequisite

The difference is where the wait lives:

- orchestrator wait lives in the main orchestrator surface
- delegated clarification usually lives in the handler thread surface

### 7. Verification Is Workflow-Shaped Execution

Verification remains first-class in product behavior and UI, but it is modeled through workflow templates and presets rather than a separate native execution engine.

That means build, test, lint, and related checks can still have structured verification records and specialized UI, while execution stays consistent with the workflow model.

## Key Guarantees

- `execute_typescript` remains the default generic work surface.
- `api.exec.run` remains the explicit bounded process execution capability inside `execute_typescript`.
- `thread.start`, `thread.handoff`, `workflow.start`, `workflow.resume`, and `wait` remain native control tools.
- `workflow.start` and `workflow.resume` are primarily used inside handler threads.
- runtime handlers and bridges write durable facts from real execution; agents do not mutate product state through arbitrary write tools.
- child `api.*` calls remain nested command facts under a parent `execute_typescript` command.
- tool-run summaries stay on command records and artifacts; ordinary handler replies do not emit episodes.
- workflow runs are durable execution records under a handler thread.
- episodes are the main reusable semantic outputs returned to the orchestrator.
