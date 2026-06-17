# Source Invalidation And File-Backed State Spec

## Status

- Date: 2026-06-12
- Status: authoritative product spec

## Scope

This spec defines how `svvy` observes file-backed source inputs and refreshes derived product state.
It covers app-global source libraries, workspace-visible prompt inputs, snippets, extension source,
agent settings, and the renderer read models derived from those inputs.

## Core Model

File-system events are invalidation hints only. They are never treated as authoritative state.

The backend owns one source invalidation coordinator that:

- watches source inputs from Bun, not from renderer panes
- coalesces raw events with a short debounce
- periodically reconciles source fingerprints as a backstop for missed watcher events
- fingerprints deterministic source inputs by path and file content
- emits domain-level invalidations only when a fingerprint changes
- rebuilds or rereads the smallest affected read models and generated artifacts
- publishes backend-authoritative cache updates and app logs for renderer consumers

Renderer panes do not watch files and do not infer source freshness. They subscribe to backend
read-model updates.

Editable file-backed panes additionally use edit-session conflict control. Each editable snapshot
includes the source version it was loaded from, and each save is a compare-and-swap against the
current backend file version. If the source changed outside the editor after the draft's base
version, the save is rejected as a conflict, the local dirty draft remains mounted, and the editor
stops autosaving that draft until the user explicitly chooses to keep editing, discard the local
draft, or overwrite the external source.

## Watched Source Domains

### Agent Settings

Source:

```text
~/.config/svvy/pi/agent-settings.json
```

Invalidation refreshes app-global agent settings, app preferences, model choices when settings can
affect them, extension inventory, generated agent context previews, and open-surface prompt
bindings.

### Workflows Source

Sources:

```text
~/.config/svvy/workflows/agents/*.agent.json
~/.config/svvy/workflows/prompts/**
~/.config/svvy/workflows/components/**
~/.config/svvy/workflows/workflows/**
```

Invalidation rereads workflow-agent parameter records, validates source, rebuilds
`@svvy/extensions` when required, rebuilds `@svvy/workflows`, refreshes workspace `.smithers`
links, refreshes the Workflows pane read model, refreshes Agents pane workflow-agent rows, and
queues open-surface generated-context refresh work when prompt bindings are affected.

### Extensions Source

Sources:

```text
~/.config/svvy/extensions/sources/user/**
~/.config/svvy/extensions/sources/builtin/**
~/.config/svvy/extensions/package/package.json
```

Invalidation refreshes extension inventory readiness, rebuilds extension-generated outputs through
the same build pipeline used by explicit `svvyx extensions` and `svvyx workflows build` commands,
refreshes generated TypeScript client declarations, refreshes Workflows validation when workflow
agents reference generated extension exports, and queues generated-context refresh work for affected
open surfaces.

### External Instructions

Sources:

```text
<workspace ancestor>/AGENTS.md
<workspace ancestor>/CLAUDE.md
<configured global root>/AGENTS.md
<configured global root>/CLAUDE.md
```

Invalidation rediscoveres readable/unreadable external instruction records, refreshes their
Extensions inventory rows, recomputes external instruction fingerprints, refreshes generated
context previews, and queues generated-context refresh work for affected open surfaces.

### Snippets

Sources:

```text
<workspace session dir>/snippets.json
~/.claude/commands/**/*.md
<workspace>/.claude/commands/**/*.md
~/.pi/agent/prompts/*.md
<workspace>/.pi/prompts/*.md
```

Invalidation refreshes the Snippets pane and composer snippet picker read model. Snippets do not
change generated agent context or grant capabilities.

## Non-Source Outputs

Generated outputs are never watched as triggers:

```text
~/.config/svvy/workflows/generated/**
~/.config/svvy/extensions/generated/**
~/.config/svvy/extensions/builds/**
<workspace>/.smithers/node_modules/@svvy/**
<workspace>/.svvy/generated/**
```

Writes to these paths are build results. Watching them would create self-triggering rebuild loops
and would allow generated state to masquerade as source.

## Recompute Rules

Each invalidation batch runs in this order:

1. Re-read source inputs.
2. Validate source contracts.
3. Rebuild generated packages only for domains that require generated output.
4. Keep the last ready generated package active if a rebuild fails.
5. Surface diagnostics through app logs and relevant read models.
6. Refresh renderer warm caches for affected domains.
7. Mark open surfaces stale by generated-context fingerprint mismatch; opted-in surfaces refresh
   automatically before their next prompt-bearing dispatch.

Invalid source must not be silently skipped or interpreted as deletion. If a source file exists but
is unreadable or invalid, the product reports that state and keeps the previous ready generated
output active until source becomes valid again.

Editable source saves must never silently overwrite a file whose current source version differs
from the draft's base version. Explicit overwrite is a separate user action and is the only path
that may replace an externally changed source file from a stale draft.

## Reliability Requirements

The watcher backend must tolerate:

- editor atomic saves that write a temporary file and rename it over the target
- missing files and directories that appear later
- duplicate low-level events
- file systems that drop or coalesce events
- recursive directory additions and removals
- app-global source changes while multiple workspace tabs share the same runtime

Correctness comes from deterministic fingerprint scans and periodic reconciliation, not from raw
event names or file names.

## Related Specs

- `docs/prd.md`
- `docs/features.ts`
- `docs/specs/extensions-and-tools.spec.md`
- `docs/specs/workflow-library.spec.md`
- `docs/specs/snippets.spec.md`
- `docs/specs/structured-session-state.spec.md`
