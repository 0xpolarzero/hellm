# Structured Session State Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines the durable `svvy` product state that sits above pi transcript state for the
base product.

## Adopted Direction

- Keep pi as the canonical transcript and runtime substrate for orchestrator, handler-thread, and
  workflow task-agent attempt surfaces.
- Keep Smithers as the workflow engine used directly through official CLI commands.
- Keep reusable workflow source and generated import metadata in the Workflows source/build model,
  not in session transcript state.
- Model sessions, turns, handler threads, thread groups, commands, request-user-input records,
  episodes, artifacts, generated agent-context bindings, Workflows generated export metadata,
  waits, and durable lifecycle facts explicitly.
- Persist agent profile choices separately from generated agent-context binding state.
- Persist one top-level per-turn decision for every surface.
- Treat every tool call as a command record.
- Project live tool use through Codex-like execution-span cards: streamed argument snapshots before
  runtime execution, durable command events after runtime acceptance, and final command facts as the
  authoritative recovery source.
- Keep terminal command records immutable after `succeeded`, `failed`, or `cancelled` so
  prompt-finalization effects and duplicate terminal-settlement attempts cannot overwrite final
  facts, summaries, errors, or finished timestamps.
- Treat every top-level `execute_typescript` invocation as one parent command record and every
  generated facade call as a child command record.
- Keep native control tools small: thread controls, extension loading/inspection, and
  request-user-input.
- Treat queued surface work as structured product state addressed through a runtime target and
  persisted against the resolved `surfacePiSessionId`.
- Store durable facts in `@svvy/state` and project app, workspace, surface, command, queue,
  request-input, app-log, generated-package, artifact, and thread read models from those facts.
  `@svvy/runtime` publishes post-commit invalidation notifications independently from live surface
  stream patches.
- Use selectors and metadata-first read models instead of making the UI reconstruct state from
  storage details or transcripts.
- Keep transient Dockview focus, drag state, open menus, renderer component trees, warm caches,
  transcript projections, and panel-local view affordances out of structured session state. Persist
  only durable workspace layout JSON, panel metadata, and panel-to-surface bindings as workspace
  layout state in `@svvy/state`, separate from live surface runtime identity.

## Core Records

`@svvy/state` keeps first-class SQLite-backed records for:

- workspace sessions
- durable surface records, persisted pi session references, and recovery metadata needed to
  reacquire live runtime scope
- turns
- commands
- thread groups
- handler threads
- request-user-input records
- runtime approval records and approval wait facts
- surface queue items
- episodes
- artifacts
- generated agent-context bindings
- generated-package fact rows, workspace-link facts, and generated Workflows export metadata
- waits and durable lifecycle facts

`@svvy/state` persists durable workspace layout snapshots, panel metadata, and panel-to-surface
bindings, but does not persist process-local runtime handles, active Effect fibers, pi session
objects, prompt locks, transient Dockview focus, open menus, or drag state.

## Surface Identity

The product carries distinct ids:

- `workspaceSessionId`: durable top-level session container id
- `surfacePiSessionId`: pi session id for the addressed interactive surface
- `threadId`: durable handler-thread id, present only for handler surfaces
- `panelId`: Dockview panel id, never a runtime identity

Runtime facade APIs and state ports must carry explicit surface identity. Callers must not overload
`session.id` to mean both workspace session and pi surface.

## Turn Decisions

Turn decisions are explicit product facts. The stable top-level taxonomy is:

- `pending`
- `reply`
- `native_tool`
- `extension_facade`
- `command_family`

Native tool ids, command metadata, actor availability, and specialized projection behavior are
defined by `@svvy/core` native-tool contracts and `@svvy/extensions` metadata/declaration output,
not duplicated as an open-ended runtime enum. A `native_tool` decision stores the authoritative tool
id such as `exec_command`, `thread_start`, `thread_list`, `thread_episodes`, or
`request_user_input`. An `extension_facade` decision stores the loaded extension facade id and
command id. A `command_family` decision stores the command-family surface such as
`svvyx workflows ...`.

Smithers CLI usage is represented as `exec_command`. Workflows source-library usage is represented
as `exec_command` for `svvyx workflows ...` or as generated extension-facade child commands when
the Workflows extension is loaded in `execute_typescript`.

## Handler Threads

A handler thread is a durable delegated objective backed by its own pi surface.

Thread records store:

- `threadId`
- `threadGroupId`
- `workspaceSessionId`
- `surfacePiSessionId`
- `parentThreadId`: nullable durable lineage to the handler thread that requested this thread, or
  `null` when the start has no parent handler thread
- title
- objective
- history mode: `isolated` or `forked`
- objective state: `active` or `concluded`
- worktree context when relevant
- generated agent-context binding fingerprint
- surface extension binding fingerprint
- pending report requests
- latest episode summary
- created, updated, and concluded timestamps

Loaded, available, and unavailable extension state lives in extension binding rows and read models.
Thread records reference the binding fingerprints; they do not duplicate the extension usage list.

Thread state tracks delegated ownership and reporting. It is not a lossy proxy for raw Smithers
runtime state.

`parentThreadId` is lineage only. It does not make the parent handler the strategic owner of the
child thread, does not share pi transcript state, and does not grant the child any callable surface
from the parent. State validates that a non-null parent thread belongs to the same
`workspaceSessionId` as the requesting turn before committing the child thread.

## Thread Episodes

Handler-thread report episodes are durable semantic reports emitted only through `thread_report`.

`thread_report` without `outcome` creates an update episode.

`thread_report` with `outcome` creates a conclusion episode and marks the current handler objective
concluded.

Ordinary handler replies, tool calls, command summaries, and artifacts are not thread episodes.
Orchestrator-local durable episodes are state-persisted product facts created when `@svvy/runtime`
applies accepted control/effect work through core-owned state ports implemented by `@svvy/state`.
They must not be
conflated with handler-thread `thread_report` episodes, and runtime does not own episode
persistence outside state transaction ports.

## Commands

Command records store durable product facts emitted by runtime-owned tool-call and command-family
work:

- command id
- owning `workspaceSessionId`
- owning `surfacePiSessionId`
- optional `threadId`
- parent command id for extension-facade child commands
- tool or command name
- status
- arguments snapshot or persisted argument artifact reference when needed
- command output/progress event rows
- final facts
- linked artifacts
- started, updated, and finished timestamps

Shell commands, including official Smithers CLI commands and `svvyx workflows ...`, are ordinary
command records.

`argument_snapshot`, `output`, and `progress` rows are durable command read-model
input, not runtime event-stream replay and not opaque logs. Command rollups and command inspectors
expose started/updated/finished timestamps plus ordered argument snapshots alongside output,
progress, patch, diagnostic, artifact, child-command, and final-fact projection fields. Transcript
cards may derive execution-span duration, compact metrics, grouped output, and semantic sections from
those fields; inspectors remain the full command debugger. Runtime events are non-durable
notifications; recovery uses command facts and state rows, not event replay.

## Artifacts

Artifacts are durable session files linked to sessions, threads, and commands.

Artifact records include:

- artifact id
- owning `workspaceSessionId`
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

## Workflows Generated Export Metadata

Workflows generated export metadata is workspace-visible product state derived from the latest
successful `@svvyx/workflows` generated-package facts.

It records generated exports for the Workflows pane:

- kind: `agent`, `prompt`, `component`, or `workflow`
- namespace: `Agents`, `Prompts`, `Components`, or `Workflows`
- export name
- qualified name
- source path
- generated path
- read-model-only metadata for source/generated links and Agents-pane links

This metadata is read-model-only projection derived from state facts for source/generated links and
Agents-pane links. It is not runtime input, not a public agent-facing API, and must not appear in
generated import examples or public declarations.

## Queues And Waits

Surface queue rows are persisted by `@svvy/state`. `@svvy/runtime` resolves public and internal work
into `RuntimeSurfaceTarget` values and owns queue claiming and dispatch. Persisted queue rows are
keyed by the resolved `surfacePiSessionId`. Human/composer submission accepts only user-messageable
orchestrator or handler targets; workflow-task-agent queue rows are inserted only by accepted
Smithers task-agent bridge calls or runtime-owned coordinators. `PromptTarget` is the human/composer
submission shape, not the umbrella identity for runtime queue rows, bridge delivery, or
workflow-task attempts.

Queue item kinds include:

- `user_message`
- `initial_handler_start`
- `thread_followup`
- `report_request`
- `thread_report_notification`
- `request_user_input_answer`
- `workflow_task_agent_start`

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

Handler-thread summaries expose objective, objective state, history mode, latest command references,
workflow-observed command references, artifact links, episode summary, and counts separately.
Command rollup fields belong to command read models and inspectors. The UI must not replace the
objective with latest report text; objective, current activity, latest command projection, and
latest report are separate read-model concepts.

## State Boundary

Workflow task-agent attempts are app-owned pi-backed surfaces. `svvy` persists their generated
context fingerprint, command facts, approvals, wait state, context-budget usage, bridge-call binding,
and visible surface projection so they remain inspectable and resumable through the product.

Smithers remains owner of workflow graph execution, scheduling, retry/resume semantics, and
lifecycle decisions. `@svvy/state` may persist CLI-observed Smithers
workflow/run/task/node/iteration/attempt bridge facts, command links, artifact/log links,
retry/resume observations, and workflow status summaries required by product read models, plus
app-owned workflow-task-attempt surface facts.

Structured session state excludes:

- product-owned Smithers execution control
- workspace-local Smithers source and Smithers-owned workflow runtime state, except CLI-observed
  linkage facts required for svvy read models
- app-global reusable Workflows source, which is represented separately through generated-package
  facts and Workflows read models
- `smithers_*` or `workflow_*` wrapper decisions
