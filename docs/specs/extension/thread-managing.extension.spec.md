# Thread Orchestration And Handling Spec

## Status

- Date: 2026-06-03
- Status: authoritative product spec for native thread-control extensions
- Scope of this document:
  - define the shipped native implementation that owns delegated handler-thread controls
  - define the two actor-scoped agent-facing extension records backed by that implementation
  - define the concrete APIs for `thread_start`, `thread_resume`, `thread_list`,
    `thread_episodes`, `thread_request_report`, `thread_current`, and `thread_report`

This spec owns the concrete API for thread orchestration and handler reporting tools. Higher-level
specs should describe when actors use these tools and refer here for input and output shapes.

Related specs:

- `docs/specs/extensions-and-tools.spec.md` defines the broader extension architecture and native
  tool model.
- `docs/specs/live-tool-projection.spec.md` defines how thread-control tool calls render from
  streamed arguments, runtime command events, and final command facts.
- `docs/specs/structured-session-state.spec.md` defines the durable session, thread, command,
  queue, report-request, and episode records these tools read and write.
- `docs/specs/workflow-supervision.spec.md` defines Smithers workflow lifecycle behavior under
  handler threads.
- `docs/specs/queued-messages.spec.md` defines ordered surface-queue delivery used by handler
  starts, resumes, report requests, and orchestrator episode notifications.

## Product Role

`svvy` ships one app-owned native thread-control implementation with two separate agent-facing
extension records:

| Extension id | Title | Interface | Actor kind | State | Exposed tools |
| --- | --- | --- | --- | --- | --- |
| `thread-orchestration` | Thread Orchestration | `native_tool` | Orchestrator | `default_loaded` | `thread_start`, `thread_resume`, `thread_list`, `thread_episodes`, `thread_request_report` |
| `thread-handling` | Thread Handling | `native_tool` | Handler thread | `default_loaded` | `thread_current`, `thread_report`, `thread_episodes` |
| `thread-orchestration` | Thread Orchestration | `native_tool` | Handler thread | `unavailable` | none |
| `thread-handling` | Thread Handling | `native_tool` | Orchestrator | `unavailable` | none |
| both | both | `native_tool` | Workflow task agent | `unavailable` | none |

The split is deliberate:

- the implementation is shared so thread rows, queue writes, report requests, episodes, and
  lifecycle transactions stay in one product-owned module
- the generated agent context is not shared because orchestrators and handlers need different
  instructions and different callable tools
- a loaded extension record does not imply every actor receives every thread tool
- workflow task agents receive no thread-control tools and should not be taught unavailable
  controls in prompt prose

The native implementation is not:

- a separate manager agent
- a standalone custom runtime
- a Smithers workflow abstraction
- an Incur CLI or `svvyx` command family
- an `execute_typescript` helper family
- a prompt-only instruction extension

Thread controls are native because they mutate live product state, bind pi-backed surfaces, create
durable queue rows, and must run inside app transactions. Extension Managing is allowed to be an
Incur-backed `svvyx` CLI because it edits extension records through an ordinary command boundary.
Thread controls need app-owned actor binding and queue coordination that would be brittle if modeled
as shell-visible CLI commands.

## State Boundary

Thread tools read and write product state. They do not read or write repo files.

DB/product-state-backed facts:

- handler-thread rows and objective state
- surface pi session ids and actor bindings
- generated handler agent context bindings
- queued surface items
- report requests
- thread episodes
- command records for lifecycle writes

Smithers-backed facts:

- workflow run status, node status, artifacts, approvals, signals, and detailed workflow history
- exact active workflow ownership under a handler thread

File-backed facts:

- none returned by these tools

Thread tools intentionally do not return editable/generated content as blobs or previews. If a
future thread operation creates files, it should return file paths and let the agent inspect or edit
them with shell and `apply_patch`.

## Non-Goals And Forbidden Fields

The agent-facing API must not expose these shapes:

- no single `ThreadStatus` union such as `idle`, `running-handler`, `running-workflow`, `waiting`,
  `troubleshooting`, or `completed`
- no `canHandoff`, `canResume`, or other best-effort decision hints
- no `workflowRunCounts`
- no `attentionWorkflowRunIds` or `waitingWorkflowRunIds`
- no `pendingReportRequestCount`
- no `latestEpisode` in `thread_start` or `thread_resume`
- no `queue` object; lifecycle write tools return a `queuedItems` array
- no `queuedItems[].target`; the tool name and item kind determine the destination surface
- no handler-thread `title` in tool results
- no UI-facing attention, badge, subtitle, troubleshooting, or row-state fields
- no transcript bodies, workflow summaries, or Smithers internals in thread read results
- no episode bodies in summary reads; `thread_episodes` is the only thread read tool that returns
  episode `body`

Reasons:

- active handler work and active workflow work may both be true; a single thread status collapses
  independent facts
- orchestration tools should expose facts agents can act on directly, not UI presentation state
- Smithers already owns workflow semantics; thread tools should not mirror Smithers with lossy
  counters or invented attention categories
- lifecycle mutations should fail clearly when invalid instead of returning predictive booleans that
  agents must interpret programmatically

## Shared Types

```ts
type WorkspaceSessionId = string;
type SurfacePiSessionId = string;
type ThreadId = string;
type CommandId = string;
type EpisodeId = string;
type ReportRequestId = string;
type QueuedItemId = string;
type WorkflowRunId = string;
type ISODateString = string;
type ExtensionId = string;

type ExtensionUsageState = "default_loaded" | "available" | "unavailable";

type ObjectiveState = "active" | "concluded";

type ConclusionOutcome = "succeeded" | "failed" | "cancelled";

type ThreadEpisodeKind = "update" | "conclusion";

type QueuedItemKind =
  | "initial_handler_start"
  | "user_message"
  | "report_request"
  | "thread_report"
  | "workflow_attention"
  | "agent_context_refresh";

type QueuedItemSummary = {
  queuedItemId: QueuedItemId;
  kind: QueuedItemKind;
  status: "queued" | "dispatching";
};

type ThreadRef = {
  threadId: ThreadId;
  objective: string;
  objectiveState: ObjectiveState;
  updatedAt: ISODateString;
};

type ThreadEpisodeSummary = {
  episodeId: EpisodeId;
  requestId: ReportRequestId | null;
  kind: ThreadEpisodeKind;
  outcome: ConclusionOutcome | null;
  summary: string;
  createdAt: ISODateString;
};

type ThreadListItem = ThreadRef & {
  latestEpisode: ThreadEpisodeSummary | null;
};

type ThreadEpisode = ThreadEpisodeSummary & {
  threadId: ThreadId;
  title: string;
  body: string;
};

type PendingReportRequest = {
  requestId: ReportRequestId;
  request: string;
  createdAt: ISODateString;
};
```

`workflow_attention` and `agent_context_refresh` are shared queue-system kinds. Thread tool results
only return the queue items created by that tool call: `initial_handler_start`, `user_message`,
`report_request`, or `thread_report`.

`ThreadEpisodeSummary.kind` is derived from whether the handler supplied `outcome` to
`thread_report`:

- omitted `outcome` creates an `update` episode
- present `outcome` creates a `conclusion` episode and concludes the active objective

`ThreadEpisodeSummary.outcome` is `null` for update episodes.

## `thread_start`

`thread_start` creates a new pi-backed handler thread for one delegated objective and queues the
handler's first turn.

Available only in `thread-orchestration`.

Input:

```ts
type ThreadStartInput = {
  objective: string;
  extensions?: Partial<Record<ExtensionId, ExtensionUsageState>>;
};
```

Rules:

- `objective` is required and is the raw delegated objective for the handler thread.
- `extensions` is optional.
- when omitted, the handler uses the configured `threadHandler` profile extension states
- when provided, each listed extension id overrides that extension's state for this handler thread
- omitted extension ids keep the `threadHandler` profile state
- values may be `default_loaded`, `available`, or `unavailable`
- Extension Loading cannot be overridden and remains `default_loaded`
- `thread-handling` remains `default_loaded` for the handler thread
- `thread-orchestration` remains `unavailable` for the handler thread
- the override is bound to the created handler thread and does not mutate the `threadHandler` profile
- the override is applied before the handler's first turn and before generated prompt, tools,
  `svvyx` guidance, TypeScript declarations, and fingerprints are created for that handler
- the handler's first turn starts from the raw `objective`; the orchestrator must not manually send a
  first handler-thread message
- handler-thread UI titles, if present, are product-generated outside this API; the orchestrator does
  not supply a title and this result does not return one
- there is no legacy `context` field, `context: ["ci"]` alias, `thread_start_ci`, `ci.start`, or
  other product-specific handler-start variant
- `thread_start` extension overrides do not affect workflow task agents launched by workflows under
  that handler

Success result:

```ts
type ThreadStartResult = {
  ok: true;
  thread: ThreadRef;
  queuedItems: QueuedItemSummary[];
};
```

Example input:

```json
{
  "objective": "Configure Project CI for this repository",
  "extensions": {
    "project-ci": "default_loaded",
    "github": "available"
  }
}
```

Example output:

```json
{
  "ok": true,
  "thread": {
    "threadId": "thread_123",
    "objective": "Configure Project CI for this repository",
    "objectiveState": "active",
    "updatedAt": "2026-06-03T10:00:00.000Z"
  },
  "queuedItems": [
    {
      "queuedItemId": "queue_1001",
      "kind": "initial_handler_start",
      "status": "queued"
    }
  ]
}
```

## `thread_resume`

`thread_resume` lets the orchestrator re-engage a concluded handler objective when follow-up work
belongs in the same delegated context.

Available only in `thread-orchestration`.

Input:

```ts
type ThreadResumeInput = {
  threadId: ThreadId;
  objective: string;
};
```

Rules:

- `threadId` must name an existing handler thread visible in the current workspace session.
- `objective` is required and becomes the next delegated objective for that handler thread.
- `thread_resume` is for concluded objectives only.
- if the current objective is still active, `thread_resume` fails and instructs the orchestrator to
  use direct handler-surface messaging or `thread_request_report` instead
- delivery goes through the target handler surface queue and does not bypass the prompt lock
- `thread_resume` does not control or resume Smithers runs directly
- Smithers run inspection, repair, fresh launch, or exact run resume remains the handler thread's job
- earlier episodes remain durable history; later `thread_report` calls append new ordered episodes

Success result:

```ts
type ThreadResumeResult = {
  ok: true;
  thread: ThreadRef;
  queuedItems: QueuedItemSummary[];
};
```

Example input:

```json
{
  "threadId": "thread_123",
  "objective": "Add the missing Project CI lint check using the same design."
}
```

Example output:

```json
{
  "ok": true,
  "thread": {
    "threadId": "thread_123",
    "objective": "Add the missing Project CI lint check using the same design.",
    "objectiveState": "active",
    "updatedAt": "2026-06-03T10:18:42.000Z"
  },
  "queuedItems": [
    {
      "queuedItemId": "queue_1042",
      "kind": "user_message",
      "status": "queued"
    }
  ]
}
```

Example failure:

```json
{
  "ok": false,
  "error": {
    "code": "objective_active",
    "message": "Thread thread_123 already has an active objective. Send a direct handler-thread message or request an update with thread_request_report."
  }
}
```

## `thread_list`

`thread_list` lists delegated handler threads visible from the current workspace session.

Available only in `thread-orchestration`.

Input:

```ts
type ThreadListInput = {
  threadId?: ThreadId;
  objectiveState?: ObjectiveState;
  query?: string;
  limit?: number;
};
```

Rules:

- all filters are optional
- `threadId` returns the matching thread when visible to the current workspace session
- `objectiveState` filters by the current objective lifecycle state
- `query` is a case-insensitive substring search over objective and latest episode summary
- `limit` caps the newest returned threads when no exact `threadId` is supplied
- omitted `limit` uses the product default page size
- results are ordered by `updatedAt` descending
- transcript bodies, workflow summaries, active workflow ids, report-request bodies, and Smithers
  internals are not included
- exact episode bodies are read through `thread_episodes`
- workflow details are read through Smithers-native tools inside the handler by exact workflow run id
- the tool reads durable structured state and does not create command records or write lifecycle facts

Result:

```ts
type ThreadListResult = {
  ok: true;
  threads: ThreadListItem[];
};
```

Example input:

```json
{
  "objectiveState": "concluded",
  "query": "project ci",
  "limit": 10
}
```

Example output:

```json
{
  "ok": true,
  "threads": [
    {
      "threadId": "thread_123",
      "objective": "Configure Project CI for this repository",
      "objectiveState": "concluded",
      "updatedAt": "2026-06-03T10:16:20.000Z",
      "latestEpisode": {
        "episodeId": "episode_9001",
        "requestId": null,
        "kind": "conclusion",
        "outcome": "succeeded",
        "summary": "Project CI workflow assets and check result projection are specified.",
        "createdAt": "2026-06-03T10:16:20.000Z"
      }
    }
  ]
}
```

## `thread_episodes`

`thread_episodes` reads durable thread episode bodies.

Available in both `thread-orchestration` and `thread-handling`.

Input:

```ts
type ThreadEpisodesInput = {
  threadId?: ThreadId;
  episodeId?: EpisodeId;
  requestId?: ReportRequestId;
  limit?: number;
};
```

Rules:

- `threadId` filters to one handler thread
- `episodeId` returns one exact episode when visible to the current workspace session
- `requestId` returns the episode that resolved one exact report request
- `limit` caps the newest returned episodes when no exact `episodeId` or `requestId` is supplied
- omitted `limit` uses the product default page size
- when called from `thread-orchestration`, omitted `threadId` searches all visible handler threads
- when called from `thread-handling`, omitted `threadId` means the current handler thread, and a
  supplied `threadId` must equal the current handler thread
- episodes are returned in chronological order after filtering and limiting
- this is the only thread read tool that returns episode `body`
- the tool reads durable structured state and does not create command records or write lifecycle facts

Result:

```ts
type ThreadEpisodesResult = {
  ok: true;
  episodes: ThreadEpisode[];
};
```

Example input:

```json
{
  "threadId": "thread_123",
  "limit": 5
}
```

Example output:

```json
{
  "ok": true,
  "episodes": [
    {
      "episodeId": "episode_8998",
      "threadId": "thread_123",
      "requestId": "report_req_77",
      "kind": "update",
      "outcome": null,
      "title": "CI workflow draft is in progress",
      "summary": "The handler has identified the Smithers entry and is validating output schema shape.",
      "body": "The Project CI workflow should live under the packaged Smithers runtime area, not repo-root workflows. I am checking the existing Smithers result projection contract before editing.",
      "createdAt": "2026-06-03T10:10:05.000Z"
    },
    {
      "episodeId": "episode_9001",
      "threadId": "thread_123",
      "requestId": null,
      "kind": "conclusion",
      "outcome": "succeeded",
      "title": "Project CI design ready",
      "summary": "Project CI workflow assets and check result projection are specified.",
      "body": "The handler completed the delegated objective. The spec now points Project CI workflow assets at packaged app-owned Smithers runtime files, keeps result projection derived from durable Smithers terminal output, and avoids a CI-specific launcher.",
      "createdAt": "2026-06-03T10:16:20.000Z"
    }
  ]
}
```

## `thread_request_report`

`thread_request_report` asks a handler thread to emit a report episode in response to an
orchestrator request.

Available only in `thread-orchestration`.

Input:

```ts
type ThreadRequestReportInput = {
  threadId: ThreadId;
  request: string;
};
```

Rules:

- `threadId` must name an existing handler thread visible in the current workspace session.
- `request` is required and is the exact update request delivered to the handler.
- the app generates `requestId`; the orchestrator does not provide it
- success records a pending report request and queues a `report_request` item on the handler surface
- the handler resolves the request by calling `thread_report` with the same `requestId`
- the resolving report may be an update episode or a conclusion episode
- report requests are ordered through the same surface queue as user messages and context refreshes
- `thread_request_report` may target an active or concluded objective; asking for a status update is
  not the same as resuming the objective
- the tool does not inspect Smithers state directly and does not return workflow summaries

Success result:

```ts
type ThreadRequestReportResult = {
  ok: true;
  threadId: ThreadId;
  requestId: ReportRequestId;
  request: string;
  queuedItems: QueuedItemSummary[];
};
```

Example input:

```json
{
  "threadId": "thread_123",
  "request": "Give me a concise update on whether Project CI implementation is blocked and what remains."
}
```

Example output:

```json
{
  "ok": true,
  "threadId": "thread_123",
  "requestId": "report_req_77",
  "request": "Give me a concise update on whether Project CI implementation is blocked and what remains.",
  "queuedItems": [
    {
      "queuedItemId": "queue_1104",
      "kind": "report_request",
      "status": "queued"
    }
  ]
}
```

## `thread_current`

`thread_current` reads the current handler thread's durable state.

Available only in `thread-handling`.

Input:

```ts
type ThreadCurrentInput = {};
```

Rules:

- the current thread is implicit in the handler actor binding
- the tool reads durable structured state and active prompt runtime binding
- the tool does not create command records or write lifecycle facts
- `activeWorkflowRunIds` is the only workflow-derived field because handler conclusions must fail
  while active workflow runs are still owned by the current objective
- detailed workflow facts stay in Smithers; handlers use active workflow run ids with `smithers_*`
  tools
- pending report requests are returned as full request text because the handler must answer them
- latest episode is a summary only; full bodies are read through `thread_episodes`

Result:

```ts
type ThreadCurrentResult = {
  ok: true;
  thread: ThreadRef;
  activeWorkflowRunIds: WorkflowRunId[];
  pendingReportRequests: PendingReportRequest[];
  latestEpisode: ThreadEpisodeSummary | null;
};
```

Example output:

```json
{
  "ok": true,
  "thread": {
    "threadId": "thread_123",
    "objective": "Configure Project CI for this repository",
    "objectiveState": "active",
    "updatedAt": "2026-06-03T10:10:05.000Z"
  },
  "activeWorkflowRunIds": ["smithers_run_456"],
  "pendingReportRequests": [
    {
      "requestId": "report_req_77",
      "request": "Give me a concise update on whether Project CI implementation is blocked and what remains.",
      "createdAt": "2026-06-03T10:09:58.000Z"
    }
  ],
  "latestEpisode": {
    "episodeId": "episode_8998",
    "requestId": null,
    "kind": "update",
    "outcome": null,
    "summary": "The handler has identified the Smithers entry and is validating output schema shape.",
    "createdAt": "2026-06-03T10:10:05.000Z"
  }
}
```

## `thread_report`

`thread_report` records a handler-authored episode. Supplying `outcome` also concludes the current
objective and tells the orchestrator that this handler objective is done.

Available only in `thread-handling`.

Input:

```ts
type ThreadReportInput = {
  title: string;
  summary: string;
  body: string;
  requestId?: ReportRequestId;
  outcome?: ConclusionOutcome;
};
```

Rules:

- only handler-thread actors may call `thread_report`
- the current thread is implicit in the handler actor binding
- `title`, `summary`, and `body` are required and describe the durable episode
- `requestId` is optional
- when supplied, `requestId` must name a pending report request for the current thread
- a successful report with `requestId` resolves that report request
- omitted `outcome` records an intermediate `update` episode and leaves `objectiveState` unchanged
- present `outcome` records a `conclusion` episode and changes `objectiveState` from `active` to
  `concluded`
- conclusion requires the current objective to be `active`
- update episodes are allowed for active or concluded objectives
- conclusion fails if any active Smithers workflow run is still owned by the current objective
- before failing for active workflow ownership, the runtime should reconcile thread-owned workflow
  state against Smithers durable run state so a just-finished run is not mistaken for an active one
- the tool must not expose `canHandoff`; agents learn invalid lifecycle attempts from explicit tool
  failures
- success records the episode first, then queues a `thread_report` item on the orchestrator surface
- cancelling or deleting the orchestrator queue item does not roll back the episode and does not
  return a tool error to the handler
- the handler surface remains fully interactive after success, including after a conclusion episode

Success result:

```ts
type ThreadReportResult = {
  ok: true;
  threadId: ThreadId;
  requestId: ReportRequestId | null;
  outcome?: ConclusionOutcome;
  episode: {
    episodeId: EpisodeId;
    kind: ThreadEpisodeKind;
    createdAt: ISODateString;
  };
  queuedItems: QueuedItemSummary[];
};
```

Example update input:

```json
{
  "requestId": "report_req_77",
  "title": "CI workflow draft is in progress",
  "summary": "The handler has identified the Smithers entry and is validating output schema shape.",
  "body": "The Project CI workflow should live under the packaged Smithers runtime area, not repo-root workflows. I am checking the existing Smithers result projection contract before editing."
}
```

Example update output:

```json
{
  "ok": true,
  "threadId": "thread_123",
  "requestId": "report_req_77",
  "episode": {
    "episodeId": "episode_8998",
    "kind": "update",
    "createdAt": "2026-06-03T10:10:05.000Z"
  },
  "queuedItems": [
    {
      "queuedItemId": "queue_1108",
      "kind": "thread_report",
      "status": "queued"
    }
  ]
}
```

Example conclusion input:

```json
{
  "title": "Project CI design ready",
  "summary": "Project CI workflow assets and check result projection are specified.",
  "body": "The handler completed the delegated objective. The spec now points Project CI workflow assets at packaged app-owned Smithers runtime files, keeps result projection derived from durable Smithers terminal output, and avoids a CI-specific launcher.",
  "outcome": "succeeded"
}
```

Example conclusion output:

```json
{
  "ok": true,
  "threadId": "thread_123",
  "requestId": null,
  "outcome": "succeeded",
  "episode": {
    "episodeId": "episode_9001",
    "kind": "conclusion",
    "createdAt": "2026-06-03T10:16:20.000Z"
  },
  "queuedItems": [
    {
      "queuedItemId": "queue_1120",
      "kind": "thread_report",
      "status": "queued"
    }
  ]
}
```

Example conclusion failure:

```json
{
  "ok": false,
  "error": {
    "code": "active_workflow_runs",
    "message": "Cannot conclude the handler objective while active workflow runs are still owned by this thread.",
    "activeWorkflowRunIds": ["smithers_run_456"]
  }
}
```

## Command And Queue Facts

Write tools create normal command records:

- `thread_start`
- `thread_resume`
- `thread_request_report`
- `thread_report`

Read tools do not create command records:

- `thread_current`
- `thread_list`
- `thread_episodes`

Visibility:

- thread lifecycle write tools are normally `surface` visibility commands
- thread read tools are state-inspection tools and should stay out of command history unless a later
  product decision explicitly records read commands

Queue behavior:

- `thread_start` creates the handler thread and enqueues or dispatches its `initial_handler_start`
  item on the new handler surface
- `thread_resume` activates a new objective and enqueues or dispatches a `user_message` item on the
  target handler surface
- `thread_request_report` records a report request, then enqueues a `report_request` item on the
  target handler surface
- `thread_report` records the durable episode first, optionally resolves a report request,
  optionally concludes the objective, then enqueues a `thread_report` notification on the
  orchestrator surface

All queue rows are ordered product state. The tool result returns only the rows created by that tool
call, as `queuedItems: QueuedItemSummary[]`.

## Rejected Shapes

These shapes are not part of the current API:

```ts
thread_start({ context: ["ci"] });
thread_start_ci(...);
ci.start(...);
thread_resume({ runId: "smithers_run_123" });
thread_handoff({ title: "...", summary: "...", body: "..." });
thread_handoffs({ threadId: "thread_123" });
thread_report({ conclude: { outcome: "succeeded" } });
thread_report({ workflowRunId: "smithers_run_123" });
api.thread.start(...); // broad execute_typescript helper family
api.workflow.*;        // parallel svvy workflow abstraction
```

Workflow run launch and exact Smithers run resume use Smithers-native tools inside the handler
thread, especially `smithers_run_workflow({ workflowId, input, runId? })`.
