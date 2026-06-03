# Thread Managing Spec

## Status

- Date: 2026-06-03
- Status: authoritative product spec for thread managing native controls
- Scope of this document:
  - define the shipped Thread Managing native control surface
  - define actor-specific exposure for thread control and inspection tools
  - define the current agent-facing API for `thread_start`, `thread_resume`,
    `thread_handoff`, `thread_current`, `thread_list`, and `thread_handoffs`

This spec owns the concrete API for thread managing tools. Higher-level specs should describe when
actors use these tools and refer here for input and output shapes.

Related specs:

- `docs/specs/extensions-and-tools.spec.md` defines the broader extension architecture and native
  tool model.
- `docs/specs/structured-session-state.spec.md` defines the durable session, thread, command, and
  episode records these tools read and write.
- `docs/specs/workflow-supervision.spec.md` defines Smithers workflow lifecycle behavior under
  handler threads.
- `docs/specs/queued-messages.spec.md` defines ordered surface-queue delivery used by
  `thread_resume`, initial handler starts, and handoff notifications.

## Product Role

Thread Managing is a shipped app-owned native control surface for delegated handler threads.

It is not:

- a separate manager agent
- a standalone custom runtime
- a Smithers workflow abstraction
- an `execute_typescript` helper family
- a prompt-only instruction extension

Thread Managing is the agent-facing surface for:

- opening a pi-backed handler thread
- re-engaging a completed handler thread for follow-up work in the same delegated context
- returning control from a handler thread to the orchestrator through durable handoff episodes
- reading delegated thread rows and handoff bodies without prompt-stuffing transcript history

## Default Usage State

Thread Managing is a shipped `native_tool` extension with actor-scoped tool exposure.

| Actor kind | State | Exposed tools |
| --- | --- | --- |
| Orchestrator | `default_loaded` | `thread_start`, `thread_resume`, `thread_list`, `thread_handoffs` |
| Handler thread | `default_loaded` | `thread_handoff`, `thread_current`, `thread_list`, `thread_handoffs` |
| Workflow task agent | `unavailable` | none |

The actor-specific tool split is part of the generated native tool declaration. A loaded Thread
Managing surface does not mean every actor receives every thread tool.

In the default adopted model:

- orchestrators can create and explicitly resume handler threads
- handlers can hand control back and inspect their current thread state
- orchestrators and handlers can inspect delegated thread rows and durable handoff bodies
- handlers do not receive `thread_start` unless nested delegation is explicitly adopted later
- workflow task agents receive no Thread Managing tools and should not be taught these unavailable
  controls in prompt prose

## Shared Types

```ts
type WorkspaceSessionId = string;
type SurfacePiSessionId = string;
type ThreadId = string;
type CommandId = string;
type EpisodeId = string;
type QueuedItemId = string;
type ISODateString = string;
type ExtensionId = string;

type ExtensionUsageState = "default_loaded" | "available" | "unavailable";

type ThreadStatus =
  | "idle"
  | "running-handler"
  | "running-workflow"
  | "waiting"
  | "troubleshooting"
  | "completed";

type ThreadWait = null | {
  owner: "handler" | "workflow";
  kind: "user" | "external" | "approval" | "signal" | "timer";
  reason: string;
  resumeWhen: string;
  since: ISODateString;
};

type ThreadAgentContextBinding = {
  actorKind: "handler-thread";
  selectedAgentProfileId: "threadHandler";
  loadedExtensionIds: ExtensionId[];
  availableExtensionIds: ExtensionId[];
  extensionContextFingerprints: Record<ExtensionId, string>;
  aggregateCacheKey: string;
  externalInstructionFingerprint: string | null;
  agentContextFingerprint: string;
  boundAt: ISODateString;
  overrides?: Partial<Record<ExtensionId, ExtensionUsageState>>;
};

type ThreadSummary = {
  threadId: ThreadId;
  parentThreadId: ThreadId | null;
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  status: ThreadStatus;
  wait: ThreadWait;
  agentContextBinding: ThreadAgentContextBinding;
  worktree?: string;
  activeWorkflowRunIds: string[];
  latestWorkflowRunIds: string[];
  latestHandoff: null | ThreadHandoffSummary;
  startedAt: ISODateString;
  updatedAt: ISODateString;
  finishedAt: ISODateString | null;
};

type ThreadHandoffSummary = {
  episodeId: EpisodeId;
  threadId: ThreadId;
  sourceCommandId: CommandId | null;
  title: string;
  summary: string;
  createdAt: ISODateString;
};

type ThreadHandoffEpisode = ThreadHandoffSummary & {
  body: string;
};
```

## `thread_start`

`thread_start` creates a new pi-backed handler thread for one delegated objective.

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
- the override is bound to the created handler thread and does not mutate the `threadHandler` profile
- the override is applied before the handler's first turn and before generated prompt, tools, `svvyx`
  guidance, TypeScript declarations, and fingerprints are created for that handler
- the handler's first turn starts from the raw `objective`; the user does not need to manually send
  a first handler-thread message
- handler-thread titles are derived by the configured namer from `objective`; the orchestrator does
  not supply a separate title field
- there is no legacy `context` field, `context: ["ci"]` alias, `thread_start_ci`, `ci.start`, or
  other product-specific handler-start variant
- `thread_start` extension overrides do not affect workflow task agents launched by workflows under
  that handler

Example:

```json
{
  "objective": "Configure Project CI for this repository",
  "extensions": {
    "project-ci": "default_loaded",
    "github": "available"
  }
}
```

Success result:

```ts
type ThreadStartResult = {
  ok: true;
  threadId: ThreadId;
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  agentContextBinding: ThreadAgentContextBinding;
};
```

Example:

```json
{
  "ok": true,
  "threadId": "thread_123",
  "surfacePiSessionId": "pi_thread_123",
  "title": "Configure Project CI",
  "objective": "Configure Project CI for this repository",
  "agentContextBinding": {
    "actorKind": "handler-thread",
    "selectedAgentProfileId": "threadHandler",
    "loadedExtensionIds": [
      "shell",
      "apply-patch",
      "execute-typescript",
      "extension-loading",
      "thread-managing",
      "cx",
      "smithers",
      "web",
      "git",
      "github",
      "external-instructions",
      "project-ci"
    ],
    "availableExtensionIds": ["extension-managing"],
    "extensionContextFingerprints": {},
    "aggregateCacheKey": "ctx_handler_abc",
    "externalInstructionFingerprint": "ext_123",
    "agentContextFingerprint": "agent_ctx_456",
    "boundAt": "2026-06-03T10:00:00.000Z",
    "overrides": {
      "project-ci": "default_loaded",
      "github": "available"
    }
  }
}
```

## `thread_resume`

`thread_resume` lets the orchestrator re-engage a completed handler thread when follow-up work
belongs in the same delegated context.

Input:

```ts
type ThreadResumeInput = {
  threadId: ThreadId;
  message: string;
};
```

Rules:

- `threadId` must name an existing handler thread in the current workspace session.
- `message` is required and becomes the next real user message for that handler surface.
- the target thread should normally be `completed`; ordinary direct user messages may still be sent
  inside a handler surface without using `thread_resume`
- `thread_resume` does not control or resume Smithers runs directly
- Smithers run inspection, repair, fresh launch, or exact run resume remains the handler thread's job
- delivery goes through the target handler surface queue and does not bypass the prompt lock
- a resumed work turn may move the thread from `completed` back to `running-handler`,
  `running-workflow`, `waiting`, or `troubleshooting`
- earlier handoff episodes remain durable history; the next successful `thread_handoff` creates a
  new ordered episode

Success result:

```ts
type ThreadResumeResult = {
  ok: true;
  threadId: ThreadId;
  surfacePiSessionId: SurfacePiSessionId;
  queuedItemId: QueuedItemId;
  status: "queued" | "dispatching";
};
```

Example:

```json
{
  "threadId": "thread_123",
  "message": "Now add the missing Project CI lint check using the same design."
}
```

## `thread_handoff`

`thread_handoff` is called by a handler thread when it returns control to the orchestrator.

Input:

```ts
type ThreadHandoffInput = {
  title: string;
  summary: string;
  body: string;
};
```

Rules:

- only handler-thread actors may call `thread_handoff`
- `title`, `summary`, and `body` describe the durable handoff episode
- ordinary replies inside the handler thread do not call `thread_handoff`
- `thread_handoff` may close only the current objective span
- if a running or waiting workflow run still belongs to the current span, `thread_handoff` must fail
  clearly instead of orphaning the run under a completed thread
- before failing for active workflow ownership, the runtime should reconcile thread-owned workflow
  state against Smithers durable run state so a just-finished run is not mistaken for an active one
- success means the durable handoff episode was recorded and the current objective span was marked
  completed
- after success, `svvy` schedules a typed `handler_handoff` item in the orchestrator surface queue
- cancelling or deleting that orchestrator queue item does not roll back the episode and does not
  return a tool error to the handler

Success result:

```ts
type ThreadHandoffResult = {
  ok: true;
  threadId: ThreadId;
  episode: ThreadHandoffEpisode;
  orchestratorQueuedItemId: QueuedItemId;
};
```

Example:

```json
{
  "title": "Project CI design ready",
  "summary": "Defined the Project CI workflow entry and check result schema.",
  "body": "The handler created the Project CI workflow assets, verified the launch schema, and left the workspace ready for implementation review."
}
```

## `thread_current`

`thread_current` reads the current handler thread's durable state.

Input:

```ts
type ThreadCurrentInput = {};
```

Rules:

- only handler-thread actors receive `thread_current` by default
- the current thread is implicit in the actor binding
- the tool reads durable structured state and active prompt runtime binding
- the tool does not create command records or write lifecycle facts
- workflow details stay in Smithers; handlers use active workflow run ids with `smithers_*` tools

Result:

```ts
type ThreadCurrentResult = {
  ok: true;
  thread: ThreadSummary;
};
```

## `thread_list`

`thread_list` lists delegated handler thread summaries visible from the current workspace session.

Input:

```ts
type ThreadListInput = {
  status?: ThreadStatus;
  threadId?: ThreadId;
  query?: string;
};
```

Rules:

- orchestrators and handler threads receive `thread_list` by default
- all filters are optional
- `status` filters by current handler-thread status
- `threadId` returns the matching thread summary when visible to the current workspace session
- `query` is a case-insensitive substring search over title, objective, and latest handoff summary
- transcript bodies, workflow summaries, and Smithers internals are not included
- detailed handoff bodies are read through `thread_handoffs`
- workflow details are read through Smithers-native tools by exact workflow run ids
- the tool reads durable structured state and does not create command records or write lifecycle facts

Result:

```ts
type ThreadListResult = {
  ok: true;
  threads: ThreadSummary[];
};
```

## `thread_handoffs`

`thread_handoffs` reads durable handoff episode bodies.

Input:

```ts
type ThreadHandoffsInput = {
  threadId?: ThreadId;
  episodeId?: EpisodeId;
  limit?: number;
};
```

Rules:

- orchestrators and handler threads receive `thread_handoffs` by default
- `threadId` filters to one handler thread
- `episodeId` returns one exact episode when visible to the current workspace session
- `limit` caps the newest returned episodes when no exact `episodeId` is supplied
- omitted `limit` uses the product default page size
- episodes are returned in chronological order after filtering and limiting
- the tool reads durable structured state and does not create command records or write lifecycle facts

Result:

```ts
type ThreadHandoffsResult = {
  ok: true;
  episodes: ThreadHandoffEpisode[];
};
```

## Command And Queue Facts

Write tools create normal command records:

- `thread_start`
- `thread_resume`
- `thread_handoff`

Read tools do not create command records:

- `thread_current`
- `thread_list`
- `thread_handoffs`

Visibility:

- `thread_start`, `thread_resume`, and `thread_handoff` are normally `surface` visibility commands
- thread read tools are state-inspection tools and should stay out of command history unless a later
  product decision explicitly records read commands

Queue behavior:

- `thread_start` creates the handler thread and enqueues or dispatches its `initial_handler_start`
  work on the new handler surface
- `thread_resume` enqueues or dispatches a `user_message` item on the target handler surface
- `thread_handoff` records the handoff episode first, then enqueues a `handler_handoff` notification
  on the orchestrator surface

## Rejected Shapes

These shapes are not part of the current API:

```ts
thread_start({ context: ["ci"] });
thread_start_ci(...);
ci.start(...);
thread_resume({ runId: "smithers_run_123" });
thread_handoff({ workflowRunId: "run_123" });
api.thread.start(...); // broad execute_typescript helper family
api.workflow.*;        // parallel svvy workflow abstraction
```

Workflow run launch and exact Smithers run resume use Smithers-native tools inside the handler
thread, especially `smithers_run_workflow({ workflowId, input, runId? })`.
