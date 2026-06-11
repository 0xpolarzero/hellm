# `@svvy/runtime` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/runtime`

## Purpose

`@svvy/runtime` is the reusable orchestration kernel.

It coordinates the shared execution model:

```text
message -> target surface -> turn -> tool call -> command -> handler -> events -> structured state -> UI
```

It is the package another app imports when it wants `svvy` behavior without the desktop UI.

## Owns

- Workspace runtime lifecycle.
- Default workspace runtime behavior.
- Workspace/session/surface creation and activation.
- Worktree context alignment with sessions and surfaces.
- Prompt-bearing turn execution.
- Queue claiming, delivery ordering, retries, and delivery.
- Follow-up messages and active steer requests.
- Safe pause/resume boundaries.
- Generated agent context refresh scheduling.
- Workflows generated-package build/link refresh scheduling and recovery orchestration.
- Runtime routing of model tool calls to extension handlers.
- Handler-thread surface lifecycle and orchestrator reconciliation delivery.
- Request-input answer queue delivery through the owning surface.
- Durable title-generation scheduling, recovery, concurrency, manual-rename blocking, and freeze
  rules.
- Runtime event stream for UIs and automation consumers.
- Recovery orchestration after app restart.

## Does Not Own

- Durable storage implementation.
- pi internals.
- Extension catalog definitions.
- Sandbox policy semantics.
- Desktop UI rendering.
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

await runtime.openWorkspace({ path });
await runtime.sendMessage({ surfaceId, text });

for await (const event of runtime.events()) {
  render(event);
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

## Dependency Rules

- Depends on `@svvy/contracts`.
- Depends on `@svvy/state`.
- Depends on `@svvy/sandbox`.
- Depends on `@svvy/pi-host`.
- Depends on `@svvy/extensions`.
- Must not depend on `@svvy/desktop`.

## Migration Sources

Initial extraction candidates:

- `src/bun/session-catalog.ts`
- workspace runtime registry modules under `src/bun`
- prompt execution context modules under `src/bun`
- runtime queue and recovery paths under `src/bun`
- title generation/namer logic under `src/bun`

## Tests

- Runtime tests with fake pi and fake extensions.
- Workspace/default workspace recovery tests.
- Queue ordering and recovery tests.
- Handler-thread lifecycle tests.
- Prompt refresh scheduling tests.
- Request-input delivery tests.
- Title-generation scheduling/recovery tests.
- Tests proving runtime can be used without Electrobun/Svelte.
