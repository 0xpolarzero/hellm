# Execution Model

This document is a companion to the [PRD](./prd.md).

It shows the intended product-level request flow for `svvy`. It is a behavioral model, not a package layout or implementation call graph.

The adopted model is one shared command system:

```text
tool call -> command -> handler -> events -> structured state -> UI
```

The orchestrator does not switch between four unrelated engines. It chooses the next tool call inside one runtime model.

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

    subgraph Tools["Tool Surface"]
        Generic["execute_typescript"]
        Workflow["workflow.start / workflow.resume"]
        Verify["verification.run"]
        Wait["wait"]
    end

    subgraph GenericExec["Generic Execution"]
        GenericTools["Typed tools.* capability calls: repo, git, web, artifact, and related helpers"]
    end

    subgraph Handlers["Runtime Handlers"]
        RuntimeHandler["svvy runtime handles generic and wait commands"]
        SmithersHandler["Smithers bridge handles workflow commands"]
        VerificationHandler["Verification bridge handles verification commands"]
    end

    subgraph Facts["Durable Facts"]
        Commands["Record command status and parent-child linkage"]
        Events["Append lifecycle events"]
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
    Decide --> Workflow
    Decide --> Verify
    Decide --> Wait

    Generic --> GenericTools
    GenericTools --> RuntimeHandler
    Workflow --> SmithersHandler
    Verify --> VerificationHandler
    Wait --> RuntimeHandler

    RuntimeHandler --> Commands
    SmithersHandler --> Commands
    VerificationHandler --> Commands

    Commands --> Events
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
- `workflow.start`, `workflow.resume`, `verification.run`, and `wait` are native control tools, but they are still just tool calls.
- Generic capability access inside `execute_typescript` uses typed `tools.*` namespaces rather than flat `external_*` globals.
- Runtime handlers and bridges write durable facts from real execution; the agent does not mutate product state directly through arbitrary write tools.
- Waiting is a shared status in the model, not a fourth execution engine.
