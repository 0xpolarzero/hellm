# `@svvy/pi-host` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/pi-host`

## Purpose

`@svvy/pi-host` is the thin adapter around pi.

It translates runtime requests into pi session operations and translates pi output into `svvy`
runtime events.

## Owns

- pi session creation and lookup.
- Loading actor instructions through pi's real `systemPrompt` channel.
- Sending real user messages to pi surfaces.
- Streaming assistant and tool-call output from pi.
- Mapping pi tool-call events into runtime-consumable events.
- pi transcript/history adapter behavior.
- Provider/model/reasoning metadata normalization when pi is the source.
- pi-specific error normalization.
- Runtime-requested helper model jobs such as title generation.

## Does Not Own

- Product strategy.
- Generated actor context composition.
- Extension usage policy.
- Queue claiming.
- Handler-thread lifecycle.
- Tool execution.
- Sandbox policy.
- UI rendering.
- Smithers, Workflows, or builtin extension semantics.

## Public API Shape

Expected surface:

```ts
import { createPiHost } from "@svvy/pi-host";

const pi = createPiHost({ providers, auth });

const session = await pi.createSession({ actorKind, systemPrompt, tools });

for await (const event of pi.runTurn({ sessionId, userMessage })) {
  yield event;
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
- Must not flatten prior messages into role-labelled transcript prose to repair sessions.
- Must not load ambient pi tools, skills, prompts, themes, commands, hooks, provider adapters, or
  equivalent host resources unless runtime passes an explicitly enabled surface.
- Must hide pi-specific event details behind `@svvy/contracts` event shapes.

## Dependency Rules

- Depends on `@svvy/contracts`.
- Receives provider auth, model metadata, and persisted session-reference access through explicit
  ports supplied by runtime composition.
- Depends on pi packages.
- Must not depend on `@svvy/runtime`, `@svvy/extensions`, `@svvy/desktop`, Smithers, Svelte, or
  Electrobun.

## Migration Sources

Initial extraction candidates:

- pi session creation paths in `src/bun/session-catalog.ts`
- provider/model metadata handling
- prompt execution context adapters
- title/namer model execution seams

## Tests

- Fake pi adapter tests.
- System prompt channel tests.
- Provider/model metadata normalization tests.
- Tests proving pi-host can run without desktop UI.
