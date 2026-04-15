# Structured Session State Spec

## Status

- Date: 2026-04-15
- Status: adopted direction for the next structured session state refactor
- Reference implementation: [POC](../pocs/structured-session-state.poc.ts)

## Purpose

`svvy` needs explicit product state above the `pi` transcript and beside Smithers workflow state.

Without that layer, the product has to keep inferring important facts from raw message history:

- which request is currently being handled
- which visible work items exist
- which tool calls happened
- which work finished
- which work failed
- which work is only waiting on another internal work item
- which work is waiting on the user or an external prerequisite
- what verification happened
- which delegated workflow is in flight
- which durable outputs should be reused on the next turn

This spec defines the adopted structured state model that fixes that problem.

## Scope Of This Spec

This document defines:

- the adopted structured session state model
- the exact concepts covered by that model
- the ownership boundaries for those concepts
- the shape of the POC and its intended SQLite-backed implementation

## Reference Rule

The executable reference for this spec is [docs/pocs/structured-session-state.poc.ts](../pocs/structured-session-state.poc.ts).

If this spec and the POC ever disagree, that is a bug in the spec and should be fixed immediately.

## Adopted Direction

- Keep `pi` as the canonical transcript and runtime substrate.
- Keep Smithers as the canonical delegated workflow execution substrate.
- Add `svvy`-owned structured product state above those substrates.
- Model turns and commands explicitly.
- Treat every tool call as a command.
- Make `execute_typescript` the default generic work surface.
- Keep only a very small set of native control tools for workflow, verification, and wait.
- Remove `external_*` naming from the target architecture.
- Remove arbitrary agent-facing structured-state write tools from the product contract.
- Drive durable facts from real runtime handlers and bridge events, not transcript heuristics.
- Distinguish thread dependency waits from user or external waits.
- Treat whole-session waiting as a derived product state backed by an explicit session wait record.
- Use selectors and metadata-first read models instead of making the UI reconstruct state from storage details.

## Core Modeling Rule

The product should model the durable things that actually affect routing, inspection, recovery, and UI behavior.

That means:

- keep first-class records for turns, threads, commands, episodes, verification runs, workflows, artifacts, and lifecycle events
- do not split every human-readable summary into a large bespoke schema
- keep Smithers internals inside Smithers unless `svvy` truly needs a top-level summary of them
- record low-level work durably, but avoid making every low-level tool call a top-level UI card

## Core Ownership Boundaries

### `pi`

`pi` remains canonical for:

- transcript history
- runtime conversation behavior
- session tree lineage
- provider and runtime substrate behavior

### Smithers

Smithers remains canonical for:

- delegated workflow internals
- workflow nodes, attempts, retries, and internal event history

### `svvy`

`svvy` is canonical for:

- product-level session state
- turns
- visible threads
- command records
- episodes
- verification records
- top-level workflow records
- artifacts
- wait state
- lightweight lifecycle events and selectors

## Adopted Conceptual Model

The adopted conceptual shape is:

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
    createdAt: string;
    updatedAt: string;
  };

  session: {
    id: string;
    wait: null | {
      threadId: string;
      kind: "user" | "external";
      reason: string;
      resumeWhen: string;
      since: string;
    };
  };

  turns: Array<{
    id: string;
    requestSummary: string;
    status: "running" | "waiting" | "completed" | "failed";
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  threads: Array<{
    id: string;
    turnId: string;
    parentThreadId: string | null;
    kind: "task" | "workflow" | "verification";
    title: string;
    objective: string;
    status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    dependsOnThreadIds: string[];
    wait: null | {
      kind: "user" | "external";
      reason: string;
      resumeWhen: string;
      since: string;
    };
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  commands: Array<{
    id: string;
    turnId: string;
    threadId: string;
    parentCommandId: string | null;
    toolName: string;
    executor:
      | "orchestrator"
      | "execute_typescript"
      | "runtime"
      | "smithers"
      | "verification";
    visibility: "trace" | "summary" | "surface";
    status:
      | "requested"
      | "running"
      | "waiting"
      | "succeeded"
      | "failed"
      | "cancelled";
    attempts: number;
    title: string;
    summary: string;
    error: string | null;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  episodes: Array<{
    id: string;
    threadId: string;
    sourceCommandId: string | null;
    kind: "analysis" | "change" | "verification" | "workflow" | "clarification";
    title: string;
    summary: string;
    body: string;
    artifactIds: string[];
    createdAt: string;
  }>;

  verifications: Array<{
    id: string;
    threadId: string;
    commandId: string;
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
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    summary: string;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  artifacts: Array<{
    id: string;
    episodeId: string;
    kind: "text" | "log" | "json" | "file";
    name: string;
    path?: string;
    content?: string;
    createdAt: string;
  }>;

  events: Array<{
    id: string;
    at: string;
    kind: string;
    subject: {
      kind:
        | "session"
        | "turn"
        | "thread"
        | "command"
        | "episode"
        | "verification"
        | "workflow"
        | "artifact";
      id: string;
    };
    data?: Record<string, unknown>;
  }>;
};
```

## Why These Records Exist

### Session

The session record stores product-wide wait state because the product needs an explicit durable answer to one question:

Is the whole active frontier blocked on user or external input?

Everything else that can be derived from collections should stay derived.

### Turn

Turns exist because a user request is a real product boundary.

The system needs a durable answer to:

- which request opened this work
- whether the request is still running
- whether it ended in a final response or a wait state

### Thread

Threads are visible bounded work items.

The product needs a durable answer to:

- what work exists
- what kind of work it is
- whether it is active, failed, complete, or waiting
- whether it is waiting on internal child work or on user or external input

### Command

Commands are the center of the new model.

Every tool call becomes a command record.

This gives the system a durable answer to:

- which tool was called
- who executed it
- whether it started, succeeded, failed, or is waiting
- how commands nest
- which commands are trace-only versus surfaced work

### Episode

Episodes are the durable semantic outputs the orchestrator should reuse.

They exist because the durable output of a work item should not be trapped inside raw transcript text.

### Verification

Verification records exist because verification changes routing and is not just display data.

### Workflow

Workflow records exist because the product needs a top-level durable summary of a delegated Smithers run without copying Smithers internals into `svvy`.

### Artifact

Artifacts exist because generated outputs, logs, and exported details need stable durable handles.

### Event

Events exist as a small append-only lifecycle ledger.

They are not the only source of truth. Current state records remain canonical.

## Cardinality Rules

These rules are adopted for the next structured-state slice:

- one session contains many turns
- one session contains many threads
- one session contains many commands
- one session contains many episodes
- one session contains many verifications
- one session contains many workflow records
- one session contains many artifacts
- one session contains many lifecycle events
- one turn contains many threads
- one turn contains many commands
- one thread contains many commands
- one thread contains many episodes
- one thread contains zero or many verifications
- one workflow record belongs to exactly one workflow thread
- one artifact belongs to exactly one episode

## Session Wait Model

The only adopted session-level field owned by `svvy` in this slice is `session.wait`.

That is intentional.

Everything else that can be derived should stay derived.

### `session.wait`

`session.wait` exists only when:

- progress is blocked on user or external input
- no runnable work remains in the active frontier

It contains:

- `threadId`: the thread responsible for the wait
- `kind`: `user` or `external`
- `reason`: why the session is waiting
- `resumeWhen`: what must happen before the session can continue
- `since`: when the wait started

### Why `session.wait` Is Separate From Thread State

The product must distinguish:

- a thread waiting on another thread
- a thread waiting on user or external input while other work still exists
- the whole session waiting because no runnable work remains

`session.wait` is how the product marks the third case explicitly.

## Turn Model

Turns are the top-level correlation roots for user requests.

### Turn Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable handle for correlation and resume. |
| `requestSummary` | Compact durable description of what the user asked. |
| `status` | Whether the request is still running, waiting, completed, or failed. |
| `startedAt` | Enables ordering and duration reasoning. |
| `updatedAt` | Enables recency-based selectors. |
| `finishedAt` | Marks terminal completion or failure. |

## Thread Model

Threads are the main visible work containers inside a session.

### Thread Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable handle for linking related records and selectors. |
| `turnId` | Links the thread back to the user request that created it. |
| `parentThreadId` | Represents parent-child work structure without inventing role agents. |
| `kind` | Distinguishes ordinary task work, workflow work, and verification work. |
| `title` | Compact label for UI cards and lists. |
| `objective` | Captures what this work item is trying to achieve. |
| `status` | Captures the lifecycle state of the work item. |
| `dependsOnThreadIds` | Represents internal orchestration dependencies. |
| `wait` | Captures user or external wait details for the thread itself. |
| `startedAt` | Enables ordering and duration reasoning. |
| `updatedAt` | Enables recency-based selectors. |
| `finishedAt` | Marks terminal completion, failure, or cancellation. |

### Thread Kind Meaning

`task`

Ordinary orchestrator-owned work in the current session.

`workflow`

A delegated Smithers workflow represented as a visible work item.

`verification`

A visible verification run represented as a work item.

### Thread Dependency Waiting

`dependsOnThreadIds` is the durable representation of internal orchestration waiting.

Use it when:

- a task thread is waiting on a workflow thread
- a task thread is waiting on a verification thread
- a workflow thread is waiting on child work represented as threads

This is not the same as whole-session waiting.

### Thread User Or External Waiting

`thread.wait` represents a real user or external prerequisite tied to that thread.

Use it when:

- the thread needs clarification
- a required input is missing
- an external system or prerequisite must change before the thread can continue

If no runnable work remains, the runtime must also set `session.wait`.

## Command Model

Commands are the universal durable representation of tool calls.

### Command Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable command handle. |
| `turnId` | Links the command to the triggering request. |
| `threadId` | Links the command to the visible work item it belongs to. |
| `parentCommandId` | Represents nested command structure. |
| `toolName` | Names the tool that was called. |
| `executor` | Identifies which runtime component executed the command. |
| `visibility` | Distinguishes trace work from surfaced work. |
| `status` | Captures lifecycle state. |
| `attempts` | Records retry count without requiring a separate attempt table in the first slice. |
| `title` | Compact human-readable label. |
| `summary` | Compact durable explanation of the command's purpose or outcome. |
| `error` | Stores terminal failure text when needed. |
| `startedAt` | Enables ordering and duration reasoning. |
| `updatedAt` | Enables recency-based selectors. |
| `finishedAt` | Marks terminal completion, failure, cancellation, or handoff into wait. |

### Command Visibility

The adopted visibility levels are:

- `trace`
- `summary`
- `surface`

Use them this way:

- low-level repo or web capability calls inside `execute_typescript` are usually `trace`
- generated artifacts or meaningful intermediate outputs may be `summary`
- workflow, verification, and wait commands are normally `surface`

This lets the system record everything durably without turning every file read into a top-level UI object.

### Command Executor

The adopted executor labels are:

- `orchestrator`
- `execute_typescript`
- `runtime`
- `smithers`
- `verification`

These exist so ownership and debugging are explicit.

### Command Status

The adopted statuses are:

- `requested`
- `running`
- `waiting`
- `succeeded`
- `failed`
- `cancelled`

### Command Retry Policy

Retries are handler policy, not model improvisation.

The first slice does not introduce a first-class `command_attempt` table.

Instead:

- the command record persists `attempts`
- lifecycle events should capture retries when they matter
- a later slice may split retries into separate attempt records if the product truly needs that detail

## Episode Model

Episodes are the durable semantic outputs reused by the orchestrator and shown to the user.

### Episode Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable episode handle. |
| `threadId` | Links the episode to the work item that produced it. |
| `sourceCommandId` | Links the episode to the most relevant command when that linkage matters. |
| `kind` | States what sort of outcome the episode represents. |
| `title` | Compact label for lists and cards. |
| `summary` | Short durable digest. |
| `body` | The reusable semantic content. |
| `artifactIds` | Links durable output files and logs. |
| `createdAt` | Orders the episode in the session lifecycle. |

### Episode Kind Meaning

The adopted kinds are:

- `analysis`
- `change`
- `verification`
- `workflow`
- `clarification`

## Verification Model

Verifications are first-class records because verification changes routing and next actions.

### Verification Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable verification handle. |
| `threadId` | Links the verification to the visible work item that owns it. |
| `commandId` | Links the record to the `verification.run` command that produced it. |
| `kind` | Identifies the verification type. |
| `status` | Captures pass, fail, or cancelled outcome. |
| `summary` | Gives the orchestrator and UI a concise outcome summary. |
| `command` | Optionally stores the executed command for rerun and auditability. |
| `startedAt` | Records start time. |
| `finishedAt` | Records finish time. |

### Verification Kind

Verification kind is intentionally open-ended.

The built-in defaults are:

- `build`
- `test`
- `lint`
- `integration`
- `manual`

Any string is allowed because real repositories often have domain-specific checks.

## Workflow Record Model

Workflow records are top-level `svvy` records for delegated Smithers runs.

They are not copies of Smithers internals.

### Workflow Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable local handle. |
| `threadId` | Links the workflow record to its workflow thread. |
| `commandId` | Links the record to the `workflow.start` or `workflow.resume` command that created or resumed it. |
| `smithersRunId` | Canonical link back to Smithers. |
| `workflowName` | Product-visible identifier of the workflow type. |
| `status` | Current top-level workflow status. |
| `summary` | Short top-level summary of the workflow state. |
| `startedAt` | Start time of the workflow record. |
| `updatedAt` | Most recent state transition time. |
| `finishedAt` | Terminal completion, failure, or cancellation time. |

### Workflow Status Semantics

Use workflow status this way:

- `running` while the delegated run is alive and making progress
- `waiting` only when the delegated run itself reaches a durable pause condition
- `completed`, `failed`, or `cancelled` only when the delegated run reaches a terminal outcome

Do not use top-level workflow status to represent every internal milestone join or child wait. That detail remains inside Smithers unless `svvy` truly needs a top-level summary of it.

## Artifact Model

Artifacts are durable outputs referenced by episodes.

### Artifact Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable artifact handle. |
| `episodeId` | Links the artifact to the episode that references it. |
| `kind` | Distinguishes text, log, json, and file outputs. |
| `name` | Human-readable artifact label. |
| `path` | Optional file path when the artifact lives on disk. |
| `content` | Optional inline content for small artifacts and the POC. |
| `createdAt` | Orders artifact creation. |

## Event Model

The event log is a small append-only lifecycle ledger.

Current state records remain canonical.

### Event Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable event handle. |
| `at` | Event timestamp. |
| `kind` | Exact lifecycle transition type. |
| `subject` | Typed pointer to the subject record. |
| `data` | Small optional payload for debugging or selectors. |

### Adopted Event Kinds

The precise list may grow, but the first adopted set is:

- `turn.started`
- `turn.waiting`
- `turn.completed`
- `turn.failed`
- `thread.created`
- `thread.updated`
- `thread.finished`
- `command.requested`
- `command.started`
- `command.waiting`
- `command.finished`
- `episode.created`
- `verification.recorded`
- `workflow.recorded`
- `workflow.updated`
- `artifact.created`
- `session.wait.started`
- `session.wait.cleared`

## Waiting Semantics

Waiting is a shared lifecycle concept, not a separate execution subsystem.

### Internal Dependency Waiting

Use thread dependency waiting when work is blocked only on another visible work item:

- set `thread.status = "waiting"`
- populate `thread.dependsOnThreadIds`
- leave `thread.wait = null`
- do not set `session.wait`

### User Or External Waiting

Use user or external waiting when a real prerequisite outside the active runnable frontier exists:

- set `thread.status = "waiting"`
- populate `thread.wait`
- clear `thread.dependsOnThreadIds`
- set `session.wait` only when no runnable work remains

### Session Wait Rule

`session.wait` must only exist when:

- some thread is waiting on `thread.wait`
- there are no runnable threads left

## Derived Read Model

The POC deliberately distinguishes canonical stored facts from derived selectors.

### Session View

The adopted session summary selector returns:

- `title`
- `sessionStatus`
- `wait`
- `counts`
- `threadIdsByStatus`
- `visibleThreadIds`

### Derived Fields

The following are derived, not stored:

- `sessionStatus`
- counts
- thread status buckets
- visible-thread ordering

### `sessionStatus` Derivation

The current derived rule is:

1. if `session.wait` exists, the session status is `waiting`
2. else if any thread is `running`, the session status is `running`
3. else if any thread is `waiting` with non-empty `dependsOnThreadIds`, the session status is `running`
4. else if the latest updated turn or thread is `failed`, the session status is `error`
5. otherwise the session status is `idle`

### Visibility Rule For UI Reads

The main session UI should primarily read:

- threads
- episodes
- workflow records
- verification records
- artifacts
- session wait state

Commands should be exposed with their `visibility` respected:

- `surface` commands may become visible cards or primary timeline items
- `summary` commands may appear in summaries or inspectors
- `trace` commands should remain drill-down detail by default

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

That means the real schema must scope turn, thread, command, episode, verification, workflow, artifact, and event rows by `session_id`, even though the POC omits repeated `session_id` fields for clarity.

### Recommended Tables

The real first-slice schema should be roughly:

- `workspace`
- `session`
- `turn`
- `thread`
- `command`
- `episode`
- `verification`
- `workflow`
- `artifact`
- `domain_event`

### Recommended Responsibility Of `session`

The `session` table should store:

- `svvy` session identity
- mirrored `pi` session identity
- mirrored session title
- mirrored provider
- mirrored model
- mirrored reasoning effort
- mirrored message count
- mirrored `pi` created time
- mirrored `pi` updated time
- nullable wait thread id
- nullable wait kind
- nullable wait reason
- nullable wait resume condition
- nullable wait since time

The product-facing session status and counts should be derived at read time.

### Recommended Responsibility Of `turn`

The `turn` table should store:

- turn identity
- parent `session_id`
- request summary
- status
- timestamps

### Recommended Responsibility Of `thread`

The `thread` table should store:

- thread identity
- parent `session_id`
- parent `turn_id`
- nullable `parent_thread_id`
- thread kind
- title
- objective
- status
- dependency thread ids
- nullable wait kind
- nullable wait reason
- nullable wait resume condition
- nullable wait since time
- timestamps

### Recommended Responsibility Of `command`

The `command` table should store:

- command identity
- parent `session_id`
- parent `turn_id`
- parent `thread_id`
- nullable `parent_command_id`
- tool name
- executor
- visibility
- status
- attempts
- title
- summary
- nullable error
- timestamps

### Recommended Responsibility Of `episode`

The `episode` table should store:

- episode identity
- parent `session_id`
- parent `thread_id`
- nullable source `command_id`
- kind
- title
- summary
- body
- timestamps

### Recommended Responsibility Of `verification`

The `verification` table should store:

- verification identity
- parent `session_id`
- parent `thread_id`
- source `command_id`
- kind
- status
- summary
- optional command
- timestamps

### Recommended Responsibility Of `workflow`

The `workflow` table should store:

- workflow identity
- parent `session_id`
- parent `thread_id`
- source `command_id`
- Smithers run id
- workflow name
- status
- summary
- timestamps

`thread_id` should be unique in this table for the first slice because each workflow thread should own exactly one top-level workflow record.

### Recommended Responsibility Of `artifact`

The `artifact` table should store:

- artifact identity
- parent `session_id`
- parent `episode_id`
- kind
- name
- nullable path
- nullable inline content for small artifacts
- timestamps

### Recommended Responsibility Of `domain_event`

The `domain_event` table should store:

- event identity
- parent `session_id`
- subject kind
- subject id
- event kind
- timestamp
- optional serialized payload

It should stay intentionally small.

## Write Responsibilities

The agent-facing tool surface is:

- `execute_typescript`
- `workflow.start`
- `workflow.resume`
- `verification.run`
- `wait`

Those tools request actions.

They are not arbitrary state-write tools.

### Runtime-Side Write API

The runtime and bridges should expose internal operations roughly equivalent to:

- `openTurn`
- `finishTurn`
- `createThread`
- `updateThread`
- `setThreadDependencies`
- `setThreadWait`
- `clearThreadWait`
- `setSessionWait`
- `clearSessionWait`
- `createCommand`
- `startCommand`
- `finishCommand`
- `createEpisode`
- `createArtifact`
- `recordVerification`
- `recordWorkflow`
- `updateWorkflow`

The exact method names may change. The ownership boundaries should not.

### Write Ownership Rules

- ordinary task-thread and generic command writes belong to the `svvy` runtime
- workflow thread lifecycle and workflow record writes belong to the Smithers bridge
- verification thread lifecycle and verification record writes belong to the verification bridge
- session wait writes belong to the `svvy` runtime
- no runtime component may synthesize verification, workflow, or wait facts from transcript prose after the fact

### Write-Side Rules

- every tool call must create a command record
- nested capability calls inside `execute_typescript` must create child command records
- `trace` commands must still be durable even if they are not promoted into primary UI surfaces
- a workflow record must only be created from a real Smithers run with a real `smithersRunId`
- a verification record must only be created from a real verification outcome
- a thread may depend on other threads or carry a user or external wait, but it must not carry both at once
- `session.wait` must be cleared when runnable work exists again
- a turn must end in exactly one of: `completed`, `failed`, or `waiting`
- handlers own retry policy; command records should update `attempts` accordingly
- structured writes must come from explicit runtime or bridge events, not prompt text, assistant prose, or transcript heuristics

## Synchronization With `pi`

`pi` remains canonical for transcript history.

Structured state should not depend on transcript replay once structured writes exist.

Transcript replay is not an allowed mechanism for session-summary, navigation, command-state, verification-state, workflow-state, or wait-state updates once structured writes exist for those surfaces.

The mirrored `pi` metadata exists for product querying convenience only.

It does not replace `pi` as the transcript substrate.

## Synchronization With Smithers

Smithers remains canonical for workflow internals.

Structured state should only store the top-level workflow record needed by the top-level `svvy` product model.

That means:

- keep the top-level `smithersRunId`
- keep top-level workflow status and summary
- do not copy Smithers node graphs or attempt details into `svvy` structured state

Workflow records must originate from actual Smithers lifecycle events rather than keyword inference or synthetic placeholder ids.

## Scope Boundaries

### Diff Tracking

Diff tracking requires its own model for:

- whole-session diffs
- per-thread diffs

That model is outside the scope of this spec.

### Transcript Migration

Transcript-only backfill into this structured model is outside the scope of this spec.

### Full Workflow Internals

Smithers node graphs, retry branches, and deep internal workflow provenance are outside the scope of this spec unless a later product requirement proves they belong in `svvy` state rather than only in Smithers inspection surfaces.

## Rollout Guidance

The rollout should be:

1. treat the POC as the executable semantic reference
2. implement the SQLite schema that represents the same facts relationally
3. wire ordinary generic work through command recording around `execute_typescript`
4. wire workflow, verification, and wait handlers to the same command model
5. switch UI selectors to structured reads where available
6. handle diff tracking and deeper artifact or workflow provenance as separate design work

## Sources

### Local Sources

- [PRD](../prd.md)
- [Execution Model](../execution-model.md)
- [Product Features](../features.ts)
- [Structured Session State POC](../pocs/structured-session-state.poc.ts)
