# Structured Session State Spec

## Status

- Date: 2026-04-21
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

The concrete Thread Orchestration and Thread Handling native tool APIs that read and write this state are defined in
`docs/specs/extension/thread_managing.extension.spec.md`.

Live tool projection and command event semantics are defined in
`docs/specs/live-tool-projection.spec.md`.

## Reference Rule

The executable reference sketch for this spec is [docs/pocs/structured-session-state.poc.ts](../pocs/structured-session-state.poc.ts).

The spec is canonical for product behavior and storage semantics.

If this spec and the POC ever disagree, the POC should be reconciled to the spec rather than narrowing the spec to match a stale sketch.

## Adopted Direction

- Keep `pi` as the canonical transcript and runtime substrate for the main orchestrator surface and delegated handler thread surfaces.
- Keep Smithers as the canonical workflow execution substrate.
- Add `svvy`-owned structured product state above those substrates.
- Model turns, handler threads, workflow runs, workflow task attempts, commands, request-user-input
  records, episodes, artifacts, Project CI, and waits explicitly.
- Persist agent profile choices separately from generated agent context binding state: app-wide orchestrator profiles, the special `threadHandler` profile, workflow-agent profiles, per-session selected orchestrator profile snapshots, loaded and available extension ids, handler creation-time extension overrides, workflow task-agent invocation extension overrides, plus internal title-naming settings are structured settings facts, not transcript text. TanStack Form is renderer form state for editing these facts; durable truth remains the structured settings records normalized by Bun-side settings code. Provider/model capability checks, including reasoning availability, supported reasoning levels, context windows, output limits, and image input support, come from pi's normalized `Model` metadata and session thinking APIs rather than `svvy`-owned provider-specific tables. Transcript rendering treats assistant `thinking` blocks as pi-normalized reasoning display content; if a block carries encrypted continuation state but no visible text, the UI labels the summary as unavailable instead of presenting it as redacted reasoning.
- Model top-level session auto-title generation as explicit durable state driven by the first real user turn start, with pending/running/completed/failed title-generation status, manual-rename freeze state, and a rename lock while generation is pending or running. The configured internal title-naming prompt owns the title-generation instruction; the one-shot prompt body carries only the first user message context being titled, without a second naming instruction or extracted keyword list. The namer runs concurrently with the orchestrator's first turn: neither surface waits for the other to finish.
- Persist one top-level per-turn decision for every surface, with orchestrator routing decisions and handler supervision decisions sharing one field.
- Treat every tool call as a `CommandRecord`.
- Project live tool use through Codex-like turn items: streamed argument snapshots before runtime
  execution, durable command events after runtime acceptance, and final command facts as the
  authoritative recovery source.
- Make native direct tools plus prompt-only cx CLI guidance the default coding-agent work surface.
- Treat every top-level `execute_typescript` invocation as one parent command record and every generated client call as a child command record.
- Keep only a very small set of native control tools for thread spawning, handler reporting,
  session-local extension loading, explicit objective conclusion, and request-user-input; workflow
  control belongs on Smithers-native `smithers_*` bridge tools.
- Treat optional extension loading as generated agent context binding state through `thread_start` extension overrides, workflow task-agent invocation overrides, and the native `load_extension` tool, not as an `execute_typescript` API.
- Drive durable facts from real runtime handlers and bridge events, not transcript heuristics.
- Use one explicit surface-target identity model with `workspaceSessionId`, `surfacePiSessionId`, and `threadId` instead of overloading `session.id`.
- Treat queued surface work as structured product state keyed by `surfacePiSessionId`. Queue items include user messages, report requests, thread report notifications, nonblocking request-user-input answer delivery, and generated agent context refresh control work.
- Emit workspace-level read-model updates independently from live surface transcript updates; the renderer should join durable workspace facts, live surface facts, and Dockview panel bindings locally instead of depending on one active-session payload.
- Keep status derivation and workflow lifecycle projection write-driven; do not overlay `activePrompt`, parse transcript files, or perform read-side Smithers repair writes.
- Future Smithers lifecycle projection beyond explicit tool-boundary snapshots should arrive through bridge events rather than speculative read-side reconciliation.
- Keep workflow-run state separate from handler-thread state.
- Project workflow task attempts as first-class durable records keyed by Smithers `runId` plus `nodeId`, `iteration`, and `attempt`, while keeping their full transcript canonical in Smithers and their inspectable task-agent transcript, command, and artifact projection in `svvy`.
- Create or update workflow-task-attempt records from the exact Smithers task-attempt identity before task-local commands run. The only bootstrap path for task-local command binding is the current Smithers context's `(runId, nodeId, iteration, attempt)` tuple; do not use resume handles, heuristic recency scans, transcript inference, or multi-stage fallback chains.
- Keep thread state about handler ownership and attention, not as a lossy proxy for raw workflow outcome.
- Preserve projected Smithers workflow status, wait kind, heartbeat freshness, cursor metadata, and lineage on the workflow-run binding instead of flattening them into generic thread objective state; Smithers remains authoritative for raw execution facts.
- Derive active and latest workflow selectors from workflow-run state and recency rules rather than persisting a thread-level latest-workflow pointer.
- Treat a handler thread as one delegated objective that may supervise many workflow runs over its lifetime.
- Treat handler-thread episodes as durable semantic reports emitted explicitly through `thread_report`; reports with `outcome` conclude the current objective and give control back to the orchestrator.
- Do not model internal workflow pauses as separate episodes.
- Use selectors and metadata-first read models instead of making the UI reconstruct state from storage details or transcripts.
- Keep Dockview layout state, panel focus, and panel-to-surface bindings out of structured session state; those are UI layout concerns layered on top of durable workspace state and live surface state.

## Core Modeling Rule

The product should model the durable things that actually affect routing, inspection, recovery, and UI behavior.

That means:

- keep first-class records for turns, threads, generated agent context bindings, loaded and available extension ids, workflow runs, workflow task attempts, commands, episodes, Project CI runs, CI check results, artifacts, and lifecycle events
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
- workflow-task-attempt records projected into the session model
- generated agent context bindings and session-local extension bindings
- command records
- episodes, including handler-thread update and conclusion episodes
- Project CI run and CI check result records
- artifacts and artifact indexes
- request-user-input request, question, and answer records
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
    pinnedAt: string | null;
    archivedAt: string | null;
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
      | "exec_command"
      | "write_stdin"
      | "apply_patch"
      | "list_extensions"
      | "workflow_list_models"
      | "execute_typescript"
      | "clarify"
      | "thread_start"
      | "thread_resume"
      | "thread_request_report"
      | "load_extension"
      | "thread_report"
      | "request_user_input"
      | `smithers_${string}`;
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
    objectiveState: "active" | "concluded";
    agentContextBinding: {
      actorKind: "orchestrator" | "handler" | "workflow-task";
      selectedAgentProfileId: string | null;
      loadedExtensionIds: string[];
      availableExtensionIds: string[];
      extensionContextFingerprints: Record<string, string>;
      aggregateCacheKey: string;
      externalInstructionFingerprint: string | null;
      agentContextFingerprint: string;
      boundAt: string;
    };
    worktree?: string;
    startedAt: string;
    updatedAt: string;
    concludedAt: string | null;
  }>;

  reportRequests: Array<{
    id: string;
    threadId: string;
    sourceCommandId: string;
    request: string;
    status: "pending" | "resolved" | "cancelled";
    resolvedEpisodeId: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }>;

  workflowRuns: Array<{
    id: string;
    threadId: string;
    smithersRunId: string;
    workflowName: string;
    workflowSource: "saved" | "artifact";
    entryPath: string | null;
    savedEntryId: string | null;
    productStatus: "running" | "waiting" | "continued" | "completed" | "failed" | "cancelled";
    // Projection fields written only from Smithers bridge events or bootstrap/reconnect reads.
    // Smithers remains authoritative for execution status, waits, approvals, timers, output,
    // transcript, task-attempt facts, and raw event state.
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
    pendingAttentionSeq: number | null;
    lastAttentionSeq: number | null;
    heartbeatAt: string | null;
    summary: string;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  workflowTaskAttempts: Array<{
    id: string;
    threadId: string;
    workflowRunId: string;
    smithersRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
    surfacePiSessionId: string | null;
    title: string;
    summary: string;
    kind: "agent" | "compute" | "static" | "unknown";
    status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    smithersState: string;
    prompt: string | null;
    responseText: string | null;
    error: string | null;
    cached: boolean;
    heartbeatAt: string | null;
    agentId: string | null;
    agentModel: string | null;
    agentEngine: string | null;
    agentResume: string | null;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  commands: Array<{
    id: string;
    toolItemId: string | null;
    turnId: string | null;
    workflowTaskAttemptId: string | null;
    surfacePiSessionId: string;
    threadId: string | null;
    workflowRunId: string | null;
    parentCommandId: string | null;
    toolName: string;
    executor:
      | "orchestrator"
      | "handler"
      | "workflow-task-agent"
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
      | "declined"
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

  commandEvents: Array<{
    id: string;
    commandId: string;
    toolItemId: string | null;
    turnId: string | null;
    surfacePiSessionId: string;
    seq: number;
    kind:
      | "command.requested"
      | "command.started"
      | "command.output_delta"
      | "command.progress"
      | "command.waiting"
      | "command.approval_requested"
      | "command.approval_resolved"
      | "command.child_linked"
      | "command.workspace_diff_updated"
      | "command.finished";
    data: Record<string, unknown>;
    artifactId: string | null;
    createdAt: string;
  }>;

  episodes: Array<{
    id: string;
    threadId: string;
    sourceCommandId: string | null;
    requestId: string | null;
    kind: "update" | "conclusion";
    outcome: "succeeded" | "failed" | "cancelled" | null;
    title: string;
    summary: string;
    body: string;
    createdAt: string;
  }>;

  ciRuns: Array<{
    id: string;
    threadId: string;
    workflowRunId: string;
    smithersRunId: string;
    workflowId: string;
    entryPath: string;
    status: "passed" | "failed" | "cancelled" | "blocked";
    summary: string;
    createdAt: string;
    updatedAt: string;
    startedAt: string;
    finishedAt: string;
  }>;

  ciCheckResults: Array<{
    id: string;
    ciRunId: string;
    workflowRunId: string;
    checkId: string;
    label: string;
    kind: string;
    status: "passed" | "failed" | "cancelled" | "skipped" | "blocked";
    required: boolean;
    command: string[] | null;
    exitCode: number | null;
    summary: string;
    artifactIds: string[];
    startedAt: string | null;
    finishedAt: string | null;
  }>;

  artifacts: Array<{
    id: string;
    sessionId: string;
    threadId: string | null;
    workflowRunId: string | null;
    workflowTaskAttemptId: string | null;
    sourceCommandId: string | null;
    kind: "text" | "log" | "json" | "file";
    name: string;
    path: string;
    mimeType: string;
    bytes: number;
    sha256: string;
    content?: string;
    createdAt: string;
    deletedAt: string | null;
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
        | "commandEvent"
        | "episode"
        | "ciRun"
        | "ciCheckResult"
        | "artifact"
        | "requestUserInput";
      id: string;
    };
    data?: Record<string, unknown>;
  }>;
};
```

`workspace.artifactDir` is a workspace read-model copy of the resolved app artifact-store setting used
for copied durable artifacts in that workspace runtime. The app setting defaults to
`~/.config/svvy/artifacts` and may be changed through General settings. It is not inferred from the
repository checkout and is not supplied by agents when they create artifacts.

## Surface Target Identity

All surface-scoped runtime traffic should carry an explicit surface target:

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

## Workspace Updates Versus Surface Updates

Structured session state is durable workspace state.

It is not the live transcript cache for every open surface and it is not Dockview layout state.

Hard-deleted workspace sessions leave a durable tombstone outside the normal session row graph. The tombstone is not rendered as a session, but every structured-state write path and pi-session sync path must treat it as authoritative so stale focus, read, archive, pin, title-generation, or list refresh work cannot recreate a deleted session row.

The adopted runtime split is:

- workspace updates carry structured session summaries, thread summaries, workflow summaries, command rollups, wait state, and other metadata-first read models keyed by `workspaceSessionId`
- surface updates carry one live surface snapshot keyed by `surfacePiSessionId`
- Dockview panel state binds a UI panel to a surface locally and is free to change without mutating structured session state

This means:

- workspace summaries must keep updating even when no panel is focused on the affected surface
- surface transcript updates must not require the backend to nominate one global active surface
- renderer code must not poll read APIs or infer lifecycle repair from transcript mutations

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
- whether the current objective is active or concluded
- which generated agent context binding and loaded extension ids are attached to that handler thread
- which workflow runs are active or recent under that thread, derived from workflow-run records
- which report requests are pending or resolved under that thread

A thread is not itself a workflow run.

It is the supervising pi-backed interactive surface for that delegated objective.

### Workflow Run

Workflow-run records exist because the product needs a top-level durable summary of Smithers executions without copying Smithers internals into `svvy`.

They answer:

- how many workflow runs happened under a thread
- which runnable entry shape was used and whether it came from the saved library or an artifact workflow
- which Smithers run id corresponds to each execution
- the normalized product run status plus projected raw Smithers status and wait kind
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

Command records also anchor live projection. A tool card may begin rendering from transient
turn-item argument snapshots before the command record exists, but once the runtime accepts the tool
call, durable progress, output, approval, wait, child-link, workspace-diff, and terminal updates
belong to the command record through ordered command events. Renderer-local state and transcript
text are never the recovery source for a tool card.

### Episode

Episodes are the durable semantic outputs reused later by the orchestrator and shown to the user.

In the delegated model, the most important invariant is:

- a handler thread may emit many update or conclusion episodes over time
- each update episode marks important handler-authored information for orchestrator reconciliation
- each conclusion episode marks one moment where that thread returned control to the orchestrator

Waiting inside a handler thread does not create a wait episode.

A thread episode is created when the handler thread explicitly calls `thread_report`. If the report
omits `outcome`, `svvy` records an update episode and leaves the objective state unchanged. If the
report supplies `outcome`, `svvy` records a conclusion episode and changes the current objective
from `active` to `concluded`. The resulting typed orchestrator queue item is a reconciliation
notification for already-recorded state. Cancelling or deleting that notification does not roll back
the episode and does not return a tool error to the handler.

The terminal report back to the orchestrator is:

- the thread's concluded objective state
- the latest conclusion episode emitted by that thread

### Project CI

Project CI records exist because configured repository checks need structured product state while still executing through normal Smithers workflow runs.

They answer:

- whether the latest configured CI run passed, failed, was blocked, or was cancelled
- which workflow run produced that answer
- which exact checks ran inside that CI run
- which artifacts and logs explain failures

Project CI records are not inferred from arbitrary workflow output.

They are recorded only from terminal output of a runnable entry that declares `productKind = "project-ci"` and whose output validates against that entry's declared `resultSchema`.

### Artifact

Artifacts exist because execution byproducts, evidence, logs, submitted `execute_typescript` snippets, workflow exports, and related files sometimes need stable file-backed durable handles outside the normal repository tree.

Artifacts are thread- and command-addressable first.

They should not depend on episode attachments to exist.

A normal repository file edited by the agent is workspace state, not automatically an artifact.

If a file is part of the repository state the user asked to change, it should be represented as a normal workspace file write. If the content is small enough to answer directly, it should remain transcript text or command summary text. Artifact records are for durable byproducts and evidence that should remain inspectable but should not normally become repository files.

### Session Navigation Metadata

Session navigation metadata exists so the workspace sidebar can stay useful without turning into a general folder system.

The adopted session navigation fields are:

| Field        | Why it exists                                                                 |
| ------------ | ----------------------------------------------------------------------------- |
| `pinnedAt`   | Places an active session at the top of the session sidebar.                   |
| `archivedAt` | Moves a session into the single Archived group without deleting its history.  |

Archiving a session should clear `pinnedAt`.

Unarchiving a session should clear `archivedAt` and leave the session unpinned.

The Archived group collapsed state is workspace UI state, not per-session state.

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
- orchestrator turns persist session-level routing decisions such as `reply`, `execute_typescript`, `clarify`, or `thread_start`
- handler-thread turns persist delegated-supervision decisions such as `reply`, `execute_typescript`, `clarify`, `request_user_input`, `load_extension`, `workflow_list_models`, `smithers_run_workflow`, `smithers_get_run`, `smithers_resolve_approval`, or `thread_report`
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
| `title`              | Compact human-readable label. Defaults to the objective at creation, then may be generated by the configured namer from the objective. |
| `objective`          | Durable statement of what this thread owns, supplied by `thread_start`.                                                     |
| `objectiveState`     | Captures only whether the current delegated objective is `active` or `concluded`.                                          |
| `agentContextBinding` | Records the generated agent context binding for this handler thread, including loaded extension ids, available extension ids, aggregate cache key, and generated agent context fingerprint. |
| `worktree`           | Records the bound worktree when relevant.                                                                                  |
| `startedAt`          | Orders thread creation.                                                                                                    |
| `updatedAt`          | Enables recency-based selectors.                                                                                           |
| `concludedAt`        | Marks when the current objective most recently became concluded. Clear it when `thread_resume` activates a new objective in the same thread. |

### Thread Objective State Semantics

Use thread objective state this way:

- `active` while the handler still owns the current delegated objective
- `concluded` after `thread_report` with `outcome` durably records a conclusion episode for the
  current objective

This state describes objective lifecycle only, not whether the thread surface can still receive
direct messages and not whether handler or workflow work is currently running.

Handler activity is derived from turn records. Workflow activity, waiting, failure, cancellation,
and repair context are derived from workflow-run records and Smithers state. UI row subtitles may
project those derived facts, but they are not a thread-control API status.

A concluded thread surface remains directly interactive after conclusion.

A follow-up chat turn may leave `objectiveState` unchanged.

Explicit orchestrator `thread_resume` may move a concluded thread back to `active` for a new
objective, preserving earlier episodes as durable history.

If the same terminal workflow snapshot is replayed after conclusion during final reconciliation or
recovery, the thread remains `concluded` because that replay does not start a new objective.

## Report Request Model

Report-request records exist because the orchestrator can ask a handler for an explicit update
without resuming or replacing the handler objective.

They answer:

- which orchestrator request text was delivered to the handler
- which handler thread owns the answer
- whether the request is still pending, was resolved by an episode, or was cancelled
- which episode resolved the request

Report requests are created by `thread_request_report`. The durable request is recorded before the
handler `report_request` queue item is created. A successful `thread_report` with the matching
`requestId` records the episode and marks the request `resolved` in the same product transaction.

## Workflow Run Model

### Workflow Run Fields

| Field                   | Why it exists                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `id`                    | Stable local workflow-run handle.                                                         |
| `threadId`              | Links the run to the handler thread that owns it.                                         |
| `smithersRunId`         | Canonical link back to Smithers.                                                          |
| `workflowName`          | Product-visible workflow identifier.                                                      |
| `workflowSource`        | Distinguishes saved-library entry execution from artifact-entry execution.                |
| `entryPath`             | Records the runnable entry path used for the run when relevant.                           |
| `savedEntryId`          | Records which saved runnable entry was launched when relevant.                            |
| `productStatus`         | Captures the normalized top-level run status used by `svvy` read models.                  |
| `smithersStatus`        | Projects the last applied raw Smithers run status for faithful inspection and reconnect behavior; Smithers remains authoritative. |
| `waitKind`              | Projects whether a waiting run is blocked on approval, event, or timer.                   |
| `continuedFromRunIds`   | Preserves run lineage when Smithers continues the workflow as a new run.                  |
| `activeDescendantRunId` | Points at the active descendant run when Smithers continued this run as new.              |
| `lastEventSeq`          | Stores the most recent applied Smithers event sequence for reconnect.                     |
| `pendingAttentionSeq`   | Stores the most recent attention-worthy Smithers event sequence not yet delivered to the handler. |
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

A thread may survive several workflow runs before it emits a conclusion episode, and it may later supervise more runs after `thread_resume` activates a new objective in the same thread.

When a workflow run is `continued`, selector logic should follow `activeDescendantRunId` to find the currently active execution.

## Command Model

### CommandRecord Fields

| Field                | Why it exists                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                 | Stable command handle.                                                                          |
| `toolItemId`         | Links the command to the live turn item used by the renderer when one exists.                   |
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

For `smithers_*` commands, `facts` should preserve both the adopted agent-visible Smithers tool name and the underlying Smithers invocation metadata.

At minimum that should include:

- selected `workflowId` plus optional requested `runId` when the command is `smithers_run_workflow`
- semantic Smithers operation name such as `smithers_run_workflow`
- transport or bridge surface used
- raw Smithers operation name or endpoint
- forwarded arguments
- affected run id, node id, and iteration when relevant
- pre-status and post-status
- observed event-sequence range when a command is tied to workflow events

### Command Projection Events

`commandEvents` are append-only durable updates for command projection detail. They are lower-level
than `CommandRecord.facts` and higher-level than raw terminal buffers.

The stored `kind` values intentionally reuse the live command projection event discriminants from
`docs/specs/live-tool-projection.spec.md`. Transport adapters may translate wire-level names, but
structured state stores the canonical `command.*` names so renderer recovery and live rendering use
one vocabulary. `toolItemId` must be set whenever the command came from a turn item; commands
created outside a model tool item may leave it `null`.

They exist to recover and render:

- streamed command output
- patch/file-change snapshots
- TypeScript diagnostics and logs
- nested generated-client command links
- approval and wait state
- workspace diff snapshots after file-changing commands
- runtime progress for long-running commands such as extension builds

Rules:

- `seq` is strictly increasing per `commandId`.
- `data` stores already-redacted structured payloads only.
- large output belongs in file-backed artifacts; `artifactId` links the event to the artifact when
  the event represents or summarizes artifactized data.
- terminal state must also be reflected on the owning `CommandRecord`.
- final facts on the command record are authoritative when they conflict with earlier events.
- partial pre-command tool arguments may be visible in the live surface, but they are not required
  to persist in `commandEvents` until the command record exists.
- current `smithers_*` bridge tools may continue to produce command records and command facts through
  the existing workflow-supervision model, but they are not required to emit this live projection
  event set until the Smithers bridge revamp adopts a replacement tool surface.

### CommandRecord Visibility

The adopted visibility levels are:

- `trace`
- `summary`
- `surface`

Use them this way:

- low-level reads, searches, and workflow discovery calls are usually `trace`
- material writes, artifact creation, `exec_command` command executions, and failures usually roll up as `summary`
- `thread_start`, `thread_resume`, `thread_request_report`, `thread_report`, `load_extension`,
  `request_user_input`, and Smithers-mutating commands such as `smithers_run_workflow`,
  `smithers_resolve_approval`, `smithers_runs_cancel`, and `smithers_signals_send` are normally
  `surface`
- read-only Smithers inspection commands are usually `summary` unless the UI chooses to surface a specific one directly
- child generated-client commands remain nested detail by default

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
- `declined`
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
| `threadId`        | Links the episode to the thread that authored the report.                                                                          |
| `sourceCommandId` | Optional provenance link to the most relevant command when that linkage matters. It does not mean the command emitted the episode. |
| `requestId`       | Optional link to the report request resolved by this episode.                                                                      |
| `kind`            | `update` for intermediate reports; `conclusion` for reports that conclude the current objective.                                  |
| `outcome`         | `succeeded`, `failed`, or `cancelled` for conclusion episodes; `null` for update episodes.                                        |
| `title`           | Compact label for lists and cards.                                                                                                 |
| `summary`         | Short durable digest.                                                                                                              |
| `body`            | The reusable semantic content.                                                                                                     |
| `createdAt`       | Orders the episode in the session lifecycle.                                                                                       |

### Episode Meaning

Episodes are intentionally simple.

They are not the main machine-readable routing contract.

The machine-readable routing and lifecycle contract belongs in:

- turn decision
- thread objective state
- report-request state
- workflow-run state
- command facts

For handler threads, an episode is the semantic report sent back to the orchestrator.

The control-plane half is the thread's current objective state plus its durable links to workflow
runs, commands, artifacts, report requests, and waits.

Handler-thread episodes are ordered durable reports produced by explicit `thread_report` calls, not
a promise that the thread surface becomes unreadable or unaddressable afterward.

Commands, including `execute_typescript`, may produce their own summaries and artifacts.

Those command-level summaries are not episodes.

## Project CI Model

### CI Run Fields

| Field           | Why it exists                                                             |
| --------------- | ------------------------------------------------------------------------- |
| `id`            | Stable CI run handle.                                                     |
| `threadId`      | Links the CI run to the handler thread that launched or supervised it.    |
| `workflowRunId` | Links the CI run to the local workflow-run record that produced it.       |
| `smithersRunId` | Links the CI run to the canonical Smithers run.                           |
| `workflowId`    | Records the runnable CI entry id, usually `project_ci`.                   |
| `entryPath`     | Records the saved CI entry path used for the run.                         |
| `status`        | Captures passed, failed, cancelled, or blocked outcome.                   |
| `summary`       | Gives the orchestrator and UI a concise CI outcome summary.               |
| `createdAt`     | Records when the projection row was first created.                        |
| `updatedAt`     | Records the latest idempotent projection update.                          |
| `startedAt`     | Records CI start time, using workflow timing when the output omits it.    |
| `finishedAt`    | Records CI finish time, using workflow timing when the output omits it.   |

### CI Check Result Fields

| Field           | Why it exists                                                               |
| --------------- | --------------------------------------------------------------------------- |
| `id`            | Stable CI check result handle.                                              |
| `ciRunId`       | Links the check to the CI run.                                              |
| `workflowRunId` | Links the check back to the workflow run for inspection joins.              |
| `checkId`       | Stable check id inside the CI entry, used for idempotent upserts.           |
| `label`         | Human-readable check label.                                                 |
| `kind`          | Open check category such as typecheck, test, lint, build, docs, or manual. |
| `status`        | Captures passed, failed, cancelled, skipped, or blocked outcome.            |
| `required`      | Indicates whether this check contributes to overall CI status.              |
| `command`       | Command argv when the check maps to a subprocess; `null` for manual checks. |
| `exitCode`      | Process exit code when applicable.                                          |
| `summary`       | Concise check outcome.                                                      |
| `artifactIds`   | Links to logs, reports, screenshots, or other artifacts.                    |
| `startedAt`     | Optional check start time.                                                  |
| `finishedAt`    | Optional check finish time.                                                 |

CI check `kind` is intentionally open-ended.

Recommended built-in values include:

- `typecheck`
- `test`
- `lint`
- `build`
- `integration`
- `docs`
- `manual`

The idempotency rule is:

- one `ci_run` per `workflowRunId`
- one `ci_check_result` per `ciRunId + checkId`

No runtime component may create these records by reading workflow logs, Smithers node outputs, final prose, or command names.

## Artifact Model

The Artifacts extension record and callable `svvyx artifacts ...` API are defined in
`docs/specs/extension/artifacts.extension.spec.md`.

### Artifact Fields

| Field                   | Why it exists                                                                 |
| ----------------------- | ----------------------------------------------------------------------------- |
| `id`                    | Stable artifact handle.                                                       |
| `sessionId`             | Links the artifact to the owning session.                                      |
| `threadId`              | Links the artifact to the owning thread when relevant.                         |
| `workflowRunId`         | Links the artifact to the workflow run that produced it when relevant.         |
| `workflowTaskAttemptId` | Links the artifact to the workflow task attempt that produced it when relevant. |
| `sourceCommandId`       | Links the artifact back to the command attempt that produced it.               |
| `kind`                  | Internal projection category such as text, log, json, or file.                |
| `name`                  | Human-readable artifact label.                                                |
| `path`                  | Absolute copied artifact path inside the configured artifact directory.        |
| `mimeType`              | MIME type used for preview selection and agent-facing metadata.                |
| `bytes`                 | Byte size of the copied artifact file.                                         |
| `sha256`                | Lowercase hex SHA-256 digest of the copied artifact file bytes.                |
| `content`               | Optional internal preview-cache content for legacy/small artifact projections; not canonical artifact content and not part of the Artifacts v1 create API. |
| `createdAt`             | Orders artifact creation.                                                     |
| `deletedAt`             | Tombstone timestamp when the artifact is deleted; `null` while active.         |

Every submitted `execute_typescript` snippet must land in this table as a file-backed artifact before execution begins.

Explicit agent-created artifacts are created through `svvyx artifacts create --path <file> --json`.
The source file is copied into `workspace.artifactDir`; the artifact record stores the copied path
and runtime-derived ownership links. Agents do not supply `sessionId`, `sourceCommandId`,
`workflowRunId`, or `workflowTaskAttemptId`.

Artifact deletion is a tombstone lifecycle transition. `svvyx artifacts delete --id <artifact_id>
--json` sets `deletedAt`, removes the copied artifact file when present, leaves historical command
and thread links intact, and emits `artifact.deleted`.

### Artifact Preview Isolation

Artifact records may be projected as text, JSON, log, image, or HTML previews, but preview rendering is not a trust boundary for artifact content. Visible HTML previews must use sandboxed iframes. Script-capable previews may grant `allow-scripts`, but that sandbox still omits `allow-same-origin`, top navigation, popups, and form submission by default.

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
- `agentContext.updated`
- `command.requested`
- `command.started`
- `command.waiting`
- `command.finished`
- `episode.created`
- `ciRun.recorded`
- `ciCheckResult.recorded`
- `artifact.created`
- `artifact.deleted`
- `requestUserInput.created`
- `requestUserInput.answered`
- `requestUserInput.completed`
- `requestUserInput.cancelled`
- `session.wait.started`
- `session.wait.cleared`

## Waiting Semantics

Waiting is a shared lifecycle concept, not a separate execution subsystem.

### Surface And Workflow Waits

Waiting does not mutate thread objective state and does not create a thread-status value.

Use surface-local wait projection when an orchestrator or handler turn is blocked and the product
needs to record why the owning surface cannot make progress.

Common cases are:

- a blocking `request_user_input` call waiting on user clarification
- other external dependencies

Use Smithers workflow wait state for workflow-owned approval waits, signal waits, timer waits, and
other workflow-blocking conditions. `svvy` may project those waits into workspace navigation and
handler attention, but the authoritative workflow wait stays in Smithers and the `svvy`
workflow-run projection.

`svvy` execution-permission approvals are distinct from Smithers workflow approvals. A shell,
`apply_patch`, network, or sandbox approval raised by `exec_command`/direct-tool runtime is owned by
the exact orchestrator surface, handler thread, or workflow task-agent attempt that made the tool
call. A Smithers approval wait is owned by Smithers run/node state. These two approval sources may
both project as waiting in the UI, but their records, resolution APIs, and cache scopes must not be
merged.

Rules:

- keep `thread.objectiveState` unchanged
- record the blocked condition on the owning surface, session frontier, workflow run, or Smithers
  wait record as appropriate
- for user clarification, record a real request-user-input request and question record; do not store
  a generic user wait without the request identity
- do not create a wait episode
- clear the wait projection when runnable work resumes for that owner

### Session Wait

`session.wait` exists only when the whole active frontier is blocked.

Use it when:

- some interactive surface is waiting on user, approval, signal, timer, or other external input
- there are no runnable surfaces left in the session

`session.wait` must point back to the owner:

- the orchestrator surface
- or one handler thread

If the blocked owner is a workflow task-agent attempt, `session.wait` must still route through the
owning handler thread and include enough Smithers attempt identity for the UI to highlight the exact
task attempt. Approving or denying that execution-permission request resumes or aborts only that
blocked tool call; it must not resolve Smithers workflow approval nodes and must not affect other
actor sessions.

If the blocked owner is a blocking `request_user_input` call, `session.wait` must include the
generated request id and route answer submission to the exact owning `surfacePiSessionId`, turn, and
command. It must not route by title, question text, focused panel, or active workspace tab.

## Derived Read Model

The stored facts remain canonical.

Selectors should derive workspace-shell and sidebar data from those facts.

### Session Summary

The adopted session summary selector should return:

- `title`
- `isPinned`
- `pinnedAt`
- `isArchived`
- `archivedAt`
- `sessionStatus`
- `wait`
- `counts`
- `threadIds`
- `latestEpisodePreview`
- `latestWorkflowRunSummary`

### Session Status Rules

The summary selector should derive parent session status from orchestrator-local state in this order:

1. if `session.wait` exists and is orchestrator-owned, the session status is `waiting`
2. else if any orchestrator turn failed, the session status is `error`
3. else if any orchestrator turn is waiting, the session status is `waiting`
4. else if any orchestrator turn is running, the session status is `running`
5. else the session status is `idle`

Handler-thread and workflow-run activity stays row-local through handler and workflow sidebar projections rather than changing the parent session row's status.

No other input participates in parent session status:

- not live `activePrompt` flags
- not transcript stop reasons
- not transcript JSONL scans
- not renderer-side overlays or repair state

Pinned and archived state controls sidebar grouping and ordering. It must not change session lifecycle status.

A currently open surface may still render live transcript streaming locally, but that does not create a second session-summary status source.

### Main Session View

The main session UI should primarily read:

- handler threads
- thread objective state and pending report requests
- latest workflow-run state per thread
- latest thread episodes and episode history
- artifacts
- Project CI summaries

Transcript replay is not an allowed mechanism for these product surfaces once structured writes exist.

Workflow-task-attempt projection follows the same rule: read APIs must not discover or repair task ownership by heuristic polling. The sanctioned bootstrap read uses the exact Smithers task-attempt identity from the current task context to bind the active task agent before task-local commands run.

## SQLite Notes

The real implementation should store session-scoped rows for:

- `turn`
- `thread`
- `agent_context_binding`
- `workflow_run`
- `command`
- `report_request`
- `request_user_input_request`
- `request_user_input_question`
- `request_user_input_answer`
- `episode`
- `ci_run`
- `ci_check_result`
- `artifact`
- `event`

Recommended implementation rules:

- every row should carry `session_id`
- `thread.surface_pi_session_id` should be unique
- generated agent context binding rows should preserve one current binding per `surface_pi_session_id`, external instruction fingerprints when external instructions reached the actor, bound time, and historical binding events for inspection
- `workflow_run.smithers_run_id` should be unique
- `report_request.thread_id` should be indexed for pending request lookup, and `report_request.resolved_episode_id` should link to the episode that answered it
- `episode.thread_id` should be indexed for ordered lookups; it should not be unique because a thread may emit more than one update or conclusion episode over its lifetime
- artifact tables should preserve path indexes for file-backed lookups

## Responsibility Split

Write responsibility is:

- ordinary orchestrator-turn writes, including turn decisions, and root command writes belong to the `svvy` runtime
- Thread write-tool contracts, including `thread_start`, `thread_resume`, `thread_request_report`, and `thread_report`, are defined in `docs/specs/extension/thread_managing.extension.spec.md`
- handler-thread turn writes, including turn decisions, and command writes belong to the `svvy` runtime over pi thread surfaces
- `load_extension` updates the current actor's loaded and available extension binding, is idempotent when the extension is already loaded, and refreshes generated agent context before the next model call
- workflow-run writes belong to the Smithers bridge
- workflow-task-attempt projection stores svvy-owned product metadata such as `meta.promptBinding` on the exact Smithers attempt address while leaving Smithers-owned run, node, attempt, retry, wait, output, usage, and transcript facts in Smithers durable state
- Project CI writes belong to the runtime or bridge path that handles terminal Smithers runs from entries declaring `productKind = "project-ci"` and validates their terminal output against the declared CI result schema
- wait writes belong to the `svvy` runtime
- thread read tools (`thread_current`, `thread_list`, and `thread_episodes`) read durable structured state and the active prompt runtime binding without creating command records or writing lifecycle facts; concrete thread read-tool contracts are defined in `docs/specs/extension/thread_managing.extension.spec.md`

No runtime component may synthesize `turnDecision`, thread, workflow-run, Project CI, or wait facts from transcript prose after the fact.

Read APIs and selectors are projection-only for lifecycle state:

- they may read current durable facts and explicit active-surface state
- they must not mutate thread, workflow-run, Project CI, or wait state during reads
- they must not poll Smithers or parse transcript files to compensate for missing writes
- they must not refresh pi session metadata as a side effect of summary reads; that metadata belongs on explicit session mutations and prompt-settlement writes

## Invariants

The implementation must enforce these invariants:

- every mutating or work-producing tool call creates exactly one command record; low-noise thread read tools are projection reads rather than command-producing work
- a handler thread owns exactly one backing `surfacePiSessionId`
- generated agent context bindings are durable surface state and survive resume
- `load_extension` may only load extensions available and ready for the current actor binding
- a thread may have many workflow runs over time
- a handler thread may wait and resume many times
- a handler thread remains message-addressable after concluding an objective
- a concluded thread may later return to `active` only through `thread_resume`
- a conclusion episode may be created only when a thread has an active objective, owns no active workflow runs, and explicitly calls `thread_report` with `outcome`
- an update episode may be created for an active or concluded objective by calling `thread_report` without `outcome`
- a pending report request may be resolved only by a successful `thread_report` carrying that request id
- a thread may be waiting only on real blocked conditions such as a blocking request-user-input
  record, approval, signal, timer, or external dependency, not on a fake wait episode
- `session.wait` must be cleared when runnable work exists again
- a turn must end in exactly one of: `completed`, `failed`, or `waiting`
- a workflow-task command must attach to an existing workflow-task-attempt record identified from explicit runtime state or the current Smithers task-attempt identity, not from resume handles or best-effort fallback behavior

## Non-Goals

This spec does not attempt to:

- copy full Smithers node internals into `svvy`
- make the episode schema carry all machine-readable routing state
- flatten handler-thread and workflow-run state into one record type
- rely on transcript replay for session summary, navigation, or wait state
- repair missing workflow lifecycle state through read-side polling or reconciliation
- define the exact final desktop UI layout
