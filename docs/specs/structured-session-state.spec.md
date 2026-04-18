# Structured Session State Spec

## Status

- Date: 2026-04-18
- Status: adopted direction for the structured session state model
- Reference implementation: [POC](../pocs/structured-session-state.poc.ts)

## Purpose

`svvy` needs explicit product state above pi transcript state and beside Smithers workflow state.

Without that layer, the product has to keep inferring important facts from raw message history or transcript replay:

- which interactive surfaces exist in a session
- which delegated handler threads exist and what objective each owns
- which workflow runs happened under each handler thread
- which tool calls happened
- which work finished
- which work failed
- which work is waiting on the user or an external prerequisite
- which durable outputs should be reused on the next turn

This spec defines the adopted structured state model that fixes that problem.

## Scope Of This Spec

This document defines:

- the adopted structured session state model
- the exact concepts covered by that model
- the ownership boundaries for those concepts
- the shape of the reference POC and its intended SQLite-backed implementation

## Reference Rule

The executable reference sketch for this spec is [docs/pocs/structured-session-state.poc.ts](../pocs/structured-session-state.poc.ts).

The spec is canonical for product behavior and storage semantics.

If this spec and the POC ever disagree, the POC should be reconciled to the spec rather than narrowing the spec to match a stale sketch.

## Adopted Direction

- Keep `pi` as the canonical transcript and runtime substrate for the main orchestrator surface and delegated handler thread surfaces.
- Keep Smithers as the canonical workflow execution substrate.
- Add `svvy`-owned structured product state above those substrates.
- Model turns, handler threads, workflow runs, commands, episodes, artifacts, verification, and waits explicitly.
- Treat every tool call as a `CommandRecord`.
- Make `execute_typescript` the default generic work surface.
- Treat every top-level `execute_typescript` invocation as one parent command record and every nested `api.*` call as a child command record.
- Keep only a very small set of native control tools for thread spawning, workflow control, and wait.
- Drive durable facts from real runtime handlers and bridge events, not transcript heuristics.
- Keep workflow-run state separate from handler-thread state.
- Treat a handler thread as one delegated objective that may supervise many workflow runs over its lifetime.
- Treat the handler thread's final terminal episode as the normal semantic handoff back to the orchestrator.
- Do not model internal workflow pauses as separate episodes.
- Use selectors and metadata-first read models instead of making the UI reconstruct state from storage details or transcripts.

## Core Modeling Rule

The product should model the durable things that actually affect routing, inspection, recovery, and UI behavior.

That means:

- keep first-class records for turns, threads, workflow runs, commands, episodes, verification runs, artifacts, and lifecycle events
- keep file-backed artifact metadata and path indexes alongside those records
- do not split every human-readable summary into a large bespoke schema
- keep Smithers internals inside Smithers unless `svvy` truly needs a top-level summary of them
- record low-level work durably, but avoid making every low-level tool call a top-level UI card

## Core Ownership Boundaries

### `pi`

`pi` remains canonical for:

- transcript history
- runtime conversation behavior
- session and sub-session lineage
- provider and runtime substrate behavior

### Smithers

Smithers remains canonical for:

- workflow execution internals
- workflow nodes, attempts, retries, and internal event history
- durable workflow resume mechanics

### `svvy`

`svvy` is canonical for:

- product-level session state
- orchestrator and handler-thread projection
- turns and handler-thread records
- workflow-run records projected into the session model
- command records
- final episodes
- verification records
- artifacts and artifact indexes
- session summary read models and selectors
- wait state and lifecycle selectors

## Adopted Conceptual Model

The adopted conceptual shape is:

```ts
type StructuredSessionState = {
  workspace: {
    id: string;
    label: string;
    cwd: string;
    artifactDir: string;
  };

  session: {
    id: string;
    orchestratorPiSessionId: string;
    wait: null | {
      owner: { kind: "orchestrator" } | { kind: "thread"; threadId: string };
      kind: "user" | "external";
      reason: string;
      resumeWhen: string;
      since: string;
    };
  };

  turns: Array<{
    id: string;
    surfacePiSessionId: string;
    threadId: string | null;
    requestSummary: string;
    status: "running" | "waiting" | "completed" | "failed";
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  threads: Array<{
    id: string;
    parentThreadId: string | null;
    surfacePiSessionId: string;
    title: string;
    objective: string;
    status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    wait: null | {
      kind: "user" | "external";
      reason: string;
      resumeWhen: string;
      since: string;
    };
    worktree?: string;
    latestWorkflowRunId: string | null;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  workflowRuns: Array<{
    id: string;
    threadId: string;
    smithersRunId: string;
    workflowName: string;
    templateId: string | null;
    presetId: string | null;
    status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    summary: string;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  commands: Array<{
    id: string;
    turnId: string;
    surfacePiSessionId: string;
    threadId: string | null;
    workflowRunId: string | null;
    parentCommandId: string | null;
    toolName: string;
    executor:
      | "orchestrator"
      | "handler"
      | "execute_typescript"
      | "runtime"
      | "smithers";
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
    facts: Record<string, unknown> | null;
    error: string | null;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  episodes: Array<{
    id: string;
    threadId: string | null;
    sourceCommandId: string | null;
    title: string;
    summary: string;
    body: string;
    createdAt: string;
  }>;

  verifications: Array<{
    id: string;
    threadId: string;
    workflowRunId: string;
    kind: string;
    status: "passed" | "failed" | "cancelled";
    summary: string;
    startedAt: string;
    finishedAt: string;
  }>;

  artifacts: Array<{
    id: string;
    threadId: string | null;
    workflowRunId: string | null;
    sourceCommandId: string | null;
    kind: "text" | "log" | "json" | "file";
    name: string;
    path: string;
    content?: string;
    createdAt: string;
  }>;

  events: Array<{
    id: string;
    at: string;
    kind: string;
    subject: {
      kind: "session" | "turn" | "thread" | "workflowRun" | "command" | "episode" | "verification" | "artifact";
      id: string;
    };
    data?: Record<string, unknown>;
  }>;
};
```

## Why These Records Exist

### Session

The session record exists because the product needs one durable container that ties together:

- the main orchestrator surface
- delegated handler threads
- workflow-run history
- summary and wait state

### Turn

Turns exist because a request is a real product boundary inside one interactive surface.

The system needs a durable answer to:

- which surface received the request
- whether the request is still running
- whether it finished, failed, or is waiting

### Thread

Threads are the durable delegated-objective records.

They exist because the product needs a durable answer to:

- which delegated objectives exist
- which pi-backed interactive surface owns each objective
- whether that delegated objective is active, waiting, complete, or failed
- which workflow run was most recent under that thread

A thread is not itself a workflow run.

It is the supervising pi-backed interactive surface for that delegated objective.

### Workflow Run

Workflow-run records exist because the product needs a top-level durable summary of Smithers executions without copying Smithers internals into `svvy`.

They answer:

- how many workflow runs happened under a thread
- which template or preset was used
- which Smithers run id corresponds to each execution
- whether the latest execution completed, failed, or paused

### CommandRecord

`CommandRecord`s are the universal durable representation of tool calls.

They answer:

- which tool was called
- which surface and thread called it
- which workflow run it belonged to, if any
- whether it started, succeeded, failed, or is waiting
- how commands nest
- which commands are trace-only versus surfaced work

### Episode

Episodes are the durable semantic outputs reused later by the orchestrator and shown to the user.

In the delegated model, the most important invariant is:

- one handler thread produces zero or one terminal episode

Waiting inside a handler thread does not create a wait episode.

The terminal episode is created only when that delegated objective actually finishes or definitively fails.

### Verification

Verification records exist because build, test, lint, and related checks still need structured product state even though they now execute as workflow-shaped delegated work.

### Artifact

Artifacts exist because generated outputs, logs, submitted `execute_typescript` snippets, workflow exports, and related files need stable file-backed durable handles.

Artifacts are thread- and command-addressable first.

They should not depend on episode attachments to exist.

### Event

Events exist as a small append-only lifecycle ledger.

They are not the only source of truth.

Current-state records remain canonical.

## Cardinality Rules

These rules are adopted:

- one session contains many turns
- one session contains many threads
- one session contains many workflow runs
- one session contains many commands
- one session contains many episodes
- one session contains many artifacts
- one turn belongs to exactly one surface
- one turn may belong to the orchestrator surface or to one handler thread surface
- one thread owns exactly one backing `surfacePiSessionId`
- one thread contains many turns over time
- one thread contains many commands
- one thread contains many workflow runs
- one thread contains zero or one terminal episode
- one workflow run belongs to exactly one thread
- one workflow run may have many commands and artifacts
- one artifact may link to a thread, a workflow run, a command, or any combination that is semantically useful

## Turn Model

### Turn Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable handle for correlation and resume. |
| `surfacePiSessionId` | Identifies which interactive surface received the message. |
| `threadId` | Links the turn to a handler thread when the target surface is delegated work. `null` means the main orchestrator surface. |
| `requestSummary` | Compact durable description of what the request was. |
| `status` | Whether the request is still running, waiting, completed, or failed. |
| `startedAt` | Enables ordering and duration reasoning. |
| `updatedAt` | Enables recency-based selectors. |
| `finishedAt` | Marks terminal completion or failure. |

## Thread Model

### Thread Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable delegated-objective handle. |
| `parentThreadId` | Allows future thread-to-thread delegation or grouping without forcing it into v1. |
| `surfacePiSessionId` | Links the thread to the backing pi conversation surface. |
| `title` | Compact human-readable label. |
| `objective` | Durable statement of what this thread owns. |
| `status` | Captures lifecycle state for the delegated objective. |
| `wait` | Captures user or external wait details for the thread itself. |
| `worktree` | Records the bound worktree when relevant. |
| `latestWorkflowRunId` | Points to the latest workflow run under this thread for quick selectors. |
| `startedAt` | Orders thread creation. |
| `updatedAt` | Enables recency-based selectors. |
| `finishedAt` | Marks terminal completion, failure, or cancellation. |

### Thread Status Semantics

Use thread status this way:

- `running` while the handler thread is actively supervising the delegated objective, including while a Smithers workflow run is executing
- `waiting` when the delegated objective is blocked on user or external input
- `completed` when the delegated objective reached a successful terminal result and emitted its episode
- `failed` when the delegated objective terminated unsuccessfully and emitted its final failure episode
- `cancelled` when the delegated objective was intentionally cancelled

Waiting is not terminal.

A waiting thread may later return to `running` and eventually terminate with its one final episode.

## Workflow Run Model

### Workflow Run Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable local workflow-run handle. |
| `threadId` | Links the run to the handler thread that owns it. |
| `smithersRunId` | Canonical link back to Smithers. |
| `workflowName` | Product-visible workflow identifier. |
| `templateId` | Records which structural template was used when relevant. |
| `presetId` | Records which preset was used when relevant. |
| `status` | Captures current top-level run status. |
| `summary` | Short top-level summary of the run state. |
| `startedAt` | Start time of the run. |
| `updatedAt` | Most recent state transition time. |
| `finishedAt` | Terminal completion, failure, or cancellation time. |

### Workflow Run Status Semantics

Use workflow-run status this way:

- `running` while the Smithers run is alive and making progress
- `waiting` when the Smithers run itself reaches a durable pause condition
- `completed`, `failed`, or `cancelled` when the Smithers run reaches a terminal outcome

Do not confuse workflow-run termination with thread termination.

A thread may survive several workflow runs before it reaches its one final terminal episode.

## Command Model

### CommandRecord Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable command handle. |
| `turnId` | Links the command to the triggering request. |
| `surfacePiSessionId` | Identifies which interactive surface executed the command. |
| `threadId` | Links the command to the delegated thread when relevant. |
| `workflowRunId` | Links the command to the owning workflow run when relevant. |
| `parentCommandId` | Represents nested command structure. |
| `toolName` | Names the tool that was called. |
| `executor` | Identifies which runtime component executed the command. |
| `visibility` | Distinguishes trace work from surfaced work. |
| `status` | Captures lifecycle state. |
| `attempts` | Records retry count without requiring a separate attempt table in the first slice. |
| `title` | Compact human-readable label. |
| `summary` | Compact durable explanation of the command's purpose or outcome. |
| `facts` | Stores normalized tool-specific facts used for rollups and drill-down. |
| `error` | Stores terminal failure text when needed. |
| `startedAt` | Enables ordering and duration reasoning. |
| `updatedAt` | Enables recency-based selectors. |
| `finishedAt` | Marks terminal completion, failure, or cancellation. Waiting commands keep `finishedAt = null`. |

### CommandRecord Visibility

The adopted visibility levels are:

- `trace`
- `summary`
- `surface`

Use them this way:

- low-level repo or web reads inside `execute_typescript` are usually `trace`
- material writes, artifact creation, and failed execs usually roll up as `summary`
- `thread.start`, `workflow.start`, `workflow.resume`, and `wait` are normally `surface`
- child `api.*` commands remain nested detail by default

### CommandRecord Executor

The adopted executor labels are:

- `orchestrator`
- `handler`
- `execute_typescript`
- `runtime`
- `smithers`

### CommandRecord Status

The adopted statuses are:

- `requested`
- `running`
- `waiting`
- `succeeded`
- `failed`
- `cancelled`

### CommandRecord Retry Policy

Retries are handler or bridge policy, not model improvisation.

The first slice does not introduce a first-class `command_attempt` table.

Instead:

- the command record persists `attempts`
- lifecycle events capture retries when they matter
- a later slice may split retries into separate attempt records if the product truly needs that detail

## Episode Model

### Episode Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable episode handle. |
| `threadId` | Links the episode to the completed handler thread that produced it. `null` is reserved for substantive orchestrator-local work if needed later. |
| `sourceCommandId` | Links the episode to the most relevant command when that linkage matters. |
| `title` | Compact label for lists and cards. |
| `summary` | Short durable digest. |
| `body` | The reusable semantic content. |
| `createdAt` | Orders the episode in the session lifecycle. |

### Episode Meaning

Episodes are intentionally simple.

They are not the main machine-readable routing contract.

The machine-readable routing and lifecycle contract belongs in:

- thread status
- thread wait state
- workflow-run state
- command facts

The episode is the normal semantic handoff back to the orchestrator.

## Verification Model

### Verification Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable verification handle. |
| `threadId` | Links the verification to the handler thread that owns it. |
| `workflowRunId` | Links the verification to the workflow run that produced it. |
| `kind` | Identifies the verification type. |
| `status` | Captures pass, fail, or cancelled outcome. |
| `summary` | Gives the orchestrator and UI a concise outcome summary. |
| `startedAt` | Records start time. |
| `finishedAt` | Records finish time. |

Verification kind is intentionally open-ended.

Built-in defaults may include:

- `build`
- `test`
- `lint`
- `integration`
- `manual`

## Artifact Model

### Artifact Fields

| Field | Why it exists |
| --- | --- |
| `id` | Stable artifact handle. |
| `threadId` | Links the artifact to the owning thread when relevant. |
| `workflowRunId` | Links the artifact to the workflow run that produced it when relevant. |
| `sourceCommandId` | Links the artifact back to the command attempt that produced it. |
| `kind` | Distinguishes text, log, json, and file outputs. |
| `name` | Human-readable artifact label. |
| `path` | Workspace artifact path inside the dedicated artifact directory. |
| `content` | Optional inline preview content for small artifacts and the POC. |
| `createdAt` | Orders artifact creation. |

Every submitted `execute_typescript` snippet must land in this table as a file-backed artifact before execution begins.

## Event Model

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
- `workflowRun.created`
- `workflowRun.updated`
- `command.requested`
- `command.started`
- `command.waiting`
- `command.finished`
- `episode.created`
- `verification.recorded`
- `artifact.created`
- `session.wait.started`
- `session.wait.cleared`

## Waiting Semantics

Waiting is a shared lifecycle concept, not a separate execution subsystem.

### Thread Wait

Use `thread.wait` when a handler thread needs:

- user clarification
- external input

Rules:

- set `thread.status = "waiting"`
- populate `thread.wait`
- do not create a wait episode
- clear `thread.wait` when runnable work resumes in that thread

### Session Wait

`session.wait` exists only when the whole active frontier is blocked.

Use it when:

- some interactive surface is waiting on user or external input
- there are no runnable surfaces left in the session

`session.wait` must point back to the owner:

- the orchestrator surface
- or one handler thread

## Derived Read Model

The stored facts remain canonical.

Selectors should derive the main session view and sidebar data from those facts.

### Session Summary

The adopted session summary selector should return:

- `title`
- `sessionStatus`
- `wait`
- `counts`
- `threadIds`
- `latestEpisodePreview`
- `latestWorkflowRunSummary`

### Session Status Rules

The summary selector should derive session status in this order:

1. if `session.wait` exists, the session status is `waiting`
2. else if any thread is `running`, the session status is `running`
3. else if the latest updated thread is `failed`, the session status is `error`
4. else the session status is `idle`

### Main Session View

The main session UI should primarily read:

- handler threads
- thread status and wait state
- latest workflow-run state per thread
- terminal episodes
- artifacts
- verification summaries

Transcript replay is not an allowed mechanism for these product surfaces once structured writes exist.

## SQLite Notes

The real implementation should store session-scoped rows for:

- `turn`
- `thread`
- `workflow_run`
- `command`
- `episode`
- `verification`
- `artifact`
- `event`

Recommended implementation rules:

- every row should carry `session_id`
- `thread.surface_pi_session_id` should be unique
- `workflow_run.smithers_run_id` should be unique
- `episode.thread_id` should be unique for handler-thread terminal episodes in the first slice
- artifact tables should preserve path indexes for file-backed lookups

## Responsibility Split

Write responsibility is:

- ordinary orchestrator-turn and root command writes belong to the `svvy` runtime
- handler-thread turn and command writes belong to the `svvy` runtime over pi thread surfaces
- workflow-run writes belong to the Smithers bridge
- verification writes belong to the runtime or bridge that interprets verification-shaped workflow outputs
- wait writes belong to the `svvy` runtime

No runtime component may synthesize thread, workflow-run, verification, or wait facts from transcript prose after the fact.

## Invariants

The implementation must enforce these invariants:

- every tool call creates exactly one command record
- a handler thread owns exactly one backing `surfacePiSessionId`
- a thread may have many workflow runs over time
- a handler thread may wait and resume many times
- a handler thread produces at most one final terminal episode
- a thread may be waiting only on user or external input, not on a fake wait episode
- `session.wait` must be cleared when runnable work exists again
- a turn must end in exactly one of: `completed`, `failed`, or `waiting`

## Non-Goals

This spec does not attempt to:

- copy full Smithers node internals into `svvy`
- make the episode schema carry all machine-readable routing state
- flatten handler-thread and workflow-run state into one record type
- rely on transcript replay for session summary, navigation, or wait state
- define the exact final desktop UI layout
