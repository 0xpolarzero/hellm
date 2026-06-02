# Workflow Supervision Spec

## Status

- Date: 2026-04-21
- Status: adopted direction for write-driven workflow supervision
- Scope of this document:
  - define how `svvy` supervises Smithers runs under handler threads
  - define the required runtime flow after Smithers-native run-launch and supervision commands
  - define recovery, reconnect, wake-up, and cleanup behavior
  - separate the borrowed Smithers transport shape from `svvy`-owned product behavior

## Purpose

`svvy` needs workflow supervision to be a real product subsystem rather than a thin tool wrapper.

Starting a Smithers run is not enough.

The product also needs to:

- keep the run attached to the supervising handler thread
- project workflow state into durable `svvy` product facts while the run is alive
- wake the handler thread back up when the workflow needs another decision
- recover cleanly after app restart or stream interruption
- clean up only the affected run without disturbing other delegated work

The storage boundary is strict:

- Smithers owns execution facts.
- `svvy` owns ownership/product binding, attention cursors, product projections, UI facts, and thread facts.
- `svvy` must re-read Smithers durable state when an event says execution facts changed instead of copying Smithers' run ledger into its own schema.

## Product Fit

The PRD and current specs define:

- one orchestrator that owns strategy
- handler threads that own delegated objectives
- Smithers as the workflow execution engine
- explicit backend-to-renderer workspace updates and surface updates
- structured session state as the product read model

This means workflow supervision is:

- a handler-thread responsibility
- write-driven product behavior above Smithers
- not transcript inference
- not orchestrator polling
- not a separate execution engine

This spec refines section 5 of [progress.md](../progress.md) and the workflow-run parts of the [Structured Session State Spec](./structured-session-state.spec.md).

## Two Smithers Contexts

This repo contains two different Smithers contexts and they must not be conflated.

### 1. Repo Authoring Workflows

The repo-root [`workflows/`](../../workflows/README.md) workspace exists so engineers and agents can use Smithers to build and maintain `svvy` itself.

Those workflows:

- are source-checkout authoring assets
- may rely on repo-local `node_modules`, `smithers.db`, prompts, and scripts
- are not the shipped product runtime
- are not the workflow registry that `svvy` should supervise inside the desktop app

### 2. Product Runtime Workflows

The shipped app also needs Smithers workflows, but those are a different thing.

Product runtime workflows:

- are the workflows supervised by `svvy` handler threads inside the desktop app
- must work in a packaged build without a source checkout
- must not depend on repo-root `workflows/`, `workflows/node_modules/.bin/smithers`, or `workflows/smithers.db`
- may come from saved entries under `.svvy/workflows/entries/`
- may come from artifact entries under `.svvy/artifacts/workflows/<artifact_workflow_id>/entries/`

When this spec says "workflow" without qualification, it means product runtime workflows, not the repo authoring workspace.

## Out Of Scope

This spec does not define:

- workflow selection policy beyond the Smithers supervision surface itself
- workflow authoring UX
- the exact workflow library shape
- renderer visuals beyond the state and sync requirements needed to support them

Those remain separate steps and specs such as `docs/specs/workflow-library.spec.md`.

## Borrowed Boundary

`svvy` should borrow Smithers control-plane transport and inspection surfaces rather than inventing a separate workflow polling model or workflow debugger.

The relevant Smithers surfaces are:

- per-run progress events emitted by `runWorkflow`
- HTTP run-event streaming with reconnect by `afterSeq`
- Gateway snapshot and streaming surfaces for long-lived clients and live graph inspection
- official read models such as run summary, blocker diagnosis, node detail, transcript, artifacts, and raw event history

The borrowed part is:

- attaching to a Smithers run control-plane stream or read surface
- filtering by run id and node id where needed
- reconnecting from a known event sequence or re-baselining from an official snapshot
- preserving raw Smithers run status and lineage instead of flattening it into thread state

The `svvy`-owned part is:

- workflow-run records
- handler-thread state projection
- synthetic handler wake-ups
- workspace and surface update emission
- cleanup and isolation rules
- restart recovery and supervision durability

## Adopted Direction

- Workflow lifecycle state is write-driven. Live Smithers event attachment is one sanctioned lifecycle producer, and reconnect or bootstrap control-plane reads are another sanctioned lifecycle producer when they immediately project durable state.
- There is no silent polling fallback for `svvy`-owned workflow supervision. Reconnect or bootstrap reads are explicit lifecycle writes, not background read-side repair.
- One handler thread may supervise many workflow runs over its lifetime.
- A handler thread may own concurrent active Smithers runs when they have different `workflowId` values; a second nonterminal run with the same `workflowId` requires explicit resolution before a fresh launch.
- Workflow task agents are a lower-level actor class inside Smithers tasks, not another `svvy` interactive surface.
- `svvy` should derive active and latest workflow summaries from workflow-run records and recency rules rather than persisting a thread-level latest-workflow pointer.
- Workflow attention must reacquire and target the owning handler surface by `surfacePiSessionId`, never a globally active surface or the currently focused Dockview panel.
- `thread_start`, `thread_resume`, `thread_handoff`, and `wait` remain the only `svvy`-native control tools in this area.
- Agent-facing workflow supervision should use Smithers-native semantic tools exposed through the Bun bridge rather than a svvy-defined `workflow_*` abstraction.
- Shipped product runtime must not depend on repo-root `workflows/`, repo-relative Smithers binaries, or nearest-db path walking.
- Runnable saved entries should live under `.svvy/workflows/entries/`, while artifact entries should live under `.svvy/artifacts/workflows/<artifact_workflow_id>/entries/`, and neither should depend on the repo authoring workspace.
- A workflow run never returns control directly to the orchestrator.
- Only `thread_handoff` returns control to the orchestrator.
- `thread_handoff` returns control by durably recording the handoff episode and current objective-span closure, then scheduling a typed `handler_handoff` item in the orchestrator surface queue. Notification delivery is ordered through the orchestrator queue, but it does not determine whether the handoff succeeded.
- `thread_resume` lets the orchestrator explicitly re-engage a completed handler thread for follow-up work in the same delegated context; Smithers run decisions remain inside that handler thread.
- If a handler thread opens a workflow run for its current objective span, that thread stays responsible until the span ends in `thread_handoff`; waits, approvals, resumes, and repairs stay inside the handler lifecycle.
- Workflow-task-attempt projection is write-driven from the current Smithers attempt identity and explicit runtime handlers. When a task-local tool needs the attempt before handler-side projection has landed, the bootstrap path uses the exact Smithers task-attempt identity `(runId, nodeId, iteration, attempt)` from the current task context, not a resume-handle lookup, heuristic scan, or fallback chain.

## Core Concepts

### Smithers Run

A Smithers run is the canonical execution instance inside Smithers.

It owns:

- event emission
- node execution
- retries and pauses
- terminal workflow outcome
- run, node, iteration, attempt, wait, approval, output, timer, signal, and event facts

### `svvy` Workflow-Run Record

A `svvy` workflow-run record is the product-level durable summary of one Smithers run under one handler thread.

It exists so `svvy` can reason about:

- which run belongs to which thread
- what the run currently means for the delegated objective
- what the UI should show
- what should happen after restart

It stores product binding and projection fields only:

- local `workflowRunId`
- workspace id and workspace session id
- owning handler `threadId`
- owning handler `surfacePiSessionId`
- Smithers `runId`
- `workflowId`
- workflow source scope and runnable entry path
- optional saved-entry or artifact-workflow references
- product projection state used by the sidebar and handler wake-up scheduler
- current product attention state
- last applied Smithers event sequence or snapshot cursor used to know where to re-read from next
- pending handler-attention cursor
- delivered handler-attention cursor
- lineage pointer or continuation reference when Smithers reports a continued run
- product summary text shown in `svvy`
- related `svvy` artifact ids, command ids, Project CI ids, and UI links
- created and updated timestamps

It must not store Smithers execution state as `svvy`-owned truth. In particular, it must not persist its own copies of Smithers:

- run tables or run lifecycle ledger
- node state
- task attempt state
- retry attempt state
- wait state
- approval request or approval decision state
- timer state
- signal delivery state
- node output, final output, partial output, or validated result payload
- raw event history
- workflow task-agent transcript as the execution transcript of record

Those facts stay in Smithers. `svvy` may store foreign keys, display summaries, projection failures, product links, and redacted artifact or command projections that explain what the product should show.

### Workflow Monitor

A workflow monitor is the Bun-side runtime helper that:

- attaches to the Smithers event stream for one workflow run
- contributes normalized workflow product-projection writes into the durable `workflow-run` record
- handles live attachment, reconnect, and teardown around that durable state

The monitor is runtime state, not transcript state and not the durable lifecycle source of truth.

### Workflow Task Agent

A workflow task agent is the lower-level worker attached to one Smithers task.

It is:

- hosted by Smithers inside a task attempt
- configured with model, reasoning, system prompt, and task-local tools
- not a `svvy` session surface, handler thread, or workflow supervisor

Smithers owns the task agent's:

- prompt execution
- output validation
- retries and fallback chains
- approval gates
- hijack behavior

`svvy` owns only the higher-level product projection and the surrounding handler-thread supervision.

That projection should treat the Smithers task attempt as a real product row addressable from the UI, not as transcript-only internal noise. It is still not the execution attempt record of truth. Smithers owns the attempt identity, attempt lifecycle, retry state, output validation, approval waits, timer waits, usage, and task-agent transcript. `svvy` stores the Smithers attempt address plus product links and projection metadata so the handler, inspector, and UI can re-read Smithers detail by exact `runId`, `nodeId`, `iteration`, and `attempt`.

`svvy` also stores svvy-owned generated agent context binding metadata on that projection row. `meta.agentContextBinding` records the workflow-task actor, loaded and available extension ids, generated agent context fingerprint, external instruction fingerprints, optional resolved prompt artifact id, and binding timestamp for the exact Smithers attempt. This is provenance for svvy's prompt channel, not a copy of Smithers execution state.

### Handler Attention

Handler attention means a workflow state transition now requires another handler-thread decision.

The important cases are:

- workflow entered an actionable durable wait
- workflow completed
- workflow failed
- workflow was cancelled
- workflow continued as new and lineage now needs relinking
- supervision transport became irrecoverably degraded

## End-To-End Flow

The adopted flow is:

1. The orchestrator delegates an objective into a handler thread.
2. The handler thread selects, writes, or receives a concrete workflow to run.
3. The handler thread calls `smithers_run_workflow({ workflowId, input, runId? })` or another Smithers-native supervision tool through the Bun bridge.
4. `svvy` launches or resumes the Smithers run and obtains the concrete Smithers run id.
5. `svvy` persists or updates the workflow-run record immediately.
6. `svvy` records the workflow-run state needed for later reconnect and wake-up dedupe.
7. `svvy` attaches or restores the runtime helper for that workflow run and uses it to emit write-driven product projection into durable `svvy` state.
8. When Smithers task attempts exist under that run, `svvy` projects workflow-task-attempt UI rows keyed by `runId`, `nodeId`, `iteration`, and `attempt`, plus `svvy` product links to related commands and artifacts. The authoritative attempt status, output, approval, wait, retry, usage, and transcript details are re-read from Smithers by those exact identifiers.
9. The Bun side emits explicit workspace updates and surface updates whenever those durable projections change visible workspace state or the live handler surface state.
10. If the workflow reaches a state that needs another handler decision, `svvy` opens a synthetic background turn on that same handler thread.
11. The handler thread uses `thread_current` to identify active workflow run ids, uses Smithers-native tools for detailed workflow state, and decides whether to inspect, repair, resume, ask the user, or hand control back with `thread_handoff`.
12. If the orchestrator later needs more help from a completed handler thread, it uses `thread_resume` to queue a new handler-surface message instead of directly controlling Smithers.

## Shipped App Integration

The shipped desktop app should run Smithers as an embedded product runtime, not by shelling out to the repo's authoring workspace.

The packaged-app contract is:

- bundle the product-owned Smithers bridge and supporting runtime assets with the app
- let the Bun side own the Smithers bridge integration, packaged DB location configuration, and `svvy` product projection for product workflows while Smithers owns run lifecycle facts
- use embedded `smithers-orchestrator` APIs for lifecycle control rather than source-checkout-relative CLI paths
- let pi-facing tools talk to the Bun-owned bridge; they must not spawn `smithers` directly
- discover normal product workflows only from configured saved entries under `.svvy/workflows/entries/` and artifact entries under `.svvy/artifacts/workflows/`; test and POC workflow definitions are registered only by tests or fixture harnesses
- use official Smithers control-plane surfaces for monitoring and reconnect semantics:
  - `runWorkflow(...)` for direct start and resume behavior
  - multi-workflow server semantics such as `POST /v1/runs`, `POST /v1/runs/:runId/resume`, `POST /v1/runs/:runId/cancel`, and `GET /v1/runs/:runId/events?afterSeq=N` for lifecycle parity
  - Gateway-style devtools snapshots and streams when the product needs live graph inspection

Normal product startup must not register smoke-test, proof, or fixture workflows. If the workspace has no saved or artifact entries, `smithers_list_workflows` returns an empty list.

## Workflow Task Agents

Product-runtime workflows may contain lower-level workflow task agents inside their task nodes.

The adopted direction is:

- when a product workflow needs an adaptive coding agent, use a PI-backed workflow task agent by default
- configure that task agent with a minimal `svvy` workflow-task system prompt rather than the orchestrator or handler-thread prompt
- treat workflow-specific custom task prompts as overlays appended to the base workflow-task prompt; the base prompt only establishes task scope, task-local tools, and task-root locality
- expose only prompt-only task-local cx CLI instructions, direct tools, and `execute_typescript` to
  that actor
- the default adopted task-agent capability set is task-local cx CLI guidance through
  `exec_command`, direct tools, and `execute_typescript` for typed composition
- project each Smithers task attempt into a `svvy` workflow-task-attempt UI row with exact Smithers identifiers and attach any `svvy` command or artifact projections to that row instead of leaving product navigation in a local ephemeral trace
- do not expose `thread_start`, `thread_handoff`, `wait`, or `smithers_*` to workflow task agents or mention those unavailable controls in their base prompt
- do not load ambient pi built-in tools or workspace-discovered extension tools into the task agent runtime
- execute the task agent and its task-local tools from Smithers' current task root or worktree, while leaving Smithers runtime DB ownership and `svvy` workflow projection workspace-scoped
- preserve structured message arrays, step boundaries, and usage across retries, schema repair prompts, and hijack handoff instead of flattening continuation state into plain transcript prose
- stream live assistant deltas and tool updates so heartbeat freshness and UI activity reflect real task-agent progress rather than only terminal text

This is intentionally the same broad recipe family as the orchestrator and handler thread:

- model
- reasoning effort
- system prompt
- tools

But it is a different actor contract because the host and lifecycle are different:

- orchestrator and handler threads are pi sessions hosted by `svvy`
- workflow task agents are task-scoped agents hosted by Smithers

Smithers runtime controls around task agents stay outside the task-agent capability set:

- approval belongs to Smithers approval nodes or task approval gates such as `<Approval>` or `needsApproval`
- hijack belongs to Smithers runtime or operator controls that reopen the underlying task-agent session

`svvy` should treat approvals and hijack as workflow-supervision state and operator surfaces around a run, not as ordinary callable tools for the task agent itself.

## Smithers Capability Set

`svvy` should not define a parallel `workflow_*` API.

The shipped app should register Smithers-native workflow tools through the Bun-owned bridge.

The adopted naming rule is:

- when Smithers already publishes an agent-facing semantic tool name, use that name verbatim after the `smithers_` namespace prefix
- when Smithers exposes only a server route or Gateway method, keep the Smithers noun and verb shape instead of inventing a svvy alias
- the Bun bridge may adapt transport, auth, and packaging details, but it must not rename Smithers concepts into a competing product vocabulary

The exact contract is:

- the agent does not receive the raw embedded Smithers runtime object, a generic HTTP client for Smithers, direct MCP transport, or direct CLI execution rights
- `svvy` owns the actual tool registration and exposes first-party `smithers_*` tools to the model
- each exposed `smithers_*` tool is a narrow adapter around one Smithers semantic tool, server route, or Gateway method
- those adapters may add only product-runtime concerns that Smithers itself does not know about:
  - bind the call to the current handler thread or session
  - resolve runnable saved and artifact workflow identifiers
  - normalize transport and packaging details for the desktop app
  - record durable `svvy` command facts, linkage, and lifecycle metadata
- those adapters must not create a second abstract API that renames Smithers concepts into `workflow_*` or other `svvy`-specific verbs when Smithers already provides the right vocabulary
- `svvy` does not need to expose every Smithers capability in v1, but whatever it does expose should preserve Smithers semantics rather than re-design them

Actor-specific exposure is part of that contract:

- the orchestrator prompt should know that handler threads can supervise workflows through `smithers_*`, but it should not receive the `smithers_*` generated tool schema in its own prompt
- handler-thread prompts should receive the `smithers_*` schema because they are the delegated surfaces that actually supervise workflow execution
- handler-thread prompts should not receive orchestrator-only tools such as `thread_start` in the default adopted model
- workflow task agents should receive only their task-local cx CLI instructions, direct tools, and
  `execute_typescript`, with no ambient pi built-ins or extension-provided callable tools beyond
  that task-local set
- awareness of another actor's capabilities belongs in compact instructional prose, not in leaked callable declarations for tools that actor cannot invoke

The first adopted Smithers-native surface is:

| Agent-visible tool                    | Product class                       | Purpose                                                                                                                                                             | Primary adopted Smithers contract                                                                                                           |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `smithers_list_workflows`             | required                            | List runnable workflow entries, support targeted lookup such as `workflowId` and `productKind`, and return each entry's full handler-visible workflow contract for deeper inspection. | Smithers semantic tool `list_workflows`, backed by the app-owned workflow registry plus Bun-side contract compilation.                      |
| `smithers_run_workflow`               | required                            | Launch a discoverable workflow when `runId` is omitted, or resume exactly the supplied `runId`; omitted `runId` never silently resumes and is rejected when the same handler already owns a nonterminal run with the same `workflowId`. | Smithers semantic tool `run_workflow`, backed by embedded `runWorkflow(...)`, `POST /v1/runs`, and `POST /v1/runs/:runId/resume` semantics. |
| `smithers_list_runs`                  | required                            | List recent runs and their compact summary state, while enriching each summary with svvy `sessionId` and `threadId` ownership when the run belongs to a recorded handler thread. | Smithers semantic tool `list_runs`, aligned with `GET /v1/runs` and Gateway `runs.list`, with svvy-side ownership projection layered on top. |
| `smithers_get_run`                    | required                            | Return the main run summary the handler needs to reason.                                                                                                            | Smithers semantic tool `get_run`, aligned with `GET /v1/runs/:runId` and Gateway `runs.get`.                                                |
| `smithers_watch_run`                  | bridge or UI                        | Watch a run until terminal or timeout.                                                                                                                              | Smithers semantic tool `watch_run`, backed by `onProgress` plus bridge-owned watch behavior.                                                |
| `smithers_explain_run`                | required                            | Explain why the run is blocked, waiting, stale, or otherwise attention-worthy.                                                                                      | Smithers semantic tool `explain_run`, aligned with Smithers `why` diagnostics.                                                              |
| `smithers_list_pending_approvals`     | required                            | List pending approvals relevant to the current run or node.                                                                                                         | Smithers semantic tool `list_pending_approvals`, aligned with approval queries over pending gates.                                          |
| `smithers_resolve_approval`           | required                            | Approve or deny a pending approval.                                                                                                                                 | Smithers semantic tool `resolve_approval`, aligned with approve-or-deny server semantics and Gateway approval decisions.                    |
| `smithers_get_node_detail`            | required                            | Inspect attempts, tool calls, token usage, and validated output for one node.                                                                                       | Smithers semantic tool `get_node_detail`.                                                                                                   |
| `smithers_list_artifacts`             | required                            | Inspect structured workflow artifacts and node outputs.                                                                                                             | Smithers semantic tool `list_artifacts`.                                                                                                    |
| `smithers_get_chat_transcript`        | required                            | Read workflow-related agent transcript grouped by attempts.                                                                                                         | Smithers semantic tool `get_chat_transcript`.                                                                                               |
| `smithers_get_run_events`             | required                            | Read raw lifecycle events and paginate by sequence.                                                                                                                 | Smithers semantic tool `get_run_events`, aligned with `GET /v1/runs/:runId/events?afterSeq=N`.                                              |
| `smithers_runs_cancel`                | required                            | Cancel a Smithers run using Smithers server semantics: direct terminal cancellation for `waiting-approval` and `waiting-timer`, request-and-abort for live `running`, and rejection for inactive states Smithers does not cancel directly. | `POST /v1/runs/:runId/cancel` and Gateway `runs.cancel`.                                                                                    |
| `smithers_signals_send`               | required when workflows use signals | Deliver a durable signal to a waiting run.                                                                                                                          | `POST /v1/runs/:runId/signals/:signalName` and Gateway `signals.send`.                                                                      |
| `smithers_frames_list`                | bridge or UI                        | Inspect rendered frames for timeline or inspector UIs.                                                                                                              | `GET /v1/runs/:runId/frames` and Gateway `frames.list` and `frames.get`.                                                                    |
| `smithers_get_devtools_snapshot`        | bridge or UI                        | Read a DevTools tree snapshot for the workflow inspector.                                                                                                           | Gateway `getDevToolsSnapshot`.                                                                                                              |
| `smithers_stream_devtools`             | bridge or UI                        | Stream DevTools tree deltas for a live inspector.                                                                                                                   | Gateway `streamDevTools`.                                                                                                                   |

### Workflow Launch Contracts

Handler-visible workflow launch contracts must come from the actual runnable workflow definition, not from prompt prose, repo inspection, or a second handwritten manifest.

The adopted contract pipeline is:

- each discoverable runnable entry publishes one launch Zod schema plus explicit grouped asset refs
- product-lane entries may also publish `productKind` and `resultSchema`
- `svvy` compiles that launch schema into the handler-visible `launchInputSchema` when the workflow registry is loaded or refreshed
- `smithers_list_workflows({ workflowId?, productKind?, sourceScope? })` returns each runnable entry's `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, `launchInputSchema`, and optional product metadata such as `productKind` and `resultSchema`
- the Bun bridge exposes one stable `smithers_run_workflow({ workflowId, input, runId? })` tool for fresh launch and explicit same-run resume
- the same launch Zod schema remains the runtime validation source when the tool is executed

Project CI is the first adopted product-lane entry.

For entries declaring `productKind = "project-ci"`, the bridge must preserve enough result-schema metadata for the runtime to validate terminal output before recording CI run and CI check result state.

No Smithers supervision path may classify a workflow run as Project CI from entry labels, command names, logs, node outputs, or final prose.

Project CI projection is an event-triggered reconciliation over durable Smithers result facts plus `svvy` workflow ownership facts. Live terminal events may start the reconciliation, but process-local terminal-output memory and copied `svvy` output fields are not authoritative. Restart recovery, monitor reconnect, and terminal bootstrap reads must be able to re-run the same idempotent derivation by reading Smithers durable run/result state and the `svvy` workflow-run binding. If the durable terminal result for a declared Project CI entry is missing from Smithers or fails the entry's result schema, supervision records a durable projection failure/troubleshooting state instead of silently skipping CI projection or inferring results from logs.

The handler-visible launch contract must preserve launch-side semantics:

- `workflowId` selects the runnable entry whose contract was returned by `smithers_list_workflows`
- required fields stay required
- optional fields stay optional
- defaulted fields remain omittable and surface their defaults in the generated schema
- `input` is the workflow-specific payload validated against `launchInputSchema`
- omitted `runId` requests a fresh launch and never silently resumes an existing run
- supplied `runId` is explicit resume addressing for that exact run and is not part of the workflow-specific `launchInputSchema`
- if `runId` is omitted while the same handler thread already owns a nonterminal run with the same `workflowId`, `svvy` rejects the call and tells the handler to pass `runId`, cancel the old run, or choose a different `workflowId`
- nonterminal runs with different `workflowId` values may run concurrently under one handler thread
- runtime-only Smithers continuation plumbing does not appear in the handler-visible schema

The shared Smithers runtime input table shape used inside the embedded runtime is not a public contract for handler agents.

That internal runtime envelope exists only so Smithers can persist and continue runs safely inside its own runtime DB.

The first shipped bridge does not need to expose every Smithers operator surface to the agent.

These Smithers capabilities should be documented as existing but treated as non-v1 or operator-only unless the product explicitly adopts them later:

- CLI and operator flows such as `retry-task`, `replay`, `fork`, `timeline`, `diff`, `graph`, and `hijack`
- troubleshooting helpers such as `workflow path`, `workflow doctor`, and `agents doctor`
- human-loop operator commands such as `human answer` and `human cancel`

Every `smithers_*` command record should preserve both the adopted agent-visible tool name and the underlying Smithers invocation metadata, including transport, raw operation name, arguments, affected run or node, pre-status, post-status, and observed event-sequence range.

## Transport Rules

### Required Event Source

Supervised workflow runs must have a live event source.

If `svvy` cannot attach the supervision transport for a run, it should treat that as a workflow-supervision error rather than silently degrading into a different mode.

That means:

- no hidden timer-based polling fallback for normal supervision
- no renderer-side polling to guess whether workflow state changed
- no read-side writes that try to reconstruct supervision from ad hoc refreshes

### Reconnect

The supervision transport must support reconnect from the last applied event sequence or a fresh snapshot baseline.

Smithers HTTP run-event streaming already exposes reconnect by `afterSeq`, and Gateway-style live graph streams may require a fresh snapshot plus later deltas.

The adopted `svvy` rule is:

- persist enough durable cursor metadata per workflow run to reconnect after restart or stream interruption
- reconnect from the last applied sequence when the transport supports it, otherwise re-baseline from an official Smithers snapshot
- treat reconnect as part of normal supervision, not as a special operator action

### Bootstrap And Recovery Reads

One-shot reads are still allowed for:

- initial bootstrap after app launch
- recovery when a monitor is being reattached
- final reconciliation after a stream closes at a terminal state

Those reads should hydrate state or confirm the last known outcome.

They must not become the steady-state lifecycle transport.

## State And Projection Rules

### Thread Model

The thread remains the delegated-objective unit.

The thread does not store a persisted latest-workflow pointer.

Selectors should derive:

- the active workflow run for that thread, if any
- otherwise the most recently updated workflow run under that thread

### Workflow-Run Metadata Needed For Supervision

The supervision layer needs durable per-run metadata beyond the current high-level summary fields.

At minimum, `svvy` needs durable cursor metadata equivalent to:

- the last applied Smithers event sequence
- the most recent handler-attention point still pending delivery
- the last handler-attention delivery point for that workflow run

The exact storage shape may live directly on the workflow-run record or in closely related supervision metadata, but it must be durable enough for restart-safe reconnect and wake-up dedupe without relying on process-local memory.

### Projection Ownership

Workflow projection writes belong to the supervision bridge.

The bridge is responsible for updating:

- workflow-run product status
- workflow-run product summary
- thread attention state when Smithers enters a durable wait that needs handler action
- `svvy` lifecycle projection events and artifact links that explain meaningful workflow transitions
- Project CI reconciliation state when a declared CI workflow reaches or is recovered in a terminal state

The bridge must not rely on transcript parsing or read-side repair loops to keep workflow state current.

The bridge also must not make `svvy` the owner of Smithers execution state. Its writes are product projections derived from Smithers durable state:

- Smithers events say what changed.
- The monitor records the last applied cursor and any product attention that must be delivered.
- When product projection needs run, node, attempt, wait, approval, timer, output, or event details, it reads those facts from Smithers durable state.
- `svvy` stores only the derived product facts needed for ownership, navigation, handler wake-up, UI badges, troubleshooting summaries, and product lanes.

For Project CI specifically, the bridge must not rely on unrecoverable process memory to keep CI state current. In-memory terminal buffers, live monitors, and renderer state can trigger projection, but the durable read model must derive from Smithers result facts plus `svvy` workflow ownership facts and `ci_run` or `ci_check_result` records. Missing or invalid terminal result data is itself durable troubleshooting state.

### Execution State Boundary

Smithers-only execution facts include:

- run status transitions and raw run event history
- node status transitions
- node attempts, task attempts, retries, and loop iterations
- approval requests and approval decisions
- wait records, wait reasons, signal subscriptions, signal deliveries, and timer state
- task-agent prompt execution, transcript, tool steps, usage, output validation, schema repair, and hijack continuation
- node output, partial output, final output, validated output, artifacts, and frames as produced by the workflow engine

`svvy`-owned facts include:

- workspace ownership and product binding for a Smithers run
- handler thread ownership and `surfacePiSessionId`
- runnable entry and product-lane binding, such as Project CI entry identity
- attention cursors that dedupe handler wake-ups
- product statuses such as `running-workflow`, `waiting`, `troubleshooting`, and compact sidebar states
- UI read-model rows, explicit panel targets, unread or attention badges, and related-link projections
- Project CI `ci_run` and `ci_check_result` rows derived from a declared CI entry's durable Smithers terminal result
- app logs and redacted product diagnostics

`svvy` must not cache or denormalize raw Smithers execution status for product decisions, display, filtering, or debugging. Any operation that needs current execution detail must re-read Smithers durable state by Smithers identifiers.

### Thread Status Semantics During Supervision

Use thread status this way:

- `running-handler` while the handler is actively reasoning, issuing tools, or otherwise working and no live workflow run currently owns forward progress
- `running-workflow` while a Smithers run is actively executing and the handler is idle but still owns the objective
- `waiting` when the delegated objective is durably blocked on user, approval, signal, timer, or other external input and no troubleshooting is required yet
- `troubleshooting` when a workflow failed, was cancelled, continued into a new run lineage, or lost reliable supervision and the handler must inspect or repair before deciding what to do next
- `completed` only when the handler thread itself has reached a terminal objective span and `thread_handoff` has closed that span

A workflow run becoming terminal does not by itself make the thread terminal.

A workflow failure or cancellation must move the thread into `troubleshooting` before any later user-directed closure or handoff.

## Handler Wake-Up Rules

### When To Wake The Handler

The supervision bridge should request handler attention when:

- a workflow enters an actionable `waiting-approval` or `waiting-event` state
- a workflow reaches `completed`
- a workflow reaches `failed`
- a workflow reaches `cancelled`
- a workflow reaches `continued`
- supervision cannot continue safely because transport or projection became irrecoverably degraded

Ordinary non-terminal progress events should update state and UI but should not wake the handler thread.

`waiting-timer` is normally monitor-owned and should not wake the handler on its own.

### How To Wake The Handler

When handler attention is needed, `svvy` should:

- acquire the backing pi session for that handler thread by `surfacePiSessionId`
- start a synthetic background turn on that same thread surface
- inject a synthetic user message that summarizes the workflow transition and the allowed next actions
- emit explicit workspace and surface updates so the renderer can follow the background work without polling

This is analogous to orchestrator resume after `thread_handoff`, but it targets the handler thread instead of the orchestrator.

### Prompt Content

The synthetic handler-resume prompt should include:

- thread id and objective
- workflow-run id and Smithers run id
- workflow name
- product workflow projection state derived from Smithers status at read or projection time
- current workflow summary
- relevant wait kind, blocker diagnosis, lineage detail, or failure detail
- any important artifact or lifecycle references needed to act confidently
- an explicit instruction that the handler must now decide what to do next

The expected next actions are:

- inspect
- repair
- `smithers_run_workflow({ workflowId, input, runId })` when Smithers still considers that run resumable
- ask the user
- `thread_handoff`

### Dedupe And Coalescing

The handler must not be woken repeatedly for the same workflow transition.

The adopted rule is:

- supervision must track what transition has already been delivered to the handler
- repeated notifications for the same effective state should collapse into one pending handler-attention unit
- if the handler thread already has an active prompt, new workflow attention should be queued or coalesced rather than interrupting that active turn
- if no pane currently shows that thread, the runtime may keep the wake-up background-only and should release any temporary surface ownership after the turn settles

### Launch Versus Resume

The stable `smithers_run_workflow({ workflowId, input, runId? })` surface has an explicit split:

- `runId` supplied means resume exactly that Smithers run after validating handler ownership, workflow identity, and Smithers resumability under the same workflow source and input lineage
- `runId` omitted means start a fresh run
- `runId` omitted is rejected when the same handler already owns a nonterminal run with the same `workflowId`, because that would make "fresh launch" ambiguous and likely orphan active workflow state
- different `workflowId` values can run concurrently under one handler thread

If the handler edits workflow source, changes workflow input, or hits a Smithers non-resumable condition, it must start a replacement run instead of trying to resume the same run.

### Cancellation

`smithers_runs_cancel` must follow Smithers server cancellation semantics rather than a svvy-specific approximation:

- `running` runs use Smithers' cancel-request path and abort the live monitor so the active engine loop observes cancellation
- `waiting-approval` runs are terminalized immediately with a Smithers `RunCancelled` event
- `waiting-timer` runs are terminalized immediately with Smithers' timer cleanup: the waiting timer attempt and node become `cancelled`, a `TimerCancelled` event is written, then the run receives `RunCancelled`
- `waiting-event` is not direct-terminalized because Smithers server cancellation does not do that; it remains a signal-mediated wait unless Smithers adds native direct cancellation for that state

After any direct paused-run terminalization, `svvy` must read the resulting Smithers events and run state, update the structured workflow-run projection cursor, clear product thread and session attention state as appropriate, move the owning handler thread into `troubleshooting`, and request handler attention for the cancellation.

## Recovery And Restart

On app start or session restoration, `svvy` should:

1. find workflow runs that are not known terminal or still have undelivered handler attention
2. bootstrap each such run with a one-shot inspection read
3. resume and reattach each active `running` Smithers run by explicit `runId` when the previous owner process is gone
4. restore waiting approval, signal, and timer runs as durable waits plus pending handler attention, leaving same-run resume to the handler after the wait is resolved
5. reconnect each monitor from the last durable event sequence when the transport supports a live event stream
6. re-emit any necessary handler attention that was durable but not yet delivered

Recovery must be precise per workflow run.

It must not:

- reopen unrelated threads
- cancel unrelated workflow runs
- assume the orchestrator should reconcile anything automatically
- rebuild Smithers run, node, attempt, wait, approval, timer, output, or event state from `svvy` projection rows

### Event-Triggered Re-Reads

Smithers events are triggers, not a second source of execution truth inside `svvy`.

When the monitor receives a Smithers event, reconnects after a gap, resumes from app restart, or handles a Smithers-native tool result, it should:

1. apply the event cursor or snapshot cursor to the `svvy` workflow-run projection;
2. decide which product projections are affected, such as handler attention, thread status, Project CI, inspector rows, logs, or related artifacts;
3. re-read the necessary durable Smithers run, node, attempt, wait, approval, timer, output, artifact, or event detail by Smithers id;
4. write only the `svvy` product projection rows needed for ownership, UI, attention, and product lanes;
5. emit workspace and surface updates from those product rows.

The same rule applies after `smithers_run_workflow`, `smithers_runs_cancel`, `smithers_resolve_approval`, `smithers_signals_send`, terminal bootstrap reads, and app restart recovery. The tool result can identify what changed, but authoritative execution state is read back from Smithers.

## Cleanup And Isolation

### Monitor Registry

The Bun side should keep a monitor registry keyed to one `svvy` workflow-run record at a time.

That registry should own:

- the current stream task
- reconnect state
- finalization state
- any pending handler-attention scheduling for that workflow run

### Teardown Rules

Teardown must be thorough but local.

The adopted cleanup rules are:

- stopping or finalizing one workflow monitor must affect only that workflow run
- starting a new run on thread A must not cancel monitoring for thread B
- resuming an existing Smithers run should reconnect or replace only that same run's monitor
- starting a replacement run on the same thread should tear down only the superseded same-thread active monitor, not historical terminal runs or other threads
- when a run reaches terminal state and its final projection is durable, the monitor may shut down after any required handler attention has been queued
- app shutdown should cancel all monitors, but normal thread handoff should not globally clear unrelated monitors

### Thread Handoff Safety

`thread_handoff` should only close the current objective span after the handler thread has resolved any active supervised run for that span.

In practice that means:

- `thread_handoff` should first reconcile the thread-owned workflow state against Smithers' durable run state so a just-finished run is not mistaken for a still-active one
- no active supervised run should remain attached to the thread when a terminal handoff episode is emitted
- a failed or cancelled workflow run is not by itself a valid handoff condition; it must first be repaired, turned into an explicit wait, or closed by an explicit user-directed decision
- if the handler truly needs to end supervision before the workflow succeeds, it must explicitly cancel or otherwise terminalize that workflow run first; `svvy` must not silently leave a live workflow running behind a completed thread
- historical workflow runs remain inspectable after handoff
- a later follow-up turn on the same thread may start another workflow run for a new active span under that thread

### Terminal Reconciliation Idempotence

The same terminal Smithers run state may be observed more than once through legitimate supervision paths.

Examples include:

- the live progress callback
- the bridge-owned final projection after the run exits
- restart or reconnect bootstrap reads
- explicit control-plane writes that mutate the run before the handler acts again

That duplication does not change ownership semantics.

It means the supervision bridge must treat replayed terminal state as idempotent after the handler has already reconciled it and closed the current span.

In practice:

- replaying the same terminal workflow snapshot after a valid handoff must not reopen the thread
- replaying the same terminal workflow snapshot after a valid handoff must not queue another handler-attention wake-up
- replayed terminal state may refresh run metadata, but it must not imply that a completed thread still has active workflow ownership

## Renderer And Sync Rules

The renderer must receive explicit backend-to-renderer sync when workflow supervision changes visible state.

The Bun side should emit explicit sync on:

- workflow projection changes that affect visible thread or workflow summaries
- background handler execution starting
- background handler execution settling

The renderer should not poll list or inspector APIs to discover whether workflow state changed.

## Failure Rules

Workflow failure must still return durable failure state to the supervising handler thread even when the workflow's own planned finalization path does not run.

That means the bridge must be able to produce:

- durable failed workflow-run state
- failure lifecycle facts and artifacts
- handler attention for the supervising thread and a `troubleshooting` thread state

This guarantee belongs to `svvy` supervision, not to ad hoc user refresh.

## Why No Polling Fallback

The GUI fallback exists because its transport is optional and compatibility-driven.

`svvy` should not copy that behavior for supervised runs because:

- workflow supervision is product-internal infrastructure, not a best-effort dashboard
- silent fallback would hide transport and integration bugs
- it would create two lifecycle models instead of one
- it conflicts with the write-driven lifecycle and split workspace-vs-surface sync direction already adopted for the app

The correct fallback for `svvy` is reconnect and recovery, not silent polling.

## Sources

### Local Sources

- [PRD](../prd.md)
- [Execution Model](../execution-model.md)
- [Progress](../progress.md)
- [Structured Session State Spec](./structured-session-state.spec.md)
- [Smithers GUI Client](../references/smithers-gui/SmithersClient.swift)
- [Smithers GUI Runs View](../references/smithers-gui/RunsView.swift)
- [Smithers Serve Docs](../references/smithers/docs/integrations/serve.mdx)

### External Sources

- [Smithers Full Documentation](https://smithers.sh/llms-full.txt)
