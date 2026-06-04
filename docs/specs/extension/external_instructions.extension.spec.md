# External Instructions Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension index; external file discovery remains in `docs/specs/extensions-and-tools.spec.md`
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

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `default_loaded` |
| Handler thread | `default_loaded` |
| Workflow task agent | `default_loaded` |

## Tool Surface

External Instructions exposes no native tools, no `svvyx` command namespace, and no generated
TypeScript client.

## Rules

- External files are read-only generated-context inputs.
- They appear in the Extensions UI under a distinct External Instructions category.
- Extension Managing may inspect their metadata and usage state.
- Extension Managing must not expose the external files as editable extension source paths.

Current detailed behavior is defined in `docs/specs/extensions-and-tools.spec.md`,
"External Instructions".
