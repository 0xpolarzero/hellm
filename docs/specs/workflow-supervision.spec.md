# Workflow Supervision Spec

## Status

- Date: 2026-04-21
- Status: adopted direction for write-driven workflow supervision
- Scope of this document:
  - define how `svvy` supervises Smithers runs under handler threads
  - define the required runtime flow after Smithers-native run-launch and supervision commands
  - define recovery, reconnect, wake-up, and cleanup behavior
  - separate the borrowed Smithers transport shape from `svvy`-owned product behavior

## Purpose

`svvy` needs workflow supervision to be a real product subsystem rather than a thin tool wrapper.

Starting a Smithers run is not enough.

The product also needs to:

- keep the run attached to the supervising handler thread
- project workflow state into durable `svvy` state while the run is alive
- wake the handler thread back up when the workflow needs another decision
- recover cleanly after app restart or stream interruption
- clean up only the affected run without disturbing other delegated work

## Product Fit

The PRD and current specs define:

- one orchestrator that owns strategy
- handler threads that own delegated objectives
- Smithers as the workflow execution engine
- explicit backend-to-renderer workspace updates and surface updates
- structured session state as the product read model

This means workflow supervision is:

- a handler-thread responsibility
- write-driven product behavior above Smithers
- not transcript inference
- not orchestrator polling
- not a separate execution engine

This spec refines section 5 of [progress.md](../progress.md) and the workflow-run parts of the [Structured Session State Spec](./structured-session-state.spec.md).

## Two Smithers Contexts

This repo contains two different Smithers contexts and they must not be conflated.

### 1. Repo Authoring Workflows

The repo-root [`workflows/`](../../workflows/README.md) workspace exists so engineers and agents can use Smithers to build and maintain `svvy` itself.

Those workflows:

- are source-checkout authoring assets
- may rely on repo-local `node_modules`, `smithers.db`, prompts, and scripts
- are not the shipped product runtime
- are not the workflow registry that `svvy` should supervise inside the desktop app

### 2. Product Runtime Workflows

The shipped app also needs Smithers workflows, but those are a different thing.

Product runtime workflows:

- are the workflows supervised by `svvy` handler threads inside the desktop app
- must work in a packaged build without a source checkout
- must not depend on repo-root `workflows/`, `workflows/node_modules/.bin/smithers`, or `workflows/smithers.db`
- may come from saved entries under `.svvy/workflows/entries/`
- may come from artifact entries under `.svvy/artifacts/workflows/<artifact_workflow_id>/entries/`

When this spec says "workflow" without qualification, it means product runtime workflows, not the repo authoring workspace.

## Out Of Scope

This spec does not define:

- workflow selection policy beyond the Smithers supervision surface itself
- workflow authoring UX
- the exact workflow library shape
- renderer visuals beyond the state and sync requirements needed to support them

Those remain separate steps and specs such as `docs/specs/workflow-library.spec.md`.

## Borrowed Boundary

`svvy` should borrow Smithers control-plane transport and inspection surfaces rather than inventing a separate workflow polling model or workflow debugger.

The relevant Smithers surfaces are:

- per-run progress events emitted by `runWorkflow`
- HTTP run-event streaming with reconnect by `afterSeq`
- Gateway snapshot and streaming surfaces for long-lived clients and live graph inspection
- official read models such as run summary, blocker diagnosis, node detail, transcript, artifacts, and raw event history

The borrowed part is:

- attaching to a Smithers run control-plane stream or read surface
- filtering by run id and node id where needed
- reconnecting from a known event sequence or re-baselining from an official snapshot
- preserving raw Smithers run status and lineage instead of flattening it into thread state

The `svvy`-owned part is:

- workflow-run records
- handler-thread state projection
- synthetic handler wake-ups
- workspace and surface update emission
- cleanup and isolation rules
- restart recovery and supervision durability

## Adopted Direction

- Workflow lifecycle state is write-driven. Live Smithers event attachment is one sanctioned lifecycle producer, and reconnect or bootstrap control-plane reads are another sanctioned lifecycle producer when they immediately project durable state.
- There is no silent polling fallback for `svvy`-owned workflow supervision. Reconnect or bootstrap reads are explicit lifecycle writes, not background read-side repair.
- One handler thread may supervise many workflow runs over its lifetime.
- For this supervision slice, one handler thread should own at most one active Smithers run at a time.
- Workflow task agents are a lower-level actor class inside Smithers tasks, not another `svvy` interactive surface.
- `svvy` should derive active and latest workflow summaries from workflow-run records and recency rules rather than persisting a thread-level latest-workflow pointer.
- Workflow attention must reacquire and target the owning handler surface by `surfacePiSessionId`, never a globally active surface or the currently focused pane.
- `thread.start`, `thread.handoff`, and `wait` remain the only `svvy`-native control tools in this area.
- Agent-facing workflow supervision should use Smithers-native semantic tools exposed through the Bun bridge rather than a svvy-defined `workflow.*` abstraction.
- Shipped product runtime must not depend on repo-root `workflows/`, repo-relative Smithers binaries, or nearest-db path walking.
- Runnable saved entries should live under `.svvy/workflows/entries/`, while artifact entries should live under `.svvy/artifacts/workflows/<artifact_workflow_id>/entries/`, and neither should depend on the repo authoring workspace.
- A workflow run never returns control directly to the orchestrator.
- Only `thread.handoff` returns control to the orchestrator.
- If a handler thread opens a workflow run for its current objective span, that thread stays responsible until the span ends in `thread.handoff`; waits, approvals, resumes, and repairs stay inside the handler lifecycle.
- Workflow-task-attempt projection is write-driven from the current Smithers attempt identity and explicit runtime handlers. When a task-local tool needs the attempt before handler-side projection has landed, the bootstrap path is an exact persisted resume-handle lookup against the Smithers attempt row, not a heuristic scan or fallback chain.

## Core Concepts

### Smithers Run

A Smithers run is the canonical execution instance inside Smithers.

It owns:

- event emission
- node execution
- retries and pauses
- terminal workflow outcome

### `svvy` Workflow-Run Record

A `svvy` workflow-run record is the product-level durable summary of one Smithers run under one handler thread.

It exists so `svvy` can reason about:

- which run belongs to which thread
- what the run currently means for the delegated objective
- what the UI should show
- what should happen after restart

### Workflow Monitor

A workflow monitor is the Bun-side runtime helper that:

- attaches to the Smithers event stream for one workflow run
- contributes normalized workflow lifecycle writes into the durable `workflow-run` record
- handles live attachment, reconnect, and teardown around that durable state

The monitor is runtime state, not transcript state and not the durable lifecycle source of truth.

### Workflow Task Agent

A workflow task agent is the lower-level worker attached to one Smithers task.

It is:

- hosted by Smithers inside a task attempt
- configured with model, reasoning, system prompt, and task-local tools
- not a `svvy` session surface, handler thread, or workflow supervisor

Smithers owns the task agent's:

- prompt execution
- output validation
- retries and fallback chains
- approval gates
- hijack behavior

`svvy` owns only the higher-level product projection and the surrounding handler-thread supervision.

That projection should treat the Smithers task attempt as a real durable product record, not as transcript-only internal noise.

### Handler Attention

Handler attention means a workflow state transition now requires another handler-thread decision.

The important cases are:

- workflow entered an actionable durable wait
- workflow completed
- workflow failed
- workflow was cancelled
- workflow continued as new and lineage now needs relinking
- supervision transport became irrecoverably degraded

## End-To-End Flow

The adopted flow is:

1. The orchestrator delegates an objective into a handler thread.
2. The handler thread selects, writes, or receives a concrete workflow to run.
3. The handler thread calls `smithers.run_workflow({ workflowId, input, runId? })` or another Smithers-native supervision tool through the Bun bridge.
4. `svvy` launches or resumes the Smithers run and obtains the concrete Smithers run id.
5. `svvy` persists or updates the workflow-run record immediately.
6. `svvy` records the workflow-run state needed for later reconnect and wake-up dedupe.
7. `svvy` attaches or restores the runtime helper for that workflow run and uses it to emit write-driven lifecycle projection into durable `svvy` state.
8. When Smithers task attempts exist under that run, `svvy` projects first-class workflow-task-attempt records keyed by `runId`, `nodeId`, `iteration`, and `attempt`, plus durable nested transcript, command, and artifact traces for task-agent work.
9. The Bun side emits explicit workspace updates and surface updates whenever those durable projections change visible workspace state or the live handler surface state.
10. If the workflow reaches a state that needs another handler decision, `svvy` opens a synthetic background turn on that same handler thread.
11. The handler thread decides whether to inspect, repair, resume, ask the user, or hand control back with `thread.handoff`.

## Shipped App Integration

The shipped desktop app should run Smithers as an embedded product runtime, not by shelling out to the repo's authoring workspace.

The packaged-app contract is:

- bundle the product-owned Smithers bridge and supporting runtime assets with the app
- let the Bun side own the Smithers bridge, DB location, run lifecycle, and event projection for product workflows
- use embedded `smithers-orchestrator` APIs for lifecycle control rather than source-checkout-relative CLI paths
- let pi-facing tools talk to the Bun-owned bridge; they must not spawn `smithers` directly
- use official Smithers control-plane surfaces for monitoring and reconnect semantics:
  - `runWorkflow(...)` for direct start and resume behavior
  - multi-workflow server semantics such as `POST /v1/runs`, `POST /v1/runs/:runId/resume`, `POST /v1/runs/:runId/cancel`, and `GET /v1/runs/:runId/events?afterSeq=N` for lifecycle parity
  - Gateway-style devtools snapshots and streams when the product needs live graph inspection

The current source-tree bootstrap that points at repo-root `workflows/` may remain a development aid, but it is not the shipped design and must not be cited as the product runtime architecture.

## Workflow Task Agents

Product-runtime workflows may contain lower-level workflow task agents inside their task nodes.

The adopted direction is:

- when a product workflow needs an adaptive coding agent, use a PI-backed workflow task agent by default
- configure that task agent with a `svvy` workflow-task system prompt rather than the orchestrator or handler-thread prompt
- expose only task-local tool declarations to that actor
- the default adopted task-agent tool surface is `execute_typescript`
- project each Smithers task attempt into a durable `svvy` workflow-task-attempt record and attach any task-agent `execute_typescript` commands and artifacts to that attempt instead of leaving them in a local ephemeral trace
- do not expose `thread.start`, `thread.handoff`, `wait`, or `smithers.*` to workflow task agents
- do not load ambient pi built-in tools or workspace-discovered extension tools into the task agent runtime
- execute the task agent and its task-local tools from Smithers' current task root or worktree, while leaving Smithers runtime DB ownership and `svvy` workflow projection workspace-scoped
- preserve structured message arrays, step boundaries, and usage across retries, schema repair prompts, and hijack handoff instead of flattening continuation state into plain transcript prose
- stream live assistant deltas and tool updates so heartbeat freshness and UI activity reflect real task-agent progress rather than only terminal text

This is intentionally the same broad recipe family as the orchestrator and handler thread:

- model
- reasoning effort
- system prompt
- tools

But it is a different actor contract because the host and lifecycle are different:

- orchestrator and handler threads are pi sessions hosted by `svvy`
- workflow task agents are task-scoped agents hosted by Smithers

Smithers runtime controls around task agents stay outside the task-agent tool surface:

- approval belongs to Smithers approval nodes or task approval gates such as `<Approval>` or `needsApproval`
- hijack belongs to Smithers runtime or operator controls that reopen the underlying task-agent session

`svvy` should treat approvals and hijack as workflow-supervision state and operator surfaces around a run, not as ordinary callable tools for the task agent itself.

## Smithers Tool Surface

`svvy` should not define a parallel `workflow.*` API.

The shipped app should register Smithers-native workflow tools through the Bun-owned bridge.

The adopted naming rule is:

- when Smithers already publishes an agent-facing semantic tool name, use that name verbatim after the `smithers.` namespace prefix
- when Smithers exposes only a server route or Gateway method, keep the Smithers noun and verb shape instead of inventing a svvy alias
- the Bun bridge may adapt transport, auth, and packaging details, but it must not rename Smithers concepts into a competing product vocabulary

The exact contract is:

- the agent does not receive the raw embedded Smithers runtime object, a generic HTTP client for Smithers, direct MCP transport, or direct CLI execution rights
- `svvy` owns the actual tool registration and exposes first-party `smithers.*` tools to the model
- each exposed `smithers.*` tool is a narrow adapter around one Smithers semantic tool, server route, or Gateway method
- those adapters may add only product-runtime concerns that Smithers itself does not know about:
  - bind the call to the current handler thread or session
  - resolve bundled product workflow identifiers
  - normalize transport and packaging details for the desktop app
  - record durable `svvy` command facts, linkage, and lifecycle metadata
- those adapters must not create a second abstract API that renames Smithers concepts into `workflow.*` or other `svvy`-specific verbs when Smithers already provides the right vocabulary
- `svvy` does not need to expose every Smithers capability in v1, but whatever it does expose should preserve Smithers semantics rather than re-design them

Actor-specific exposure is part of that contract:

- the orchestrator prompt should know that handler threads can supervise workflows through `smithers.*`, but it should not receive the `smithers.*` generated tool schema in its own prompt
- handler-thread prompts should receive the `smithers.*` schema because they are the delegated surfaces that actually supervise workflow execution
- handler-thread prompts should not receive orchestrator-only tools such as `thread.start` in the default adopted model
- workflow task agents should receive only their task-local tool schema, which in the default adopted configuration is `execute_typescript`, with no ambient pi built-ins or extension-provided callable tools beyond that task-local set
- awareness of another actor's capabilities belongs in compact instructional prose, not in leaked callable declarations for tools that actor cannot invoke

The first adopted Smithers-native surface is:

| Agent-visible tool                    | Product class                       | Purpose                                                                                                                                                             | Primary adopted Smithers contract                                                                                                           |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `smithers.list_workflows`             | required                            | List runnable workflow entries, support targeted lookup such as `workflowId` and `productKind`, and return each entry's full handler-visible workflow contract for deeper inspection. | Smithers semantic tool `list_workflows`, backed by the app-owned workflow registry plus Bun-side contract compilation.                      |
| `smithers.run_workflow`               | required                            | Launch a discoverable workflow or resume the same run when Smithers still considers that run resumable, using `{ workflowId, input, runId? }`.                     | Smithers semantic tool `run_workflow`, backed by embedded `runWorkflow(...)`, `POST /v1/runs`, and `POST /v1/runs/:runId/resume` semantics. |
| `smithers.list_runs`                  | required                            | List recent runs and their compact summary state, while enriching each summary with svvy `sessionId` and `threadId` ownership when the run belongs to a recorded handler thread. | Smithers semantic tool `list_runs`, aligned with `GET /v1/runs` and Gateway `runs.list`, with svvy-side ownership projection layered on top. |
| `smithers.get_run`                    | required                            | Return the main run summary the handler needs to reason.                                                                                                            | Smithers semantic tool `get_run`, aligned with `GET /v1/runs/:runId` and Gateway `runs.get`.                                                |
| `smithers.watch_run`                  | bridge or UI                        | Watch a run until terminal or timeout.                                                                                                                              | Smithers semantic tool `watch_run`, backed by `onProgress` plus bridge-owned watch behavior.                                                |
| `smithers.explain_run`                | required                            | Explain why the run is blocked, waiting, stale, or otherwise attention-worthy.                                                                                      | Smithers semantic tool `explain_run`, aligned with Smithers `why` diagnostics.                                                              |
| `smithers.list_pending_approvals`     | required                            | List pending approvals relevant to the current run or node.                                                                                                         | Smithers semantic tool `list_pending_approvals`, aligned with approval queries over pending gates.                                          |
| `smithers.resolve_approval`           | required                            | Approve or deny a pending approval.                                                                                                                                 | Smithers semantic tool `resolve_approval`, aligned with approve-or-deny server semantics and Gateway approval decisions.                    |
| `smithers.get_node_detail`            | required                            | Inspect attempts, tool calls, token usage, and validated output for one node.                                                                                       | Smithers semantic tool `get_node_detail`.                                                                                                   |
| `smithers.list_artifacts`             | required                            | Inspect structured workflow artifacts and node outputs.                                                                                                             | Smithers semantic tool `list_artifacts`.                                                                                                    |
| `smithers.get_chat_transcript`        | required                            | Read workflow-related agent transcript grouped by attempts.                                                                                                         | Smithers semantic tool `get_chat_transcript`.                                                                                               |
| `smithers.get_run_events`             | required                            | Read raw lifecycle events and paginate by sequence.                                                                                                                 | Smithers semantic tool `get_run_events`, aligned with `GET /v1/runs/:runId/events?afterSeq=N`.                                              |
| `smithers.runs.cancel`                | required                            | Cancel an active run.                                                                                                                                               | `POST /v1/runs/:runId/cancel` and Gateway `runs.cancel`.                                                                                    |
| `smithers.signals.send`               | required when workflows use signals | Deliver a durable signal to a waiting run.                                                                                                                          | `POST /v1/runs/:runId/signals/:signalName` and Gateway `signals.send`.                                                                      |
| `smithers.frames.list`                | bridge or UI                        | Inspect rendered frames for timeline or inspector UIs.                                                                                                              | `GET /v1/runs/:runId/frames` and Gateway `frames.list` and `frames.get`.                                                                    |
| `smithers.getDevToolsSnapshot`        | bridge or UI                        | Read a DevTools tree snapshot for the workflow inspector.                                                                                                           | Gateway `getDevToolsSnapshot`.                                                                                                              |
| `smithers.streamDevTools`             | bridge or UI                        | Stream DevTools tree deltas for a live inspector.                                                                                                                   | Gateway `streamDevTools`.                                                                                                                   |

### Workflow Launch Contracts

Handler-visible workflow launch contracts must come from the actual runnable workflow definition, not from prompt prose, repo inspection, or a second handwritten manifest.

The adopted contract pipeline is:

- each discoverable runnable entry publishes one launch Zod schema plus explicit grouped asset refs
- product-lane entries may also publish `productKind` and `resultSchema`
- `svvy` compiles that launch schema into the handler-visible `launchInputSchema` when the workflow registry is loaded or refreshed
- `smithers.list_workflows({ workflowId?, productKind?, sourceScope? })` returns each runnable entry's `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, `launchInputSchema`, and optional product metadata such as `productKind` and `resultSchema`
- the Bun bridge exposes one stable `smithers.run_workflow({ workflowId, input, runId? })` tool for launch and resume
- the same launch Zod schema remains the runtime validation source when the tool is executed

Project CI is the first adopted product-lane entry.

For entries declaring `productKind = "project-ci"`, the bridge must preserve enough result-schema metadata for the runtime to validate terminal output before recording CI run and CI check result state.

No Smithers supervision path may classify a workflow run as Project CI from entry labels, command names, logs, node outputs, or final prose.

The handler-visible launch contract must preserve launch-side semantics:

- `workflowId` selects the runnable entry whose contract was returned by `smithers.list_workflows`
- required fields stay required
- optional fields stay optional
- defaulted fields remain omittable and surface their defaults in the generated schema
- `input` is the workflow-specific payload validated against `launchInputSchema`
- `runId` is optional resume addressing and is not part of the workflow-specific `launchInputSchema`
- runtime-only Smithers continuation plumbing does not appear in the handler-visible schema

The shared Smithers runtime input table shape used inside the embedded runtime is not a public contract for handler agents.

That internal runtime envelope exists only so Smithers can persist and continue runs safely inside its own runtime DB.

The first shipped bridge does not need to expose every Smithers operator surface to the agent.

These Smithers capabilities should be documented as existing but treated as non-v1 or operator-only unless the product explicitly adopts them later:

- CLI and operator flows such as `retry-task`, `replay`, `fork`, `timeline`, `diff`, `graph`, and `hijack`
- troubleshooting helpers such as `workflow path`, `workflow doctor`, and `agents doctor`
- human-loop operator commands such as `human answer` and `human cancel`

Every `smithers.*` command record should preserve both the adopted agent-visible tool name and the underlying Smithers invocation metadata, including transport, raw operation name, arguments, affected run or node, pre-status, post-status, and observed event-sequence range.

## Transport Rules

### Required Event Source

Supervised workflow runs must have a live event source.

If `svvy` cannot attach the supervision transport for a run, it should treat that as a workflow-supervision error rather than silently degrading into a different mode.

That means:

- no hidden timer-based polling fallback for normal supervision
- no renderer-side polling to guess whether workflow state changed
- no read-side writes that try to reconstruct supervision from ad hoc refreshes

### Reconnect

The supervision transport must support reconnect from the last applied event sequence or a fresh snapshot baseline.

Smithers HTTP run-event streaming already exposes reconnect by `afterSeq`, and Gateway-style live graph streams may require a fresh snapshot plus later deltas.

The adopted `svvy` rule is:

- persist enough durable cursor metadata per workflow run to reconnect after restart or stream interruption
- reconnect from the last applied sequence when the transport supports it, otherwise re-baseline from an official Smithers snapshot
- treat reconnect as part of normal supervision, not as a special operator action

### Bootstrap And Recovery Reads

One-shot reads are still allowed for:

- initial bootstrap after app launch
- recovery when a monitor is being reattached
- final reconciliation after a stream closes at a terminal state

Those reads should hydrate state or confirm the last known outcome.

They must not become the steady-state lifecycle transport.

## State And Projection Rules

### Thread Model

The thread remains the delegated-objective unit.

The thread does not store a persisted latest-workflow pointer.

Selectors should derive:

- the active workflow run for that thread, if any
- otherwise the most recently updated workflow run under that thread

### Workflow-Run Metadata Needed For Supervision

The supervision layer needs durable per-run metadata beyond the current high-level summary fields.

At minimum, `svvy` needs durable cursor metadata equivalent to:

- the last applied Smithers event sequence
- the most recent handler-attention point still pending delivery
- the last handler-attention delivery point for that workflow run

The exact storage shape may live directly on the workflow-run record or in closely related supervision metadata, but it must be durable enough for restart-safe reconnect and wake-up dedupe without relying on process-local memory.

### Projection Ownership

Workflow projection writes belong to the supervision bridge.

The bridge is responsible for updating:

- workflow-run status
- workflow-run summary
- thread wait state when the workflow enters a durable wait
- lifecycle events and artifacts that explain meaningful workflow transitions

The bridge must not rely on transcript parsing or read-side repair loops to keep workflow state current.

### Thread Status Semantics During Supervision

Use thread status this way:

- `running-handler` while the handler is actively reasoning, issuing tools, or otherwise working and no live workflow run currently owns forward progress
- `running-workflow` while a Smithers run is actively executing and the handler is idle but still owns the objective
- `waiting` when the delegated objective is durably blocked on user, approval, signal, timer, or other external input and no troubleshooting is required yet
- `troubleshooting` when a workflow failed, was cancelled, continued into a new run lineage, or lost reliable supervision and the handler must inspect or repair before deciding what to do next
- `completed` only when the handler thread itself has reached a terminal objective span and `thread.handoff` has closed that span

A workflow run becoming terminal does not by itself make the thread terminal.

A workflow failure or cancellation must move the thread into `troubleshooting` before any later user-directed closure or handoff.

## Handler Wake-Up Rules

### When To Wake The Handler

The supervision bridge should request handler attention when:

- a workflow enters an actionable `waiting-approval` or `waiting-event` state
- a workflow reaches `completed`
- a workflow reaches `failed`
- a workflow reaches `cancelled`
- a workflow reaches `continued`
- supervision cannot continue safely because transport or projection became irrecoverably degraded

Ordinary non-terminal progress events should update state and UI but should not wake the handler thread.

`waiting-timer` is normally monitor-owned and should not wake the handler on its own.

### How To Wake The Handler

When handler attention is needed, `svvy` should:

- acquire the backing pi session for that handler thread by `surfacePiSessionId`
- start a synthetic background turn on that same thread surface
- inject a synthetic user message that summarizes the workflow transition and the allowed next actions
- emit explicit workspace and surface updates so the renderer can follow the background work without polling

This is analogous to orchestrator resume after `thread.handoff`, but it targets the handler thread instead of the orchestrator.

### Prompt Content

The synthetic handler-resume prompt should include:

- thread id and objective
- workflow-run id and Smithers run id
- workflow name
- normalized workflow status plus raw Smithers status
- current workflow summary
- relevant wait kind, blocker diagnosis, lineage detail, or failure detail
- any important artifact or lifecycle references needed to act confidently
- an explicit instruction that the handler must now decide what to do next

The expected next actions are:

- inspect
- repair
- `smithers.run_workflow({ workflowId, input, runId })` when Smithers still considers that run resumable
- ask the user
- `thread.handoff`

### Dedupe And Coalescing

The handler must not be woken repeatedly for the same workflow transition.

The adopted rule is:

- supervision must track what transition has already been delivered to the handler
- repeated notifications for the same effective state should collapse into one pending handler-attention unit
- if the handler thread already has an active prompt, new workflow attention should be queued or coalesced rather than interrupting that active turn
- if no pane currently shows that thread, the runtime may keep the wake-up background-only and should release any temporary surface ownership after the turn settles

### Resume Versus Replacement Run

The stable `smithers.run_workflow({ workflowId, input, runId? })` surface may resume an existing run only when Smithers still considers that same run resumable under the same workflow source and input lineage.

If the handler edits workflow source, changes workflow input, or hits a Smithers non-resumable condition, it must start a replacement run instead of trying to resume the same run.

## Recovery And Restart

On app start or session restoration, `svvy` should:

1. find workflow runs that are not known terminal or still have undelivered handler attention
2. bootstrap each such run with a one-shot inspection read
3. reconnect each monitor from the last durable event sequence
4. re-emit any necessary handler attention that was durable but not yet delivered

Recovery must be precise per workflow run.

It must not:

- reopen unrelated threads
- cancel unrelated workflow runs
- assume the orchestrator should reconcile anything automatically

## Cleanup And Isolation

### Monitor Registry

The Bun side should keep a monitor registry keyed to one `svvy` workflow-run record at a time.

That registry should own:

- the current stream task
- reconnect state
- finalization state
- any pending handler-attention scheduling for that workflow run

### Teardown Rules

Teardown must be thorough but local.

The adopted cleanup rules are:

- stopping or finalizing one workflow monitor must affect only that workflow run
- starting a new run on thread A must not cancel monitoring for thread B
- resuming an existing Smithers run should reconnect or replace only that same run's monitor
- starting a replacement run on the same thread should tear down only the superseded same-thread active monitor, not historical terminal runs or other threads
- when a run reaches terminal state and its final projection is durable, the monitor may shut down after any required handler attention has been queued
- app shutdown should cancel all monitors, but normal thread handoff should not globally clear unrelated monitors

### Thread Handoff Safety

`thread.handoff` should only close the current objective span after the handler thread has resolved any active supervised run for that span.

In practice that means:

- `thread.handoff` should first reconcile the thread-owned workflow state against Smithers' durable run state so a just-finished run is not mistaken for a still-active one
- no active supervised run should remain attached to the thread when a terminal handoff episode is emitted
- a failed or cancelled workflow run is not by itself a valid handoff condition; it must first be repaired, turned into an explicit wait, or closed by an explicit user-directed decision
- if the handler truly needs to end supervision before the workflow succeeds, it must explicitly cancel or otherwise terminalize that workflow run first; `svvy` must not silently leave a live workflow running behind a completed thread
- historical workflow runs remain inspectable after handoff
- a later follow-up turn on the same thread may start another workflow run for a new active span under that thread

### Terminal Reconciliation Idempotence

The same terminal Smithers run state may be observed more than once through legitimate supervision paths.

Examples include:

- the live progress callback
- the bridge-owned final projection after the run exits
- restart or reconnect bootstrap reads
- explicit control-plane writes that mutate the run before the handler acts again

That duplication does not change ownership semantics.

It means the supervision bridge must treat replayed terminal state as idempotent after the handler has already reconciled it and closed the current span.

In practice:

- replaying the same terminal workflow snapshot after a valid handoff must not reopen the thread
- replaying the same terminal workflow snapshot after a valid handoff must not queue another handler-attention wake-up
- replayed terminal state may refresh run metadata, but it must not imply that a completed thread still has active workflow ownership

## Renderer And Sync Rules

The renderer must receive explicit backend-to-renderer sync when workflow supervision changes visible state.

The Bun side should emit explicit sync on:

- workflow projection changes that affect visible thread or workflow summaries
- background handler execution starting
- background handler execution settling

The renderer should not poll list or inspector APIs to discover whether workflow state changed.

## Failure Rules

Workflow failure must still return durable failure state to the supervising handler thread even when the workflow's own planned finalization path does not run.

That means the bridge must be able to produce:

- durable failed workflow-run state
- failure lifecycle facts and artifacts
- handler attention for the supervising thread and a `troubleshooting` thread state

This guarantee belongs to `svvy` supervision, not to ad hoc user refresh.

## Why No Polling Fallback

The GUI fallback exists because its transport is optional and compatibility-driven.

`svvy` should not copy that behavior for supervised runs because:

- workflow supervision is product-internal infrastructure, not a best-effort dashboard
- silent fallback would hide transport and integration bugs
- it would create two lifecycle models instead of one
- it conflicts with the write-driven lifecycle and split workspace-vs-surface sync direction already adopted for the app

The correct fallback for `svvy` is reconnect and recovery, not silent polling.

## Sources

### Local Sources

- [PRD](../prd.md)
- [Execution Model](../execution-model.md)
- [Progress](../progress.md)
- [Structured Session State Spec](./structured-session-state.spec.md)
- [Smithers GUI Client](../references/smithers-gui/SmithersClient.swift)
- [Smithers GUI Runs View](../references/smithers-gui/RunsView.swift)
- [Smithers Serve Docs](../references/smithers/docs/integrations/serve.mdx)

### External Sources

- [Smithers Full Documentation](https://smithers.sh/llms-full.txt)
