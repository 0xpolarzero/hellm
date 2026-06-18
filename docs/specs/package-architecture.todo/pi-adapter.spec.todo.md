# `@svvy/pi-adapter` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/pi-adapter`

## Purpose

`@svvy/pi-adapter` is the thin adapter that hosts pi sessions for `svvy` surfaces.

It translates `@svvy/runtime` requests into pi session operations and translates pi output into
`@svvy/core` runtime events. The package name is `pi-adapter`, not `pi-host`, because the important
architectural role is translation between `svvy` and pi. It may still own the minimal pi session
hosting setup required for that translation.

## Owns

- pi session creation, opening, lookup, and persistence handles.
- Loading actor instructions through pi's real `systemPrompt` channel.
- Sending real user messages to pi surfaces.
- Passing runtime-provided tool declarations into pi as custom tools.
- Streaming assistant text, thinking, tool-call argument output, user-message commits, and
  assistant-message completion from pi.
- Mapping pi tool-call events into `@svvy/core` event shapes consumable by `@svvy/runtime`.
- pi transcript/history adapter behavior.
- Provider/model/reasoning metadata normalization when pi is the source of that metadata.
- pi-specific error normalization.
- Runtime-requested helper model jobs such as title generation when those jobs run through pi.
- Explicit disabling of ambient pi resources that runtime did not pass as enabled.

## Does Not Own

- Product strategy.
- Generated actor context composition.
- Extension usage policy.
- Queue claiming, queue ordering, retries, or delivery.
- Handler-thread lifecycle or orchestrator reconciliation.
- Tool execution semantics beyond invoking runtime-provided custom tool callbacks.
- Command lifecycle persistence.
- Sandbox policy.
- Approval decisions.
- UI rendering.
- Smithers, Workflows, or builtin extension semantics.
- Prompt or instruction source files.

## Public API Shape

Expected surface:

```ts
import { createPiAdapter } from "@svvy/pi-adapter";

const pi = createPiAdapter({ providers, auth });

const session = await pi.sessions.create({
  actorKind: "orchestrator",
  systemPrompt,
  tools,
});

for await (const event of pi.turns.run({
  sessionId: session.sessionId,
  userMessage: {
    text: "Fix the transcript projection.",
  },
})) {
  runtime.handlePiEvent(event);
}
```

API groups:

- `sessions`
- `turns`
- `providers`
- `models`
- `helperJobs`
- `errors`

## Adapter Rules

- Must use pi's real `systemPrompt` channel.
- Must not flatten prior messages into role-labelled transcript prose to repair or advance a
  surface.
- Must send the submitted prompt body as the real new pi user message for that surface.
- Must not load ambient pi tools, extensions, skills, prompt templates, themes, commands, hooks,
  provider adapters, credentials, execution-policy settings, or equivalent host resources unless
  runtime passes an explicitly enabled surface binding.
- Must pass only the runtime-provided tool declarations for the addressed actor surface.
- Must hide pi-specific event details behind `@svvy/core` event shapes before those events leave the
  adapter package.
- Must keep pi transcript/history as pi-owned state; runtime, thread, episode, queue, command,
  request-input, approval, workflow task-attempt, and artifact facts stay in `@svvy/state`.

## Dependency Rules

- Depends on `@svvy/core`.
- Receives provider auth, model metadata, and persisted session-reference access through explicit
  ports supplied by runtime composition.
- Depends on pi packages.
- Must not depend on `@svvy/runtime`, `@svvy/extensions`, `@svvy/desktop`, Smithers, Svelte,
  Electrobun, or UI packages.

## Migration Sources

Initial extraction candidates:

- pi session creation paths in `src/bun/session-catalog.ts`
- provider/model metadata handling
- prompt execution context adapters
- title/namer model execution seams
- pi `DefaultResourceLoader` configuration that disables ambient host resources

## Tests

- Fake pi adapter tests.
- System prompt channel tests.
- Provider/model metadata normalization tests.
- Ambient pi resources disabled-by-default tests.
- Tool declaration slicing tests.
- Tests proving `@svvy/pi-adapter` can run without desktop UI.
