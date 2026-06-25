# Queued Surface Messages Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines durable queued work for orchestrator, handler-thread, and workflow task-agent
attempt surfaces.

## Queue Ownership

The public message API accepts a user-messageable orchestrator or handler `PromptTarget` from
`@svvy/core`, one new user message, delivery intent, and optional client submission metadata. It is
not a public queue-row API.

`@svvy/runtime` resolves public targets and runtime-owned internal work into `RuntimeSurfaceTarget`
values for queue addressing. `@svvy/state` persists the resolved `surfacePiSessionId` on each queue
row because pi remains the canonical transcript substrate for the addressed interactive surface.

Queued work belongs to the target surface, not the focused panel, active workspace tab, or parent
session row.

## Queue Item Kinds

Queue item kinds:

- `user_message`
- `initial_handler_start`
- `thread_followup`
- `report_request`
- `thread_report_notification`
- `request_user_input_answer`
- `workflow_task_agent_start`

## Delivery Rules

Queue insertion and queue claiming are separate committed state transitions. After the insert
commits, `@svvy/runtime` publishes a notification and wakes the queue dispatcher. Consumers may
observe queued, dispatching, pending, or active turn state by refetching authoritative read models.

If a surface is active, new prompt-bearing work stays queued until the prompt lock releases.

Delivery creates a normal turn for the addressed target surface and persisted `surfacePiSessionId`.
It does not steer the active turn or start a concurrent turn.

## User Messages

Ordinary composer submit writes one durable queue item for the target surface, whether that surface
is idle or active.

Ordinary composer submit calls runtime with the target surface, one user message, delivery intent,
and optional client submission metadata. Callers must not submit pi message arrays, `systemPrompt`
text, generated-context previews, extension id lists, UI snapshots, renderer transcript state, or
renderer `Agent` internals. `@svvy/runtime` reads durable surface state, model settings, queue
state, prompt bindings, and generated-context binding records from `@svvy/state`. At safe refresh
boundaries it asks `@svvy/extensions` to resolve/build actor context and native declarations, records
the resulting binding through state ports, and passes the bound `systemPrompt` text and tool
declarations to `@svvy/pi-adapter` for true `systemPrompt` and turn delivery.

Runtime queue acceptance is the commit point for ordinary composer sends. Until acceptance returns,
the renderer keeps the live composer buffer and writes no prompt history. Acceptance durably creates
the queue item through `@svvy/state`, clears the durable composer draft, and publishes a typed
notification after commit. The renderer clears the visible composer after refetching the
authoritative composer and queue read models. Acceptance also invalidates older delayed renderer
draft persistence for that surface so stale pre-send text cannot be written back after runtime
clears the draft. After `@svvy/runtime` accepts a non-empty user message, prompt history is recorded
through the runtime-facing state port used by the acceptance transaction. Desktop only refetches the
prompt-history read model; refresh failures do not reject the accepted send.
`runtime.messages.submit(...)` returns the accepted `queuedMessageId`, the target, and
`status: "queued"` for both `enqueue-and-run` and `queue-only`. It does not return live turn state
or `turnId`. The UI learns whether the accepted row was claimed, remains queued, or starts a turn
by refetching authoritative queue/surface/turn read models after runtime notifications. Runtime
events are invalidation and live-patch signals; they are not durable queue, surface, or turn state.

Queued user messages can be removed or restored to composer before delivery. A durable row-level
`Steer` action promotes a queued row into the highest-priority next-delivery slot for that surface;
it does not inject a prompt into the active pi turn. Request-user-input answer rows claim ahead of
ordinary user-message rows. Queue ordering and priority facts survive restart and are honored by
atomic `@svvy/runtime` queue claims.

If queued work cannot be converted into the next pi user/control message before a turn starts, the
queue item is marked `failed` with `failedAt` and a `failureError`. Failed items remain visible near
the owning surface composer, are not claimed by later queue drains, and do not create a normal failed
turn. Failed user messages can be restored to the composer or deleted; failed control items can be
dismissed. Restore-to-composer is enabled only when the failed queued `user_message` payload decodes
to the original submitted message text. If the payload cannot be parsed, the row remains visible with
derived `QueueReadModel.displaySummary` for inspection and can be deleted; `svvy` must not
reconstruct composer text from a display summary.

Failures after a turn has accepted the queued message remain normal turn failures. They do not use
the queue-row-local delivery-failure state.

## Thread Control Work

`thread_followup`, report requests, and thread report notifications use the same surface queue as
user messages so handler/orchestrator coordination preserves order.

`thread_followup({ activate: true })` may reactivate a concluded handler objective before queue
delivery.

## Workflow Task-Agent Bridge Work

`workflow_task_agent_start` rows are inserted only by accepted Smithers task-agent bridge requests
or runtime-owned coordinators. They are never inserted by public composer/runtime message
submission. They target a workflow task-agent attempt surface, require row-level `sourceCommandId`,
and use this exact durable idempotency key:

```text
workflow-task-agent-start:<workspaceSessionId>:<sourceCommandId>:<runId>:<nodeId>:<iteration>:<attempt>:<agent.id>
```

Runtime validates that key before insert. The row payload carries the validated task-agent
parameters, Smithers run/node/iteration/attempt identity, optional Smithers observed context
`{ run, node, rootDir }`, and exactly one prompt source as either a prompt string or non-empty
user/assistant messages. Row-level queue metadata carries `sourceCommandId`; the payload must not
duplicate `sourceCommandId`, carry a caller-supplied `threadId`, or carry a top-level `rootDir`. The
same Smithers run/node/iteration/attempt with a different `agent.id` is a distinct task-agent
attempt. An exact duplicate key reuses the existing pending/running/completed attempt and must not
enqueue another row.

Workflow task-agent attempt surfaces are not user-messageable through the composer or public
`runtime.messages.submit(...)` API. They still use the same durable queue claim, generated-context
refresh, pi turn, tool execution, command fact, and recovery path as orchestrator and handler
surfaces.

## Generated Actor Context Refresh

Generated actor context refresh is not queued work. A surface is stale only when its
`@svvy/state` generated-context binding fingerprint differs from the current fingerprint.

Stale surfaces show “Generated context changed. Update before next turn.” with a durable,
checked-by-default “Update before next turn” checkbox. Before prompt-bearing queue work dispatches,
`@svvy/runtime` recomputes the current fingerprint. If the fingerprint still differs and the
checkbox is enabled, runtime refreshes the binding first. `@svvy/extensions` resolves and builds the
generated actor context and declarations, `@svvy/state` commits the binding/fingerprint facts, and
`@svvy/runtime` publishes read-model notifications after commit. UI refresh status is derived from
state read models or app logs; it is not inserted as transcript prose. If the checkbox is disabled,
dispatch uses the bound context and the stale banner remains visible.

## Restart Recovery

Queued work survives app restart.

Recovery uses durable queue state and transactional claims. Renderer state, transcript parsing, and
focused panel identity must not be used to rediscover queued work.
