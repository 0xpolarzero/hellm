# App Logs Spec

## Status

- Date: 2026-06-08
- Status: adopted direction

## Scope

App logs are structured, redacted product observability for the app itself.

They are not canonical product state.

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
- source filters
- search
- mark-read state
- Live/Frozen tail behavior
- virtualized long-scroll rendering
- expandable details
- normalized errors and stack traces
- links to related sessions, threads, commands, and artifacts

Logs must not become the source of truth for session, thread, command, artifact, or Workflows state.
