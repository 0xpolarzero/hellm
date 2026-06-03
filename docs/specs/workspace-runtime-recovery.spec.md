# Workspace Runtime Recovery Spec

## Status

- Date: 2026-05-19
- Status: adopted direction for workspace-runtime restart and crash recovery
- Related audit item: `AUD-024`

## Purpose

`svvy` needs one durable recovery coordinator for restart-sensitive backend work.

The coordinator is not an app-global repair loop and not a renderer restore feature. It belongs to each acquired workspace runtime. App-global workspace-tab and UI restore decide which workspace runtimes exist. Once a workspace runtime is acquired, that runtime owns recovery for its sessions, pi surfaces, queues, workflow projections, Project CI, app logs, and workspace-scoped durable work.

Duplicate visual workspace tabs for the same canonical cwd share the same backend workspace runtime, session catalog, live surface registry, structured state, queues, handler threads, workflow runs, app logs, prompt libraries, saved workflows, and recovery coordinator. They keep only visual tab state, active layout selection, and panel-local layout state separate.

## Scope

This spec defines:

- workspace-runtime-scoped recovery ownership
- the separation between app-wide and workspace-specific recovery concerns
- the interruptible backend work inventory and expected handling
- the Smithers execution-state boundary during recovery
- a durable data-oriented recovery scheduler model
- deterministic recovery ordering
- invariants, limitations, non-goals, and test planning

This spec does not claim that the runtime implementation already satisfies the design.

## Adopted Direction

- Recovery is scoped to one backend workspace runtime, keyed by canonical workspace identity and addressed by explicit `workspaceId`.
- App-global shell restore may open zero, one, or many visual tabs. That app-global restore only decides which workspace runtimes should be acquired.
- Backend recovery starts after the workspace runtime opens its durable workspace stores and before it claims new surface work.
- UI restore is a consumer of recovered backend state. The renderer restores stable Dockview layout and panel bindings, then receives normal workspace snapshots and events from backend projection. It does not own restart recovery for product work.
- Recovery is backend-first. Durable state, Smithers projection, prompt locks, queues, title jobs, handler starts, thread report notifications, report requests, and wait state are recovered before the UI decides that a surface is idle and user-ready.
- Recovery uses transactional claims over durable work rows. Process-local flags, renderer focus, and panel identity never decide whether backend work resumes.
- Smithers execution facts stay in Smithers. Recovery re-reads Smithers durable state by Smithers identifiers, reconnects monitors or cursors, and projects only `svvy` product facts.
- `svvy` does not create a parallel `workflow_*` recovery abstraction. Workflow recovery uses Smithers-native identifiers and Smithers-native operation names where agent or bridge surfaces are involved.

## Ownership Boundaries

### App-Wide Concerns

These are app-global and must not be recovered through a workspace-runtime scheduler:

- provider auth and OAuth state
- app-global provider keys and provider selection
- app preferences such as theme and preferred external editor
- app-wide agent profiles
- app chrome workspace-tab order and the list of workspace runtimes to acquire
- global native menu registration and command accelerator wiring

App-global startup may unblock workspace recovery by making provider and preference state available, but it must not drain workspace queues or repair workspace product work directly.

### Workspace-Specific Concerns

These are owned by the acquired workspace runtime:

- workspace sessions and session summaries
- pi-backed orchestrator and handler surfaces
- surface prompt locks, active turns, and queued surface work
- initial handler auto-starts
- thread report notification delivery and dismissal
- report request delivery
- wait state
- title generation jobs for workspace sessions and handler threads
- Smithers workflow-run bindings and monitor reconnect
- workflow attention and handler wake-ups
- Project CI projection
- agent profiles, extension usage state, and generated agent context bindings
- saved workflow assets and runnable workflow registry projection
- workspace app logs and observability records
- backend events that refresh renderer workspace and surface snapshots
- durable UI restore records keyed by `workspaceId`, `layoutId`, panel id, and surface binding

Workspace-specific recovery must route through explicit `workspaceId`, never active workspace, focused tab, focused panel, process cwd, or a global current runtime.

## Research Inventory

The recovery coordinator owns or coordinates the following interruptible work points.

| Work point | Durable source of truth | Recovery handling |
| --- | --- | --- |
| Active prompt or turn on an orchestrator or handler surface | turn record, surface prompt lock state, pi session state when available | Reacquire the surface by `surfacePiSessionId`, inspect durable turn and prompt-lock state, and either mark an interrupted pre-accept attempt retryable or project the accepted/running turn as resumed. If pi cannot provide accepted-message idempotency or an acceptance receipt, recovery cannot guarantee exact-once prompt delivery for a crash at the send boundary. |
| Queued `user_message` row | surface queue table keyed by `surfacePiSessionId` | Leave blocked `queued` rows ordered and visible. Reset stale `dispatching` rows to `queued` only when no accepted pi turn can be proven for that row. Claim the next row transactionally per surface after the surface lock is free, and when the recovered surface is idle, claim before publishing renderer-visible queued state. |
| Queued `agent_context_refresh` row | surface queue table plus generated agent context binding records | Deliver in queue order before later prompt-bearing items. Refresh the bound base instructions, loaded/available extension binding, generated extension instructions, external instruction records, native tool schemas, loaded `svvyx` command guidance, and TypeScript declarations, then mark delivered. Do not create transcript or prompt-history content. |
| Queued `thread_report` row | orchestrator surface queue plus already-recorded handler command and episode metadata | Keep the row ordered with other orchestrator queue work. Delivery creates at most one orchestrator reconciliation turn for an already-recorded durable episode. Dismissal cancels only the notification row; it does not roll back the episode or return a tool error to the handler. |
| Queued `report_request` row | handler surface queue plus already-recorded report request metadata | Keep the row ordered with other handler queue work. Delivery creates at most one handler turn asking the handler to answer the request with `thread_report({ requestId, ... })`. Dismissal cancels only the queue row unless product policy also cancels the pending report request. |
| Initial handler auto-start | handler-thread record plus initial-start recovery work row plus surface queue row | Claim exactly one initial-start recovery row per `threadId`, ensure the matching `initial_handler_start` surface queue row exists, then let the shared queue runner start the handler's first pi turn from the raw objective only if no accepted initial turn exists. Preserve the handler surface identity and generated agent context binding. |
| Thread report notification delivery or dismissal | queue item, command record, episode rows | Recover the notification row and already-recorded episode together. A recorded report must have exactly one durable episode. Notification delivery has at most one orchestrator reconciliation turn. Notification dismissal must not alter the handler command or episode. |
| Wait state | session, thread, workflow-run, and Smithers wait identifiers | Restore wait projection and attention state. Do not auto-resume a wait unless the durable resolving input, signal, approval decision, or timer state exists. Smithers waits are re-read from Smithers by run/node/wait identifiers. |
| Title generation | title job record on workspace session or handler thread | Claim pending or stale running title jobs by title job id. Run the `namer` once per unfrozen title target. Manual rename or completed title freezes the job and prevents regeneration. |
| Workflow monitors and workflow attention | `svvy` workflow-run binding plus Smithers run id and cursor metadata plus surface queue row | Bootstrap Smithers projection first. Reconnect monitor cursors from the last durable event sequence or official snapshot. Re-read Smithers durable run, wait, output, artifact, approval, timer, event, and task-attempt detail by Smithers id before updating `svvy` projection. Re-emit undelivered handler attention by writing a `workflow_attention` row to the owning handler surface queue. |
| Project CI projection | `svvy` workflow-run binding, declared Project CI entry metadata, Smithers terminal result | Re-run idempotent CI derivation from Smithers durable terminal result and `svvy` ownership facts. Missing or invalid terminal result becomes durable projection failure or troubleshooting state. Do not use process-local terminal output. |
| App logs and observability | workspace app log store | Emit recovery lifecycle logs with workspace, surface, turn, queue, thread, workflow, and Smithers identifiers. Logs explain recovery but are not the canonical recovery state. Redaction policy applies before persistence. |
| App menu and native actions | app-global command registry plus workspace RPC targets | Native menu actions are not replayed after restart. If a native action created durable workspace work before the crash, the workspace coordinator recovers that work. Otherwise the action is gone. |
| Renderer and pane state | Dockview layout records and panel metadata | Restore only stable layout, panel bindings, focus, panel-local scroll, and inspector targets. Renderer state consumes recovered backend snapshots/events. It must not infer backend lifecycle repairs from stale layout JSON, transcript text, or active panel focus. |

## Durable Recovery Work Model

The coordinator should use a workspace-scoped durable scheduler table or equivalent records. The table can be named `recovery_work`; the exact storage implementation may differ if it preserves the same semantics.

Conceptual shape:

```ts
type RecoveryWork = {
  id: string;
  workspaceId: string;
  kind:
    | "smithers_bootstrap"
    | "workflow_attention"
    | "surface_turn_recovery"
    | "queue_drain"
    | "initial_handler_start"
    | "thread_report_resolution"
    | "report_request_delivery"
    | "title_generation"
    | "project_ci_projection"
    | "app_log_projection";
  status:
    | "pending"
    | "claimed"
    | "blocked"
    | "completed"
    | "failed"
    | "cancelled";
  ownerScope:
    | { kind: "workspace" }
    | { kind: "workspace_session"; workspaceSessionId: string }
    | { kind: "surface"; workspaceSessionId: string; surfacePiSessionId: string }
    | { kind: "thread"; workspaceSessionId: string; threadId: string; surfacePiSessionId: string }
    | { kind: "workflow_run"; workflowRunId: string; smithersRunId: string }
    | { kind: "queue_item"; queuedItemId: string; surfacePiSessionId: string }
    | { kind: "title_job"; titleJobId: string };
  idempotencyKey: string;
  orderingKey: string;
  orderingSeq: number;
  priority: number;
  availableAt: string;
  attempts: number;
  maxAttempts: number;
  claimedBy: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  leaseVersion: number;
  payloadJson: unknown;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

The scheduler row records ownership and resumability. It should reference canonical product rows rather than duplicating their business payload. For example, a `queue_drain` work item points to the surface and queue table; the queue table remains the visible source of queued messages.

### Status Semantics

- `pending`: ready to be claimed when `availableAt` has passed.
- `claimed`: leased by one coordinator instance.
- `blocked`: waiting on a durable prerequisite such as user input, Smithers wait resolution, provider readiness, or an active surface prompt lock.
- `completed`: finished idempotently.
- `failed`: exhausted attempts or reached a durable unrecoverable error that needs user-visible troubleshooting.
- `cancelled`: no longer relevant because the owning product row was cancelled or deleted.

`claimed` rows whose `claimExpiresAt` has passed are stale leases and may be returned to `pending` in the same workspace-runtime startup transaction that elects the active coordinator.

### Idempotency Keys

Every recovery work row has a stable `idempotencyKey`.

Examples:

- `smithers_bootstrap:<workspaceId>`
- `workflow_attention:<workflowRunId>:<attentionCursor>`
- `surface_turn_recovery:<surfacePiSessionId>:<turnId>`
- `queue_drain:<surfacePiSessionId>`
- `initial_handler_start:<threadId>`
- `thread_report_resolution:<queuedItemId>`
- `report_request_delivery:<queuedItemId>`
- `title_generation:<titleJobId>`
- `project_ci_projection:<workflowRunId>:<smithersTerminalResultId>`

The database must enforce uniqueness for active rows with the same `(workspaceId, idempotencyKey)` unless the row is terminal and a new logical event uses a new idempotency key.

### Ordering

Ordering is explicit and data-oriented:

- `orderingKey = "workspace:<workspaceId>:smithers"` for workspace bootstrap and projection prerequisites.
- `orderingKey = "surface:<surfacePiSessionId>"` for surface turns, agent context refresh, queue drain, thread report delivery, and report request delivery.
- `orderingKey = "thread:<threadId>"` for initial handler start recovery seeding and thread-local title generation when it depends on the thread objective.
- `orderingKey = "workflow:<workflowRunId>"` for monitor reconnect and attention delivery for one Smithers run.

The coordinator must process rows in `(priority, availableAt, orderingKey, orderingSeq, createdAt)` order while enforcing owner locks:

- one active claim per `workspaceId` bootstrap phase
- one active prompt or queue drain per `surfacePiSessionId`
- one initial handler start per `threadId`
- one monitor or bootstrap projection claim per `workflowRunId`
- no queue delivery while the same surface has an active recovered turn or unreconciled prompt lock

### Transactional Claim Rules

The workspace runtime claims work inside a write transaction:

1. Open a transaction on the workspace store.
2. Return expired `claimed` rows to `pending` when their owner process is gone or their lease has expired.
3. Select the next eligible `pending` row whose owner locks are free and whose prerequisites are satisfied.
4. Set `status = "claimed"`, `claimedBy`, `claimedAt`, `claimExpiresAt`, and increment `leaseVersion`.
5. Commit before performing side effects.
6. After the side effect, write product projection and mark the row `completed`, `blocked`, `pending`, or `failed` in a new transaction.

Side effects must be idempotent with respect to the row's idempotency key and canonical product rows.

## Deterministic Recovery Order

Workspace runtime startup follows this order:

1. Acquire the workspace runtime chosen by app-global tab/UI restore.
2. Open workspace durable stores and elect one active coordinator for the `workspaceId`.
3. Normalize stale recovery leases and stale visible `dispatching` or `steering` queue rows whose accepted downstream work cannot be proven.
4. Bootstrap Smithers enough to refresh product projection and attention:
   - load workflow-run bindings;
   - re-read nonterminal and unreconciled terminal Smithers runs by `smithersRunId`;
   - reconnect monitor cursors or official snapshots;
   - project workflow attention, wait state, Project CI, and workflow troubleshooting facts;
   - emit workspace updates and recovery logs.
5. Seed missing scheduler rows from durable product facts:
   - nonterminal workflow runs or undelivered workflow attention;
   - interrupted active turns or prompt locks;
   - queued surface work;
   - pending initial handler starts;
   - blocked thread report or report request deliveries;
   - pending title generation;
   - pending Project CI projection failures or retries.
6. Recover surface work in per-surface order:
   - settle or mark interrupted active turn state;
   - apply queued `agent_context_refresh` control work in order;
   - deliver accepted `thread_report`, `report_request`, `user_message`, `initial_handler_start`, or `workflow_attention` rows as real pi inputs;
   - start initial handler turns only through their typed surface queue rows and only after their surface lock and context binding are recovered;
   - run title generation only when the target is not frozen and no higher-priority surface work owns that prompt resource.
7. Continue normal runtime operation. Later Smithers events, queue additions, prompt-lock releases, native commands, and user actions schedule the same recovery work types instead of bypassing the coordinator.

Smithers bootstrap comes first because workflow attention can create or block handler surface work. The coordinator should not drain a handler queue or decide a handler is idle until Smithers-derived attention and wait projection are current enough for that workspace startup.

## Prompt Delivery Limitation

`svvy` can provide at-least-once recovery for prompt-bearing work it has not proven accepted by pi.

It cannot guarantee exact-once prompt delivery across a crash between "send prompt to pi" and "record accepted receipt" unless pi exposes one of:

- an accepted-message idempotency key;
- a durable accepted-message receipt keyed to the submitted queue or turn id;
- a queryable pi session event that proves a specific product submission id entered history.

Until that exists, recovery must be conservative:

- if acceptance is proven, never resend the prompt;
- if non-acceptance is proven, return the work to `pending` or `queued`;
- if acceptance cannot be proven, surface a recoverable interrupted state and avoid silently duplicating user text.

The UI should expose that state as a recovery issue for the affected surface rather than hiding it behind transcript inference.

## Invariants

- Recovery never runs app-global product work from a workspace coordinator.
- Recovery never routes by active workspace, focused tab, focused panel, or process cwd.
- Duplicate same-cwd tabs share one coordinator and one backend workspace runtime.
- Every recovery side effect has a durable owner scope and idempotency key.
- Queue order is per `surfacePiSessionId` and survives restart.
- A prompt-bearing queue item is marked delivered only after acceptance into the target pi surface is proven.
- `agent_context_refresh` items are delivered before later prompt-bearing work in the same surface queue.
- Initial handler starts and workflow attention wake-ups are typed surface queue rows rather than direct prompt calls.
- A handler initial auto-start runs at most once per handler thread unless the first attempt is proven not accepted.
- A recorded handler report emits exactly one durable episode for the handler command.
- A thread report notification delivery emits at most one orchestrator reconciliation turn.
- A thread report notification dismissal never rolls back the handler command or episode.
- A report request queue row delivery emits at most one handler turn for the pending request.
- Smithers execution, wait, approval, timer, output, transcript, event, artifact, and task-attempt facts stay in Smithers.
- Project CI recovery derives from Smithers durable terminal result plus `svvy` product binding, not process memory.
- Renderer layout restore cannot create, skip, or duplicate backend recovery work.

## Non-Goals

- App-global auth, OAuth, provider-key, and preference migration.
- A renderer-owned recovery loop.
- A second workflow abstraction under `workflow_*`.
- Duplicating Smithers run/node/attempt/wait/approval/timer/output/event/transcript/artifact state into `svvy`.
- Exact-once pi prompt delivery without pi accepted-message idempotency or receipts.
- Replaying native app-menu actions after restart.
- Recovering transient UI state such as popovers, composer drafts, selected transcript text, temporary search highlights, stale live stream state, or unsaved inline edits.
- Treating duplicate same-cwd tabs as separate workspace runtimes.

## Test Plan

Unit tests should cover:

- recovery work idempotency-key uniqueness and terminal-row behavior
- stale claim expiration and transactional re-claim
- per-surface queue ordering across `agent_context_refresh`, `user_message`, `thread_report`, `report_request`, `initial_handler_start`, and `workflow_attention`
- owner lock exclusion for concurrent coordinators
- deterministic seeding from durable facts without duplicate scheduler rows
- conservative prompt delivery behavior when pi acceptance is unknown

Integration tests should cover:

- workspace startup with one pending item from every work category
- duplicate same-cwd visual tabs sharing one coordinator and one recovered queue
- app-global provider/settings startup remaining separate from workspace recovery
- interrupted active turn recovery before queue drain
- initial handler auto-start recovery exactly once
- thread report notification delivery and dismissal recovery while the orchestrator was active during shutdown
- report request delivery recovery while the handler was active during shutdown
- wait-state restore without accidental resume
- title-generation restart with manual-rename freeze
- Smithers monitor reconnect, undelivered handler attention, and Project CI projection from durable Smithers state
- app logs emitted for recovery actions without becoming canonical state
- renderer layout restore consuming backend snapshots/events without triggering lifecycle repairs

E2E restart tests should use the OrbStack machine lane and exercise real app restart boundaries. They should not use retries, broad waits, selector churn, transcript inference, or test-only recovery behavior to hide product bugs.
