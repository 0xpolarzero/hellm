# Queued Surface Messages Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines durable queued work for orchestrator and handler-thread surfaces.

## Queue Ownership

Queues are keyed by `surfacePiSessionId`.

Queued work belongs to the target surface, not the focused panel, active workspace tab, or parent
session row.

## Queue Item Kinds

Current queue item kinds:

- `user_message`
- `initial_handler_start`
- `thread_followup`
- `report_request`
- `thread_report_notification`
- `request_user_input_answer`

## Delivery Rules

If a surface is idle, the queue runner atomically claims the next item before renderer-visible
queued state appears, so the first visible state is pending or active work.

If a surface is active, new prompt-bearing work stays queued until the prompt lock releases.

Delivery creates a normal turn for the same `surfacePiSessionId`. It does not steer the active turn
or start a concurrent turn.

## User Messages

Ordinary composer submit writes one durable queue item when the target surface is active.

Prompt history is written once at queue time for user messages.

Queued user messages can be removed, restored to composer, or reordered before delivery.

If queued work cannot be converted into the next pi user/control message before a turn starts, the
queue item is marked `failed` with `failedAt` and a `failureError`. Failed items remain visible near
the owning surface composer, are not claimed by later queue drains, and do not create a normal failed
turn. Failed user messages can be restored to the composer or deleted; failed control items can be
dismissed. Restore-to-composer falls back to the queue-time request summary when the original message
payload cannot be parsed.

Failures after a turn has accepted the queued message remain normal turn failures. They do not use
the queue-row-local delivery-failure state.

## Thread Control Work

`thread_followup`, report requests, and thread report notifications use the same surface queue as
user messages so handler/orchestrator coordination preserves order.

`thread_followup({ activate: true })` may reactivate a concluded handler objective before queue
delivery.

## Extension Context Refresh

Generated extension context refresh is not queued work. A surface snapshot is stale only when its
bound generated-context fingerprint differs from the current fingerprint.

Stale surfaces show “Extensions changed and will require system prompt to refresh.” with a durable,
checked-by-default “Update before next turn” checkbox. Before prompt-bearing queue work dispatches,
the backend recomputes the current fingerprint. If the fingerprint still differs and the checkbox is
enabled, it refreshes the binding first and records `Agent context updated`. If the checkbox is
disabled, dispatch uses the bound context and the stale banner remains visible.

## Restart Recovery

Queued work survives app restart.

Recovery uses durable queue state and transactional claims. Renderer state, transcript parsing, and
focused panel identity must not be used to rediscover queued work.
