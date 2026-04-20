# Structured Session State Spec

## Status

- Date: 2026-04-19
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
- Persist one top-level per-turn decision for every surface, with orchestrator routing decisions and handler supervision decisions sharing one field.
- Treat every tool call as a `CommandRecord`.
- Make `execute_typescript` the default generic work surface.
- Treat every top-level `execute_typescript` invocation as one parent command record and every nested `api.*` call as a child command record.
- Keep only a very small set of native control tools for thread spawning, explicit thread handoff, workflow control, and wait.
- Drive durable facts from real runtime handlers and bridge events, not transcript heuristics.
- Use one explicit surface-target identity model with `workspaceSessionId`, `surfacePiSessionId`, and `threadId` instead of overloading `session.id`.
- Use explicit backend-to-renderer session-sync events that carry the active surface target when prompt settlement or surface ownership changes; the renderer should not poll read APIs to guess when state caught up.
- Keep status derivation and workflow lifecycle projection write-driven; do not overlay `activePrompt`, parse transcript files, or perform read-side Smithers repair writes.
- Future Smithers lifecycle projection beyond explicit tool-boundary snapshots should arrive through bridge events rather than speculative read-side reconciliation.
- Keep workflow-run state separate from handler-thread state.
- Keep thread state about handler ownership and attention, not as a lossy proxy for raw workflow outcome.
- Preserve raw Smithers workflow status, wait kind, heartbeat freshness, cursor metadata, and lineage instead of flattening them into generic thread status.
- Derive active and latest workflow selectors from workflow-run state and recency rules rather than persisting a thread-level latest-workflow pointer.
- Treat a handler thread as one delegated objective that may supervise many workflow runs over its lifetime.
- Treat handler-thread episodes as durable handoff summaries that are emitted explicitly through `thread.handoff` whenever a thread gives control back to the orchestrator.
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
- episodes, including handler-thread handoff episodes
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
    turnDecision:
      | "pending"
      | "reply"
      | "execute_typescript"
      | "clarify"
      | "thread.start"
      | "thread.handoff"
      | "wait"
      | `smithers.${string}`;
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
    status: "running-handler" | "running-workflow" | "waiting" | "troubleshooting" | "completed";
    wait: null | {
      owner: "handler" | "workflow";
      kind: "user" | "external" | "approval" | "signal" | "timer";
      reason: string;
      resumeWhen: string;
      since: string;
    };
    worktree?: string;
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
    status: "running" | "waiting" | "continued" | "completed" | "failed" | "cancelled";
    smithersStatus:
      | "running"
      | "waiting-approval"
      | "waiting-event"
      | "waiting-timer"
      | "finished"
      | "continued"
      | "failed"
      | "cancelled";
    waitKind: null | "approval" | "event" | "timer";
    continuedFromRunIds: string[];
    activeDescendantRunId: string | null;
    lastEventSeq: number | null;
    lastAttentionSeq: number | null;
    heartbeatAt: string | null;
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
    executor: "orchestrator" | "handler" | "execute_typescript" | "runtime" | "smithers";
    visibility: "trace" | "summary" | "surface";
    status: "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
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
    threadId: string;
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
      kind:
        | "session"
        | "turn"
        | "thread"
        | "workflowRun"
        | "command"
        | "episode"
        | "verification"
        | "artifact";
      id: string;
    };
    data?: Record<string, unknown>;
  }>;
};
```

## Surface Target Identity

All bun-to-renderer runtime traffic should carry an explicit surface target:

```ts
type SurfaceTarget = {
  workspaceSessionId: string;
  surface: "orchestrator" | "thread";
  surfacePiSessionId: string;
  threadId?: string;
};
```

Use it this way:

- `workspaceSessionId` identifies the durable top-level session container
- `surfacePiSessionId` identifies the currently addressed pi conversation surface
- `threadId` identifies the delegated handler-thread record when `surface === "thread"`
- session summaries expose `session.id === workspaceSessionId`
- no component may overload `session.id` to mean `surfacePiSessionId`, even if the orchestrator currently reuses the same string for both values

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
- whether the handler is actively working, a workflow is actively running, the objective is waiting, the thread is troubleshooting, or the current span is completed
- which workflow run is currently active or most recent under that thread

A thread is not itself a workflow run.

It is the supervising pi-backed interactive surface for that delegated objective.

### Workflow Run

Workflow-run records exist because the product needs a top-level durable summary of Smithers executions without copying Smithers internals into `svvy`.

They answer:

- how many workflow runs happened under a thread
- which template or preset was used
- which Smithers run id corresponds to each execution
- the normalized run status plus raw Smithers status and wait kind
- whether the run continued into another lineage
- whether supervision is current enough to reconnect without replaying from scratch

### CommandRecord

`CommandRecord`s are the universal durable representation of tool calls.

They answer:

- which tool was called
- which surface and thread called it
- which workflow run it belonged to, if any
- whether it started, succeeded, failed, or is waiting
- how commands nest
- which commands are trace-only versus surfaced work
- what summary belongs to that tool run without inventing an episode for it

### Episode

Episodes are the durable semantic outputs reused later by the orchestrator and shown to the user.

In the delegated model, the most important invariant is:

- a handler thread may emit many handoff episodes over time
- each handoff episode marks one moment where that thread returned control to the orchestrator

Waiting inside a handler thread does not create a wait episode.

A handoff episode is created only when that delegated objective reaches a terminal state for the current active work span and the handler thread explicitly calls `thread.handoff`.

The terminal handoff back to the orchestrator is:

- the thread's terminal durable state
- the latest handoff episode emitted by that thread

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
- one thread may contain many episodes over time
- one workflow run belongs to exactly one thread
- one workflow run may have many commands and artifacts
- one artifact may link to a thread, a workflow run, a command, or any combination that is semantically useful

## Turn Model

### Turn Fields

| Field                | Why it exists                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                 | Stable handle for correlation and resume.                                                                                            |
| `surfacePiSessionId` | Identifies which interactive surface received the message.                                                                           |
| `threadId`           | Links the turn to a handler thread when the target surface is delegated work. `null` means the main orchestrator surface.            |
| `requestSummary`     | Compact durable description of what the request was.                                                                                 |
| `turnDecision`       | Captures the top-level action this surface chose for the turn without forcing later reconstruction from commands or transcript text. |
| `status`             | Whether the request is still running, waiting, completed, or failed.                                                                 |
| `startedAt`          | Enables ordering and duration reasoning.                                                                                             |
| `updatedAt`          | Enables recency-based selectors.                                                                                                     |
| `finishedAt`         | Marks terminal completion or failure.                                                                                                |

### Turn Decision

Every turn should persist one explicit surface-level turn decision.

Use `turnDecision` this way:

- `pending` is allowed only between turn creation and the moment the surface chooses how to proceed
- orchestrator turns persist session-level routing decisions such as `reply`, `execute_typescript`, `clarify`, or `thread.start`
- handler-thread turns persist delegated-supervision decisions such as `reply`, `execute_typescript`, `clarify`, `smithers.run_workflow.hello_world`, `smithers.get_run`, `smithers.resolve_approval`, `thread.handoff`, or `wait`
- this symmetry is intentional even though only orchestrator turns own session-level routing
- the turn decision is the top-level classification of the turn, not a replacement for command records
- linkage to spawned threads, workflow runs, artifacts, and episodes still belongs in their own records plus linked commands

## Thread Model

### Thread Fields

| Field                | Why it exists                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Stable delegated-objective handle.                                                                                         |
| `parentThreadId`     | Allows future thread-to-thread delegation or grouping without forcing it into v1.                                          |
| `surfacePiSessionId` | Links the thread to the backing pi conversation surface.                                                                   |
| `title`              | Compact human-readable label.                                                                                              |
| `objective`          | Durable statement of what this thread owns.                                                                                |
| `status`             | Captures handler-attention state for the delegated objective.                                                              |
| `wait`               | Captures blocked-state details for the thread itself, including whether the wait is handler-owned or workflow-owned.       |
| `worktree`           | Records the bound worktree when relevant.                                                                                  |
| `startedAt`          | Orders thread creation.                                                                                                    |
| `updatedAt`          | Enables recency-based selectors.                                                                                           |
| `finishedAt`         | Marks when the current active work span most recently became completed. Clear it if later work resumes in the same thread. |

### Thread Status Semantics

Use thread status this way:

- `running-handler` while the handler is actively reasoning or issuing tools and no live workflow run currently owns forward progress
- `running-workflow` while a Smithers workflow run is actively executing and the handler is idle but still owns the delegated objective
- `waiting` when the delegated objective is durably blocked on user, approval, signal, timer, or other external input and no troubleshooting is required yet
- `troubleshooting` when a workflow failed, was cancelled, continued into new lineage, or lost reliable supervision and the handler must inspect or repair before deciding what to do next
- `completed` when the delegated objective reached an explicit terminal handoff point, `thread.handoff` emitted a handoff episode, and no running or waiting workflow run still belongs to that active span

These statuses describe the objective state, not whether the thread surface can still receive direct messages.

Waiting is not terminal for the objective state.

A completed thread surface remains directly interactive after handoff.

A follow-up chat turn may leave thread status unchanged.

A follow-up work turn may move a completed thread back to `running-handler` or `running-workflow`, preserving earlier handoff episodes as durable history.

If the same terminal workflow snapshot is replayed after handoff during final reconciliation or recovery, the thread remains `completed` because that replay does not start a new active span.

## Workflow Run Model

### Workflow Run Fields

| Field                   | Why it exists                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `id`                    | Stable local workflow-run handle.                                                         |
| `threadId`              | Links the run to the handler thread that owns it.                                         |
| `smithersRunId`         | Canonical link back to Smithers.                                                          |
| `workflowName`          | Product-visible workflow identifier.                                                      |
| `templateId`            | Records which structural template was used when relevant.                                 |
| `presetId`              | Records which preset was used when relevant.                                              |
| `status`                | Captures the normalized top-level run status used by `svvy`.                              |
| `smithersStatus`        | Preserves the raw Smithers run status for faithful inspection and reconnect behavior.     |
| `waitKind`              | Preserves whether a waiting run is blocked on approval, event, or timer.                  |
| `continuedFromRunIds`   | Preserves run lineage when Smithers continues the workflow as a new run.                  |
| `activeDescendantRunId` | Points at the active descendant run when Smithers continued this run as new.              |
| `lastEventSeq`          | Stores the most recent applied Smithers event sequence for reconnect.                     |
| `lastAttentionSeq`      | Stores the most recent event sequence already delivered to the handler as attention work. |
| `heartbeatAt`           | Preserves the most recent Smithers heartbeat seen for this run.                           |
| `summary`               | Short top-level summary of the run state.                                                 |
| `startedAt`             | Start time of the run.                                                                    |
| `updatedAt`             | Most recent state transition time.                                                        |
| `finishedAt`            | Terminal completion, failure, or cancellation time.                                       |

### Workflow Run Status Semantics

Map Smithers run status into `svvy` this way:

- raw `running` -> normalized `running`
- raw `waiting-approval`, `waiting-event`, or `waiting-timer` -> normalized `waiting` with `waitKind` set accordingly
- raw `finished` -> normalized `completed`
- raw `continued` -> normalized `continued`
- raw `failed` -> normalized `failed`
- raw `cancelled` -> normalized `cancelled`

Do not confuse workflow-run termination with thread termination.

A thread may survive several workflow runs before it emits a handoff episode, and it may later supervise more runs after a follow-up turn reactivates work on the same objective.

When a workflow run is `continued`, selector logic should follow `activeDescendantRunId` to find the currently active execution.

## Command Model

### CommandRecord Fields

| Field                | Why it exists                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                 | Stable command handle.                                                                          |
| `turnId`             | Links the command to the triggering request.                                                    |
| `surfacePiSessionId` | Identifies which interactive surface executed the command.                                      |
| `threadId`           | Links the command to the delegated thread when relevant.                                        |
| `workflowRunId`      | Links the command to the owning workflow run when relevant.                                     |
| `parentCommandId`    | Represents nested command structure.                                                            |
| `toolName`           | Names the tool that was called.                                                                 |
| `executor`           | Identifies which runtime component executed the command.                                        |
| `visibility`         | Distinguishes trace work from surfaced work.                                                    |
| `status`             | Captures lifecycle state.                                                                       |
| `attempts`           | Records retry count without requiring a separate attempt table in the first slice.              |
| `title`              | Compact human-readable label.                                                                   |
| `summary`            | Compact durable explanation of the command's purpose or outcome.                                |
| `facts`              | Stores normalized tool-specific facts used for rollups and drill-down.                          |
| `error`              | Stores terminal failure text when needed.                                                       |
| `startedAt`          | Enables ordering and duration reasoning.                                                        |
| `updatedAt`          | Enables recency-based selectors.                                                                |
| `finishedAt`         | Marks terminal completion, failure, or cancellation. Waiting commands keep `finishedAt = null`. |

### Workflow Command Facts

For `smithers.*` commands, `facts` should preserve both the adopted agent-visible Smithers tool name and the underlying Smithers invocation metadata.

At minimum that should include:

- concrete generated tool name when the command came from a workflow-specific launch tool
- semantic Smithers operation name such as `smithers.run_workflow`
- transport or bridge surface used
- raw Smithers operation name or endpoint
- forwarded arguments
- affected run id, node id, and iteration when relevant
- pre-status and post-status
- observed event-sequence range when a command is tied to workflow events

### CommandRecord Visibility

The adopted visibility levels are:

- `trace`
- `summary`
- `surface`

Use them this way:

- low-level repo or web reads inside `execute_typescript` are usually `trace`
- material writes, artifact creation, and failed execs usually roll up as `summary`
- `thread.start`, `thread.handoff`, `wait`, and Smithers-mutating commands such as generated `smithers.run_workflow.<workflow_id>` launch tools, `smithers.resolve_approval`, `smithers.runs.cancel`, and `smithers.signals.send` are normally `surface`
- read-only Smithers inspection commands are usually `summary` unless the UI chooses to surface a specific one directly
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

| Field             | Why it exists                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Stable episode handle.                                                                                                             |
| `threadId`        | Links the episode to the thread that authored that handoff point.                                                                  |
| `sourceCommandId` | Optional provenance link to the most relevant command when that linkage matters. It does not mean the command emitted the episode. |
| `title`           | Compact label for lists and cards.                                                                                                 |
| `summary`         | Short durable digest.                                                                                                              |
| `body`            | The reusable semantic content.                                                                                                     |
| `createdAt`       | Orders the episode in the session lifecycle.                                                                                       |

### Episode Meaning

Episodes are intentionally simple.

They are not the main machine-readable routing contract.

The machine-readable routing and lifecycle contract belongs in:

- turn decision
- thread status
- thread wait state
- workflow-run state
- command facts

For handler threads, an episode is the semantic half of a handoff back to the orchestrator.

The control-plane half is the thread's current terminal durable state plus its durable links to workflow runs, commands, artifacts, and waits.

Handler-thread episodes are ordered durable handoff points produced by explicit `thread.handoff` calls, not a promise that the thread surface becomes unreadable or unaddressable afterward.

Commands, including `execute_typescript`, may produce their own summaries and artifacts.

Those command-level summaries are not episodes.

## Verification Model

### Verification Fields

| Field           | Why it exists                                                |
| --------------- | ------------------------------------------------------------ |
| `id`            | Stable verification handle.                                  |
| `threadId`      | Links the verification to the handler thread that owns it.   |
| `workflowRunId` | Links the verification to the workflow run that produced it. |
| `kind`          | Identifies the verification type.                            |
| `status`        | Captures pass, fail, or cancelled outcome.                   |
| `summary`       | Gives the orchestrator and UI a concise outcome summary.     |
| `startedAt`     | Records start time.                                          |
| `finishedAt`    | Records finish time.                                         |

Verification kind is intentionally open-ended.

Built-in defaults may include:

- `build`
- `test`
- `lint`
- `integration`
- `manual`

## Artifact Model

### Artifact Fields

| Field             | Why it exists                                                          |
| ----------------- | ---------------------------------------------------------------------- |
| `id`              | Stable artifact handle.                                                |
| `threadId`        | Links the artifact to the owning thread when relevant.                 |
| `workflowRunId`   | Links the artifact to the workflow run that produced it when relevant. |
| `sourceCommandId` | Links the artifact back to the command attempt that produced it.       |
| `kind`            | Distinguishes text, log, json, and file outputs.                       |
| `name`            | Human-readable artifact label.                                         |
| `path`            | Workspace artifact path inside the dedicated artifact directory.       |
| `content`         | Optional inline preview content for small artifacts and the POC.       |
| `createdAt`       | Orders artifact creation.                                              |

Every submitted `execute_typescript` snippet must land in this table as a file-backed artifact before execution begins.

## Event Model

### Event Fields

| Field     | Why it exists                                      |
| --------- | -------------------------------------------------- |
| `id`      | Stable event handle.                               |
| `at`      | Event timestamp.                                   |
| `kind`    | Exact lifecycle transition type.                   |
| `subject` | Typed pointer to the subject record.               |
| `data`    | Small optional payload for debugging or selectors. |

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

Use `thread.wait` when the delegated objective is durably blocked and the thread needs to record why.

Common cases are:

- handler-owned user clarification
- workflow-owned approval waits
- workflow-owned signal waits
- workflow-owned timer waits
- other external dependencies

Rules:

- set `thread.status = "waiting"`
- populate `thread.wait`
- do not create a wait episode
- clear `thread.wait` when runnable work resumes in that thread

### Session Wait

`session.wait` exists only when the whole active frontier is blocked.

Use it when:

- some interactive surface is waiting on user, approval, signal, timer, or other external input
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
2. else if any thread is `troubleshooting`, the session status is `error`
3. else if any thread is `running-handler` or `running-workflow`, the session status is `running`
4. else the session status is `idle`

No other input participates in session status:

- not live `activePrompt` flags
- not transcript stop reasons
- not transcript JSONL scans
- not renderer-side overlays or repair state

A currently open surface may still render live transcript streaming locally, but that does not create a second session-summary status source.

### Main Session View

The main session UI should primarily read:

- handler threads
- thread status and wait state
- latest workflow-run state per thread
- latest handoff episodes and episode history
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
- `episode.thread_id` should be indexed for ordered lookups; it should not be unique because a thread may hand control back more than once over its lifetime
- artifact tables should preserve path indexes for file-backed lookups

## Responsibility Split

Write responsibility is:

- ordinary orchestrator-turn writes, including turn decisions, and root command writes belong to the `svvy` runtime
- handler-thread turn writes, including turn decisions, and command writes belong to the `svvy` runtime over pi thread surfaces
- workflow-run writes belong to the Smithers bridge
- verification writes belong to the runtime or bridge that interprets verification-shaped workflow outputs
- wait writes belong to the `svvy` runtime

No runtime component may synthesize `turnDecision`, thread, workflow-run, verification, or wait facts from transcript prose after the fact.

Read APIs and selectors are projection-only for lifecycle state:

- they may read current durable facts and explicit active-surface state
- they must not mutate thread, workflow-run, verification, or wait state during reads
- they must not poll Smithers or parse transcript files to compensate for missing writes
- they must not refresh pi session metadata as a side effect of summary reads; that metadata belongs on explicit session mutations and prompt-settlement writes

## Invariants

The implementation must enforce these invariants:

- every tool call creates exactly one command record
- a handler thread owns exactly one backing `surfacePiSessionId`
- a thread may have many workflow runs over time
- a handler thread may wait and resume many times
- a handler thread remains message-addressable after handing control back
- a completed thread may later return to `running-handler` or `running-workflow`
- a new handoff episode may be created only when a thread reaches another terminal objective state and explicitly calls `thread.handoff`
- a thread may be waiting only on real blocked conditions such as user input, approval, signal, timer, or external dependency, not on a fake wait episode
- `session.wait` must be cleared when runnable work exists again
- a turn must end in exactly one of: `completed`, `failed`, or `waiting`

## Non-Goals

This spec does not attempt to:

- copy full Smithers node internals into `svvy`
- make the episode schema carry all machine-readable routing state
- flatten handler-thread and workflow-run state into one record type
- rely on transcript replay for session summary, navigation, or wait state
- repair missing workflow lifecycle state through read-side polling or reconciliation
- define the exact final desktop UI layout
