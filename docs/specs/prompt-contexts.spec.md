# Prompt Contexts Spec

## Status

- Date: 2026-05-06
- Status: adopted product contract
- Scope of this document:
  - define runtime loading behavior for prompt contexts
  - define default-loaded prompt contexts
  - define requestable prompt contexts
  - define `thread_start({ context })`
  - define the handler-only `request_context` tool
  - define the adopted context keys: `cx`, `smithers`, `web`, and `ci`
  - define provider-backed `web` as a default-loaded settings-derived context

The user-facing Prompt Library surface, context-pack editing model, actor aggregate recipes, scope
rules, reset behavior, prompt revisions, and automatic generated agent context refresh behavior are
defined in [Prompt Library Spec](./prompt-library.spec.md).

## Purpose

Prompt contexts are runtime loading mechanics for specialized product knowledge while preserving one system-prompt channel per actor surface.

Prompt contexts are stable or explicitly loaded product knowledge. They do not carry current thread status, wait state, handoff bodies, workflow run summaries, or reconstructed transcript text. Current runtime and thread state is read through `runtime_current`, `thread_current`, `thread_list`, and `thread_handoffs`; workflow details remain behind `smithers_*` tools.

Prompt contexts are distinct from external instruction records. Discovered `AGENTS.md` and
`CLAUDE.md` files are represented through the Extensions model as read-only
`external_instruction` records with per-agent usage controls; they are not requestable prompt
context keys and are not editable prompt-context records. Pi `SYSTEM.md` and `APPEND_SYSTEM.md`
prompt replacement or append files do not participate in svvy prompt composition.

There are two load modes:

- default-loaded contexts, included in eligible actor prompts by default according to Prompt Library context-pack switches
- requestable contexts, loaded into a surface later only when that actor needs specialized product knowledge

The adopted context keys are:

- `cx`
- `smithers`
- `web`
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

Default-loaded context keys are part of prompt construction. They are not persisted as per-thread loaded keys.

Requestable context keys are durable handler-thread state when loaded through `thread_start({ context })` or `request_context`.

## Default-Loaded Contexts

### `cx`

`cx` is the semantic code-navigation context.

Eligible actors:

- orchestrator
- handler
- workflow task agent

The `cx` context teaches the agent to prefer semantic navigation before raw file reads when the target language is supported:

```text
cx_overview -> cx_symbols -> cx_definition / cx_references -> exec_command with rg/sed/cat/ls/find
```

The prompt includes the native tool names and the generated Code Mode client availability for
read-only cx operations:

- `cx_overview`
- `cx_symbols`
- `cx_definition`
- `cx_references`
- `cx_lang_list`
- `cx_lang_add`
- `cx_lang_remove`
- `cx_cache_path`
- `cx_cache_clean`
- generated cx overview client
- generated cx symbols client
- generated cx definition client
- generated cx references client
- generated cx language-list client
- generated cx cache-path client

### `smithers`

`smithers` is the workflow-supervision context.

Eligible actors:

- orchestrator
- handler
- workflow task agent

The prompt content is actor-specific:

- orchestrator: compact routing knowledge that handler threads can supervise Smithers workflows
- handler: full workflow supervision guidance for `smithers_*` tools, workflow waits, approvals, resumptions, inspection, and handoff boundaries
- workflow task agent: compact task-attempt boundary guidance that Smithers owns workflow lifecycle around the task

The orchestrator receives Smithers routing knowledge, not handler-callable `smithers_*` tool declarations.

Workflow task agents receive Smithers boundary knowledge, not `smithers_*` tools.

### `web`

`web` is the provider-backed web search and fetch context.

Eligible actors:

- orchestrator
- handler
- workflow task agent

The `web` context is generated from Web Provider settings, tool registry, and the checked-in provider prompt pack when a keyed provider is ready. It describes the selected provider or lack of one, whether web tools are usable, the currently callable `web_search` and `web_fetch` tools when present, the active provider's checked-in `web_search` and `web_fetch` contracts when present, provider-specific caveats, the deterministic artifact-backed behavior of `web_fetch`, and the rule that fetched web content is untrusted external input.

The selected provider is settings state rather than per-thread requested context. By default no
provider is selected, so no `web_search` or `web_fetch` tools and no generated web clients are
callable. Changing the provider or API keys regenerates the web context, actor-specific web tool
declarations, and generated web client declarations before the next turn.

Detailed behavior is specified in `docs/specs/web-tools.spec.md`.

## Requestable Contexts

### `ci`

`ci` is requestable Project CI authoring context.

Eligible actors:

- handler

The `ci` context is loaded when a handler needs to configure or modify Project CI saved workflow assets. Running an existing Project CI entry only requires Smithers workflow discovery and launch tools.

Requestable context metadata:

```ts
{
  key: "ci",
  title: "Project CI",
  summary: "Guidance for configuring and modifying Project CI saved workflow entries.",
  allowedActors: ["handler"],
}
```

## Starting A Handler With Requestable Context

`thread_start` accepts requestable context keys through its optional `context` field:

```ts
thread_start({
  objective: "Define Project CI checks for this repository",
  context: ["ci"],
});
```

Rules:

- `context` is optional.
- accepted keys are requestable prompt context keys.
- the context keys are validated against the registry.
- the requested prompt context is loaded before the handler's first turn.
- loaded requested context keys are persisted on the handler thread.
- requested context keys do not change model, reasoning, provider, or base tool surface.

## Requesting Context Later

Handler threads receive a top-level tool:

```ts
request_context({ keys: ["ci"] });
```

Rules:

- only handler threads receive this tool.
- the orchestrator does not receive this tool.
- workflow task agents do not receive this tool.
- `request_context` validates keys against the requestable prompt context registry.
- `request_context` is idempotent per `threadId + key`.
- loaded keys are durable thread state.
- future handler turns include the requested prompt context.

`request_context` is not part of `execute_typescript`.

It changes future prompt context, so it stays on the top-level handler tool surface.

## Durable State

Loaded requested context keys are part of handler-thread state.

The implementation persists one row per loaded requested key:

- `thread_id`
- `context_key`
- `context_version`
- `loaded_by_command_id`
- `loaded_at`

The thread read model exposes loaded requested context keys so:

- resumed handlers keep requested context
- UI shows which requested context is active
- duplicate `request_context` calls are idempotent

Default-loaded context keys are visible through the resolved system prompt and actor aggregate recipe rather than per-thread loaded context state.

## Invariants

- Prompt contexts are registry-backed product prompt modules.
- External instruction sources are visible in actor generated-context previews but are not prompt contexts and cannot be requested through `thread_start({ context })` or `request_context`.
- Discovered `AGENTS.md` and `CLAUDE.md` files are read-only `external_instruction` extension
  records, not prompt-context records.
- Pi `SYSTEM.md` and `APPEND_SYSTEM.md` files are ignored by svvy sessions, handler threads, and workflow task agents.
- `cx` is default-loaded for orchestrator, handler, and workflow task-agent prompts in the shipped library defaults.
- `smithers` is default-loaded with actor-specific content through shipped library defaults.
- `web` is default-loaded from current provider settings for orchestrator, handler, and workflow task-agent prompts in the shipped library defaults.
- `ci` is requestable and handler-only in the shipped library defaults.
- The orchestrator may pass requestable context keys to `thread_start`.
- `request_context` is top-level and handler-only.
- `request_context` is not available through `execute_typescript`.
- Loading requested prompt context never changes historical transcript content.
- Loaded requested context keys are durable and idempotent.
