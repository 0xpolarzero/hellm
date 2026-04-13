# Structured Session State Spec

## Status

- Date: 2026-04-14
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
- Use explicit selectors for read models instead of making the UI reconstruct state from storage details.

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

A thread lifecycle status changed.

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

### Waiting State Placement

The waiting explanation is split across two layers for different purposes:

- `thread.blockedReason` explains why a specific thread is blocked
- `session.waitingOn` explains the current whole-session pause condition

## Derived Read Model

The POC deliberately distinguishes canonical stored facts from derived selectors.

### Session View

The adopted session summary selector returns:

- `title`
- `sessionStatus`
- `waitingOn`
- `counts`
- `threadIdsByStatus`

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
3. else if the latest updated thread is `failed`, the session status is `error`
4. otherwise the session status is `idle`

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
- lifecycle timestamps
- owning `session_id`

The first slice stores the nullable thread result columns directly on `thread`.

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
- `updateThread(threadId, status, blockedReason?)`
- `setThreadResult(threadId, kind, summary, body)`
- `recordVerification(threadId, kind, status, summary, command?)`
- `startWorkflow(threadId, smithersRunId, workflowName, summary)`
- `updateWorkflow(workflowId, status, summary)`
- `setWaitingState(sessionId, threadId, reason, resumeWhen)`

### Write-Side Rules

- `setThreadResult` must fail if the thread already has a result
- `startWorkflow` must fail if the thread already has a workflow projection
- `updateThread` must clear `session.waitingOn` if the same thread leaves waiting
- write methods should emit the corresponding lifecycle event

## Recommended Read API

The read side should expose operations equivalent to the POC:

- `getSessionView(sessionId)`
- `listThreads(sessionId)`
- `getThreadDetail(threadId)`

## Synchronization With `pi`

`pi` remains canonical for transcript history.

Structured state should not depend on transcript replay once structured writes exist.

The `pi` metadata mirrored in the structured state exists for product querying convenience only.

It does not replace `pi` as the transcript substrate.

The mirrored `pi.status` field visible in the POC must not become a second independent source of truth.

The product-facing session status remains the derived structured-state view described earlier in this spec.

## Synchronization With Smithers

Smithers remains canonical for workflow internals.

The structured state should only store the minimal workflow projection needed by the top-level `svvy` product model.

That means:

- keep the top-level `smithersRunId`
- keep top-level projected workflow status and summary
- do not copy Smithers node graphs or attempt details into `svvy` structured state

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
