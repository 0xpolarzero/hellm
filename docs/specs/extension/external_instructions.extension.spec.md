# External Instructions Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension index; discovery/default enablement is governed by
  `docs/specs/ambient-agent-resources-baseline.spec.md`, and freshness is governed by
  `docs/specs/source-invalidation.spec.md`
- Scope:
  - define discovered external instruction files as extension records
  - keep external instruction source read-only from Extension Managing

## Extension Record

External instruction files use extension records with:

```json
{
  "category": "external_instruction",
  "interface": "instructions",
  "typescriptApiEnabled": false
}
```

Examples:

```text
AGENTS.md
CLAUDE.md
```

Default usage is per discovered file, not unconditional per actor. When both supported files exist
in the same directory, `AGENTS.md` is enabled by default and `CLAUDE.md` is disabled by default.
When only one supported file exists in a directory, that file is enabled by default. Defaults apply
only until a persisted user control record exists. A file enters generated actor context only when
it is enabled, readable, and selected for that actor kind.

## Tool Surface

External Instructions exposes no native tools, no `svvyx` command namespace, and no generated
`execute_typescript` facade.

## Rules

- External files are read-only generated-context inputs.
- They appear in the Extensions UI under a distinct External Instructions category.
- Extension Managing may inspect their metadata and usage state.
- Extension Managing must not expose the external files as editable extension source paths.

Detailed behavior and package ownership are defined across:

- `docs/specs/extensions-and-tools.spec.md`, "Core Model"
- `docs/prd.md`, "One Execution Model"
- `docs/specs/source-invalidation.spec.md`
