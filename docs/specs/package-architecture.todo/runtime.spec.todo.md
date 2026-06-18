# `@svvy/runtime` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/runtime`

## Purpose

`@svvy/runtime` is the reusable orchestration kernel.

It coordinates the shared execution model:

```text
message -> target surface -> queue -> turn -> tool call -> command -> handler -> events -> structured state -> UI
```

It is the package another app imports when it wants `svvy` behavior without the desktop UI.

## Owns

- Workspace runtime lifecycle.
- Default workspace runtime behavior.
- Workspace/session/surface creation and activation.
- Live surface runtime keyed by `surfacePiSessionId`.
- Prompt lock, active stream, pending user message, retain count, and current turn context for
  opened surfaces.
- Worktree context alignment with sessions and surfaces.
- Prompt-bearing turn execution.
- Queue claiming, delivery ordering, retries, recovery, and delivery.
- Queue delivery semantics for all queue item kinds.
- Follow-up messages and active steer requests.
- Safe pause/resume boundaries.
- Generated agent context refresh scheduling.
- Workflows generated-package build/link refresh scheduling and recovery orchestration.
- Runtime routing of model tool calls to extension handlers.
- Streamed tool-call lifecycle coordination.
- Handler-thread surface lifecycle and orchestrator reconciliation delivery.
- Request-input answer queue delivery through the owning surface.
- Durable title-generation scheduling, recovery, concurrency, manual-rename blocking, and freeze
  rules.
- Runtime event stream for UIs and automation consumers.
- Recovery orchestration after app restart.
- Redaction enforcement before data is persisted or emitted when extension handlers provide
  redaction hooks.

## Does Not Own

- Durable storage implementation.
- pi internals or pi transcript storage.
- Extension catalog definitions.
- Prompt or instruction source files.
- Sandbox policy semantics.
- Desktop UI rendering.
- Renderer-owned `Agent` state, Dockview pane focus, or panel bindings.
- Smithers workflow execution wrappers.
- Separate public packages for builtin extension subdomains.

## Public API Shape

Expected surface:

```ts
import { createRuntime } from "@svvy/runtime";

const runtime = createRuntime({
  state: state.runtimeStatePort(),
  sandbox,
  pi,
  extensions,
});

await runtime.workspaces.open({ path });

await runtime.messages.submit({
  target: {
    workspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId,
  },
  message: {
    text: "Refactor the transcript projection and report risks.",
  },
  delivery: "enqueue-and-run",
});

for await (const event of runtime.events()) {
  consume(event);
}
```

API groups:

- `workspaces`
- `sessions`
- `surfaces`
- `messages`
- `turns`
- `queues`
- `commands`
- `threads`
- `requests`
- `titles`
- `recovery`
- `events`

## Runtime Message API

The programmatic message API is the primary seam for UI, tests, headless automation, and alternate
apps. It replaces the current renderer-shaped prompt RPC as the future package boundary.

```ts
type RuntimeMessagesApi = {
  submit(input: SubmitMessageInput): Promise<SubmitMessageResult>;
  abort(input: { target: PromptTarget; reason?: string }): Promise<void>;
};

type RuntimeQueuesApi = {
  steer(input: SteerQueuedMessageInput): Promise<void>;
};
```

`SubmitMessageInput`, `SubmitMessageResult`, and `PromptTarget` are defined in `@svvy/core`.

Rules:

- Callers submit only the new user message, delivery intent, addressed target, and optional client
  submission metadata.
- Callers must not submit full pi message arrays.
- Callers must not submit `systemPrompt`, generated-context previews, generated prompt fingerprints,
  loaded extension ids, or available extension ids.
- Runtime reads the managed surface, bound generated-context record, model/provider/reasoning
  selection, queue state, prompt freshness state, and extension usage from `@svvy/state`.
- Runtime refreshes generated context at the safe pre-dispatch boundary when required.
- Runtime sends the new prompt body as the real pi user message through `@svvy/pi-adapter`.
- Runtime preserves committed conversation history in pi session history and durable product facts in
  `@svvy/state`.
- Runtime adapters may continue accepting legacy desktop RPC payloads during migration, but the
  public package API must be the new-message contract above.
- Steering is a queue operation over an existing queued row, not a `submit(...)` delivery mode and
  not a direct pi current-turn fast path.

Example input:

```ts
await runtime.messages.submit({
  target: {
    workspaceSessionId: "wsess_01" as WorkspaceSessionId,
    surface: "handler",
    surfacePiSessionId: "pi_handler_7" as SurfacePiSessionId,
    threadId: "thread_7" as ThreadId,
  },
  message: {
    text: "The failing test is `transcript-projection.test.ts`; inspect and report the contract issue.",
  },
  delivery: "enqueue-and-run",
  clientSubmission: {
    correlationId: "debug-run-17",
    source: "headless",
  },
});
```

Example result:

```json
{
  "queuedMessageId": "queue_17",
  "turnId": "turn_44",
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "handler",
    "surfacePiSessionId": "pi_handler_7",
    "threadId": "thread_7"
  },
  "status": "running"
}
```

## Runtime Event API

Runtime exposes one typed event stream:

```ts
type RuntimeEventsApi = {
  events(input?: {
    workspaceId?: WorkspaceId;
    signal?: AbortSignal;
  }): AsyncIterable<RuntimeEvent>;
};
```

`RuntimeEvent` is defined in `@svvy/core`.

Runtime events are notifications, not the durable state source. A consumer that needs current
surface, command, inspector, session-navigation, request-input, approval, app-log, generated
package, Agents, Extensions, Snippets, or Settings data must fetch a read model from `@svvy/state`.

Event/read-model pattern:

```ts
for await (const event of runtime.events({ workspaceId })) {
  if (event.type === "surface.stream") {
    transcript.applyPatch(event.target, event.patch);
  }

  if (event.type === "workspace_read_model.changed" && event.model === "commandInspector") {
    const inspector = await state.readModels.commandInspector({
      commandId: event.ids![0] as CommandId,
    });
    renderInspector(inspector);
  }
}
```

Runtime must not emit renderer-only `ConversationSurfaceSnapshot` objects as its core package event
contract. Desktop may have an adapter that converts runtime events plus state read models into
renderer-friendly snapshots.

## Prompt Execution Context

Runtime constructs the extension invocation context for every prompt-bearing item from durable target
and surface state. Extensions receive this context through runtime-owned tool invocation ports; they
must not depend on `WorkspaceSessionCatalog` internals.

The context carries:

- workspace session id
- turn id, except workflow task-agent attempts that use workflow task-attempt identity
- workflow run id and workflow task-attempt id when relevant
- surface pi session id
- surface thread id when relevant
- surface kind: `orchestrator`, `handler`, or `workflow-task`
- root thread id when work is nested under a handler objective
- prompt text being delivered
- default episode kind
- root episode kind
- wait-state flags
- loaded and available extension ids
- external instruction source summaries
- bound system prompt and generated-context fingerprint
- queue item id when the prompt was delivered from a durable queue row

This context is runtime-owned. `@svvy/core` may define the public shape when it is passed across
package boundaries, while `@svvy/runtime` owns construction and lifecycle.

Construction rules:

- `surfaceKind` defaults to `orchestrator`.
- Handler contexts require a handler thread id.
- Workflow task-agent contexts require a workflow task-attempt id.
- Non-workflow-task contexts require a turn id.
- `surfaceThreadId` defaults from `rootThreadId` when omitted.
- `rootThreadId` defaults from the resolved `surfaceThreadId`.
- `defaultEpisodeKind` defaults from `rootEpisodeKind`, then to `"change"`.
- `turnId` is `null` only for workflow task-agent attempt execution.
- `sessionWaitApplied` starts as `false`.
- `threadWasTerminalAtStart` starts as `false` unless runtime has read a terminal thread state.
- `loadedExtensionIds`, `availableExtensionIds`, and `externalInstructionSources` default to empty
  arrays.
- `queuedMessageId` defaults to `null`.

## Queue Delivery

Surface queues are keyed by `surfacePiSessionId`. State persists rows transactionally; runtime owns
claiming, ordering, retries, recovery, and delivery.

Queue item kinds are:

- `user_message`
- `initial_handler_start`
- `thread_followup`
- `report_request`
- `thread_report_notification`
- `request_user_input_answer`

Runtime drains queued items into real pi user-message deliveries. Some queue kinds use
runtime-authored prompt text rather than user-authored text:

- `initial_handler_start` delivers the handler objective and any allowed inherited-history block.
- `thread_followup` delivers an orchestrator or user correction/follow-up to the handler surface.
- `report_request` asks a handler to call `thread_report`.
- `thread_report_notification` notifies the orchestrator that a handler emitted an update or
  conclusion episode.
- `request_user_input_answer` delivers the selected or custom answer back to the owning surface.

Queue delivery must be idempotent, recoverable after restart, and scoped to the addressed
`surfacePiSessionId`.

## Streamed Tool Lifecycle

Runtime preserves the current two-phase command projection:

1. When pi streams a tool call, runtime creates or updates a command record keyed by `toolCallId` and
   records streamed argument snapshots before runtime execution starts.
2. When pi accepts the completed call and execution starts, runtime reuses the same command record
   when one exists, starts execution, and records accepted arguments and runtime events.
3. If the prompt ends before execution starts, runtime terminalizes dangling streamed commands as
   failed or cancelled.
4. Terminal command facts are immutable after `succeeded`, `failed`, or `cancelled`.

Specialized tools may create their own surface-visible command records through extension handlers,
but the decision about which tools are specialized must come from `@svvy/extensions` metadata rather
than duplicated hard-coded lists in runtime trackers.

## Runtime Rules

- One strategic brain: the orchestrator owns strategy and final decisions.
- Handler threads are delegated conversation surfaces, not raw worker processes.
- Runtime never delegates directly to raw Smithers runs.
- Runtime routes model tool calls through `@svvy/extensions`.
- Native control tools remain explicit extension tools.
- Tool cards render from streamed tool-call intent and settle from authoritative command facts.
- Smithers execution remains Shell `exec_command` work chosen by agents in handler threads.
- Runtime does not invent `workflow.*` APIs.
- Runtime does not own Workflows extension guidance or Smithers extension guidance.
- Runtime applies typed effects returned by extension handlers. Extension handlers validate inputs
  and describe requested work; runtime schedules turns, creates surfaces, inserts queue messages,
  and performs delivery.
- State persists queue rows transactionally, but runtime owns claim policy, delivery ordering,
  retry policy, and recovery behavior.
- Runtime keeps worktree context aligned across surfaces, handler threads, Shell/Smithers command
  cwd, and default workspace behavior.
- Runtime never reconstructs lifecycle by parsing transcript prose.
- Runtime records streamed tool-call argument snapshots before runtime execution and settles command
  spans from immutable terminal command facts.
- Runtime does not treat UI panel focus or Dockview binding as part of prompt dispatch.

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on `@svvy/state`.
- Depends on `@svvy/sandbox`.
- Depends on `@svvy/pi-adapter`.
- Depends on `@svvy/extensions`.
- Must not depend on `@svvy/desktop`.

## Migration Sources

Initial extraction candidates:

- `src/bun/session-catalog.ts`
- workspace runtime registry modules under `src/bun`
- prompt execution context modules under `src/bun`
- runtime queue and recovery paths under `src/bun`
- title generation/namer logic under `src/bun`
- streaming and tool execution command trackers under `src/bun`

## Tests

- Runtime tests with fake pi and fake extensions.
- Runtime event stream contract tests.
- Runtime message submission tests proving public API does not accept full messages or system
  prompts.
- Workspace/default workspace recovery tests.
- Queue ordering, idempotency, and recovery tests for every queue item kind.
- Handler-thread lifecycle tests.
- Prompt refresh scheduling tests.
- Streamed tool lifecycle tests for argument snapshots, execution reuse, dangling command
  terminalization, and immutable terminal facts.
- Request-input delivery tests.
- Title-generation scheduling/recovery tests.
- Tests proving runtime can be used without Electrobun/Svelte.
