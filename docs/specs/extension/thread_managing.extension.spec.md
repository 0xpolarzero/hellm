# Thread Orchestration And Handling Spec

## Status

- Date: 2026-06-04
- Status: authoritative product spec for native thread-control extensions
- Scope of this document:
  - define the builtin native implementation that owns delegated handler-thread controls
  - define the two actor-scoped agent-facing extension records backed by that implementation
  - define the concrete APIs for `thread_start`, `thread_followup`, `thread_list`,
    `thread_episodes`, `thread_request_report`, `thread_current`, `thread_group`, and
    `thread_report`
  - define the actor-facing instruction requirements for thread orchestration and thread handling

This spec owns the concrete API for thread orchestration and handler reporting tools. Higher-level
specs should describe when actors use these tools and refer here for input, output, lifecycle, queue,
and instruction shapes.

Related specs:

- `docs/specs/extensions-and-tools.spec.md` defines the broader extension architecture and native
  tool model.
- `docs/specs/live-tool-projection.spec.md` defines how thread-control tool calls render from
  streamed arguments, runtime command events, and final command facts.
- `docs/specs/structured-session-state.spec.md` defines the durable session, thread-group, thread,
  command, queue, report-request, and episode records these tools read and write.
- `docs/specs/workflow-supervision.spec.md` defines Smithers workflow lifecycle behavior under
  handler threads.
- `docs/specs/queued-messages.spec.md` defines ordered surface-queue delivery used by handler
  starts, handler follow-ups, report requests, and orchestrator episode notifications.

## Product Role

`svvy` ships one app-owned native thread-control implementation with two separate agent-facing
extension records:

| Extension id | Title | Interface | Actor kind | State | Exposed tools |
| --- | --- | --- | --- | --- | --- |
| `thread-orchestration` | Thread Orchestration | `native_tool` | Orchestrator | `default_loaded` | `thread_start`, `thread_followup`, `thread_list`, `thread_episodes`, `thread_request_report` |
| `thread-handling` | Thread Handling | `native_tool` | Handler thread | `default_loaded` | `thread_current`, `thread_group`, `thread_report`, `thread_episodes` |
| `thread-orchestration` | Thread Orchestration | `native_tool` | Handler thread | `unavailable` | none |
| `thread-handling` | Thread Handling | `native_tool` | Orchestrator | `unavailable` | none |
| both | both | `native_tool` | Workflow task agent | `unavailable` | none |

The split is deliberate:

- the implementation is shared so thread groups, thread rows, queue writes, report requests,
  episodes, and lifecycle transactions stay in one product-owned module
- the generated agent context is not shared because orchestrators and handlers need different
  instructions and different callable tools
- a loaded extension record does not imply every actor receives every thread tool
- handlers can inspect only their current thread and current thread group through handler-scoped
  tools; they do not receive orchestrator-wide `thread_list`
- workflow task agents receive no thread-control tools and should not be taught unavailable controls
  in prompt prose

The native implementation is not:

- a separate manager agent
- a standalone custom runtime
- a Smithers workflow abstraction
- an Incur CLI or `svvyx` command family
- an `execute_typescript` helper family
- a prompt-only instruction extension
- a peer-to-peer messaging bus between handler threads
- shared memory for handler threads in the same group

Thread controls are native because they mutate live product state, bind pi-backed surfaces, create
durable queue rows, and must run inside app transactions. Extension Managing is allowed to be an
Incur-backed `svvyx` CLI because it edits extension records through an ordinary command boundary.
Thread controls need app-owned actor binding and queue coordination that would be brittle if modeled
as shell-visible CLI commands.

## State Boundary

Thread tools read and write product state. They do not read or write repo files.

DB/product-state-backed facts:

- thread-group rows
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

## Thread Groups

A thread group is the durable topology record for handler threads that were intentionally grouped by
the orchestrator.

Thread groups exist so:

- a single `thread_start` call can create multiple related handler conversations
- later `thread_start` calls can add more handler conversations to the same group
- the orchestrator can rediscover and filter related handler threads with `thread_list`
- handlers can understand which sibling objectives are related to their current objective through
  `thread_group`
- the orchestrator can send a correction or follow-up to every current member of a group through
  `thread_followup`

Thread groups do not mean:

- shared transcript context
- shared memory
- automatic cross-thread synchronization
- handler-to-handler direct messaging
- a workflow graph
- a substitute for Smithers parallel task agents
- a second orchestrator or team lead

Every handler thread belongs to exactly one thread group. A single-thread delegation still creates a
thread group so later related handler threads can be added and the topology shape stays uniform.

`threadGroupId` is product-state-backed and durable. It is not file-backed. It is not a UI title. It
is not user-editable in the thread-control API. Handler-thread UI grouping, if present, is a
projection over this state and not an additional agent-facing identity.

## Non-Goals And Forbidden Fields

The agent-facing API must not expose these shapes:

- no single `ThreadStatus` union such as `idle`, `running-handler`, `running-workflow`, `waiting`,
  `troubleshooting`, or `completed`
- no `canHandoff`, `canResume`, `canActivate`, or other best-effort decision hints
- no `reactivated` result field for `thread_followup`; lifecycle context is delivered to the
  handler when the queued item runs
- no `workflowRunCounts`
- no `attentionWorkflowRunIds` or `waitingWorkflowRunIds`
- no `pendingReportRequestCount`
- no `latestEpisode` in `thread_start` or `thread_followup`
- no `queue` object; lifecycle write tools return a flat `queuedItems` array
- no `queuedItems[].target`; the tool name, target arguments, and item kind determine the
  destination surface
- no handler-thread `title` in tool results
- no UI-facing attention, badge, subtitle, troubleshooting, or row-state fields
- no transcript bodies, workflow summaries, or Smithers internals in thread read results
- no episode bodies in summary reads; `thread_episodes` is the only thread read tool that returns
  episode `body`
- no raw top-level array input to `thread_start`
- no `thread_start_many`; multi-thread creation is the normal `thread_start` shape with more than
  one item in `threads`
- no `thread_resume`; objective reactivation is `thread_followup({ activate: true, ... })`
- no `thread_request_orchestrator`; handler-to-orchestrator coordination uses `thread_report`
- no handler-visible `thread_list`; handlers use `thread_group`
- no direct handler-to-handler or peer-to-peer thread tool
- no `excludeSelf`, `senderThreadId`, or similar group-broadcast exclusion option in v1

Reasons:

- active handler work and active workflow work may both be true; a single thread status collapses
  independent facts
- orchestration tools should expose facts agents can act on directly, not UI presentation state
- Smithers already owns workflow semantics; thread tools should not mirror Smithers with lossy
  counters or invented attention categories
- lifecycle mutations should fail clearly when invalid instead of returning predictive booleans that
  agents must interpret programmatically
- thread groups are topology only; broad messaging and shared-memory fields would turn groups into a
  second coordination substrate
- follow-up and reactivation are the same product action with one explicit lifecycle flag; keeping a
  separate `thread_resume` would force agents to choose between two tools that both send text to an
  existing handler surface

## Shared Types

```ts
type WorkspaceSessionId = string;
type SurfacePiSessionId = string;
type ThreadGroupId = string;
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
  | "thread_followup"
  | "report_request"
  | "thread_report"
  | "workflow_attention"
  | "request_user_input_answer"
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
  threadGroupId: ThreadGroupId;
  latestEpisode: ThreadEpisodeSummary | null;
};

type ThreadGroupItem = ThreadRef & {
  latestEpisode: ThreadEpisodeSummary | null;
};

type CurrentThreadRef = ThreadRef & {
  threadGroupId: ThreadGroupId;
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
only return the queue items created by that tool call: `initial_handler_start`, `thread_followup`,
`report_request`, or `thread_report`.

`ThreadEpisodeSummary.kind` is derived from whether the handler supplied `outcome` to
`thread_report`:

- omitted `outcome` creates an `update` episode
- present `outcome` creates a `conclusion` episode and concludes the active objective

`ThreadEpisodeSummary.outcome` is `null` for update episodes.

## `thread_start`

`thread_start` creates one or more pi-backed handler threads and queues each handler's first turn.

Available only in `thread-orchestration`.

Input:

```ts
type ThreadStartInput = {
  threadGroupId?: ThreadGroupId;
  threads: Array<{
    objective: string;
    extensions?: Partial<Record<ExtensionId, ExtensionUsageState>>;
  }>;
};
```

Rules:

- `threads` is required and must contain at least one item.
- `threads` must not exceed the product setting for maximum threads created by one tool call. The
  default maximum is `50`. The limit exists only to prevent runaway typo or generation crashes; it
  is not a product recommendation to create 50 threads.
- each `threads[].objective` is required and is the raw delegated objective for that handler thread.
- each `threads[].extensions` is optional.
- when `threadGroupId` is omitted, `svvy` creates a new thread group and places every created
  handler thread in that group.
- when `threadGroupId` is supplied, it must name an existing thread group visible in the current
  workspace session, and every created handler thread is added to that group.
- `threadGroupId` is returned once at top level. Individual `threads` result items do not repeat it.
- when `extensions` is omitted for a thread item, that handler uses the configured `threadHandler`
  profile extension states.
- when `extensions` is provided for a thread item, each listed extension id overrides that
  extension's state for that handler thread.
- omitted extension ids keep the `threadHandler` profile state.
- values may be `default_loaded`, `available`, or `unavailable`.
- Extension Loading cannot be overridden and remains `default_loaded`.
- `thread-handling` remains `default_loaded` for the handler thread.
- `thread-orchestration` remains `unavailable` for the handler thread.
- the override is bound to the created handler thread and does not mutate the `threadHandler`
  profile.
- the override is applied before the handler's first turn and before generated prompt, tools,
  `svvyx` guidance, TypeScript declarations, and fingerprints are created for that handler.
- each handler's first turn starts from its raw `objective`; the orchestrator must not manually send
  a first handler-thread message.
- handler-thread UI titles, if present, are product-generated outside this API; the orchestrator does
  not supply a title and this result does not return one.
- `thread_start` extension overrides do not affect workflow task agents launched by workflows under
  that handler.

Policy:

- use `thread_start` with one item in `threads` for ordinary delegation.
- use multiple `threads` only when the user clearly wants separate conversations, the objectives are
  independently discussable, or each workstream may need direct user follow-up.
- do not use multiple handler threads merely to parallelize ordinary implementation, research,
  review, or workflow steps. Internal parallel execution belongs inside one handler-owned Smithers
  workflow.
- if a later related handler conversation is needed, call `thread_start` again with the existing
  `threadGroupId`.

Success result:

```ts
type ThreadStartResult = {
  ok: true;
  threadGroupId: ThreadGroupId;
  threads: ThreadRef[];
  queuedItems: QueuedItemSummary[];
};
```

Example ordinary input:

```json
{
  "threads": [
    {
      "objective": "Configure Project CI for this repository",
      "extensions": {
        "project-ci": "default_loaded",
        "github": "available"
      }
    }
  ]
}
```

Example ordinary output:

```json
{
  "ok": true,
  "threadGroupId": "thread_group_77",
  "threads": [
    {
      "threadId": "thread_123",
      "objective": "Configure Project CI for this repository",
      "objectiveState": "active",
      "updatedAt": "2026-06-04T10:00:00.000Z"
    }
  ],
  "queuedItems": [
    {
      "queuedItemId": "queue_1001",
      "kind": "initial_handler_start",
      "status": "queued"
    }
  ]
}
```

Example multi-thread input:

```json
{
  "threads": [
    {
      "objective": "Assess the proposed `thread_start` API shape and identify schema risks."
    },
    {
      "objective": "Assess the thread-group and follow-up UX for sibling handler conversations."
    }
  ]
}
```

Example multi-thread output:

```json
{
  "ok": true,
  "threadGroupId": "thread_group_88",
  "threads": [
    {
      "threadId": "thread_api_123",
      "objective": "Assess the proposed `thread_start` API shape and identify schema risks.",
      "objectiveState": "active",
      "updatedAt": "2026-06-04T14:22:10.000Z"
    },
    {
      "threadId": "thread_ux_124",
      "objective": "Assess the thread-group and follow-up UX for sibling handler conversations.",
      "objectiveState": "active",
      "updatedAt": "2026-06-04T14:22:10.000Z"
    }
  ],
  "queuedItems": [
    {
      "queuedItemId": "queue_2101",
      "kind": "initial_handler_start",
      "status": "queued"
    },
    {
      "queuedItemId": "queue_2102",
      "kind": "initial_handler_start",
      "status": "queued"
    }
  ]
}
```

Example add-to-group input:

```json
{
  "threadGroupId": "thread_group_88",
  "threads": [
    {
      "objective": "Check whether the accepted thread-group API needs changes in queued-message state."
    }
  ]
}
```

## `thread_followup`

`thread_followup` queues an orchestrator-authored follow-up message to existing handler threads.
When `activate` is true, it also reactivates concluded handler objectives before delivery.

Available only in `thread-orchestration`.

Input:

```ts
type ThreadFollowupInput = {
  threadIds?: ThreadId[];
  threadGroupId?: ThreadGroupId;
  message: string;
  activate?: boolean;
};
```

Rules:

- exactly one of `threadIds` or `threadGroupId` is required.
- `message` is required.
- `threadIds`, when supplied, must contain at least one id and must name handler threads visible in
  the current workspace session.
- `threadGroupId`, when supplied, must name an existing thread group visible in the current
  workspace session.
- targeting a group sends the follow-up to every current handler thread in that group.
- group targeting has no `excludeSelf` behavior in v1. If a handler asked the orchestrator to tell
  the group something, the initiating handler may receive the follow-up too.
- follow-ups may target active or concluded handler threads.
- omitted `activate` behaves as `false`.
- `activate: false` queues the follow-up without changing objective lifecycle state.
- `activate: true` changes each concluded target thread's objective state to `active` before queueing
  the follow-up.
- `activate: true` sets the new objective for each reactivated target to `message`.
- `activate: true` on an already active target is allowed and is a lifecycle no-op; it does not
  rewrite that target's existing objective.
- `thread_followup` does not control or resume Smithers runs directly. Smithers run inspection,
  repair, fresh launch, or exact run resume remains the handler thread's job.
- follow-up delivery goes through each target handler surface queue and does not bypass the prompt
  lock.
- earlier episodes remain durable history; later `thread_report` calls append new ordered episodes.

Queued delivery:

- active handler targets receive the follow-up as an ordinary prompt-bearing handler-surface queue
  item.
- concluded handler targets reactivated by `activate: true` receive a product-authored lifecycle
  preface before the follow-up text. The preface must communicate that the handler was previously
  concluded and has now been reactivated by the orchestrator for a new objective in the same
  delegated context.
- the reactivation preface should instruct the handler to use existing thread history, episodes,
  artifacts, and workflow-run context as relevant, and to call `thread_report` if the reason for
  reactivation is unclear instead of guessing.
- the lifecycle preface is runtime-authored delivery context. The orchestrator does not have to
  hand-write it in `message`.
- the tool result does not include a `reactivated` field; the state change is visible through
  returned thread objective state and through `thread_list` or `thread_current`.

Success result:

```ts
type ThreadFollowupResult = {
  ok: true;
  threadGroupId?: ThreadGroupId;
  threads: ThreadRef[];
  queuedItems: QueuedItemSummary[];
};
```

`threadGroupId` is present in the result only when the input targeted a group. It is omitted when
the input targeted explicit `threadIds`, because those threads may belong to different groups and the
agent can rediscover group membership through `thread_list`.

Example group correction input:

```json
{
  "threadGroupId": "thread_group_88",
  "message": "Correction: treat thread groups as topology only, not shared memory. Keep ordinary parallel work inside one handler-supervised Smithers workflow."
}
```

Example group correction output:

```json
{
  "ok": true,
  "threadGroupId": "thread_group_88",
  "threads": [
    {
      "threadId": "thread_api_123",
      "objective": "Assess the proposed `thread_start` API shape and identify schema risks.",
      "objectiveState": "active",
      "updatedAt": "2026-06-04T14:40:00.000Z"
    },
    {
      "threadId": "thread_ux_124",
      "objective": "Assess the thread-group and follow-up UX for sibling handler conversations.",
      "objectiveState": "active",
      "updatedAt": "2026-06-04T14:40:00.000Z"
    }
  ],
  "queuedItems": [
    {
      "queuedItemId": "queue_2210",
      "kind": "thread_followup",
      "status": "queued"
    },
    {
      "queuedItemId": "queue_2211",
      "kind": "thread_followup",
      "status": "queued"
    }
  ]
}
```

Example reactivation input:

```json
{
  "threadIds": ["thread_api_123"],
  "message": "Revise your recommendation using the accepted `thread_group` API shape.",
  "activate": true
}
```

Example reactivation output:

```json
{
  "ok": true,
  "threads": [
    {
      "threadId": "thread_api_123",
      "objective": "Revise your recommendation using the accepted `thread_group` API shape.",
      "objectiveState": "active",
      "updatedAt": "2026-06-04T15:10:00.000Z"
    }
  ],
  "queuedItems": [
    {
      "queuedItemId": "queue_2212",
      "kind": "thread_followup",
      "status": "queued"
    }
  ]
}
```

## `thread_list`

`thread_list` lists delegated handler threads visible from the current workspace session.

Available only in `thread-orchestration`.

Input:

```ts
type ThreadListInput = {
  threadId?: ThreadId;
  threadGroupId?: ThreadGroupId;
  objectiveState?: ObjectiveState;
  query?: string;
  limit?: number;
};
```

Rules:

- all filters are optional.
- `threadId` returns the matching thread when visible to the current workspace session.
- `threadGroupId` filters to handler threads in that group when the group is visible to the current
  workspace session.
- `objectiveState` filters by the current objective lifecycle state.
- `query` is a case-insensitive substring search over objective and latest episode summary.
- `limit` caps the newest returned threads when no exact `threadId` is supplied.
- omitted `limit` uses the product default page size.
- results are ordered by `updatedAt` descending.
- results include `threadGroupId` so the orchestrator can rediscover group identity after
  `thread_start` without relying on transcript memory.
- transcript bodies, workflow summaries, active workflow ids, report-request bodies, and Smithers
  internals are not included.
- exact episode bodies are read through `thread_episodes`.
- workflow details are read through Smithers-native tools inside the handler by exact workflow run
  id.
- the tool reads durable structured state and does not create command records or write lifecycle
  facts.

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
  "threadGroupId": "thread_group_88",
  "limit": 10
}
```

Example output:

```json
{
  "ok": true,
  "threads": [
    {
      "threadId": "thread_api_123",
      "threadGroupId": "thread_group_88",
      "objective": "Assess the proposed `thread_start` API shape and identify schema risks.",
      "objectiveState": "concluded",
      "updatedAt": "2026-06-04T14:55:20.000Z",
      "latestEpisode": {
        "episodeId": "episode_9001",
        "requestId": null,
        "kind": "conclusion",
        "outcome": "succeeded",
        "summary": "The array-shaped `thread_start` API is valid if group topology stays explicit.",
        "createdAt": "2026-06-04T14:55:20.000Z"
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

- `threadId` filters to one handler thread.
- `episodeId` returns one exact episode when visible to the current workspace session.
- `requestId` returns the episode that resolved one exact report request.
- `limit` caps the newest returned episodes when no exact `episodeId` or `requestId` is supplied.
- omitted `limit` uses the product default page size.
- when called from `thread-orchestration`, omitted `threadId` searches all visible handler threads.
- when called from `thread-handling`, omitted `threadId` means the current handler thread, and a
  supplied `threadId` must equal the current handler thread.
- handlers do not use `thread_episodes` to inspect sibling episode bodies; `thread_group` returns
  only sibling latest episode summaries.
- episodes are returned in chronological order after filtering and limiting.
- this is the only thread read tool that returns episode `body`.
- the tool reads durable structured state and does not create command records or write lifecycle
  facts.

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
  "threadId": "thread_api_123",
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
      "threadId": "thread_api_123",
      "requestId": "report_req_77",
      "kind": "update",
      "outcome": null,
      "title": "Thread API review is in progress",
      "summary": "The handler is checking the queue and thread-state implications of grouped starts.",
      "body": "The grouped start shape should keep thread groups as product topology. I am checking whether any queue item needs to duplicate group identity.",
      "createdAt": "2026-06-04T14:35:05.000Z"
    },
    {
      "episodeId": "episode_9001",
      "threadId": "thread_api_123",
      "requestId": null,
      "kind": "conclusion",
      "outcome": "succeeded",
      "title": "Thread API shape accepted",
      "summary": "The array-shaped `thread_start` API is valid if group topology stays explicit.",
      "body": "The handler completed the delegated objective. The API should use `thread_start({ threadGroupId?, threads })`, return one top-level `threadGroupId`, and use `thread_followup({ activate: true })` instead of a separate `thread_resume` tool.",
      "createdAt": "2026-06-04T14:55:20.000Z"
    }
  ]
}
```

## `thread_request_report`

`thread_request_report` asks one handler thread to emit a report episode in response to an
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
- the app generates `requestId`; the orchestrator does not provide it.
- success records a pending report request and queues a `report_request` item on the handler
  surface.
- the handler resolves the request by calling `thread_report` with the same `requestId`.
- the resolving report may be an update episode or a conclusion episode.
- report requests are ordered through the same surface queue as user messages, follow-ups, and
  context refreshes.
- `thread_request_report` may target an active or concluded objective; asking for a status update is
  not the same as activating the objective.
- `thread_request_report` targets one handler thread. To send the same follow-up text to a group,
  use `thread_followup`.
- the tool does not inspect Smithers state directly and does not return workflow summaries.

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
  "threadId": "thread_api_123",
  "request": "Give me a concise update on whether the grouped thread API has any remaining blockers."
}
```

Example output:

```json
{
  "ok": true,
  "threadId": "thread_api_123",
  "requestId": "report_req_77",
  "request": "Give me a concise update on whether the grouped thread API has any remaining blockers.",
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

- the current thread is implicit in the handler actor binding.
- the tool reads durable structured state and active prompt runtime binding.
- the tool does not create command records or write lifecycle facts.
- the result includes `threadGroupId` so the handler can understand its current group identity and
  can refer to that group in `thread_report` when asking the orchestrator to forward a correction or
  decision.
- `activeWorkflowRunIds` is the only workflow-derived field because handler conclusions must fail
  while active workflow runs are still owned by the current objective.
- detailed workflow facts stay in Smithers; handlers use active workflow run ids with `smithers_*`
  tools.
- pending report requests are returned as full request text because the handler must answer them.
- latest episode is a summary only; full bodies are read through `thread_episodes`.

Result:

```ts
type ThreadCurrentResult = {
  ok: true;
  thread: CurrentThreadRef;
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
    "threadId": "thread_api_123",
    "threadGroupId": "thread_group_88",
    "objective": "Assess the proposed `thread_start` API shape and identify schema risks.",
    "objectiveState": "active",
    "updatedAt": "2026-06-04T14:35:05.000Z"
  },
  "activeWorkflowRunIds": ["workflow_run_456"],
  "pendingReportRequests": [
    {
      "requestId": "report_req_77",
      "request": "Give me a concise update on whether the grouped thread API has any remaining blockers.",
      "createdAt": "2026-06-04T14:34:58.000Z"
    }
  ],
  "latestEpisode": {
    "episodeId": "episode_8998",
    "requestId": null,
    "kind": "update",
    "outcome": null,
    "summary": "The handler is checking the queue and thread-state implications of grouped starts.",
    "createdAt": "2026-06-04T14:35:05.000Z"
  }
}
```

## `thread_group`

`thread_group` reads the current handler thread's group and sibling thread summaries.

Available only in `thread-handling`.

Input:

```ts
type ThreadGroupInput = {};
```

Rules:

- the current thread and current thread group are implicit in the handler actor binding.
- handlers cannot pass a `threadGroupId`; the tool is always scoped to the current handler's group.
- the result includes the current handler thread and sibling handler threads in the same group.
- results do not include thread-group members outside the current workspace session.
- results do not include transcript bodies, workflow summaries, active workflow ids, report-request
  bodies, Smithers internals, or episode bodies.
- latest episode is a summary only. Handlers cannot read sibling episode bodies through
  `thread_episodes`.
- the tool reads durable structured state and does not create command records or write lifecycle
  facts.

Result:

```ts
type ThreadGroupResult = {
  ok: true;
  threadGroupId: ThreadGroupId;
  threads: ThreadGroupItem[];
};
```

Example output:

```json
{
  "ok": true,
  "threadGroupId": "thread_group_88",
  "threads": [
    {
      "threadId": "thread_api_123",
      "objective": "Assess the proposed `thread_start` API shape and identify schema risks.",
      "objectiveState": "active",
      "updatedAt": "2026-06-04T14:40:00.000Z",
      "latestEpisode": {
        "episodeId": "episode_8998",
        "requestId": null,
        "kind": "update",
        "outcome": null,
        "summary": "The handler is checking the queue and thread-state implications of grouped starts.",
        "createdAt": "2026-06-04T14:35:05.000Z"
      }
    },
    {
      "threadId": "thread_ux_124",
      "objective": "Assess the thread-group and follow-up UX for sibling handler conversations.",
      "objectiveState": "active",
      "updatedAt": "2026-06-04T14:38:10.000Z",
      "latestEpisode": null
    }
  ]
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

- only handler-thread actors may call `thread_report`.
- the current thread is implicit in the handler actor binding.
- `title`, `summary`, and `body` are required and describe the durable episode.
- `requestId` is optional.
- when supplied, `requestId` must name a pending report request for the current thread.
- a successful report with `requestId` resolves that report request.
- omitted `outcome` records an intermediate `update` episode and leaves `objectiveState` unchanged.
- present `outcome` records a `conclusion` episode and changes `objectiveState` from `active` to
  `concluded`.
- conclusion requires the current objective to be `active`.
- update episodes are allowed for active or concluded objectives.
- conclusion fails if any active Smithers workflow run is still owned by the current objective.
- before failing for active workflow ownership, the runtime should reconcile thread-owned workflow
  state against Smithers durable run state so a just-finished run is not mistaken for an active one.
- the tool must not expose `canHandoff`; agents learn invalid lifecycle attempts from explicit tool
  failures.
- success records the episode first, then queues a `thread_report` item on the orchestrator surface.
- cancelling or deleting the orchestrator queue item does not roll back the episode and does not
  return a tool error to the handler.
- the handler surface remains fully interactive after success, including after a conclusion episode.

Coordination policy:

- `thread_report` is the handler-to-orchestrator communication tool.
- there is no separate `thread_request_orchestrator` tool.
- a handler that wants a correction, decision, or finding forwarded to sibling threads should call
  `thread_report` without `outcome`, write the request clearly in `title`, `summary`, and `body`,
  and mention the current `threadGroupId` when useful.
- the orchestrator decides whether to forward the request, and if so uses `thread_followup` with the
  target `threadGroupId` or exact `threadIds`.
- handlers should not use `thread_report` as a raw chat log. Reports should be compact, durable, and
  actionable for orchestrator reconciliation.

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
  "title": "Thread API review is in progress",
  "summary": "The handler is checking the queue and thread-state implications of grouped starts.",
  "body": "The grouped start shape should keep thread groups as product topology. I am checking whether any queue item needs to duplicate group identity."
}
```

Example coordination input:

```json
{
  "title": "Group correction requested",
  "summary": "The API-shape thread wants the same correction sent to its thread group.",
  "body": "Please tell thread group thread_group_88 to treat thread groups as topology only, not shared memory. Ordinary parallel work should stay inside one handler-supervised Smithers workflow."
}
```

Example update output:

```json
{
  "ok": true,
  "threadId": "thread_api_123",
  "requestId": "report_req_77",
  "episode": {
    "episodeId": "episode_8998",
    "kind": "update",
    "createdAt": "2026-06-04T14:35:05.000Z"
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
  "title": "Thread API shape accepted",
  "summary": "The array-shaped `thread_start` API is valid if group topology stays explicit.",
  "body": "The handler completed the delegated objective. The API should use `thread_start({ threadGroupId?, threads })`, return one top-level `threadGroupId`, and use `thread_followup({ activate: true })` instead of a separate `thread_resume` tool.",
  "outcome": "succeeded"
}
```

Example conclusion output:

```json
{
  "ok": true,
  "threadId": "thread_api_123",
  "requestId": null,
  "outcome": "succeeded",
  "episode": {
    "episodeId": "episode_9001",
    "kind": "conclusion",
    "createdAt": "2026-06-04T14:55:20.000Z"
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
    "activeWorkflowRunIds": ["workflow_run_456"]
  }
}
```

## Actor-Facing Instructions

The generated instructions for these extensions must be explicit enough that the agent does not have
to infer policy from tool schemas.

### Thread Orchestration Instructions

The loaded `thread-orchestration` instructions for orchestrators must include this policy:

```md
## Thread Orchestration

Use handler threads for user-visible delegated objectives that benefit from their own interactive
conversation.

Prefer one handler thread for an objective. If the work is internally parallel but does not need
separate user-visible conversations, start one handler and let that handler supervise a Smithers
workflow with parallel task agents.

Use `thread_start` with multiple `threads` only when the user clearly wants separate conversations,
the objectives are independently discussable, or each workstream may need direct user follow-up.

Do not use multiple handler threads merely to parallelize ordinary implementation, research, review,
or workflow steps. That belongs inside one handler-owned Smithers workflow.

`thread_start` always takes an object with `threads`. For ordinary delegation, pass one item.

`thread_start` returns the created `threadGroupId` and thread ids. Later, `thread_list` can return
those ids again and can filter by `threadGroupId`, so you do not need to preserve them only in
transcript memory. Use `thread_list` when you need to rediscover existing threads or groups before
sending follow-ups.

When adding a new handler conversation to an existing related group, pass the existing
`threadGroupId` to `thread_start`.

Use `thread_followup` to send explicit follow-up instructions to existing handler threads. Target
either exact `threadIds` or one `threadGroupId`.

Use `thread_followup` without `activate` for corrections, notes, clarifications, and other ordinary
follow-ups that should not reopen a concluded objective.

Use `thread_followup({ activate: true, ... })` when later work belongs in the same delegated context
and a concluded handler should become active again for a new objective span. The follow-up `message`
becomes the objective for reactivated concluded targets.

Do not create a new handler thread when a concluded handler already has the right delegated context
for the follow-up. Reactivate it with `thread_followup({ activate: true })`.

Use `thread_request_report` when you need a specific update episode from one handler.

When a handler reports that its sibling threads should receive an instruction, decide whether that
request is strategically valid. If it is, call `thread_followup` with the handler's `threadGroupId`.
The handler does not broadcast directly.
```

### Thread Handling Instructions

The loaded `thread-handling` instructions for handler threads must include this policy:

```md
## Thread Handling

You own the current delegated objective. Your current thread identity, group identity, active
workflow runs, pending report requests, and latest episode are available through `thread_current`.

Use `thread_group` only when knowing sibling objectives would materially help your current objective
or when the user or orchestrator asks you to coordinate with related handlers.

Thread groups are topology, not shared memory. Do not assume sibling threads know your conclusions.
Do not inspect or summarize unrelated workspace threads.

You cannot message sibling threads directly. If a correction, decision, or useful finding should be
sent to sibling threads, call `thread_report` with an update episode that clearly asks the
orchestrator to forward it to the group.

Use `thread_report` without `outcome` for important intermediate updates, report-request answers, or
coordination requests to the orchestrator.

Use `thread_report` with `outcome` only when the current objective is actually concluded and no
active workflow run remains owned by this objective.

Do not use `thread_report` as a raw chat log. Keep reports compact, durable, and actionable for
orchestrator reconciliation.
```

## Command And Queue Facts

Write tools create normal command records:

- `thread_start`
- `thread_followup`
- `thread_request_report`
- `thread_report`

Read tools do not create command records:

- `thread_current`
- `thread_group`
- `thread_list`
- `thread_episodes`

Visibility:

- thread lifecycle write tools are normally `surface` visibility commands
- thread read tools are state-inspection tools and should stay out of command history unless a later
  product decision explicitly records read commands

Queue behavior:

- `thread_start` creates or reuses a thread group, creates handler threads, and enqueues or
  dispatches one `initial_handler_start` item on each new handler surface.
- `thread_followup` optionally activates concluded targets, then enqueues or dispatches one
  `thread_followup` item on each target handler surface.
- `thread_request_report` records a report request, then enqueues a `report_request` item on the
  target handler surface.
- `thread_report` records the durable episode first, optionally resolves a report request,
  optionally concludes the objective, then enqueues a `thread_report` notification on the
  orchestrator surface.

All queue rows are ordered product state. The tool result returns only the rows created by that tool
call, as `queuedItems: QueuedItemSummary[]`.

## Rejected Shapes

These shapes are not part of the current API:

```ts
thread_start({ objective: "..." });
thread_start([{ objective: "..." }]);
thread_start({ context: ["ci"] });
thread_start_many(...);
thread_start_ci(...);
ci.start(...);
thread_resume(...);
thread_resume({ runId: "smithers_run_123" });
thread_followup({ threadIds: ["thread_1"], threadGroupId: "thread_group_1", message: "..." });
thread_followup({ threadGroupId: "thread_group_1", message: "...", excludeSelf: true });
thread_request_orchestrator(...);
thread_group({ threadGroupId: "thread_group_1" });
thread_list({ threadGroupId: "thread_group_1" }); // unavailable to handlers; handlers use thread_group({})
thread_handoff({ title: "...", summary: "...", body: "..." });
thread_handoffs({ threadId: "thread_123" });
thread_report({ conclude: { outcome: "succeeded" } });
thread_report({ workflowRunId: "smithers_run_123" });
extensions.thread.start(...); // broad execute_typescript helper family
extensions.workflow.*;        // parallel workflow abstraction
```

Workflow run launch and exact Smithers run resume use Smithers-native tools inside the handler
thread, especially `smithers_run_workflow({ workflowId, input, runId? })`.
