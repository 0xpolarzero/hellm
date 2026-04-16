# Execution Model

This document is a companion to the [PRD](./prd.md).

It describes the intended product-level request flow for `svvy`. It is a behavioral model, not a package layout or implementation call graph.

The adopted model is one shared command system:

```text
tool call -> command -> handler -> events -> structured state -> UI
```

The orchestrator chooses the next tool call inside one runtime model. It does not switch between unrelated engines.

```mermaid
flowchart TD
    subgraph Entry["Entry Surfaces"]
        Desktop["Desktop app session UI"]
        Headless["Headless one-shot or automation input"]
    end

    subgraph Context["Context Load"]
        Load["Load workspace, session, turns, threads, episodes, artifacts, verification, workflow, wait state, AGENTS.md, and .svvy config"]
    end

    subgraph Turn["Turn Lifecycle"]
        OpenTurn["Open turn"]
        Decide["Orchestrator chooses next tool call"]
    end

    subgraph ToolSurface["Top-Level Tool Surface"]
        Generic["execute_typescript"]
        WorkflowStart["workflow.start"]
        WorkflowResume["workflow.resume"]
        Verify["verification.run"]
        Wait["wait"]
    end

    subgraph GenericExec["Generic Execution"]
        Compile["Compile/typecheck snippet against api.* types"]
        Run["Run valid TypeScript program"]
        Api["Injected api.* SDK"]
        ApiRepo["api.repo.*"]
        ApiGit["api.git.*"]
        ApiWeb["api.web.*"]
        ApiArtifact["api.artifact.*"]
        ApiExec["api.exec.run"]
    end

    subgraph Handlers["Runtime Handlers"]
        RuntimeHandler["svvy runtime handles execute_typescript and wait commands"]
        SmithersHandler["Smithers bridge handles workflow commands"]
        VerificationHandler["Verification bridge handles verification commands"]
    end

    subgraph Facts["Durable Facts"]
        Commands["Record command status and parent-child linkage"]
        Events["Append lifecycle events"]
        Artifacts["Persist file-backed artifacts and SQLite path metadata"]
        State["Update turns, threads, episodes, verification records, workflow records, artifacts, and session wait state"]
    end

    subgraph ReadModels["Read Models"]
        Selectors["Build metadata-first selectors and summaries"]
        UI["Render transcript, threads, workflow cards, verification, episodes, artifacts, and wait state"]
    end

    subgraph Loop["Loop Control"]
        More{"Need more work?"}
        Finish["Return final response"]
        Pause["Leave session waiting for resume"]
    end

    Desktop --> Load
    Headless --> Load
    Load --> OpenTurn
    OpenTurn --> Decide

    Decide --> Generic
    Decide --> WorkflowStart
    Decide --> WorkflowResume
    Decide --> Verify
    Decide --> Wait

    Generic --> Compile
    Compile --> Run
    Run --> Api
    Api --> ApiRepo
    Api --> ApiGit
    Api --> ApiWeb
    Api --> ApiArtifact
    Api --> ApiExec
    Api --> RuntimeHandler
    WorkflowStart --> SmithersHandler
    WorkflowResume --> SmithersHandler
    Verify --> VerificationHandler
    Wait --> RuntimeHandler

    RuntimeHandler --> Commands
    SmithersHandler --> Commands
    VerificationHandler --> Commands

    Commands --> Events
    Events --> Artifacts
    Artifacts --> State
    Events --> State
    State --> Selectors
    Selectors --> UI
    UI --> More

    More -->|Yes| Decide
    More -->|Finish| Finish
    More -->|Blocked on user or external input| Pause
```

Key points:

- `execute_typescript` is the default generic work surface.
- The injected SDK is `api.*`.
- `api.exec.run` is allowed as an explicit bounded execution capability.
- `execute_typescript` snippets are compiled or typechecked before runtime execution, and invalid snippets stop at diagnostics instead of running blindly.
- `workflow.start`, `workflow.resume`, `verification.run`, and `wait` remain separate native control tools because they change product-level control flow.
- Artifacts are file-backed, with SQLite metadata and path indexing so durable records can point back to files.
- Hooks may call `execute_typescript`, but hooks do not flatten the control tools into `api.*`.
- Runtime handlers and bridges write durable facts from real execution; the agent does not mutate product state directly through arbitrary write tools.
- Waiting is a shared status in the model, not a fourth execution engine.
