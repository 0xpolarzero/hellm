# Structured Session State Spec

## Status

- Date: 2026-04-15
- Status: adopted direction for the first structured session state implementation slice
- Reference implementation: [POC](../pocs/structured-session-state.poc.ts)

## Purpose

`svvy` needs explicit product state above the `pi` transcript and beside Smithers workflow state.

Without that layer, the product has to keep inferring important facts from raw message history:

- what workstreams exist
- what each workstream is trying to do
- what finished
- what failed
- what is waiting on the user
- what verification happened
- what delegated workflow is in flight

This spec defines the first adopted structured state model that fixes that problem.

## Scope Of This Spec

This document defines:

- the first adopted structured session state model
- the exact concepts covered by this model
- how the POC maps to the real SQLite-backed implementation

## Reference Rule

The executable reference for this spec is [docs/pocs/structured-session-state.poc.ts](../pocs/structured-session-state.poc.ts).

If this spec and the POC ever disagree, that is a bug in the spec and should be fixed immediately.

## Adopted Direction

- Keep `pi` as the canonical transcript and runtime substrate.
- Keep Smithers as the canonical delegated workflow execution substrate.
- Add `svvy`-owned structured product state above those substrates.
- Keep the first slice intentionally small.
- Use one workspace-scoped SQLite database in the real implementation.
- Use a small append-only domain event log for meaningful lifecycle transitions.
- Drive structured writes from explicit runtime or tool events rather than prompt-text or transcript heuristics.
- Expose the write path as explicit structured-state tool calls owned by the orchestrator or the relevant runtime integration.
- Distinguish thread-level dependency blocking from whole-session waiting.
- Use explicit selectors for read models instead of making the UI reconstruct state from storage details.
- Treat session-summary and sidebar projections as the primary read model for list and navigation surfaces.

## Modeling Principle

The main consumer of a thread result is the orchestrator agent, not a brittle string parser and not a rigid UI-only schema.

The modeling rule for this spec is:

- fields that enable deterministic querying, filtering, ordering, linking, or routing should exist
- fields that merely split human-readable semantic output into many subfields should usually not exist

This spec therefore uses one strong `thread.result` object as the durable semantic output of a thread.

## Core Ownership Boundaries

### `pi`

`pi` remains canonical for:

- transcript history
- runtime conversation behavior
- session tree lineage
- provider/runtime substrate behavior

### Smithers

Smithers remains canonical for:

- delegated workflow internals
- workflow nodes, attempts, retries, and internal event history

### `svvy`

`svvy` is canonical for:

- product-level threads
- per-thread durable results
- verification records
- top-level workflow projection
- session waiting state
- lightweight domain lifecycle events

## First-Slice Product Model

The adopted first-slice conceptual shape is:

```ts
type StructuredSessionState = {
  workspace: {
    id: string;
    label: string;
    cwd: string;
  };

  pi: {
    sessionId: string;
    title: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    messageCount: number;
    status: "idle" | "running" | "waiting" | "error";
    createdAt: string;
    updatedAt: string;
  };

  session: {
    waitingOn: null | {
      threadId: string;
      reason: string;
      resumeWhen: string;
      since: string;
    };
  };

  threads: Array<{
    id: string;
    kind: "direct" | "verification" | "workflow";
    objective: string;
    status: "running" | "completed" | "failed" | "waiting";
    result: null | {
      kind:
        | "analysis-summary"
        | "change-summary"
        | "verification-summary"
        | "workflow-summary"
        | "clarification-summary";
      summary: string;
      body: string;
      createdAt: string;
    };
    blockedReason: string | null;
    blockedOn:
      | null
      | {
          kind: "threads";
          threadIds: string[];
          waitPolicy: "all" | "any";
          reason: string;
          since: string;
        }
      | {
          kind: "user" | "external";
          reason: string;
          resumeWhen: string;
          since: string;
        };
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  verifications: Array<{
    id: string;
    threadId: string;
    kind: "build" | "test" | "lint" | "integration" | "manual" | string;
    status: "passed" | "failed" | "cancelled";
    summary: string;
    command?: string;
    startedAt: string;
    finishedAt: string;
  }>;

  workflows: Array<{
    id: string;
    threadId: string;
    smithersRunId: string;
    workflowName: string;
    status: "running" | "completed" | "failed" | "waiting";
    summary: string;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  events: Array<{
    id: string;
    at: string;
    kind:
      | "thread-started"
      | "thread-status-changed"
      | "thread-result-created"
      | "verification-finished"
      | "workflow-started"
      | "workflow-status-changed"
      | "session-waiting-started"
      | "session-waiting-ended";
    threadId?: string;
  }>;
};
```

## Cardinality Rules

These rules are adopted for the first slice:

- one session contains many threads
- one session contains many verifications
- one session contains many workflow projections
- one session contains many lifecycle events
- one thread has zero or one durable result
- one thread has zero or many verifications
- one thread has zero or one workflow projection
- one workflow projection belongs to exactly one thread
- one verification belongs to exactly one thread

## Session-Level State

The only adopted session-level field owned by `svvy` in this slice is `waitingOn`.

That is intentional.

Everything else that can be derived from the record collections should stay derived.

### `session.waitingOn`

`waitingOn` exists because it captures a whole-session pause condition that the product needs to resume explicitly.

It is intentionally narrower than `thread.blockedOn`.

`session.waitingOn` should only exist when no runnable work remains and progress requires user or external input.

Waiting on child threads or parallel work is not a session-level wait.

It contains:

- `threadId`: which thread is responsible for the pause
- `reason`: why the session is waiting
- `resumeWhen`: what must happen before the session can continue
- `since`: when the waiting state started

### Why There Are No Other Session Fields

Other session-level views should be derived from the thread, verification, workflow, and event records rather than persisted as separate shortcuts.

## Thread Model

Threads are the main durable work containers inside a session.

Each thread answers one question:

What bounded workstream exists here?

### Thread Fields

| Field           | Why it exists                                                                 |
| --------------- | ----------------------------------------------------------------------------- |
| `id`            | Stable handle for linking related records and selectors.                      |
| `kind`          | Distinguishes direct work, verification work, and delegated workflow work.    |
| `objective`     | Captures what this workstream is trying to achieve.                           |
| `status`        | Captures the current lifecycle state of the workstream.                       |
| `result`        | Holds the single durable semantic result for the thread, if one exists.       |
| `blockedReason` | Explains why the thread is blocked, waiting, or otherwise unable to continue. |
| `blockedOn`     | Captures the structured cause of a block, including thread joins and external pauses. |
| `startedAt`     | Allows ordering and duration reasoning.                                       |
| `updatedAt`     | Allows recency-based selectors and status derivation.                         |
| `finishedAt`    | Marks terminal completion or failure time.                                    |

### Thread Kind Meaning

`direct`

The orchestrator is doing the work directly in the main path.

`verification`

The workstream exists to run and interpret verification as first-class product state.

`workflow`

The workstream exists to project a top-level delegated Smithers workflow into the session model.

### `thread.blockedOn`

`blockedOn` captures why a thread cannot currently advance.

The adopted first-slice blocked causes are:

- `threads`
- `user`
- `external`

`blockedOn.kind = "threads"`

This means the thread is waiting for one or more other threads to finish or unblock.

This is how the orchestrator waits on delegated work or parallel subwork without turning the whole session into a user-facing waiting state.

It contains:

- `threadIds`: the child or sibling threads this thread depends on
- `waitPolicy`: whether all listed threads must finish or whether any one of them is enough
- `reason`: a concise human-readable explanation
- `since`: when the dependency wait began

`blockedOn.kind = "user" | "external"`

This means the thread is blocked on a prerequisite outside the active runnable frontier.

It contains:

- `reason`: why the thread is blocked
- `resumeWhen`: what must happen before the thread can continue
- `since`: when that blocked state began

### Waiting And Blocking Placement

The blocked explanation is intentionally split across two layers:

- `thread.blockedReason` is a compact digest for list rows, status badges, and quick reading
- `thread.blockedOn` is the durable structured cause of the block
- `session.waitingOn` is the explicit whole-session pause condition

That split allows the product to represent internal orchestration waits without falsely telling the user the whole session is paused.

## Thread Result Model

The PRD talks about durable reusable output.

For the first structured-state slice, that concept is implemented as exactly one `thread.result` object per thread.

### Why One Result Per Thread

One result per thread is the smallest model that matches the current product need:

- the orchestrator needs one durable semantic result to consume
- the UI needs one durable semantic result to inspect
- multiple durable outputs per thread add complexity immediately

### Result Fields

| Field       | Why it exists                                                      |
| ----------- | ------------------------------------------------------------------ |
| `kind`      | States what kind of final result the thread produced.              |
| `summary`   | Short human-readable digest for lists and quick review.            |
| `body`      | The actual durable semantic content the orchestrator will consume. |
| `createdAt` | Orders result creation relative to the rest of the lifecycle.      |

### Result Kind Meaning

The adopted result kinds are:

- `analysis-summary`
- `change-summary`
- `verification-summary`
- `workflow-summary`
- `clarification-summary`

These are intentionally different from `ThreadKind`.

`ThreadKind` answers what the workstream is.

`ThreadResultKind` answers what kind of final result that workstream produced.

## Verification Model

Verifications are first-class records because verification changes routing and next actions.

### Verification Fields

| Field        | Why it exists                                                                     |
| ------------ | --------------------------------------------------------------------------------- |
| `id`         | Stable handle for repeated verification runs.                                     |
| `threadId`   | Links the verification to the workstream that triggered it.                       |
| `kind`       | Identifies the verification type.                                                 |
| `status`     | Captures pass/fail/cancelled outcome in machine-readable form.                    |
| `summary`    | Gives the orchestrator and UI a concise outcome summary.                          |
| `command`    | Optionally preserves the executed command for auditability and rerun affordances. |
| `startedAt`  | Records when the verification started.                                            |
| `finishedAt` | Records when the verification finished.                                           |

### Verification Kind

Verification kind is intentionally open-ended.

The built-in defaults are:

- `build`
- `test`
- `lint`
- `integration`
- `manual`

But any string is allowed because real repositories often have domain-specific checks.

## Workflow Projection Model

Workflows in structured session state are top-level product projections of delegated Smithers runs.

They are not copies of Smithers internals.

In the adopted product direction, those delegated Smithers runs are milestone-based by default rather than loose todo lists.

The orchestrator is responsible for authoring the milestone graph.

Each milestone must have:

- a milestone objective
- explicit completion criteria
- one or more bounded agent tasks
- a verification boundary that must run before the next milestone unlocks

### Workflow Fields

| Field           | Why it exists                                                |
| --------------- | ------------------------------------------------------------ |
| `id`            | Stable local handle.                                         |
| `threadId`      | Links the projection to its parent workflow thread.          |
| `smithersRunId` | Canonical link back to the Smithers run.                     |
| `workflowName`  | Product-visible identifier of the delegated run type.        |
| `status`        | Current projected workflow state.                            |
| `summary`       | Short top-level explanation of the workflow state.           |
| `startedAt`     | Start time of the projected run.                             |
| `updatedAt`     | Most recent state transition time.                           |
| `finishedAt`    | Terminal completion or failure time if the workflow is done. |

### Cardinality Rule

Only one workflow projection is allowed per thread in this slice.

That rule should be enforced by the write API and by the real database schema.

### Workflow Authoring And Execution Rules

These rules are adopted for the first slice even though Smithers remains canonical for workflow internals:

- the orchestrator must author delegated workflows as milestone graphs rather than loose todo plans
- same-branch execution is the default for milestone tasks
- worktree isolation is an exception that requires an explicit orchestrator decision
- parallel milestone tasks must have explicit ownership or write-scope boundaries
- same-branch milestone tasks must assume peer edits on the current branch and must not revert unrelated changes
- milestone joins must be represented as real dependency barriers before verification begins
- milestone verification must finish before the next milestone unlocks
- if milestone verification fails, the current milestone remains open and remediation must be scheduled before progress continues
- Smithers hot reload may evolve the workflow graph during execution, but only the orchestrator may decide those graph mutations

### Workflow Status Semantics

`workflow.status` and the owning thread status are related but not identical.

Use them this way:

- keep `workflow.status = "running"` while the delegated workflow is alive and only waiting on internal milestone tasks or milestone verification joins
- use `thread.blockedOn.kind = "threads"` on the owning thread to represent those internal joins
- use `workflow.status = "waiting"` only when the Smithers run itself reaches a durable user or external pause condition
- keep the workflow summary updated so the active milestone or active verification gate is legible even though milestone internals stay in Smithers

This split is required so the product does not falsely report a durable paused workflow when the workflow is merely coordinating in-flight parallel work on the current branch.

## Domain Event Model

The event log is a small append-only lifecycle log.

It is not the canonical source of truth.

The normalized state records remain canonical.

### Event Fields

| Field      | Why it exists                                                |
| ---------- | ------------------------------------------------------------ |
| `id`       | Stable event handle.                                         |
| `at`       | Event timestamp.                                             |
| `kind`     | Exact lifecycle transition type.                             |
| `threadId` | Optional thread linkage for filtering and timeline grouping. |

### Event Kinds

The adopted event kinds are:

- `thread-started`
- `thread-status-changed`
- `thread-result-created`
- `verification-finished`
- `workflow-started`
- `workflow-status-changed`
- `session-waiting-started`
- `session-waiting-ended`

### Event Semantics

`thread-started`

A new thread record was created.

`thread-status-changed`

A thread lifecycle status changed, or its structured blocked-on cause changed in a meaningful way.

`thread-result-created`

The thread received its durable result.

`verification-finished`

A verification run completed with a final outcome.

`workflow-started`

A workflow projection was created for a delegated Smithers run.

`workflow-status-changed`

A workflow projection changed lifecycle status.

`session-waiting-started`

The whole session entered a waiting state.

`session-waiting-ended`

The whole session left a waiting state.

## Waiting Semantics

Waiting is a real product state, not an approval object.

The session may enter waiting when the current work cannot continue without clarification or an external prerequisite.

The PRD-aligned triggers are:

- the user must make a product choice
- the next action is ambiguous
- required information is missing
- an external prerequisite is missing
- a delegated workflow paused on a resumable waiting condition

Waiting on child threads or parallel subwork does not satisfy those triggers.

### Waiting State Placement

Use the layers this way:

- set `thread.blockedOn.kind = "threads"` when a thread is waiting on child threads or parallel subwork
- set `thread.blockedOn.kind = "user" | "external"` when a specific thread is blocked on a real prerequisite
- set `session.waitingOn` only when that user or external prerequisite blocks the whole active frontier

That means:

- a thread may be `waiting` while the session remains `running`
- a session should become `waiting` only when there is no runnable work left

## Derived Read Model

The POC deliberately distinguishes canonical stored facts from derived selectors.

### Session View

The adopted session summary selector returns:

- `title`
- `sessionStatus`
- `waitingOn`
- `counts`
- `threadIdsByStatus`

### Session Summary / Sidebar Projection

The session summary used by sidebar and navigation surfaces is the canonical metadata-first read shape for this slice.

It should be maintained incrementally from structured writes and must not be rebuilt by opening full session context or replaying transcript history.

The projection is allowed to expose the fields the product needs for compact lists, including title, preview, status, counts, and recency metadata.

### Derived Fields

The following are derived, not stored:

- `sessionStatus`
- `counts.threads`
- `counts.results`
- `counts.verifications`
- `counts.workflows`
- `counts.events`
- `threadIdsByStatus`

### `sessionStatus` Derivation

The current derived rule is:

1. if `session.waitingOn` exists, the session status is `waiting`
2. else if any thread is `running`, the session status is `running`
3. else if any thread is `waiting` with `blockedOn.kind = "threads"`, the session status is `running`
4. else if the latest updated thread is `failed`, the session status is `error`
5. otherwise the session status is `idle`

### Thread List

Thread list selectors should return thread records directly.

### Thread Detail

Thread detail selectors may return a composed read shape containing:

- the thread record itself
- the verification records linked to that thread
- the optional workflow record linked to that thread

## Real Storage Shape

The POC uses one JSON file because that is the smallest executable proof.

The real implementation should use one workspace-scoped SQLite database.

### Why Workspace-Scoped SQLite

- the product already supports multiple sessions inside one workspace
- SQLite is a good fit for a small local durable product overlay
- the read patterns are query-oriented rather than transcript-oriented
- the state should survive restarts without replaying chat history

### Session Scoping Rule

The POC models one session at a time.

The real database must be multi-session aware.

That means the real schema must scope thread, verification, workflow, and event rows by `session_id`, even though the POC omits that field for clarity.

### Recommended Tables

The real first-slice schema should be roughly:

- `workspace`
- `session`
- `thread`
- `verification`
- `workflow`
- `domain_event`

### Recommended Responsibility Of `workspace`

The `workspace` table should store:

- workspace identity
- workspace label
- workspace cwd

Workspace metadata must be derived from the actual runtime workspace, not hardcoded to a developer-specific local path.

### Recommended Responsibility Of `session`

The `session` table should store:

- `pi` session identity
- mirrored session title
- mirrored provider
- mirrored model
- mirrored reasoning effort
- mirrored message count
- mirrored `pi` created time
- mirrored `pi` updated time
- nullable `waiting_on_thread_id`
- nullable waiting reason
- nullable waiting resume condition
- nullable waiting since time

The product-facing session status, counts, and thread status buckets should be derived from the structured state model at read time.

### Recommended Responsibility Of `thread`

The `thread` table should store:

- thread identity
- thread kind
- thread objective
- thread status
- nullable result kind
- nullable result summary
- nullable result body
- nullable result created time
- blocked reason
- nullable blocked kind
- nullable blocked thread ids
- nullable blocked wait policy
- nullable blocked resume condition
- nullable blocked since time
- lifecycle timestamps
- owning `session_id`

The first slice stores the nullable thread result columns and blocked-on columns directly on `thread`.

### Recommended Responsibility Of `verification`

The `verification` table should store:

- verification identity
- parent `thread_id`
- parent `session_id`
- kind
- status
- summary
- optional command
- timestamps

### Recommended Responsibility Of `workflow`

The `workflow` table should store:

- workflow identity
- parent `thread_id`
- parent `session_id`
- Smithers run id
- workflow name
- status
- summary
- timestamps

`thread_id` should be unique in this table for the first slice, because each thread may have at most one workflow projection.

### Recommended Responsibility Of `domain_event`

The `domain_event` table should store:

- event identity
- parent `session_id`
- optional `thread_id`
- event kind
- timestamp

It should stay intentionally small.

## Recommended Write API

The write side should expose operations equivalent to the POC:

- `startThread(sessionId, kind, objective)`
- `updateThread(threadId, status, blockedReason?, blockedOn?)`
- `setThreadResult(threadId, kind, summary, body)`
- `recordVerification(threadId, kind, status, summary, command?)`
- `startWorkflow(threadId, smithersRunId, workflowName, summary)`
- `updateWorkflow(workflowId, status, summary)`
- `setWaitingState(sessionId, threadId, reason, resumeWhen)`

In the real product, these writes should be surfaced as Bun-side structured-state tool calls rather than hidden transcript-side conventions.

The intended ownership is:

- the orchestrator calls `startThread`, `updateThread`, `setThreadResult`, and `setWaitingState` for top-level direct, delegated, and dependency-blocking lifecycle transitions
- the verification runner or verification tool bridge calls `recordVerification` when a real verification run finishes
- the Smithers bridge calls `startWorkflow` and `updateWorkflow` from actual Smithers lifecycle events
- no caller is allowed to synthesize these writes from prompt keywords, assistant prose, or transcript review after the fact

### Write-Side Rules

- `setThreadResult` must fail if the thread already has a result
- `startWorkflow` must fail if the thread already has a workflow projection
- `updateThread` must clear `session.waitingOn` if the same thread leaves waiting
- `recordVerification` must only be called for a real verification run outcome
- `startWorkflow` must only be called when a real Smithers run starts and must use the real `smithersRunId`
- `startWorkflow` should describe the initial milestone or gate in its summary so the workflow starts from legible progress state
- `setWaitingState` must only be called when no runnable work remains and the pause is caused by a user or external prerequisite
- waiting on child threads must stay in `thread.blockedOn.kind = "threads"` and must not set `session.waitingOn`
- internal milestone joins and milestone verification barriers must keep the workflow projection `running` unless Smithers itself reports a durable pause
- `updateWorkflow` should be called at milestone transitions, milestone verification boundaries, remediation loops, and durable pauses so the current milestone state stays visible
- same-branch parallel milestone tasks must be dispatched with explicit ownership or write-scope boundaries
- same-branch parallel milestone tasks must be prompted to tolerate peer edits on the current branch and never revert unrelated changes
- worktree isolation should only be requested when the orchestrator has decided same-branch execution is too risky
- workflow hot reload must be initiated by orchestrator policy after milestone evidence or verification results, not by prompt-keyword inference or autonomous worker self-redirection
- structured writes must come from explicit runtime or tool events, not prompt text, assistant prose, or transcript heuristics
- write methods should emit the corresponding lifecycle event

## Recommended Read API

The read side should expose operations equivalent to the POC:

- `getSessionView(sessionId)`
- `listThreads(sessionId)`
- `getThreadDetail(threadId)`

## Synchronization With `pi`

`pi` remains canonical for transcript history.

Structured state should not depend on transcript replay once structured writes exist.
Transcript replay is not an allowed mechanism for session-summary or list-view updates once structured writes exist for those surfaces.

The `pi` metadata mirrored in the structured state exists for product querying convenience only.

It does not replace `pi` as the transcript substrate.

The mirrored `pi.status` field visible in the POC must not become a second independent source of truth.

The product-facing session status remains the derived structured-state view described earlier in this spec.

Prompt text and transcript content may help the orchestrator decide what to do, but they are not admissible evidence for writing verification, workflow, or waiting lifecycle facts into structured state.

## Synchronization With Smithers

Smithers remains canonical for workflow internals.

The structured state should only store the minimal workflow projection needed by the top-level `svvy` product model.

That means:

- keep the top-level `smithersRunId`
- keep top-level projected workflow status and summary
- do not copy Smithers node graphs or attempt details into `svvy` structured state

Structured workflow projection writes must originate from actual Smithers lifecycle events rather than keyword inference or synthetic placeholder ids.

The milestone graph, internal agent tasks, and hot-reload mutations remain Smithers-owned internals in this slice.

`svvy` structured state only stores the top-level workflow projection and the thread-level blocking facts needed to make milestone progress and durable pauses legible in the product.

## Scope Boundaries

### Diff Tracking

Diff tracking requires its own model for:

- whole-session diffs
- per-thread diffs

That model is outside the scope of this spec.

A checkpoint or snapshot model, likely git-backed and paired with worktree isolation when precise per-thread attribution matters, is the direction to investigate separately.

### Artifact And File Modeling

Artifact and file modeling is outside the scope of this spec.

### Legacy Transcript Backfill

Transcript-only session migration into this structured model is outside the scope of this spec.

## Rollout Guidance

The rollout should be:

1. treat the POC as the executable semantic reference
2. implement the SQLite schema that represents the same facts relationally
3. wire new direct work, verification, workflow, and waiting flows to structured writes
4. switch UI selectors to structured reads where available
5. handle diff tracking and artifact/file modeling as separate design work

## Sources

### Local Sources

- [PRD](../prd.md)
- [Execution Model](../execution-model.md)
- [Product Features](../features.ts)
- [Structured Session State POC](../pocs/structured-session-state.poc.ts)
