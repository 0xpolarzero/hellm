# Workspace Runtime Recovery Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines backend recovery for acquired workspace runtimes.

## Core Model

Each acquired workspace runtime owns one recovery coordinator.

Duplicate visual tabs for the same canonical cwd share:

- backend workspace runtime
- session catalog
- live surface registry
- structured state
- queues
- handler threads
- app logs
- saved Workflows generated-state visibility
- recovery coordinator

They keep visual tab state, active layout selection, and panel-local layout state separate.

## Recovered State

The coordinator recovers:

- sessions
- live pi surface registry
- prompt locks
- surface queues
- queued user messages
- initial handler starts
- thread report notifications
- report requests
- request-user-input records and answer deliveries
- title jobs
- generated agent-context refresh work
- Workflows build/link freshness
- app logs

## Scheduler Records

Durable scheduler records use:

- id
- workspace id
- kind
- owner scope
- idempotency key
- status
- attempts
- payload
- created, claimed, completed, and failed timestamps

Current scheduler kinds include:

- `initial_handler_start`
- `thread_report_notification`
- `report_request`
- `request_user_input_answer`
- `agent_context_refresh`
- `title_job`
- `workflows_build_refresh`

## Startup Order

On workspace runtime acquisition:

1. load workspace settings and app-global settings references
2. load session and surface records
3. restore live surface registry shells
4. restore queue state and prompt-lock state
5. ensure Workflows generated package links for `.smithers/node_modules`
6. resume recoverable scheduler records through transactional claims
7. emit recovery app logs

Renderer layout restore is a consumer of backend snapshots. It must not drain queues or repair
product work directly.

## Workflows Build/Link Recovery

The coordinator may enqueue or run Workflows build/link refresh when:

- the generated `@svvy/workflows` package is missing
- the workspace `.smithers/node_modules/@svvy/workflows` link is missing or stale
- generated `@svvy/extensions` is missing or stale for workflow imports
- the latest source edit or Agents-pane edit marked the Workflows build stale

Build failures become structured diagnostics and app logs. The coordinator must not edit generated
files by hand.

## Non-Goals

- hidden transcript replay repair
- renderer polling as recovery
