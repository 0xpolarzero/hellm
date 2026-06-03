# Queued Messages Spec

## Status

- Date: 2026-05-15
- Status: adopted product direction for durable surface queue work
- Scope: composer sends and surface-control work that target orchestrator or handler-thread surfaces

Thread Managing tools that create or consume queue work, including `thread_resume` and
`thread_handoff`, are defined in `docs/specs/extension/thread-managing.extension.spec.md`.

## Purpose

`svvy` needs a clear way for every prompt-bearing or surface-control item to pass through one ordered surface queue, whether the surface is currently idle or already running.

The product goal is not concurrent turns, hidden steering, or a second terminal-like input loop. The goal is a durable, ordered, surface-local queue manager:

- the running turn keeps ownership until it settles or is cancelled
- the user's submitted follow-up is accepted instead of lost
- blocked follow-ups remain visible and editable before delivery
- idle submissions are claimed before a renderer-visible queued state and start the next real turn on that same surface

## Reading Rules

This document separates evidence and product design into three labels:

- `Public Codex fact`: directly supported by public OpenAI Codex material
- `pi implementation fact`: supported by the local pi reference under `docs/references/pi-mono`
- `PRD inference`: adopted `svvy` behavior inferred from the PRD and product architecture

Public Codex facts are product-context inputs only. They are not evidence of pi internals or a requirement to clone Codex UI behavior exactly.

pi implementation facts describe available substrate behavior. They are not automatically exposed as `svvy` product behavior unless this spec adopts them.

## Source Context

### Public Codex facts

- `Public Codex fact`: OpenAI describes Codex as a coding agent that helps users write, review, and ship code, and the Codex app as a command center for agentic coding with parallel work across projects. Source: [Codex product page](https://openai.com/codex).
- `Public Codex fact`: OpenAI describes Codex as spanning Codex CLI, Codex Cloud, and the Codex VS Code extension, with an agent loop that prepares input from the user's prompt, calls a model, and uses tools. Source: [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/).
- `Public Codex fact`: Codex cloud can work on many tasks in the background, in parallel, in its own cloud environment. Source: [Codex cloud docs](https://platform.openai.com/docs/codex).

These facts support a product expectation that users can keep giving instructions while agentic work is underway. They do not specify `svvy`'s exact queued-message semantics.

### pi implementation facts

- `pi implementation fact`: pi has keybinding names for queueing a follow-up message and restoring queued messages: `app.message.followUp` and `app.message.dequeue`.
- `pi implementation fact`: pi extension APIs expose `sendUserMessage(content, { deliverAs })` with `deliverAs: "steer"` and `deliverAs: "followUp"` when the agent is streaming.
- `pi implementation fact`: pi custom messages also support `deliverAs: "nextTurn"`.
- `pi implementation fact`: pi's agent core distinguishes steering messages from follow-up messages; follow-up messages are checked when the agent has no more tool calls and no steering messages.
- `pi implementation fact`: pi can clear queued steering and follow-up messages and report whether queued messages exist.

These facts make queue-backed behavior feasible through pi's runtime seam. `svvy` adopts only the follow-up queue as a first-class user-facing behavior.

Local pi references:

- `docs/references/pi-mono/packages/coding-agent/src/core/keybindings.ts`
- `docs/references/pi-mono/packages/coding-agent/docs/extensions.md`
- `docs/references/pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `docs/references/pi-mono/packages/agent/README.md`

### PRD inferences

- `PRD inference`: each interactive surface has one prompt lock, so a running turn must not be joined by another concurrent user turn on the same surface.
- `PRD inference`: each surface is addressed by `surfacePiSessionId`; queued messages are therefore surface-local, not global to the workspace and not panel-local.
- `PRD inference`: Dockview panels are views over surfaces. A queued message belongs to the target surface even if zero, one, or many panels show it.
- `PRD inference`: committed conversation history remains in pi's session history. A queued message is not committed transcript history until it is delivered as the next real user message.
- `PRD inference`: prompt history records explicit user submissions. A queued message is an explicit submission and should be eligible for prompt history at queue time, even if delivery happens later.

## Adopted Product Behavior

`svvy` treats ordinary composer submits as durable surface queue work. The visible queue row also exposes an explicit `Steer` action for the uncommon case where the user wants blocked queued text delivered through pi/Codex-style steering at the next safe boundary of the active turn.

The queue is generic surface work, not only composer text. Every interactive surface accepts
`user_message`, `agent_context_refresh`, `initial_handler_start`, and `workflow_attention` queue
items. The orchestrator additionally accepts `handler_handoff` notification items created after
`thread_handoff` records a durable handoff episode. A `handler_handoff` item waits in the
orchestrator queue with user messages and is delivered as orchestrator reconciliation input.
Dismissing or deleting the notification cancels only the queue row; it does not roll back the
durable handoff episode or return a tool error to the handler.

An `agent_context_refresh` item is a surface-local control item created automatically when the
current generated agent context fingerprint differs from the context fingerprint bound to that
surface or workflow task-agent attempt. It is always written as durable surface queue work, even
when the target surface is idle and has no queued work. When the surface lock is free, "immediate"
means the row is durably enqueued and claimed by the shared queue runner before any renderer-visible
queued state. An agent context refresh is ordered with the rest of the surface queue, but it is not
sent to the agent and does not create transcript or prompt-history content. When delivered, it
refreshes the bound base instructions, loaded and available extension binding, generated extension
instructions, external instruction records, mounted `svvyx` command set, native tool schemas, loaded
`svvyx` command guidance, and TypeScript declarations before later prompt-bearing queue items run. Active runs
may also apply the ready refreshed context at the next pi `refreshRunContext` boundary; the queued
item remains the durable recovery and ordering record.

Prompt edits, extension changes, generated docs/types changes, native tool schema changes, and
external instruction changes all use the same `agent_context_refresh` control item.

When a user submits from a composer:

- if the target surface is idle, the message is durably enqueued and atomically claimed by the backend queue runner before any renderer-visible queued state
- if the target surface already has an active turn, the message remains visible and editable in the queue for that same surface
- the active turn continues until it naturally settles or is cancelled
- the queued message starts the next real turn only after the active turn settles and the surface prompt lock is released

Ordinary queued composer sends must not:

- inject instructions before the current assistant turn finishes its already accepted tool work
- skip remaining tool calls in the current assistant message
- open a concurrent turn on the same surface
- retarget itself to the orchestrator just because the focused panel changed
- become an inline transcript message before delivery

The `Steer` row action is separate from ordinary queued delivery. It promotes the selected durable row to the front of the surface queue for next-turn delivery. `svvy` does not inject a direct pi steering message as a fast path; the row remains durable and ordered until the shared queue runner claims it. If delivery fails before pi accepts it, `svvy` restores the row to the front of the durable queue.

## Queue Ownership

A queued item record belongs to exactly one interactive surface.

Required identity:

- `workspaceSessionId`
- `surfacePiSessionId`
- `threadId` when the target surface is a handler thread
- `queuedItemId`
- `kind`, currently `user_message`, `handler_handoff`, `agent_context_refresh`,
  `initial_handler_start`, or `workflow_attention`
- idempotency key for stable internal producers and recovery seeding

The queue is ordered per `surfacePiSessionId`. Queue ordering is FIFO unless the user explicitly edits, removes, or reorders messages through future queue-management UI.

Queued items are not Dockview panel state. If two panels show the same surface, both render the same queue projection. If no panel shows the surface, the queue still belongs to the live surface and durable workspace state.

## Queue Lifecycle

Queued message status:

```ts
type QueuedMessageStatus =
  | "queued"
  | "steering"
  | "dispatching"
  | "delivered"
  | "cancelled";
```

Lifecycle rules:

- `queued`: durably accepted and waiting because the surface lock or earlier queue work is ahead of it
- `steering`: selected for pi steering, locked in the UI, and waiting for pi accept/reject
- `dispatching`: selected as the next item for the surface and being submitted or applied; it is durable queue state, but it is not projected as visible queue UI once represented as pending or active surface work
- `delivered`: committed as the next real user message in pi's session history
- `cancelled`: removed by the user before delivery or dropped because the owning surface was explicitly closed in a way that discards queued work

The durable record should keep:

- item kind
- submitted text exactly as sent for `user_message`
- source thread, source command, handoff episode, title, summary, body, and episode kind for `handler_handoff`
- previous and requested generated agent context fingerprint, changed categories, changed extension
  ids when applicable, and request time for `agent_context_refresh`
- thread id and request time for `initial_handler_start`
- workflow run, Smithers run, workflow id, summary, and reason for `workflow_attention`
- composer attachments or mention-link serialized text according to their own specs
- creation, update, delivery, and cancellation timestamps
- source panel id for diagnostics only, not for ownership
- prompt-history entry linkage when available

## Delivery Semantics

When a surface item is submitted or the current turn settles, the owning surface wakes the queue runner for its `surfacePiSessionId`. Queue delivery is owned by that surface runtime, not by any Dockview pane, workspace tab, or visual instance. Waking the runner is idempotent; if a runner is already scheduled or active for the surface, additional wakes do not start another delivery loop.

If the surface lock is free at submit time, enqueue and claim happen as one queue-manager transition before publishing a renderer-visible queue projection. The first visible surface state for that item is pending or active work, not a transient queued row.

If the queue has at least one queued item:

1. atomically claim the first `queued` item and mark it `dispatching`
2. derive the action for that item kind
3. for `agent_context_refresh`, recreate or refresh the managed pi runtime binding and
   actor-scoped `svvyx` command binding behind the same product surface, record the
   `Agent context updated` product event, mark the item delivered, and continue draining later items
4. for `user_message`, `handler_handoff`, `initial_handler_start`, or `workflow_attention`, submit the derived text as the next real user message to that same pi surface; `handler_handoff` delivery reconciles an already-recorded durable episode
5. create a normal turn record for prompt-bearing delivery
6. mark prompt-bearing items `delivered` once pi accepts the queued item into the surface history

If delivery fails before pi accepts the item, the item returns to the front of the durable `queued` list.

If delivery starts and the resulting turn later fails, the queued item remains `delivered`; the turn failure belongs to the normal turn lifecycle.

If `agent_context_refresh` fails after a ready generated agent context exists, the failure is an
internal product error. The item stays visible as failed or blocking for that affected surface and a
user-only product event is recorded:

```text
Agent context update failed
```

The event includes a stable app log/error id and actions `Retry` and `Cancel update`. It must not
describe dependency approval, missing env, install failure, or extension build validation as context
update failures; those states happen before a ready context refresh can be queued or applied.

## Cancellation And Restore

Cancelling the active turn and restoring queued text are separate actions.

The product should support:

- cancelling the active turn without silently deleting queued messages
- removing an individual queued message before delivery
- restoring one or all queued messages into the composer for editing before delivery

The pi TUI's `Alt+Up` restore behavior is a useful reference, but `svvy`'s desktop shortcut and UI affordance should come from the product shortcut registry and composer design rather than copying TUI keybindings directly.

Committed user transcript messages have copy and edit actions. Copy writes the visible user-authored text to the clipboard without changing composer state. Edit restores that message text into the composer in committed-message edit mode and visually marks the selected transcript message as the one being edited. If the composer already contains text or attachments, the UI opens an app dialog warning that continuing will replace the current draft and includes a `TODO:` note about preserving it through the planned backlog flow before proceeding. Sending the edited text targets the same `surfacePiSessionId`, moves the active pi session leaf to the parent of the original user message, clears blocked queue rows for that surface because they belonged to the abandoned continuation, and starts the next normal turn from the edited user message. The old branch remains historical pi session data, but the live surface projection follows the edited branch. This is not a new fork and is not a queued-message restore.

## Prompt History

Queued messages are user-authored explicit submissions.

That means:

- a non-empty queued message is written to workspace prompt history at queue time
- delivery later must not create a duplicate prompt-history entry
- restoring and editing a queued message before delivery creates a new history entry only when the edited text is submitted again

## Projection

Surface UI should show queued messages near the composer for the target surface.

Projection should make clear:

- how many messages are queued
- which surface owns them
- their delivery order
- whether the current surface is running, waiting, or ready
- whether a message is queued for normal follow-up or has been selected for steering

Queued rows render as a compact vertical list directly above attachment chips and the textarea only while they are blocked queue work, such as active-surface follow-ups or items behind earlier queue work. Rows use single-line ellipsized message text, centered controls, and dense workbench row sizing. Editable `user_message` rows expose drag reorder, `Steer`, edit, and delete. Editable `handler_handoff` rows expose drag reorder, `Steer`, and dismiss/delete; they do not expose text edit or restore-to-composer because their prompt is derived from durable handoff metadata at delivery time, and dismissal does not alter the recorded handoff. Editable `agent_context_refresh` rows are labelled `Update agent context`, expose cancel while unclaimed, and omit edit, restore, and steer because they are control work rather than agent input. Drag-hover reorder previews are local renderer state; the durable queue order changes only when the user drops a row into a final changed position. Locked `steering` rows remain in place but replace the controls with a status indicator and cannot be edited, deleted, dismissed, steered again, or reordered. `dispatching` rows are durable backend state and do not render as queue rows once claimed for pending or active surface work.

Sidebar rows may show a compact queued-count badge for an open surface, but queued messages do not change the row's lifecycle status to running or waiting by themselves.

## Restart Recovery

Queued messages should survive app restart until they are delivered, cancelled, or restored for editing.

On restore:

- queued messages remain ordered under their owning `surfacePiSessionId`
- if the owning surface is idle and has queued messages, the app may resume delivery after reconstructing the surface runtime and prompt lock state
- if the owning surface is active because a turn or workflow-attention wake-up resumed, queued delivery waits for that active work to settle

Recovery must not infer queued messages from transcript text. The queue is structured product state.

## Explicitly Out Of Scope

- treating ordinary composer submit as pi steering
- global workspace message queues
- queueing messages across multiple target surfaces from one submit
- running two user turns concurrently on one surface
- queuing slash commands or product command-palette actions as transcript text
- treating queued messages as Smithers workflow signals or approvals
- preserving queued-message state in Dockview panel layout JSON

## Test Planning

Tests should cover:

- idle send writes and claims a durable queue row before any renderer-visible queued state, then surfaces as pending or active work
- active-surface send creates a queued message and leaves the active turn alone
- queued messages deliver FIFO after the prompt lock releases
- queued messages stay surface-local across orchestrator and handler-thread surfaces
- queued messages render consistently in duplicated panels for the same surface
- prompt history records queued submissions once
- cancellation does not silently delete queued messages
- queued messages restore across restart without transcript inference
- delivery that fails before pi accepts the message restores the durable queued row
