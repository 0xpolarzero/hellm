# Project CI Extension Spec

## Status

- Date: 2026-06-03
- Status: draft extension instruction spec
- Scope:
  - define the shipped Project CI extension record
  - separate the prompt-only authoring extension from the broader Project CI lane spec

## Extension Record

```json
{
  "id": "project-ci",
  "category": "shipped",
  "interface": "instructions",
  "title": "Project CI",
  "description": "Project CI authoring guidance for defining and maintaining repository confidence-check workflow lanes.",
  "typescriptApiEnabled": false
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `available` |
| Handler thread | `available` |
| Workflow task agent | `unavailable` |

## Tool Surface

Project CI exposes no native `project_ci_*` tools, no `svvyx project-ci`, and no generated TypeScript
client.

When loaded, it contributes prompt-only guidance for authoring and maintaining Project CI workflow
entries. Runtime execution of existing Project CI entries uses the Smithers extension.

## Current Source Of Truth

The broader Project CI product lane is defined in `docs/specs/project-ci.spec.md`.

That broad spec owns:

- CI lane status and projection
- CI saved workflow entry contracts
- CI run and check-result semantics
- when handlers should load this extension
- how Project CI uses Smithers saved workflow entries

## Draft Notes

- The first real loaded and minimal Project CI extension instructions are not fully written here yet.
- The exact generated-context text should be extracted from `docs/specs/project-ci.spec.md` into a
  concise agent-facing loaded instruction block.
- The broad Project CI lane spec should remain separate because it defines product state and UI, not
  only extension behavior.
