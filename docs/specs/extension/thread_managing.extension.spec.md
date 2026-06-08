# Thread Managing Extension Spec

## Status

- Date: 2026-06-08
- Status: adopted direction

## Scope

This spec defines the native thread-control surfaces for orchestrators and handler threads.

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

Handlers do not receive `thread_start` unless a future product decision adopts nested delegation.

## `thread_start`

`thread_start` creates or appends to a durable thread group.

Input shape:

```ts
type ThreadStartInput = {
  threadGroupId?: string;
  threads: Array<{
    objective: string;
    history?: "isolated" | "forked";
    extensions?: Record<string, "default_loaded" | "available" | "unavailable">;
  }>;
};
```

Rules:

- `threads` is required and normally has one item.
- `history` defaults to `isolated`.
- Use `forked` only when conversational continuity is explicitly requested or materially necessary.
- Multiple items are for separate user-visible handler conversations, not ordinary internal
  parallelism.
- Extension overrides are partial overrides over the `threadHandler` profile.

Output shape:

```ts
type ThreadStartResult = {
  threadGroupId: string;
  threads: Array<{
    threadId: string;
    surfacePiSessionId: string;
    objective: string;
    objectiveState: "active";
  }>;
};
```

## `thread_followup`

`thread_followup` queues follow-up work for exact thread ids or one thread group.

Input shape:

```ts
type ThreadFollowupInput = {
  threadIds?: string[];
  threadGroupId?: string;
  message: string;
  activate?: boolean;
};
```

`activate: true` reactivates concluded handler objectives in the same delegated context. Active
targets keep their current objective.

## `thread_request_report`

`thread_request_report` asks one handler thread for an explicit update episode without changing the
handler objective.

The request is delivered through the handler surface queue. The handler responds with
`thread_report`.

## `thread_current`

`thread_current` returns the current handler identity and objective context:

- thread id
- thread group id
- workspace session id
- surface pi session id
- title
- objective
- objective state
- loaded and available extension ids
- pending report requests
- latest episode summary

It does not return transcripts, Smithers internals, or command logs.

## `thread_group`

`thread_group` returns the current thread group and sibling objective summaries.

Thread groups are topology and addressing. They are not shared memory and not peer messaging.

## `thread_episodes`

`thread_episodes` reads durable episodes by exact thread id or thread group id.

It does not synthesize episodes from ordinary replies, command summaries, artifacts, or transcripts.

## `thread_report`

`thread_report` is the only handler-owned way to emit update or conclusion episodes.

Input shape:

```ts
type ThreadReportInput = {
  summary: string;
  details?: string;
  outcome?: "succeeded" | "failed" | "cancelled";
  relatedArtifactIds?: string[];
  relatedCommandIds?: string[];
};
```

Rules:

- without `outcome`, it creates an intermediate update episode
- with `outcome`, it creates a conclusion episode and marks the current handler objective concluded
- referenced artifacts and commands must be durable and inspectable
- ordinary handler replies do not create episodes
- the orchestrator reconciles reports through a typed queue notification

## Rejected Shapes

The current design rejects:

- `thread_handoff`
- `thread_resume`
- single-objective `thread_start` inputs
- Smithers bridge tools in thread APIs
- CI workflow extension examples in thread APIs
