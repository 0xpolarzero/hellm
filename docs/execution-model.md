# Execution Model

This document is a companion to the [PRD](./prd.md).

It shows the intended product-level request flow for `hellm`. It is a behavioral model, not a package layout or implementation call graph.

```mermaid
flowchart TD
    subgraph Entry["Entry Surfaces"]
        Desktop["Desktop app session UI"]
        Headless["Headless one-shot or structured workflow input"]
    end

    subgraph Context["Context Load"]
        Load["Load workspace, session, threads, episodes, artifacts, verification state, AGENTS.md, and .hellm config"]
    end

    subgraph Routing["Orchestrator Routing"]
        Route["Main orchestrator classifies request and chooses next path"]
    end

    subgraph Direct["Direct Path"]
        DirectStart["Use direct path"]
        DirectChoice{"Best direct execution primitive?"}
        DirectReason["Answer directly or perform a tiny action"]
        DirectCode["Run execute_typescript for typed composition"]
        DirectEpisode["Normalize output into episode and artifacts"]
    end

    subgraph Delegated["Delegated Workflow Path"]
        DelegatedStart["Use delegated path"]
        Preflight["Run repo-local preflight hook when configured"]
        Author["Author short-lived Smithers workflow"]
        WorkflowRun["Execute Smithers workflow with bounded pi-backed agent tasks, execute_typescript steps, approvals, loops, retries, and worktrees"]
        WorkflowState{"Workflow state"}
        Resume["Resume persisted workflow run"]
        Validation["Run repo-local validation hook when configured"]
        WorkflowEpisode["Normalize workflow output into episodes and artifacts"]
    end

    subgraph Verification["Verification Path"]
        VerificationStart["Use verification path"]
        VerificationRun["Run build, test, lint, integration, or manual checks"]
        VerificationEpisode["Normalize verification into episode and artifacts"]
    end

    subgraph Pause["Approval / Clarification Path"]
        PauseStart["Use pause path"]
        Wait["Record waiting state and pause for user approval or clarification"]
        PauseProject["Project waiting state into the desktop UI and structured headless output"]
        ResumeAfterInput["Resume after user input arrives"]
    end

    subgraph Reconcile["Shared Reconciliation"]
        ReconcileState["Reconcile threads, episodes, artifacts, verification, workflow references, and session state"]
        Project["Project updated state into the desktop UI and structured headless output"]
        Done{"Need more work?"}
        Finish["Return final response or leave session ready to resume"]
    end

    Desktop --> Load
    Headless --> Load
    Load --> Route

    Route -->|Direct action| DirectStart
    Route -->|Delegated or subagent work| DelegatedStart
    Route -->|Verification is next| VerificationStart
    Route -->|Approval or clarification needed| PauseStart

    DirectStart --> DirectChoice
    DirectChoice -->|Reasoning is enough| DirectReason
    DirectChoice -->|Typed composition helps| DirectCode
    DirectReason --> DirectEpisode
    DirectCode --> DirectEpisode

    DelegatedStart --> Preflight
    Preflight --> Author
    Author --> WorkflowRun
    WorkflowRun --> WorkflowState
    WorkflowState -->|Waiting approval| Wait
    WorkflowState -->|Interrupted, then resumed| Resume
    Resume --> WorkflowRun
    WorkflowState -->|Reached terminal state| Validation
    Validation --> WorkflowEpisode

    VerificationStart --> VerificationRun
    VerificationRun --> VerificationEpisode

    PauseStart --> Wait
    Wait --> PauseProject
    PauseProject --> ResumeAfterInput
    ResumeAfterInput --> Load

    DirectEpisode --> ReconcileState
    WorkflowEpisode --> ReconcileState
    VerificationEpisode --> ReconcileState

    ReconcileState --> Project
    Project --> Done
    Done -->|Yes| Load
    Done -->|No| Finish
```

Key points:

- `execute_typescript` is an internal primitive inside the direct path and inside Smithers-backed delegated work. It is not a fifth top-level path.
- Repo-local preflight and validation hooks wrap consequential delegated workflows rather than replacing orchestrator routing.
- All meaningful execution paths normalize into episodes and artifacts before reconciliation, which keeps the product model uniform across desktop and headless use.
