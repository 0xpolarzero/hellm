# Handler Context Packs Spec

## Status

- Date: 2026-04-24
- Status: adopted direction for optional handler context loading
- Scope of this document:
  - define typed handler context packs
  - define `thread.start({ context })`
  - define the handler-only `request_context` tool
  - define how context packs attach optional product knowledge to handler threads
  - define the first adopted context key, `ci`

## Purpose

Handler threads should not receive every specialized product instruction by default.

Specialized context is useful, but preloading it everywhere wastes context and teaches agents concepts they do not need for most work.

The adopted design is typed handler context packs.

A context pack is optional product knowledge loaded into a handler thread only when needed.

The first adopted context key is:

- `ci`

## Core Concepts

### Handler Execution

A handler thread runs through the normal delegated handler surface.

### Context Pack

A context pack describes optional product knowledge.

Examples:

- CI authoring rules
- CI saved-workflow layout
- CI result schema contract
- CI lifecycle examples

Context packs do not define model, reasoning, provider, or base tool surface.

Project CI uses:

- normal handler-thread execution
- plus the `ci` context pack

It does not need a Project CI-specific surface, launcher, or control tool.

## Context Registry

`svvy` owns a typed context registry.

Each context key should define:

- `key`
- `title`
- `summary`
- actor eligibility
- prompt content or prompt asset refs
- version

The first registry entry is:

```ts
{
  key: "ci",
  title: "Project CI",
  summary: "Guidance for configuring and modifying Project CI saved workflow entries.",
  allowedActors: ["handler"],
}
```

The orchestrator may know the available keys as lightweight routing facts.

The orchestrator does not receive the full context-pack content.

## Starting A Handler With Context

`thread.start` accepts optional context keys:

```ts
thread.start({
  objective: "Define Project CI checks for this repository",
  context: ["ci"],
});
```

Rules:

- `context` is optional.
- omitted `context` means no optional context pack is preloaded.
- context keys are validated against the registry.
- the context pack is loaded before the handler's first turn.
- loaded context keys are persisted on the handler thread.
- preloaded context keys do not change the handler surface's execution settings.

There is no separate `thread.start_ci` tool.

There is no CI-specific orchestrator.

## Requesting Context Later

Handler threads receive a top-level tool:

```ts
request_context({ keys: ["ci"] });
```

Rules:

- only handler threads receive this tool.
- the orchestrator does not receive this tool.
- workflow task agents do not receive this tool by default.
- `request_context` validates keys against the registry.
- `request_context` is idempotent per `threadId + key`.
- loaded keys are durable thread state.
- after loading, future handler turns include the requested context.

`request_context` is not part of `execute_typescript`.

It is a product/runtime context operation, not repository work.

## Why Not `execute_typescript.api.context`

`execute_typescript` is for bounded typed work inside the repository.

It can read files, write files, run commands, create artifacts, and inspect data.

Context loading changes what the handler agent knows in future reasoning.

That belongs at the top-level handler tool surface, alongside other product-control tools.

Putting it inside `execute_typescript` would hide a prompt-context mutation inside a repo-work command and make the lifecycle harder to inspect.

## Prompt Guidance

The default handler prompt should include only the compact registry-level facts.

For `ci`, the default handler should know:

```text
If Project CI only needs to be run, discover configured CI entries with smithers.list_workflows filtered to productKind "project-ci" and run one through smithers.run_workflow. If Project CI needs to be configured or modified, call request_context({ keys: ["ci"] }) before authoring CI assets.
```

The full CI authoring instructions live in the `ci` context pack.

## Durable State

Loaded context keys are part of handler-thread state.

The implementation should persist one row per loaded key:

- `thread_id`
- `context_key`
- `context_version`
- `loaded_by_command_id`
- `loaded_at`

The thread read model should expose loaded context keys so:

- resumed handlers keep their context
- UI can show which optional context is active
- duplicate `request_context` calls are idempotent

## Events

The event ledger should include:

- `context.loaded`

The event subject should be the handler thread.

The event payload should include the loaded key and version.

## Invariants

- Context packs are typed and registry-backed.
- Context packs are loaded only into eligible actor surfaces.
- `ci` is handler-only.
- The orchestrator may pass context keys to `thread.start`, but does not receive full context-pack content.
- `request_context` is top-level and handler-only.
- `request_context` is not available through `execute_typescript`.
- Handler context packs add optional product knowledge to an existing handler thread.
- Loading a context pack never changes historical transcript content.
- Loaded context keys are durable and idempotent.
