# Structured Session State Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines the durable `svvy` product state that sits above pi transcript state for the
current base product.

## Adopted Direction

- Keep pi as the canonical transcript and runtime substrate for orchestrator and handler-thread
  surfaces.
- Keep Smithers as the workflow engine used directly through official CLI commands.
- Keep reusable workflow source and generated import metadata in the Workflows source/build model,
  not in session transcript state.
- Model sessions, turns, handler threads, thread groups, commands, request-user-input records,
  episodes, artifacts, generated agent-context bindings, saved Workflows generated metadata, waits,
  and lifecycle events explicitly.
- Persist agent profile choices separately from generated agent-context binding state.
- Persist one top-level per-turn decision for every surface.
- Treat every tool call as a command record.
- Project live tool use through Codex-like turn items: streamed argument snapshots before runtime
  execution, durable command events after runtime acceptance, and final command facts as the
  authoritative recovery source.
- Treat every top-level `execute_typescript` invocation as one parent command record and every
  generated client call as a child command record.
- Keep native control tools small: thread controls, extension loading/inspection, and
  request-user-input.
- Treat queued surface work as structured product state keyed by `surfacePiSessionId`.
- Emit workspace-level read-model updates independently from live surface transcript updates.
- Use selectors and metadata-first read models instead of making the UI reconstruct state from
  storage details or transcripts.
- Keep Dockview layout state, panel focus, and panel-to-surface bindings out of structured session
  state.

## Core Records

The durable state layer keeps first-class records for:

- workspace sessions
- live surface bindings
- turns
- commands
- thread groups
- handler threads
- request-user-input records
- surface queue items
- episodes
- artifacts
- generated agent-context bindings
- saved Workflows generated export metadata
- waits and lifecycle events

## Surface Identity

The product carries distinct ids:

- `workspaceSessionId`: durable top-level session container id
- `surfacePiSessionId`: pi session id for the addressed interactive surface
- `threadId`: durable handler-thread id, present only for handler surfaces
- `panelId`: Dockview panel id, never a runtime identity

Backend APIs must carry explicit surface identity. Callers must not overload `session.id` to mean
both workspace session and pi surface.

## Turn Decisions

Turn decisions are explicit product facts.

Allowed current decisions are:

```ts
type TurnDecision =
  | "pending"
  | "reply"
  | "exec_command"
  | "write_stdin"
  | "apply_patch"
  | "execute_typescript"
  | "list_extensions"
  | "load_extension"
  | "thread_start"
  | "thread_followup"
  | "thread_request_report"
  | "thread_group"
  | "thread_report"
  | "thread_episodes"
  | "request_user_input";
```

Smithers CLI usage is represented as `exec_command`. Workflows source-library usage is represented
as `exec_command` for `svvyx workflows ...` or as generated extension-client child commands when
the Workflows extension is loaded in `execute_typescript`.

## Handler Threads

A handler thread is a durable delegated objective backed by its own pi surface.

Thread records store:

- `threadId`
- `threadGroupId`
- `workspaceSessionId`
- `surfacePiSessionId`
- title
- objective
- history mode: `isolated` or `forked`
- objective state: `active` or `concluded`
- worktree context when relevant
- generated agent-context binding
- loaded and available extension ids
- pending report requests
- latest episode summary
- created, updated, and concluded timestamps

Thread state tracks delegated ownership and reporting. It is not a lossy proxy for raw Smithers
runtime state.

## Episodes

Episodes are durable semantic reports emitted only through `thread_report`.

`thread_report` without `outcome` creates an update episode.

`thread_report` with `outcome` creates a conclusion episode and marks the current handler objective
concluded.

Ordinary handler replies, tool calls, command summaries, and artifacts are not episodes.

## Commands

Command records store runtime facts for tool calls and command-family work:

- command id
- owning `workspaceSessionId`
- owning `surfacePiSessionId`
- optional `threadId`
- parent command id for generated-client child commands
- tool or command name
- status
- arguments snapshot or persisted argument artifact reference when needed
- output/progress events
- final facts
- linked artifacts
- started, updated, and finished timestamps

Shell commands, including official Smithers CLI commands and `svvyx workflows ...`, are ordinary
command records.

## Artifacts

Artifacts are durable session files linked to sessions, threads, and commands.

Artifact records include:

- artifact id
- owning session id
- optional thread id
- optional command id
- stored path
- exact stored filename
- MIME type
- byte size
- digest
- immutable flag
- created/deleted lifecycle fields

Artifacts must not depend on transcript parsing.

## Saved Workflows Metadata

Saved Workflows generated metadata is workspace-visible app state derived from the latest successful
Workflows build.

It records generated exports for the Workflows pane:

- kind: `agent`, `prompt`, `component`, or `workflow`
- namespace: `Agents`, `Prompts`, `Components`, or `Workflows`
- export name
- qualified name
- source path
- generated path
- internal UI-only metadata needed for source/generated links and Agents-pane links

This metadata is internal UI state. It is not a public agent-facing API and must not appear in
generated import examples or public declarations.

## Queues And Waits

Surface queues are keyed by `surfacePiSessionId`.

Queue item kinds include:

- `user_message`
- `agent_context_refresh`
- `initial_handler_start`
- `thread_followup`
- `report_request`
- `thread_report_notification`
- `request_user_input_answer`

Wait state belongs to the owning surface and records the durable prerequisite, such as user input,
execution approval, or external dependency.

## Read Models

Read models derive:

- session navigation summaries
- handler-thread summaries
- command summaries
- artifact links
- episode lists
- generated Workflows export lists
- wait and unread indicators

Read APIs must not repair lifecycle state heuristically from transcript replay, ad hoc refresh
loops, or renderer polling.

## State Boundary

Structured session state excludes:

- Smithers bridge lifecycle projection
- workspace-local svvy workflow source/runtime state
- `smithers_*` or `workflow_*` wrapper decisions
