# Workspace Runtime Recovery Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines `@svvy/runtime` recovery for acquired workspace runtime scopes and the app-global
generated-package recovery work they depend on.

## Core Model

Each acquired workspace runtime scope owns one recovery coordinator.

Duplicate visual tabs for the same canonical cwd share:

- workspace runtime scope
- session catalog
- live surface registry
- structured state
- queues
- handler threads
- app logs
- generated Workflows export read models projected from generated-package facts
- recovery coordinator

They keep visual tab state, active layout selection, and panel-local layout state separate.

## Recovered State

The coordinator recovers:

- sessions
- live pi surface registry shells
- in-memory prompt locks reconstructed from durable active turn, queue claim, and pi session
  reference state
- surface queues
- queued user messages
- initial handler starts
- thread report notifications
- report requests
- request-user-input records and answer deliveries
- runtime approval records and wait-state facts
- external dependency/readiness wait facts
- title jobs
- generated agent-context refresh work
- readiness waits for app-global generated package facts
- workspace generated package link repair
- app logs

## Runtime Recovery Rows

Durable runtime recovery rows use:

- id
- scope kind: `app` or `workspace`
- workspace id only for workspace-scoped recovery rows; app-scoped rows store no workspace id
- kind
- owner scope
- owning `surfacePiSessionId`, `threadId`, `workflowTaskAttemptId`, and `sourceCommandId` when the
  work is scoped to those product identities
- idempotency key
- priority
- ordering key
- not-before timestamp
- claim lease owner, lease expiry, and `leaseVersion`
- status
- attempts and max attempts

Claim, lease-refresh, settlement, retry, and terminal transitions pass the current
`claimOwnerId` and `leaseVersion`; state rejects stale owners and stale lease versions.

- next attempt timestamp
- cancellation reason or cancellation source when cancelled
- last error summary
- payload
- created, claimed, completed, and failed timestamps

Recovery work kinds are:

- `queue_delivery`
- `active_turn_recovery`
- `workflow_task_attempt_recovery`
- `generated_context_refresh`
- `generated_package_refresh`
- `source_reconcile`
- `workspace_generated_package_link_repair`
- `artifact_materialization`
- `title_generation`
- `request_input_wait`
- `approval_wait`
- `command_process_reconciliation`

App logs are persisted/read-model state and recovery observability output; they are not a separate
recovery work kind.

`generated_package_refresh` is app-scoped recovery work for app-global generated `@svvyx/*` package
builds. It belongs to the app-global generated-package coordinator, stores app scope with no
workspace id, is deduped by an app-scope idempotency key, and never runs once per workspace.
`workspace_generated_package_link_repair` is workspace-scoped recovery work where runtime asks
`@svvy/extensions` for an immutable workspace-link plan for the targeted workspace/package pair,
then applies that plan after the relevant generated-package facts have been committed. Unopened
workspaces receive workspace-link repair rows/facts; app-global package builds do not depend on
workspace acquisition. Workspace recovery coordinators never run generated-package builds; they
only wait for committed generated-package facts and schedule
`workspace_generated_package_link_repair`.

Queued surface work such as `thread_report_notification`, `report_request`, and
`request_user_input_answer` remains typed queue state. Recovery schedules `queue_delivery` work for
the affected surface; that work wakes the ordinary queue dispatcher and never copies queue payloads
into recovery payloads. If recovery must repair a missing thread-report notification, runtime may
create the idempotent durable queue row through `RuntimeQueueStatePort`; delivery still happens
through normal queue delivery.
Extension context refresh is recovered through the same per-surface bound fingerprint and
update-before-next-turn setting used during normal pre-dispatch checks.

## Startup Order

On workspace runtime scope acquisition:

1. load state-owned workspace settings and app-global settings references
2. load state-owned session, queue, app-log, generated fact, and surface records
3. hydrate process-local live surface registry shells
4. restore queue state and reconstruct process-local prompt locks from durable active work
5. schedule workspace generated package link repair for `.smithers/node_modules/@svvyx/*` after
   app-global generated package facts are current
6. resume recoverable runtime recovery rows through transactional claims
7. record recovery app-log facts through state ports after committed recovery transitions

Renderer layout restore is a consumer of state-backed read models. It must not drain queues or repair
product work directly.

## Effect Lifecycle

The recovery coordinator is acquired through the workspace runtime scope Effect layer. Long-lived recovery
workers are forked with `Effect.forkScoped` inside that layer scope. Releasing the workspace runtime scope
scope interrupts only process-local fibers, live registries, prompt locks, watcher subscriptions, and
open pi handles owned by that acquisition. Durable leases, recovery rows, queue rows, generated
facts, app logs, and state read models remain in `@svvy/state` and are retried or reconciled by the
next acquisition through transactional claims.

## Workflows Build/Link Recovery

The app-global source-invalidation coordinator requests and dedupes app-global generated-package
refresh work when:

- the generated `@svvyx/workflows` package is missing
- generated `@svvyx/extensions` is missing or stale for workflow imports
- the latest file-backed Workflows source edit, including Agents-pane edits to workflow-agent
  `.agent.json` records, marked the Workflows build stale

Runtime applies the refresh request by invoking the `@svvy/extensions` generated-package service
through the app-composed Effect service graph. `@svvy/extensions` writes the generated package files
and returns build evidence; runtime then commits generated-package facts through core-owned state
ports implemented by `@svvy/state`. The workspace recovery coordinator owns scheduling and applying
runtime-owned workspace-link repair only after app-global generated-package facts are current; it
asks `@svvy/extensions` for the immutable plan and commits link facts through core-owned state ports.
It may wait on or observe app-global facts, but it does not schedule, dedupe, or recover app-global
generated-package builds. Build failures become structured diagnostics and app logs. The coordinator
must not edit generated files by hand.

The workspace recovery coordinator schedules workspace-scoped
`workspace_generated_package_link_repair` when an acquired workspace has missing or stale
`.smithers/node_modules/@svvyx/workflows` or
`.smithers/node_modules/@svvyx/extensions` links. Link repair runs only after runtime has committed
the relevant app-global generated-package facts through core-owned state ports implemented by
`@svvy/state`. Runtime asks `@svvy/extensions` for the immutable workspace-link plan, applies it,
and commits workspace-link facts through those state ports; `@svvy/extensions` owns generated
package content and package-safe link plans.

## Non-Goals

- hidden transcript replay repair
- renderer polling as recovery
