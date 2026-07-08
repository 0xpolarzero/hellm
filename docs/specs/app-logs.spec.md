# App Logs Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

App logs are structured, redacted product observability for the app itself.

They are not canonical state for sessions, surfaces, commands, artifacts, Workflows, generated
packages, or extension readiness; they are state-owned observability records and read-state facts.

`@svvy/core` defines `AppLogWritePort`, append input schemas, observation annotations, app-log read
model shapes, and command/read facade contracts. `@svvy/state` owns app-log records,
unread/read-mark records, and persisted Logs-pane view preferences, and implements the app-log
ports/facades. Runtime and app/bootstrap append app-log facts only through `AppLogWritePort`,
including normalized renderer bridge diagnostics forwarded by bootstrap adapters. Renderer code may
submit only explicit app-log read-state commands such as mark-read, visible-range-read, and
clear-workspace-unread through `StateCommandsFacade.appLogs`. Desktop renders logs from state read
models and app/bootstrap-prepared read-model invalidation notifications.

## Log Records

Each log record stores:

- id
- workspace id when applicable
- monotonic sequence
- timestamp
- level: `debug`, `info`, `warn`, or `error`
- source
- message
- redacted details
- related session id
- related surface id
- related thread id
- related command id
- related artifact id

## Sources

Current sources include:

- app lifecycle
- provider auth
- RPC failures
- sessions
- title generation
- surfaces
- prompts
- handler threads
- Smithers CLI guidance and command failures
- Workflows build validation
- direct tools
- `execute_typescript`
- artifacts
- external editor handoff
- renderer bridge issues

## UI

The Logs pane supports:

- level filters
- grouped source filters
- search
- viewport-based mark-read state for unfiltered browsing
- persisted scroll position while live logs arrive
- explicit jump-to-latest without automatic tail movement during live updates
- virtualized long-scroll rendering
- expandable details
- normalized errors and stack traces
- links to related sessions, threads, commands, and artifacts

Logs must not become the source of truth for session, thread, command, artifact, or Workflows state.

Logs-pane live updates are renderer projection/cache optimizations over app/bootstrap-prepared
read-model invalidations, explicit state-command receipts, and rebaseline notifications. They must
not be parsed to infer source invalidation, generated-package refresh, extension readiness, workflow
build status, command state, or any other product state change. Logs UI refetches `appLogs` and
`appLogSummary` through the state read facade after affected read models are named by notifications,
receipts, or rebaseline requests.
