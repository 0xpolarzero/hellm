# Thread Managing Extension Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines the native thread-control surfaces for orchestrators and handler threads.
Thread-control handlers validate inputs and return an `ExtensionHandlerResult` containing one
pre-commit model-facing result plus ordered `ExtensionRuntimeOperation` items wrapping closed
declarative `RuntimeEffectRequest` values. For mutating thread tools, the pre-commit result may only
acknowledge accepted intent; `@svvy/runtime` applies the wrapped request transactionally, derives
durable ids and terminal command facts from committed state, and publishes the resulting queue,
surface, episode, and read-model notifications after commit.

## Extension Records

The shared native implementation is exposed as two actor-facing extension records:

- `thread-orchestration`: orchestrator-only
- `thread-handling`: handler-thread-only

Workflow task agents receive neither extension by default.

## Orchestrator Tools

Orchestrators receive:

- `thread_start`
- `thread_followup`
- `thread_list`
- `thread_episodes`
- `thread_request_report`

## Handler Tools

Handler threads receive:

- `thread_current`
- `thread_group`
- `thread_report`
- `thread_episodes`

Handlers do not receive `thread_start`. Nested delegation is outside the current contract.

## `thread_start`

`thread_start` requests durable handler-surface creation or appending to an existing thread group.

Input shape:

```ts
type ThreadStartInput = {
  threadGroupId?: ThreadGroupId;
  threads: Array<{
    objective: string;
    history?: "isolated" | "forked";
    overrides?: Partial<Record<ExtensionId, "loaded" | "available" | "unavailable">>;
  }>;
};
```

Rules:

- `threads` is required and normally has one item.
- `history` defaults to `isolated`.
- Use `forked` only when conversational continuity is explicitly requested or materially necessary.
- Multiple items are for separate user-visible handler conversations, not ordinary internal
  parallelism.
- `overrides` is a partial map over the `threadHandler` profile.

Output shape:

```ts
type ThreadStartResult = {
  threadGroupId: ThreadGroupId;
  threads: Array<{
    threadId: ThreadId;
    surfacePiSessionId: SurfacePiSessionId;
    objective: string;
    objectiveState: "active";
  }>;
};
```

The handler validates input and returns an `ExtensionHandlerResult` whose ordered operations include
one atomic `{ kind: "runtime_effect", request: { type: "handler_thread.start", ... } }` item per
`thread_start` tool call. That request contains the full `threads[]` array. The handler's immediate
model-facing result may only acknowledge accepted intent; it must not synthesize durable ids, final
thread rows, queue rows, generated handler titles, or terminal command facts.

`@svvy/runtime` applies thread-group/thread creation, handler surface creation, generated-context
binding, and each `initial_handler_start` queue row in one state transaction. Runtime allocates
durable ids, constructs the final `ThreadStartResult` from the applied effect result, records
`thread_start.finished` command facts, then publishes notifications after commit. The handler must
not return separate per-thread `handler_thread.start`, `surface.create`, or `queue.insert` effects
for the same tool call.

Effect sequence:

1. validate objective text, thread group ownership, and extension override ids against the current
   orchestrator workspace session
2. return one `handler_thread.start` request with the resolved `threadGroupId` and all requested
   threads, including each objective text, history mode, and actor binding overrides
3. runtime applies the atomic request in the owning command lane
4. runtime returns the final `ThreadStartResult` and records `thread_start.finished` command facts
   from the committed state result

## `thread_followup`

`thread_followup` requests follow-up work for exact thread ids or one thread group.

Input shape:

```ts
type ThreadFollowupInput = {
  threadIds?: readonly ThreadId[];
  threadGroupId?: ThreadGroupId;
  message: string;
  activate?: boolean;
};
```

Exactly one of `threadIds` or `threadGroupId` is required. `threadIds` must contain at least one
durable handler thread owned by the current workspace session. `threadGroupId` expands to the
current non-archived handler threads in that group. The handler rejects empty target sets.

`activate: true` reactivates concluded handler objectives in the same delegated context. Active
targets keep their current objective.

The handler validates input and returns one pre-commit model-facing acknowledgement plus ordered
`ExtensionRuntimeOperation` items such as
`{ kind: "runtime_effect", request: { type: "queue.insert", ... } }` and
`{ kind: "runtime_effect", request: { type: "episode.record", ... } }`. `@svvy/runtime` applies the
queue mutation, allocates durable ids, constructs the terminal command facts from committed state,
and publishes the typed notification after commit.

Output shape:

```ts
type ThreadFollowupResult = {
  targets: ReadonlyArray<{
    threadId: ThreadId;
    surfacePiSessionId: SurfacePiSessionId;
    queuedItemId: QueueItemId;
    objectiveState: "active" | "reactivated";
  }>;
};
```

## `thread_request_report`

`thread_request_report` asks one handler thread for an explicit update episode without changing the
handler objective.

Input shape:

```ts
type ThreadRequestReportInput = {
  threadId: ThreadId;
  reason?: string;
};
```

Output shape:

```ts
type ThreadRequestReportResult = {
  threadId: ThreadId;
  surfacePiSessionId: SurfacePiSessionId;
  queuedItemId: QueueItemId;
  requestEpisodeId: EpisodeId;
};
```

The tool returns one pre-commit model-facing acknowledgement plus one ordered
`ExtensionRuntimeOperation` item wrapping the handler-surface queue-delivery `RuntimeEffectRequest`.
`@svvy/runtime` applies the queue mutation, allocates durable ids, constructs the model-facing
result from the applied effect result, and publishes the typed notification after commit. The handler
responds with `thread_report`.

## Shared Read-Model Types

The read-only thread tools return state-backed read models derived by `@svvy/state` selectors. Tool
handlers validate parameters and return those read models plus typed command-fact payloads for
`@svvy/runtime` to record when command tracking applies. They do not write command facts directly
and do not rebuild thread state from pi transcripts, Smithers state, command logs, or renderer
state.

```ts
type ThreadStatus =
  | "running-handler"
  | "running-workflow"
  | "waiting"
  | "idle"
  | "troubleshooting"
  | "completed";

type ThreadReadModelWait = {
  kind: "user" | "external";
  reason: string;
  resumeWhen: string;
};

type ThreadReadModelEpisodeSummary = {
  id: EpisodeId;
  title: string;
  summary: string;
  createdAt: IsoDateTimeString;
};

type ThreadCompactRow = {
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  objectiveState: "active" | "concluded";
  status: ThreadStatus;
  wait: ThreadReadModelWait | null;
  latestEpisode: ThreadReadModelEpisodeSummary | null;
};
```

`ThreadCompactRow` is the only row shape used by compact thread tools. It deliberately omits episode
bodies, transcript messages, workflow run details, command counts, command facts, artifacts, and
Smithers internals. Agents read durable episode bodies only through `thread_episodes`.

## `thread_list`

`thread_list` lists handler threads as compact rows ordered by attention need.

Input shape:

```ts
type ThreadListInput = {
  status?: readonly ThreadStatus[];
  threadGroupId?: ThreadGroupId;
  limit?: number;
};
```

Output shape:

```ts
type ThreadListResult = {
  threads: readonly ThreadCompactRow[];
};
```

Rules:

- `status`, when present, filters to exact thread statuses.
- `threadGroupId`, when present, filters to that group.
- `limit` defaults to `20`, is truncated to an integer, and is clamped to `1..100`.
- Ordering is by attention priority, then newest `updatedAt`, then `threadId`: `waiting`,
  `troubleshooting`, `running-handler`, `running-workflow`, `idle`, `completed`.
- The result is compact metadata only. It must not include episode bodies, transcripts, command logs,
  workflow summaries, Smithers run details, artifacts, or renderer-only fields.

Example:

```json
{
  "input": { "status": ["waiting", "troubleshooting"], "limit": 5 },
  "output": {
    "threads": [
      {
        "threadId": "thread_01",
        "threadGroupId": "group_01",
        "workspaceSessionId": "session_01",
        "surfacePiSessionId": "pi_handler_01",
        "title": "Investigate Runtime Tools",
        "objective": "Inspect runtime state without prompt stuffing.",
        "objectiveState": "active",
        "status": "waiting",
        "wait": {
          "kind": "external",
          "reason": "Waiting for workflow signal.",
          "resumeWhen": "Signal arrives."
        },
        "latestEpisode": {
          "id": "episode_01",
          "title": "Prior report",
          "summary": "Earlier thread result.",
          "createdAt": "2026-04-18T10:03:00.000Z"
        }
      }
    ]
  }
}
```

## `thread_current`

`thread_current` returns the current handler identity, objective context, extension availability, and
pending report requests. It is handler-thread-only.

Input shape:

```ts
type ThreadCurrentInput = {};
```

Output shape:

```ts
type ThreadPendingReportRequest = {
  queuedMessageId: QueueItemId;
  request: string;
  createdAt: IsoDateTimeString;
};

type ThreadCurrentResult = ThreadCompactRow & {
  pendingReportRequests: readonly ThreadPendingReportRequest[];
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
};
```

Rules:

- Calling `thread_current` outside a handler thread fails and records a failed command.
- `pendingReportRequests` is derived from queued `report_request` rows for the current thread.
- `loadedExtensionIds` and `availableExtensionIds` are the current actor binding projection for that
  handler thread.
- The result does not include episode bodies, transcripts, Smithers internals, command logs,
  artifacts, or duplicate summary counts.

Example:

```json
{
  "input": {},
  "output": {
    "threadId": "thread_01",
    "threadGroupId": "group_01",
    "workspaceSessionId": "session_01",
    "surfacePiSessionId": "pi_handler_01",
    "title": "Investigate Runtime Tools",
    "objective": "Inspect runtime state without prompt stuffing.",
    "objectiveState": "active",
    "status": "waiting",
    "wait": {
      "kind": "external",
      "reason": "Waiting for workflow signal.",
      "resumeWhen": "Signal arrives."
    },
    "latestEpisode": {
      "id": "episode_01",
      "title": "Prior report",
      "summary": "Earlier thread result.",
      "createdAt": "2026-04-18T10:03:00.000Z"
    },
    "pendingReportRequests": [
      {
        "queuedMessageId": "queue_01",
        "request": "Summarize the focused checks.",
        "createdAt": "2026-04-18T10:04:30.000Z"
      }
    ],
    "loadedExtensionIds": ["shell", "thread-handling"],
    "availableExtensionIds": ["web"]
  }
}
```

## `thread_group`

`thread_group` returns the current handler thread group and sibling objective summaries. It is
handler-thread-only.

Thread groups are topology and addressing. They are not shared memory and not peer messaging.

Input shape:

```ts
type ThreadGroupInput = {};
```

Output shape:

```ts
type ThreadGroupResult = {
  threadGroupId: ThreadGroupId;
  currentThreadId: ThreadId;
  threads: readonly ThreadCompactRow[];
};
```

Rules:

- Calling `thread_group` outside a handler thread fails and records a failed command.
- `threads` contains only threads in the current handler's `threadGroupId`.
- `threads` uses the same attention ordering and compact row exclusions as `thread_list`.
- The result does not include episode bodies, transcripts, command logs, workflow summaries,
  Smithers run details, artifacts, or peer-private mutable memory.

Example:

```json
{
  "input": {},
  "output": {
    "threadGroupId": "group_01",
    "currentThreadId": "thread_01",
    "threads": [
      {
        "threadId": "thread_02",
        "threadGroupId": "group_01",
        "workspaceSessionId": "session_01",
        "surfacePiSessionId": "pi_handler_02",
        "title": "Check package boundaries",
        "objective": "Review the extracted read-model selector boundary.",
        "objectiveState": "active",
        "status": "waiting",
        "wait": null,
        "latestEpisode": null
      }
    ]
  }
}
```

## `thread_episodes`

`thread_episodes` reads durable handler-thread episode bodies when exact prior report content
matters.

Input shape:

```ts
type ThreadEpisodesInput = {
  threadId?: ThreadId;
  threadGroupId?: ThreadGroupId;
  limit?: number;
};
```

Output shape:

```ts
type ThreadEpisodeBody = {
  id: EpisodeId;
  threadId: ThreadId;
  title: string;
  summary: string;
  body: string;
  createdAt: IsoDateTimeString;
};

type ThreadEpisodesResult = {
  episodes: readonly ThreadEpisodeBody[];
};
```

Rules:

- `threadId` and `threadGroupId` are mutually exclusive.
- A handler-thread call with neither `threadId` nor `threadGroupId` defaults to the current handler
  thread.
- An orchestrator call must pass `threadId` or `threadGroupId`; otherwise it fails and records a
  failed command.
- `threadId` must reference an existing handler thread in the current workspace session.
- `threadGroupId` must reference an existing handler thread group in the current workspace session.
- `limit` defaults to `10`, is truncated to an integer, and is clamped to `1..50`.
- Results are sorted newest first by `createdAt`.
- `thread_episodes` returns durable episode bodies only. It does not synthesize episodes from
  ordinary replies, command summaries, artifacts, Smithers state, or transcripts.
- Pagination is not part of this API until a concrete product need exists; do not expose `hasMore`,
  cursors, or `beforeEpisodeId` fields.

Example:

```json
{
  "input": { "threadId": "thread_01", "limit": 1 },
  "output": {
    "episodes": [
      {
        "id": "episode_01",
        "threadId": "thread_01",
        "title": "Prior report",
        "summary": "Earlier thread result.",
        "body": "Full durable report body.",
        "createdAt": "2026-04-18T10:03:00.000Z"
      }
    ]
  }
}
```

## `thread_report`

`thread_report` is the handler-owned tool for requesting an intermediate update or conclusion
episode. The handler returns one pre-commit model-facing acknowledgement plus one ordered
`{ kind: "runtime_effect", request: { type: "episode.record", ... } }` operation item;
`@svvy/runtime` records the episode or conclusion through `@svvy/state` in the ordered runtime lane
and publishes typed notifications after commit.

Input shape:

```ts
type ThreadReportInput = {
  summary: string;
  details?: string;
  outcome?: "succeeded" | "failed" | "cancelled";
  relatedArtifactIds?: readonly ArtifactId[];
  relatedCommandIds?: readonly CommandId[];
};
```

Output shape:

```ts
type ThreadReportResult = {
  episodeId: EpisodeId;
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  objectiveState: "active" | "concluded";
  notificationQueuedItemId?: QueueItemId;
};
```

Rules:

- without `outcome`, it creates an intermediate update episode
- with `outcome`, it creates a conclusion episode and marks the current handler objective concluded
- referenced artifacts and commands must be durable and inspectable
- ordinary handler replies do not create episodes
- the handler returns one pre-commit model-facing acknowledgement plus one ordered
  `ExtensionRuntimeOperation` item wrapping the `episode.record` `RuntimeEffectRequest`
- `episode.record` carries the intermediate update or conclusion outcome; with `outcome`, runtime
  records the conclusion episode and marks the handler objective concluded in the same transaction
- `@svvy/runtime` applies the episode effect and publishes the typed queue notification
  the orchestrator reconciles

## Public API Boundary

The thread-control API surface is limited to the orchestrator and handler-thread tools defined in
this spec. The public thread API excludes:

- `thread_handoff`
- `thread_resume`
- single-objective `thread_start` inputs
- broad Smithers workflow/runtime control APIs; the narrow internal `runTaskAgent` bridge is not a
  thread tool
- CI workflow extension examples in thread APIs
