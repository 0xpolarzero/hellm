# Prompt Contexts Spec

## Status

- Date: 2026-05-06
- Status: adopted product contract
- Scope of this document:
  - define always-loaded prompt contexts
  - define optional prompt contexts
  - define `thread.start({ context })`
  - define the handler-only `request_context` tool
  - define the adopted context keys: `cx`, `smithers`, and `ci`

## Purpose

Prompt contexts keep specialized product knowledge modular while preserving one system-prompt channel per actor surface.

There are two load modes:

- always-loaded contexts, included in every eligible actor prompt
- optional contexts, loaded into a handler thread only when that handler needs specialized product knowledge

The adopted context keys are:

- `cx`
- `smithers`
- `ci`

## Context Registry

`svvy` owns a typed prompt context registry.

Each context key defines:

- `key`
- `title`
- `summary`
- `version`
- eligible actors
- load mode
- prompt content

Always-loaded context keys are part of prompt construction. They are not persisted as per-thread loaded keys.

Optional context keys are durable handler-thread state when loaded through `thread.start({ context })` or `request_context`.

## Always-Loaded Contexts

### `cx`

`cx` is the semantic code-navigation context.

Eligible actors:

- orchestrator
- handler
- workflow task agent

The `cx` context teaches the agent to prefer semantic navigation before raw file reads when the target language is supported:

```text
cx.overview -> cx.symbols -> cx.definition / cx.references -> read / grep / find / ls
```

The prompt includes the native tool names and the read-only `execute_typescript` subset:

- `cx.overview`
- `cx.symbols`
- `cx.definition`
- `cx.references`
- `cx.lang.list`
- `cx.lang.add`
- `cx.lang.remove`
- `cx.cache.path`
- `cx.cache.clean`
- `api.cx.overview`
- `api.cx.symbols`
- `api.cx.definition`
- `api.cx.references`
- `api.cx.lang.list`
- `api.cx.cache.path`

### `smithers`

`smithers` is the workflow-supervision context.

Eligible actors:

- orchestrator
- handler
- workflow task agent

The prompt content is actor-specific:

- orchestrator: compact routing knowledge that handler threads can supervise Smithers workflows
- handler: full workflow supervision guidance for `smithers.*` tools, workflow waits, approvals, resumptions, inspection, and handoff boundaries
- workflow task agent: task-agent boundary guidance that Smithers owns workflow lifecycle around the task

The orchestrator receives Smithers routing knowledge, not handler-callable `smithers.*` tool declarations.

Workflow task agents receive Smithers boundary knowledge, not `smithers.*` tools.

## Optional Contexts

### `ci`

`ci` is optional Project CI authoring context.

Eligible actors:

- handler

The `ci` context is loaded when a handler needs to configure or modify Project CI saved workflow assets. Running an existing Project CI entry only requires Smithers workflow discovery and launch tools.

Optional context metadata:

```ts
{
  key: "ci",
  title: "Project CI",
  summary: "Guidance for configuring and modifying Project CI saved workflow entries.",
  allowedActors: ["handler"],
}
```

## Starting A Handler With Optional Context

`thread.start` accepts optional context keys:

```ts
thread.start({
  objective: "Define Project CI checks for this repository",
  context: ["ci"],
});
```

Rules:

- `context` is optional.
- accepted keys are optional prompt context keys.
- the context keys are validated against the registry.
- the optional prompt context is loaded before the handler's first turn.
- loaded optional context keys are persisted on the handler thread.
- optional context keys do not change model, reasoning, provider, or base tool surface.

## Requesting Optional Context Later

Handler threads receive a top-level tool:

```ts
request_context({ keys: ["ci"] });
```

Rules:

- only handler threads receive this tool.
- the orchestrator does not receive this tool.
- workflow task agents do not receive this tool.
- `request_context` validates keys against the optional prompt context registry.
- `request_context` is idempotent per `threadId + key`.
- loaded keys are durable thread state.
- future handler turns include the requested optional prompt context.

`request_context` is not part of `execute_typescript`.

It changes future prompt context, so it stays on the top-level handler tool surface.

## Durable State

Loaded optional context keys are part of handler-thread state.

The implementation persists one row per loaded optional key:

- `thread_id`
- `context_key`
- `context_version`
- `loaded_by_command_id`
- `loaded_at`

The thread read model exposes loaded optional context keys so:

- resumed handlers keep requested context
- UI shows which optional context is active
- duplicate `request_context` calls are idempotent

Always-loaded context keys are visible through the resolved system prompt rather than per-thread loaded context state.

## Invariants

- Prompt contexts are registry-backed.
- `cx` is always loaded for orchestrator, handler, and workflow task-agent prompts.
- `smithers` is always loaded with actor-specific content.
- `ci` is optional and handler-only.
- The orchestrator may pass optional context keys to `thread.start`.
- `request_context` is top-level and handler-only.
- `request_context` is not available through `execute_typescript`.
- Loading optional prompt context never changes historical transcript content.
- Loaded optional context keys are durable and idempotent.
