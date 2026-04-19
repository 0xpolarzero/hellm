# Workflow Supervision Spec

## Status

- Date: 2026-04-19
- Status: adopted direction for event-driven workflow supervision
- Scope of this document:
  - define how `svvy` supervises Smithers runs under handler threads
  - define the required runtime flow after `workflow.start` and `workflow.resume`
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
- explicit backend-to-renderer session-sync events
- structured session state as the product read model

This means workflow supervision is:

- a handler-thread responsibility
- event-driven product behavior above Smithers
- not transcript inference
- not orchestrator polling
- not a separate execution engine

This spec refines section 5 of [progress.md](../progress.md) and the workflow-run parts of the [Structured Session State Spec](./structured-session-state.spec.md).

## Out Of Scope

This spec does not define:

- workflow template or preset selection
- workflow authoring UX
- the exact workflow library shape
- repo-local preflight or validation hooks
- renderer visuals beyond the state and sync requirements needed to support them

Those remain separate steps and specs.

## Borrowed Boundary

`svvy` should borrow the Smithers run-event transport and reconnect shape rather than inventing a separate workflow polling model.

The local references show the relevant transport shape:

- the Smithers GUI uses live run-event streaming in [SmithersClient.swift](../references/smithers-gui/SmithersClient.swift)
- Smithers serve mode exposes workflow lifecycle events over SSE in [serve.mdx](../references/smithers/docs/integrations/serve.mdx)

The borrowed part is:

- attaching to a Smithers run event stream
- filtering by run id
- reconnecting from a known event sequence

The `svvy`-owned part is:

- workflow-run records
- handler-thread state projection
- synthetic handler wake-ups
- session-sync emission
- cleanup and isolation rules
- restart recovery and supervision durability

## Adopted Direction

- Supervised workflow runs require a live Smithers event source. There is no silent polling fallback for `svvy`-owned workflow supervision.
- Recovery may use one-shot state reads to bootstrap or repair the stream attachment after restart, but steady-state supervision must remain event-driven.
- One handler thread may supervise many workflow runs over its lifetime.
- For this supervision slice, one handler thread should own at most one active Smithers run at a time.
- `svvy` should derive active and latest workflow summaries from workflow-run records and recency rules rather than persisting a thread-level latest-workflow pointer.
- `workflow.start` and `workflow.resume` remain native control tools, but they are only the entry points into supervision, not the whole feature.
- A workflow run never returns control directly to the orchestrator.
- Only `thread.handoff` returns control to the orchestrator.

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

A workflow monitor is the Bun-side runtime object that:

- attaches to the Smithers event stream for one workflow run
- projects normalized workflow state into `svvy`
- handles reconnect and teardown

The monitor is runtime state, not transcript state.

### Handler Attention

Handler attention means a workflow state transition now requires another handler-thread decision.

The important cases are:

- workflow entered a durable wait
- workflow completed
- workflow failed
- workflow was cancelled
- supervision transport became irrecoverably degraded

## End-To-End Flow

The adopted flow is:

1. The orchestrator delegates an objective into a handler thread.
2. The handler thread selects, writes, or receives a concrete workflow to run.
3. The handler thread calls `workflow.start` or `workflow.resume`.
4. `svvy` launches or resumes the Smithers run and obtains the concrete Smithers run id.
5. `svvy` persists or updates the workflow-run record immediately.
6. `svvy` registers a workflow monitor for that workflow run.
7. The monitor attaches to the Smithers event stream and begins projecting workflow state into durable `svvy` state.
8. The Bun side emits explicit session-sync events whenever those durable projections change visible session or thread state.
9. If the workflow reaches a state that needs another handler decision, `svvy` opens a synthetic background turn on that same handler thread.
10. The handler thread decides whether to inspect, repair, resume, ask the user, or hand control back with `thread.handoff`.

## Transport Rules

### Required Event Source

Supervised workflow runs must have a live event source.

If `svvy` cannot attach the supervision transport for a run, it should treat that as a workflow-supervision error rather than silently degrading into a different mode.

That means:

- no hidden timer-based polling fallback for normal supervision
- no renderer-side polling to guess whether workflow state changed
- no read-side writes that try to reconstruct supervision from ad hoc refreshes

### Reconnect

The supervision transport must support reconnect from the last applied event sequence.

The serve-mode event stream already defines the right reconnect shape with `afterSeq` in [serve.mdx](../references/smithers/docs/integrations/serve.mdx).

The adopted `svvy` rule is:

- persist enough durable cursor metadata per workflow run to reconnect after restart or stream interruption
- reconnect from the last applied sequence instead of replaying the full run every time
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
- the last handler-attention delivery point for that workflow run

The exact storage shape may live directly on the workflow-run record or in closely related supervision metadata, but it must be durable enough for restart-safe reconnect and wake-up dedupe.

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

- `running` while the delegated objective is still owned by the handler thread, including while a workflow is actively executing or after a workflow terminal event that still needs handler judgment
- `waiting` when the delegated objective is blocked on user or external input and the current thread should surface that wait
- `completed`, `failed`, or `cancelled` only when the handler thread itself has reached a terminal objective span and `thread.handoff` has closed that span

A workflow run becoming terminal does not by itself make the thread terminal.

## Handler Wake-Up Rules

### When To Wake The Handler

The supervision bridge should request handler attention when:

- a workflow enters a durable wait
- a workflow reaches `completed`
- a workflow reaches `failed`
- a workflow reaches `cancelled`
- supervision cannot continue safely because transport or projection became irrecoverably degraded

Ordinary non-terminal progress events should update state and UI but should not wake the handler thread.

### How To Wake The Handler

When handler attention is needed, `svvy` should:

- open the backing pi session for that handler thread
- start a synthetic background turn on that same thread surface
- inject a synthetic user message that summarizes the workflow transition and the allowed next actions
- emit explicit session-sync events so the renderer can follow the background work without polling

This is analogous to orchestrator resume after `thread.handoff`, but it targets the handler thread instead of the orchestrator.

### Prompt Content

The synthetic handler-resume prompt should include:

- thread id and objective
- workflow-run id and Smithers run id
- workflow name
- normalized workflow status
- current workflow summary
- relevant wait reason or failure detail
- any important artifact or lifecycle references needed to act confidently
- an explicit instruction that the handler must now decide what to do next

The expected next actions are:

- inspect
- repair
- `workflow.resume`
- ask the user
- `thread.handoff`

### Dedupe And Coalescing

The handler must not be woken repeatedly for the same workflow transition.

The adopted rule is:

- supervision must track what transition has already been delivered to the handler
- repeated notifications for the same effective state should collapse into one pending handler-attention unit
- if the handler thread already has an active prompt, new workflow attention should be queued or coalesced rather than interrupting that active turn

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

- no active supervised run should remain attached to the thread when a terminal handoff episode is emitted
- historical workflow runs remain inspectable after handoff
- a later follow-up turn on the same thread may start another workflow run for a new active span under that thread

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
- handler attention for the supervising thread

This guarantee belongs to `svvy` supervision, not to ad hoc user refresh.

## Why No Polling Fallback

The GUI fallback exists because its transport is optional and compatibility-driven.

`svvy` should not copy that behavior for supervised runs because:

- workflow supervision is product-internal infrastructure, not a best-effort dashboard
- silent fallback would hide transport and integration bugs
- it would create two lifecycle models instead of one
- it conflicts with the event-driven session-sync direction already adopted for the app

The correct fallback for `svvy` is reconnect and recovery, not silent polling.

## Sources

### Local Sources

- [PRD](../prd.md)
- [Execution Model](../execution-model.md)
- [Progress](../progress.md)
- [Structured Session State Spec](./structured-session-state.spec.md)
- [Workflow Hooks Spec](./workflow-hooks.spec.md)
- [Smithers GUI Client](../references/smithers-gui/SmithersClient.swift)
- [Smithers GUI Runs View](../references/smithers-gui/RunsView.swift)
- [Smithers Serve Docs](../references/smithers/docs/integrations/serve.mdx)
